export const Palette = {
  ELECTRIC: "electric",
  RAINBOW: "rainbow",
  ZEBRA: "zebra",
  WIKIPEDIA: "wikipedia",
};

export const ELECTRIC_PALETTE_ID = 0;
export const RAINBOW_PALETTE_ID = 1;
export const ZEBRA_PALETTE_ID = 2;
export const WIKIPEDIA_PALETTE_ID = 3;

export function getPaletteId(palette) {
  switch (palette) {
    case Palette.ELECTRIC:
      return ELECTRIC_PALETTE_ID;
    case Palette.RAINBOW:
      return RAINBOW_PALETTE_ID;
    case Palette.ZEBRA:
      return ZEBRA_PALETTE_ID;
    case Palette.WIKIPEDIA:
    default:
      return WIKIPEDIA_PALETTE_ID;
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

export function rainbowColor(index) {
  return interpolatePalette(RAINBOW, index);
}

export function electricColor(index) {
  return interpolatePalette(ELECTRIC, index);
}

export function zebraColor(index) {
  return getPaletteColor(ZEBRA, index);
}

export function wikipediaColor(index) {
  return interpolatePalette(WIKIPEDIA, index);
}
