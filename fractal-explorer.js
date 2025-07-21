import { Complex } from "./complex.js";
import { DEFAULT_FN } from "./julia.js";
import { MapControl } from "./map.js";
import { Palette } from "./palette.js";
import { RenderingEngine, RenderOptions } from "./renderers/renderer.js";
import { createRenderer } from "./renderers/renderers.js";

const DPR = window.devicePixelRatio ?? 1;
const RENDER_INTERVAL_MS = 80; // ~12 fps preview
const FPS_WINDOW_MS = 200;  // Aggregate FPS
const TARGET_FPS = 30;
const MIN_PIXEL_DENSITY = 0.125;
const MAX_PIXEL_DENSITY = 1;

export class FractalExplorer {
  constructor(
    divContainer,
    renderingEngine,
    options,
    onMapChanged,
    onDragged,
    onRendered
  ) {
    this.divContainer = divContainer;
    this.renderingEngine = renderingEngine;
    this.options = options;
    this.onMapChanged = onMapChanged;
    this.onDragged = onDragged;
    this.onRendered = onRendered;

    this.map = new MapControl();
    this.renderer = null;
    this.dynamicPixelDensity = MAX_PIXEL_DENSITY;

    // Mouse & touch state
    this.isDragging = false;
    this.lastMousePos = { x: 0, y: 0 };
    this.initialDistance = 0;
    this.initialZoom = 0;
    this.lastTouchEndTime = 0;

    // Debounce/timer for final hi-res render
    this.renderTimeoutId = null;
    this.lastRenderTime = 0;
    this.zoomAnimationId = null;

    this.onMouseDownHandler = this.#onMouseDown.bind(this);
    this.onMouseMoveHandler = this.#onMouseMove.bind(this);
    this.onMouseUpHandler = this.#onMouseUp.bind(this);
    this.onWheelHandler = this.#onWheel.bind(this);
    this.onDoubleClickHandler = this.#onDoubleClick.bind(this);
    this.onTouchStartHandler = this.#onTouchStart.bind(this);
    this.onTouchMoveHandler = this.#onTouchMove.bind(this);
    this.onTouchEndHandler = this.#onTouchEnd.bind(this);
    this.onTouchCancelHandler = this.#onTouchCancel.bind(this);

    this.fpsMonitor = new FpsMonitor(FPS_WINDOW_MS);

    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
  }

  async initRenderer() {
    this.renderer = await createRenderer(
      this.canvas,
      this.ctx,
      this.map,
      this.renderingEngine
    );
    this.dynamicPixelDensity =
      this.options.pixelDensity ??
      (this.renderer.id() === RenderingEngine.CPU
        ? MIN_PIXEL_DENSITY
        : MAX_PIXEL_DENSITY);
    setInterval(this.adjustPixelDensity.bind(this), FPS_WINDOW_MS);
  }

  #onMouseDown(e) {
    if (this.zoomAnimationId) {
      cancelAnimationFrame(this.zoomAnimationId);
      this.zoomAnimationId = null;
    }
    this.isDragging = true;
    this.lastMousePos = { x: e.clientX, y: e.clientY };
    // Stop any ongoing inertia so we start fresh
    this.map.stop();

