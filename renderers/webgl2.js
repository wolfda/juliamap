import { getPaletteId } from "../state.js";
import { Orbit } from "../julia.js"; // for deep zoom perturbation
import { hasWebgl2 } from "./capabilities.js";
import { RenderContext, Renderer, RenderingEngine } from "./renderer.js";

const MAX_ITERATIONS = 10000; // can increase for deeper zoom if desired


export class Webgl2Renderer extends Renderer {
    static create(canvas, ctx) {
        return new Webgl2Renderer(canvas, ctx);
    }

    constructor(canvas, ctx) {
        super();
        this.canvas = canvas;
        this.ctx = ctx;
        this.gl = undefined;
        this.webGLProgram = undefined;
        this.uResolution = undefined;
        this.uCenterZoom = undefined;
        this.uMaxIter = undefined;
        this.uSamples = undefined;
        this.uPaletteId = undefined;
        this.uUsePerturb = undefined;
        this.uOrbitCount = undefined;
        this.orbitBuffer = undefined;
        this.init();
    }

    id() {
        return RenderingEngine.WEBGL2;
    }

    init() {
        if (!hasWebgl2()) {
            throw new Error("Webgl2 is not supported");
        }
        // Create a hidden offscreen canvas for rendering.
        const webGLCanvas = document.createElement("canvas");
        webGLCanvas.width = 256;
        webGLCanvas.height = 256;
        webGLCanvas.style.display = "none";
        document.body.appendChild(webGLCanvas);

        // Get WebGL2 context.
        this.gl = webGLCanvas.getContext("webgl2");
        const gl = this.gl;

        // --- Vertex Shader (GLSL ES 3.00)
        const vsSource = `#version 300 es
precision highp float;
in vec2 aPosition;
void main() {
    gl_Position = vec4(aPosition, 0, 1);
}
`;

        // --- Compile and link shaders
        function compileShader(source, type) {
            const shader = gl.createShader(type);
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                console.error(gl.getShaderInfoLog(shader));
                gl.deleteShader(shader);
                return null;
            }
            return shader;
        }

        const vs = compileShader(vsSource, gl.VERTEX_SHADER);
        const fs = compileShader(wgslVertexShader, gl.FRAGMENT_SHADER);
        this.webGLProgram = gl.createProgram();
        gl.attachShader(this.webGLProgram, vs);
        gl.attachShader(this.webGLProgram, fs);
        gl.linkProgram(this.webGLProgram);

        if (!gl.getProgramParameter(this.webGLProgram, gl.LINK_STATUS)) {
            throw new Error("Could not link WebGL2 program:", gl.getProgramInfoLog(this.webGLProgram));
        }

        gl.useProgram(this.webGLProgram);

        // Get uniform locations (for non-block uniforms).
        this.uResolution = gl.getUniformLocation(this.webGLProgram, "uResolution");
        this.uCenterZoom = gl.getUniformLocation(this.webGLProgram, "uCenterZoom");
        this.uMaxIter = gl.getUniformLocation(this.webGLProgram, "uMaxIter");
        this.uSamples = gl.getUniformLocation(this.webGLProgram, "uSamples");
        this.uPaletteId = gl.getUniformLocation(this.webGLProgram, "uPaletteId");
        this.uUsePerturb = gl.getUniformLocation(this.webGLProgram, "uUsePerturb");
        this.uOrbitCount = gl.getUniformLocation(this.webGLProgram, "uOrbitCount");

        // Setup a full-screen quad.
        const aPosition = gl.getAttribLocation(this.webGLProgram, "aPosition");
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

        // Bind the uniform block for orbit data to binding point 0.
        const orbitBlockIndex = gl.getUniformBlockIndex(this.webGLProgram, "OrbitBlock");
        gl.uniformBlockBinding(this.webGLProgram, orbitBlockIndex, 0);

