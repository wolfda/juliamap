import { DEFAULT_FN } from "./julia.js";
import { MapControl } from "./map.js";
import { Palette } from "./palette.js";
import { RenderingEngine, RenderOptions } from "./renderers/renderer.js";
import { createRenderer } from "./renderers/renderers.js";

// Device pixel ratio for crisp rendering on high-DPI
const DPR = window.devicePixelRatio ?? 1;
const RENDER_INTERVAL_MS = 80; // ~12 fps preview

export class FractalExplorer {
  static async create({
    divContainer,
    renderingEngine,
    options,
    onMapChanged,
    onDragged,
    onRendered,
  } = {}) {
    const explorer = new FractalExplorer(
      divContainer,
      renderingEngine,
      options,
      onMapChanged,
      onDragged,
      onRendered
    );
    await explorer.#initRenderer();
    return explorer;
  }

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

    // Mouse & touch state
    this.isDragging = false;
    this.lastMousePos = { x: 0, y: 0 };
    this.initialDistance = 0;
    this.initialZoom = 0;

    // Debounce/timer for final hi-res render
    this.renderTimeoutId = null;
    this.lastRenderTime = 0;

    this.onMouseDownHandler = this.#onMouseDown.bind(this);
    this.onMouseMoveHandler = this.#onMouseMove.bind(this);
    this.onMouseUpHandler = this.#onMouseUp.bind(this);
    this.onWheelHandler = this.#onWheel.bind(this);
    this.onTouchStartHandler = this.#onTouchStart.bind(this);
    this.onTouchMoveHandler = this.#onTouchMove.bind(this);
    this.onTouchEndHandler = this.#onTouchEnd.bind(this);
    this.onTouchCancelHandler = this.#onTouchCancel.bind(this);
  }

  async #initRenderer() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.renderer = await createRenderer(
      this.canvas,
      this.ctx,
      this.map,
      this.renderingEngine
    );
    this.attach();
  }

  #onMouseDown(e) {
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

    // Delta in fractal coords
    const dx = oldPos.cx - newPos.cx;
    const dy = oldPos.cy - newPos.cy;

    // Move the map
    this.map.move(dx, dy);

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

  #onWheel(e) {
    e.preventDefault();
    // Typically, we do pivot logic to zoom around the cursor.
    this.map.stop(); // if you don't want old inertia to continue

    const mouseX = e.offsetX;
    const mouseY = e.offsetY;

    // Convert mouse coords to complex plane coords
    const pivot = this.#canvasToComplex(mouseX, mouseY);

    // Zoom factor
    const dzoom = -e.deltaY * 0.002;
    this.map.zoomBy(dzoom);

    // Keep cursor point stable => shift center
    const newPivot = this.#canvasToComplex(mouseX, mouseY);
    this.map.move(pivot.cx - newPivot.cx, pivot.cy - newPivot.cy);

    this.render();
    this.onMapChanged?.();
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

      // Delta in fractal space
      const dx = oldPos.cx - newPos.cx;
      const dy = oldPos.cy - newPos.cy;

      this.map.move(dx, dy);

      this.lastMousePos = { x: touch.clientX, y: touch.clientY };

      this.render();
      this.onMapChanged?.();
      this.onDragged?.();
    } else if (activeTouches.length === 2) {
      // Pinch to zoom
      const dist = getDistance(activeTouches[0], activeTouches[1]);
      const dzoom = Math.log2(dist / this.initialDistance);

      // Midpoint in screen coords => pivot
      const mid = getMidpoint(activeTouches[0], activeTouches[1]);
      const pivot = this.#canvasToComplex(mid.x, mid.y);

      this.map.zoomTo(this.initialZoom + dzoom);

      // Keep pivot point stable => shift center
      const newPivot = this.#canvasToComplex(mid.x, mid.y);
      this.map.move(pivot.cx - newPivot.cx, pivot.cy - newPivot.cy);

      this.render();
      this.onMapChanged?.();
    }
  }

  #onTouchEnd(e) {
    e.preventDefault();
    const activeTouches = Array.from(e.touches);
    if (activeTouches.length === 0) {
      this.isDragging = false;
      this.map.animate((x, y, zoom) => {
        this.render();
        this.onMapChanged?.();
      });
    }

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
    this.divContainer.appendChild(this.canvas);
  }

  detach() {
    this.divContainer.removeChild(this.canvas);
  }

  setInteractive(interactive) {
    if (interactive) {
      this.canvas.addEventListener("mousedown", this.onMouseDownHandler);
      this.canvas.addEventListener("wheel", this.onWheelHandler, {
        passive: false,
      });
      this.canvas.addEventListener("touchstart", this.onTouchStartHandler, {
        passive: false,
      });
    } else {
      this.canvas.removeEventListener("mousedown", this.onMouseDownHandler);
      this.canvas.removeEventListener("wheel", this.onWheelHandler, {
        passive: false,
      });
      this.canvas.removeEventListener("touchstart", this.onTouchStartHandler, {
        passive: false,
      });
    }
  }

  resize(width, height) {
    this.canvas.width = width * DPR;
    this.canvas.height = height * DPR;
    this.render();
  }

  #getDefaultIter() {
    return 200 * (1 + this.map.zoom);
  }

  /**
   * Render a quick preview, then schedule a final CPU render.
   */
  render() {
    const pixelDensity = this.renderer.id() == RenderingEngine.CPU ? 0.125 : 1;
    const restPixelDensity =
      this.renderer.id() === RenderingEngine.WEBGPU ? 8 : 1;
    const maxIter = this.options.maxIter ?? this.#getDefaultIter();
    const deep = this.options.deep ?? this.map.zoom > 16;
    const palette = this.options.palette ?? Palette.WIKIPEDIA;
    const fn = this.options.fn ?? DEFAULT_FN;
    const options = { pixelDensity, deep, maxIter, palette, fn };
    const renderContext = this.renderer.render(
      this.map,
      new RenderOptions(options)
    );
    this.onRendered?.(renderContext);

    clearTimeout(this.renderTimeoutId);
    if (pixelDensity !== restPixelDensity) {
      this.renderTimeoutId = setTimeout(() => {
        const renderContext = this.renderer.render(
          this.map,
          new RenderOptions({ ...options, pixelDensity: restPixelDensity })
        );
        this.onRendered?.(renderContext);
      }, 300);
    }
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
  animateZoom(zoomStart, zoomEnd, duration) {
    return new Promise((resolve) => {
      let startTime = null;

      // Capture the fractal coords of the screen center so we can keep it stable
      const centerScreen = {
        x: this.canvas.width / 2 / DPR,
        y: this.canvas.height / 2 / DPR,
      };
      const { cx: centerCx, cy: centerCy } = this.#canvasToComplex(
        centerScreen.x,
        centerScreen.y
      );

      function step(timestamp) {
        if (!startTime) {
          startTime = timestamp;
        }
        const elapsed = timestamp - startTime;
        let t = elapsed / duration;
        if (t > 1) {
          t = 1; // clamp to 1 at the end
        }

        // Apply easing to get an eased progress
        const easedT = easeInOutSine(t);

        // Interpolate L_current
        const currentZoom = zoomStart + (zoomEnd - zoomStart) * easedT;
        // Convert exponent -> actual zoom scale
        this.map.zoomTo(currentZoom);

        // Keep the same fractal point at the screen center
        const { cx: newCx, cy: newCy } = this.#canvasToComplex(
          centerScreen.x,
          centerScreen.y
        );
        this.map.move(centerCx - newCx, centerCy - newCy);

        // Render a quick preview
        this.render();

        if (t < 1) {
          requestAnimationFrame(step.bind(this));
        } else {
          resolve();
        }
      }

      requestAnimationFrame(step.bind(this));
    });
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
