import { RenderingEngine } from "./renderer.js";
import { WebglRenderer } from "./webgl.js";

export class Webgl1Renderer extends WebglRenderer {
  static async create(canvas, ctx) {
    const renderer = new Webgl1Renderer(canvas, ctx);
    await renderer.init();
    return renderer;
  }

  constructor(canvas, ctx) {
    super(canvas, ctx, { version: 1 });
  }

  id() {
    return RenderingEngine.WEBGL1;
  }
}
