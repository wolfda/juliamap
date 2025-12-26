import { getPaletteId, getPaletteInterpolationId } from "../core/palette.js";
import { COMPLEX_PLANE } from "../math/complex.js";
import { FN_JULIA, FN_MANDELBROT, Orbit } from "../math/julia.js";
import { getCpuCount } from "./capabilities.js";
import { RenderResults, Renderer, RenderingEngine } from "./renderer.js";

const DEFAULT_MAX_SUPER_SAMPLES = 64;

function getOrbitCount(iters) {
  return iters ? iters.length / 2 : 0;
}

export class CpuRenderer extends Renderer {
  static create(canvas, ctx) {
    return new CpuRenderer(canvas, ctx);
  }

  constructor(canvas, ctx) {
    super();
    this.canvas = canvas;
    this.ctx = ctx;
    this.currentWorkers = [];
    this.renderRunning = false;
    this.pendingRequest = null;
    this.cpuCount = getCpuCount();
    this.orbitWorker = null;
    this.nextOrbitRequestId = 1;
    this.pendingOrbitRequests = new Map();
    this.offscreenCanvas = document.createElement("canvas");
    this.offscreenCanvas.width = canvas.width;
    this.offscreenCanvas.height = canvas.height;
    this.offscreenCtx = this.offscreenCanvas.getContext("2d");

    this.#initOrbitWorker();
  }

  id() {
    return RenderingEngine.CPU;
  }

  terminateWorkers() {
    this.currentWorkers.forEach((w) => w.terminate());
    this.currentWorkers = [];
  }

  detach() {
    if (this.orbitWorker) {
      this.orbitWorker.terminate();
      this.orbitWorker = null;
      this.pendingOrbitRequests.clear();
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
      this.orbitWorker = null;
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
    const request = {
      map,
      center: map.center.clone(),
      zoom: map.zoom,
      options,
    };

    if (this.renderRunning) {
      // Replace any pending request with the latest map state
      this.pendingRequest = { map, options };
      return new RenderResults(this.id(), options);
    }

    this.renderRunning = true;
    let result = await this.#renderInternal(request);
    this.renderRunning = false;

    if (this.pendingRequest) {
      const next = this.pendingRequest;
      this.pendingRequest = null;
      // Kick off the queued render, but don't await it here
      this.render(next.map, next.options);
    }

    return result;
  }

  async #renderInternal({ map, center, zoom, options }) {
    this.terminateWorkers();

    const scale = 1;
    const w = this.canvas.width;
    const h = this.canvas.height;

    const finalImageData = this.offscreenCtx.createImageData(w, h);
    let finishedWorkers = 0;

    const chunkHeight = Math.ceil(h / this.cpuCount);
    let orbit = null;
    let orbitCount = 0;
    if (options.deep) {
      orbit = await this.#computeOrbit(map, w, h, options.maxIter, options);
      orbitCount = getOrbitCount(orbit?.iters);
    }

    return await new Promise((resolve) => {
      for (let i = 0; i < this.cpuCount; i++) {
        const startY = i * chunkHeight;
        const endY = Math.min(startY + chunkHeight, h);
        if (startY >= endY) {
          break;
        }

        const maxSuperSamples = Math.max(
          1,
          Math.floor(options.maxSuperSamples ?? DEFAULT_MAX_SUPER_SAMPLES)
        );
        const workerData = {
          width: w,
          height: h,
          center,
          centerExponent: center.plane?.exponent,
          zoom,
          startY,
          endY,
          maxIter: options.maxIter,
          paletteId: getPaletteId(options.palette),
          paletteInterpolationId: getPaletteInterpolationId(
            options.paletteInterpolation
          ),
          maxSuperSamples,
          functionId: options.fn.id,
          param0: options.fn.param0,
          param0Exponent: options.fn.param0.plane?.exponent,
          deep: options.deep === true,
          orbit: orbit
            ? { sx: orbit.sx, sy: orbit.sy, iters: orbit.iters, count: orbitCount }
            : null,
        };

        const worker = new Worker("/renderers/cpu-worker.js", {
          type: "module",
        });
        this.currentWorkers.push(worker);

        worker.onmessage = (e) => {
          if (e.data.error) {
            console.error("Worker explicit error:", e.data.error);
            console.error(e.data.stack);
            worker.terminate();
            return;
          }

          const { imageDataArray, startY: sy } = e.data;

          finalImageData.data.set(imageDataArray, sy * w * 4);

          finishedWorkers++;
          worker.terminate();

          if (finishedWorkers === this.currentWorkers.length) {
            this.offscreenCtx.putImageData(finalImageData, 0, 0);
            this.ctx.save();
            this.ctx.scale(1 / scale, 1 / scale);
            this.ctx.drawImage(this.offscreenCanvas, 0, 0);
            this.ctx.restore();
            this.currentWorkers = [];
            resolve(new RenderResults(this.id(), options));
          }
        };

        worker.onerror = (e) => {
          console.error(
            "Worker error:",
            e.message,
            "at",
            e.filename,
            "line",
            e.lineno
          );
        };

        worker.postMessage(workerData);
      }
    });
  }

  resize(width, height) {
    this.offscreenCanvas.width = width;
    this.offscreenCanvas.height = height;
  }
}
