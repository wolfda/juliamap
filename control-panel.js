import { Palette } from "./palette.js";

const DEFAULT_RENDERERS = [
  "auto",
  "webgpu",
  "webgpu.deep",
  "webgl2",
  "webgl2.deep",
  "webgl1",
  "webgl1.deep",
  "cpu",
];

const PALETTES = [
  Palette.WIKIPEDIA,
  Palette.ELECTRIC,
  Palette.RAINBOW,
  Palette.ZEBRA,
]

const PIXEL_STEPS = [0.125, 0.25, 0.5, 1, 2, 4, 8];


export class ControlPanel extends EventTarget {
  constructor({
    renderer = "auto",
    palette = Palette.WIKIPEDIA,
    maxIter = null,
    pixelDensity = 1,
    renderers = DEFAULT_RENDERERS,
  } = {}) {
    super();

    this.panel = document.getElementById("controlPanel");
    this.gear = document.getElementById("gearIcon");
    this.rendererSelect = document.getElementById("rendererSelect");
    this.paletteSelect = document.getElementById("paletteSelect");
    this.iterAuto = document.getElementById("iterAuto");
    this.iterRange = document.getElementById("iterRange");
    this.iterValue = document.getElementById("iterValue");
    this.pixelDensityAuto = document.getElementById("pixelDensityAuto");
    ["auto", ...renderers].forEach((render) => {
      const opt = document.createElement("option");
      opt.value = render;
      opt.textContent = render;
      this.rendererSelect.appendChild(opt);
    });
    PALETTES.forEach(palette => {
      const opt = document.createElement("option");
      opt.value = palette;
      opt.textContent = palette;
      this.paletteSelect.appendChild(opt);
    });

    this.pixelDensityRange = document.getElementById("pixelDensityRange");
    this.pixelDensityValue = document.getElementById("pixelDensityValue");

    this.defaultIter = 0;
    this.currentPixelDensity = 1;

    this.gear.addEventListener("click", () => {
      this.panel.style.display =
        this.panel.style.display === "grid" ? "none" : "grid";
    });

    this.rendererSelect.addEventListener("change", () => {
      this.dispatchEvent(
        new CustomEvent("rendererChange", {
          detail: this.rendererSelect.value,
        })
      );
    });

    this.paletteSelect.addEventListener("change", () => {
      this.dispatchEvent(
        new CustomEvent("paletteChange", {
          detail: this.paletteSelect.value,
        })
      );
    });

    this.iterAuto.addEventListener("change", () => {
      this.dispatchEvent(
        new CustomEvent("maxIterChange", {
          detail: this.iterAuto.checked ? null : parseInt(this.iterRange.value),
        })
      );
      this.#updateIterUI();
    });

    this.iterRange.addEventListener("input", () => {
      this.dispatchEvent(
        new CustomEvent("maxIterChange", {
          detail: parseInt(this.iterRange.value),
        })
      );
      this.#updateIterUI();
    });

    this.pixelDensityAuto.addEventListener("change", () => {
      this.dispatchEvent(
        new CustomEvent("pixelDensityChange", {
          detail: this.pixelDensityAuto.checked
            ? null
            : PIXEL_STEPS[this.pixelDensityRange.value],
        })
      );
      this.#updatePixelUI();
    });

    this.pixelDensityRange.addEventListener("input", () => {
      this.dispatchEvent(
        new CustomEvent("pixelDensityChange", {
          detail: PIXEL_STEPS[this.pixelDensityRange.value],
        })
      );
      this.#updatePixelUI();
    });

    this.pixelDensityRange.min = 0;
    this.pixelDensityRange.max = PIXEL_STEPS.length - 1;
    this.pixelDensityRange.step = 1;

    this.setState({ renderer, palette, maxIter, pixelDensity });
  }

  setState({ renderer, palette, maxIter, pixelDensity } = {}) {
    if (renderer !== undefined) {
      this.rendererSelect.value = renderer;
    }
    if (palette !== undefined) {
      this.paletteSelect.value = palette;
    }
    if (maxIter !== undefined) {
      this.iterAuto.checked = maxIter == null;
      this.iterRange.value = maxIter ?? 200;
    }
    if (pixelDensity !== undefined) {
      this.pixelDensityAuto.checked = pixelDensity == null;
      const idx = PIXEL_STEPS.indexOf(pixelDensity ?? 1);
      this.pixelDensityRange.value =
        idx >= 0 ? idx : PIXEL_STEPS.indexOf(1);
    }
    this.#updateIterUI();
    this.#updatePixelUI();
  }

  updateIterDefault(defaultIter) {
    this.defaultIter = defaultIter;
    this.#updateIterUI();
  }

  updateDynamicPixelDensity(currentPixelDensity) {
    this.currentPixelDensity = currentPixelDensity;
    this.#updatePixelUI();
  }

  #updateIterUI() {
    this.iterRange.disabled = this.iterAuto.checked;
    const value = this.iterAuto.checked
      ? this.defaultIter
      : this.iterRange.value;
    this.iterValue.textContent = value;
  }

  #updatePixelUI() {
    this.pixelDensityRange.disabled = this.pixelDensityAuto.checked;
    const val = PIXEL_STEPS[parseInt(this.pixelDensityRange.value)];
    this.pixelDensityValue.textContent = this.#pixelDensityToString(
      this.pixelDensityAuto.checked ? this.currentPixelDensity : val
    );
  }

  #pixelDensityToString(pixelDensity) {
    switch (pixelDensity) {
      case 0.125:
        return "1/8";
      case 0.25:
        return "1/4";
      case 0.5:
        return "1/2";
      default:
        return Number(pixelDensity.toFixed(3)).toString();
    }
  }
}
