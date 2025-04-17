import { Orbit, FN_MANDELBROT, FN_JULIA } from "../julia.js";
import { getPaletteId } from "../palette.js";
import { hasWebgpu } from "./capabilities.js";
import { Renderer, RenderingEngine, RenderContext } from "./renderer.js"


const MAX_ITERATIONS = 10000; // can increase for deeper zoom if desired

export class WebgpuRenderer extends Renderer {
    static async create(canvas, ctx) {
        const renderer = new WebgpuRenderer(canvas, ctx);
        await renderer.init();
        return renderer;
    }
    constructor(canvas, ctx) {
        super();
        this.canvas = canvas;
        this.ctx = ctx;
        this.gpuDevice = undefined;
        this.offscreenCanvas = undefined;
        this.offscreenGpuContext = undefined;
        this.gpuPipeline = undefined;
        this.gpuUniformBuffer = undefined;
        this.gpuReferenceOrbitBuffer = undefined;
        this.gpuBindGroup = undefined;
    }

    id() {
        return RenderingEngine.WEBGPU;
    }

    async init() {
        if (!await hasWebgpu()) {
            throw new Error("Webgpu not supported");
        }
        const adapter = await navigator.gpu.requestAdapter();
        this.gpuDevice = await adapter.requestDevice();
        // ----------------------------------------------
        // 1. Create a hidden offscreen canvas + context
        // ----------------------------------------------
        this.offscreenCanvas = document.createElement("canvas");
        this.offscreenCanvas.style.display = "none";
        document.body.appendChild(this.offscreenCanvas);

        this.offscreenGpuContext = this.offscreenCanvas.getContext("webgpu");

        // Choose a preferred canvas format
        const format = navigator.gpu.getPreferredCanvasFormat();

        // Create our render pipeline
        this.gpuPipeline = this.gpuDevice.createRenderPipeline({
            layout: "auto",
            vertex: {
                module: this.gpuDevice.createShaderModule({
                    code: wgslVertexShader
                }),
                entryPoint: "main"
            },
            fragment: {
                module: this.gpuDevice.createShaderModule({
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
        this.gpuUniformBuffer = this.gpuDevice.createBuffer({
            size: 48,
            usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });

        // Create a buffer for the reference orbit data. We'll allocate enough for
        // 2 floats * MAX_ITERATIONS = 2*4*MAX_ITERATIONS bytes.
        const orbitBufferSize = 2 * 4 * MAX_ITERATIONS;
        this.gpuReferenceOrbitBuffer = this.gpuDevice.createBuffer({
            size: orbitBufferSize,
            usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST
        });

        this.gpuBindGroup = this.gpuDevice.createBindGroup({
            layout: this.gpuPipeline.getBindGroupLayout(0),
            entries: [
                {
                    binding: 0,
                    resource: {
                        buffer: this.gpuUniformBuffer
                    }
                },
                {
                    binding: 1,
                    resource: {
                        buffer: this.gpuReferenceOrbitBuffer
                    }
                }
            ]
        });
    }

    detach() {
        document.removeChild(this.offscreenCanvas);
    }

    render(map, options) {
        const maxIter = Math.min(options.maxIter, MAX_ITERATIONS);

        // ------------------------------------
        // 2. Configure our offscreen canvas
        // ------------------------------------
        const scale = Math.min(options.pixelDensity, 1);
        const w = Math.floor(this.canvas.width * scale);
        const h = Math.floor(this.canvas.height * scale);

        this.offscreenCanvas.width = w;
        this.offscreenCanvas.height = h;

        const format = navigator.gpu.getPreferredCanvasFormat();
        this.offscreenGpuContext.configure({
            device: this.gpuDevice,
            format: format,
            alphaMode: "premultiplied"
        });

        // ------------------------------------
        // 3. Write fractal parameters to GPU
        // ------------------------------------
        let orbit = undefined;
        if (options.deep) {
            switch (options.fn.id) {
                case FN_MANDELBROT:
                    orbit = Orbit.searchForMandelbrot(map, w, h, options.maxIter);
                    break;
                case FN_JULIA:
                    orbit = Orbit.searchForJulia(map, w, h, options.maxIter, options.fn.param0);
                    break;
            }
        }
        const samples = Math.floor(Math.max(options.pixelDensity, 1));

        const uniformArray = new ArrayBuffer(48);
        const dataView = new DataView(uniformArray);
        dataView.setUint32(0, options.deep ? 1 : 0, true);    // usePerturbation
        dataView.setFloat32(4, map.zoom, true);      // zoom
        dataView.setFloat32(8, orbit ? orbit.sx : map.x, true);  // center
        dataView.setFloat32(12, orbit ? orbit.sy : map.y, true); // center
        dataView.setFloat32(16, w, true);              // resolution
        dataView.setFloat32(20, h, true);              // resolution
        dataView.setUint32(24, options.maxIter, true);         // maxIter
        dataView.setUint32(28, samples, true);         // samples
        dataView.setUint32(32, getPaletteId(options.palette), true); // paletteId
        dataView.setUint32(36, options.fn.id, true);                 // functionId
        dataView.setFloat32(40, options.fn.param0.x, true);          // param0
        dataView.setFloat32(44, options.fn.param0.y, true);          // param0

        this.gpuDevice.queue.writeBuffer(this.gpuUniformBuffer, 0, uniformArray);

        if (orbit) {
            this.gpuDevice.queue.writeBuffer(this.gpuReferenceOrbitBuffer, 0, orbit.iters);
        }

        // Acquire a texture to render into (offscreen)
        const renderView = this.offscreenGpuContext.getCurrentTexture().createView();

        // Build the command pass
        const commandEncoder = this.gpuDevice.createCommandEncoder();
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

        passEncoder.setPipeline(this.gpuPipeline);
        passEncoder.setBindGroup(0, this.gpuBindGroup);
        passEncoder.draw(4, 1, 0, 0); // 4 verts => full-screen quad
        passEncoder.end();

        const gpuCommands = commandEncoder.finish();
        this.gpuDevice.queue.submit([gpuCommands]);

        // ------------------------------------
        // 4. Blit from offscreen -> main canvas
        // ------------------------------------
        // Use the main canvas's 2D context to draw the offscreen image:
        // If you want a simple "centered" or "fit" approach, you can do:
        this.ctx.save();
        this.ctx.scale(1 / scale, 1 / scale);
        this.ctx.drawImage(this.offscreenCanvas, 0, 0);
        this.ctx.restore();

        return new RenderContext(this.id(), options);
    }
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
    functionId     : u32,
    param0         : vec2f,
};

@group(0) @binding(0)
var<uniform> u: FractalUniforms;

@group(0) @binding(1)
var<storage, read> referenceOrbit: array<vec2f, ${MAX_ITERATIONS}>;

// --- Math functions

// Compute c² on a complex number.
fn complexSquare(c: vec2f) -> vec2f {
    return vec2f(c.x * c.x - c.y * c.y, 2 * c.x * c.y);
}

// Compute c₀ x c₁ for 2 complex numbers.
fn complexMul(c0: vec2f, c1: vec2f) -> vec2f {
    return vec2f(c0.x * c1.x - c0.y * c1.y, c0.x * c1.y + c0.y * c1.x);
}

// Compute |c|², the square of the modulus of a complex number.
fn complexSquareMod(c: vec2f) -> f32 {
    return dot(c, c);
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

// Same color palette as used on the Wikipedia page: https://en.wikipedia.org/wiki/Mandelbrot_set
const WIKI0 = vec3f(  0,   7, 100) / 255.0;
const WIKI1 = vec3f( 32, 107, 203) / 255.0;
const WIKI2 = vec3f(237, 255, 255) / 255.0;
const WIKI3 = vec3f(255, 170,   0) / 255.0;
const WIKI4 = vec3f(  0,   2,   0) / 255.0;
const WIKIPEDIA = array<vec3f, 5>(WIKI0, WIKI1, WIKI2, WIKI3, WIKI4);

fn interpolatePalette6Color(palette: array<vec3f, 6>, index: f32) -> vec3f {
    let len = 6.0;
    let c0 = palette[u32(fmod(len * index - 1, len))];
    let c1 = palette[u32(fmod(len * index, len))];
    let t = fmod(len * index, 1);
    return c0 + t * (c1 - c0);
}

fn interpolatePalette5Color(palette: array<vec3f, 5>, index: f32) -> vec3f {
    let len = 5.0;
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

fn wikipediaColor(escapeVelocity: u32) -> vec3f {
    return interpolatePalette5Color(WIKIPEDIA, f32(escapeVelocity) / 50);
}

const ELECTRIC_PALETTE_ID = 0u;
const RAINBOW_PALETTE_ID = 1u;
const ZEBRA_PALETTE_ID = 2u;
const WIKIPEDIA_PALETTE_ID = 3u;

fn getColor(escapeVelocity: u32) -> vec3f {
    if (escapeVelocity == u.maxIter) {
        return BLACK;
    }
    switch (u.paletteId) {
        case ELECTRIC_PALETTE_ID: {
            return electricColor(escapeVelocity);
        }
        case RAINBOW_PALETTE_ID: {
            return rainbowColor(escapeVelocity);
        }
        case ZEBRA_PALETTE_ID: {
            return zebraColor(escapeVelocity);
        }
        case WIKIPEDIA_PALETTE_ID, default: {
            return wikipediaColor(escapeVelocity); 
        }
    }
}

const FN_MANDELBROT = 0u;
const FN_JULIA = 1u;

fn mandelbrot(c: vec2f, maxIter: u32) -> u32 {
    var z = vec2f(0);
    for (var i = 0u; i < maxIter; i += 1u) {
        // Compute z = z² + c, where z² is computed using complex multiplication.
        z = complexSquare(z) + c;

        // If the magnitude of z exceeds 2.0 (|z|² > 4), the point escapes.
        if (complexSquareMod(z) > 4) {
            return i;
        }
    }
    return maxIter;
}

fn julia(z0: vec2f, c: vec2f, maxIter: u32) -> u32 {
    var z = z0;
    for (var i = 0u; i < maxIter; i += 1u) {
        // Compute z = z² + c, where z² is computed using complex multiplication.
        z = complexSquare(z) + c;

        // If the magnitude of z exceeds 2.0 (|z|² > 4), the point escapes.
        if (complexSquareMod(z) > 4) {
            return i;
        }
    }
    return maxIter;
}

fn mandelbrotPerturb(dc: vec2f, maxIter: u32) -> u32 {
    // We'll do a loop up to maxIter, reading the reference Xₙ and
    // iterating ∆ₙ = Yₙ - Xₙ.
    var dz = vec2f(0);
    var z = referenceOrbit[0];

    for (var i = 0u; i < maxIter; i += 1u) {
        // dz = (2 * z + dz) * dz + dc
        dz = complexMul(2 * z + dz, dz) + dc;
        z = referenceOrbit[i + 1];

        if (complexSquareMod(z + dz) > 4) {
            return i;
        }
    }
    return maxIter;
}

fn juliaPerturb(dz0: vec2f, maxIter: u32) -> u32 {
    // We'll do a loop up to maxIter, reading the reference Xₙ and
    // iterating ∆ₙ = Yₙ - Xₙ.
    var dz = dz0;
    var z = referenceOrbit[0];

    for (var i = 0u; i < maxIter; i += 1u) {
        // ∆ₙ₊₁ = (2 * Xₙ + ∆ₙ) * ∆ₙ
        dz = complexMul(2 * z + dz, dz);
        z = referenceOrbit[i + 1];

        if (complexSquareMod(z + dz) > 4) {
            return i;
        }
    }
    return maxIter;
}

// --- Rendering functions

fn renderOne(fragCoord: vec2f, scaleFactor: vec2f) -> vec3f {
    let maxIter = u.maxIter;
    var escapeVelocity = 0u;
    if u.usePerturbation == 0 {
        let pos = u.center + (fragCoord - 0.5 * u.resolution) * scaleFactor;
        switch (u.functionId) {
            case FN_JULIA: {
                escapeVelocity = julia(pos, u.param0, maxIter);
            }
            case FN_MANDELBROT, default: {
                escapeVelocity = mandelbrot(pos, maxIter);
            }
        }
    } else {
        let delta = (fragCoord - u.center) * scaleFactor;
        switch (u.functionId) {
            case FN_JULIA: {
                escapeVelocity = juliaPerturb(delta, maxIter);
            }
            case FN_MANDELBROT, default: {
                escapeVelocity = mandelbrotPerturb(delta, maxIter);
            }
        }
    }

    return getColor(escapeVelocity);
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