        // Create and bind a dummy orbit buffer so the uniform block is always bound.
        this.orbitBuffer = gl.createBuffer();
        gl.bindBuffer(gl.UNIFORM_BUFFER, this.orbitBuffer);
        // Allocate enough space for MAX_ITERATIONS vec2's).
        gl.bufferData(gl.UNIFORM_BUFFER, new Float32Array(2 * MAX_ITERATIONS), gl.STATIC_DRAW);
        gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.orbitBuffer);
    }
    
    detach() {
        document.removeChild(this.webGLCanvas);
    }

    render(map, options) {
        const gl = this.gl;
        const scale = Math.min(options.pixelDensity, 1);
        const offscreenCanvas = gl.canvas;
        const w = Math.floor(this.canvas.width * scale);
        const h = Math.floor(this.canvas.height * scale);

        offscreenCanvas.width = w;
        offscreenCanvas.height = h;
        gl.viewport(0, 0, w, h);

        // Set uniforms.
        gl.useProgram(this.webGLProgram);
        gl.uniform2f(this.uResolution, w, h);
        gl.uniform1i(this.uMaxIter, options.maxIter);
        const samples = Math.floor(Math.max(options.pixelDensity, 1));
        gl.uniform1i(this.uSamples, samples);
        gl.uniform1i(this.uPaletteId, getPaletteId(options.palette));
        gl.uniform1i(this.uUsePerturb, options.deep ? 1 : 0);

        if (options.deep) {
            // Compute reference orbit for perturbation.
            // Orbit.searchMaxEscapeVelocity is expected to return an object with:
            //   - sx, sy: starting point for the orbit,
            //   - iters: a Float32Array containing interleaved vec2 orbit points.
            const orbit = Orbit.searchForMandelbrot(map, w, h, options.maxIter);
            // Use the orbit’s starting point (note: y-axis is flipped for display).
            gl.uniform3f(this.uCenterZoom, orbit.sx, h - orbit.sy, map.zoom);
            // Limit orbit count to the maximum our uniform block supports.
            const orbitCount = Math.min(orbit.iters.length / 2, MAX_ITERATIONS);
            gl.uniform1i(this.uOrbitCount, orbitCount);

            // Prepare a padded array for std140 (each vec2 occupies 4 floats).
            // const paddedOrbit = new Float32Array(2 * orbitCount);
            const paddedOrbit = new Float32Array(2 * MAX_ITERATIONS);
            for (let i = 0; i < orbitCount; i++) {
                paddedOrbit[i * 2] = orbit.iters[i * 2];
                paddedOrbit[i * 2 + 1] = orbit.iters[i * 2 + 1];
            }

            gl.bindBuffer(gl.UNIFORM_BUFFER, this.orbitBuffer);
            gl.bufferData(gl.UNIFORM_BUFFER, paddedOrbit, gl.STATIC_DRAW);
            gl.bindBufferBase(gl.UNIFORM_BUFFER, 0, this.orbitBuffer);
        } else {
            gl.uniform3f(this.uCenterZoom, map.x, map.y, map.zoom);
        }

        // Clear and draw.
        gl.clearColor(0, 0, 0, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

        // Blit the result to the main canvas.
        this.ctx.save();
        this.ctx.scale(1 / scale, 1 / scale);
        this.ctx.drawImage(offscreenCanvas, 0, 0);
        this.ctx.restore();

        return new RenderContext(this.id(), options);
    }
}


