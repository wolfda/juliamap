import { Complex, COMPLEX_PLANE } from "./complex.js";

export const FN_MANDELBROT = 0;
export const FN_JULIA = 1;
const BAILOUT = 128;

export class Fn {
  constructor(id, param0) {
    this.id = id;
    this.param0 = param0 ?? new Complex(0, 0);
  }

  static julia(c) {
    return new Fn(FN_JULIA, c);
  }
}

export const DEFAULT_FN = new Fn(FN_MANDELBROT);

function smoothEscapeVelocity(plane, iter, squareMod) {
  return iter + 1 - Math.log(plane.log2(squareMod) * Math.LN2) / Math.LN2;
}

export function julia(z0, c, maxIter) {
  let z = z0.clone();
  const plane = z0.plane ?? COMPLEX_PLANE;
  const bailout2 = plane.scalar(BAILOUT * BAILOUT);
  for (let i = 0; i < maxIter; i++) {
    // z = z² + c, where z² is computed using complex multiplication.
    z.square().add(c);

    // If the magnitude exceeds 2.0 (|z|² > 4), the point escapes.
    const squareMod = z.squareMod();
    if (squareMod > bailout2) {
      return smoothEscapeVelocity(plane, i, squareMod);
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

  let z = z0.clone();
  let zp = COMPLEX_PLANE.complex();
  let i;
  for (i = 0; i < count; i++) {
    zp.project(z);
    points[2 * i] = zp.x;
    points[2 * i + 1] = zp.y;

    // z = z² + c
    z.square().add(c);

    if (zp.squareMod() > BAILOUT * BAILOUT) {
      break;
    }
  }
  // After we bail out, fill in the remaining points with NaN.
  for (i++; i < count; i++) {
    points[2 * i] = NaN;
    points[2 * i + 1] = NaN;
  }
  return points;
}

/**
 * An orbit is a reference point in the comlpex plan, with the precomputed Julia series.
 */
export class Orbit {
  static searchForMandelbrot(map, width, height, maxIter, maxSamples = 200) {
    return Orbit.searchOrbit(
      map,
      width,
      height,
      maxIter,
      function (pos, maxIter) {
        return julia(map.plane.complex(0, 0), pos, maxIter);
      },
      function (pos, maxIter) {
        return juliaSeries(map.plane.complex(0, 0), pos, maxIter);
      },
      maxSamples
    );
  }

  static searchForJulia(map, width, height, maxIter, c, maxSamples = 200) {
    const plane = map.plane ?? COMPLEX_PLANE;
    c = plane.complex().project(c);
    return Orbit.searchOrbit(
      map,
      width,
      height,
      maxIter,
      function (pos, maxIter) {
        return julia(pos, c, maxIter);
      },
      function (pos, maxIter) {
        return juliaSeries(pos, c, maxIter);
      },
      maxSamples
    );
  }

  /**
   * Search for the orbit with the heighest escape velocity in the current viewport.
   */
  static searchOrbit(
    map,
    width,
    height,
    maxIter,
    escapeFn,
    seriesFn,
    maxSamples = 200
  ) {
    let bestOrbit = null;

    for (let s = 0; s < maxSamples; s++) {
      const sx = Math.random() * width;
      const sy = Math.random() * height;
      const orbit = new Orbit(map, sx, sy, escapeFn, seriesFn).withEscape(
        width,
        height,
        maxIter
      );
      if (
        bestOrbit === null ||
        orbit.escapeVelocity > bestOrbit.escapeVelocity
      ) {
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
    this.escapeVelocity = this.escapeFn(candidate, maxIter);
    return this;
  }

  /**
   * Compute the Julia series for the current coordinate.
   */
  withSeries(width, height, maxIter) {
    const candidate = this.map.screenToComplex(this.sx, this.sy, width, height);
    this.iters = this.seriesFn(candidate, maxIter);
    return this;
  }
}
