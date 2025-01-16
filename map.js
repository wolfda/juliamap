// map.js
// --------------------------------------
// Responsibilities:
//  - Store complex coords: x, y, scale
//  - Track velocities for pan & zoom
//  - Animate inertia over time (animate())
//  - Provide high-level methods like move(), scaleBy(), pinch() 
//    which compute velocity automatically (no dt parameter from outside).
//  - Provide moveTo() to jump instantly, stop() to clear velocities.
//
// No references to screen or devicePixelRatio. 
// main.js must convert from mouse/touch/wheel to fractal deltas.
// --------------------------------------

let x = 0;
let y = 0;
let scale = 1;

// Velocities
const MIN_VELOCITY = 1e-3;
let vx = 0;  // Pan velocity in x
let vy = 0;  // Pan velocity in y
let vs = 0;  // "scale velocity" for zoom inertia

// Internal friction factors
const PAN_FRICTION = 0.94;
const ZOOM_FRICTION = 0.95;

// We'll keep a single timestamp to measure time deltas
// for move(), scaleBy(), pinch() calls.
let lastUpdateTime = null;

// We track the inertia animation frame id so we can cancel it if needed
let inertiaRequestId = null;

/**
 * Immediately set the map to a specific location & scale, 
 * e.g. after reading from the URL.
 */
export function moveTo(newX, newY, newScale) {
    x = newX;
    y = newY;
    scale = newScale;
}

/**
 * Stop any ongoing inertia and set velocities to 0.
 * Can be called if you don't want inertia to continue 
 * after, e.g., a wheel zoom.
 */
export function stop() {
    vx = 0;
    vy = 0;
    vs = 0;
    if (inertiaRequestId) {
        cancelAnimationFrame(inertiaRequestId);
        inertiaRequestId = null;
    }
}

/**
 * Returns the current fractal map state. 
 * main.js can use x, y, scale to do rendering or update the URL.
 */
export function getMapState() {
    return { x, y, scale };
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
 * by calling move() before/after scaleBy() so as to keep 
 * a certain fractal point stable.
 *
 * @param {number} factor - ratio for new scale (scale *= factor).
 */
export function scaleBy(factor) {
    const now = performance.now();
    if (lastUpdateTime === null) {
        lastUpdateTime = now;
        scale *= factor;
        return;
    }

    const dt = (now - lastUpdateTime) / 1000;
    lastUpdateTime = now;

    scale *= factor;

    // Cannot scale down beyond 1
    scale = Math.max(scale, 1);

    if (dt > 0) {
        // vs is how quickly scale is changing, e.g. (factor - 1)/dt
        vs = (factor - 1) / dt;
    }
}

export function scaleTo(newScale) {
    scaleBy(newScale / scale);
}

/**
 * The main inertia loop. 
 * Call this, for example, on mouseup or touchend if you want to 
 * continue panning/zooming with friction.
 *
 * @param {function(x: number, y: number, scale: number)} onMapChange 
 *        Callback that receives the new map state each frame.
 */
export function animate(onMapChange) {
    // Cancel any existing inertia
    if (inertiaRequestId) cancelAnimationFrame(inertiaRequestId);

    // If speeds are negligible, do nothing
    const speedSq = vx * vx + vy * vy + vs * vs;
    if (speedSq < MIN_VELOCITY * MIN_VELOCITY) {
        vx = 0; vy = 0; vs = 0;
        return;
    }

    // If zoom is animating, cancel panning
    if (vs > MIN_VELOCITY) {
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

        // Zoom with friction (scale velocity)
        const oldScale = scale;
        // e.g. scale += scale * vs * dt
        // or a simpler approach: scale *= (1 + vs*dt)
        scale = scale + (scale * vs * dt);

        // If you don't want scale < 1, clamp it
        if (scale < 1) {
            scale = 1;
            vs = 0;
        }

        vs *= ZOOM_FRICTION;

        // Notify consumer
        onMapChange(x, y, scale);

        // Check velocity
        const speedSq = vx * vx + vy * vy + vs * vs;
        if (speedSq < MIN_VELOCITY * MIN_VELOCITY) {
            vx = 0; vy = 0; vs = 0;
            inertiaRequestId = null;
            return;
        }

        inertiaRequestId = requestAnimationFrame(tick);
    }

    inertiaRequestId = requestAnimationFrame(tick);
}
