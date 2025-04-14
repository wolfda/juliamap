import { getMapState } from "../map.js";
import { getPaletteId } from "../state.js";
import { getCpuCount } from "./capabilities.js";
import { Renderer, RenderingEngine } from "./renderer.js"


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

    detach() {
    }

    render(options) {
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

            const mapState = getMapState();
            const workerData = {
                width: w,
                height: h,
                centerX: mapState.x,
                centerY: mapState.y,
                zoom: mapState.zoom,
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
                console.error("Worker error:", e.message, "at", e.filename, "line", e.lineno);
            };

            // Start the worker
            worker.postMessage(workerData);
        }
    }
}

// /** 
//  * Try to detect the number of CPU cores
//  * Fallback to 4 if `navigator.hardwareConcurrency` is unavailable
//  */
// function getConcurrency() {
//     return navigator.hardwareConcurrency || 4;
// }

// export function renderFractalCPU(pixelDensity = 1, maxIter = 500, palette = Palette.ELECTRIC, fn = DEFAULT_FN) {
//     terminateWorkers(); // Just to be safe, kill old workers

//     const scale = Math.min(pixelDensity, 1);
//     const w = Math.floor(canvas.width * scale);
//     const h = Math.floor(canvas.height * scale);

//     const concurrency = getConcurrency();

//     // We'll create an offscreen canvas to combine partial results
//     const offscreenCanvas = document.createElement("canvas");
//     offscreenCanvas.width = w;
//     offscreenCanvas.height = h;
//     const offscreenCtx = offscreenCanvas.getContext("2d");

//     // This is the final image data that we'll populate from each worker chunk
//     const finalImageData = offscreenCtx.createImageData(w, h);

//     // We'll accumulate total iterations from each chunk
//     let totalIterationsAll = 0;
//     // Track how many workers have finished
//     let finishedWorkers = 0;

//     // Create a chunk of rows for each worker
//     // e.g. chunkHeight = h / concurrency
//     const chunkHeight = Math.ceil(h / concurrency);

//     for (let i = 0; i < concurrency; i++) {
//         const startY = i * chunkHeight;
//         const endY = Math.min(startY + chunkHeight, h);

//         // If `startY >= endY`, we skip creating a worker
//         if (startY >= endY) break;

//         const mapState = getMapState();
//         const workerData = {
//             width: w,
//             height: h,
//             centerX: mapState.x,
//             centerY: mapState.y,
//             zoom: mapState.zoom,
//             startY,
//             endY,
//             maxIter,
//             paletteId: getPaletteId(palette),
//             functionId: fn.id,
//             param0: fn.param0,
//         };

//         const worker = new Worker("cpu-worker.js", { type: "module" });
//         currentWorkers.push(worker);

//         worker.onmessage = (e) => {
//             const {
//                 imageDataArray,
//                 totalIterations,
//                 startY: sy,
//                 endY: ey,
//             } = e.data;

//             // Add this chunk's iterations to global sum
//             totalIterationsAll += totalIterations;

//             // Write this worker's chunk (sy .. ey) into our finalImageData
//             finalImageData.data.set(
//                 imageDataArray,
//                 sy * w * 4 // offset in the final array
//             );

//             finishedWorkers++;
//             worker.terminate(); // done with this worker

//             // When all workers finish, draw final image to visible canvas
//             if (finishedWorkers === currentWorkers.length) {
//                 offscreenCtx.putImageData(finalImageData, 0, 0);

//                 // Blit onto the main canvas
//                 ctx.save();
//                 ctx.scale(1 / scale, 1 / scale);
//                 ctx.drawImage(offscreenCanvas, 0, 0);
//                 ctx.restore();

//                 // FLOP estimate: totalIterations * 6
//                 const flop = totalIterationsAll * 6;
//             }
//         };

//         worker.onerror = (e) => {
//             console.error("Worker error:", e.message, "at", e.filename, "line", e.lineno);
//         };

//         // Start the worker
//         worker.postMessage(workerData);
//     }
// }
