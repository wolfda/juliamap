import { getMapState } from "./map.js";

export const RenderingEngine = {
    WEBGPU: "webgpu",
    WEBGPU_DEEP: "webgpu-deep",
    WEBGL: "webgl",
    WEBGL_DEEP: "webgl-deep",
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
let webglAvailable;

// Canvas references
export const canvas = document.getElementById("fractalCanvas");
export const ctx = canvas.getContext("2d");

export function hasWebgpu(available) {
    webgpuAvailable = available;
}

export function hasWebgl(available) {
    webglAvailable = available;
}

export function getDefaultRenderingEngine() {
    const zoom = getMapState().zoom;
    if (webgpuAvailable) {
        return zoom < 16 ? RenderingEngine.WEBGPU : RenderingEngine.WEBGPU_DEEP;
    } else if (webglAvailable) {
        return zoom < 16 ? RenderingEngine.WEBGL : RenderingEngine.WEBGL_DEEP;
    } else {
        return RenderingEngine.CPU;
    }
}
