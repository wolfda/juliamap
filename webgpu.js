import { Orbit } from "./julia.js";
import { getMapState } from "./map.js";
import { canvas, ctx, Palette } from "./state.js";

// Offscreen canvas + context
let offscreenCanvas = null;
let offscreenGpuContext = null;

// WEBGPU device/pipeline/buffer objects
let gpuDevice = null;
let gpuPipeline = null;
let gpuUniformBuffer = null;
let gpuReferenceOrbitBuffer = null;
let gpuBindGroup = null;

const MAX_ITERATIONS = 10000; // can increase for deeper zoom if desired
const DEFAULT_MAX_ITERATIONS = 500;

/**
 * Initialize WebGPU context/pipeline if supported
 */
export async function initWebGPU() {
    try {
        if (!("gpu" in navigator)) {
            console.warn("WebGPU not supported in this browser.");
            return false;
        }

        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
            console.warn("Failed to get GPU adapter.");
            return false;
        }

        gpuDevice = await adapter.requestDevice();
        if (!gpuDevice) {
            console.warn("Failed to request GPU device.");
            return false;
        }

        // ----------------------------------------------
        // 1. Create a hidden offscreen canvas + context
        // ----------------------------------------------
        offscreenCanvas = document.createElement("canvas");
        offscreenCanvas.style.display = "none";
        document.body.appendChild(offscreenCanvas);

        offscreenGpuContext = offscreenCanvas.getContext("webgpu");
        if (!offscreenGpuContext) {
            console.warn("Could not get WebGPU context for offscreen canvas.");
            return false;
        }

        // Choose a preferred canvas format
        const format = navigator.gpu.getPreferredCanvasFormat();

        // Create our render pipeline
        gpuPipeline = gpuDevice.createRenderPipeline({
            layout: "auto",
            vertex: {
                module: gpuDevice.createShaderModule({
                    code: wgslVertexShader
                }),
                entryPoint: "main"
            },
            fragment: {
                module: gpuDevice.createShaderModule({
                    code: wgslFragmentShader
                }),
                entryPoint: "main",
                targets: [{ format }]
            },
            primitive: {
                topology: "triangle-strip",
                stripIndexFormat: undefined
            }
        });

        // Create a buffer for the uniform data.
        // We'll store centerX, centerY, scale, plus some padding, plus resolution as f32x2.
        gpuUniformBuffer = gpuDevice.createBuffer({
            size: 40,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        // Create a buffer for the reference orbit data. We'll allocate enough for
        // 2 floats * MAX_ITERATIONS = 2*4*MAX_ITERATIONS bytes.
        const orbitBufferSize = 2 * 4 * MAX_ITERATIONS;
        gpuReferenceOrbitBuffer = gpuDevice.createBuffer({
            size: orbitBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        gpuBindGroup = gpuDevice.createBindGroup({
            layout: gpuPipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: gpuUniformBuffer
                    }
                },
                {
                    binding: 1,
                    resource: {
                        buffer: gpuReferenceOrbitBuffer
                    }
                }
            ]
        });

        return true;
    } catch (error) {
        console.warn(error);
        return false;
    }
}

function getPaletteId(palette) {
    switch (palette) {
        case Palette.ELECTRIC:
            return 0;
        case Palette.RAINBOW:
            return 1;
        case Palette.ZEBRA:
            return 2;
        default:
            return 0;
    }
}

/**
 * Render fractal with WebGPU into an offscreen canvas, then blit to the visible canvas.
 */
