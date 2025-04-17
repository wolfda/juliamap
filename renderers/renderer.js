import { hasWebgl1, hasWebgl2, hasWebgpu } from "./capabilities.js";

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
   * @returns {RenderContext}
   */
  render(map, options) {
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
  constructor({ pixelDensity, deep, maxIter, palette, fn } = {}) {
    this.pixelDensity = pixelDensity ?? 1;
    this.deep = deep;
    this.maxIter = maxIter;
    this.palette = palette;
    this.fn = fn;
  }
}

export class RenderContext {
  constructor(id, options) {
    this.id = id;
    this.options = options;
  }
}

export async function getDefaultRenderingEngine() {
  if (await hasWebgpu()) {
    return RenderingEngine.WEBGPU;
  } else if (hasWebgl2()) {
    return RenderingEngine.WEBGL2;
  } else if (hasWebgl1()) {
    return RenderingEngine.WEBGL1;
  } else {
    return RenderingEngine.CPU;
  }
}
