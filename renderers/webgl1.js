import { COMPLEX_PLANE } from "../complex.js";
import { FN_JULIA, FN_MANDELBROT, Orbit } from "../julia.js"; // added for deep zoom perturbation
import { getPaletteId } from "../palette.js";
import { hasWebgl1 } from "./capabilities.js";
import { RenderResults, Renderer, RenderingEngine } from "./renderer.js";

export class Webgl1Renderer extends Renderer {
  static create(canvas, ctx) {
    return new Webgl1Renderer(canvas, ctx);
  }

  constructor(canvas, ctx) {
    super();
    this.canvas = canvas;
    this.ctx = ctx;
    this.gl = undefined;
    this.webGLProgram = undefined;
    this.uResolution = undefined;
    this.uCenterZoom = undefined;
    this.uMaxIter = undefined;
    this.uSamples = undefined;
    this.uPaletteId = undefined;
    this.uUsePerturb = undefined;
    this.uFunctionId = undefined;
    this.uParam0 = undefined;

    this.init();
  }

  id() {
    return RenderingEngine.WEBGL1;
  }

  init() {
    if (!hasWebgl1()) {
      throw new Error("Webgl1 not supported");
    }

    const webGLCanvas = document.createElement("canvas");
    webGLCanvas.width = this.canvas.width;
    webGLCanvas.height = this.canvas.height;
    webGLCanvas.style.display = "none";
    document.body.appendChild(webGLCanvas);

    this.gl = webGLCanvas.getContext("webgl");
    const gl = this.gl;

    // For floating-point textures we need the OES_texture_float extension.
    if (!gl.getExtension("OES_texture_float")) {
      throw new Error("OES_texture_float extension not supported.");
    }

    // Vertex shader (full-screen quad)
    const vsSource = `
        attribute vec2 aPosition;
        void main() {
            gl_Position = vec4(aPosition, 0.0, 1.0);
        }
        `;

    // Compile and link shaders
    function compileShader(source, type) {
      const s = gl.createShader(type);
      gl.shaderSource(s, source);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
        console.error(gl.getShaderInfoLog(s));
        gl.deleteShader(s);
        return null;
      }
      return s;
    }

    const vs = compileShader(vsSource, gl.VERTEX_SHADER);
    const fs = compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
    this.webGLProgram = gl.createProgram();
    gl.attachShader(this.webGLProgram, vs);
    gl.attachShader(this.webGLProgram, fs);
    gl.linkProgram(this.webGLProgram);

    if (!gl.getProgramParameter(this.webGLProgram, gl.LINK_STATUS)) {
      console.error(
        "Could not link WebGL program:",
        gl.getProgramInfoLog(this.webGLProgram)
      );
      return false;
    }

    gl.useProgram(this.webGLProgram);

    // Look up uniform locations.
    this.uResolution = gl.getUniformLocation(this.webGLProgram, "uResolution");
    this.uCenterZoom = gl.getUniformLocation(this.webGLProgram, "uCenterZoom");
    this.uMaxIter = gl.getUniformLocation(this.webGLProgram, "uMaxIter");
    this.uSamples = gl.getUniformLocation(this.webGLProgram, "uSamples");
    this.uPaletteId = gl.getUniformLocation(this.webGLProgram, "uPaletteId");
    this.uUsePerturb = gl.getUniformLocation(this.webGLProgram, "uUsePerturb");
    this.uFunctionId = gl.getUniformLocation(this.webGLProgram, "uFunctionId");
    this.uParam0 = gl.getUniformLocation(this.webGLProgram, "uParam0");

    // Setup a full-viewport quad.
    const aPosition = gl.getAttribLocation(this.webGLProgram, "aPosition");
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

