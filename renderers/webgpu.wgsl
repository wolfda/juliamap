struct FractalUniforms {
    usePerturbation: u32,
    zoom           : f32,
    center         : vec2f,
    resolution     : vec2f,
    maxIter        : u32,
    maxSamples     : u32,
    paletteId      : u32,
    paletteInterpolation: u32,
    functionId     : u32,
    _padding0      : u32,
    param0         : vec2f,
    scale          : f32,
    perturbScale   : f32,
};

struct AtomicU64 {
    lo: atomic<u32>,
    hi: atomic<u32>,
};

@group(0) @binding(0)
var<uniform> u: FractalUniforms;

@group(0) @binding(1)
var<storage, read> referenceOrbit: array<vec2f, {{MAX_ITERATIONS}}>;

@group(0) @binding(2)
var<storage, read_write> iterationCounter: AtomicU64;

const MIN_VARIANCE_SAMPLES: u32 = {{MIN_VARIANCE_SAMPLES}}u;
const SUPER_SAMPLE_VARIANCE: f32 = {{SUPER_SAMPLE_VARIANCE}};

// --- Math functions

// Compute c^2 on a complex number.
fn complexSquare(c: vec2f) -> vec2f {
    return vec2f(c.x * c.x - c.y * c.y, 2 * c.x * c.y);
}

// Compute c0 x c1 for 2 complex numbers.
fn complexMul(c0: vec2f, c1: vec2f) -> vec2f {
    return vec2f(c0.x * c1.x - c0.y * c1.y, c0.x * c1.y + c0.y * c1.x);
}

// Compute |c|^2, the square of the modulus of a complex number.
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
const UNUSED = BLACK;

const MAX_COLORS: u32 = 6u;
const ELECTRIC = array<vec3f, MAX_COLORS>(BLUE, WHITE, UNUSED, UNUSED, UNUSED, UNUSED);
const RAINBOW = array<vec3f, MAX_COLORS>(YELLOW, GREEN, CYAN, BLUE, MAGENTA, RED);
const ZEBRA = array<vec3f, MAX_COLORS>(WHITE, BLACK, UNUSED, UNUSED, UNUSED, UNUSED);

// Same color palette as used on the Wikipedia page: https://en.wikipedia.org/wiki/Mandelbrot_set
const WIKI0 = vec3f(  0,   7, 100) / 255.0;
const WIKI1 = vec3f( 32, 107, 203) / 255.0;
const WIKI2 = vec3f(237, 255, 255) / 255.0;
const WIKI3 = vec3f(255, 170,   0) / 255.0;
const WIKI4 = vec3f(  0,   2,   0) / 255.0;
const WIKIPEDIA = array<vec3f, MAX_COLORS>(WIKI0, WIKI1, WIKI2, WIKI3, WIKI4, UNUSED);
const WIKIPEDIA_POSITIONS = array<f32, MAX_COLORS>(0.0, 0.16, 0.42, 0.6425, 0.8575, 1.0);

const PALETTE_INTERPOLATION_LINEAR = 0u;
const PALETTE_INTERPOLATION_SPLINE = 1u;

// Interpolate the color with the given palette, using spline interpolation.
fn interpolatePaletteSpline(palette: array<vec3f, MAX_COLORS>, count: u32, t: f32) -> vec3f {
    let wrapped = fract(t);
    let scaled = wrapped * f32(count);
    let i = u32(min(scaled, f32(count) - 0.001));
    let localT = scaled - f32(i);

    let i0 = i;
    let i1 = (i + 1u) % count;
    let im1 = (i + count - 1u) % count;
    let i2 = (i + 2u) % count;

    let p0 = palette[i0];
    let p1 = palette[i1];

    let m0 = 0.5 * (palette[i1] - palette[im1]);
    let m1 = 0.5 * (palette[i2] - palette[i0]);

    let t2 = localT * localT;
    let t3 = t2 * localT;

    return (2.0 * t3 - 3.0 * t2 + 1.0) * p0
        + (t3 - 2.0 * t2 + localT) * m0
        + (-2.0 * t3 + 3.0 * t2) * p1
        + (t3 - t2) * m1;
}

// Interpolate the color with the given palette, using linear interpolation.
fn interpolatePaletteLinear(palette: array<vec3f, MAX_COLORS>, count: u32, t: f32) -> vec3f {
    let wrapped = fract(t);
    let scaled = wrapped * f32(count);
    let i = u32(min(scaled, f32(count) - 0.001));
    let localT = scaled - f32(i);

    let c0 = palette[i];
    let c1 = palette[(i + 1u) % count];

    return c0 + localT * (c1 - c0);
}

