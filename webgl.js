// --------------------------------------
// Code generated by ChatGPT model o1 pro
// --------------------------------------

import { getMapState } from "./map.js";
import { canvas, ctx } from "./state.js";

/**
 * Quick WebGL-based preview
 */
let gl = null;
let webGLProgram = null;
let uResolution, uCenterZoom;

export function initWebGL() {
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
    uniform vec3 uCenterZoom; // (centerX, centerY, scale)

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

        // scaleFactor = 4 / (width * scale)
        float scaleFactor = 4.0 / uResolution.x * exp2(-zoom);

        // Map uv -> complex plane
        float x0 = centerX + (uv.x - 0.5 * uResolution.x) * scaleFactor;
        float y0 = centerY - (py - 0.5 * uResolution.y) * scaleFactor;

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
export function renderFractalWebGL(scale = 1) {
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
    const state = getMapState();
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
