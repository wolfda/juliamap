import { Complex } from "./complex.js";
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
      options: { ...options, fn: Fn.julia(new Complex(0, 0)) },
      onMapChanged: onChanged,
      onRendered,
    });

    return await new JuliaExplorer(mandelExplorer, juliaExplorer, onChanged).#init();
  }

  constructor(mandelExplorer, juliaExplorer, onChanged) {
    this.mandelExplorer = mandelExplorer;
    this.juliaExplorer = juliaExplorer;
    this.onChanged = onChanged;
    this.mandelExplorer.onDragged = this.updateJuliaFn.bind(this);
    this.juliaTimeoutId = null;
    this.onClickHandler = this.#onClick.bind(this);
  }

  async #init() {
    await this.setLayout(Layout.SPLIT);
    this.attach();
    return this;
  }

  attach() {
    this.mandelExplorer.attach();
    this.juliaExplorer.attach();
  }

  detach() {
    this.mandelExplorer.detach();
    this.juliaExplorer.detach();
  }

  async #onClick() {
    switch (this.layout) {
      case Layout.MANDEL:
        await this.setLayout(Layout.JULIA);
        break;

      case Layout.JULIA:
        await this.setLayout(Layout.MANDEL);
        break;
    }
  }

  async setLayout(layout) {
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
    await this.resize(window.innerWidth, window.innerHeight);
    this.onChanged?.();
  }

  async resize(width, height) {
    // equivalent to css 20vmin
    const minimizedSize = 0.2 * Math.min(width, height);
    switch (this.layout) {
      case Layout.SPLIT:
        const verticalSplit = width > height;
        if (verticalSplit) {
          await this.mandelExplorer.resize(width / 2, height);
          await this.juliaExplorer.resize(width / 2, height);
          this.mandelExplorer.divContainer.className = "vsplit";
          this.juliaExplorer.divContainer.className = "vsplit";
        } else {
          await this.mandelExplorer.resize(width, height / 2);
          await this.juliaExplorer.resize(width, height / 2);
          this.mandelExplorer.divContainer.className = "hsplit";
          this.juliaExplorer.divContainer.className = "hsplit";
        }
        break;

      case Layout.MANDEL: {
        await this.mandelExplorer.resize(width, height);
        await this.juliaExplorer.resize(minimizedSize, minimizedSize);
        break;
      }

      case Layout.JULIA: {
        await this.juliaExplorer.resize(width, height);
        await this.mandelExplorer.resize(minimizedSize, minimizedSize);
        break;
      }
    }
  }

  fps() {
    return Math.max(this.mandelExplorer.fps(), this.juliaExplorer.fps());
  }

  async updateJuliaFn() {
    const mandelMap = this.mandelExplorer.map;
    this.juliaExplorer.options.fn = Fn.julia(mandelMap.center);
    await this.juliaExplorer.render();
  }
}
