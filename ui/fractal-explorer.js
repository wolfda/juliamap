import { BigComplexPlane, Complex, COMPLEX_PLANE } from "../math/complex.js";
import { DEFAULT_FN } from "../math/julia.js";
import { MapControl } from "../core/map.js";
import { Palette } from "../core/palette.js";
import { RenderingEngine, RenderOptions } from "../renderers/renderer.js";
import { createRenderer } from "../renderers/renderers.js";

export const DPR = window.devicePixelRatio ?? 1;
const RENDER_INTERVAL_MS = 33; // target ~30 fps preview
const FPS_WINDOW_MS = 1000; // Aggregate FPS
const TARGET_FRAME_MS = 33; // ~30 fps budget
const MIN_PIXEL_DENSITY = 0.125;
const MAX_PIXEL_DENSITY = 1;
const INTERACTIVE_ITER_CAP = 2000;
const INTERACTIVE_PIXEL_DENSITY = 0.5;
const INTERACTION_LINGER_MS = 120;

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

    // Back buffer for rendering; front buffer is `this.canvas`
    this.renderCanvas = document.createElement("canvas");
    this.renderCtx = null;
    this.latestFrameCanvas = document.createElement("canvas");
    this.latestFrameCtx = this.latestFrameCanvas.getContext("2d");
    this.lastRenderState = null;
    this.pendingRenderQueue = [];
    this.renderLoopPromise = null;
    this.inFlightRenderPromise = null;
    this.inFlightRenderStartTime = null;
    this.nextRequestId = 1;
    this.lastEnqueueTime = 0;
    this.pendingViewportChange = null;
    this.viewportQueueBusy = false;
    this.previewLoopId = null;

    // Mouse & touch state
    this.isDragging = false;
    this.lastMousePos = { x: 0, y: 0 };
    this.initialDistance = 0;
    this.initialZoom = 0;
    this.lastTouchEndTime = 0;

    this.lastRenderTime = 0;
    this.zoomAnimationId = null;
    this.interactionActive = false;
    this.interactionTimeoutId = null;

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
    this.ctx = null;
    this.canvas.style.imageRendering = "pixelated";
    this.latestFrameCtx.imageSmoothingEnabled = false;
    this.latestFrameCtx.imageSmoothingQuality = "low";
    this.latestFrameCanvas.style.imageRendering = "pixelated";

    this.#startPreviewLoop();
  }

  async initRenderer() {
    if (this.renderingEngine === RenderingEngine.WEBGPU) {
      // Render straight to the visible canvas; no 2D context needed.
      this.renderCanvas = this.canvas;
      this.renderCtx = null;
    } else {
      this.renderCtx = this.renderCanvas.getContext("2d");
      this.renderCtx.imageSmoothingEnabled = false;
      this.renderCtx.imageSmoothingQuality = "low";
      this.renderCanvas.style.imageRendering = "pixelated";
    }

    this.renderer = await createRenderer(
      this.renderCanvas,
      this.renderCtx,
      this.map,
      this.renderingEngine
    );

    if (this.renderer.id() !== RenderingEngine.WEBGPU) {
      this.ctx = this.canvas.getContext("2d");
      this.ctx.imageSmoothingEnabled = false;
      this.ctx.imageSmoothingQuality = "low";
    } else {
      this.ctx = null;
    }

    this.dynamicPixelDensity =
      this.options.pixelDensity ??
      (this.renderer.id() === RenderingEngine.CPU
        ? MIN_PIXEL_DENSITY
        : MAX_PIXEL_DENSITY);
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

    const nextPos = { x: e.clientX, y: e.clientY };
    this.#queueViewportChange(async () => {
      this.#markInteraction();
      const oldPos = this.#canvasToComplex(
        this.lastMousePos.x,
        this.lastMousePos.y
      );
      const newPos = this.#canvasToComplex(nextPos.x, nextPos.y);
      this.map.move(oldPos.sub(newPos));
      this.lastMousePos = nextPos;

      const now = performance.now();
      if (now - this.lastRenderTime > RENDER_INTERVAL_MS) {
        this.render();
        this.lastRenderTime = now;
      }
      this.onMapChanged?.();
      this.onDragged?.();
    });
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
    this.#markInteraction();
    const pivot = this.#canvasToComplex(screenX, screenY);
    this.map.zoomTo(newZoom);
    const newPivot = this.#canvasToComplex(screenX, screenY);

    // Shift the center to keep pivot static
    this.map.move(pivot.sub(newPivot));
    this.map.maybeReproject();

    this.render();
    this.onMapChanged?.();
  }

  #moveTo(center, newZoom) {
    this.map.moveTo(center, newZoom);
    this.render();
    this.onMapChanged?.();
  }

  #onWheel(e) {
    e.preventDefault();
    this.map.stop();
    this.#queueViewportChange(async () => {
      await this.#waitForRenderBudget();
      this.#zoomAt(e.offsetX, e.offsetY, this.map.zoom - e.deltaY * 0.002);
    });
  }

  #touchPos(touch) {
    const rect = this.canvas.getBoundingClientRect();
    const canvasX =
      (touch.clientX - rect.left) * (this.canvas.width / rect.width);
    const canvasY =
      (touch.clientY - rect.top) * (this.canvas.height / rect.height);
    return new Complex(canvasX / DPR, canvasY / DPR);
  }

  #offsetPos(e) {
    if (e instanceof MouseEvent) {
      return new Complex(e.offsetX, e.offsetY);
    } else if (e instanceof TouchEvent) {
      return this.#touchPos(e.changedTouches[0]);
    } else {
      throw Error("Unsupported event", e);
    }
  }

  #onDoubleClick(e) {
    this.map.stop();
    this.animateZoom(this.#offsetPos(e), this.map.zoom, this.map.zoom + 1, 100);
  }

  #onTouchStart(e) {
    e.preventDefault();
    this.map.stop(); // kill inertia if we have a new touch
    this.#markInteraction();
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
      const nextPos = { x: touch.clientX, y: touch.clientY };
      this.#queueViewportChange(async () => {
        this.#markInteraction();
        const oldPos = this.#canvasToComplex(
          this.lastMousePos.x,
          this.lastMousePos.y
        );
        const newPos = this.#canvasToComplex(nextPos.x, nextPos.y);
        this.map.move(oldPos.sub(newPos));
        this.lastMousePos = nextPos;
        this.render();
        this.onMapChanged?.();
        this.onDragged?.();
      });
    } else if (activeTouches.length === 2) {
      // Pinch to zoom
      const dist = getDistance(activeTouches[0], activeTouches[1]);
      const dzoom = Math.log2(dist / this.initialDistance);
      const mid = this.#touchPos(activeTouches[0])
        .add(this.#touchPos(activeTouches[1]))
        .divScalar(2);
      this.#queueViewportChange(async () => {
        await this.#waitForRenderBudget();
        this.#markInteraction();
        this.#zoomAt(mid.x, mid.y, this.initialZoom + dzoom);
      });
    }
  }

  #onTouchEnd(e) {
    e.preventDefault();
    this.#markInteraction();
    this.#markInteraction();
    const now = performance.now();
    if (now - this.lastTouchEndTime < 300) {
      this.#queueViewportChange(async () => {
        await this.#waitForRenderBudget();
        this.#onDoubleClick(e);
      });
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
    this.render(true);
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
    this.renderCanvas.width = width * DPR;
    this.renderCanvas.height = height * DPR;
    this.latestFrameCanvas.width = width * DPR;
    this.latestFrameCanvas.height = height * DPR;
    if (this.renderer) {
      this.renderer.resize(width * DPR, height * DPR);
      await this.render(true);
    }
  }

  #getDefaultIter() {
    return 200 * (1 + this.map.zoom);
  }

  /**
   * Render a quick preview by stretching the last frame; always queue a new render
   * so we refresh as quickly as possible during interaction.
   */
  async render(force = false) {
    if (!this.isAttached) {
      return;
    }
    const pixelDensity = this.options.pixelDensity ?? MAX_PIXEL_DENSITY;
    let maxIter = this.options.maxIter ?? this.#getDefaultIter();
    const deep = this.options.deep ?? this.map.zoom > 16;
    const palette = this.options.palette ?? Palette.WIKIPEDIA;
    const fn = this.options.fn ?? DEFAULT_FN;
    const interactivePixelDensity = Math.max(
      MIN_PIXEL_DENSITY,
      pixelDensity * INTERACTIVE_PIXEL_DENSITY
    );
    const options = {
      pixelDensity: this.interactionActive ? interactivePixelDensity : pixelDensity,
      deep,
      maxIter: this.interactionActive ? Math.min(maxIter, INTERACTIVE_ITER_CAP) : maxIter,
      palette,
      fn,
    };

    this.dynamicPixelDensity = pixelDensity;

    const hasFrame = !!this.lastRenderState;
    // Always enqueue the latest view; drop any older pending request.
    this.#enqueueRender(options);
    if (hasFrame && !force) {
      this.#drawPreviewFromLastRender();
    }
    return this.renderLoopPromise;
  }

  #enqueueRender(options) {
    const requestId = this.nextRequestId++;
    let resolvePromise;
    const promise = new Promise((resolve) => {
      resolvePromise = resolve;
    });
    // Keep only the latest pending render request to avoid wasteful backlog.
    this.pendingRenderQueue = [];
    this.pendingRenderQueue.push({
      requestId,
      options: new RenderOptions(options),
      resolve: resolvePromise,
    });
    this.lastEnqueueTime = performance.now();

    if (!this.renderLoopPromise) {
      this.renderLoopPromise = this.#processRenderQueue().finally(() => {
        this.renderLoopPromise = null;
      });
    }
    return { requestId, promise };
  }

  async #processRenderQueue() {
    // Run renders sequentially; every enqueued request is rendered in order.
    while (this.pendingRenderQueue.length > 0 && this.isAttached) {
      const { requestId, options, resolve } = this.pendingRenderQueue.shift();
      const renderState = this.#snapshotMapState();

      const start = performance.now();
      this.inFlightRenderStartTime = start;
      this.inFlightRenderPromise = this.renderer.render(this.map, options);
      const renderResult = await this.inFlightRenderPromise;
      this.inFlightRenderPromise = null;
      this.inFlightRenderStartTime = null;
      const end = performance.now();
      const renderDuration = Math.round(end - start);

      // Present every finished frame; reprojection keeps it aligned with the
      // current view even if newer requests were queued while it was rendering.
      this.lastRenderState = renderState;
      this.#captureLatestFrame();
      this.#presentFrame();
      this.onRendered?.(renderResult);

      this.fpsMonitor.addFrame(end - start);
      resolve?.(renderResult);
    }
  }

  #snapshotMapState() {
    // Capture center/zoom/plane used for the current render, so we can
    // reproject the last frame while a new render is pending.
    return {
      center: this.map.center.clone(),
      plane: this.map.plane,
      zoom: this.map.zoom,
    };
  }

  #captureLatestFrame() {
    if (this.renderer?.id() === RenderingEngine.WEBGPU) {
      return;
    }
    if (
      this.latestFrameCanvas.width !== this.renderCanvas.width ||
      this.latestFrameCanvas.height !== this.renderCanvas.height
    ) {
      this.latestFrameCanvas.width = this.renderCanvas.width;
      this.latestFrameCanvas.height = this.renderCanvas.height;
    }
    this.latestFrameCtx.imageSmoothingEnabled = false;
    this.latestFrameCtx.drawImage(
      this.renderCanvas,
      0,
      0,
      this.renderCanvas.width,
      this.renderCanvas.height,
      0,
      0,
      this.latestFrameCanvas.width,
      this.latestFrameCanvas.height
    );
  }

  #waitForRenderBudget() {
    // Keep interaction fully smooth: never block on in-flight renders.
    return Promise.resolve(!!this.inFlightRenderPromise);
  }

  #queueViewportChange(fn) {
    this.pendingViewportChange = fn;
    if (this.viewportQueueBusy) {
      return;
    }
    this.viewportQueueBusy = true;
    const run = async () => {
      while (this.pendingViewportChange) {
        const work = this.pendingViewportChange;
        this.pendingViewportChange = null;
        await this.#waitForRenderBudget();
        await work();
      }
      this.viewportQueueBusy = false;
    };
    run();
  }

  #presentFrame() {
    // Reproject the freshly rendered frame onto the current viewport so
    // completed renders never "snap back" to the zoom/center they started with.
    this.#drawPreviewFromLastRender();
    if (this.renderer?.id() === RenderingEngine.WEBGPU) {
      this.canvas.style.transformOrigin = "0 0";
      this.canvas.style.transform = "translate(0px, 0px) scale(1)";
    }
  }

  #startPreviewLoop() {
    const tick = () => {
      if (this.isAttached && this.lastRenderState) {
        this.#drawPreviewFromLastRender();
      }
      this.previewLoopId = requestAnimationFrame(tick);
    };
    this.previewLoopId = requestAnimationFrame(tick);
  }

  #drawPreviewFromLastRender() {
    if (!this.lastRenderState) {
      return;
    }

    const currentPlane = this.map.plane;
    const lastCenter = currentPlane.complex().project(this.lastRenderState.center);
    const currentCenter = currentPlane.complex().project(this.map.center);
    const dx = currentPlane.asNumber(lastCenter.x - currentCenter.x);
    const dy = currentPlane.asNumber(lastCenter.y - currentCenter.y);
    const w = this.canvas.width;
    const h = this.canvas.height;

    const zoomDelta = this.map.zoom - this.lastRenderState.zoom;
    const scale = Math.pow(2, zoomDelta);
    const pixelScale = (w / 4) * Math.pow(2, this.map.zoom);
    const targetX = w * 0.5 + dx * pixelScale;
    const targetY = h * 0.5 - dy * pixelScale;
    const tx = targetX - scale * w * 0.5;
    const ty = targetY - scale * h * 0.5;

    if (this.renderer?.id() === RenderingEngine.WEBGPU) {
      // For WebGPU we can't repaint via 2D; use a CSS transform to preview.
      this.canvas.style.transformOrigin = "0 0";
      const cssTx = tx / DPR;
      const cssTy = ty / DPR;
      this.canvas.style.transform = `translate(${cssTx}px, ${cssTy}px) scale(${scale})`;
      return;
    }

    const sourceCanvas =
      this.latestFrameCanvas.width > 0 ? this.latestFrameCanvas : this.renderCanvas;

    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, w, h);
    this.ctx.setTransform(scale, 0, 0, scale, tx, ty);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(
      sourceCanvas,
      0,
      0,
      sourceCanvas.width,
      sourceCanvas.height,
      0,
      0,
      w,
      h
    );
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
  }

  #canvasToComplex(sx, sy) {
    return this.map.screenToComplex(
      sx * DPR,
      sy * DPR,
      this.canvas.width,
      this.canvas.height
    );
  }

  #markInteraction() {
    this.interactionActive = true;
    if (this.interactionTimeoutId) {
      clearTimeout(this.interactionTimeoutId);
    }
    this.interactionTimeoutId = setTimeout(() => {
      this.interactionActive = false;
    }, INTERACTION_LINGER_MS);
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

  animateDive(center, zoomStart, zoomEnd, duration) {
    if (this.zoomAnimationId) {
      cancelAnimationFrame(this.zoomAnimationId);
    }

    let startTime = null;

    let projectedCenter = null;
    let plane = null;

    function tick(timestamp) {
      if (!startTime) {
        startTime = timestamp;
      }
      const elapsed = timestamp - startTime;
      let t = Math.min(elapsed / duration, 1);
      const easedT = easeInOutSine(t);
      const currentZoom = zoomStart + (zoomEnd - zoomStart) * easedT;

      // Reproject the center if needed
      const targetPrecision = this.map.precisionAtZoom(currentZoom);
      if (plane === null || targetPrecision != plane.exponent) {
        plane =
          targetPrecision === undefined
            ? COMPLEX_PLANE
            : new BigComplexPlane(targetPrecision);
        projectedCenter = plane.complex().project(center);
      }

      this.#moveTo(projectedCenter, currentZoom);

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
    this.frameDelay = [];
    this.totalDelay = 0;
    this.windowSizeMillis = windowSizeMillis;
  }

  #clearFrames() {
    const now = performance.now();
    while (
      this.frameTimes.length > 0 &&
      this.frameTimes[0] <= now - this.windowSizeMillis
    ) {
      this.totalDelay -= this.frameDelay[0];
      this.frameTimes.shift();
      this.frameDelay.shift();
    }
  }

  addFrame(delay) {
    this.frameTimes.push(performance.now());
    this.frameDelay.push(delay);
    this.totalDelay += delay;
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

  delay() {
    this.#clearFrames();
    return this.frameDelay.length > 0
      ? this.totalDelay / this.frameDelay.length
      : null;
  }
}
