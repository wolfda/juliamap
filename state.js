import { getMapState } from "./map.js";

export const Palette = {
    ELECTRIC: "electric",
    RAINBOW: "rainbow",
    ZEBRA: "zebra",
    WIKIPEDIA: "wikipedia",
};

export function getPaletteId(palette) {
    switch (palette) {
        case Palette.ELECTRIC:
            return 0;
        case Palette.RAINBOW:
            return 1;
        case Palette.ZEBRA:
            return 2;
        case Palette.WIKIPEDIA:
            return 3;
        default:
            return 3;
    }
}

// Canvas references
export const canvas = document.getElementById("fractalCanvas");
export const ctx = canvas.getContext("2d");
