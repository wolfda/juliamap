import { canvas, ctx, has_webgpu, state } from "./state.js";

// Workers so we can terminate if user starts a new move
let currentWorkers = [];

export function terminateWorkers() {
    // Stop any existing workers
    currentWorkers.forEach((w) => w.terminate());
    currentWorkers = [];
}

/**
 * CPU rendering with a Worker
 * We'll measure iteration count => compute FLOP => update gauge
 */
export function renderFractalCPU(scale = 1) {    
    // Offscreen render, then blit
    const w = Math.floor(canvas.width * scale);
    const h = Math.floor(canvas.height * scale);

    const workerData = {
        width: w,
        height: h,
        centerX: state.x,
        centerY: state.y,
        zoom: state.zoom,
    };

    const worker = new Worker('cpu-worker.js');
    currentWorkers.push(worker);

    worker.onmessage = (e) => {
        const { width, height, imageDataArray, totalIterations } = e.data;

        // Create an offscreen canvas
        const offscreenCanvas = document.createElement('canvas');
        offscreenCanvas.width = width;
        offscreenCanvas.height = height;
        const offscreenCtx = offscreenCanvas.getContext('2d');

        // Populate image data
        const imageData = offscreenCtx.createImageData(width, height);
        imageData.data.set(imageDataArray);
        offscreenCtx.putImageData(imageData, 0, 0);

        // Draw it onto the main canvas, scaled
        ctx.save();
        ctx.scale(1 / scale, 1 / scale);
        ctx.drawImage(offscreenCanvas, 0, 0);
        ctx.restore();

        // FLOP estimate
        const flop = totalIterations * 6;
        updateFlopStats(flop);
    };

    worker.postMessage(workerData);
}

/**
 * Update the FLOP stats overlay
 */
function updateFlopStats(flop) {
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
    const platform = has_webgpu() ? "webgpu" : "webgl";

    el.innerHTML = `${platform} - ${flopStr}FLOP`;
}
