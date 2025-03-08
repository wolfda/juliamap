import { getMapState } from "./map.js";
import { canvas, ctx } from "./state.js";

// Workers so we can terminate if user starts a new move
let currentWorkers = [];

export function terminateWorkers() {
    // Stop any existing workers
    currentWorkers.forEach((w) => w.terminate());
    currentWorkers = [];
}

/** 
 * Try to detect the number of CPU cores
 * Fallback to 4 if `navigator.hardwareConcurrency` is unavailable
 */
function getConcurrency() {
    return navigator.hardwareConcurrency || 4;
}

export function renderFractalCPU(pixelDensity = 1) {
    terminateWorkers(); // Just to be safe, kill old workers

    const scale = Math.min(pixelDensity, 1);
    const w = Math.floor(canvas.width * scale);
    const h = Math.floor(canvas.height * scale);

    const concurrency = getConcurrency();

    // We'll create an offscreen canvas to combine partial results
    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = w;
    offscreenCanvas.height = h;
    const offscreenCtx = offscreenCanvas.getContext("2d");

    // This is the final image data that we'll populate from each worker chunk
    const finalImageData = offscreenCtx.createImageData(w, h);

    // We'll accumulate total iterations from each chunk
    let totalIterationsAll = 0;
    // Track how many workers have finished
    let finishedWorkers = 0;

    // Create a chunk of rows for each worker
    // e.g. chunkHeight = h / concurrency
    const chunkHeight = Math.ceil(h / concurrency);

    for (let i = 0; i < concurrency; i++) {
        const startY = i * chunkHeight;
        const endY = Math.min(startY + chunkHeight, h);

        // If `startY >= endY`, we skip creating a worker
        if (startY >= endY) break;

        const mapState = getMapState();
        const workerData = {
            width: w,
            height: h,
            centerX: mapState.x,
            centerY: mapState.y,
            zoom: mapState.zoom,
            startY,
            endY,
        };

        const worker = new Worker("cpu-worker.js", { type: "module" });
        currentWorkers.push(worker);

        worker.onmessage = (e) => {
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
            if (finishedWorkers === currentWorkers.length) {
                offscreenCtx.putImageData(finalImageData, 0, 0);

                // Blit onto the main canvas
                ctx.save();
                ctx.scale(1 / scale, 1 / scale);
                ctx.drawImage(offscreenCanvas, 0, 0);
                ctx.restore();

                // FLOP estimate: totalIterations * 6
                const flop = totalIterationsAll * 6;
            }
        };

        worker.onerror = (e) => {
            console.error("Worker error:", e.message, "at", e.filename, "line", e.lineno);
        };

        // Start the worker
        worker.postMessage(workerData);
    }
}
