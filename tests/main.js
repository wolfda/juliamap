import { BigComplexPlane } from "../complex.js";
import { DEFAULT_FN } from "../julia.js";
import { MapControl } from "../map.js";
import { Palette } from "../palette.js";
import { RenderingEngine, RenderOptions } from "../renderers/renderer.js";
import { createRenderer, isEngineSupported } from "../renderers/renderers.js";
import { TestLogger } from "./test-logger.js";

let logger = null;
let testCanvas = null;
let testCtx = null;

window.addEventListener("DOMContentLoaded", async () => {
  testCanvas = document.getElementById("testCanvas");
  testCtx = testCanvas.getContext("2d");
  logger = new TestLogger(document.getElementById("testOutput"));

  await testAll();
});

async function testAll() {
  logger.info("Testing on " + navigator.userAgent + "\n");
  await testRenderer(RenderingEngine.CPU);
  await testRenderer(RenderingEngine.WEBGPU, false);
  await testRenderer(RenderingEngine.WEBGPU, true);
  await testRenderer(RenderingEngine.WEBGL1, false);
  await testRenderer(RenderingEngine.WEBGL1, true);
  await testRenderer(RenderingEngine.WEBGL2, false);
  await testRenderer(RenderingEngine.WEBGL2, true);
  testBigComplex();
}

async function testRenderer(renderingEngine, deep) {
  const engine = renderingEngine + (deep ? ".deep" : "");
  if (!(await isEngineSupported(renderingEngine))) {
    logger.error(engine.padEnd(20) + ": unsupported");
    return;
  }
  try {
    const map = new MapControl();
    const renderer = await createRenderer(
      testCanvas,
      testCtx,
      map,
      renderingEngine
    );
    const options = new RenderOptions({
      pixelDensity: 1,
      deep: deep,
      maxIter: 500,
      palette: Palette.ELECTRIC,
      fn: DEFAULT_FN,
    });
    map.moveTo(-0.5, 0, 0);
    renderer.render(map, options);
    logger.success(engine.padEnd(20) + ": success");
  } catch (e) {
    logger.error(engine.padEnd(20) + ": failed");
    console.error(e);
  }
}

function testBigComplex() {
  const plane = new BigComplexPlane(8);
  assertEqual(0, plane.asNumber(plane.asBigInt(0)));
  assertEqual(1, plane.asNumber(plane.asBigInt(1)));
  assertEqual(2, plane.asNumber(plane.asBigInt(2)));
  assertEqual(3, plane.asNumber(plane.asBigInt(3)));
  assertEqual(-3, plane.asNumber(plane.asBigInt(-3)));
  assertEqual(30.75, plane.asNumber(plane.asBigInt(30.75)));
  logger.success("testBigComplex".padEnd(20) + ": success");
}

function assertEqual(expected, actual) {
  console.assert(expected == actual, expected + " != " + actual);
}
