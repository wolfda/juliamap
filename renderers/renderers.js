import { hasWebgl1, hasWebgl2, hasWebgpu } from "./capabilities.js";
import { CpuRenderer } from "./cpu.js";
import { RenderingEngine } from "./renderer.js";
import { Webgl1Renderer } from "./webgl1.js";
import { Webgl2Renderer } from "./webgl2.js";
import { WebgpuRenderer } from "./webgpu.js";

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

export async function createRenderer(canvas, ctx, map, renderingEngine) {
  renderingEngine = renderingEngine ?? (await getDefaultRenderingEngine());
  switch (renderingEngine) {
    case RenderingEngine.WEBGPU:
      return await WebgpuRenderer.create(canvas, ctx, map);
    case RenderingEngine.WEBGL2:
      return Webgl2Renderer.create(canvas, ctx, map);
    case RenderingEngine.WEBGL1:
      return Webgl1Renderer.create(canvas, ctx, map);
    case RenderingEngine.CPU:
      return CpuRenderer.create(canvas, ctx, map);
    default:
      throw new Error("Unknown renderer: " + renderingEngine);
  }
}

export async function isEngineSupported(renderingEngine) {
  switch (renderingEngine) {
    case RenderingEngine.WEBGPU:
      return hasWebgpu();
    case RenderingEngine.WEBGL1:
      return hasWebgl1();
    case RenderingEngine.WEBGL2:
      return hasWebgl2();
    case RenderingEngine.CPU:
      return true;
    default:
      throw new Error("Unknown renderer: " + renderingEngine);
  }
}

export async function getSupportedRenderers() {
  return (
    await Promise.all(
      Object.values(RenderingEngine).map(async (engine) =>
        (await isEngineSupported(engine)) ? engine : null
      )
    )
  ).filter(Boolean);
}
