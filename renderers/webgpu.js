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
const WORKGROUP_SIZE = 16;

const UNIFORM_BUFFER_SIZE = 80;

class CachedOrbit {
  constructor() {
    this.orbit = null;
    this.point = null;
    this.fnId = null;
    this.param0 = null;
    this.maxIter = null;
    this.escapeVelocity = null;
  }

  reset() {
    this.orbit = null;
    this.point = null;
    this.fnId = null;
    this.param0 = null;
    this.maxIter = null;
    this.escapeVelocity = null;
  }
}

// Maximum (absolute) exponent we allow for the *local* pixel->complex scale
// in base-2 log. This keeps u.scale comfortably inside f32's normal range.
const MAX_LOCAL_EXPONENT = 80;

const WEBGPU_FRAGMENT_URL = new URL("./webgpu.wgsl", import.meta.url);

async function loadWgslSource(url, constants = {}) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load shader source: ${url}`);
  }
  let source = await response.text();
  for (const [key, value] of Object.entries(constants)) {
    source = source.replaceAll(`{{${key}}}`, String(value));
  }
  return source;
}

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
    this.gpuRenderPipeline = undefined;
    this.gpuComputePipeline = undefined;
    this.gpuUniformBuffer = undefined;
    this.gpuReferenceOrbitBuffer = undefined;
    this.gpuColorTexture = undefined;
    this.gpuColorTextureView = undefined;
    this.gpuColorTextureWidth = 0;
    this.gpuColorTextureHeight = 0;
    this.gpuRenderBindGroupLayout = undefined;
    this.gpuComputeBindGroupLayout = undefined;
    this.gpuRenderBindGroup = undefined;
    this.gpuComputeBindGroup = undefined;
    this.orbitWorker = undefined;
    this.nextOrbitRequestId = 1;
    this.pendingOrbitRequests = new Map();
    this.lastFlops = null;
    this.cachedOrbit = new CachedOrbit();
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

    const fragmentModule = await this.#createShaderModule(
      await loadWgslSource(WEBGPU_FRAGMENT_URL, {
        MAX_ITERATIONS,
        MIN_VARIANCE_SAMPLES,
        SUPER_SAMPLE_VARIANCE,
      })
    );

    this.gpuRenderBindGroupLayout = this.gpuDevice.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.FRAGMENT,
          buffer: { type: "storage" },
        },
        {
          binding: 4,
          visibility: GPUShaderStage.FRAGMENT,
          texture: { sampleType: "float" },
        },
      ],
    });

    this.gpuComputeBindGroupLayout = this.gpuDevice.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 2,
          visibility: GPUShaderStage.COMPUTE,
          buffer: { type: "storage" },
        },
        {
          binding: 3,
          visibility: GPUShaderStage.COMPUTE,
          storageTexture: { access: "write-only", format: "rgba8unorm" },
        },
      ],
    });

    this.gpuRenderPipeline = this.gpuDevice.createRenderPipeline({
      layout: this.gpuDevice.createPipelineLayout({
        bindGroupLayouts: [this.gpuRenderBindGroupLayout],
      }),
      vertex: {
        module: await this.#createShaderModule(wgslVertexShader),
        entryPoint: "main",
      },
      fragment: {
        module: fragmentModule,
        entryPoint: "main",
        targets: [{ format: this.canvasFormat }],
      },
      primitive: {
        topology: "triangle-strip",
        stripIndexFormat: undefined,
      },
    });

    this.gpuComputePipeline = this.gpuDevice.createComputePipeline({
      layout: this.gpuDevice.createPipelineLayout({
        bindGroupLayouts: [this.gpuComputeBindGroupLayout],
      }),
      compute: {
        module: fragmentModule,
        entryPoint: "computeMain",
      },
    });

    // Create a buffer for the uniform data.
    // We'll store the fractal uniforms plus padding for alignment.
    this.gpuUniformBuffer = this.gpuDevice.createBuffer({
      size: UNIFORM_BUFFER_SIZE,
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
      this.#ensureColorTexture(width, height);
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
    if (this.gpuColorTexture) {
      this.gpuColorTexture.destroy();
      this.gpuColorTexture = undefined;
      this.gpuColorTextureView = undefined;
      this.gpuColorTextureWidth = 0;
      this.gpuColorTextureHeight = 0;
    }
    this.cachedOrbit.reset();
  }

  #isOrbitCompatible(maxIter, options) {
    if (!this.cachedOrbit.orbit || !this.cachedOrbit.point) {
      return false;
    }
    if (this.cachedOrbit.maxIter === null || maxIter > this.cachedOrbit.maxIter) {
      return false;
    }
    if (this.cachedOrbit.fnId !== options.fn.id) {
      return false;
    }
    if (options.fn.id === FN_JULIA) {
      const param = COMPLEX_PLANE.complex().project(options.fn.param0);
      const cached = this.cachedOrbit.param0;
      if (!cached) {
        return false;
      }
      const dx = Math.abs(param.x - cached.x);
      const dy = Math.abs(param.y - cached.y);
      if (dx > 1e-12 || dy > 1e-12) {
        return false;
      }
    }
    return true;
  }

  #getCachedOrbit(map, width, height, maxIter, options) {
    if (!this.#isOrbitCompatible(maxIter, options)) {
      return null;
    }
    const screen = map.complexToScreen(this.cachedOrbit.point, width, height);
    if (
      screen.sx < 0 ||
      screen.sy < 0 ||
      screen.sx > width ||
      screen.sy > height
    ) {
      return null;
    }
    return {
      orbit: this.cachedOrbit.orbit,
      point: this.cachedOrbit.point,
      screen,
      escapeVelocity: this.cachedOrbit.escapeVelocity,
    };
  }

  #storeCachedOrbit(orbit, point, maxIter, options) {
    this.cachedOrbit.orbit = orbit;
    this.cachedOrbit.point = point;
    this.cachedOrbit.maxIter = maxIter;
    this.cachedOrbit.fnId = options.fn.id;
    this.cachedOrbit.param0 = COMPLEX_PLANE.complex().project(options.fn.param0);
    this.cachedOrbit.escapeVelocity = orbit?.escapeVelocity ?? null;
  }

  #isOrbitInSet(escapeVelocity, maxIter) {
    return (
      escapeVelocity !== null &&
      escapeVelocity !== undefined &&
      escapeVelocity >= maxIter
    );
  }

  #resolveCachedOrbit(map, width, height, maxIter, options) {
    const cached = this.#getCachedOrbit(map, width, height, maxIter, options);
    if (!cached) {
      return null;
    }
    return {
      orbit: cached.orbit,
      orbitPoint: cached.point,
      orbitScreen: cached.screen,
      orbitEscapeVelocity: cached.escapeVelocity,
      inSet: this.#isOrbitInSet(cached.escapeVelocity, maxIter),
    };
  }

  async #resolveOrbitSelection(map, width, height, maxIter, orbitMaxIter, options) {
    const cached = this.#resolveCachedOrbit(map, width, height, maxIter, options);
    if (cached?.inSet) {
      return cached;
    }

    const nextOrbit = await this.#computeOrbit(
      map,
      width,
      height,
      orbitMaxIter,
      options
    );
    if (!nextOrbit) {
      return cached;
    }

    const nextEscape = nextOrbit.escapeVelocity ?? null;
    const nextPoint = map.screenToComplex(nextOrbit.sx, nextOrbit.sy, width, height);
    const nextInSet = this.#isOrbitInSet(nextEscape, maxIter);

    if (nextInSet) {
      this.#storeCachedOrbit(nextOrbit, nextPoint, orbitMaxIter, options);
      return {
        orbit: nextOrbit,
        orbitPoint: nextPoint,
        orbitScreen: { sx: nextOrbit.sx, sy: nextOrbit.sy },
        orbitEscapeVelocity: nextEscape,
        inSet: true,
      };
    }

    if (
      cached &&
      cached.orbitEscapeVelocity !== null &&
      cached.orbitEscapeVelocity !== undefined &&
      nextEscape !== null &&
      nextEscape !== undefined &&
      cached.orbitEscapeVelocity >= nextEscape
    ) {
      return cached;
    }

    this.#storeCachedOrbit(nextOrbit, nextPoint, orbitMaxIter, options);
    return {
      orbit: nextOrbit,
      orbitPoint: nextPoint,
      orbitScreen: { sx: nextOrbit.sx, sy: nextOrbit.sy },
      orbitEscapeVelocity: nextEscape,
      inSet: false,
    };
  }

  async render(map, options) {
    const maxIter = Math.min(options.maxIter, MAX_ITERATIONS);
    const orbitMaxIter = Math.min(
      MAX_ITERATIONS,
      Math.max(maxIter, Math.ceil(maxIter * 1.2))
    );

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
    let orbitPoint = undefined;
    let orbitScreen = undefined;
    let orbitEscapeVelocity = null;
    if (options.deep) {
      const selection = await this.#resolveOrbitSelection(
        map,
        w,
        h,
        maxIter,
        orbitMaxIter,
        options
      );
      if (selection) {
        orbit = selection.orbit;
        orbitPoint = selection.orbitPoint;
        orbitScreen = selection.orbitScreen;
        orbitEscapeVelocity = selection.orbitEscapeVelocity;
      }
    }
    const maxSuperSamples = Math.max(
      1,
      Math.floor(options.maxSuperSamples ?? DEFAULT_MAX_SUPER_SAMPLES)
    );

    const usePrecomputed = true;

    // NOTE: now 80 bytes instead of 64
    const uniformArray = new ArrayBuffer(UNIFORM_BUFFER_SIZE);
    const dataView = new DataView(uniformArray);
    const mapCenter = COMPLEX_PLANE.complex().project(map.center);
    const fnParam0 = COMPLEX_PLANE.complex().project(options.fn.param0);

    dataView.setUint32(0, options.deep ? 1 : 0, true); // usePerturbation
    dataView.setFloat32(4, map.zoom, true); // zoom
    dataView.setFloat32(
      8,
      orbit ? orbitScreen.sx : mapCenter.x,
      true
    ); // center
    dataView.setFloat32(
      12,
      orbit ? orbitScreen.sy : mapCenter.y,
      true
    ); // center
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
    dataView.setUint32(44, options.normalMap === false ? 0 : 1, true); // useNormalMap
    dataView.setFloat32(48, fnParam0.x, true); // param0
    dataView.setFloat32(52, fnParam0.y, true); // param0
    dataView.setFloat32(56, gpuScale, true); // scale
    dataView.setFloat32(60, perturbScale, true); // perturbScale
    dataView.setUint32(64, usePrecomputed ? 1 : 0, true); // usePrecomputed

    this.gpuDevice.queue.writeBuffer(this.gpuUniformBuffer, 0, uniformArray);

    if (orbit) {
      this.gpuDevice.queue.writeBuffer(
        this.gpuReferenceOrbitBuffer,
        0,
        orbit.iters
      );
    }

    this.#ensureColorTexture(w, h);

    // Acquire a texture to render into
    const renderView = this.gpuContext.getCurrentTexture().createView();

    // Build the command pass
    const commandEncoder = this.gpuDevice.createCommandEncoder();
    if (usePrecomputed) {
      this.#resetIterationCounter();
      const computePass = commandEncoder.beginComputePass();
      computePass.setPipeline(this.gpuComputePipeline);
      computePass.setBindGroup(0, this.gpuComputeBindGroup);
      const groupsX = Math.ceil(w / WORKGROUP_SIZE);
      const groupsY = Math.ceil(h / WORKGROUP_SIZE);
      computePass.dispatchWorkgroups(groupsX, groupsY);
      computePass.end();
    } else {
      this.#resetIterationCounter();
    }

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

    passEncoder.setPipeline(this.gpuRenderPipeline);
    passEncoder.setBindGroup(0, this.gpuRenderBindGroup);
    passEncoder.setViewport(0, 0, w, h, 0, 1);
    passEncoder.setScissorRect(0, 0, w, h);
    passEncoder.draw(4, 1, 0, 0);
    passEncoder.end();

    const gpuCommands = commandEncoder.finish();
    this.gpuDevice.queue.submit([gpuCommands]);

    // Don't await GPU completion here; let the main loop stay smooth.
    this.#captureIterations().catch(() => {});

    const result = new RenderResults(this.id(), options, this.lastFlops);
    if (orbit && orbitScreen && orbitPoint) {
      result.orbitMarker = {
        point: orbitPoint,
        inSet: this.#isOrbitInSet(orbitEscapeVelocity, maxIter),
      };
    } else {
      result.orbitMarker = null;
    }
    return result;
  }

  #ensureColorTexture(width, height) {
    if (
      this.gpuColorTexture &&
      this.gpuColorTextureWidth === width &&
      this.gpuColorTextureHeight === height
    ) {
      return;
    }

    if (this.gpuColorTexture) {
      this.gpuColorTexture.destroy();
    }

    this.gpuColorTexture = this.gpuDevice.createTexture({
      size: [width, height, 1],
      format: "rgba8unorm",
      usage:
        GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.gpuColorTextureView = this.gpuColorTexture.createView();
    this.gpuColorTextureWidth = width;
    this.gpuColorTextureHeight = height;

    this.gpuComputeBindGroup = this.gpuDevice.createBindGroup({
      layout: this.gpuComputeBindGroupLayout,
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
        { binding: 3, resource: this.gpuColorTextureView },
      ],
    });

    this.gpuRenderBindGroup = this.gpuDevice.createBindGroup({
      layout: this.gpuRenderBindGroupLayout,
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
        { binding: 4, resource: this.gpuColorTextureView },
      ],
    });
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
