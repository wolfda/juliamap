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
import { canvas, hasWebgpu, RenderingEngine, setWebgpu, state, useRenderingEngine } from "./state.js";
import { initWebGPU, renderFractalWebGPU } from "./webgpu.js";
import { renderFractalCPU, terminateWorkers } from "./cpu.js";

const MAX_GPU_ZOOM = 256073;

// Keep track of pointer state during panning
let isDragging = false;
let lastMousePos = { x: 0, y: 0 };

// For touch gestures
let activeTouches = [];
let initialDistance = 0;
let initialZoom = state.zoom;

// Physics parameters to implement inertia on pan/zoom
let velocity = { vx: 0, vy: 0 };
let lastMoveTime = 0;
let moveInertiaId = null; // store the current requestAnimationFrame id
const PAN_FRICTION = 0.94;  // tweak friction factor (0 < FRICTION < 1)

let zoomVelocity = 0;
let lastZoomFactor = 0;
let lastPinchTime = 0;
let lastPinchScreenCenter = null;
let zoomInertiaId = null;
const ZOOM_FRICTION = 0.95;

// Debounce/timer for final hi-res render
let renderTimeoutId = null;
// Device pixel ratio for crisp rendering on high-DPI
const dpr = window.devicePixelRatio || 1;

window.addEventListener('DOMContentLoaded', async () => {
    readStateFromURL();
    resizeCanvas();
    attachEventListeners();

    const webgpu_available = await initWebGPU()
    setWebgpu(webgpu_available);
    if (!webgpu_available) {
        console.warn("webgpu not availble, falling back to webgl");
        initWebGL();
    }

    // Initial render
    const scale = state.zoom > MAX_GPU_ZOOM ? 0.125 : 1;
    const cpu = state.zoom > MAX_GPU_ZOOM;
    renderFractal({ cpu, scale });
    renderTimeoutId = setTimeout(() => {
        renderFractal({ cpu: true, scale: 1 });
    }, 300);
});

/**
 * Listen for window resize, so we can adjust the canvas resolution
 */
window.addEventListener('resize', () => {
    resizeCanvas();
    const scale = state.zoom > MAX_GPU_ZOOM ? 0.125 : 1;
    const cpu = state.zoom > MAX_GPU_ZOOM;
    renderFractal({ cpu, scale });
    // Re-render after a short delay
    clearTimeout(renderTimeoutId);
    renderTimeoutId = setTimeout(() => {
        renderFractal({ cpu: true, scale: 1 });
    }, 200);
});

/**
 * Canvas event listeners for panning and zooming
 */
function attachEventListeners() {
    // --- Mouse events ---
    canvas.addEventListener('mousedown', (e) => {
        isDragging = true;
        lastMousePos = { x: e.clientX, y: e.clientY };
    });

    // Mouse up
    canvas.addEventListener('mouseup', () => {
        isDragging = false;
    });

    let lastRenderTime = 0;
    const RENDER_INTERVAL_MS = 80; // ~12 fps preview

    canvas.addEventListener('mousemove', (e) => {
        if (!isDragging) return;

        // Update state.x, state.y from dx, dy
        const dx = e.clientX - lastMousePos.x;
        const dy = e.clientY - lastMousePos.y;
        lastMousePos = { x: e.clientX, y: e.clientY };
        const scale = 4 / (canvas.width * state.zoom);
        state.x -= dx * scale;
        // Note the sign for y movement matches CPU
        state.y += dy * scale;

        // Possibly do a real-time quick fractal render
        const now = performance.now();
        if (now - lastRenderTime > RENDER_INTERVAL_MS) {
            previewAndScheduleFinalRender();
            lastRenderTime = now;
        } else {
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
        // Zoom toward the cursor
        const mouseX = e.clientX;
        const mouseY = e.clientY;

        // Convert mouse coords to complex plane coords
        const { cx, cy } = screenToComplex(mouseX, mouseY);

        // Zoom factor
        const zoomFactor = Math.pow(1.1, -e.deltaY / 100);
        state.zoom *= zoomFactor;

        // Keep cursor point stable => shift center
        const { cx: newCenterX, cy: newCenterY } = screenToComplex(mouseX, mouseY);
        state.x -= (newCenterX - cx);
        state.y -= (newCenterY - cy);

        previewAndScheduleFinalRender();
        updateURL();
    }, { passive: false });


    // --- Touch events ---
    canvas.addEventListener('touchstart', (e) => {
        e.preventDefault();
        if (moveInertiaId) cancelAnimationFrame(moveInertiaId);
        if (zoomInertiaId) cancelAnimationFrame(zoomInertiaId);

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
            initialZoom = state.zoom;
        }
    }, { passive: false });

    canvas.addEventListener('touchmove', (e) => {
        e.preventDefault();
        activeTouches = Array.from(e.touches);

        if (activeTouches.length === 1) {
            // Single-finger drag
            const touch = activeTouches[0];
            if (!isDragging) return;

            const now = performance.now();
            const dt = (now - lastMoveTime) || 16; // ms since last move (fallback ~16ms)

            const oldPos = screenToComplex(lastMousePos.x, lastMousePos.y);
            const newPos = screenToComplex(touch.clientX, touch.clientY);

            // Delta in fractal space
            const dx = newPos.cx - oldPos.cx;
            const dy = newPos.cy - oldPos.cy;

            state.x -= dx;
            state.y -= dy;

            // Estimate velocity in fractal coords / ms
            velocity.vx = dx / dt;
            velocity.vy = dy / dt;

            lastMousePos = { x: touch.clientX, y: touch.clientY };
            lastMoveTime = now;

            previewAndScheduleFinalRender();
            updateURL();
        } else if (activeTouches.length === 2) {
            // track velocity
            // (We need "deltaZoom" per millisecond or something similar)
            const now = performance.now();
            const dt = now - lastPinchTime || 16;

            // Pinch to zoom
            const dist = getDistance(activeTouches[0], activeTouches[1]);
            const zoomFactor = dist / initialDistance;

            const mid = getMidpoint(activeTouches[0], activeTouches[1]);
            const { cx, cy } = screenToComplex(mid.x, mid.y);

            // Update zoom
            state.zoom = initialZoom * zoomFactor;

            // Keep midpoint stable => shift center
            const { cx: newCx, cy: newCy } = screenToComplex(mid.x, mid.y);
            state.x -= (newCx - cx);
            state.y -= (newCy - cy);

            // For simplicity, store ratio velocity: how quickly zoomFactor is changing
            zoomVelocity = (zoomFactor - lastZoomFactor) / dt;

            lastZoomFactor = zoomFactor;
            lastPinchTime = now;
            lastPinchScreenCenter = mid;

            previewAndScheduleFinalRender();
            updateURL();
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        activeTouches = Array.from(e.touches);
        if (activeTouches.length === 0) {
            isDragging = false;
            startInertia()
        }
    }, { passive: false });

    canvas.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        activeTouches = [];
        isDragging = false;
    }, { passive: false });
}