    const vertices = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    return true;
  }

  resize(width, height) {
    const canvas = this.gl.canvas;
    canvas.width = width;
    canvas.height = height;
  }

  detach() {
    document.removeChild(this.webGLCanvas);
  }

  render(map, options) {
    const gl = this.gl;

    // const scale = Math.min(options.pixelDensity, 1);
    const scale = 0.5;
    const w = Math.ceil(this.canvas.width * scale);
    const h = Math.ceil(this.canvas.height * scale);

    gl.viewport(0, 0, w, h);

    // Set uniforms.
    gl.useProgram(this.webGLProgram);
    gl.uniform2f(this.uResolution, w, h);
    gl.uniform1i(this.uMaxIter, options.maxIter);
    const samples = Math.floor(Math.max(options.pixelDensity, 1));
    gl.uniform1i(this.uSamples, samples);
    gl.uniform1i(this.uPaletteId, getPaletteId(options.palette));
    gl.uniform1i(this.uUsePerturb, options.deep ? 1 : 0);
    gl.uniform1i(this.uFunctionId, options.fn.id);
    gl.uniform2f(this.uParam0, options.fn.param0.x, options.fn.param0.y);

    if (options.deep) {
      // Compute reference orbit for perturbation.
      // Orbit.searchMaxEscapeVelocity is assumed to return an object with:
      //   - sx, sy: the starting point for the orbit,
      //   - iters: a Float32Array of length 2*N containing N vec2 orbit points.
      let orbit = undefined;
      switch (options.fn.id) {
        case FN_MANDELBROT:
          orbit = Orbit.searchForMandelbrot(map, w, h, options.maxIter);
          break;
        case FN_JULIA:
          orbit = Orbit.searchForJulia(
            map,
            w,
            h,
            options.maxIter,
            options.fn.param0
          );
          break;
      } // Use the orbit's starting point for the center.
      // Note: y-axis orientation is reversed for WebGL
      gl.uniform3f(this.uCenterZoom, orbit.sx, h - orbit.sy, map.zoom);
      // Create a texture from orbit data.
      const orbitCount = orbit.iters.length / 2;
      const texWidth = 256;
      const texHeight = Math.ceil((0.5 * orbitCount) / texWidth);
      // Prepare a padded array for a RGBA texture.
      const paddedOrbit = new Float32Array(texWidth * texHeight * 4);
      paddedOrbit.set(orbit.iters);

      // Create and bind the orbit texture.
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
      // Set uniform for the orbit texture sampler (texture unit 0).
      const uOrbitTexLocation = gl.getUniformLocation(
        this.webGLProgram,
        "uOrbitTex"
      );
      gl.uniform1i(uOrbitTexLocation, 0);
      // Set uniform for orbit texture size.
      const uOrbitTexSizeLocation = gl.getUniformLocation(
        this.webGLProgram,
        "uOrbitTexSize"
      );
      gl.uniform2f(uOrbitTexSizeLocation, texWidth, texHeight);
      // Set uniform for the orbit count.
      const uOrbitCountLocation = gl.getUniformLocation(
        this.webGLProgram,
        "uOrbitCount"
      );
      gl.uniform1i(uOrbitCountLocation, orbitCount);
    } else {
      const center = COMPLEX_PLANE.complex().project(map.center);
      gl.uniform3f(this.uCenterZoom, center.x, center.y, map.zoom);
    }

    // Clear and draw.
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Copy the bottom left corner
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

    return new RenderResults(this.id(), options);
  }
}

