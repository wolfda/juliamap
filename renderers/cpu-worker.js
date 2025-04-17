import { julia, FN_JULIA, FN_MANDELBROT } from "../julia.js"
import { Complex } from "../complex.js";

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

// --- Color functions

const ELECTRIC_PALETTE_ID = 0;
const RAINBOW_PALETTE_ID = 1;
const ZEBRA_PALETTE_ID = 2;
const WIKIPEDIA_PALETTE_ID = 3;

class Color {
  constructor(r, g, b) {
    this.r = r;
    this.g = g;
    this.b = b;
  }
}

const RED = new Color(255, 0, 0);
const YELLOW = new Color(255, 255, 0);
const GREEN = new Color(0, 255, 0);
const CYAN = new Color(0, 255, 255);
const BLUE = new Color(0, 0, 255);
const MAGENTA = new Color(255, 0, 255);
const BLACK = new Color(0, 0, 0);
const WHITE = new Color(255, 255, 255);

const ELECTRIC = [BLUE, WHITE];
const RAINBOW = [YELLOW, GREEN, CYAN, BLUE, MAGENTA, RED];
const ZEBRA = [WHITE, BLACK];

// Same color palette as used on the Wikipedia page: https://en.wikipedia.org/wiki/Mandelbrot_set
const WIKIPEDIA = [
  new Color(0, 7, 100),
  new Color(32, 107, 203),
  new Color(237, 255, 255),
  new Color(255, 170, 0),
  new Color(0, 2, 0),
];

function fmod(a, b) {
  return a - b * Math.floor(a / b);
}

function interpolatePalette(palette, index) {
  const len = palette.length;
  const c0 = palette[Math.floor(fmod(len * index - 1, len))];
  const c1 = palette[Math.floor(fmod(len * index, len))];
  const t = fmod(len * index, 1);
  const r = c0.r + t * (c1.r - c0.r);
  const g = c0.g + t * (c1.g - c0.g);
  const b = c0.b + t * (c1.b - c0.b);
  return new Color(r, g, b);
}

function getPaletteColor(palette, index) {
  return palette[Math.floor(fmod(index, 1) * palette.length)];
}

// --- Julia functions

function rainbowColor(escapeVelocity) {
  return interpolatePalette(RAINBOW, escapeVelocity / 200);
}

function electricColor(escapeVelocity) {
  return interpolatePalette(ELECTRIC, escapeVelocity / 200);
}

function zebraColor(escapeVelocity) {
  return getPaletteColor(ZEBRA, escapeVelocity / 5);
}

function wikipediaColor(escapeVelocity) {
  return interpolatePalette(WIKIPEDIA, escapeVelocity / 50);
}

function getColor(escapeVelocity, maxIter, paletteId) {
  if (escapeVelocity == maxIter) {
    return BLACK;
  }
  switch (paletteId) {
    case ELECTRIC_PALETTE_ID: {
      return electricColor(escapeVelocity);
    }
    case RAINBOW_PALETTE_ID: {
      return rainbowColor(escapeVelocity);
    }
    case ZEBRA_PALETTE_ID: {
      return zebraColor(escapeVelocity);
    }
    case WIKIPEDIA_PALETTE_ID:
    default: {
      return wikipediaColor(escapeVelocity);
    }
  }
}
