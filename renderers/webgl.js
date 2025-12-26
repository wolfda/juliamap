import { COMPLEX_PLANE } from "../math/complex.js";
import { FN_JULIA, FN_MANDELBROT, Orbit } from "../math/julia.js";
import { getPaletteId, getPaletteInterpolationId } from "../core/palette.js";
import { hasWebgl1, hasWebgl2 } from "./capabilities.js";
import { RenderResults, Renderer } from "./renderer.js";

const WEBGL2_MAX_ITERATIONS = 10000;
const WEBGL1_SCALE = 1;
const WEBGL1_MAX_SAMPLES = 64;
const WEBGL2_MAX_SAMPLES = 64;

const WEBGL1_FRAGMENT_URL = new URL("./webgl1.glsl", import.meta.url);
const WEBGL2_FRAGMENT_URL = new URL("./webgl2.glsl", import.meta.url);

const WEBGL1_VERTEX_SHADER = `
  attribute vec2 aPosition;
  void main() {
    gl_Position = vec4(aPosition, 0.0, 1.0);
  }
`;

const WEBGL2_VERTEX_SHADER = `#version 300 es
precision highp float;
in vec2 aPosition;
void main() {
  gl_Position = vec4(aPosition, 0, 1);
}
`;

async function loadShaderSource(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load shader source: ${url}`);
  }
  return response.text();
}

function compileShader(gl, source, type) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export class WebglRenderer extends Renderer {
  constructor(canvas, ctx, options) {
    super();
    this.canvas = canvas;
    this.ctx = ctx;
    this.version = options.version;
    this.gl = undefined;
    this.webGLCanvas = undefined;
    this.webGLProgram = undefined;
    this.uResolution = undefined;
    this.uCenterZoom = undefined;
    this.uMaxIter = undefined;
    this.uSamples = undefined;
    this.uPaletteId = undefined;
    this.uPaletteInterpolation = undefined;
    this.uUsePerturb = undefined;
    this.uOrbitCount = undefined;
    this.uFunctionId = undefined;
    this.uParam0 = undefined;
    this.uOrbitTex = undefined;
    this.uOrbitTexSize = undefined;
    this.orbitBuffer = undefined;
    this.orbitWorker = undefined;
    this.nextOrbitRequestId = 1;
    this.pendingOrbitRequests = new Map();
  }

  async init() {
    const isWebgl2 = this.version === 2;
    if (isWebgl2 ? !hasWebgl2() : !hasWebgl1()) {
      throw new Error(isWebgl2 ? "Webgl2 is not supported" : "Webgl1 not supported");
    }

    if (isWebgl2) {
      this.webGLCanvas = this.canvas;
    } else {
      this.webGLCanvas = document.createElement("canvas");
      this.webGLCanvas.width = this.canvas.width;
      this.webGLCanvas.height = this.canvas.height;
      this.webGLCanvas.style.display = "none";
      document.body.appendChild(this.webGLCanvas);
    }

    this.gl = this.webGLCanvas.getContext(isWebgl2 ? "webgl2" : "webgl");
    const gl = this.gl;
    if (!gl) {
      throw new Error("Failed to create WebGL context");
    }

    if (!isWebgl2) {
      if (!gl.getExtension("OES_texture_float")) {
        throw new Error("OES_texture_float extension not supported.");
      }
    }

    const vsSource = isWebgl2 ? WEBGL2_VERTEX_SHADER : WEBGL1_VERTEX_SHADER;
    const fsSource = await loadShaderSource(
      isWebgl2 ? WEBGL2_FRAGMENT_URL : WEBGL1_FRAGMENT_URL
    );

    const vs = compileShader(gl, vsSource, gl.VERTEX_SHADER);
    const fs = compileShader(gl, fsSource, gl.FRAGMENT_SHADER);
    this.webGLProgram = gl.createProgram();
    gl.attachShader(this.webGLProgram, vs);
    gl.attachShader(this.webGLProgram, fs);
    gl.linkProgram(this.webGLProgram);

    if (!gl.getProgramParameter(this.webGLProgram, gl.LINK_STATUS)) {
      throw new Error(
        `Could not link WebGL program: ${gl.getProgramInfoLog(
          this.webGLProgram
        )}`
      );
    }

    gl.useProgram(this.webGLProgram);

    this.uResolution = gl.getUniformLocation(this.webGLProgram, "uResolution");
    this.uCenterZoom = gl.getUniformLocation(this.webGLProgram, "uCenterZoom");
    this.uMaxIter = gl.getUniformLocation(this.webGLProgram, "uMaxIter");
    this.uSamples = gl.getUniformLocation(this.webGLProgram, "uSamples");
    this.uPaletteId = gl.getUniformLocation(this.webGLProgram, "uPaletteId");
    this.uPaletteInterpolation = gl.getUniformLocation(
      this.webGLProgram,
      "uPaletteInterpolation"
    );
    this.uUsePerturb = gl.getUniformLocation(this.webGLProgram, "uUsePerturb");
    this.uFunctionId = gl.getUniformLocation(this.webGLProgram, "uFunctionId");
    this.uParam0 = gl.getUniformLocation(this.webGLProgram, "uParam0");
    this.uOrbitCount = gl.getUniformLocation(this.webGLProgram, "uOrbitCount");

    if (isWebgl2) {
      const orbitBlockIndex = gl.getUniformBlockIndex(
        this.webGLProgram,
        "OrbitBlock"
      );
      gl.uniformBlockBinding(this.webGLProgram, orbitBlockIndex, 0);

      this.orbitBuffer = gl.createBuffer();
      gl.bindBuffer(gl.UNIFORM_BUFFER, this.orbitBuffer);
      gl.bufferData(
        gl.UNIFORM_BUFFER,
        new Float32Array(2 * WEBGL2_MAX_ITERATIONS),
        gl.STATIC_DRAW
      );
      gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.orbitBuffer);
    } else {
      this.uOrbitTex = gl.getUniformLocation(this.webGLProgram, "uOrbitTex");
      this.uOrbitTexSize = gl.getUniformLocation(
        this.webGLProgram,
        "uOrbitTexSize"
      );
    }

    const aPosition = gl.getAttribLocation(this.webGLProgram, "aPosition");
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    this.#initOrbitWorker();
  }

  resize(width, height) {
    const canvas = this.gl.canvas;
    canvas.width = width;
    canvas.height = height;
  }

  detach() {
    if (this.orbitWorker) {
      this.orbitWorker.terminate();
      this.orbitWorker = undefined;
      this.pendingOrbitRequests.clear();
    }
    if (!this.webGLCanvas || this.webGLCanvas === this.canvas) {
      return;
    }
    if (this.webGLCanvas?.parentNode) {
      this.webGLCanvas.parentNode.removeChild(this.webGLCanvas);
    }
  }

  #initOrbitWorker() {
    try {
      this.orbitWorker = new Worker(
        new URL("./orbit-worker.js", import.meta.url),
        { type: "module" }
      );
      this.orbitWorker.onmessage = ({ data }) => {
        const { requestId, orbit, error } = data;
        const pending = this.pendingOrbitRequests.get(requestId);
        if (!pending) {
          return;
        }
        this.pendingOrbitRequests.delete(requestId);
        if (error) {
          pending.reject?.(new Error(error));
        } else {
          if (orbit?.iters && !(orbit.iters instanceof Float32Array)) {
            orbit.iters = new Float32Array(orbit.iters);
          }
          pending.resolve?.(orbit);
        }
      };
      this.orbitWorker.onerror = (err) => {
        console.warn("[orbit worker] error", err);
      };
    } catch (err) {
      console.warn(
        "[orbit worker] failed to initialize; falling back to main thread",
        err
      );
      this.orbitWorker = undefined;
    }
  }

  #serializeComplex(c) {
    if (!c) {
      return { x: 0, y: 0, planeExponent: null };
    }
    const plane = c.plane ?? COMPLEX_PLANE;
    const isBig = plane.isBigComplex();
    return {
      x: c.x,
      y: c.y,
      planeExponent: isBig ? plane.exponent : null,
    };
  }

  async #computeOrbit(map, w, h, maxIter, options) {
    if (!this.orbitWorker) {
      return this.#computeOrbitSync(map, w, h, maxIter, options);
    }

    const mapPlane = map.plane ?? COMPLEX_PLANE;
    const requestId = this.nextOrbitRequestId++;
    const payload = {
      map: {
        planeExponent: mapPlane.isBigComplex() ? mapPlane.exponent : null,
        center: this.#serializeComplex(map.center),
        zoom: map.zoom,
      },
      width: w,
      height: h,
      maxIter,
      fnId: options.fn.id,
      fnParam0: this.#serializeComplex(options.fn.param0),
    };

    return new Promise((resolve, reject) => {
      this.pendingOrbitRequests.set(requestId, { resolve, reject });
      this.orbitWorker.postMessage({ requestId, payload });
    }).catch((err) => {
      console.warn(
        "[orbit worker] falling back to main thread computation",
        err
      );
      return this.#computeOrbitSync(map, w, h, maxIter, options);
    });
  }

  #computeOrbitSync(map, w, h, maxIter, options) {
    switch (options.fn.id) {
      case FN_MANDELBROT:
        return Orbit.searchForMandelbrot(map, w, h, maxIter);
      case FN_JULIA:
        return Orbit.searchForJulia(map, w, h, maxIter, options.fn.param0);
      default:
        return null;
    }
  }

  async render(map, options) {
    const gl = this.gl;
    const isWebgl2 = this.version === 2;
    const scale = isWebgl2 ? 1 : WEBGL1_SCALE;
    const w = Math.ceil(this.canvas.width * scale);
    const h = Math.ceil(this.canvas.height * scale);

    gl.viewport(0, 0, w, h);

    gl.useProgram(this.webGLProgram);
    gl.uniform2f(this.uResolution, w, h);
    gl.uniform1i(this.uMaxIter, options.maxIter);
    const maxSamples = isWebgl2 ? WEBGL2_MAX_SAMPLES : WEBGL1_MAX_SAMPLES;
    const samples = Math.min(
      Math.floor(Math.max(options.maxSuperSamples ?? 1, 1)),
      maxSamples
    );
    gl.uniform1i(this.uSamples, samples);
    gl.uniform1i(this.uPaletteId, getPaletteId(options.palette));
    gl.uniform1i(
      this.uPaletteInterpolation,
      getPaletteInterpolationId(options.paletteInterpolation)
    );
    gl.uniform1i(this.uUsePerturb, options.deep ? 1 : 0);
    gl.uniform1i(this.uFunctionId, options.fn.id);
    const fnParam0 = COMPLEX_PLANE.complex().project(options.fn.param0);
    gl.uniform2f(this.uParam0, fnParam0.x, fnParam0.y);

    if (options.deep) {
      const orbit = await this.#computeOrbit(map, w, h, options.maxIter, options);
      if (orbit) {
        gl.uniform3f(this.uCenterZoom, orbit.sx, h - orbit.sy, map.zoom);
      } else {
        const center = COMPLEX_PLANE.complex().project(map.center);
        gl.uniform3f(this.uCenterZoom, center.x, center.y, map.zoom);
      }

      if (isWebgl2) {
        const orbitCount = orbit
          ? Math.min(orbit.iters.length / 2, WEBGL2_MAX_ITERATIONS)
          : 0;
        gl.uniform1i(this.uOrbitCount, orbitCount);

        const paddedOrbit = new Float32Array(2 * WEBGL2_MAX_ITERATIONS);
        if (orbit) {
          for (let i = 0; i < orbitCount; i++) {
            paddedOrbit[i * 2] = orbit.iters[i * 2];
            paddedOrbit[i * 2 + 1] = orbit.iters[i * 2 + 1];
          }
        }

        gl.bindBuffer(gl.UNIFORM_BUFFER, this.orbitBuffer);
        gl.bufferData(gl.UNIFORM_BUFFER, paddedOrbit, gl.STATIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.orbitBuffer);
      } else {
        const orbitCount = orbit ? orbit.iters.length / 2 : 0;
        const texWidth = 256;
        const texHeight = Math.max(1, Math.ceil((0.5 * orbitCount) / texWidth));
        const paddedOrbit = new Float32Array(texWidth * texHeight * 4);
        if (orbit) {
          paddedOrbit.set(orbit.iters);
        }

        const orbitTexture = gl.createTexture();
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, orbitTexture);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
        gl.texImage2D(
          gl.TEXTURE_2D,
          0,
          gl.RGBA,
          texWidth,
          texHeight,
          0,
          gl.RGBA,
          gl.FLOAT,
          paddedOrbit
        );
        gl.uniform1i(this.uOrbitTex, 0);
        gl.uniform2f(this.uOrbitTexSize, texWidth, texHeight);
        gl.uniform1i(this.uOrbitCount, orbitCount);
      }
    } else {
      const center = COMPLEX_PLANE.complex().project(map.center);
      gl.uniform3f(this.uCenterZoom, center.x, center.y, map.zoom);
    }

    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    if (!isWebgl2) {
      const prevSmoothing = this.ctx.imageSmoothingEnabled;
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.drawImage(
        gl.canvas,
        0,
        this.canvas.height - h,
        w,
        h,
        0,
        0,
        this.canvas.width,
        this.canvas.height
      );
      this.ctx.imageSmoothingEnabled = prevSmoothing;
    }

    return new RenderResults(this.id(), options);
  }
}
