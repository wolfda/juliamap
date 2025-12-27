export const Palette = {
  ELECTRIC: "electric",
  RAINBOW: "rainbow",
  ZEBRA: "zebra",
  WIKIPEDIA: "wikipedia",
  BLANK: "blank",
};

export const PaletteInterpolation = {
  LINEAR: "LINEAR",
  SPLINE: "SPLINE",
};

export const ELECTRIC_PALETTE_ID = 0;
export const RAINBOW_PALETTE_ID = 1;
export const ZEBRA_PALETTE_ID = 2;
export const WIKIPEDIA_PALETTE_ID = 3;
export const BLANK_PALETTE_ID = 4;

export const LINEAR_PALETTE_INTERPOLATION_ID = 0;
export const SPLINE_PALETTE_INTERPOLATION_ID = 1;

export function getPaletteId(palette) {
  switch (palette) {
    case Palette.ELECTRIC:
      return ELECTRIC_PALETTE_ID;
    case Palette.RAINBOW:
      return RAINBOW_PALETTE_ID;
    case Palette.ZEBRA:
      return ZEBRA_PALETTE_ID;
    case Palette.WIKIPEDIA:
      return WIKIPEDIA_PALETTE_ID;
    case Palette.BLANK:
      return BLANK_PALETTE_ID;
    default:
      return WIKIPEDIA_PALETTE_ID;
  }
}

export function getPaletteInterpolationId(paletteInterpolation) {
  switch (paletteInterpolation) {
    case PaletteInterpolation.LINEAR:
      return LINEAR_PALETTE_INTERPOLATION_ID;
    case PaletteInterpolation.SPLINE:
    default:
      return SPLINE_PALETTE_INTERPOLATION_ID;
  }
}

class Color {
  constructor(r, g, b) {
    this.r = r;
    this.g = g;
    this.b = b;
  }
}

export const RED = new Color(255, 0, 0);
export const YELLOW = new Color(255, 255, 0);
export const GREEN = new Color(0, 255, 0);
export const CYAN = new Color(0, 255, 255);
export const BLUE = new Color(0, 0, 255);
export const MAGENTA = new Color(255, 0, 255);
export const BLACK = new Color(0, 0, 0);
export const WHITE = new Color(255, 255, 255);
export const GRAY = new Color(210, 210, 210);

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
const WIKIPEDIA_POSITIONS = [0.0, 0.16, 0.42, 0.6425, 0.8575];

function fmod(a, b) {
  return a - b * Math.floor(a / b);
}

function interpolatePaletteLinear(palette, index) {
  const len = palette.length;
  const wrapped = fmod(index, 1);
  const scaled = wrapped * len;
  const i = Math.min(Math.floor(scaled), len - 1);
  const localT = scaled - i;
  const c0 = palette[i];
  const c1 = palette[(i + 1) % len];
  const r = c0.r + localT * (c1.r - c0.r);
  const g = c0.g + localT * (c1.g - c0.g);
  const b = c0.b + localT * (c1.b - c0.b);
  return new Color(r, g, b);
}

function interpolatePaletteSpline(palette, index) {
  const len = palette.length;
  const wrapped = fmod(index, 1);
  const scaled = wrapped * len;
  const i = Math.min(Math.floor(scaled), len - 1);
  const localT = scaled - i;

  const i0 = i;
  const i1 = (i + 1) % len;
  const im1 = (i + len - 1) % len;
  const i2 = (i + 2) % len;

  const p0 = palette[i0];
  const p1 = palette[i1];
  const pm1 = palette[im1];
  const p2 = palette[i2];

  const m0r = 0.5 * (p1.r - pm1.r);
  const m0g = 0.5 * (p1.g - pm1.g);
  const m0b = 0.5 * (p1.b - pm1.b);

  const m1r = 0.5 * (p2.r - p0.r);
  const m1g = 0.5 * (p2.g - p0.g);
  const m1b = 0.5 * (p2.b - p0.b);

  const t2 = localT * localT;
  const t3 = t2 * localT;
  const a = 2 * t3 - 3 * t2 + 1;
  const b = t3 - 2 * t2 + localT;
  const c = -2 * t3 + 3 * t2;
  const d = t3 - t2;

  const r = a * p0.r + b * m0r + c * p1.r + d * m1r;
  const g = a * p0.g + b * m0g + c * p1.g + d * m1g;
  const bch = a * p0.b + b * m0b + c * p1.b + d * m1b;
  return new Color(r, g, bch);
}

function interpolatePalette(palette, index, paletteInterpolationId) {
  if (paletteInterpolationId === LINEAR_PALETTE_INTERPOLATION_ID) {
    return interpolatePaletteLinear(palette, index);
  }
  return interpolatePaletteSpline(palette, index);
}

function interpolatePaletteLinearPos(palette, positions, index) {
  const lastIndex = palette.length - 1;
  const t = fmod(index, 1);
  const firstPos = positions[0];
  const lastPos = positions[lastIndex];
  if (t <= firstPos) {
    return palette[0];
  }
  if (t >= lastPos) {
    const span = 1.0 - lastPos + firstPos;
    const wrapT = (t - lastPos) / span;
    const u = (lastIndex + wrapT) / palette.length;
    return interpolatePaletteLinear(palette, u);
  }
  for (let i = 0; i < lastIndex; i++) {
    const t0 = positions[i];
    const t1 = positions[i + 1];
    if (t >= t0 && t <= t1) {
      const localT = (t - t0) / (t1 - t0);
      const u = (i + localT) / palette.length;
      return interpolatePaletteLinear(palette, u);
    }
  }
  return palette[lastIndex];
}

function interpolatePaletteSplinePos(palette, positions, index) {
  const lastIndex = palette.length - 1;
  const t = fmod(index, 1);
  const firstPos = positions[0];
  const lastPos = positions[lastIndex];
  if (t <= firstPos) {
    return palette[0];
  }
  if (t >= lastPos) {
    const span = 1.0 - lastPos + firstPos;
    const wrapT = (t - lastPos) / span;
    const u = (lastIndex + wrapT) / palette.length;
    return interpolatePaletteSpline(palette, u);
  }
  for (let i = 0; i < lastIndex; i++) {
    const t0 = positions[i];
    const t1 = positions[i + 1];
    if (t >= t0 && t <= t1) {
      const localT = (t - t0) / (t1 - t0);
      const u = (i + localT) / palette.length;
      return interpolatePaletteSpline(palette, u);
    }
  }
  return palette[lastIndex];
}

function interpolatePalettePos(palette, positions, index, paletteInterpolationId) {
  if (paletteInterpolationId === LINEAR_PALETTE_INTERPOLATION_ID) {
    return interpolatePaletteLinearPos(palette, positions, index);
  }
  return interpolatePaletteSplinePos(palette, positions, index);
}

function getPaletteColor(palette, index) {
  return palette[Math.floor(fmod(index, 1) * palette.length)];
}

export function rainbowColor(index, paletteInterpolationId) {
  return interpolatePalette(RAINBOW, index, paletteInterpolationId);
}

export function electricColor(index, paletteInterpolationId) {
  return interpolatePalette(ELECTRIC, index, paletteInterpolationId);
}

export function zebraColor(index) {
  return getPaletteColor(ZEBRA, index);
}

export function wikipediaColor(index, paletteInterpolationId) {
  return interpolatePalettePos(
    WIKIPEDIA,
    WIKIPEDIA_POSITIONS,
    index,
    paletteInterpolationId
  );
}
