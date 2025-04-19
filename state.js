import { Complex } from "./complex.js";
import { Layout } from "./julia-explorer.js";

const BITS_PER_DECIMAL = Math.log10(2);
const DEFAULT_CENTER = new Complex(-0.5, 0);
const DEFAULT_LAYOUT = Layout.MANDEL;

export class AppState {
  static parseFromAddressBar() {
    const params = new URLSearchParams(window.location.search);
    const x = float(params, "x", DEFAULT_CENTER.x);
    const y = float(params, "y", DEFAULT_CENTER.y);
    const zoom = float(params, "z", 0);
    const jx = float(params, "jx", 0);
    const jy = float(params, "jy", 0);
    const jzoom = float(params, "jz", 0);
    const layout = params.get("layout") ?? DEFAULT_LAYOUT;
    let renderingEngine = params.get("renderer");
    let deep = null;
    if (renderingEngine) {
      const split = renderingEngine.split(".");
      deep = false;
      if (split.length > 1) {
        renderingEngine = split[0];
        deep = split[1] === "deep";
      }
    }
    const palette = params.get("palette");
    const maxIter = int(params, "iter", null);
    return new AppState({
      x,
      y,
      zoom,
      jx,
      jy,
      jzoom,
      layout,
      renderingEngine,
      palette,
      maxIter,
      deep,
    });
  }

  constructor({
    x,
    y,
    zoom,
    jx,
    jy,
    jzoom,
    layout,
    renderingEngine,
    palette,
    maxIter,
    deep,
  }) {
    // Mandelbrot coordinates
    this.x = x;
    this.y = y;
    this.zoom = zoom;

    // Julia coordinates
    this.jx = jx;
    this.jy = jy;
    this.jzoom = jzoom;

    this.layout = layout;
    this.renderingEngine = renderingEngine;
    this.palette = palette;
    this.maxIter = maxIter;
    this.deep = deep;
  }

  /**
   * Update the URL with current state
   */
  updateAddressBar() {
    const params = new URLSearchParams(window.location.search);

    // Truncate x and y to the most relevant decimals. 3 decimals required at zoom level 0.
    // Each additional zoom level requires 2 more bits of precision. 1 bit = ~0.30103 decimals.
    const precision = 3 + Math.ceil(this.zoom * BITS_PER_DECIMAL);
    params.set("x", this.x.toFixed(precision));
    params.set("y", this.y.toFixed(precision));
    params.set("z", this.zoom.toFixed(2));
    const jprecision = 3 + Math.ceil(this.jzoom * BITS_PER_DECIMAL);
    params.set("jx", this.jx.toFixed(jprecision));
    params.set("jy", this.jy.toFixed(jprecision));
    params.set("jz", this.jzoom.toFixed(2));
    if (this.layout !== null && this.layout != DEFAULT_LAYOUT) {
      params.set("layout", this.layout);
    } else {
      params.delete("layout");
    }
    if (this.renderingEngine) {
      params.set("renderer", this.renderingEngine + (this.deep ? ".deep" : ""));
    }
    if (this.maxIter !== null) {
      params.set("iter", this.maxIter);
    }
    if (this.palette !== null) {
      params.set("palette", this.palette);
    }

    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState({}, "", newUrl);
  }
}

function float(params, key, def) {
  return params.has(key) ? parseFloat(params.get(key)) ?? def : def;
}

function int(params, key, def) {
  return params.has(key) ? parseInt(params.get(key)) ?? def : def;
}
