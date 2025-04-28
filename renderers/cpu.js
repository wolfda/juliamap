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

  render(map, options) {
    this.terminateWorkers();

    const scale = Math.min(options.pixelDensity, 1);
    const w = Math.floor(this.canvas.width * scale);
    const h = Math.floor(this.canvas.height * scale);

    // We'll create an offscreen canvas to combine partial results
    this.offscreenCanvas.width = w;
    this.offscreenCanvas.height = h;

    // This is the final image data that we'll populate from each worker chunk
    const finalImageData = this.offscreenCtx.createImageData(w, h);

    // We'll accumulate total iterations from each chunk
    let totalIterationsAll = 0;
    // Track how many workers have finished
    let finishedWorkers = 0;

    // Create a chunk of rows for each worker
    // e.g. chunkHeight = h / concurrency
    const chunkHeight = Math.ceil(h / this.cpuCount);

    for (let i = 0; i < this.cpuCount; i++) {
      const startY = i * chunkHeight;
      const endY = Math.min(startY + chunkHeight, h);

      // If `startY >= endY`, we skip creating a worker
      if (startY >= endY) {
        break;
      }

      const workerData = {
        width: w,
        height: h,
        center: map.center,
        zoom: map.zoom,
        startY,
        endY,
        maxIter: options.maxIter,
        paletteId: getPaletteId(options.palette),
        functionId: options.fn.id,
        param0: options.fn.param0,
      };

      const worker = new Worker("/renderers/cpu-worker.js", { type: "module" });
      this.currentWorkers.push(worker);

      worker.onmessage = (e) => {
        if (e.data.error) {
          console.error("Worker explicit error:", e.data.error);
          console.error(e.data.stack);
          worker.terminate();
          return;
        }

        const {
          imageDataArray,
          totalIterations,
          startY: sy,
          endY: ey,
        } = e.data;

        // Add this chunk's iterations to global sum
        totalIterationsAll += totalIterations;

        // Write this worker's chunk (sy .. ey) into our finalImageData
        finalImageData.data.set(
          imageDataArray,
          sy * w * 4 // offset in the final array
        );

        finishedWorkers++;
        worker.terminate(); // done with this worker

        // When all workers finish, draw final image to visible canvas
        if (finishedWorkers === this.currentWorkers.length) {
          this.offscreenCtx.putImageData(finalImageData, 0, 0);

          // Blit onto the main canvas
          this.ctx.save();
          this.ctx.scale(1 / scale, 1 / scale);
          this.ctx.drawImage(this.offscreenCanvas, 0, 0);
          this.ctx.restore();
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

      // Start the worker
      worker.postMessage(workerData);
    }
    return new RenderResults(this.id(), options);
  }
}
