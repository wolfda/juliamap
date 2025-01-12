export const RenderingEngine = {
    WEBGPU: 'webgpu',
    WEBGL: 'webgl',
    CPU: 'cpu',
};

// webgpu availability
let webgpu_available;
let renderingEngine = null;

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

