const BITS_PER_DECIMAL = Math.log10(2);
const DEFAULT_CENTER = [-0.5, 0];

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

export class AppState {
    static parseFromAddressBar() {
        const params = new URLSearchParams(window.location.search);
        const x = params.has("x") ? parseFloat(params.get("x")) ?? DEFAULT_CENTER[0] : DEFAULT_CENTER[0];
        const y = params.has("y") ? parseFloat(params.get("y")) ?? DEFAULT_CENTER[1] : DEFAULT_CENTER[1];
        const zoom = params.has("z") ? parseFloat(params.get("z")) ?? 0 : 0;
        let renderingEngine = params.get("renderer");
        let deep = null;
        if (renderingEngine) {
            const split = renderingEngine.split(".");
            deep = false;
            if (split.length > 1) {
                renderingEngine = split[0];
                deep = split[1] === "deep";
            }
        }
        const palette = params.get("palette");
        const maxIter = params.has("iter") ? parseInt(params.get("iter")) ?? null : null;
        return new AppState({ x, y, zoom, renderingEngine, palette, maxIter, deep });
    }

    constructor({ x, y, zoom, renderingEngine, palette, maxIter, deep }) {
        this.x = x;
        this.y = y;
        this.zoom = zoom;
        this.renderingEngine = renderingEngine;
        this.palette = palette;
        this.maxIter = maxIter;
        this.deep = deep;
    }

    /**
     * Update the URL with current state
     */
    updateAddressBar() {
        const params = new URLSearchParams(window.location.search);

        // Truncate x and y to the most relevant decimals. 3 decimals required at zoom level 0.
        // Each additional zoom level requires 2 more bits of precision. 1 bit = ~0.30103 decimals.
        const precision = 3 + Math.ceil(this.zoom * BITS_PER_DECIMAL);
        params.set("x", this.x.toFixed(precision));
        params.set("y", this.y.toFixed(precision));
        params.set("z", this.zoom.toFixed(2));
        if (this.renderingEngine) {
            params.set("renderer", this.renderingEngine + (this.deep ? ".deep" : ""));
        }
        if (this.maxIter !== null) {
            params.set("iter", this.maxIter);
        }
        if (this.palette !== null) {
            params.set("palette", this.palette);
        }

        const newUrl = `${window.location.pathname}?${params.toString()}`;
        window.history.replaceState({}, "", newUrl);
    }
}
