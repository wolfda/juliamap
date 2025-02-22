import { screenToComplex } from "./map.js";

export function getEscapeVelocity(x0, y0, maxIter) {
    let x = 0;
    let y = 0;
    for (let i = 0; i < maxIter; i++) {
        // Xₙ₊₁ = Xₙ² + X₀
        const xn = x * x - y * y + x0;
        const yn = 2.0 * x * y + y0;
        x = xn;
        y = yn;

        // If we escape radius > 2, break out
        if (x * x + y * y > 4.0) {
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
        this.escapeVelocity = getEscapeVelocity(candidate.cx, candidate.cy, maxIter);
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
