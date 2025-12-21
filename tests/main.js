import {
  BigComplexPlane,
  Complex,
  COMPLEX_PLANE,
  renderComplex,
  parseComplex,
} from "../math/complex.js";
import { DEFAULT_FN } from "../math/julia.js";
import { MapControl } from "../core/map.js";
import { Palette } from "../core/palette.js";
import { RenderingEngine, RenderOptions } from "../renderers/renderer.js";
import { createRenderer, isEngineSupported } from "../renderers/renderers.js";
import { TestLogger } from "./test-logger.js";

let logger = null;
let testCanvas = null;

window.addEventListener("DOMContentLoaded", async () => {
  testCanvas = document.getElementById("testCanvas");
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
  testScalars();
  testRenderComplex();
}

async function testRenderer(renderingEngine, deep) {
  const engine = renderingEngine + (deep ? ".deep" : "");
  if (!(await isEngineSupported(renderingEngine))) {
    logger.error(engine.padEnd(20) + ": unsupported");
    return;
  }
  try {
    const canvas = document.createElement("canvas");
    const baseWidth = testCanvas?.width || testCanvas?.clientWidth || 300;
    const baseHeight = testCanvas?.height || testCanvas?.clientHeight || 150;
    canvas.width = baseWidth;
    canvas.height = baseHeight;
    const ctx =
      renderingEngine === RenderingEngine.WEBGPU
        ? null
        : canvas.getContext("2d");
    const map = new MapControl();
    const renderer = await createRenderer(
      canvas,
      ctx,
      map,
      renderingEngine
    );
    const options = new RenderOptions({
      maxSuperSamples: 4,
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

  assertEquals(plane.complex(4, 8).divScalar(2, 2), plane.complex(2, 4));
  assertEquals(plane.complex(4, 8).mulScalar(2, 2), plane.complex(8, 16));
  logger.success("testBigComplex".padEnd(20) + ": success");
}

function testComplexProject() {
  const plane = COMPLEX_PLANE;
  const bigPlane5 = new BigComplexPlane(5);
  const bigPlane8 = new BigComplexPlane(8);

  // plane -> bigPlane5
  assertEquals(
    plane.complex().project(bigPlane5.complex(3, 4)),
    plane.complex(3, 4)
  );
  assertEquals(
    bigPlane5.complex().project(plane.complex(3, 4)),
    bigPlane5.complex(3, 4)
  );

  // plane -> bigPlane8
  assertEquals(
    plane.complex().project(bigPlane8.complex(3, 4)),
    plane.complex(3, 4)
  );
  assertEquals(
    bigPlane8.complex().project(plane.complex(3, 4)),
    bigPlane8.complex(3, 4)
  );

  // bigPlane5 -> bigPlane8
  assertEquals(
    bigPlane5.complex().project(bigPlane8.complex(3, 4)),
    bigPlane5.complex(3, 4)
  );
  assertEquals(
    bigPlane8.complex().project(bigPlane5.complex(3, 4)),
    bigPlane8.complex(3, 4)
  );

  // Same plane projection
  assertEquals(
    plane.complex().project(plane.complex(3, 4)),
    plane.complex(3, 4)
  );
  assertEquals(
    bigPlane5.complex().project(bigPlane5.complex(3, 4)),
    bigPlane5.complex(3, 4)
  );
  assertEquals(
    bigPlane8.complex().project(bigPlane8.complex(3, 4)),
    bigPlane8.complex(3, 4)
  );

  logger.success("testComplexProject".padEnd(20) + ": success");
}

function testScalars() {
  const plane = COMPLEX_PLANE;
  const bigPlane5 = new BigComplexPlane(5);

  const x = plane.scalar(3);
  const bigx5 = bigPlane5.scalar(3);

  assertEqual(bigPlane5.scalar(x), bigx5);
  assertEqual(plane.scalar(x), x);

  assertEqual(bigPlane5.log2(bigPlane5.scalar(-1024)), NaN);
  assertEqual(bigPlane5.log2(bigPlane5.scalar(-1)), NaN);
  assertEqual(bigPlane5.log2(bigPlane5.scalar(0)), NaN);
  assertEqual(bigPlane5.log2(bigPlane5.scalar(1)), 0);
  assertEqual(bigPlane5.log2(bigPlane5.scalar(2)), 1);
  assertEqual(bigPlane5.log2(bigPlane5.scalar(1024)), 10);
  assertEqual(bigPlane5.log2(bigPlane5.scalar(1000)), 9);

  logger.success("testScalars".padEnd(20) + ": success");
}

function testRenderComplex() {
  const plane = COMPLEX_PLANE;
  const bigPlane5 = new BigComplexPlane(5);

  assertEquals(plane.complex(2, 3), parseComplex(renderComplex(plane.complex(2, 3), 5)));
  assertEquals(bigPlane5.complex(2, 3), parseComplex(renderComplex(bigPlane5.complex(2, 3), 5)));

  logger.success("testRenderComplex".padEnd(20) + ": success");
}

function assertEqual(expected, actual) {
  console.assert(
    (Number.isNaN(expected) && Number.isNaN(actual)) || expected === actual,
    expected + " !== " + actual
  );
}

function assertEquals(expected, actual) {
  console.assert(expected.equals(actual), expected + " != " + actual);
}
