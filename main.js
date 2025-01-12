// --------------------------------------
// Code generated by ChatGPT model o1 pro
// --------------------------------------

/**
 * Implements:
 * 1. Setting up the canvas to display Mandelbrot (and eventually Julia sets if extended).
 * 2. Handling user interactions (pan, zoom) for both mouse and touch.
 * 3. Maintaining and updating URL to reflect x, y, zoom level.
 * 4. Using Web Workers to compute fractal images (CPU).
 * 5. Doing an initial, coarse (1/8 resolution) preview in WebGL, then refining via CPU.
 */

import { initWebGL, renderFractalWebGL } from "./webgl.js";
import { canvas, hasWebgpu, RenderingEngine, setWebgpu, useRenderingEngine } from "./state.js";
import { initWebGPU, renderFractalWebGPU } from "./webgpu.js";
import { renderFractalCPU, terminateWorkers } from "./cpu.js";

// --- New Imports from map.js (in your refactor) ---
import {
    moveTo,
    move,
    scaleBy,
    scaleTo,
    stop,
    animate,
    getMapState
} from "./map.js";

const MAX_GPU_SCALE = 1 << 18;
const BITS_PER_DECIMAL = Math.log10(2);

// Keep track of pointer state during panning
let isDragging = false;
let lastMousePos = { x: 0, y: 0 };

// For touch gestures
let activeTouches = [];
let initialDistance = 0;
// let initialScale = state.scale;

// Debounce/timer for final hi-res render
let renderTimeoutId = null;

// Device pixel ratio for crisp rendering on high-DPI
const dpr = window.devicePixelRatio || 1;

/**
 * On DOMContentLoaded, read URL state, resize canvas, attach events,
 * init GPU or WebGL, and do an initial render.
 */
window.addEventListener('DOMContentLoaded', async () => {
    readStateFromURL();
    resizeCanvas();
    attachEventListeners();

    const webgpuAvailable = await initWebGPU();
    setWebgpu(webgpuAvailable);
    if (!webgpuAvailable) {
        console.warn("webgpu not available, falling back to webgl");
        initWebGL();
    }

    // Initial render: do a partial render, then schedule a final CPU pass
    const state = getMapState();
    const scale = state.scale > MAX_GPU_SCALE ? 0.125 : 1;
    const cpu = state.scale > MAX_GPU_SCALE;
    renderFractal({ cpu, scale });
    renderTimeoutId = setTimeout(() => {
        renderFractal({ cpu: true, scale: 1 });
    }, 300);
});

/**
 * Listen for window resize, so we can adjust the canvas resolution
 * and re-render the fractal.
 */
window.addEventListener('resize', () => {
    resizeCanvas();
    const scale = getMapState().scale > MAX_GPU_SCALE ? 0.125 : 1;
    const cpu = getMapState().scale > MAX_GPU_SCALE;
    renderFractal({ cpu, scale });

    // Re-render after a short delay
    clearTimeout(renderTimeoutId);
    renderTimeoutId = setTimeout(() => {
        renderFractal({ cpu: true, scale: 1 });
    }, 200);
});

document.addEventListener('keydown', (e) => {
    if (e.key === 'd') {
        // Store the current scale
        const originalScale = Math.log2(getMapState().scale);

        // 1) Animate from current 0 to zoom
        animateZoom(0, originalScale, 12000);
    }
});

/**
 * Attach canvas event listeners for panning and zooming
 */
