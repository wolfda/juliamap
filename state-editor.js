import { Palette } from "./palette.js";
import { RenderingEngine } from "./renderers/renderer.js";
import { appState, StateAttributes } from "./state.js";

const PALETTES = [
  Palette.WIKIPEDIA,
  Palette.ELECTRIC,
  Palette.RAINBOW,
  Palette.ZEBRA,
];

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
    this.iterAuto = document.getElementById("iterAuto");
    this.iterRange = document.getElementById("iterRange");
    this.iterValue = document.getElementById("iterValue");
    this.pixelDensityAuto = document.getElementById("pixelDensityAuto");
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

    this.pixelDensityRange = document.getElementById("pixelDensityRange");
    this.pixelDensityValue = document.getElementById("pixelDensityValue");

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

    this.iterAuto.addEventListener("change", () => {
      appState.setMaxIter(this.iterAuto.checked ? null : this.iterRange.value);
      this.#refresh();
    });

    this.iterRange.addEventListener("input", () => {
      appState.setMaxIter(this.iterRange.value);
      this.#refresh();
    });

    this.pixelDensityAuto.addEventListener("change", () => {
      appState.setPixelDensity(
        this.pixelDensityAuto.checked ? null : this.getPixelDensity()
      );
      this.#refresh();
    });

    this.pixelDensityRange.addEventListener("input", () => {
      appState.setPixelDensity(this.getPixelDensity());
      this.#refresh();
    });

    this.layoutSelect.addEventListener("change", () => {
      appState.setLayout(this.layoutSelect.value);
    });

    appState.addEventListener("change", this.#onAppStateChanged.bind(this));

    this.pixelDensityRange.min = Math.log2(1 / 8);
    this.pixelDensityRange.max = Math.log2(8);

    this.rendererSelect.value = new RendererConfig(
      appState.renderingEngine,
      appState.deep
    ).name();
    this.paletteSelect.value = appState.palette ?? Palette.WIKIPEDIA;
    this.iterAuto.checked = appState.maxIter === null;
    this.pixelDensityAuto.checked = appState.pixelDensity === null;
    this.#refresh();
  }

  #getRenderingConfigs(renderers) {
    return [null, ...renderers].flatMap((renderer) => {
      const rendererConfigs = [];
      rendererConfigs.push(new RendererConfig(renderer, renderer === null));
      if (
        renderer === RenderingEngine.WEBGPU ||
        renderer === RenderingEngine.WEBGL1 ||
        renderer === RenderingEngine.WEBGL2
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
    this.pixelDensityRange.disabled = this.pixelDensityAuto.checked;
    if (this.pixelDensityAuto.checked) {
      this.setPixelDensity(appState.dynamicPixelDensity);
    }
    this.pixelDensityValue.textContent = pixelDensityToString(
      this.getPixelDensity()
    );
  }

  #onAppStateChanged(event) {
    if (
      event.detail === StateAttributes.VIEWPORT &&
      (this.iterAuto.checked || this.pixelDensityAuto.checked)
    ) {
      this.#refresh();
    } else if (event.detail === StateAttributes.LAYOUT) {
      this.layoutSelect.value = appState.layout;
    }
  }

  getSelectedRenderer() {
    return this.rendererConfigs[this.rendererSelect.value];
  }

  getPixelDensity() {
    return Math.pow(2, this.pixelDensityRange.value);
  }

  setPixelDensity(pixelDensity) {
    this.pixelDensityRange.value = Math.log2(pixelDensity);
  }
}

function pixelDensityToString(pixelDensity) {
  switch (pixelDensity) {
    case 0.125:
      return "1/8";
    case 0.25:
      return "1/4";
    case 0.5:
      return "1/2";
    default:
      return pixelDensity;
  }
}