// Interpolate the color with the given color palette, with fixed positions and spline interpolation
fn interpolatePaletteSplinePos(
    palette: array<vec3f, MAX_COLORS>,
    positions: array<f32, MAX_COLORS>,
    count: u32,
    index: f32
) -> vec3f {
    let lastIndex = count - 1u;
    let t = fmod(index, 1.0);

    let firstPos = positions[0];
    let lastPos = positions[lastIndex];
    if (t <= firstPos) {
        return palette[0];
    }
    if (t >= lastPos) {
        let span = 1.0 - lastPos + firstPos;
        let wrapT = (t - lastPos) / span;
        let u = (f32(lastIndex) + wrapT) / f32(count);
        return interpolatePaletteSpline(palette, count, u);
    }

    for (var i = 0u; i < lastIndex; i += 1u) {
        let t0 = positions[i];
        let t1 = positions[i + 1u];
        if (t >= t0 && t <= t1) {
            let localT = (t - t0) / (t1 - t0);
            let u = (f32(i) + localT) / f32(count);
            return interpolatePaletteSpline(palette, count, u);
        }
    }

    return palette[lastIndex];
}

// Interpolate the color with the given color palette, with fixed positions and linear interpolation
fn interpolatePaletteLinearPos(
    palette: array<vec3f, MAX_COLORS>,
    positions: array<f32, MAX_COLORS>,
    count: u32,
    index: f32
) -> vec3f {
    let lastIndex = count - 1u;
    let t = fmod(index, 1.0);

    let firstPos = positions[0];
    let lastPos = positions[lastIndex];
    if (t <= firstPos) {
        return palette[0];
    }
    if (t >= lastPos) {
        let span = 1.0 - lastPos + firstPos;
        let wrapT = (t - lastPos) / span;
        let u = (f32(lastIndex) + wrapT) / f32(count);
        return interpolatePaletteLinear(palette, count, u);
    }

    for (var i = 0u; i < lastIndex; i += 1u) {
        let t0 = positions[i];
        let t1 = positions[i + 1u];
        if (t >= t0 && t <= t1) {
            let localT = (t - t0) / (t1 - t0);
            let u = (f32(i) + localT) / f32(count);
            return interpolatePaletteLinear(palette, count, u);
        }
    }

    return palette[lastIndex];
}

fn interpolatePalette(palette: array<vec3f, MAX_COLORS>, count: u32, t: f32) -> vec3f {
    if (u.paletteInterpolation == PALETTE_INTERPOLATION_LINEAR) {
        return interpolatePaletteLinear(palette, count, t);
    }
    return interpolatePaletteSpline(palette, count, t);
}

fn interpolatePalettePos(
    palette: array<vec3f, MAX_COLORS>,
    positions: array<f32, MAX_COLORS>,
    count: u32,
    index: f32
) -> vec3f {
    if (u.paletteInterpolation == PALETTE_INTERPOLATION_LINEAR) {
        return interpolatePaletteLinearPos(palette, positions, count, index);
    }
    return interpolatePaletteSplinePos(palette, positions, count, index);
}

fn getPaletteColor(palette: array<vec3f, MAX_COLORS>, count: u32, index: f32) -> vec3f {
    return palette[u32(fmod(index, 1.0) * f32(count))];
}

// --- Julia / Mandelbrot coloring

fn rainbowColor(escapeVelocity: f32) -> vec3f {
    return interpolatePalette(RAINBOW, 6u, escapeVelocity / 150);
}

fn electricColor(escapeVelocity: f32) -> vec3f {
    return interpolatePalette(ELECTRIC, 2u, escapeVelocity / 100);
}

fn zebraColor(escapeVelocity: f32) -> vec3f {
    return getPaletteColor(ZEBRA, 2u, escapeVelocity / 5);
}

fn wikipediaColor(escapeVelocity: f32) -> vec3f {
    return interpolatePalettePos(
        WIKIPEDIA,
        WIKIPEDIA_POSITIONS,
        5u,
        escapeVelocity / 150
    );
}

const ELECTRIC_PALETTE_ID = 0u;
const RAINBOW_PALETTE_ID = 1u;
const ZEBRA_PALETTE_ID = 2u;
const WIKIPEDIA_PALETTE_ID = 3u;