function attachEventListeners() {
    // --- Mouse events ---
    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        lastMousePos = { x: e.clientX, y: e.clientY };
        // Stop any ongoing inertia so we start fresh
        stop();
    });

    // Mouse up
    canvas.addEventListener('mouseup', () => {
        isDragging = false;
        // Start inertia
        animate(onMapChange);
    });

    let lastRenderTime = 0;
    const RENDER_INTERVAL_MS = 80; // ~12 fps preview

    canvas.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        // Convert oldPos and newPos from screen → fractal coords
        const oldPos = screenToComplex(lastMousePos.x, lastMousePos.y);
        const newPos = screenToComplex(e.clientX, e.clientY);

        // Delta in fractal coords
        const dx = oldPos.cx - newPos.cx;
        const dy = oldPos.cy - newPos.cy;

        // Move the map
        move(dx, dy);

        lastMousePos = { x: e.clientX, y: e.clientY };

        // Possibly do a real-time quick fractal render
        const now = performance.now();
        if (now - lastRenderTime > RENDER_INTERVAL_MS) {
            previewAndScheduleFinalRender();
            lastRenderTime = now;
        } else {
            // Schedule a CPU render soon
            clearTimeout(renderTimeoutId);
            renderTimeoutId = setTimeout(() => {
                renderFractal({ cpu: true, scale: 1 });
            }, 300);
        }

        // Update URL
        updateURL();
    });

    // Mouse wheel to zoom
    canvas.addEventListener('wheel', (e) => {
        e.preventDefault();
        // Typically, we do pivot logic to zoom around the cursor.
        stop();  // if you don't want old inertia to continue

        const mouseX = e.clientX;
        const mouseY = e.clientY;

        // Convert mouse coords to complex plane coords
        const pivot = screenToComplex(mouseX, mouseY);

        // Zoom factor
        const scaleFactor = Math.pow(1.1, -e.deltaY / 100);
        scaleBy(scaleFactor);

        // Keep cursor point stable => shift center
        const newPivot = screenToComplex(mouseX, mouseY);
        move(pivot.cx - newPivot.cx, pivot.cy - newPivot.cy);

        previewAndScheduleFinalRender();
        updateURL();
    }, { passive: false });


    // --- Touch events ---
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        stop();  // kill inertia if we have a new touch
        activeTouches = Array.from(e.touches);

        if (activeTouches.length === 1) {
            // Single-finger drag
            const touch = activeTouches[0];
            lastMousePos = { x: touch.clientX, y: touch.clientY };
            isDragging = true;
        } else if (activeTouches.length === 2) {
            // Two-finger pinch
            isDragging = false;
            initialDistance = getDistance(activeTouches[0], activeTouches[1]);
            initialScale = getMapState().scale;
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        activeTouches = Array.from(e.touches);

        if (activeTouches.length === 1) {
            // Single-finger drag
            const touch = activeTouches[0];
            if (!isDragging) return;

            const oldPos = screenToComplex(lastMousePos.x, lastMousePos.y);
            const newPos = screenToComplex(touch.clientX, touch.clientY);

            // Delta in fractal space
            const dx = newPos.cx - oldPos.cx;
            const dy = newPos.cy - oldPos.cy;

            move(dx, dy);

            lastMousePos = { x: touch.clientX, y: touch.clientY };

            previewAndScheduleFinalRender();
            updateURL();
        } else if (activeTouches.length === 2) {
            // Pinch logic in fractal coords
            const dist = getDistance(activeTouches[0], activeTouches[1]);
            const scaleFactor = dist / initialDistance;

            // Midpoint in screen coords => pivot
            const mid = getMidpoint(activeTouches[0], activeTouches[1]);
            const pivot = screenToComplex(mid.x, mid.y);

            scaleBy(scaleFactor);

            // Keep pivot point stable => shift center
            const newPivot = screenToComplex(mid.x, mid.y);
            move(pivot.cx - newPivot.cx, pivot.cy - newPivot.cy);

            previewAndScheduleFinalRender();
            updateURL();
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        activeTouches = Array.from(e.touches);
        if (activeTouches.length === 0) {
            isDragging = false;
            // Start inertia
            animate(onMapChange);
        }
    }, { passive: false });

    canvas.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        activeTouches = [];
        isDragging = false;
    }, { passive: false });
}

/**
 * Called once per frame by map.animate(), or manually during mouse/touch moves.
 * We do a quick preview render, schedule a final CPU render, and update the URL.
 */
function onMapChange() {
    previewAndScheduleFinalRender();
    updateURL();
}

/**
 * Render a quick preview, then schedule a final CPU render.
 */
function previewAndScheduleFinalRender() {
    const state = getMapState();
    const scale = state.scale > MAX_GPU_SCALE ? 0.125 : 1;
    const cpu = state.scale > MAX_GPU_SCALE;
    renderFractal({ cpu, scale });

    clearTimeout(renderTimeoutId);
    renderTimeoutId = setTimeout(() => {
        renderFractal({ cpu: true, scale: 1 });
    }, 300);
}

/**
 * Convert screen coords to complex plane coords
 */
function screenToComplex(sx, sy) {
    const sxDevice = sx * dpr;
    const syDevice = sy * dpr;
    const state = getMapState();
    const scale = 4 / (canvas.width * state.scale);
    const cx = state.x + (sxDevice - canvas.width / 2) * scale;
    const cy = state.y - (syDevice - canvas.height / 2) * scale;
    return { cx, cy };
}

