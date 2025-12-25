import { PaletteInterpolation } from "../core/palette.js";

export const RenderingEngine = {
  WEBGPU: "webgpu",
  WEBGL1: "webgl1",
  WEBGL2: "webgl2",
  CPU: "cpu",
};

export class Renderer {
  /**
   * @param {MapControl} map
   * @param {RenderOptions} options
   * @returns {RenderResults}
   */
  async render(map, options) {
    throw new Error("Not implemented");
  }

  id() {
    throw new Error("Not implemented");
  }

  detach() {
    throw new Error("Not implemented");
  }
}

export class RenderOptions {
  constructor({
    maxSuperSamples,
    deep,
    maxIter,
    palette,
    paletteInterpolation,
    fn,
  } = {}) {
    this.maxSuperSamples = maxSuperSamples;
    this.deep = deep;
    this.maxIter = maxIter;
    this.palette = palette;
    this.paletteInterpolation =
      paletteInterpolation ?? PaletteInterpolation.SPLINE;
    this.fn = fn;
  }
}

export class RenderResults {
  constructor(id, options, flops = null) {
    this.id = id;
    this.options = options;
    this.flops = flops;
  }
}
