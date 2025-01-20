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

let x = 0;
let y = 0;
let zoom = 0;

// Velocities
const MIN_VELOCITY = 1e-3;
let vx = 0;  // Pan velocity in x
let vy = 0;  // Pan velocity in y
let vz = 0;  // "zoom velocity" for zoom inertia

// Internal friction factors
const PAN_FRICTION = 0.94;
const ZOOM_FRICTION = 0.95;

// We'll keep a single timestamp to measure time deltas
// for move(), zoomBy(), pinch() calls.
let lastUpdateTime = null;

// We track the inertia animation frame id so we can cancel it if needed
let inertiaRequestId = null;

/**
 * Immediately set the map to a specific location & zoom, 
 * e.g. after reading from the URL.
 */
export function moveTo(newX, newY, newZoom) {
    x = newX;
    y = newY;
    zoom = newZoom;
}

/**
 * Stop any ongoing inertia and set velocities to 0.
 * Can be called if you don't want inertia to continue 
 * after, e.g., a wheel zoom.
 */
export function stop() {
    vx = 0;
    vy = 0;
    vz = 0;
    if (inertiaRequestId) {
        cancelAnimationFrame(inertiaRequestId);
        inertiaRequestId = null;
    }
}

/**
 * Returns the current fractal map state. 
 * main.js can use x, y, zoom to do rendering or update the URL.
 */
export function getMapState() {
    return { x, y, zoom };
}

/**
 * Move the map by (dx, dy) in fractal coords. 
 * Velocity is computed automatically from the time between calls.
 *
 * @param {number} dx - delta in fractal x
 * @param {number} dy - delta in fractal y
 */
export function move(dx, dy) {
    const now = performance.now();
    // If this is the first call after user input begins, we won't have a last time
    if (lastUpdateTime === null) {
        lastUpdateTime = now;
        // We'll still apply the move, but won't compute velocity
        x += dx;
        y += dy;
        return;
    }

    const dt = (now - lastUpdateTime) / 1000; // in seconds, or keep it in ms if you prefer
    lastUpdateTime = now;

    x += dx;
    y += dy;

    // If dt is very small, avoid dividing by zero
    if (dt > 0) {
        vx = dx / dt;
        vy = dy / dt;
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
export function zoomBy(dzoom) {
    const now = performance.now();
    if (lastUpdateTime === null) {
        lastUpdateTime = now;
        zoom += dzoom;
        return;
    }

    const dt = (now - lastUpdateTime) / 1000;
    lastUpdateTime = now;

    zoom += dzoom;

    // Cannot zoom down beyond 0
    zoom = Math.max(zoom, 0);

    if (dt > 0) {
        // vs is how quickly zoom is changing
        vz = dzoom / dt;
    }
}

export function zoomTo(newZoom) {
    zoomBy(newZoom - zoom);
}

/**
 * The main inertia loop. 
 * Call this, for example, on mouseup or touchend if you want to 
 * continue panning/zooming with friction.
 *
 * @param {function(x: number, y: number, zoom: number)} onMapChange 
 *        Callback that receives the new map state each frame.
 */
export function animate(onMapChange) {
    // Cancel any existing inertia
    if (inertiaRequestId) cancelAnimationFrame(inertiaRequestId);

    // If speeds are negligible, do nothing
    const speedSq = vx * vx + vy * vy + vz * vz;
    if (speedSq < MIN_VELOCITY * MIN_VELOCITY) {
        vx = 0; vy = 0; vz = 0;
        return;
    }

    // If zoom is animating, cancel panning
    if (vz > MIN_VELOCITY) {
        vx = vy = 0;
    }

    // We'll track time for each animation frame separately
    let lastFrameTime = performance.now();

    function tick() {
        const now = performance.now();
        let dt = (now - lastFrameTime) / 1000;
        lastFrameTime = now;

        // Pan with friction
        x += vx * dt;
        y += vy * dt;
        vx *= PAN_FRICTION;
        vy *= PAN_FRICTION;

        // Zoom with friction (zoom velocity)
        const oldZoom = zoom;
        zoom += vz * dt;

        // If you don't want zoom < 0, clamp it
        if (zoom < 0) {
            zoom = 0;
            vz = 0;
        }

        vz *= ZOOM_FRICTION;

        // Notify consumer
        onMapChange(x, y, zoom);

        // Check velocity
        const speedSq = vx * vx + vy * vy + vz * vz;
        if (speedSq < MIN_VELOCITY * MIN_VELOCITY) {
            vx = 0; vy = 0; vz = 0;
            inertiaRequestId = null;
            return;
        }

        inertiaRequestId = requestAnimationFrame(tick);
    }

    inertiaRequestId = requestAnimationFrame(tick);
}
