import { screenToComplex } from "./map.js";
import { Complex } from "./complex.js";

export function getEscapeVelocity(c, maxIter) {
    let z = new Complex(0, 0);
    let z2 = new Complex(0, 0);
    for (let i = 0; i < maxIter; i++) {
        // z = z² + c, where z² is computed using complex multiplication.
        z.setAdd(z2, c);

        // If the magnitude exceeds 2.0 (|z|² > 4), the point escapes.
        if (z.squareMod() > 4.0) {
            return i;
        }
        z2.setSquare(z);
    }

    return maxIter;
}

// TODO: pass cx, cy in BigInt
export function getEscapeVelocityBigInt(cx, cy, maxIter, zoomLevel) {
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
 * Compute the series for the center up to maxIter.
 * We store each Xₙ in a Float32Array as (x, y).
 */
export function getJuliaSeries(x0, y0, count) {
    let x = x0;
    let y = y0;

    const points = new Float32Array(2 * count);

    for (let i = 0; i < count; i++) {
        points[2 * i] = x;
        points[2 * i + 1] = y;

        const x2 = x * x - y * y + x0;
        const y2 = 2.0 * x * y + y0;
        x = x2;
        y = y2;
    }
    return points;
}


/**
 * An orbit is a reference point in the comlpex plan, with the precomputed Julia series.
 */
export class Orbit {
    /**
     * Search for the orbit with the heighest escape velocity in the current viewport.
     */
    static searchMaxEscapeVelocity(width, height, maxIter, maxSamples = 200) {
        let bestOrbit = null;

        for (let s = 0; s < maxSamples; s++) {
            const sx = Math.random() * width;
            const sy = Math.random() * height;
            const orbit = new Orbit(sx, sy).withEscapeVelocity(width, height, maxIter);
            if (bestOrbit === null || orbit.escapeVelocity > bestOrbit.escapeVelocity) {
                bestOrbit = orbit;
            }
            if (bestOrbit.escapeVelocity === maxIter) {
                break;
            }
        }
        return bestOrbit.withJuliaSeries(width, height, maxIter);
    }

    /**
     * @param {number} sx screen x coordinate, in [0, width] 
     * @param {number} sy screen y coordinate, in [0, height]
     */
    constructor(sx, sy) {
        this.sx = sx;
        this.sy = sy;
        this.escapeVelocity = null;
        this.iters = null;
    }

    /**
     * Compute the escape velocity for the current orbit.
     */
    withEscapeVelocity(width, height, maxIter) {
        const candidate = screenToComplex(this.sx, this.sy, width, height);
        this.escapeVelocity = getEscapeVelocity(new Complex(candidate.cx, candidate.cy), maxIter);
        return this;
    }

    /**
     * Compute the Julia series for the current coordinate.
     */
    withJuliaSeries(width, height, maxIter) {
        const candidate = screenToComplex(this.sx, this.sy, width, height);
        this.iters = getJuliaSeries(candidate.cx, candidate.cy, maxIter);
        return this;
    }
}
