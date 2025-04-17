import { DEFAULT_FN } from "./julia.js";
import { MapControl } from "./map.js";
import { Palette } from "./palette.js";
import { CpuRenderer } from "./renderers/cpu.js";
import {
  getDefaultRenderingEngine,
  RenderingEngine,
  RenderOptions,
} from "./renderers/renderer.js";
import { Webgl1Renderer } from "./renderers/webgl1.js";
import { Webgl2Renderer } from "./renderers/webgl2.js";
import { WebgpuRenderer } from "./renderers/webgpu.js";

// Device pixel ratio for crisp rendering on high-DPI
const DPR = window.devicePixelRatio ?? 1;
const RENDER_INTERVAL_MS = 80; // ~12 fps preview

export class FractalExplorer {
  static async create({
    divContainer,
    renderingEngine,
    options,
    onMapChanged,
    onRendered,
  } = {}) {
    const explorer = new FractalExplorer(
      divContainer,
      renderingEngine,
      options,
      onMapChanged,
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
    onRendered
  ) {
    this.divContainer = divContainer;
    this.renderingEngine = renderingEngine;
    this.options = options;
    this.onMapChanged = onMapChanged;
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
  }

  async #initRenderer() {
    this.canvas = document.createElement("canvas");
    this.ctx = this.canvas.getContext("2d");
    this.renderer = await newRenderer(
      this.canvas,
      this.ctx,
      this.map,
      this.renderingEngine
    );
    this.attach(this.divContainer);
  }

  #onMouseDown(e) {
    this.isDragging = true;
    this.lastMousePos = { x: e.clientX, y: e.clientY };
    // Stop any ongoing inertia so we start fresh
    this.map.stop();
  }

  #onMouseUp() {
    this.isDragging = false;
    this.map.animate((x, y, zoom) => {
      this.#render();
      this.onMapChanged?.(x, y, zoom);
    });
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
      this.#render();
      this.lastRenderTime = now;
    }

    this.onMapChanged?.(this.map.x, this.map.y, this.map.zoom);
  }

  #onWheel(e) {
    e.preventDefault();
    // Typically, we do pivot logic to zoom around the cursor.
    this.map.stop(); // if you don't want old inertia to continue

    const mouseX = e.clientX;
    const mouseY = e.clientY;

    // Convert mouse coords to complex plane coords
    const pivot = this.#canvasToComplex(mouseX, mouseY);

    // Zoom factor
    const dzoom = -e.deltaY * 0.002;
    this.map.zoomBy(dzoom);

    // Keep cursor point stable => shift center
    const newPivot = this.#canvasToComplex(mouseX, mouseY);
    this.map.move(pivot.cx - newPivot.cx, pivot.cy - newPivot.cy);

    this.#render();
    this.onMapChanged?.(this.map.x, this.map.y, this.map.zoom);
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

      this.#render();
      this.onMapChanged?.(this.map.x, this.map.y, this.map.zoom);
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

      this.#render();
      this.onMapChanged?.(this.map.x, this.map.y, this.map.zoom);
    }
  }

  #onTouchEnd(e) {
    e.preventDefault();
    const activeTouches = Array.from(e.touches);
    if (activeTouches.length === 0) {
      this.isDragging = false;
      this.map.animate((x, y, zoom) => {
        this.#render();
        this.onMapChanged?.(x, y, zoom);
      });
    }
  }

  #onTouchCancel(e) {
    e.preventDefault();
    activeTouches = [];
    this.isDragging = false;
  }

  attach(divContainer) {
    // --- Mouse events ---
    this.canvas.addEventListener("mousedown", this.#onMouseDown.bind(this));
    this.canvas.addEventListener("mouseup", this.#onMouseUp.bind(this));
    this.canvas.addEventListener("mousemove", this.#onMouseMove.bind(this));
    this.canvas.addEventListener("wheel", this.#onWheel.bind(this), {
      passive: false,
    });

    // --- Touch events ---
    this.canvas.addEventListener("touchstart", this.#onTouchStart.bind(this), {
      passive: false,
    });
    this.canvas.addEventListener("touchmove", this.#onTouchMove.bind(this), {
      passive: false,
    });
    this.canvas.addEventListener("touchend", this.#onTouchEnd.bind(this), {
      passive: false,
    });
    this.canvas.addEventListener(
      "touchcancel",
      this.#onTouchCancel.bind(this),
      { passive: false }
    );
    divContainer.appendChild(this.canvas);
  }

  detach() {
    this.divContainer.removeChild(this.canvas);
  }

  resize(width, height) {
    this.canvas.width = width * DPR;
    this.canvas.height = height * DPR;
    this.canvas.style.width = width + "px";
    this.canvas.style.height = height + "px";
    this.#render();
  }

  #getDefaultIter() {
    return 200 * (1 + this.map.zoom);
  }

  /**
   * Render a quick preview, then schedule a final CPU render.
   */
  #render() {
    const pixelDensity = this.renderer.id() == RenderingEngine.CPU ? 0.125 : 1;
    const restPixelDensity =
      this.renderer.id() === RenderingEngine.WEBGPU ? 8 : 1;
    const maxIter = this.options.maxIter ?? this.#getDefaultIter();
    const deep = this.options.deep ?? this.map.zoom > 16;
    const palette = this.options.palette ?? Palette.WIKIPEDIA;
    const fn = this.options.fn ?? DEFAULT_FN;
    const renderContext = this.renderer.render(
      this.map,
      new RenderOptions({ pixelDensity, deep, maxIter, palette, fn })
    );
    this.onRendered?.(renderContext);

    clearTimeout(this.renderTimeoutId);
    if (pixelDensity !== restPixelDensity) {
      this.renderTimeoutId = setTimeout(() => {
        const renderContext = this.renderer.render(
          this.map,
          new RenderOptions({
            pixelDensity: restPixelDensity,
            deep,
            maxIter,
            palette,
            fn,
          })
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

async function newRenderer(canvas, ctx, map, renderingEngine) {
  renderingEngine = renderingEngine ?? (await getDefaultRenderingEngine());
  switch (renderingEngine) {
    case RenderingEngine.WEBGPU:
      return await WebgpuRenderer.create(canvas, ctx, map);
    case RenderingEngine.WEBGL2:
      return Webgl2Renderer.create(canvas, ctx, map);
    case RenderingEngine.WEBGL1:
      return Webgl1Renderer.create(canvas, ctx, map);
    case RenderingEngine.CPU:
      return CpuRenderer.create(canvas, ctx, map);
    default:
      throw Error("Unknown renderer: " + renderingEngine);
  }
}
