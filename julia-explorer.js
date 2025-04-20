import { FractalExplorer } from "./fractal-explorer.js";
import { DEFAULT_FN, Fn } from "./julia.js";

export const Layout = {
  SPLIT: "split",
  MANDEL: "mandel",
  JULIA: "julia",
};

export class JuliaExplorer {
  static async create({
    renderingEngine,
    options,
    onChanged,
    onRendered,
  } = {}) {
    const mandelbrotDiv = document.getElementById("mandelbrot");
    const mandelExplorer = await FractalExplorer.create({
      divContainer: mandelbrotDiv,
      renderingEngine,
      options: { ...options, fn: DEFAULT_FN },
      onMapChanged: onChanged,
      onRendered,
    });

    const juliaDiv = document.getElementById("julia");
    const juliaExplorer = await FractalExplorer.create({
      divContainer: juliaDiv,
      renderingEngine,
      options: { ...options, fn: Fn.julia(0, 0) },
      onMapChanged: onChanged,
      onRendered,
    });

    return new JuliaExplorer(mandelExplorer, juliaExplorer, onChanged);
  }

  constructor(mandelExplorer, juliaExplorer, onChanged) {
    this.mandelExplorer = mandelExplorer;
    this.juliaExplorer = juliaExplorer;
    this.onChanged = onChanged;
    this.mandelExplorer.onDragged = this.updateJuliaFn.bind(this);
    this.juliaTimeoutId = null;
    this.onClickHandler = this.#onClick.bind(this);
    this.setLayout(Layout.SPLIT);
  }

  #onClick() {
    switch (this.layout) {
      case Layout.MANDEL:
        this.setLayout(Layout.JULIA);
        break;

      case Layout.JULIA:
        this.setLayout(Layout.MANDEL);
        break;
    }
  }

  setLayout(layout) {
    this.layout = layout;
    this.mandelExplorer.divContainer.removeEventListener("click", this.onClickHandler);
    this.juliaExplorer.divContainer.removeEventListener("click", this.onClickHandler);
    switch (layout) {
      case Layout.MANDEL:
        this.mandelExplorer.divContainer.className = "fullscreen";
        this.mandelExplorer.setInteractive(true);
        this.juliaExplorer.divContainer.className = "minimized";
        this.juliaExplorer.divContainer.addEventListener("click", this.onClickHandler);
        this.juliaExplorer.setInteractive(false);
        break;

      case Layout.JULIA:
        this.mandelExplorer.divContainer.className = "minimized";
        this.mandelExplorer.setInteractive(false);
        this.juliaExplorer.divContainer.className = "fullscreen";
        this.juliaExplorer.setInteractive(true);
        this.mandelExplorer.divContainer.addEventListener("click", this.onClickHandler);
        break;

      case Layout.SPLIT:
        this.mandelExplorer.setInteractive(true);
        this.juliaExplorer.setInteractive(true);
        break;
    }
    this.resize(window.innerWidth, window.innerHeight);
    this.onChanged?.();
  }

  resize(width, height) {
    // equivalent to css 20vmin
    const minimizedSize = 0.2 * Math.min(width, height);
    switch (this.layout) {
      case Layout.SPLIT:
        const verticalSplit = width > height;
        if (verticalSplit) {
          this.mandelExplorer.resize(width / 2, height);
          this.juliaExplorer.resize(width / 2, height);
          this.mandelExplorer.divContainer.className = "vsplit";
          this.juliaExplorer.divContainer.className = "vsplit";
        } else {
          this.mandelExplorer.resize(width, height / 2);
          this.juliaExplorer.resize(width, height / 2);
          this.mandelExplorer.divContainer.className = "hsplit";
          this.juliaExplorer.divContainer.className = "hsplit";
        }
        break;

      case Layout.MANDEL: {
        this.mandelExplorer.resize(width, height);
        this.juliaExplorer.resize(minimizedSize, minimizedSize);
        break;
      }

      case Layout.JULIA: {
        this.juliaExplorer.resize(width, height);
        this.mandelExplorer.resize(minimizedSize, minimizedSize);
        break;
      }
    }
  }

  updateJuliaFn() {
    const mandelMap = this.mandelExplorer.map;
    this.juliaExplorer.options.fn = Fn.julia(mandelMap.center);
    this.juliaExplorer.render();
  }
}
