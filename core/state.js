import { Complex, parseComplex, renderComplex } from "../math/complex.js";
import { Palette, PaletteInterpolation } from "./palette.js";

export const Layout = {
  SPLIT: "split",
  MANDEL: "mandel",
  JULIA: "julia",
};

export const DeepMode = {
  AUTO: "auto",
  NO: "no",
  YES: "yes",
};

const DEFAULT_CENTER = [new Complex(-0.5, 0), 0];
const ZERO_CENTER = [new Complex(0, 0), 0];
const DEFAULT_LAYOUT = Layout.MANDEL;
const DEFAULT_PALETTE = Palette.WIKIPEDIA;
const DEFAULT_PALETTE_INTERPOLATION = PaletteInterpolation.SPLINE;

export const StateAttributes = {
  VIEWPORT: "viewport",
  LAYOUT: "layout",
  RENDERING_ENGINE: "renderingEngine",
  DEEP_MODE: "deepMode",
  PALETTE: "palette",
  PALETTE_INTERPOLATION: "paletteInterpolation",
  MAX_ITER: "maxIter",
  MAX_SUPER_SAMPLES: "maxSuperSamples",
  NORMAL_MAP: "normalMap",
};


export class AppState extends EventTarget {
  static parseFromAddressBar() {
    const params = new URLSearchParams(window.location.search);
    const [mcenter, mzoom] = parseXYZ(params.get("mpos"), DEFAULT_CENTER);
    const [jcenter, jzoom] = parseXYZ(params.get("jpos"), ZERO_CENTER);
    const layout = params.get("layout") ?? DEFAULT_LAYOUT;
    let renderingEngine = params.get("renderer");
    let deepMode = DeepMode.AUTO;
    if (renderingEngine) {
      const split = renderingEngine.split(".");
      if (split.length > 1) {
        renderingEngine = split[0];
        if (split[1] === "deep") {
          deepMode = DeepMode.YES;
        }
      }
    }
    const deepParam = params.get("deep");
    if (
      deepParam === DeepMode.AUTO ||
      deepParam === DeepMode.NO ||
      deepParam === DeepMode.YES
    ) {
      deepMode = deepParam;
    }
    let palette = params.get("palette");
    if (palette === DEFAULT_PALETTE) {
      palette = null;
    }
    let paletteInterpolation = params.get("interp");
    if (paletteInterpolation === DEFAULT_PALETTE_INTERPOLATION) {
      paletteInterpolation = null;
    }
    const maxIter = int(params, "iter", null);
    const maxSuperSamples = int(params, "ss", 8);
    const normalMap = bool(params, "nm", true);
    return new AppState({
      mcenter,
      mzoom,
      jcenter,
      jzoom,
      layout,
      renderingEngine,
      palette,
      paletteInterpolation,
      maxIter,
      maxSuperSamples,
      deepMode,
      normalMap,
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
    paletteInterpolation,
    maxIter,
    maxSuperSamples,
    deepMode,
    normalMap,
  }) {
    super();

    // Mandelbrot coordinates
    this.mcenter = mcenter;
    this.mzoom = mzoom;

    // Julia coordinates
    this.jcenter = jcenter;
    this.jzoom = jzoom;

    this.layout = layout;
    this.renderingEngine = renderingEngine;
    this.deepMode = deepMode ?? DeepMode.AUTO;
    this.palette = palette;
    this.paletteInterpolation = paletteInterpolation;
    this.maxIter = maxIter;
    this.maxSuperSamples = maxSuperSamples;
    this.normalMap = normalMap ?? true;

    this.updateURLTimeoutId = null;
  }

  setViewport(mcenter, mzoom, jcenter, jzoom) {
    this.mcenter = mcenter;
    this.mzoom = mzoom;
    this.jcenter = jcenter;
    this.jzoom = jzoom;
    this.#triggerChange(StateAttributes.VIEWPORT);
  }

  setLayout(layout) {
    if (this.layout !== layout) {
      this.layout = layout;
      this.#triggerChange(StateAttributes.LAYOUT);
    }
  }

  setRenderingEngine(renderingEngine) {
    if (this.renderingEngine !== renderingEngine) {
      this.renderingEngine = renderingEngine;
      this.#triggerChange(StateAttributes.RENDERING_ENGINE);
    }
  }

  setDeepMode(deepMode) {
    if (this.deepMode !== deepMode) {
      this.deepMode = deepMode;
      this.#triggerChange(StateAttributes.DEEP_MODE);
    }
  }

  setPalette(palette) {
    if (this.palette !== palette) {
      this.palette = palette;
      this.#triggerChange(StateAttributes.PALETTE);
    }
  }

  setPaletteInterpolation(paletteInterpolation) {
    if (this.paletteInterpolation !== paletteInterpolation) {
      this.paletteInterpolation = paletteInterpolation;
      this.#triggerChange(StateAttributes.PALETTE_INTERPOLATION);
    }
  }

  setMaxIter(maxIter) {
    if (this.maxIter !== maxIter) {
      this.maxIter = maxIter;
      this.#triggerChange(StateAttributes.MAX_ITER);
    }
  }

  setMaxSuperSamples(maxSuperSamples) {
    if (this.maxSuperSamples !== maxSuperSamples) {
      this.maxSuperSamples = maxSuperSamples;
      this.#triggerChange(StateAttributes.MAX_SUPER_SAMPLES);
    }
  }

  setNormalMap(normalMap) {
    if (this.normalMap !== normalMap) {
      this.normalMap = normalMap;
      this.#triggerChange(StateAttributes.NORMAL_MAP);
    }
  }

  getDefaultMaxIter() {
    return Math.round(200 * (1 + this.mzoom));
  }

  #triggerChange(attribute) {
    this.dispatchEvent(new CustomEvent("change", { detail: attribute }));
    this.#updateAddressBar();
  }

