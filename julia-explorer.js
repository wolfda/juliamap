import { Complex } from "./math/complex.js";
import { FractalExplorer } from "./fractal-explorer.js";
import { DEFAULT_FN, Fn } from "./math/julia.js";
import { appState } from "./state.js";

export const Layout = {
  SPLIT: "split",
  MANDEL: "mandel",
  JULIA: "julia",
};

export class JuliaExplorer {
  static async create({
    renderingEngine,
    options,
    layout,
    onChanged,
    onRendered,
  } = {}) {
    const mandelbrotDiv = document.getElementById("mandelbrot");
    const mandelExplorer = new FractalExplorer(
      mandelbrotDiv,
      renderingEngine,
      { ...options, fn: DEFAULT_FN },
      onChanged,
      null,
      onRendered
    );

    const juliaDiv = document.getElementById("julia");
    const juliaExplorer = new FractalExplorer(
      juliaDiv,
      renderingEngine,
      { ...options, fn: Fn.julia(new Complex(0, 0)) },
      onChanged,
      null,
      onRendered
    );

    return await new JuliaExplorer(
      mandelExplorer,
      juliaExplorer,
      onChanged
    ).#init(layout);
  }

  constructor(mandelExplorer, juliaExplorer, onChanged) {
    this.mandelExplorer = mandelExplorer;
    this.juliaExplorer = juliaExplorer;
    this.onChanged = onChanged;
    this.mandelExplorer.onDragged = this.updateJuliaFn.bind(this);
    this.juliaTimeoutId = null;
    this.onClickHandler = this.#onClick.bind(this);
  }

  async #init(layout) {
    await this.setLayout(layout);
    await this.mandelExplorer.initRenderer();
    await this.juliaExplorer.initRenderer();
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
        appState.setLayout(Layout.JULIA);
        break;

      case Layout.JULIA:
        appState.setLayout(Layout.MANDEL);
        // await this.setLayout(Layout.MANDEL);
        break;
    }
  }

  async setLayout(layout) {
    this.layout = layout;
    this.mandelExplorer.divContainer.removeEventListener(
      "click",
      this.onClickHandler
    );
    this.juliaExplorer.divContainer.removeEventListener(
      "click",
      this.onClickHandler
    );
    switch (layout) {
      case Layout.MANDEL:
        this.mandelExplorer.divContainer.className = "fullscreen";
        this.mandelExplorer.setInteractive(true);
        this.juliaExplorer.divContainer.className = "minimized";
        this.juliaExplorer.divContainer.addEventListener(
          "click",
          this.onClickHandler
        );
        this.juliaExplorer.setInteractive(false);
        break;

      case Layout.JULIA:
        this.mandelExplorer.divContainer.className = "minimized";
        this.mandelExplorer.setInteractive(false);
        this.juliaExplorer.divContainer.className = "fullscreen";
        this.juliaExplorer.setInteractive(true);
        this.mandelExplorer.divContainer.addEventListener(
          "click",
          this.onClickHandler
        );
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