fn getColor(escapeVelocity: f32) -> vec3f {
    if (escapeVelocity >= f32(u.maxIter)) {
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
const BAILOUT = 128;

fn isFinite(x: f32) -> bool {
    return x * 0.0 == 0.0;
}

fn smoothEscapeVelocity(iter: u32, squareMod: f32) -> f32 {
    if (!isFinite(squareMod) || squareMod <= 0.0) {
        return f32(iter);
    }
    let mag = sqrt(squareMod);
    // nu = n + 1 - log2(log(|z|))
    return f32(iter) + 1.0 - log2(log(mag));
}
  
fn incrementIterations(value: u32) {
    let prev = atomicAdd(&iterationCounter.lo, value);
    if (prev + value < prev) { // Overflow detected
        atomicAdd(&iterationCounter.hi, 1u);
    }
}

fn julia(z0: vec2f, c: vec2f, maxIter: u32) -> f32 {
    var z = z0;
    for (var i = 0u; i < maxIter; i += 1u) {
        // Compute z = z^2 + c, where z^2 is computed using complex multiplication.
        z = complexSquare(z) + c;

        // If the magnitude of z exceeds 2.0 (|z|^2 > 4), the point escapes.
        let squareMod = complexSquareMod(z);
        if (squareMod > BAILOUT * BAILOUT) {
            incrementIterations(i);
            return smoothEscapeVelocity(i, squareMod);
        }
    }
    incrementIterations(maxIter);
    return f32(maxIter);
}

fn juliaPerturb(dz0_hat: vec2f, dc_hat: vec2f, maxIter: u32) -> f32 {
    // dz_hat and dc_hat are the *scaled* perturbations.
    var dz_hat = dz0_hat;
    var z = referenceOrbit[0];

    let s = u.perturbScale;

    for (var i = 0u; i < maxIter; i += 1u) {
        // dzhat_{n+1} = (2 z_n + s dzhat_n) dzhat_n + dchat
        dz_hat = complexMul(2.0 * z + s * dz_hat, dz_hat) + dc_hat;

        // Reconstruct the true orbit: w_n = z_n + s dzhat_n
        let w = z + s * dz_hat;
        let squareMod = complexSquareMod(w);

        if (squareMod > BAILOUT * BAILOUT) {
            incrementIterations(i);
            return smoothEscapeVelocity(i, squareMod);
        }

        z = referenceOrbit[i + 1];
    }
    incrementIterations(maxIter);
    return f32(maxIter);
}

// --- Rendering functions

fn renderOne(fragCoord: vec2f, scaleFactor: vec2f) -> vec3f {
    let maxIter = u.maxIter;
    var escapeVelocity = 0.0;
    if u.usePerturbation == 0 {
        let pos = u.center + (fragCoord - 0.5 * u.resolution) * scaleFactor;
        switch (u.functionId) {
            case FN_JULIA: {
                escapeVelocity = julia(pos, u.param0, maxIter);
            }
            case FN_MANDELBROT, default: {
                escapeVelocity = julia(vec2f(0), pos, maxIter);
            }
        }
    } else {
        let delta = (fragCoord - u.center) * scaleFactor;
        switch (u.functionId) {
            case FN_JULIA: {
                escapeVelocity = juliaPerturb(delta, vec2f(0), maxIter);
            }
            case FN_MANDELBROT, default: {
                escapeVelocity = juliaPerturb(vec2f(0), delta, maxIter);
            }
        }
    }

    return getColor(escapeVelocity);
}

fn renderSuperSample(fragCoord: vec2f, scaleFactor: vec2f) -> vec3f {
    var mean = vec3f(0);
    var m2 = vec3f(0);
    var sampleCount: u32 = 0u;

    for (var i = 0u; i < u.maxSamples; i += 1u) {
        // Add a random jitter in [-0.5, 0.5] to compute the value of the next sample.
        let jitter = vec2f(rand() - 0.5, rand() - 0.5);
        let sample = renderOne(fragCoord + jitter, scaleFactor);
        sampleCount += 1u;

        // Welford's algorithm for per-channel variance.
        let delta = sample - mean;
        mean += delta / f32(sampleCount);
        let delta2 = sample - mean;
        m2 += delta * delta2;

        let minVarianceSamples = min(u.maxSamples, MIN_VARIANCE_SAMPLES);
        if (sampleCount >= minVarianceSamples) {
            let denom = max(f32(sampleCount - 1u), 1.0);
            let variance = m2 / denom;
            let maxVariance = max(variance.r, max(variance.g, variance.b));
            if (maxVariance <= SUPER_SAMPLE_VARIANCE) {
                break;
            }
        }
    }

    return mean;
}

@fragment
fn main(@builtin(position) fragCoord: vec4f) -> @location(0) vec4f {
    // Per-pixel scale in the complex plane (already rescaled on the CPU).
    let scaleFactor = u.scale * vec2f(1.0, -1.0);

    if (u.maxSamples == 1u) {
        return vec4f(renderOne(fragCoord.xy, scaleFactor), 1.0);
    } else {
        return vec4f(renderSuperSample(fragCoord.xy, scaleFactor), 1.0);
    }
}
