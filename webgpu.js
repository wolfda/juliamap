import { Orbit } from "./julia.js";
import { getMapState } from "./map.js";
import { canvas, ctx } from "./state.js";

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
            size: 32,
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

/**
 * Render fractal with WebGPU into an offscreen canvas, then blit to the visible canvas.
 */
export function renderFractalWebGPU(scale = 1, deep = false, maxIter = DEFAULT_MAX_ITERATIONS) {
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

    const uniformArray = new ArrayBuffer(32);
    const dataView = new DataView(uniformArray);
    dataView.setUint32(0, deep ? 1 : 0, true);    // usePerturbation
    dataView.setFloat32(4, state.zoom, true);      // zoom
    dataView.setFloat32(8, orbit ? orbit.sx : state.x, true);  // center
    dataView.setFloat32(12, orbit ? orbit.sy : state.y, true); // center
    dataView.setFloat32(16, w, true);              // resolution
    dataView.setFloat32(20, h, true);              // resolution
    dataView.setUint32(24, maxIter, true);         // maxIter
    dataView.setUint32(28, samples, true)          // samples

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
 * WGSL Shaders (updated to model complex numbers as vec2<f32>)
 * --------------------------------------------------------- */

const wgslVertexShader = /* wgsl */ `
@vertex
fn main(@builtin(vertex_index) vertexIndex : u32) -> @builtin(position) vec4f {
    // We'll draw 2 triangles that cover the entire clip space:
    //   vertexIndex: 0,1,2,3 => positions in a strip
    let x = f32((vertexIndex & 1u) << 1u) - 1.0; // 0->-1, 1->1, 2->-1, 3->1
    let y = f32((vertexIndex & 2u)) - 1.0;      // 0->-1, 1->-1, 2->1, 3->1
    return vec4f(x, y, 0.0, 1.0);
}
`;

const wgslFragmentShader = /* wgsl */ `
struct FractalUniforms {
    usePerturbation: u32,
    zoom           : f32,
    center         : vec2<f32>,
    resolution     : vec2<f32>,
    maxIter        : u32,
    samples        : u32,
};

@group(0) @binding(0)
var<uniform> u : FractalUniforms;

@group(0) @binding(1)
var<storage, read> referenceOrbit : array<vec2<f32>, ${MAX_ITERATIONS}>;

// Function to perform complex square using vec2<f32> to represent complex numbers.
fn complexSquare(a: vec2<f32>) -> vec2<f32> {
    return vec2<f32>(
        a.x * a.x - a.y * a.y,  // real part
        2.0 * a.x * a.y         // imaginary part
    );
}

// Function to perform complex square using vec2<f32> to represent complex numbers.
fn complexMul(a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
    return vec2<f32>(
        a.x * b.x - a.y * b.y,  // real part
        a.x * b.y + a.y * b.x   // imaginary part
    );
}

fn getEscapeVelocity(c: vec2<f32>, maxIter: u32) -> u32 {
    var z: vec2<f32> = vec2<f32>(0.0, 0.0);
    for (var i = 0u; i < maxIter; i += 1u) {
        // Compute z = z² + c, where z² is computed using complex multiplication.
        z = complexSquare(z) + c;

        // If the magnitude of z exceeds 2.0 (i.e., |z|² > 4.0), the point escapes.
        if (dot(z, z) > 4.0) {
            return i;
        }
    }
    return maxIter;
}

fn getEscapeVelocityPerturb(delta0: vec2<f32>, maxIter: u32) -> u32 {
    // We'll do a loop up to maxIter, reading the reference Xₙ and
    // iterating ∆ₙ = Yₙ - Xₙ.
    var delta = delta0;

    for (var i = 0u; i < maxIter; i += 1u) {
        let Xn = referenceOrbit[i];
        // ∆ₙ₊₁ = (2 * Xₙ + ∆ₙ) * ∆ₙ + ∆₀
        delta = complexMul(2.0 * Xn + delta, delta) + delta0;

        if (dot(delta, delta) > 4.0) {
            return i;
        }
    }
    return maxIter;
}

var<private> seed: u32 = 123456789u;

fn rand() -> f32 {
    seed ^= seed << 13;
    seed ^= seed >> 17;
    seed ^= seed << 5;
    // Convert the new seed to a float in the [0, 1) range.
    // Note: 0xffffffffu is the maximum for u32.
    return f32(seed) / f32(0xffffffffu);
}

fn renderOne(fragCoord: vec2f, scaleFactor: vec2f) -> vec4f {
    let maxIter = u.maxIter;
    var escapeValue = 0u;
    if u.usePerturbation == 0 {
        let c = u.center + (fragCoord - 0.5 * u.resolution) * scaleFactor;
        escapeValue = getEscapeVelocity(c, maxIter);
    } else {
        let delta0 = (fragCoord - u.center) * scaleFactor;
        escapeValue = getEscapeVelocityPerturb(delta0, maxIter);
    }

    if (escapeValue == maxIter) {
        // inside => black
        return vec4f(0.0, 0.0, 0.0, 1.0);
    } else {
        // outside => color = (c, c, 1)
        let col = 1.0 - f32(escapeValue) / f32(maxIter);
        return vec4f(col, col, 1.0, 1.0);
    }
}

fn renderSuperSample(fragCoord: vec2f, scaleFactor: vec2f, samples: u32) -> vec4f {
    var color = vec4f(0.0);
    for (var i = 0u; i < samples; i += 1u) {
        // Add a random jitter in [-0.5, 0.5] to compute the value of the next sample.
        let jitter = vec2f(rand() - 0.5, rand() - 0.5);
        color += renderOne(fragCoord + jitter, scaleFactor);
    }

    return color / f32(samples);
}

@fragment
fn main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
    let scaleFactor = 4.0 / u.resolution.x * exp2(-u.zoom) * vec2<f32>(1, -1);
    if (u.samples == 1) {
        return renderOne(fragCoord.xy, scaleFactor);
    } else {
        return renderSuperSample(fragCoord.xy, scaleFactor, u.samples);
    }
}
`;
