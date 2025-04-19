import { Complex } from "./complex.js";
import { Layout } from "./julia-explorer.js";

const BITS_PER_DECIMAL = Math.log10(2);
const DEFAULT_CENTER = [-0.5, 0, 0];
const DEFAULT_LAYOUT = Layout.MANDEL;

export class AppState {
  static parseFromAddressBar() {
    const params = new URLSearchParams(window.location.search);
    const [x, y, zoom] = parseXYZ(params.get("mpos"), DEFAULT_CENTER);
    const [jx, jy, jzoom] = parseXYZ(params.get("jpos"), [0, 0, 0]);
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
    params.set("mpos", renderXYZ(this.x, this.y, this.zoom));
    params.set("jpos", renderXYZ(this.jx, this.jy, this.jzoom));
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

function parseXYZ(xyz, def) {
  if (!xyz) {
    return def;
  }
  const components = xyz.split("_");
  if (components.length != 3) {
    return def;
  }
  return [
    parseFloat(components[0]) ?? def[0],
    parseFloat(components[1]) ?? def[1],
    parseFloat(components[2]) ?? def[2],
  ];
}

function renderXYZ(x, y, z) {
  const precision = 3 + Math.ceil(z * BITS_PER_DECIMAL);
  return [x.toFixed(precision), y.toFixed(precision), z.toFixed(2)].join("_");
}

function float(params, key, def) {
  return params.has(key) ? parseFloat(params.get(key)) ?? def : def;
}

function int(params, key, def) {
  return params.has(key) ? parseInt(params.get(key)) ?? def : def;
}
