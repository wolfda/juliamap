import { julia, FN_JULIA, FN_MANDELBROT, juliaBigComplex } from "../julia.js";
import { BigComplexPlane, Complex } from "../complex.js";
import {
  BLACK,
  ELECTRIC_PALETTE_ID,
  electricColor,
  RAINBOW_PALETTE_ID,
  rainbowColor,
  WIKIPEDIA_PALETTE_ID,
  wikipediaColor,
  ZEBRA_PALETTE_ID,
  zebraColor,
} from "../palette.js";

onmessage = function (e) {
  try {
    const {
      width,
      height,
      center,
      zoom,
      startY,
      endY,
      paletteId,
      maxIter,
      functionId,
      param0,
    } = e.data;

    // We’ll track totalIterations to estimate FLOPS
    let totalIterations = 0;

    // Only allocate enough space for the rows we handle
    const rowsCount = endY - startY;
    const imageDataArray = new Uint8ClampedArray(width * rowsCount * 4);

    // TODO: with BigComplex
    // const complexPlane = new BigComplexPlane(10 + 2 * Math.ceil(zoom));
    // const zb = complexPlane.complex(0, 0);
    // const zerob = complexPlane.complex(0, 0);

    const z = new Complex();
    const screenPos = new Complex();
    const halfResolution = new Complex(width / 2, height / 2);
    const delta = new Complex();
    const zero = new Complex(0, 0);
    const scaleFactor = (4.0 / width) * Math.pow(2, -zoom);
    for (screenPos.y = startY; screenPos.y < endY; screenPos.y++) {
      for (screenPos.x = 0; screenPos.x < width; screenPos.x++) {
        // Map screenPos -> complex plane; z = center + (screenPos - 0.5 * resolution) * scaleFactor
        delta
          .set(screenPos)
          .sub(halfResolution)
          .mulScalar(scaleFactor, -scaleFactor);
        z.set(center).add(delta);

        let escapeVelocity;
        switch (functionId) {
          case FN_JULIA:
            escapeVelocity = julia(z, param0, maxIter);
            break;
          case FN_MANDELBROT:
          default:
            escapeVelocity = julia(zero, z, maxIter);
            // TODO: with BigComplex
            // zerob.setScalar(0);
            // zb.setScalar(z.x, z.y);
            // escapeVelocity = juliaBigComplex(
            //   zerob,
            //   zb,
            //   maxIter,
            // );
            break;
        }

        // iteration count used => escapeVelocity + 1
        totalIterations += escapeVelocity + 1;

        // Calculate index in this chunk's buffer
        // row offset: (py - startY)
        const rowOffset = screenPos.y - startY;
        const idx = (rowOffset * width + screenPos.x) * 4;
        const color = getColor(escapeVelocity, maxIter, paletteId);
        imageDataArray[idx + 0] = color.r;
        imageDataArray[idx + 1] = color.g;
        imageDataArray[idx + 2] = color.b;
        imageDataArray[idx + 3] = 255;
      }
    }

    // Return partial image plus iteration/time info
    postMessage({
      startY,
      endY,
      imageDataArray,
      totalIterations,
    });
  } catch (err) {
    console.error("Error", err);
    postMessage({ error: err.message, stack: err.stack });
  }
};

function getColor(escapeVelocity, maxIter, paletteId) {
  if (escapeVelocity == maxIter) {
    return BLACK;
  }
  switch (paletteId) {
    case ELECTRIC_PALETTE_ID: {
      return electricColor(escapeVelocity / 100);
    }
    case RAINBOW_PALETTE_ID: {
      return rainbowColor(escapeVelocity / 150);
    }
    case ZEBRA_PALETTE_ID: {
      return zebraColor(escapeVelocity / 5);
    }
    case WIKIPEDIA_PALETTE_ID:
    default: {
      return wikipediaColor(escapeVelocity / 15 + 0.2);
    }
  }
}
