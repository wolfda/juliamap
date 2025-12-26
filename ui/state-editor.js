import { Palette, PaletteInterpolation } from "../core/palette.js";
import { RenderingEngine } from "../renderers/renderer.js";
import { appState, StateAttributes } from "../core/state.js";

const PALETTES = [
  Palette.WIKIPEDIA,
  Palette.ELECTRIC,
  Palette.RAINBOW,
  Palette.ZEBRA,
];
const PALETTE_INTERPOLATIONS = [
  PaletteInterpolation.SPLINE,
  PaletteInterpolation.LINEAR,
];
const MIN_SUPER_SAMPLES = 1;
const DEFAULT_SUPER_SAMPLES = 8;
const MAX_SUPER_SAMPLES = 64;

class RendererConfig {
  constructor(renderer, deep) {
    this.renderer = renderer;
    this.deep = deep;
  }

  name() {
    if (this.renderer === null) {
      return "auto";
    }
    return this.deep ? this.renderer + ".deep" : this.renderer;
  }
}

export class AppStateEditor {
  constructor(supportedRenderers) {
    this.panel = document.getElementById("controlPanel");
    this.gear = document.getElementById("gearIcon");
    this.rendererSelect = document.getElementById("rendererSelect");
    this.paletteSelect = document.getElementById("paletteSelect");
    this.paletteInterpolationSelect = document.getElementById(
      "paletteInterpolationSelect"
    );
    this.iterAuto = document.getElementById("iterAuto");
    this.iterRange = document.getElementById("iterRange");
    this.iterValue = document.getElementById("iterValue");
    this.rendererConfigs = {};
    this.#getRenderingConfigs(supportedRenderers).forEach((config) => {
      this.rendererConfigs[config.name()] = config;
      const opt = document.createElement("option");
      opt.value = config.name();
      opt.textContent = config.name();
      this.rendererSelect.appendChild(opt);
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

    this.layoutSelect = document.getElementById("layoutSelect");

    this.defaultIter = 0;
    this.currentPixelDensity = 1;

    this.gear.addEventListener("click", () => {
      this.panel.style.display =
        this.panel.style.display === "grid" ? "none" : "grid";
    });

    this.rendererSelect.addEventListener("change", () => {
      const renderer = this.getSelectedRenderer();
      appState.setRenderingEngine(renderer.renderer, renderer.deep);
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

    this.layoutSelect.addEventListener("change", () => {
      appState.setLayout(this.layoutSelect.value);
    });

    appState.addEventListener("change", this.#onAppStateChanged.bind(this));

    this.maxSuperSamplesRange.min = MIN_SUPER_SAMPLES;
    this.maxSuperSamplesRange.max = MAX_SUPER_SAMPLES;

    this.rendererSelect.value = new RendererConfig(
      appState.renderingEngine,
      appState.deep
    ).name();
    this.paletteSelect.value = appState.palette ?? Palette.WIKIPEDIA;
    this.paletteInterpolationSelect.value =
      appState.paletteInterpolation ?? PaletteInterpolation.SPLINE;
    this.iterAuto.checked = appState.maxIter === null;
    this.#refresh();
  }

  #getRenderingConfigs(renderers) {
    return [null, ...renderers].flatMap((renderer) => {
      const rendererConfigs = [];
      rendererConfigs.push(new RendererConfig(renderer, renderer === null));
      if (
        renderer === RenderingEngine.WEBGPU ||
        renderer === RenderingEngine.WEBGL1 ||
        renderer === RenderingEngine.WEBGL2 ||
        renderer === RenderingEngine.CPU
      ) {
        rendererConfigs.push(new RendererConfig(renderer, true));
      }
      return rendererConfigs;
    });
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
    } else if (event.detail === StateAttributes.PALETTE_INTERPOLATION) {
      this.paletteInterpolationSelect.value =
        appState.paletteInterpolation ?? PaletteInterpolation.SPLINE;
    }
  }

  getSelectedRenderer() {
    return this.rendererConfigs[this.rendererSelect.value];
  }

  getMaxSuperSamples() {
    return parseInt(this.maxSuperSamplesRange.value, 10);
  }

  setMaxSuperSamples(maxSuperSamples) {
    this.maxSuperSamplesRange.value = maxSuperSamples;
  }
}
