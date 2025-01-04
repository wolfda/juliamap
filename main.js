/**
 * Code generated by ChatGPT model o1 pro
 * 
 * Implements:
 * 1. Setting up the canvas to display Mandelbrot (and eventually Julia sets if extended).
 * 2. Handling user interactions (pan, zoom) for both mouse and touch.
 * 3. Maintaining and updating URL to reflect x, y, zoom level.
 * 4. Using Web Workers to compute fractal images (CPU).
 * 5. Doing an initial, coarse (1/8 resolution) preview in WebGL, then refining via CPU.
 */

const MAX_GPU_ZOOM = 256073;

// Global state for the viewport
let state = {
    x: -0.5,     // real part (center)
    y: 0,        // imaginary part (center)
    zoom: 1,     // zoom factor
};

// Keep track of pointer state during panning
let isDragging = false;
let lastMousePos = { x: 0, y: 0 };

// For touch gestures
let activeTouches = [];
let initialDistance = 0;
let initialZoom = state.zoom;

// Canvas references
const canvas = document.getElementById('fractalCanvas');
const ctx = canvas.getContext('2d');

// Workers so we can terminate if user starts a new move
let currentWorkers = [];
// Debounce/timer for final hi-res render
let renderTimeoutId = null;
// Device pixel ratio for crisp rendering on high-DPI
const dpr = window.devicePixelRatio || 1;

window.addEventListener('DOMContentLoaded', () => {
    readStateFromURL();
    resizeCanvas();
    attachEventListeners();
    initWebGL();

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

            const dx = touch.clientX - lastMousePos.x;
            const dy = touch.clientY - lastMousePos.y;
            lastMousePos = { x: touch.clientX, y: touch.clientY };

            const scale = 4 / (canvas.width * state.zoom);
            state.x -= dx * scale * 2;
            state.y += dy * scale * 2;

            previewAndScheduleFinalRender();
            updateURL();
        } else if (activeTouches.length === 2) {
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

            previewAndScheduleFinalRender();
            updateURL();
        }
    }, { passive: false });

    canvas.addEventListener('touchend', (e) => {
        e.preventDefault();
        activeTouches = Array.from(e.touches);
        if (activeTouches.length === 0) {
            isDragging = false;
        }
    }, { passive: false });

    canvas.addEventListener('touchcancel', (e) => {
        e.preventDefault();
        activeTouches = [];
        isDragging = false;
    }, { passive: false });
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
    const scale = 4 / (canvas.width * state.zoom);
    const cx = state.x + (sx - canvas.width / 2) * scale;
    const cy = state.y - (sy - canvas.height / 2) * scale;
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
    // Stop any existing workers
    currentWorkers.forEach((w) => w.terminate());
    currentWorkers = [];

    // If "cpu" is true, do CPU rendering; else do WebGL preview
    if (options.cpu) {
        renderFractalCPU(options.scale);
    } else {
        renderFractalWebGL(options.scale);
    }
}

/**
 * CPU rendering with a Worker
 * We'll measure iteration count => compute FLOP => update gauge
 */
