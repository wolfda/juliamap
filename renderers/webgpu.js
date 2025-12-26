import { COMPLEX_PLANE } from "../math/complex.js";
import { Orbit, FN_MANDELBROT, FN_JULIA } from "../math/julia.js";
import { getPaletteId, getPaletteInterpolationId } from "../core/palette.js";
import { hasWebgpu } from "./capabilities.js";
import { Renderer, RenderingEngine, RenderResults } from "./renderer.js";

const MAX_ITERATIONS = 10000; // can increase for deeper zoom if desired
const FLOP_PER_ITER = 9;

const MIN_VARIANCE_SAMPLES = 4;
const DEFAULT_MAX_SUPER_SAMPLES = 64;
const SUPER_SAMPLE_VARIANCE = 0.0005;

// Maximum (absolute) exponent we allow for the *local* pixel->complex scale
// in base-2 log. This keeps u.scale comfortably inside f32's normal range.
const MAX_LOCAL_EXPONENT = 80;

export class WebgpuRenderer extends Renderer {
  static async create(canvas, ctx) {
    const renderer = new WebgpuRenderer(canvas, ctx);
    await renderer.init();
    return renderer;
  }
  constructor(canvas, ctx) {
    super();
    this.canvas = canvas;
    this.ctx = ctx;
    this.gpuDevice = undefined;
    this.canvasFormat = undefined;
    this.gpuContext = undefined;
    this.gpuPipeline = undefined;
    this.gpuUniformBuffer = undefined;
    this.gpuReferenceOrbitBuffer = undefined;
    this.gpuBindGroup = undefined;
    this.orbitWorker = undefined;
    this.nextOrbitRequestId = 1;
    this.pendingOrbitRequests = new Map();
    this.lastFlops = null;
  }

  id() {
    return RenderingEngine.WEBGPU;
  }

  async init() {
    if (!(await hasWebgpu())) {
      throw new Error("Webgpu not supported");
    }
    const adapter = await navigator.gpu.requestAdapter();
    this.gpuDevice = await adapter.requestDevice();
    this.#initOrbitWorker();
    this.gpuContext = this.canvas.getContext("webgpu");
    this.canvasFormat = navigator.gpu.getPreferredCanvasFormat();
    this.gpuContext.configure({
      device: this.gpuDevice,
      format: this.canvasFormat,
      alphaMode: "premultiplied",
    });

    this.gpuPipeline = this.gpuDevice.createRenderPipeline({
      layout: "auto",
      vertex: {
        module: await this.#createShaderModule(wgslVertexShader),
        entryPoint: "main",
      },
      fragment: {
        module: await this.#createShaderModule(wgslFragmentShader),
        entryPoint: "main",
        targets: [{ format: this.canvasFormat }],
      },
      primitive: {
        topology: "triangle-strip",
        stripIndexFormat: undefined,
      },
    });

    // Create a buffer for the uniform data.
    // We'll store the fractal uniforms plus padding for alignment.
    this.gpuUniformBuffer = this.gpuDevice.createBuffer({
      size: 64, // was 56; we add palette interpolation and padding
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Create a buffer for the reference orbit data. We'll allocate enough for
    // 2 floats * MAX_ITERATIONS = 2*4*MAX_ITERATIONS bytes.
    const orbitBufferSize = 2 * 4 * MAX_ITERATIONS;
    this.gpuReferenceOrbitBuffer = this.gpuDevice.createBuffer({
      size: orbitBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Buffer to store iteration counts
    this.gpuIterationBuffer = this.gpuDevice.createBuffer({
      size: 8, // single uint32
      usage:
        GPUBufferUsage.STORAGE |
        GPUBufferUsage.COPY_SRC |
        GPUBufferUsage.COPY_DST,
    });

    this.gpuBindGroup = this.gpuDevice.createBindGroup({
      layout: this.gpuPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: {
            buffer: this.gpuUniformBuffer,
          },
        },
        {
          binding: 1,
          resource: { buffer: this.gpuReferenceOrbitBuffer },
        },
        { binding: 2, resource: { buffer: this.gpuIterationBuffer } },
      ],
    });
  }

  /**
   * Split the pixel->complex scale into:
   *  - scale:        local per-pixel scale used on the GPU (safe exponent range)
   *  - perturbScale: s so that globalScale = scale * s
   *
   * We only rescale when using perturbation, and when the scale is so small
   * that it would drop into denormals at f32 precision.
   */
  #computePerturbationScale(globalScale, usePerturbation) {
    if (!usePerturbation || globalScale === 0 || !Number.isFinite(globalScale)) {
      return { scale: globalScale, perturbScale: 1.0 };
    }

    const absScale = Math.abs(globalScale);
    if (absScale === 0) {
      return { scale: 0.0, perturbScale: 1.0 };
    }

    const expGlobal = Math.floor(Math.log2(absScale));

    // If the exponent is already "comfortable", don't touch it.
    if (expGlobal >= -MAX_LOCAL_EXPONENT) {
      return { scale: globalScale, perturbScale: 1.0 };
    }

    // Clamp the *local* exponent to -MAX_LOCAL_EXPONENT, and push the rest
    // into perturbScale (s).
    const localExp = -MAX_LOCAL_EXPONENT;
    const sExp = expGlobal - localExp;        // globalExp = localExp + sExp
    const perturbScale = Math.pow(2, sExp);   // s = 2^sExp
    const scale = globalScale / perturbScale; // so globalScale = scale * s

    return { scale, perturbScale };
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
      console.warn("[orbit worker] failed to initialize; falling back to main thread", err);
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
      x: isBig ? c.x : c.x,
      y: isBig ? c.y : c.y,
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
      console.warn("[orbit worker] falling back to main thread computation", err);
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
        return undefined;
    }
  }

