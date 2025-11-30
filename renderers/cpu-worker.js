import { julia, FN_JULIA, FN_MANDELBROT } from "../math/julia.js";
import { BigComplexPlane, COMPLEX_PLANE } from "../math/complex.js";
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
} from "../core/palette.js";

onmessage = function (e) {
  try {
    const {
      width,
      height,
      center,
      centerExponent,
      zoom,
      startY,
      endY,
      paletteId,
      maxIter,
      functionId,
      param0,
      param0Exponent,
    } = e.data;

    // We’ll track totalIterations to estimate FLOPS
    let totalIterations = 0;

    // Only allocate enough space for the rows we handle
    const rowsCount = endY - startY;
    const imageDataArray = new Uint8ClampedArray(width * rowsCount * 4);

    const centerp = toComplex(center.x, center.y, centerExponent).const();
    const plane = centerp.plane ?? COMPLEX_PLANE;
    const param0p = plane.complex().project(toComplex(param0.x, param0.y, param0Exponent)).const();
    const z = plane.complex();
    const screenPos = COMPLEX_PLANE.complex();
    const screenPosp = plane.complex();
    const halfResolution = plane.constComplex(width / 2, height / 2);
    const delta = plane.complex();
    const zero = plane.constComplex(0, 0);
    const scaleFactor = (4.0 / width) * Math.pow(2, -zoom);
    for (screenPos.y = startY; screenPos.y < endY; screenPos.y++) {
      for (screenPos.x = 0; screenPos.x < width; screenPos.x++) {
        // Map screenPos -> complex plane; z = center + (screenPos - 0.5 * resolution) * scaleFactor
        delta
          .set(screenPosp.project(screenPos))
          .sub(halfResolution)
          .mulScalar(scaleFactor, -scaleFactor);
        z.set(centerp).add(delta);

        let escapeVelocity;
        switch (functionId) {
          case FN_JULIA:
            escapeVelocity = julia(z, param0p, maxIter);
            break;
          case FN_MANDELBROT:
          default:
            escapeVelocity = julia(zero, z, maxIter);
            break;
        }

        totalIterations += Math.floor(escapeVelocity);

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

function toComplex(x, y, exponent) {
  const plane = exponent ? new BigComplexPlane(exponent) : COMPLEX_PLANE;  
  return plane.complex(x, y);
}