function renderFractalCPU(scale = 1) {
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

    const worker = new Worker('worker.js');
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
 * Quick WebGL-based preview
 */
let gl = null;
let webGLProgram = null;
let uResolution, uCenterZoom;

function initWebGL() {
    const webGLCanvas = document.createElement('canvas');
    webGLCanvas.width = 256;
    webGLCanvas.height = 256;
    webGLCanvas.style.display = 'none';
    document.body.appendChild(webGLCanvas);

    gl = webGLCanvas.getContext('webgl');
    if (!gl) {
        console.warn('WebGL not supported, falling back to CPU for preview.');
        return;
    }

    // Vertex shader (full-screen quad)
    const vsSource = `
    attribute vec2 aPosition;
    void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
    `;

    // Fragment shader that matches the CPU coloring & flips Y
    const fsSource = `
    precision highp float;

    uniform vec2 uResolution; // (width, height)
    uniform vec3 uCenterZoom; // (centerX, centerY, zoom)

    // Use a preprocessor define for iteration limit
    #define MAX_ITER 500

    void main() {
        // uv in [0..uResolution]
        vec2 uv = gl_FragCoord.xy;

        float centerX = uCenterZoom.x;
        float centerY = uCenterZoom.y;
        float zoom    = uCenterZoom.z;

        // Flip Y to match the CPU top-down iteration
        float py = uResolution.y - uv.y;

        // Scale = 4 / (width * zoom)
        float scale = 4.0 / (uResolution.x * zoom);

        // Map uv -> complex plane
        float x0 = centerX + (uv.x - 0.5 * uResolution.x) * scale;
        float y0 = centerY - (py - 0.5 * uResolution.y) * scale;

        float x = 0.0;
        float y = 0.0;

        int escapeValue = MAX_ITER;

        // We'll track how many iterations until we exceed radius 2
        for (int i = 0; i < MAX_ITER; i++) {
            float x2 = x*x - y*y + x0;
            float y2 = 2.0 * x * y + y0;
            x = x2;
            y = y2;

            // Once outside the radius, break
            if (x*x + y*y > 4.0) {
                escapeValue = i;
                break;
            }
        }

        // If we never broke out, pixel is inside => black
        if (escapeValue == MAX_ITER) {
            gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
        } else {
            // Outside => match CPU color
            // CPU does: c = 255 - floor((iter / maxIter)*255); => (c, c, 255)
            // normalized => c = 1.0 - (escapeValue / MAX_ITER) => (c, c, 1.0)
            float c = 1.0 - float(escapeValue) / float(MAX_ITER);
            gl_FragColor = vec4(c, c, 1.0, 1.0);
        }
    }
    `;

    // Compile and link
    const vs = compileShader(vsSource, gl.VERTEX_SHADER);
    const fs = compileShader(fsSource, gl.FRAGMENT_SHADER);
    webGLProgram = gl.createProgram();
    gl.attachShader(webGLProgram, vs);
    gl.attachShader(webGLProgram, fs);
    gl.linkProgram(webGLProgram);

    if (!gl.getProgramParameter(webGLProgram, gl.LINK_STATUS)) {
        console.error('Could not link WebGL program:', gl.getProgramInfoLog(webGLProgram));
        return;
    }

    gl.useProgram(webGLProgram);

    // Look up uniform locations
    uResolution = gl.getUniformLocation(webGLProgram, 'uResolution');
    uCenterZoom = gl.getUniformLocation(webGLProgram, 'uCenterZoom');

    // Setup a full-viewport quad
    const aPosition = gl.getAttribLocation(webGLProgram, 'aPosition');
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

    const vertices = new Float32Array([
        -1, -1,
        1, -1,
        -1, 1,
        1, 1
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aPosition);
    gl.vertexAttribPointer(aPosition, 2, gl.FLOAT, false, 0, 0);

    function compileShader(source, type) {
        const s = gl.createShader(type);
        gl.shaderSource(s, source);
        gl.compileShader(s);
        if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
            console.error(gl.getShaderInfoLog(s));
            gl.deleteShader(s);
            return null;
        }
        return s;
    }
}

/**
 * Render using WebGL, then up-scale
 */
function renderFractalWebGL(scale = 1) {
    if (!gl) {
        // WebGL not supported => fallback to CPU
        renderFractalCPU(scale);
        return;
    }

    const offscreenCanvas = gl.canvas;

    const w = Math.floor(canvas.width * scale);
    const h = Math.floor(canvas.height * scale);

    offscreenCanvas.width = w;
    offscreenCanvas.height = h;
    gl.viewport(0, 0, w, h);

    // Set uniforms
    gl.useProgram(webGLProgram);
    gl.uniform2f(uResolution, w, h);
    gl.uniform3f(uCenterZoom, state.x, state.y, state.zoom);

    // Clear and draw
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    // Blit to main canvas
    ctx.save();
    ctx.scale(1 / scale, 1 / scale);
    ctx.drawImage(offscreenCanvas, 0, 0);
    ctx.restore();
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

    el.innerHTML = `${flopStr}FLOP`;
}