const wgslVertexShader = /* wgsl */ `#version 300 es
precision highp float;
out vec4 fragColor;

// Uniforms
uniform vec2 uResolution;      // (width, height)
uniform vec3 uCenterZoom;      // (centerX, centerY, zoom)
uniform int uMaxIter;          // dynamic max iterations
uniform int uSamples;          // supersampling count
uniform int uPaletteId;        // 0: electric, 1: rainbow, 2: zebra, 3: wikipedia
uniform int uUsePerturb;       // 0: normal, 1: use perturbation
uniform int uOrbitCount;       // number of orbit points stored

// Constants
#define MAX_ITER ${MAX_ITERATIONS}

// Orbit data stored in a uniform block (std140 layout forces each vec2 to a 4-float slot)
layout(std140) uniform OrbitBlock {
    vec4 uOrbitData[MAX_ITER / 2];
};    

// --- Math functions

// Compute c² on a complex number.
vec2 complex_square(vec2 c) {
    return vec2(c.x * c.x - c.y * c.y, 2.0 * c.x * c.y);
}

// Compute c₀ x c₁ for 2 complex numbers.
vec2 complex_mul(vec2 c0, vec2 c1) {
    return vec2(c0.x * c1.x - c0.y * c1.y, c0.x * c1.y + c0.y * c1.x);
}

// Compute |c|², the square of the modulus of a complex number.
float complex_square_mod(vec2 c) {
    return dot(c, c);
}

float rand(vec2 co) {
    return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

// --- Color functions

const vec3 RED     = vec3(1, 0, 0);
const vec3 YELLOW  = vec3(1, 1, 0);
const vec3 GREEN   = vec3(0, 1, 0);
const vec3 CYAN    = vec3(0, 1, 1);
const vec3 BLUE    = vec3(0, 0, 1);
const vec3 MAGENTA = vec3(1, 0, 1);
const vec3 BLACK   = vec3(0, 0, 0);
const vec3 WHITE   = vec3(1, 1, 1);

const vec3 ELECTRIC[2] = vec3[](BLUE, WHITE);
const vec3 RAINBOW[6] = vec3[](YELLOW, GREEN, CYAN, BLUE, MAGENTA, RED);
const vec3 ZEBRA[2] = vec3[](WHITE, BLACK);

const vec3 WIKIPEDIA[5] = vec3[](
    vec3(  0,   7, 100) / 255.0,
    vec3( 32, 107, 203) / 255.0,
    vec3(237, 255, 255) / 255.0,
    vec3(255, 170,   0) / 255.0,
    vec3(  0,   2,   0) / 255.0
);

vec3 interpolatePalette6Color(vec3 palette[6], float index) {
    float len = 6.0;
    int i0 = int(mod(len * index - 1.0, len));
    int i1 = int(mod(len * index, len));
    float t = mod(len * index, 1.0);
    return palette[i0] + t * (palette[i1] - palette[i0]);
}

vec3 interpolatePalette5Color(vec3 palette[5], float index) {
    float len = 5.0;
    int i0 = int(mod(len * index - 1.0, len));
    int i1 = int(mod(len * index, len));
    float t = mod(len * index, 1.0);
    return palette[i0] + t * (palette[i1] - palette[i0]);
}

vec3 interpolatePalette2Color(vec3 palette[2], float index) {
    float len = 2.0;
    int i0 = int(mod(len * index - 1.0, len));
    int i1 = int(mod(len * index, len));
    float t = mod(len * index, 1.0);
    return palette[i0] + t * (palette[i1] - palette[i0]);
}

vec3 getPalette2Color(vec3 palette[2], float index) {
    return palette[int(mod(index, 1.0) * 2.0)];
}

vec3 rainbowColor(int escapeVelocity) {
    return interpolatePalette6Color(RAINBOW, float(escapeVelocity) / 200.0);
}

vec3 electricColor(int escapeVelocity) {
    return interpolatePalette2Color(ELECTRIC, float(escapeVelocity) / 200.0);
}

vec3 zebraColor(int escapeVelocity) {
    return getPalette2Color(ZEBRA, float(escapeVelocity) / 5.0);
}

vec3 wikipediaColor(int escapeVelocity) {
    return interpolatePalette5Color(WIKIPEDIA, float(escapeVelocity) / 50.0);
}

#define ELECTRIC_PALETTE_ID 0
#define RAINBOW_PALETTE_ID 1
#define ZEBRA_PALETTE_ID 2
#define WIKIPEDIA_PALETTE_ID 3

vec3 getColor(int escapeVelocity) {
    if (escapeVelocity >= uMaxIter) {
        return BLACK;
    }
    switch(uPaletteId) {
        case ELECTRIC_PALETTE_ID:
            return electricColor(escapeVelocity);
        case RAINBOW_PALETTE_ID:
            return rainbowColor(escapeVelocity);
        case ZEBRA_PALETTE_ID:
            return zebraColor(escapeVelocity);
        case WIKIPEDIA_PALETTE_ID:
        default:
            return wikipediaColor(escapeVelocity);
    }
}

// --- Julia functions

// Retrieve an orbit point from the uniform buffer.
vec2 getOrbitPoint(int index) {
    vec4 point = uOrbitData[index >> 1];
    return (index & 1) == 0 ? point.xy : point.zw;
}

int getEscapeVelocity(vec2 c) {
    vec2 z = vec2(0);
    for (int i = 0; i < uMaxIter; i++) {
        z = complex_square(z) + c;
        if (complex_square_mod(z) > 4.0) {
            return i;
        }
    }
    return uMaxIter;
}

int getEscapeVelocityPerturb(vec2 delta0) {
    vec2 delta = vec2(0);
    vec2 Xn = getOrbitPoint(0);
    for (int i = 0; i < uMaxIter && i < uOrbitCount - 1; i++) {
        delta = complex_mul(2.0 * Xn + delta, delta) + delta0;
        Xn = getOrbitPoint(i + 1);
        if (complex_square_mod(Xn + delta) > 4.0) {
            return i;
        }
    }
    return uMaxIter;
}

// --- Rendering functions

vec3 renderOne(vec2 sampleCoord, vec2 scaleFactor) {
    int escapeVelocity = 0;
    if (uUsePerturb == 0) {
        vec2 c = vec2(uCenterZoom.x, uCenterZoom.y) + (sampleCoord - 0.5 * uResolution) * scaleFactor;
        escapeVelocity = getEscapeVelocity(c);
    } else {
        vec2 delta0 = (sampleCoord - vec2(uCenterZoom.x, uCenterZoom.y)) * scaleFactor;
        escapeVelocity = getEscapeVelocityPerturb(delta0);
    }
    return getColor(escapeVelocity);
}

vec3 renderSuperSample(vec2 sampleCoord, vec2 scaleFactor, int samples) {
    vec3 color = vec3(0);
    for (int i = 0; i < samples; i++) {
        vec2 jitter = vec2(rand(gl_FragCoord.xy + float(i)), rand(gl_FragCoord.yx + float(i) * 1.3)) - 0.5;
        color += renderOne(sampleCoord + jitter, scaleFactor);
    }
    return color / float(samples);
}

void main() {
    // Compute scale factor: (4 / width) * exp2(-zoom). (Y-axis is not flipped here.)
    vec2 scaleFactor = (4.0 / uResolution.x) * exp2(-uCenterZoom.z) * vec2(1.0, 1.0);
    vec3 col;
    if (uSamples <= 1) {
        col = renderOne(gl_FragCoord.xy, scaleFactor);
    } else {
        col = renderSuperSample(gl_FragCoord.xy, scaleFactor, uSamples);
    }
    fragColor = vec4(col, 1.0);
}
`;