export function renderFractalWebGPU(scale = 1, deep = false, maxIter = DEFAULT_MAX_ITERATIONS, palette = Palette.ELECTRIC) {
    maxIter = Math.min(maxIter, MAX_ITERATIONS);
    if (!gpuDevice || !gpuPipeline || !offscreenGpuContext) {
        console.error("WebGPU context not initialized properly");
        return;
    }

    // ------------------------------------
    // 2. Configure our offscreen canvas
    // ------------------------------------
    const w = Math.floor(canvas.width);
    const h = Math.floor(canvas.height);

    offscreenCanvas.width = w;
    offscreenCanvas.height = h;

    const format = navigator.gpu.getPreferredCanvasFormat();
    offscreenGpuContext.configure({
        device: gpuDevice,
        format: format,
        alphaMode: "premultiplied"
    });

    // ------------------------------------
    // 3. Write fractal parameters to GPU
    // ------------------------------------
    const state = getMapState();
    const orbit = deep ? Orbit.searchMaxEscapeVelocity(w, h, maxIter) : undefined;
    const samples = Math.floor(scale);

    const uniformArray = new ArrayBuffer(36);
    const dataView = new DataView(uniformArray);
    dataView.setUint32(0, deep ? 1 : 0, true);    // usePerturbation
    dataView.setFloat32(4, state.zoom, true);      // zoom
    dataView.setFloat32(8, orbit ? orbit.sx : state.x, true);  // center
    dataView.setFloat32(12, orbit ? orbit.sy : state.y, true); // center
    dataView.setFloat32(16, w, true);              // resolution
    dataView.setFloat32(20, h, true);              // resolution
    dataView.setUint32(24, maxIter, true);         // maxIter
    dataView.setUint32(28, samples, true)          // samples
    dataView.setUint32(32, getPaletteId(palette), true) // paletteId

    gpuDevice.queue.writeBuffer(gpuUniformBuffer, 0, uniformArray);

    if (orbit) {
        gpuDevice.queue.writeBuffer(gpuReferenceOrbitBuffer, 0, orbit.iters);
    }

    // Acquire a texture to render into (offscreen)
    const renderView = offscreenGpuContext.getCurrentTexture().createView();

    // Build the command pass
    const commandEncoder = gpuDevice.createCommandEncoder();
    const passEncoder = commandEncoder.beginRenderPass({
        colorAttachments: [
            {
                view: renderView,
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                loadOp: "clear",
                storeOp: "store",
            },
        ],
    });

    passEncoder.setPipeline(gpuPipeline);
    passEncoder.setBindGroup(0, gpuBindGroup);
    passEncoder.draw(4, 1, 0, 0); // 4 verts => full-screen quad
    passEncoder.end();

    const gpuCommands = commandEncoder.finish();
    gpuDevice.queue.submit([gpuCommands]);

    // ------------------------------------
    // 4. Blit from offscreen -> main canvas
    // ------------------------------------
    // Use the main canvas's 2D context to draw the offscreen image:
    // If you want a simple "centered" or "fit" approach, you can do:
    ctx.save();
    ctx.drawImage(offscreenCanvas, 0, 0);
    ctx.restore();
}

/* ---------------------------------------------------------
 * WGSL Shaders (updated to model complex numbers as vec2f)
 * --------------------------------------------------------- */

const wgslVertexShader = /* wgsl */ `
@vertex
fn main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4f {
    // We'll draw 2 triangles that cover the entire clip space:
    //   vertexIndex: 0,1,2,3 => positions in a strip
    let x = f32((vertexIndex & 1u) << 1u) - 1; // 0->-1, 1->1, 2->-1, 3->1
    let y = f32((vertexIndex & 2u)) - 1;       // 0->-1, 1->-1, 2->1, 3->1
    return vec4f(x, y, 0, 1);
}
`;

