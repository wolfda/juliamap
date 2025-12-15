import { COMPLEX_PLANE } from "../math/complex.js";
import { Orbit, FN_MANDELBROT, FN_JULIA } from "../math/julia.js";
import { getPaletteId } from "../core/palette.js";
import { hasWebgpu } from "./capabilities.js";
import { Renderer, RenderingEngine, RenderResults } from "./renderer.js";

const MAX_ITERATIONS = 10000; // can increase for deeper zoom if desired
const FLOP_PER_ITER = 9;

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
    // We'll store centerX, centerY, scale, plus some padding, plus resolution as f32x2.
    this.gpuUniformBuffer = this.gpuDevice.createBuffer({
      size: 56, // was 48; we add 2 more f32s (scale, perturbScale)
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
    const samples = Math.floor(Math.max(options.pixelDensity, 1));

    // NOTE: now 56 bytes instead of 48
    const uniformArray = new ArrayBuffer(56);
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
    dataView.setUint32(28, samples, true); // samples
    dataView.setUint32(32, getPaletteId(options.palette), true); // paletteId
    dataView.setUint32(36, options.fn.id, true); // functionId
    dataView.setFloat32(40, fnParam0.x, true); // param0
    dataView.setFloat32(44, fnParam0.y, true); // param0
    dataView.setFloat32(48, gpuScale, true);      // scale
    dataView.setFloat32(52, perturbScale, true);  // perturbScale

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
    this.gpuDevice.queue.onSubmittedWorkDone().catch(() => {});

    return new RenderResults(this.id(), options, null);
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

    const totalIterations = (BigInt(high) << BigInt(32)) | BigInt(low);
    return Number(totalIterations);
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
    samples        : u32,
    paletteId      : u32,
    functionId     : u32,
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
    // Convert the new seed to a float in the [0, 1) range.
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

const ELECTRIC = array<vec3f, 2>(BLUE, WHITE);
const RAINBOW = array<vec3f, 6>(YELLOW, GREEN, CYAN, BLUE, MAGENTA, RED);
const ZEBRA = array<vec3f, 2>(WHITE, BLACK);

// Same color palette as used on the Wikipedia page: https://en.wikipedia.org/wiki/Mandelbrot_set
const WIKI0 = vec3f(  0,   7, 100) / 255.0;
const WIKI1 = vec3f( 32, 107, 203) / 255.0;
const WIKI2 = vec3f(237, 255, 255) / 255.0;
const WIKI3 = vec3f(255, 170,   0) / 255.0;
const WIKI4 = vec3f(  0,   2,   0) / 255.0;
const WIKIPEDIA = array<vec3f, 5>(WIKI0, WIKI1, WIKI2, WIKI3, WIKI4);

fn interpolatePalette6Color(palette: array<vec3f, 6>, index: f32) -> vec3f {
    let len = 6.0;
    let c0 = palette[u32(fmod(len * index - 1, len))];
    let c1 = palette[u32(fmod(len * index, len))];
    let t = fmod(len * index, 1);
    return c0 + t * (c1 - c0);
}

fn interpolatePalette5Color(palette: array<vec3f, 5>, index: f32) -> vec3f {
    let len = 5.0;
    let c0 = palette[u32(fmod(len * index - 1, len))];
    let c1 = palette[u32(fmod(len * index, len))];
    let t = fmod(len * index, 1);
    return c0 + t * (c1 - c0);
}

fn interpolatePalette2Color(palette: array<vec3f, 2>, index: f32) -> vec3f {
    let len = 2.0;
    let c0 = palette[u32(fmod(len * index - 1, len))];
    let c1 = palette[u32(fmod(len * index, len))];
    let t = fmod(len * index, 1);
    return c0 + t * (c1 - c0);
}

fn getPalette6Color(palette: array<vec3f, 6>, index: f32) -> vec3f {
    return palette[u32(fmod(index, 1) * 6)];
}

fn getPalette2Color(palette: array<vec3f, 2>, index: f32) -> vec3f {
    return palette[u32(fmod(index, 1) * 2)];
}

// --- Julia functions

fn rainbowColor(escapeVelocity: f32) -> vec3f {
    return interpolatePalette6Color(RAINBOW, escapeVelocity / 150);
}

fn electricColor(escapeVelocity: f32) -> vec3f {
    return interpolatePalette2Color(ELECTRIC, escapeVelocity / 100);
}

fn zebraColor(escapeVelocity: f32) -> vec3f {
    return getPalette2Color(ZEBRA, escapeVelocity / 5);
}

fn wikipediaColor(escapeVelocity: f32) -> vec3f {
    return interpolatePalette5Color(WIKIPEDIA, escapeVelocity / 15 + 0.2);
}

const ELECTRIC_PALETTE_ID = 0u;
const RAINBOW_PALETTE_ID = 1u;
const ZEBRA_PALETTE_ID = 2u;
const WIKIPEDIA_PALETTE_ID = 3u;

fn getColor(escapeVelocity: f32) -> vec3f {
    // if (escapeVelocity < 0.0) {
    //     return vec3f(1.0, 0.0, 1.0); // Magenta for NaN/infinity
    // }
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

// Smoothen the escape velocity to avoid having bands of colors
fn smoothEscapeVelocity(iter: u32, squareMod: f32) -> f32 {
    // squareMod may have overflowed, return iter
    if (!isFinite(squareMod)) {
        return f32(iter);
    }
    return f32(iter) + 1 - log2(log(squareMod));
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

fn renderSuperSample(fragCoord: vec2f, scaleFactor: vec2f, samples: u32) -> vec3f {
    var color = vec3f(0);
    for (var i = 0u; i < samples; i += 1u) {
        // Add a random jitter in [-0.5, 0.5] to compute the value of the next sample.
        let jitter = vec2f(rand() - 0.5, rand() - 0.5);
        color += renderOne(fragCoord + jitter, scaleFactor);
    }

    return color / f32(samples);
}

@fragment
fn main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
    // Per-pixel scale in the complex plane (already rescaled on the CPU).
    let scaleFactor = u.scale * vec2f(1.0, -1.0);

    if (u.samples == 1u) {
        return vec4f(renderOne(fragCoord.xy, scaleFactor), 1.0);
    } else {
        return vec4f(renderSuperSample(fragCoord.xy, scaleFactor, u.samples), 1.0);
    }
}
`;
