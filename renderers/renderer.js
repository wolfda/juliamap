import { DEFAULT_FN } from "../julia.js";
import { Palette } from "../state.js";
import { hasWebgl1, hasWebgl2, hasWebgpu } from "./capabilities.js";

export const RenderingEngine = {
    WEBGPU: "webgpu",
    WEBGL1: "webgl1",
    WEBGL2: "webgl2",
    CPU: "cpu",
};

export class Renderer {
    render(options) {
        throw new Error("Not implemented");
    }

    id() {
        throw new Error("Not implemented");
    }

    detach() {
        throw new Error("Not implemented");
    }
}

export class RenderOptions {
    constructor({ pixelDensity, deep, maxIter, palette, fn } = {}) {
        this.pixelDensity = pixelDensity ?? 1;
        this.deep = deep ?? false;
        this.maxIter = maxIter ?? 500;
        this.palette = palette ?? Palette.ELECTRIC
        this.fn = fn ?? DEFAULT_FN
    }
}

export async function getDefaultRenderingEngine() {
    if (await hasWebgpu()) {
        return RenderingEngine.WEBGPU;
    } else if (hasWebgl2()) {
        return RenderingEngine.WEBGL2;
    } else if (hasWebgl1()) {
        return RenderingEngine.WEBGL1;
    } else {
        return RenderingEngine.CPU;
    }
}
