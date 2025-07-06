import { getPaletteId } from "../palette.js";
import { getCpuCount } from "./capabilities.js";
import { RenderResults, Renderer, RenderingEngine } from "./renderer.js";

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
    this.offscreenCanvas = document.createElement("canvas");
    this.offscreenCtx = this.offscreenCanvas.getContext("2d");
  }

  id() {
    return RenderingEngine.CPU;
  }

  terminateWorkers() {
    this.currentWorkers.forEach((w) => w.terminate());
    this.currentWorkers = [];
  }

  detach() {}

  async render(map, options) {
    const request = {
      center: map.center.clone(),
      zoom: map.zoom,
      options,
    };

    if (this.renderRunning) {
      // Replace any pending request with the latest map state
      this.pendingRequest = request;
      return new RenderResults(this.id(), options);
    }

    this.renderRunning = true;
    let result = await this.#renderInternal(request);
    this.renderRunning = false;

    if (this.pendingRequest) {
      const next = this.pendingRequest;
      this.pendingRequest = null;
      // Kick off the queued render, but don't await it here
      this.render(next, next.options);
    }

    return result;
  }

  async #renderInternal({ center, zoom, options }) {
    this.terminateWorkers();

    const scale = Math.min(options.pixelDensity, 1);
    const w = Math.floor(this.canvas.width * scale);
    const h = Math.floor(this.canvas.height * scale);

    this.offscreenCanvas.width = w;
    this.offscreenCanvas.height = h;

    const finalImageData = this.offscreenCtx.createImageData(w, h);
    let finishedWorkers = 0;

    const chunkHeight = Math.ceil(h / this.cpuCount);

    return await new Promise((resolve) => {
      for (let i = 0; i < this.cpuCount; i++) {
        const startY = i * chunkHeight;
        const endY = Math.min(startY + chunkHeight, h);
        if (startY >= endY) {
          break;
        }

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
          functionId: options.fn.id,
          param0: options.fn.param0,
          param0Exponent: options.fn.param0.plane?.exponent,
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
}
