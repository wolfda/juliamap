import { Complex } from "./complex.js";

export const FN_MANDELBROT = 0;
export const FN_JULIA = 1;

export class Fn {
    constructor(id, param0) {
        this.id = id
        this.param0 = param0 || new Complex(0, 0);
    }
}

export const DEFAULT_FN = new Fn(FN_MANDELBROT);

export function julia(z0, c, maxIter) {
    let z = new Complex(z0.x, z0.y);
    for (let i = 0; i < maxIter; i++) {
        // z = z² + c, where z² is computed using complex multiplication.
        z.square();
        z.add(c);

        // If the magnitude exceeds 2.0 (|z|² > 4), the point escapes.
        if (z.squareMod() > 4.0) {
            return i;
        }
    }

    return maxIter;
}


/**
 * Compute the series for the center up to maxIter.
 * We store each Zₙ in a Float32Array as (x, y).
 */
export function juliaSeries(z0, c, count) {
    const points = new Float32Array(2 * count);

    let z = new Complex(z0.x, z0.y);
    for (let i = 0; i < count; i++) {
        points[2 * i] = z.x;
        points[2 * i + 1] = z.y;

        // z = z² + c
        z.square();
        z.add(c);
    }
    return points;
}


// TODO: pass cx, cy in BigInt
export function juliaBigInt(cx, cy, maxIter, zoomLevel) {
    const precisionBits = BigInt(10 + 2 * Math.ceil(zoomLevel));
    const precisionBitsMinusOne = precisionBits - BigInt(1);
    const big_one = BigInt(1) << precisionBits;
    const big_four = BigInt(4) << precisionBits;

    // Convert initial coordinates to fixed precision BigInt
    const big_cx = BigInt(Math.floor(cx * Number(big_one)));
    const big_cy = BigInt(Math.floor(cy * Number(big_one)));

    let zx = BigInt(0);
    let zy = BigInt(0);
    let zx2 = BigInt(0);
    let zy2 = BigInt(0);
    for (let i = 0; i < maxIter; i++) {
        // Compute z = z² + c, where z² is computed using complex multiplication.
        const zxn = zx2 - zy2 + big_cx;
        const zyn = ((zx * zy) >> precisionBitsMinusOne) + big_cy;
        zx = zxn;
        zy = zyn;
        zx2 = (zx * zx) >> precisionBits;
        zy2 = (zy * zy) >> precisionBits;

        // If the magnitude of z exceeds 2.0 (|z|² > 4), the point escapes.
        if (zx2 + zy2 > big_four) {
            return i;
        }
    }

    return maxIter;
}


/**
 * An orbit is a reference point in the comlpex plan, with the precomputed Julia series.
 */
export class Orbit {
    static searchForMandelbrot(map, width, height, maxIter, maxSamples = 200) {
        return Orbit.searchOrbit(map, width, height, maxIter, function (pos, maxIter) {
            return julia(new Complex(0, 0), pos, maxIter);
        }, function (pos, maxIter) {
            return juliaSeries(new Complex(0, 0), pos, maxIter);
        }, maxSamples)
    }

    static searchForJulia(map, width, height, maxIter, c, maxSamples = 200) {
        return Orbit.searchOrbit(map, width, height, maxIter, function (pos, maxIter) {
            return julia(pos, c, maxIter);
        }, function (pos, maxIter) {
            return juliaSeries(pos, c, maxIter);
        }, maxSamples)
    }

    /**
     * Search for the orbit with the heighest escape velocity in the current viewport.
     */
    static searchOrbit(map, width, height, maxIter, escapeFn, seriesFn, maxSamples = 200) {
        let bestOrbit = null;

        for (let s = 0; s < maxSamples; s++) {
            const sx = Math.random() * width;
            const sy = Math.random() * height;
            const orbit = new Orbit(map, sx, sy, escapeFn, seriesFn).withEscape(width, height, maxIter);
            if (bestOrbit === null || orbit.escapeVelocity > bestOrbit.escapeVelocity) {
                bestOrbit = orbit;
            }
            if (bestOrbit.escapeVelocity === maxIter) {
                break;
            }
        }
        return bestOrbit.withSeries(width, height, maxIter);
    }

    /**
     * @param {number} sx screen x coordinate, in [0, width] 
     * @param {number} sy screen y coordinate, in [0, height]
     */
    constructor(map, sx, sy, escapeFn, seriesFn) {
        this.map = map;
        this.sx = sx;
        this.sy = sy;
        this.escapeFn = escapeFn;
        this.seriesFn = seriesFn;
        this.escapeVelocity = null;
        this.iters = null;
    }

    /**
     * Compute the escape velocity for the current orbit.
     */
    withEscape(width, height, maxIter) {
        const candidate = this.map.screenToComplex(this.sx, this.sy, width, height);
        this.escapeVelocity = this.escapeFn(new Complex(candidate.cx, candidate.cy), maxIter);
        return this;
    }

    /**
     * Compute the Julia series for the current coordinate.
     */
    withSeries(width, height, maxIter) {
        const candidate = this.map.screenToComplex(this.sx, this.sy, width, height);
        this.iters = this.seriesFn(new Complex(candidate.cx, candidate.cy), maxIter);
        return this;
    }
}
