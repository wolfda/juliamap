// map.js
// --------------------------------------
// Responsibilities:
//  - Store complex coords: x, y, zoom
//  - Track velocities for pan & zoom
//  - Animate inertia over time (animate())
//  - Provide high-level methods like move(), zoomBy(), pinch()
//    which compute velocity automatically (no dt parameter from outside).
//  - Provide moveTo() to jump instantly, stop() to clear velocities.
//
// No references to screen or devicePixelRatio.
// main.js must convert from mouse/touch/wheel to fractal deltas.
// --------------------------------------

import { BigComplexPlane, Complex, COMPLEX_PLANE } from "./complex.js";

// Velocities
const MIN_VELOCITY = 1e-3;

// Internal friction factors
const PAN_FRICTION = 0.94;
const ZOOM_FRICTION = 0.95;

const NATIVE_COMPLEX_PRECISION = 40;

// Maximum allowed zoom level. Rendering becomes unstable past this point.
export const MAX_ZOOM = 120;

export class MapControl {
  constructor() {
    // We'll keep a single timestamp to measure time deltas
    // for move(), zoomBy(), pinch() calls.
    this.lastUpdateTime = null;

    // We track the inertia animation frame id so we can cancel it if needed
    this.inertiaRequestId = null;

    this.moveTo(COMPLEX_PLANE.complex(0, 0), 0);
  }

  /**
   * Immediately set the map to a specific location & zoom,
   * e.g. after reading from the URL.
   */
  moveTo(center, zoom) {
    this.plane = center.plane ?? COMPLEX_PLANE;
    this.center = center;
    this.velocity = this.plane.complex(0, 0);
    this.zoom = Math.min(Math.max(zoom, 0), MAX_ZOOM);
    this.vz = 0;
  }

  /**
   * Stop any ongoing inertia and set velocities to 0.
   * Can be called if you don't want inertia to continue
   * after, e.g., a wheel zoom.
   */
  stop() {
    this.velocity.set(this.plane.complex(0, 0));
    this.vz = 0;
    if (this.inertiaRequestId) {
      cancelAnimationFrame(this.inertiaRequestId);
      this.inertiaRequestId = null;
    }
  }
  /**
   * Convert screen coords to complex plane coords.
   */
  screenToComplex(sx, sy, width, height) {
    const c = this.plane.complex(0, 0).set(this.center);
    const scale = (4 / width) * Math.pow(2, -this.zoom);
    const delta = this.plane.complex(
      (sx - width * 0.5) * scale,
      -(sy - height * 0.5) * scale
    );
    return c.add(delta);
  }

  /**
   * Move the map by delta in fractal coords.
   * Velocity is computed automatically from the time between calls.
   *
   * @param {Complex} dz - delta in complex plane
   */
  move(dz) {
    const now = performance.now();
    // If this is the first call after user input begins, we won't have a last time
    if (this.lastUpdateTime === null) {
      this.lastUpdateTime = now;
      this.center.add(dz);
      return;
    }

    const dt = (now - this.lastUpdateTime) / 1000; // in seconds, or keep it in ms if you prefer
    this.lastUpdateTime = now;

    this.center.add(dz);

    // If dt is very small, avoid dividing by zero
    if (dt > 0) {
      // v = ∆z / ∆t
      this.velocity.set(dz).divScalar(dt);
    }
  }

  /**
   * Zoom by a factor (e.g., 1.1 => 10% zoom in).
   * Velocity is computed automatically from the time between calls.
   *
   * Typically, you'd want to do "pivot logic" in main.js
   * by calling move() before/after zoomBy() so as to keep
   * a certain fractal point stable.
   *
   * @param {number} dzoom - delta zoom.
   */
  zoomBy(dzoom) {
    const now = performance.now();
    if (this.lastUpdateTime === null) {
      this.lastUpdateTime = now;
      this.zoom += dzoom;
      return;
    }

    const dt = (now - this.lastUpdateTime) / 1000;
    this.lastUpdateTime = now;

    this.zoom += dzoom;

    // Clamp zoom within allowed range
    this.zoom = Math.min(Math.max(this.zoom, 0), MAX_ZOOM);

    if (dt > 0) {
      // vs is how quickly zoom is changing
      this.vz = dzoom / dt;
    }
  }

  zoomTo(newZoom) {
    this.zoomBy(newZoom - this.zoom);
  }

  maybeReproject() {
    const targetExponent =
      this.zoom <= NATIVE_COMPLEX_PRECISION
        ? undefined
        : 11 + Math.ceil(this.zoom);
    if (Number(this.plane.exponent) === targetExponent) {
      return;
    }

    this.plane =
      targetExponent === undefined
        ? COMPLEX_PLANE
        : new BigComplexPlane(targetExponent);
    const center = this.plane.complex().project(this.center);
    const velocity = this.plane.complex().project(this.velocity);
    this.center = center;
    this.velocity = velocity;
  }

  /**
   * The main inertia loop.
   * Call this, for example, on mouseup or touchend if you want to
   * continue panning/zooming with friction.
   *
   * @param {function(x: number, y: number, zoom: number)} onMapChange
   *        Callback that receives the new map state each frame.
   */
  animate(onMapChange) {
    // Cancel any existing inertia
    if (this.inertiaRequestId) {
      cancelAnimationFrame(inertiaRequestId);
    }

    // If speeds are negligible, do nothing
    const speedSq =
      this.plane.asNumber(this.velocity.squareMod()) + this.vz * this.vz;
    if (speedSq < MIN_VELOCITY * MIN_VELOCITY) {
      this.velocity.set(this.plane.complex(0, 0));
      this.vz = 0;
      return;
    }

    // If zoom is animating, cancel panning
    if (this.vz > MIN_VELOCITY) {
      this.velocity.set(this.plane.complex(0, 0));
    }

    // We'll track time for each animation frame separately
    let lastFrameTime = performance.now();

    function tick() {
      const now = performance.now();
      let dt = (now - lastFrameTime) / 1000;
      lastFrameTime = now;

      // Pan with friction
      const dv = this.plane.complex(0, 0).set(this.velocity).mulScalar(dt);
      this.center.add(dv);
      this.velocity.mulScalar(PAN_FRICTION);

      // Zoom with friction (zoom velocity)
      this.zoom += this.vz * dt;

      // Clamp zoom within allowed range
      if (this.zoom < 0) {
        this.zoom = 0;
        this.vz = 0;
      } else if (this.zoom > MAX_ZOOM) {
        this.zoom = MAX_ZOOM;
        this.vz = 0;
      }

      this.vz *= ZOOM_FRICTION;

      // Notify consumer
      onMapChange?.();

      // Check velocity
      const speedSq =
        this.plane.asNumber(this.velocity.squareMod()) + this.vz * this.vz;
      if (speedSq < MIN_VELOCITY * MIN_VELOCITY) {
        this.velocity.set(this.plane.complex(0, 0));
        this.vz = 0;
        this.inertiaRequestId = null;
        return;
      }

      this.inertiaRequestId = requestAnimationFrame(tick.bind(this));
    }

    this.inertiaRequestId = requestAnimationFrame(tick.bind(this));
  }
}
