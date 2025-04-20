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

import { Complex } from "./complex.js";

// Velocities
const MIN_VELOCITY = 1e-3;

// Internal friction factors
const PAN_FRICTION = 0.94;
const ZOOM_FRICTION = 0.95;
const ZERO = new Complex(0, 0);

export class MapControl {
  constructor() {
    this.center = new Complex(0, 0);
    this.zoom = 0;
    this.velocity = new Complex(0, 0); // Pan velocity
    this.vz = 0; // "zoom velocity" for zoom inertia

    // We'll keep a single timestamp to measure time deltas
    // for move(), zoomBy(), pinch() calls.
    this.lastUpdateTime = null;

    // We track the inertia animation frame id so we can cancel it if needed
    this.inertiaRequestId = null;
  }

  /**
   * Immediately set the map to a specific location & zoom,
   * e.g. after reading from the URL.
   */
  moveTo(center, zoom) {
    this.center.set(center);
    this.zoom = zoom;
  }

  /**
   * Stop any ongoing inertia and set velocities to 0.
   * Can be called if you don't want inertia to continue
   * after, e.g., a wheel zoom.
   */
  stop() {
    this.velocity.set(ZERO);
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
    const scale = (4 / width) * Math.pow(2, -this.zoom);
    const cx = this.center.x + (sx - width * 0.5) * scale;
    const cy = this.center.y - (sy - height * 0.5) * scale;
    return new Complex(cx, cy);
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

    // Cannot zoom down beyond 0
    this.zoom = Math.max(this.zoom, 0);

    if (dt > 0) {
      // vs is how quickly zoom is changing
      this.vz = dzoom / dt;
    }
  }

  zoomTo(newZoom) {
    this.zoomBy(newZoom - this.zoom);
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
    const speedSq = this.velocity.squareMod() + this.vz * this.vz;
    if (speedSq < MIN_VELOCITY * MIN_VELOCITY) {
      this.velocity.set(ZERO);
      this.vz = 0;
      return;
    }

    // If zoom is animating, cancel panning
    if (this.vz > MIN_VELOCITY) {
      this.velocity.set(ZERO);
    }

    // We'll track time for each animation frame separately
    let lastFrameTime = performance.now();

    function tick() {
      const now = performance.now();
      let dt = (now - lastFrameTime) / 1000;
      lastFrameTime = now;

      // Pan with friction
      this.center.x += this.velocity.x * dt;
      this.center.y += this.velocity.y * dt;
      this.velocity.mulScalar(PAN_FRICTION);

      // Zoom with friction (zoom velocity)
      this.zoom += this.vz * dt;

      // If you don't want zoom < 0, clamp it
      if (this.zoom < 0) {
        this.zoom = 0;
        this.vz = 0;
      }

      this.vz *= ZOOM_FRICTION;

      // Notify consumer
      onMapChange?.();

      // Check velocity
      const speedSq = this.velocity.squareMod() + this.vz * this.vz;
      if (speedSq < MIN_VELOCITY * MIN_VELOCITY) {
        this.velocity.set(ZERO);
        this.vz = 0;
        this.inertiaRequestId = null;
        return;
      }

      this.inertiaRequestId = requestAnimationFrame(tick.bind(this));
    }

    this.inertiaRequestId = requestAnimationFrame(tick.bind(this));
  }
}

