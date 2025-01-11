export const RenderingEngine = {
    WEBGPU: 'webgpu',
    WEBGL: 'webgl',
    CPU: 'cpu',
};

// webgpu availability
let webgpu_available;
let renderingEngine = null;

// Global state for the viewport
export let state = {
    x: -0.5,     // real part (center)
    y: 0,        // imaginary part (center)
    scale: 1,    // scale factor
};

// Canvas references
export const canvas = document.getElementById('fractalCanvas');
export const ctx = canvas.getContext('2d');

export function setWebgpu(new_webgpu_available) {
    webgpu_available = new_webgpu_available;
}

export function hasWebgpu() {
    return webgpu_available;
}

export function useRenderingEngine(engine) {
    renderingEngine = engine;
}

export function getRenderingEngine() {
    return renderingEngine;
}

