// webgpu availability
let webgpu_available;

// Global state for the viewport
export let state = {
    x: -0.5,     // real part (center)
    y: 0,        // imaginary part (center)
    zoom: 1,     // zoom factor
};

// Canvas references
export const canvas = document.getElementById('fractalCanvas');
export const ctx = canvas.getContext('2d');

export function set_webgpu(new_webgpu_available) {
    webgpu_available = new_webgpu_available;
}

export function has_webgpu() {
    return webgpu_available;
}