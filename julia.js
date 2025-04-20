import { BigComplexPlane, Complex } from "./complex.js";

export const FN_MANDELBROT = 0;
export const FN_JULIA = 1;
const BAILOUT = 128;

export class Fn {
  constructor(id, param0) {
    this.id = id;
    this.param0 = param0 ?? new Complex(0, 0);
  }

  static julia(c) {
    return new Fn(FN_JULIA, new Complex(c.x, c.y));
  }
}

export const DEFAULT_FN = new Fn(FN_MANDELBROT);

function smoothEscapeVelocity(iter, squareMod) {
  return iter + 1 - Math.log(Math.log(squareMod)) / Math.log(2);
}

export function julia(z0, c, maxIter) {
  let z = new Complex(z0.x, z0.y);
  for (let i = 0; i < maxIter; i++) {
    // z = z² + c, where z² is computed using complex multiplication.
    z.square().add(c);

    // If the magnitude exceeds 2.0 (|z|² > 4), the point escapes.
    const squareMod = z.squareMod();
    if (squareMod > BAILOUT * BAILOUT) {
      return smoothEscapeVelocity(i, squareMod);
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
    z.square().add(c);
  }
  return points;
}

export function juliaBigComplex(z, c, maxIter) {
  const bigFour = z.plane.asBigInt(4);
  for (let i = 0; i < maxIter; i++) {
    z.square().add(c);

    // If the magnitude of z exceeds 2.0 (|z|² > 4), the point escapes.
    if (z.squareMod() > bigFour) {
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
    return Orbit.searchOrbit(
      map,
      width,
      height,
      maxIter,
      function (pos, maxIter) {
        return julia(new Complex(0, 0), pos, maxIter);
      },
      function (pos, maxIter) {
        return juliaSeries(new Complex(0, 0), pos, maxIter);
      },
      maxSamples
    );
  }

  static searchForJulia(map, width, height, maxIter, c, maxSamples = 200) {
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
