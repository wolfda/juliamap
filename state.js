import { Complex } from "./complex.js";
import { Layout } from "./julia-explorer.js";
import { Palette } from "./palette.js";

const BITS_PER_DECIMAL = Math.log10(2);
const DEFAULT_CENTER = [new Complex(-0.5, 0), 0];
const ZERO_CENTER = [new Complex(0, 0), 0];
const DEFAULT_LAYOUT = Layout.MANDEL;
const DEFAULT_PALETTE = Palette.WIKIPEDIA;

export class AppState {
  static parseFromAddressBar() {
    const params = new URLSearchParams(window.location.search);
    const [mcenter, mzoom] = parseXYZ(params.get("mpos"), DEFAULT_CENTER);
    const [jcenter, jzoom] = parseXYZ(params.get("jpos"), ZERO_CENTER);
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
    let palette = params.get("palette");
    if (palette === DEFAULT_PALETTE) {
      palette = null;
    }
    const maxIter = int(params, "iter", null);
    const pixelDensity = float(params, "pd", null);
    return new AppState({
      mcenter,
      mzoom,
      jcenter,
      jzoom,
      layout,
      renderingEngine,
      palette,
      maxIter,
      pixelDensity,
      deep,
    });
  }

  constructor({
    mcenter,
    mzoom,
    jcenter,
    jzoom,
    layout,
    renderingEngine,
    palette,
    maxIter,
    pixelDensity,
    deep,
  }) {
    // Mandelbrot coordinates
    this.mcenter = mcenter;
    this.mzoom = mzoom;

    // Julia coordinates
    this.jcenter = jcenter;
    this.jzoom = jzoom;

    this.layout = layout;
    this.renderingEngine = renderingEngine;
    this.palette = palette;
    this.maxIter = maxIter;
    this.pixelDensity = pixelDensity;
    this.deep = deep;
  }

  /**
   * Update the URL with current state
   */
  updateAddressBar() {
    const params = new URLSearchParams(window.location.search);

    // Truncate x and y to the most relevant decimals. 3 decimals required at zoom level 0.
    // Each additional zoom level requires 2 more bits of precision. 1 bit = ~0.30103 decimals.
    if (
      renderXYZ(this.mcenter, this.mzoom) !==
      renderXYZ(DEFAULT_CENTER[0], DEFAULT_CENTER[1])
    ) {
      params.set("mpos", renderXYZ(this.mcenter, this.mzoom));
    } else {
      params.delete("mpos");
    }
    if (
      renderXYZ(this.jcenter, this.jzoom) !==
      renderXYZ(ZERO_CENTER[0], ZERO_CENTER[1])
    ) {
      params.set("jpos", renderXYZ(this.jcenter, this.jzoom));
    } else {
      params.delete("jpos");
    }
    if (this.layout !== null && this.layout != DEFAULT_LAYOUT) {
      params.set("layout", this.layout);
    } else {
      params.delete("layout");
    }
    if (this.renderingEngine) {
      params.set("renderer", this.renderingEngine + (this.deep ? ".deep" : ""));
    } else {
      params.delete("renderer");
    }
    if (this.maxIter !== null) {
      params.set("iter", this.maxIter);
    } else {
      params.delete("iter");
    }
    if (this.pixelDensity !== null) {
      params.set("pd", this.pixelDensity);
    } else {
      params.delete("pd");
    }
    if (this.palette && this.palette !== Palette.WIKIPEDIA) {
      params.set("palette", this.palette);
    } else {
      params.delete("palette");
    }

    const queryParams = params.toString();
    const newUrl = queryParams
      ? `${window.location.pathname}?${queryParams}`
      : window.location.pathname;
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
    new Complex(
      parseFloat(components[0]) ?? def[0],
      parseFloat(components[1]) ?? def[1]
    ),
    parseFloat(components[2]) ?? def[2],
  ];
}

function renderXYZ(center, zoom) {
  const precision = 3 + Math.ceil(zoom * BITS_PER_DECIMAL);
  return [
    truncatePrecision(center.x ?? 0, precision),
    truncatePrecision(center.y ?? 0, precision),
    truncatePrecision(zoom ?? 0, 2),
  ].join("_");
}

function int(params, key, def) {
  return params.has(key) ? parseInt(params.get(key)) ?? def : def;
}

function float(params, key, def) {
  return params.has(key) ? parseFloat(params.get(key)) ?? def : def;
}

function truncatePrecision(x, precision) {
  return parseFloat(x.toFixed(precision));
}
