import { RenderingEngine } from "./renderer.js";
import { WebglRenderer } from "./webgl.js";

export class Webgl2Renderer extends WebglRenderer {
  static async create(canvas, ctx) {
    const renderer = new Webgl2Renderer(canvas, ctx);
    await renderer.init();
    return renderer;
  }

  constructor(canvas, ctx) {
    super(canvas, ctx, { version: 2 });
  }

  id() {
    return RenderingEngine.WEBGL2;
  }
}
