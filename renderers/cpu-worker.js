import { julia, FN_JULIA, FN_MANDELBROT } from "../julia.js"
import { Complex } from "../complex.js";
import { BLACK, ELECTRIC_PALETTE_ID, electricColor, RAINBOW_PALETTE_ID, rainbowColor, WIKIPEDIA_PALETTE_ID, wikipediaColor, ZEBRA_PALETTE_ID, zebraColor } from "../palette.js";

onmessage = function (e) {
  try {
    const {
      width,
      height,
      centerX,
      centerY,
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

    for (let py = startY; py < endY; py++) {
      for (let px = 0; px < width; px++) {
        // Map (px, py) -> complex plane
        const scaleFactor = 4.0 / width * Math.pow(2, -zoom);
        const x0 = centerX + (px - width / 2) * scaleFactor;
        const y0 = centerY - (py - height / 2) * scaleFactor;

        let escapeVelocity;
        switch (functionId) {
          case FN_JULIA:
            escapeVelocity = julia(new Complex(x0, y0), param0, maxIter);
            break;
          case FN_MANDELBROT:
          default:
            escapeVelocity = julia(new Complex(0, 0), new Complex(x0, y0), maxIter);
            break;
        }

        // iteration count used => escapeVelocity + 1
        totalIterations += escapeVelocity + 1;

        // Calculate index in this chunk's buffer
        // row offset: (py - startY)
        const rowOffset = py - startY;
        const idx = (rowOffset * width + px) * 4;
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
      totalIterations
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
      return electricColor(escapeVelocity / 200);
    }
    case RAINBOW_PALETTE_ID: {
      return rainbowColor(escapeVelocity / 200);
    }
    case ZEBRA_PALETTE_ID: {
      return zebraColor(escapeVelocity / 5);
    }
    case WIKIPEDIA_PALETTE_ID:
    default: {
      return wikipediaColor(escapeVelocity / 50);
    }
  }
}