  /**
   * Update the URL with current state
   */
  #updateAddressBar() {
    clearTimeout(this.updateURLTimeoutId);
    this.updateURLTimeoutId = setTimeout(() => {
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
        params.set("renderer", this.renderingEngine);
      } else {
        params.delete("renderer");
      }
      if (this.deepMode && this.deepMode !== DeepMode.AUTO) {
        params.set("deep", this.deepMode);
      } else {
        params.delete("deep");
      }
      if (this.maxIter !== null) {
        params.set("iter", this.maxIter);
      } else {
        params.delete("iter");
      }
      if (this.maxSuperSamples !== null) {
        params.set("ss", this.maxSuperSamples);
      } else {
        params.delete("ss");
      }
      if (this.normalMap === false) {
        params.set("nm", "0");
      } else {
        params.delete("nm");
      }
      if (this.palette && this.palette !== Palette.WIKIPEDIA) {
        params.set("palette", this.palette);
      } else {
        params.delete("palette");
      }
      if (
        this.paletteInterpolation &&
        this.paletteInterpolation !== DEFAULT_PALETTE_INTERPOLATION
      ) {
        params.set("interp", this.paletteInterpolation);
      } else {
        params.delete("interp");
      }

      const queryParams = params.toString();
      const newUrl = queryParams
        ? `${window.location.pathname}?${queryParams}`
        : window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    }, 200);
  }
}

function parseXYZ(xyz, def) {
  if (!xyz) {
    return def;
  }
  const components = xyz.split("_");
  if (components.length !== 3) {
    return def;
  }
  return [
    parseComplex(components[0] + "," + components[1]),
    parseFloat(components[2]) ?? def[2],
  ];
}

function renderXYZ(center, zoom) {
  return renderComplex(center, zoom, "_") + "_" + zoom.toFixed(2);
}

function int(params, key, def) {
  return params.has(key) ? parseInt(params.get(key)) ?? def : def;
}

function bool(params, key, def) {
  if (!params.has(key)) {
    return def;
  }
  const value = params.get(key);
  if (value === "0" || value === "false") {
    return false;
  }
  if (value === "1" || value === "true") {
    return true;
  }
  return def;
}

export const appState = AppState.parseFromAddressBar();
