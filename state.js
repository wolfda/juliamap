import { getMapState } from "./map.js";

export const RenderingEngine = {
    WEBGPU: "webgpu",
    WEBGPU_DEEP: "webgpu-deep",
    WEBGL: "webgl",
    CPU: "cpu",
};

export const Palette = {
    ELECTRIC: "electric",
    RAINBOW: "rainbow",
    ZEBRA: "zebra",
};

const MAX_WEBGL_ZOOM = 18;

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
    } else if (webglAvailable && zoom < MAX_WEBGL_ZOOM) {
        return RenderingEngine.WEBGL;
    } else {
        return RenderingEngine.CPU;
    }
}
