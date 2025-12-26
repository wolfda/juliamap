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

const MIN_VARIANCE_SAMPLES = 4;
const DEFAULT_MAX_SUPER_SAMPLES = 64;
const SUPER_SAMPLE_VARIANCE = 0.0005;

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
      paletteInterpolationId,
      maxSuperSamples,
      maxIter,
      functionId,
      param0,
      param0Exponent,
      deep,
      orbit,
    } = e.data;

    // We’ll track totalIterations to estimate FLOPS
    let totalIterations = 0;

    // Only allocate enough space for the rows we handle
    const rowsCount = endY - startY;
    const imageDataArray = new Uint8ClampedArray(width * rowsCount * 4);

    const maxSamples = Math.max(
      1,
      Math.floor(maxSuperSamples ?? DEFAULT_MAX_SUPER_SAMPLES)
    );

    const usePerturbation =
      deep === true && orbit && orbit.iters && orbit.count > 1;

    const scaleFactor = (4.0 / width) * Math.pow(2, -zoom);
    const orbitIters = usePerturbation
      ? orbit.iters instanceof Float32Array
        ? orbit.iters
        : new Float32Array(orbit.iters)
      : null;
    const orbitCount = usePerturbation ? orbit.count : 0;

    let plane = COMPLEX_PLANE;
    let centerp = null;
    let param0p = null;
    let z = null;
    let screenPos = null;
    let screenPosp = null;
    let halfResolution = null;
    let delta = null;
    let zero = null;

    if (!usePerturbation) {
      centerp = toComplex(center.x, center.y, centerExponent).const();
      plane = centerp.plane ?? COMPLEX_PLANE;
      param0p = plane
        .complex()
        .project(toComplex(param0.x, param0.y, param0Exponent))
        .const();
      z = plane.complex();
      screenPos = COMPLEX_PLANE.complex();
      screenPosp = plane.complex();
      halfResolution = plane.constComplex(width / 2, height / 2);
      delta = plane.complex();
      zero = plane.constComplex(0, 0);
    }

    function smoothEscapeVelocity(iter, squareMod) {
      return iter + 1 - Math.log(Math.log(squareMod)) / Math.LN2;
    }

    function juliaPerturb(dz0x, dz0y, dcx, dcy) {
      let dzx = dz0x;
      let dzy = dz0y;
      let zx = orbitIters[0];
      let zy = orbitIters[1];
      const limit = Math.min(maxIter, orbitCount - 1);

      for (let i = 0; i < limit; i++) {
        const twozx = 2 * zx + dzx;
        const twozy = 2 * zy + dzy;
        const nx = twozx * dzx - twozy * dzy + dcx;
        const ny = twozx * dzy + twozy * dzx + dcy;
        dzx = nx;
        dzy = ny;

        const zi = (i + 1) * 2;
        zx = orbitIters[zi];
        zy = orbitIters[zi + 1];

        const wx = zx + dzx;
        const wy = zy + dzy;
        const squareMod = wx * wx + wy * wy;
        if (squareMod > 128 * 128) {
          return smoothEscapeVelocity(i, squareMod);
        }
      }
      return maxIter;
    }

    function renderOne(px, py) {
      if (usePerturbation) {
        const dx = (px - orbit.sx) * scaleFactor;
        const dy = (py - orbit.sy) * -scaleFactor;
        let escapeVelocity;
        switch (functionId) {
          case FN_JULIA:
            escapeVelocity = juliaPerturb(dx, dy, 0, 0);
            break;
          case FN_MANDELBROT:
          default:
            escapeVelocity = juliaPerturb(0, 0, dx, dy);
            break;
        }
        totalIterations += Math.floor(escapeVelocity);
        return getColor(
          escapeVelocity,
          maxIter,
          paletteId,
          paletteInterpolationId
        );
      }

      screenPos.x = px;
      screenPos.y = py;
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

      return getColor(
        escapeVelocity,
        maxIter,
        paletteId,
        paletteInterpolationId
      );
    }

    function renderSuperSample(px, py, maxSamplesLocal) {
      let meanR = 0;
      let meanG = 0;
      let meanB = 0;
      let m2R = 0;
      let m2G = 0;
      let m2B = 0;
      let sampleCount = 0;

      const minVarianceSamples = Math.min(
        maxSamplesLocal,
        MIN_VARIANCE_SAMPLES
      );

      for (let i = 0; i < maxSamplesLocal; i++) {
        const jitterX = Math.random() - 0.5;
        const jitterY = Math.random() - 0.5;
        const sample = renderOne(px + jitterX, py + jitterY);
        const sr = sample.r / 255;
        const sg = sample.g / 255;
        const sb = sample.b / 255;
        sampleCount += 1;

        const deltaR = sr - meanR;
        const deltaG = sg - meanG;
        const deltaB = sb - meanB;
        meanR += deltaR / sampleCount;
        meanG += deltaG / sampleCount;
        meanB += deltaB / sampleCount;
        const delta2R = sr - meanR;
        const delta2G = sg - meanG;
        const delta2B = sb - meanB;
        m2R += deltaR * delta2R;
        m2G += deltaG * delta2G;
        m2B += deltaB * delta2B;

        if (sampleCount >= minVarianceSamples) {
          const denom = Math.max(sampleCount - 1, 1);
          const varianceR = m2R / denom;
          const varianceG = m2G / denom;
          const varianceB = m2B / denom;
          const maxVariance = Math.max(varianceR, varianceG, varianceB);
          if (maxVariance <= SUPER_SAMPLE_VARIANCE) {
            break;
          }
        }
      }

      return {
        r: Math.min(255, Math.max(0, Math.round(meanR * 255))),
        g: Math.min(255, Math.max(0, Math.round(meanG * 255))),
        b: Math.min(255, Math.max(0, Math.round(meanB * 255))),
      };
    }

    for (let py = startY; py < endY; py++) {
      for (let px = 0; px < width; px++) {
        const rowOffset = py - startY;
        const idx = (rowOffset * width + px) * 4;
        const color =
          maxSamples === 1
            ? renderOne(px, py)
            : renderSuperSample(px, py, maxSamples);
        imageDataArray[idx + 0] = color.r;
        imageDataArray[idx + 1] = color.g;
        imageDataArray[idx + 2] = color.b;
        imageDataArray[idx + 3] = 255;
      }
    }

    // Return partial image plus iteration/time info
    postMessage(
      {
        startY,
        endY,
        imageDataArray,
        totalIterations,
      },
      [imageDataArray.buffer]
    );
  } catch (err) {
    console.error("Error", err);
    postMessage({ error: err.message, stack: err.stack });
  }
};

function getColor(escapeVelocity, maxIter, paletteId, paletteInterpolationId) {
  if (escapeVelocity == maxIter) {
    return BLACK;
  }
  switch (paletteId) {
    case ELECTRIC_PALETTE_ID: {
      return electricColor(escapeVelocity / 100, paletteInterpolationId);
    }
    case RAINBOW_PALETTE_ID: {
      return rainbowColor(escapeVelocity / 150, paletteInterpolationId);
    }
    case ZEBRA_PALETTE_ID: {
      return zebraColor(escapeVelocity / 5);
    }
    case WIKIPEDIA_PALETTE_ID:
    default: {
      return wikipediaColor(escapeVelocity / 150, paletteInterpolationId);
    }
  }
}

function toComplex(x, y, exponent) {
  const plane = exponent ? new BigComplexPlane(exponent) : COMPLEX_PLANE;
  return plane.complex(x, y);
}