const wgslFragmentShader = /* wgsl */ `
struct FractalUniforms {
    usePerturbation: u32,
    zoom           : f32,
    center         : vec2f,
    resolution     : vec2f,
    maxIter        : u32,
    samples        : u32,
    paletteId      : u32,
};

@group(0) @binding(0)
var<uniform> u: FractalUniforms;

@group(0) @binding(1)
var<storage, read> referenceOrbit: array<vec2f, ${MAX_ITERATIONS}>;

// --- Math functions

// Compute c² on a complex number.
fn complexSquare(c: vec2f) -> vec2f {
    return vec2f(
        c.x * c.x - c.y * c.y,  // real part
        2 * c.x * c.y           // imaginary part
    );
}

// Compute c₀ x c₁ for 2 complex numbers.
fn complexMul(c0: vec2f, c1: vec2f) -> vec2f {
    return vec2f(
        c0.x * c1.x - c0.y * c1.y,  // real part
        c0.x * c1.y + c0.y * c1.x   // imaginary part
    );
}

var<private> seed: u32 = 123456789u;
const MAX_U32 = f32(0xffffffffu);

// Compute the next random number, in [0, 1)
fn rand() -> f32 {
    seed ^= seed << 13;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    // Convert the new seed to a float in the [0, 1) range.
    return f32(seed) / MAX_U32;
}

// Compute the decimal value of a mod b
fn fmod(a: f32, b: f32) -> f32 {
    return a - b * floor(a / b);
}

// --- Color functions

const RED = vec3f(1, 0, 0);
const YELLOW = vec3f(1, 1, 0);
const GREEN = vec3f(0, 1, 0);
const CYAN = vec3f(0, 1, 1);
const BLUE = vec3f(0, 0, 1);
const MAGENTA = vec3f(1, 0, 1);
const BLACK = vec3f(0, 0, 0);
const WHITE = vec3f(1, 1, 1);

const ELECTRIC = array<vec3f, 2>(BLUE, WHITE);
const RAINBOW = array<vec3f, 6>(YELLOW, GREEN, CYAN, BLUE, MAGENTA, RED);
const ZEBRA = array<vec3f, 2>(WHITE, BLACK);

fn interpolatePalette6Color(palette: array<vec3f, 6>, index: f32) -> vec3f {
    let len = 6.0;
    let c0 = palette[u32(fmod(len * index - 1, len))];
    let c1 = palette[u32(fmod(len * index, len))];
    let t = fmod(len * index, 1);
    return c0 + t * (c1 - c0);
}

fn interpolatePalette2Color(palette: array<vec3f, 2>, index: f32) -> vec3f {
    let len = 2.0;
    let c0 = palette[u32(fmod(len * index - 1, len))];
    let c1 = palette[u32(fmod(len * index, len))];
    let t = fmod(len * index, 1);
    return c0 + t * (c1 - c0);
}

fn getPalette6Color(palette: array<vec3f, 6>, index: f32) -> vec3f {
    return palette[u32(fmod(index, 1) * 6)];
}

fn getPalette2Color(palette: array<vec3f, 2>, index: f32) -> vec3f {
    return palette[u32(fmod(index, 1) * 2)];
}

// --- Julia functions

fn rainbowColor(escapeVelocity: u32) -> vec3f {
    return interpolatePalette6Color(RAINBOW, f32(escapeVelocity) / 200);
}

fn electricColor(escapeVelocity: u32) -> vec3f {
    return interpolatePalette2Color(ELECTRIC, f32(escapeVelocity) / 200);
}

fn zebraColor(escapeVelocity: u32) -> vec3f {
    return getPalette2Color(ZEBRA, f32(escapeVelocity) / 5);
}

fn getEscapeVelocity(c: vec2f, maxIter: u32) -> u32 {
    var z = vec2f(0);
    for (var i = 0u; i < maxIter; i += 1u) {
        // Compute z = z² + c, where z² is computed using complex multiplication.
        z = complexSquare(z) + c;

        // If the magnitude of z exceeds 2.0 (i.e., |z|² > 4), the point escapes.
        if (dot(z, z) > 4) {
            return i;
        }
    }
    return maxIter;
}

fn getEscapeVelocityPerturb(delta0: vec2f, maxIter: u32) -> u32 {
    // We'll do a loop up to maxIter, reading the reference Xₙ and
    // iterating ∆ₙ = Yₙ - Xₙ.
    var delta = delta0;

    for (var i = 0u; i < maxIter; i += 1u) {
        let Xn = referenceOrbit[i];
        // ∆ₙ₊₁ = (2 * Xₙ + ∆ₙ) * ∆ₙ + ∆₀
        delta = complexMul(2 * Xn + delta, delta) + delta0;

        if (dot(delta, delta) > 4) {
            return i;
        }
    }
    return maxIter;
}

// --- Rendering functions

const ELECTRIC_PALETTE_ID = 0u;
const RAINBOW_PALETTE_ID = 1u;
const ZEBRA_PALETTE_ID = 2u;

fn renderOne(fragCoord: vec2f, scaleFactor: vec2f) -> vec3f {
    let maxIter = u.maxIter;
    var escapeVelocity = 0u;
    if u.usePerturbation == 0 {
        let c = u.center + (fragCoord - 0.5 * u.resolution) * scaleFactor;
        escapeVelocity = getEscapeVelocity(c, maxIter);
    } else {
        let delta0 = (fragCoord - u.center) * scaleFactor;
        escapeVelocity = getEscapeVelocityPerturb(delta0, maxIter);
    }

    if (escapeVelocity == maxIter) {
        return BLACK;
    }
    switch (u.paletteId) {
        case RAINBOW_PALETTE_ID: {
            return rainbowColor(escapeVelocity);
        }
        case ZEBRA_PALETTE_ID: {
            return zebraColor(escapeVelocity);
        }
        default: {
            return electricColor(escapeVelocity); 
        }
    }
}

fn renderSuperSample(fragCoord: vec2f, scaleFactor: vec2f, samples: u32) -> vec3f {
    var color = vec3f(0);
    for (var i = 0u; i < samples; i += 1u) {
        // Add a random jitter in [-0.5, 0.5] to compute the value of the next sample.
        let jitter = vec2f(rand() - 0.5, rand() - 0.5);
        color += renderOne(fragCoord + jitter, scaleFactor);
    }

    return color / f32(samples);
}

@fragment
fn main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
    let scaleFactor = 4 / u.resolution.x * exp2(-u.zoom) * vec2f(1, -1);
    // return vec4f(interpolatePalette6Color(RAINBOW, fragCoord.xy.x / u.resolution.x + 0.5), 1);
    if (u.samples == 1) {
        return vec4f(renderOne(fragCoord.xy, scaleFactor), 1);
    } else {
        return vec4f(renderSuperSample(fragCoord.xy, scaleFactor, u.samples), 1);
    }
}
`;
