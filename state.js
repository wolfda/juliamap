import { getMapState } from "./map.js";

export const RenderingEngine = {
    WEBGPU: "webgpu",
    WEBGPU_DEEP: "webgpu-deep",
    WEBGL1: "webgl1",
    WEBGL1_DEEP: "webgl1-deep",
    WEBGL2: "webgl2",
    WEBGL2_DEEP: "webgl2-deep",
    CPU: "cpu",
};

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

// Capabilities
let webgpuAvailable;
let webgl1Available;
let webgl2Available;

// Canvas references
export const canvas = document.getElementById("fractalCanvas");
export const ctx = canvas.getContext("2d");

export function hasWebgpu(available) {
    webgpuAvailable = available;
}

export function hasWebgl1(available) {
    webgl1Available = available;
}

export function hasWebgl2(available) {
    webgl2Available = available;
}

export function getDefaultRenderingEngine() {
    const zoom = getMapState().zoom;
    if (webgpuAvailable) {
        return zoom < 16 ? RenderingEngine.WEBGPU : RenderingEngine.WEBGPU_DEEP;
    } else if (webgl2Available) {
        return zoom < 16 ? RenderingEngine.WEBGL2 : RenderingEngine.WEBGL2_DEEP;
    } else if (webgl1Available) {
        return zoom < 16 ? RenderingEngine.WEBGL1 : RenderingEngine.WEBGL1_DEEP;
    } else {
        return RenderingEngine.CPU;
    }
}
