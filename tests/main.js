import { BigComplexPlane, Complex, ComplexPlane } from "../complex.js";
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
  testComplexProject();
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
    map.moveTo(new Complex(-0.5, 0), 0);
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

function testComplexProject() {
  const plane = new ComplexPlane();
  const bigPlane5 = new BigComplexPlane(5);
  const bigPlane8 = new BigComplexPlane(8);

  const a = plane.complex(3, 4);
  const biga5 = bigPlane5.complex(3, 4);
  const biga8 = bigPlane8.complex(3, 4);

  // plane -> bigPlane5
  assertEquals(bigPlane5.project(a), biga5);
  assertEquals(plane.project(biga5), a);

  // plane -> bigPlane8
  assertEquals(bigPlane8.project(a), biga8);
  assertEquals(plane.project(biga8), a);

  // bigPlane5 -> bigPlane8
  assertEquals(bigPlane8.project(biga5), biga8);
  assertEquals(bigPlane5.project(biga8), biga5);

  // Same plane projection
  assertEqual(plane.project(a), a);
  assertEqual(bigPlane5.project(biga5), biga5);
  assertEqual(bigPlane8.project(biga8), biga8);
  
  logger.success("testComplexProject".padEnd(20) + ": success");
}

function assertEqual(expected, actual) {
  console.assert(expected === actual, expected + " !== " + actual);
}

function assertEquals(expected, actual) {
  console.assert(expected.equals(actual), expected + " != " + actual);
}
