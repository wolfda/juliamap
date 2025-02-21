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
export function getJuliaSeries(x0, y0, maxIter) {
    let x = x0;
    let y = y0;

    const points = new Float32Array(2 * maxIter);

    for (let i = 0; i < maxIter; i++) {
        points[2 * i] = x;
        points[2 * i + 1] = y;

        const x2 = x * x - y * y + x0;
        const y2 = 2.0 * x * y + y0;
        x = x2;
        y = y2;
    }
    return points;
}