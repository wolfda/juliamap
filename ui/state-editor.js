import { Palette, PaletteInterpolation } from "../core/palette.js";
import { appState, DeepMode, StateAttributes } from "../core/state.js";

const PALETTES = [
  Palette.WIKIPEDIA,
  Palette.ELECTRIC,
  Palette.RAINBOW,
  Palette.ZEBRA,
  Palette.BLANK,
];
const PALETTE_INTERPOLATIONS = [
  PaletteInterpolation.SPLINE,
  PaletteInterpolation.LINEAR,
];
const RENDERER_AUTO = "auto";
const DEEP_MODES = [DeepMode.AUTO, DeepMode.NO, DeepMode.YES];
const MIN_SUPER_SAMPLES = 1;
const DEFAULT_SUPER_SAMPLES = 8;
const MAX_SUPER_SAMPLES = 64;

export class AppStateEditor {
  constructor(supportedRenderers) {
    this.panel = document.getElementById("controlPanel");
    this.gear = document.getElementById("gearIcon");
    this.rendererSelect = document.getElementById("rendererSelect");
    this.deepSelect = document.getElementById("deepSelect");
    this.paletteSelect = document.getElementById("paletteSelect");
    this.paletteInterpolationSelect = document.getElementById(
      "paletteInterpolationSelect"
    );
    this.iterAuto = document.getElementById("iterAuto");
    this.iterRange = document.getElementById("iterRange");
    this.iterValue = document.getElementById("iterValue");
    [RENDERER_AUTO, ...supportedRenderers].forEach((renderer) => {
      const opt = document.createElement("option");
      opt.value = renderer;
      opt.textContent = renderer;
      this.rendererSelect.appendChild(opt);
    });
    DEEP_MODES.forEach((mode) => {
      const opt = document.createElement("option");
      opt.value = mode;
      opt.textContent = mode;
      this.deepSelect.appendChild(opt);
    });
    PALETTES.forEach((palette) => {
      const opt = document.createElement("option");
      opt.value = palette;
      opt.textContent = palette;
      this.paletteSelect.appendChild(opt);
    });
    PALETTE_INTERPOLATIONS.forEach((interp) => {
      const opt = document.createElement("option");
      opt.value = interp;
      opt.textContent = interp.toLowerCase();
      this.paletteInterpolationSelect.appendChild(opt);
    });

    this.maxSuperSamplesRange = document.getElementById("maxSuperSamplesRange");
    this.maxSuperSamplesValue = document.getElementById("maxSuperSamplesValue");
    this.normalMapToggle = document.getElementById("normalMapToggle");

    this.layoutSelect = document.getElementById("layoutSelect");

    this.defaultIter = 0;
    this.currentPixelDensity = 1;

    this.gear.addEventListener("click", () => {
      this.panel.style.display =
        this.panel.style.display === "grid" ? "none" : "grid";
    });

    this.rendererSelect.addEventListener("change", () => {
      const renderer =
        this.rendererSelect.value === RENDERER_AUTO
          ? null
          : this.rendererSelect.value;
      appState.setRenderingEngine(renderer);
    });

    this.deepSelect.addEventListener("change", () => {
      appState.setDeepMode(this.deepSelect.value);
    });

    this.paletteSelect.addEventListener("change", () => {
      appState.setPalette(this.paletteSelect.value);
    });
    this.paletteInterpolationSelect.addEventListener("change", () => {
      appState.setPaletteInterpolation(this.paletteInterpolationSelect.value);
    });

    this.iterAuto.addEventListener("change", () => {
      appState.setMaxIter(this.iterAuto.checked ? null : this.iterRange.value);
      this.#refresh();
    });

    this.iterRange.addEventListener("input", () => {
      appState.setMaxIter(this.iterRange.value);
      this.#refresh();
    });

    this.maxSuperSamplesRange.addEventListener("input", () => {
      appState.setMaxSuperSamples(this.getMaxSuperSamples());
      this.#refresh();
    });

    this.normalMapToggle.addEventListener("change", () => {
      appState.setNormalMap(this.normalMapToggle.checked);
    });

    this.layoutSelect.addEventListener("change", () => {
      appState.setLayout(this.layoutSelect.value);
    });

    appState.addEventListener("change", this.#onAppStateChanged.bind(this));

    this.maxSuperSamplesRange.min = MIN_SUPER_SAMPLES;
    this.maxSuperSamplesRange.max = MAX_SUPER_SAMPLES;

    this.rendererSelect.value = appState.renderingEngine ?? RENDERER_AUTO;
    this.deepSelect.value = appState.deepMode ?? DeepMode.AUTO;
    this.paletteSelect.value = appState.palette ?? Palette.WIKIPEDIA;
    this.paletteInterpolationSelect.value =
      appState.paletteInterpolation ?? PaletteInterpolation.SPLINE;
    this.iterAuto.checked = appState.maxIter === null;
    this.normalMapToggle.checked = appState.normalMap !== false;
    this.#refresh();
  }

  #refresh() {
    this.iterRange.disabled = this.iterAuto.checked;
    if (this.iterAuto.checked) {
      this.iterRange.value = appState.getDefaultMaxIter();
    }
    this.iterValue.textContent = this.iterRange.value;
    this.setMaxSuperSamples(
      appState.maxSuperSamples ?? DEFAULT_SUPER_SAMPLES
    );
    this.maxSuperSamplesValue.textContent = this.getMaxSuperSamples();
  }

  #onAppStateChanged(event) {
    if (event.detail === StateAttributes.VIEWPORT && this.iterAuto.checked) {
      this.#refresh();
    } else if (event.detail === StateAttributes.LAYOUT) {
      this.layoutSelect.value = appState.layout;
    } else if (event.detail === StateAttributes.RENDERING_ENGINE) {
      this.rendererSelect.value = appState.renderingEngine ?? RENDERER_AUTO;
    } else if (event.detail === StateAttributes.DEEP_MODE) {
      this.deepSelect.value = appState.deepMode ?? DeepMode.AUTO;
    } else if (event.detail === StateAttributes.PALETTE_INTERPOLATION) {
      this.paletteInterpolationSelect.value =
        appState.paletteInterpolation ?? PaletteInterpolation.SPLINE;
    } else if (event.detail === StateAttributes.NORMAL_MAP) {
      this.normalMapToggle.checked = appState.normalMap !== false;
    }
  }

  getMaxSuperSamples() {
    return parseInt(this.maxSuperSamplesRange.value, 10);
  }

  setMaxSuperSamples(maxSuperSamples) {
    this.maxSuperSamplesRange.value = maxSuperSamples;
  }
}