/**
 * Update the URL with current state
 */
function updateURL() {
    const params = new URLSearchParams(window.location.search);
    const state = getMapState();
    const zoom = Math.log2(state.scale);

    // Truncate x and y to the most relevant decimals. 3 decimals required at zoom level 0.
    // Each additional zoom level requires 2 more bits of precision. 1 bit = ~0.30103 decimals.
    const precision = 3 + Math.ceil(zoom * BITS_PER_DECIMAL);
    params.set('x', state.x.toFixed(precision));
    params.set('y', state.y.toFixed(precision));
    params.set('z', zoom.toFixed(2));

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
}

/**
 * Read state from the URL (if present)
 */
function readStateFromURL() {
    const params = new URLSearchParams(window.location.search);
    const x = params.has('x') ? parseFloat(params.get('x')) || 0 : 0;
    const y = params.has('y') ? parseFloat(params.get('y')) || 0 : 0;
    const zoom = params.has('z') ? parseFloat(params.get('z')) || 0 : 0;
    const scale = Math.pow(2, zoom);
    moveTo(x, y, scale);
}

/**
 * Resize canvas to match window size * devicePixelRatio
 */
function resizeCanvas() {
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    canvas.style.width = window.innerWidth + 'px';
    canvas.style.height = window.innerHeight + 'px';
}

/**
 * Main function to render the fractal (preview or final).
 * If "cpu" is true, do CPU rendering; else do WebGL/WebGPU preview.
 */
function renderFractal(options = {}) {
    terminateWorkers();

    if (options.cpu) {
        renderFractalCPU(options.scale);
        if (options.scale !== 1) {
            useRenderingEngine(RenderingEngine.CPU);
        }
    } else if (hasWebgpu()) {
        renderFractalWebGPU(options.scale);
        useRenderingEngine(RenderingEngine.WEBGPU);
    } else {
        renderFractalWebGL(options.scale);
        useRenderingEngine(RenderingEngine.WEBGL);
    }
}

/**
 * Helper for pinch gestures: distance between two touches
 */
function getDistance(t1, t2) {
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Helper for pinch gestures: midpoint of two touches
 */
function getMidpoint(t1, t2) {
    return {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
    };
}

/******************************************************
 * 1. Easing function (easeInOutSine)
 *    Slower acceleration/deceleration than Quad.
 ******************************************************/
function easeInOutSine(t) {
    // t goes from 0 to 1
    return 0.5 * (1 - Math.cos(Math.PI * t));
}

/**
 * Animate from zoomStart = 2^L_start to zoomEnd = 2^L_end,
 * by interpolating L in [L_start, L_end].
 * 
 * - zoomStart: initial zoom level
 * - zoomEnd: final zoom level
 * - duration: animation time in ms
 * - easingFunc(t): takes t in [0..1], returns eased T
 */
function animateZoom(zoomStart, zoomEnd, duration) {
    return new Promise((resolve) => {
        let startTime = null;

        // Capture the fractal coords of the screen center so we can keep it stable
        const centerScreen = {
            x: canvas.width / 2 / dpr,
            y: canvas.height / 2 / dpr
        };
        const { cx: centerCx, cy: centerCy } = screenToComplex(centerScreen.x, centerScreen.y);

        function step(timestamp) {
            if (!startTime) startTime = timestamp;
            const elapsed = timestamp - startTime;
            let t = elapsed / duration;
            if (t > 1) t = 1;  // clamp to 1 at the end

            // Apply easing to get an eased progress
            const easedT = easeInOutSine(t);

            // Interpolate L_current
            const currentZoom = zoomStart + (zoomEnd - zoomStart) * easedT;
            // Convert exponent -> actual zoom scale
            scaleTo(Math.pow(2, currentZoom));

            // Keep the same fractal point at the screen center
            const { cx: newCx, cy: newCy } = screenToComplex(centerScreen.x, centerScreen.y);
            move(centerCx - newCx, centerCy - newCy);

            // Render a quick preview
            previewAndScheduleFinalRender();

            if (t < 1) {
                requestAnimationFrame(step);
            } else {
                resolve();
            }
        }

        requestAnimationFrame(step);
    });
}

export function debug(msg) {
    document.getElementById("flopStats").innerHTML = msg;
}