/**
 * Animate inertia on touch release.
 */
function startInertia() {
    if (zoomInertiaId) cancelAnimationFrame(zoomInertiaId);

    const speedSq = velocity.vx * velocity.vx + velocity.vy * velocity.vy + zoomVelocity * zoomVelocity;

    // Stop if velocities are very small
    if (speedSq < 1e-14) {
        return;
    }

    if (lastPinchScreenCenter) {
        // On zoom animation, lock pan animation
        velocity = { vx: 0, vy: 0 };
    }

    let lastTime = performance.now();

    function animate() {
        const now = performance.now();
        const dt = now - lastTime || 16;
        lastTime = now;

        // --- Pan inertia ---
        state.x -= velocity.vx * dt;
        state.y -= velocity.vy * dt;
        velocity.vx *= PAN_FRICTION;
        velocity.vy *= PAN_FRICTION;

        // --- Zoom inertia ---
        if (lastPinchScreenCenter) {
            const { cx: pinchCx, cy: pinchCy } = screenToComplex(
                lastPinchScreenCenter.x,
                lastPinchScreenCenter.y,
            );

            // Update the zoom based on velocity
            // e.g. newZoom = oldZoom + zoomVelocity * dt
            state.zoom = Math.max(state.zoom + zoomVelocity * dt, 1);

            // Keep pinch center stable => same approach as pinch
            // We'll compare old vs new pinch center in fractal coords
            const { cx: newCx, cy: newCy } = screenToComplex(
                lastPinchScreenCenter.x,
                lastPinchScreenCenter.y,
            );
            state.x -= (newCx - pinchCx);
            state.y -= (newCy - pinchCy);
            zoomVelocity *= ZOOM_FRICTION;
        } else {

        }

        // Stop if velocities are very small
        const speedSq = velocity.vx * velocity.vx + velocity.vy * velocity.vy + zoomVelocity * zoomVelocity;
        if (speedSq < 1e-14) {
            velocity.vx = 0;
            velocity.vy = 0;
            zoomVelocity = 0;
            previewAndScheduleFinalRender();
            return;
        }

        // Keep animating
        previewAndScheduleFinalRender();
        zoomInertiaId = requestAnimationFrame(animate);
    }

    zoomInertiaId = requestAnimationFrame(animate);
}

/**
 * Render a quick preview, then schedule a final CPU render.
 */
function previewAndScheduleFinalRender() {
    const scale = state.zoom > MAX_GPU_ZOOM ? 0.125 : 1;
    const cpu = state.zoom > MAX_GPU_ZOOM;
    renderFractal({ cpu, scale });

    clearTimeout(renderTimeoutId);
    renderTimeoutId = setTimeout(() => {
        renderFractal({ cpu: true, scale: 1 });
    }, 300);
}

/**
 * Helpers for pinch gestures
 */
function getDistance(t1, t2) {
    const dx = t2.clientX - t1.clientX;
    const dy = t2.clientY - t1.clientY;
    return Math.sqrt(dx * dx + dy * dy);
}

function getMidpoint(t1, t2) {
    return {
        x: (t1.clientX + t2.clientX) / 2,
        y: (t1.clientY + t2.clientY) / 2,
    };
}

/**
 * Convert screen coords to complex plane coords
 */
function screenToComplex(sx, sy) {
    const sxDevice = sx * dpr;
    const syDevice = sy * dpr;
    const scale = 4 / (canvas.width * state.zoom);
    const cx = state.x + (sxDevice - canvas.width / 2) * scale;
    const cy = state.y - (syDevice - canvas.height / 2) * scale;
    return { cx, cy };
}

/**
 * Update the URL with current state
 */
function updateURL() {
    const params = new URLSearchParams(window.location.search);
    params.set('x', state.x);
    params.set('y', state.y);
    params.set('z', state.zoom);

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, '', newUrl);
}

/**
 * Read state from the URL (if present)
 */
function readStateFromURL() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('x')) {
        state.x = parseFloat(params.get('x')) || 0;
    }
    if (params.has('y')) {
        state.y = parseFloat(params.get('y')) || 0;
    }
    if (params.has('z')) {
        state.zoom = parseFloat(params.get('z')) || 1;
    }
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
 * Main function to render the fractal (preview or final)
 */
function renderFractal(options = {}) {
    terminateWorkers();

    // If "cpu" is true, do CPU rendering; else do WebGL preview
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


export function debug(msg) {
    document.getElementById("flopStats").innerHTML = msg;
}