    document.addEventListener("mousemove", this.onMouseMoveHandler);
    document.addEventListener("mouseup", this.onMouseUpHandler);
  }

  #onMouseMove(e) {
    if (!this.isDragging) {
      return;
    }

    // Convert oldPos and newPos from screen → fractal coords
    const oldPos = this.#canvasToComplex(
      this.lastMousePos.x,
      this.lastMousePos.y
    );
    const newPos = this.#canvasToComplex(e.clientX, e.clientY);

    // Move the map by the delta
    this.map.move(oldPos.sub(newPos));

    this.lastMousePos = { x: e.clientX, y: e.clientY };

    // Possibly do a real-time quick fractal render
    const now = performance.now();
    if (now - this.lastRenderTime > RENDER_INTERVAL_MS) {
      this.render();
      this.lastRenderTime = now;
    }

    this.onMapChanged?.();
    this.onDragged?.();
  }

  #onMouseUp() {
    this.isDragging = false;
    this.map.animate(() => {
      this.render();
      this.onMapChanged?.();
    });
    document.removeEventListener("mousemove", this.onMouseMoveHandler);
    document.removeEventListener("mouseup", this.onMouseUpHandler);
  }

  #zoomAt(screenX, screenY, newZoom) {
    const pivot = this.#canvasToComplex(screenX, screenY);
    this.map.zoomTo(newZoom);
    const newPivot = this.#canvasToComplex(screenX, screenY);

    // Shift the center to keep pivot static
    this.map.move(pivot.sub(newPivot));
    this.map.maybeReproject();

    this.render();
    this.onMapChanged?.();
  }

  #onWheel(e) {
    e.preventDefault();
    this.map.stop();
    this.#zoomAt(e.offsetX, e.offsetY, this.map.zoom - e.deltaY * 0.002);
  }

  #onDoubleClick(e) {
    this.map.stop();
    const screenPos = new Complex(e.layerX, e.layerY);
    this.animateZoom(screenPos, this.map.zoom, this.map.zoom + 1, 100);
  }

  #onTouchStart(e) {
    e.preventDefault();
    this.map.stop(); // kill inertia if we have a new touch
    const activeTouches = Array.from(e.touches);

    if (activeTouches.length === 1) {
      // Single-finger drag
      const touch = activeTouches[0];
      this.lastMousePos = { x: touch.clientX, y: touch.clientY };
      this.isDragging = true;
    } else if (activeTouches.length === 2) {
      // Two-finger pinch
      this.isDragging = false;
      this.initialDistance = getDistance(activeTouches[0], activeTouches[1]);
      this.initialZoom = this.map.zoom;
    }

    document.addEventListener("touchmove", this.onTouchMoveHandler, {
      passive: false,
    });
    document.addEventListener("touchend", this.onTouchEndHandler, {
      passive: false,
    });
    document.addEventListener("touchcancel", this.onTouchCancelHandler, {
      passive: false,
    });
  }

  #onTouchMove(e) {
    e.preventDefault();
    const activeTouches = Array.from(e.touches);

    if (activeTouches.length === 1) {
      // Single-finger drag
      const touch = activeTouches[0];
      if (!this.isDragging) {
        return;
      }

      const oldPos = this.#canvasToComplex(
        this.lastMousePos.x,
        this.lastMousePos.y
      );
      const newPos = this.#canvasToComplex(touch.clientX, touch.clientY);

      this.map.move(oldPos.sub(newPos));

      this.lastMousePos = { x: touch.clientX, y: touch.clientY };

      this.render();
      this.onMapChanged?.();
      this.onDragged?.();
    } else if (activeTouches.length === 2) {
      // Pinch to zoom
      const dist = getDistance(activeTouches[0], activeTouches[1]);
      const dzoom = Math.log2(dist / this.initialDistance);
      const mid = getMidpoint(activeTouches[0], activeTouches[1]);
      this.#zoomAt(mid.x, mid.y, this.initialZoom + dzoom);
    }
  }

  #onTouchEnd(e) {
    e.preventDefault();
    const now = performance.now();
    if (now - this.lastTouchEndTime < 300) {
      this.#onDoubleClick(e);
    } else {
      const activeTouches = Array.from(e.touches);
      if (activeTouches.length === 0) {
        this.isDragging = false;
        this.map.animate(() => {
          this.render();
          this.onMapChanged?.();
        });
      }
    }
    this.lastTouchEndTime = now;

    document.removeEventListener("touchmove", this.onTouchMoveHandler, {
      passive: false,
    });
    document.removeEventListener("touchend", this.onTouchEndHandler, {
      passive: false,
    });
    document.removeEventListener("touchcancel", this.onTouchCancelHandler, {
      passive: false,
    });
  }

  #onTouchCancel(e) {
    e.preventDefault();
    activeTouches = [];
    this.isDragging = false;
    document.removeEventListener("touchmove", this.onTouchMoveHandler, {
      passive: false,
    });
    document.removeEventListener("touchend", this.onTouchEndHandler, {
      passive: false,
    });
    document.removeEventListener("touchcancel", this.onTouchCancelHandler, {
      passive: false,
    });
  }

  attach() {
    if (this.isAttached) {
      return;
    }
    this.divContainer.appendChild(this.canvas);
    this.render();
    this.isAttached = true;
  }

  detach() {
    if (!this.isAttached) {
      return;
    }
    this.divContainer.removeChild(this.canvas);
    this.isAttached = false;
  }

  setInteractive(interactive) {
    if (interactive) {
      this.canvas.addEventListener("mousedown", this.onMouseDownHandler);
      this.canvas.addEventListener("wheel", this.onWheelHandler, {
        passive: false,
      });
      this.canvas.addEventListener("dblclick", this.onDoubleClickHandler);
      this.canvas.addEventListener("touchstart", this.onTouchStartHandler, {
        passive: false,
      });
    } else {
      this.canvas.removeEventListener("mousedown", this.onMouseDownHandler);
      this.canvas.removeEventListener("wheel", this.onWheelHandler, {
        passive: false,
      });
      this.canvas.removeEventListener("dblclick", this.onDoubleClickHandler);
      this.canvas.removeEventListener("touchstart", this.onTouchStartHandler, {
        passive: false,
      });
    }
  }

  async resize(width, height) {
    this.canvas.width = width * DPR;
    this.canvas.height = height * DPR;
    if (this.renderer) {
      this.renderer.resize(width * DPR, height * DPR);
      await this.render();
    }
  }

  #getDefaultIter() {
    return 200 * (1 + this.map.zoom);
  }

  /**
   * Render a quick preview, then schedule a final CPU render.
   */
  async render() {
    if (!this.isAttached) {
      return;
    }
    const pixelDensity = this.options.pixelDensity ?? this.dynamicPixelDensity;
    const restPixelDensity =
      this.options.pixelDensity ??
      (this.renderer.id() === RenderingEngine.WEBGPU ? 8 : 1);
    const maxIter = this.options.maxIter ?? this.#getDefaultIter();
    const deep = this.options.deep ?? this.map.zoom > 16;
    const palette = this.options.palette ?? Palette.WIKIPEDIA;
    const fn = this.options.fn ?? DEFAULT_FN;
    const options = { pixelDensity, deep, maxIter, palette, fn };

    const renderResult = await this.renderer.render(
      this.map,
      new RenderOptions(options)
    );

    this.onRendered?.(renderResult);
    this.fpsMonitor.addFrame();

    clearTimeout(this.renderTimeoutId);
    if (pixelDensity !== restPixelDensity) {
      this.renderTimeoutId = setTimeout(async () => {
        const renderResult = await this.renderer.render(
          this.map,
          new RenderOptions({ ...options, pixelDensity: restPixelDensity })
        );
        this.onRendered?.(renderResult);
      }, 300);
    }
  }

  adjustPixelDensity() {
    const fps = this.fps();
    if (fps === null) {
      return;
    }
    const error = fps - TARGET_FPS;
    const adjustmentRate = 0.1;

    // Proportional control: small error => small change
    this.dynamicPixelDensity *= 1 + (adjustmentRate * error) / TARGET_FPS;

    // Clamp to avoid crazy values
    this.dynamicPixelDensity = Math.min(
      Math.max(this.dynamicPixelDensity, MIN_PIXEL_DENSITY),
      MAX_PIXEL_DENSITY
    );
  }

  #canvasToComplex(sx, sy) {
    return this.map.screenToComplex(
      sx * DPR,
      sy * DPR,
      this.canvas.width,
      this.canvas.height
    );
  }

  /**
   * Animate from zoomStart = 2^L_start to zoomEnd = 2^L_end,
   * by interpolating L in [L_start, L_end].
   *
   * - zoomStart: initial zoom level
   * - zoomEnd: final zoom level
   * - duration: animation time in ms
   * - easingFunc(t): takes t in [0..1], returns eased T
   */
  animateZoom(screenPos, zoomStart, zoomEnd, duration) {
    if (this.zoomAnimationId) {
      cancelAnimationFrame(this.zoomAnimationId);
    }

    let startTime = null;

    function tick(timestamp) {
      if (!startTime) {
        startTime = timestamp;
      }
      const elapsed = timestamp - startTime;
      let t = Math.min(elapsed / duration, 1);
      const easedT = easeInOutSine(t);
      const currentZoom = zoomStart + (zoomEnd - zoomStart) * easedT;

      this.#zoomAt(screenPos.x, screenPos.y, currentZoom);

      if (t < 1) {
        this.zoomAnimationId = requestAnimationFrame(tick.bind(this));
      }
    }

    this.zoomAnimationId = requestAnimationFrame(tick.bind(this));
  }

  fps() {
    return this.fpsMonitor.fps();
  }
}