  resize(width, height) {
    this.canvas.width = width;
    this.canvas.height = height;
    if (this.gpuContext && this.canvasFormat) {
      this.gpuContext.configure({
        device: this.gpuDevice,
        format: this.canvasFormat,
        alphaMode: "premultiplied",
      });
    }
  }

  async #createShaderModule(code) {
    const shaderModule = this.gpuDevice.createShaderModule({ code });
    const compilationInfo = await shaderModule.getCompilationInfo();
    if (compilationInfo.messages.some((msg) => msg.type === "error")) {
      throw new Error("Shader compilation error");
    }
    return shaderModule;
  }

  detach() {
    if (this.orbitWorker) {
      this.orbitWorker.terminate();
      this.orbitWorker = undefined;
      this.pendingOrbitRequests.clear();
    }
  }

  async render(map, options) {
    const maxIter = Math.min(options.maxIter, MAX_ITERATIONS);

    const w = this.canvas.width;
    const h = this.canvas.height;

    // Global pixel->complex scale
    const globalScale = (4 / w) * Math.pow(2, -map.zoom);

    // For deep (perturbation) rendering, split the scale into a local part
    // (u.scale) and a global factor s = u.perturbScale.
    const { scale: gpuScale, perturbScale } = this.#computePerturbationScale(
      globalScale,
      options.deep
    );

    // ------------------------------------
    // 3. Write fractal parameters to GPU
    // ------------------------------------
    let orbit = undefined;
    if (options.deep) {
      orbit = await this.#computeOrbit(map, w, h, maxIter, options);
    }
    const maxSuperSamples = Math.max(
      1,
      Math.floor(options.maxSuperSamples ?? DEFAULT_MAX_SUPER_SAMPLES)
    );

    // NOTE: now 64 bytes instead of 56
    const uniformArray = new ArrayBuffer(64);
    const dataView = new DataView(uniformArray);
    const mapCenter = COMPLEX_PLANE.complex().project(map.center);
    const fnParam0 = COMPLEX_PLANE.complex().project(options.fn.param0);

    dataView.setUint32(0, options.deep ? 1 : 0, true); // usePerturbation
    dataView.setFloat32(4, map.zoom, true); // zoom
    dataView.setFloat32(8, orbit ? orbit.sx : mapCenter.x, true); // center
    dataView.setFloat32(12, orbit ? orbit.sy : mapCenter.y, true); // center
    dataView.setFloat32(16, w, true); // resolution
    dataView.setFloat32(20, h, true); // resolution
    dataView.setUint32(24, maxIter, true); // maxIter
    dataView.setUint32(28, maxSuperSamples, true); // maxSuperSamples
    dataView.setUint32(32, getPaletteId(options.palette), true); // paletteId
    dataView.setUint32(
      36,
      getPaletteInterpolationId(options.paletteInterpolation),
      true
    ); // paletteInterpolation
    dataView.setUint32(40, options.fn.id, true); // functionId
    dataView.setUint32(44, 0, true); // padding
    dataView.setFloat32(48, fnParam0.x, true); // param0
    dataView.setFloat32(52, fnParam0.y, true); // param0
    dataView.setFloat32(56, gpuScale, true); // scale
    dataView.setFloat32(60, perturbScale, true); // perturbScale

    this.gpuDevice.queue.writeBuffer(this.gpuUniformBuffer, 0, uniformArray);

    if (orbit) {
      this.gpuDevice.queue.writeBuffer(
        this.gpuReferenceOrbitBuffer,
        0,
        orbit.iters
      );
    }

    this.#resetIterationCounter();

    // Acquire a texture to render into
    const renderView = this.gpuContext.getCurrentTexture().createView();

    // Build the command pass
    const commandEncoder = this.gpuDevice.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
      colorAttachments: [
        {
          view: renderView,
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });

    passEncoder.setPipeline(this.gpuPipeline);
    passEncoder.setBindGroup(0, this.gpuBindGroup);
    passEncoder.setViewport(0, 0, w, h, 0, 1);
    passEncoder.setScissorRect(0, 0, w, h);
    passEncoder.draw(4, 1, 0, 0);
    passEncoder.end();

    const gpuCommands = commandEncoder.finish();
    this.gpuDevice.queue.submit([gpuCommands]);

    // Don't await GPU completion here; let the main loop stay smooth.
    this.#captureIterations().catch(() => {});

    return new RenderResults(this.id(), options, this.lastFlops);
  }

  #resetIterationCounter() {
    this.gpuDevice.queue.writeBuffer(
      this.gpuIterationBuffer,
      0,
      new Uint32Array([0, 0]).buffer
    );
  }

  async #readIterations() {
    const readBuffer = this.gpuDevice.createBuffer({
      size: 8,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });

    const commandEncoder = this.gpuDevice.createCommandEncoder();

    // Copy GPU-side buffer to CPU-readable buffer
    commandEncoder.copyBufferToBuffer(
      this.gpuIterationBuffer,
      0,
      readBuffer,
      0,
      8 // 2 * u32 = 8 bytes
    );
    this.gpuDevice.queue.submit([commandEncoder.finish()]);

    // Read asynchronously
    await readBuffer.mapAsync(GPUMapMode.READ);
    const data = new Uint32Array(readBuffer.getMappedRange());

    const low = data[0];
    const high = data[1];

    readBuffer.unmap();
    readBuffer.destroy();

    const totalIterations = (BigInt(high) << BigInt(32)) | BigInt(low);
    return Number(totalIterations);
  }

  async #captureIterations() {
    await this.gpuDevice.queue.onSubmittedWorkDone();
    const totalIterations = await this.#readIterations();
    this.lastFlops = totalIterations * FLOP_PER_ITER;
  }
}

