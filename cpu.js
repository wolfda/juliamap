import { canvas, ctx, getRenderingEngine, state } from "./state.js";

// Workers so we can terminate if user starts a new move
let currentWorkers = [];

export function terminateWorkers() {
    // Stop any existing workers
    currentWorkers.forEach((w) => w.terminate());
    currentWorkers = [];
}

export function renderFractalCPU(scale = 1) {
    terminateWorkers(); // Just to be safe, kill old workers

    const w = Math.floor(canvas.width * scale);
    const h = Math.floor(canvas.height * scale);

    // Try to detect the number of CPU cores
    // Fallback to 4 if `navigator.hardwareConcurrency` is unavailable
    const concurrency = navigator.hardwareConcurrency || 4;

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

        const workerData = {
            width: w,
            height: h,
            centerX: state.x,
            centerY: state.y,
            zoom: state.zoom,
            startY,
            endY,
        };

        const worker = new Worker("cpu-worker.js");
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
                updateFlopStats(flop, getRenderingEngine());
            }
        };

        // Start the worker
        worker.postMessage(workerData);
    }
}

/**
 * Update the FLOP stats overlay
 */
function updateFlopStats(flop, renderingEngine) {
    const el = document.getElementById('flopStats');
    if (!el) return;

    // Format big numbers => G, M, K, etc.
    const formatNumber = (val) => {
        if (val > 1e12) return (val / 1e12).toFixed(2) + ' T';
        if (val > 1e9) return (val / 1e9).toFixed(2) + ' G';
        if (val > 1e6) return (val / 1e6).toFixed(2) + ' M';
        if (val > 1e3) return (val / 1e3).toFixed(2) + ' K';
        return val.toFixed(2);
    };

    const flopStr = formatNumber(flop);

    el.innerHTML = `${renderingEngine} - ${flopStr}FLOP`;
}