/**
 * Helper for pinch gestures: distance between two touches
 */
function getDistance(t1, t2) {
  const dx = t2.clientX - t1.clientX;
  const dy = t2.clientY - t1.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Helper for pinch gestures: midpoint of two touches
 */
function getMidpoint(t1, t2) {
  return {
    x: (t1.clientX + t2.clientX) / 2,
    y: (t1.clientY + t2.clientY) / 2,
  };
}

function easeInOutSine(t) {
  // t goes from 0 to 1
  return 0.5 * (1 - Math.cos(Math.PI * t));
}

class FpsMonitor {
  constructor(windowSizeMillis) {
    this.frameTimes = [];
    this.windowSizeMillis = windowSizeMillis;
  }

  #clearFrames() {
    const now = performance.now();
    while (
      this.frameTimes.length > 0 &&
      this.frameTimes[0] <= now - this.windowSizeMillis
    ) {
      this.frameTimes.shift();
    }
  }

  addFrame() {
    this.frameTimes.push(performance.now());
    this.#clearFrames();
  }

  fps() {
    this.#clearFrames();
    const actualWindowSizeMillis =
      this.frameTimes.length === 0
        ? 0
        : this.frameTimes[this.frameTimes.length - 1] - this.frameTimes[0];
    return actualWindowSizeMillis > 0.1 * this.windowSizeMillis
      ? Math.floor((1000 * this.frameTimes.length) / actualWindowSizeMillis)
      : null;
  }
}