/* ---------------------------------------------------------
 * WGSL Shaders (updated to model complex numbers as vec2f)
 * --------------------------------------------------------- */

const wgslVertexShader = /* wgsl */ `
@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
    // We'll draw 2 triangles that cover the entire clip space:
    //   vertexIndex: 0,1,2,3 => positions in a strip
    let x = f32((vertexIndex & 1u) << 1u) - 1; // 0->-1, 1->1, 2->-1, 3->1
    let y = f32((vertexIndex & 2u)) - 1;       // 0->-1, 1->-1, 2->1, 3->1
    return vec4f(x, y, 0, 1);
}
`;

const wgslFragmentShader = /* wgsl */ `
struct FractalUniforms {
    usePerturbation: u32,
    zoom           : f32,
    center         : vec2f,
    resolution     : vec2f,
    maxIter        : u32,
    maxSamples     : u32,
    paletteId      : u32,
    paletteInterpolation: u32,
    functionId     : u32,
    _padding0      : u32,
    param0         : vec2f,
    scale          : f32,
    perturbScale   : f32,
};

struct AtomicU64 {
    lo: atomic<u32>,
    hi: atomic<u32>,
};

@group(0) @binding(0)
var<uniform> u: FractalUniforms;

@group(0) @binding(1)
var<storage, read> referenceOrbit: array<vec2f, ${MAX_ITERATIONS}>;

@group(0) @binding(2)
var<storage, read_write> iterationCounter: AtomicU64;

const MIN_VARIANCE_SAMPLES: u32 = ${MIN_VARIANCE_SAMPLES}u;
const SUPER_SAMPLE_VARIANCE: f32 = ${SUPER_SAMPLE_VARIANCE};

// --- Math functions

// Compute c² on a complex number.
fn complexSquare(c: vec2f) -> vec2f {
    return vec2f(c.x * c.x - c.y * c.y, 2 * c.x * c.y);
}

// Compute c₀ x c₁ for 2 complex numbers.
fn complexMul(c0: vec2f, c1: vec2f) -> vec2f {
    return vec2f(c0.x * c1.x - c0.y * c1.y, c0.x * c1.y + c0.y * c1.x);
}

// Compute |c|², the square of the modulus of a complex number.
fn complexSquareMod(c: vec2f) -> f32 {
    return dot(c, c);
}

var<private> seed: u32 = 123456789u;
const MAX_U32 = f32(0xffffffffu);

// Compute the next random number, in [0, 1)
fn rand() -> f32 {
    seed ^= seed << 13;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    return f32(seed) / MAX_U32;
}

// Compute the decimal value of a mod b
fn fmod(a: f32, b: f32) -> f32 {
    return a - b * floor(a / b);
}

// --- Color functions

const RED = vec3f(1, 0, 0);
const YELLOW = vec3f(1, 1, 0);
const GREEN = vec3f(0, 1, 0);
const CYAN = vec3f(0, 1, 1);
const BLUE = vec3f(0, 0, 1);
const MAGENTA = vec3f(1, 0, 1);
const BLACK = vec3f(0, 0, 0);
const WHITE = vec3f(1, 1, 1);
const UNUSED = BLACK;

const MAX_COLORS: u32 = 6u;
const ELECTRIC = array<vec3f, MAX_COLORS>(BLUE, WHITE, UNUSED, UNUSED, UNUSED, UNUSED);
const RAINBOW = array<vec3f, MAX_COLORS>(YELLOW, GREEN, CYAN, BLUE, MAGENTA, RED);
const ZEBRA = array<vec3f, MAX_COLORS>(WHITE, BLACK, UNUSED, UNUSED, UNUSED, UNUSED);

// Same color palette as used on the Wikipedia page: https://en.wikipedia.org/wiki/Mandelbrot_set
const WIKI0 = vec3f(  0,   7, 100) / 255.0;
const WIKI1 = vec3f( 32, 107, 203) / 255.0;
const WIKI2 = vec3f(237, 255, 255) / 255.0;
const WIKI3 = vec3f(255, 170,   0) / 255.0;
const WIKI4 = vec3f(  0,   2,   0) / 255.0;
const WIKIPEDIA = array<vec3f, MAX_COLORS>(WIKI0, WIKI1, WIKI2, WIKI3, WIKI4, UNUSED);
const WIKIPEDIA_POSITIONS = array<f32, MAX_COLORS>(0.0, 0.16, 0.42, 0.6425, 0.8575, 1.0);

const PALETTE_INTERPOLATION_LINEAR = 0u;
const PALETTE_INTERPOLATION_SPLINE = 1u;

// Interpolate the color with the given palette, using spline interpolation.
fn interpolatePaletteSpline(palette: array<vec3f, MAX_COLORS>, count: u32, t: f32) -> vec3f {
    let wrapped = fract(t);
    let scaled = wrapped * f32(count);
    let i = u32(min(scaled, f32(count) - 0.001));
    let localT = scaled - f32(i);

    let i0 = i;
    let i1 = (i + 1u) % count;
    let im1 = (i + count - 1u) % count;
    let i2 = (i + 2u) % count;

    let p0 = palette[i0];
    let p1 = palette[i1];

    let m0 = 0.5 * (palette[i1] - palette[im1]);
    let m1 = 0.5 * (palette[i2] - palette[i0]);

    let t2 = localT * localT;
    let t3 = t2 * localT;

    return (2.0 * t3 - 3.0 * t2 + 1.0) * p0
        + (t3 - 2.0 * t2 + localT) * m0
        + (-2.0 * t3 + 3.0 * t2) * p1
        + (t3 - t2) * m1;
}

// Interpolate the color with the given palette, using linear interpolation.
fn interpolatePaletteLinear(palette: array<vec3f, MAX_COLORS>, count: u32, t: f32) -> vec3f {
    let wrapped = fract(t);
    let scaled = wrapped * f32(count);
    let i = u32(min(scaled, f32(count) - 0.001));
    let localT = scaled - f32(i);

    let c0 = palette[i];
    let c1 = palette[(i + 1u) % count];

    return c0 + localT * (c1 - c0);
}

// Interpolate the color with the given color palette, with fixed positions and spline interpolation
fn interpolatePaletteSplinePos(
    palette: array<vec3f, MAX_COLORS>,
    positions: array<f32, MAX_COLORS>,
    count: u32,
    index: f32
) -> vec3f {
    let lastIndex = count - 1u;
    let t = fmod(index, 1.0);

    let firstPos = positions[0];
    let lastPos = positions[lastIndex];
    if (t <= firstPos) {
        return palette[0];
    }
    if (t >= lastPos) {
        let span = 1.0 - lastPos + firstPos;
        let wrapT = (t - lastPos) / span;
        let u = (f32(lastIndex) + wrapT) / f32(count);
        return interpolatePaletteSpline(palette, count, u);
    }

    for (var i = 0u; i < lastIndex; i += 1u) {
        let t0 = positions[i];
        let t1 = positions[i + 1u];
        if (t >= t0 && t <= t1) {
            let localT = (t - t0) / (t1 - t0);
            let u = (f32(i) + localT) / f32(count);
            return interpolatePaletteSpline(palette, count, u);
        }
    }

    return palette[lastIndex];
}

// Interpolate the color with the given color palette, with fixed positions and linear interpolation
fn interpolatePaletteLinearPos(
    palette: array<vec3f, MAX_COLORS>,
    positions: array<f32, MAX_COLORS>,
    count: u32,
    index: f32
) -> vec3f {
    let lastIndex = count - 1u;
    let t = fmod(index, 1.0);

    let firstPos = positions[0];
    let lastPos = positions[lastIndex];
    if (t <= firstPos) {
        return palette[0];
    }
    if (t >= lastPos) {
        let span = 1.0 - lastPos + firstPos;
        let wrapT = (t - lastPos) / span;
        let u = (f32(lastIndex) + wrapT) / f32(count);
        return interpolatePaletteLinear(palette, count, u);
    }

    for (var i = 0u; i < lastIndex; i += 1u) {
        let t0 = positions[i];
        let t1 = positions[i + 1u];
        if (t >= t0 && t <= t1) {
            let localT = (t - t0) / (t1 - t0);
            let u = (f32(i) + localT) / f32(count);
            return interpolatePaletteLinear(palette, count, u);
        }
    }

    return palette[lastIndex];
}

fn interpolatePalette(palette: array<vec3f, MAX_COLORS>, count: u32, t: f32) -> vec3f {
    if (u.paletteInterpolation == PALETTE_INTERPOLATION_LINEAR) {
        return interpolatePaletteLinear(palette, count, t);
    }
    return interpolatePaletteSpline(palette, count, t);
}

fn interpolatePalettePos(
    palette: array<vec3f, MAX_COLORS>,
    positions: array<f32, MAX_COLORS>,
    count: u32,
    index: f32
) -> vec3f {
    if (u.paletteInterpolation == PALETTE_INTERPOLATION_LINEAR) {
        return interpolatePaletteLinearPos(palette, positions, count, index);
    }
    return interpolatePaletteSplinePos(palette, positions, count, index);
}

fn getPaletteColor(palette: array<vec3f, MAX_COLORS>, count: u32, index: f32) -> vec3f {
    return palette[u32(fmod(index, 1.0) * f32(count))];
}

// --- Julia / Mandelbrot coloring

fn rainbowColor(escapeVelocity: f32) -> vec3f {
    return interpolatePalette(RAINBOW, 6u, escapeVelocity / 150);
}

fn electricColor(escapeVelocity: f32) -> vec3f {
    return interpolatePalette(ELECTRIC, 2u, escapeVelocity / 100);
}

fn zebraColor(escapeVelocity: f32) -> vec3f {
    return getPaletteColor(ZEBRA, 2u, escapeVelocity / 5);
}

fn wikipediaColor(escapeVelocity: f32) -> vec3f {
    return interpolatePalettePos(
        WIKIPEDIA,
        WIKIPEDIA_POSITIONS,
        5u,
        escapeVelocity / 150
    );
}

const ELECTRIC_PALETTE_ID = 0u;
const RAINBOW_PALETTE_ID = 1u;
const ZEBRA_PALETTE_ID = 2u;
const WIKIPEDIA_PALETTE_ID = 3u;

fn getColor(escapeVelocity: f32) -> vec3f {
    if (escapeVelocity >= f32(u.maxIter)) {
        return BLACK;
    }
    switch (u.paletteId) {
        case ELECTRIC_PALETTE_ID: {
            return electricColor(escapeVelocity);
        }
        case RAINBOW_PALETTE_ID: {
            return rainbowColor(escapeVelocity);
        }
        case ZEBRA_PALETTE_ID: {
            return zebraColor(escapeVelocity);
        }
        case WIKIPEDIA_PALETTE_ID, default: {
            return wikipediaColor(escapeVelocity);
        }
    }
}

const FN_MANDELBROT = 0u;
const FN_JULIA = 1u;
const BAILOUT = 128;

fn isFinite(x: f32) -> bool {
    return x * 0.0 == 0.0;
}

fn smoothEscapeVelocity(iter: u32, squareMod: f32) -> f32 {
    if (!isFinite(squareMod) || squareMod <= 0.0) {
        return f32(iter);
    }
    let mag = sqrt(squareMod);
    // ν = n + 1 - log2(log(|z|))
    return f32(iter) + 1.0 - log2(log(mag));
}
  
fn incrementIterations(value: u32) {
    let prev = atomicAdd(&iterationCounter.lo, value);
    if (prev + value < prev) { // Overflow detected
        atomicAdd(&iterationCounter.hi, 1u);
    }
}

fn julia(z0: vec2f, c: vec2f, maxIter: u32) -> f32 {
    var z = z0;
    for (var i = 0u; i < maxIter; i += 1u) {
        // Compute z = z² + c, where z² is computed using complex multiplication.
        z = complexSquare(z) + c;

        // If the magnitude of z exceeds 2.0 (|z|² > 4), the point escapes.
        let squareMod = complexSquareMod(z);
        if (squareMod > BAILOUT * BAILOUT) {
            incrementIterations(i);
            return smoothEscapeVelocity(i, squareMod);
        }
    }
    incrementIterations(maxIter);
    return f32(maxIter);
}

fn juliaPerturb(dz0_hat: vec2f, dc_hat: vec2f, maxIter: u32) -> f32 {
    // dz_hat and dc_hat are the *scaled* perturbations.
    var dz_hat = dz0_hat;
    var z = referenceOrbit[0];

    let s = u.perturbScale;

    for (var i = 0u; i < maxIter; i += 1u) {
        // Δẑ_{n+1} = (2 z_n + s Δẑ_n) Δẑ_n + Δĉ
        dz_hat = complexMul(2.0 * z + s * dz_hat, dz_hat) + dc_hat;

        // Reconstruct the true orbit: w_n = z_n + s Δẑ_n
        let w = z + s * dz_hat;
        let squareMod = complexSquareMod(w);

        if (squareMod > BAILOUT * BAILOUT) {
            incrementIterations(i);
            return smoothEscapeVelocity(i, squareMod);
        }

        z = referenceOrbit[i + 1];
    }
    incrementIterations(maxIter);
    return f32(maxIter);
}

// --- Rendering functions

fn renderOne(fragCoord: vec2f, scaleFactor: vec2f) -> vec3f {
    let maxIter = u.maxIter;
    var escapeVelocity = 0.0;
    if u.usePerturbation == 0 {
        let pos = u.center + (fragCoord - 0.5 * u.resolution) * scaleFactor;
        switch (u.functionId) {
            case FN_JULIA: {
                escapeVelocity = julia(pos, u.param0, maxIter);
            }
            case FN_MANDELBROT, default: {
                escapeVelocity = julia(vec2f(0), pos, maxIter);
            }
        }
    } else {
        let delta = (fragCoord - u.center) * scaleFactor;
        switch (u.functionId) {
            case FN_JULIA: {
                escapeVelocity = juliaPerturb(delta, vec2f(0), maxIter);
            }
            case FN_MANDELBROT, default: {
                escapeVelocity = juliaPerturb(vec2f(0), delta, maxIter);
            }
        }
    }

    return getColor(escapeVelocity);
}

fn renderSuperSample(fragCoord: vec2f, scaleFactor: vec2f) -> vec3f {
    var mean = vec3f(0);
    var m2 = vec3f(0);
    var sampleCount: u32 = 0u;

    for (var i = 0u; i < u.maxSamples; i += 1u) {
        // Add a random jitter in [-0.5, 0.5] to compute the value of the next sample.
        let jitter = vec2f(rand() - 0.5, rand() - 0.5);
        let sample = renderOne(fragCoord + jitter, scaleFactor);
        sampleCount += 1u;

        // Welford's algorithm for per-channel variance.
        let delta = sample - mean;
        mean += delta / f32(sampleCount);
        let delta2 = sample - mean;
        m2 += delta * delta2;

        let minVarianceSamples = min(u.maxSamples, MIN_VARIANCE_SAMPLES);
        if (sampleCount >= minVarianceSamples) {
            let denom = max(f32(sampleCount - 1u), 1.0);
            let variance = m2 / denom;
            let maxVariance = max(variance.r, max(variance.g, variance.b));
            if (maxVariance <= SUPER_SAMPLE_VARIANCE) {
                break;
            }
        }
    }

    return mean;
}

@fragment
fn main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
    // Per-pixel scale in the complex plane (already rescaled on the CPU).
    let scaleFactor = u.scale * vec2f(1.0, -1.0);

    if (u.maxSamples == 1u) {
        return vec4f(renderOne(fragCoord.xy, scaleFactor), 1.0);
    } else {
        return vec4f(renderSuperSample(fragCoord.xy, scaleFactor), 1.0);
    }
}
`;