const fragmentShaderSource = `
precision highp float;

// Uniforms
uniform vec2 uResolution;      // (width, height)
uniform vec3 uCenterZoom;      // (centerX, centerY, zoom)
uniform int uMaxIter;          // dynamic max iterations
uniform int uSamples;          // supersampling count
uniform int uPaletteId;        // 0: electric, 1: rainbow, 2: zebra
uniform int uUsePerturb;       // 0: normal, 1: use perturbation

// Orbit data is now provided via a texture:
uniform sampler2D uOrbitTex;   // orbit texture containing vec2 data in .rg
uniform vec2 uOrbitTexSize;    // dimensions (width, height) of the orbit texture
uniform int uOrbitCount;       // number of orbit points stored

uniform int uFunctionId;       // 0: mandelbrot, 1: julia
uniform vec2 uParam0;          // (x, y) coordinate for julia

// Constants
#define MAX_ITER 10000
#define MAX_REF_ORBIT 10000
#define BAILOUT 128.0

// --- Math functions

vec2 complex_square(vec2 c) {
    return vec2(c.x * c.x - c.y * c.y, 2.0 * c.x * c.y);
}

vec2 complex_mul(vec2 c0, vec2 c1) {
    return vec2(c0.x * c1.x - c0.y * c1.y, c0.x * c1.y + c0.y * c1.x);
}

float complex_square_mod(vec2 c) {
    return dot(c, c);
}

// Pseudo-random function based on input vector
float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

// --- Color functions

// Color definitions
const vec3 RED     = vec3(1, 0, 0);
const vec3 YELLOW  = vec3(1, 1, 0);
const vec3 GREEN   = vec3(0, 1, 0);
const vec3 CYAN    = vec3(0, 1, 1);
const vec3 BLUE    = vec3(0, 0, 1);
const vec3 MAGENTA = vec3(1, 0, 1);
const vec3 BLACK   = vec3(0, 0, 0);
const vec3 WHITE   = vec3(1, 1, 1);

// Electric palette: BLUE to WHITE
const vec3 ELECTRIC0 = BLUE;
const vec3 ELECTRIC1 = WHITE;

// Zebra palette: WHITE and BLACK
const vec3 ZEBRA0 = WHITE;
const vec3 ZEBRA1 = BLACK;

// Same color palette as used on the Wikipedia page: https://en.wikipedia.org/wiki/Mandelbrot_set
const vec3 WIKI0 = vec3(  0,   7, 100) / 255.0;
const vec3 WIKI1 = vec3( 32, 107, 203) / 255.0;
const vec3 WIKI2 = vec3(237, 255, 255) / 255.0;
const vec3 WIKI3 = vec3(255, 170,   0) / 255.0;
const vec3 WIKI4 = vec3(  0,   2,   0) / 255.0;

// Helper function for rainbow palette.
vec3 getRainbowColorAtIndex(int index) {
    if (index == 0) return YELLOW;
    else if (index == 1) return GREEN;
    else if (index == 2) return CYAN;
    else if (index == 3) return BLUE;
    else if (index == 4) return MAGENTA;
    else return RED; // index == 5
}

// Interpolates between two rainbow palette colors based on index.
vec3 interpolateRainbowPalette(float index) {
    float len = 6.0;
    float pos = len * index;
    int idx0 = int(mod(pos - 1.0, len));
    int idx1 = int(mod(pos, len));
    return mix(getRainbowColorAtIndex(idx0), getRainbowColorAtIndex(idx1), fract(pos));
}

// Helper function for wikipedia palette.
vec3 getWikipediaColorAtIndex(int index) {
    if (index == 0) return WIKI0;
    else if (index == 1) return WIKI1;
    else if (index == 2) return WIKI2;
    else if (index == 3) return WIKI3;
    else return WIKI4; // index == 4
}

// Interpolates between two wikipedia palette colors based on index.
vec3 interpolateWikipediaPalette(float index) {
    float len = 5.0;
    float pos = len * index;
    int idx0 = int(mod(pos - 1.0, len));
    int idx1 = int(mod(pos, len));
    return mix(getWikipediaColorAtIndex(idx0), getWikipediaColorAtIndex(idx1), fract(pos));
}

vec3 interpolateElectricPalette(float index) {
    float len = 2.0;
    float pos = len * index;
    int idx0 = int(mod(pos - 1.0, len));
    int idx1 = int(mod(pos, len));
    vec3 colorFrom = idx0 == 0 ? ELECTRIC0 : ELECTRIC1;
    vec3 colorTo = idx1 == 0 ? ELECTRIC0 : ELECTRIC1;
    return mix(colorFrom, colorTo, fract(pos));
}

// --- Julia functions

vec3 electricColor(float escapeVelocity) {
    return interpolateElectricPalette(escapeVelocity / 100.0);
}

vec3 rainbowColor(float escapeVelocity) {
    return interpolateRainbowPalette(escapeVelocity / 150.0);
}

vec3 zebraColor(float escapeVelocity) {
    float modIndex = mod(escapeVelocity / 5.0, 1.0);
    return int(modIndex * 2.0) == 0 ? ZEBRA0 : ZEBRA1;
}

vec3 wikipediaColor(float escapeVelocity) {
    return interpolateWikipediaPalette(escapeVelocity / 15.0 + 0.2);
}

// Retrieve an orbit point from the texture.
// The orbit data is packed with 2 points per texel, as one RGBA component. The first point is in RG, and the second in BA.
vec2 getOrbitPoint(int index) {
    // Compute the texel coordinates from the orbit index:
    // texel-x = index / 2 mod width
    // texel-y = index / 2 / width
    float texIndex = float(index / 2);
    vec2 texPos = vec2(mod(texIndex, uOrbitTexSize.x), floor(texIndex / uOrbitTexSize.x));
    // move to center of texel, and normalize coordinates to [0, 1].
    texPos = (texPos + 0.5) / uOrbitTexSize;

    // Retrieve the orbit pair
    vec4 orbit = texture2D(uOrbitTex, texPos);

    // Select the orbit from the pair
    return mod(float(index), 2.0) == 0.0 ? orbit.rg : orbit.ba;
}

// Smoothen the escape velocity to avoid having bands of colors
float smoothEscapeVelocity(int iter, float squareMod) {
  return float(iter) + 1.0 - log(log(squareMod)) / log(2.0);
}

float julia(vec2 z0, vec2 c) {
    vec2 z = z0;
    for (int i = 0; i < MAX_ITER; i++) {
        if (i >= uMaxIter) {
            break;
        }
        // Compute z = z² + c, where z² is computed using complex multiplication.
        z = complex_square(z) + c;

        // If the magnitude of z exceeds 2.0 (|z|² > 4), the point escapes.
        float squareMod = complex_square_mod(z);
        if (squareMod > BAILOUT * BAILOUT) {
            return smoothEscapeVelocity(i, squareMod);
        }
    }
    return float(uMaxIter);
}

float juliaPerturb(vec2 dz0, vec2 dc) {
    // We'll do a loop up to maxIter, reading the reference Xₙ and
    vec2 dz = dz0;
    vec2 z = getOrbitPoint(0);

    for (int i = 0; i < MAX_REF_ORBIT; i++) {
        if (i >= uMaxIter) {
            break;
        }
        // ∆z = (2 z + ∆z) ∆z + ∆c 
        dz = complex_mul(2.0 * z + dz, dz) + dc;
        z = getOrbitPoint(i + 1);

        float squareMod = complex_square_mod(z + dz);
        if (squareMod > BAILOUT * BAILOUT) {
            return smoothEscapeVelocity(i, squareMod);
        }
    }
    return float(uMaxIter);
}

#define ELECTRIC_PALETTE_ID 0
#define RAINBOW_PALETTE_ID 1
#define ZEBRA_PALETTE_ID 2
#define WIKIPEDIA_PALETTE_ID 3

#define FN_MANDELBROT 0
#define FN_JULIA 1

vec3 getColor(float escapeVelocity) {
    if (escapeVelocity >= float(uMaxIter)) {
        return BLACK;
    } else if (uPaletteId == ELECTRIC_PALETTE_ID) {
        return electricColor(escapeVelocity);
    } else if (uPaletteId == RAINBOW_PALETTE_ID) {
        return rainbowColor(escapeVelocity);
    } else if(uPaletteId == ZEBRA_PALETTE_ID) {
        return zebraColor(escapeVelocity);
    } else {
        return wikipediaColor(escapeVelocity);
    }
}

// --- Rendering functions

vec3 renderOne(vec2 fragCoord, vec2 scaleFactor) {
    float escapeVelocity = 0.0;
    if (uUsePerturb == 0) {
        vec2 pos = uCenterZoom.xy + (fragCoord - 0.5 * uResolution) * scaleFactor;
        if (uFunctionId == FN_JULIA) {
            escapeVelocity = julia(pos, uParam0);
        } else {
            escapeVelocity = julia(vec2(0.0), pos);
        }
    } else {
        // let delta = (fragCoord - u.center) * scaleFactor;
        vec2 delta = (fragCoord - uCenterZoom.xy) * scaleFactor;
        if (uFunctionId == FN_JULIA) {
            escapeVelocity = juliaPerturb(delta, vec2(0.0));
        } else {
            escapeVelocity = juliaPerturb(vec2(0.0), delta);
        }
    }

    return getColor(escapeVelocity);
}

vec3 renderSuperSample(vec2 sampleCoord, vec2 scaleFactor, int samples) {
    vec3 color = vec3(0.0);
    // Loop up to a fixed maximum (e.g., 16) samples for supersampling.
    for (int i = 0; i < 16; i++) {
        if (i >= samples) {
            break;
        }
        // Add random jitter in [-0.5, 0.5]
        vec2 jitter = vec2(rand(gl_FragCoord.xy + float(i)), rand(gl_FragCoord.yx + float(i) * 1.3)) - 0.5;
        color += renderOne(sampleCoord + jitter, scaleFactor);
    }
    return color / float(samples);
}

// Main rendering function
void main() {
    // Compute scale factor: 4 / width * exp2(-zoom) and flip Y axis.
    vec2 scaleFactor = (4.0 / uResolution.x) * exp2(-uCenterZoom.z) * vec2(1.0, 1.0);

    // Single sample or supersampling.
    if (uSamples <= 1) {
        gl_FragColor = vec4(renderOne(gl_FragCoord.xy, scaleFactor), 1);
    } else {
        gl_FragColor = vec4(renderSuperSample(gl_FragCoord.xy, scaleFactor, uSamples), 1);
    }
}
`;
