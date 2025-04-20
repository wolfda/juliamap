let webgpu = undefined;
const webgl1 = checkWebgl1();
const webgl2 = checkWebgl2();

export async function hasWebgpu() {
  if (webgpu === undefined) {
    webgpu = await checkWebgpu();
  }
  return webgpu;
}

export function hasWebgl1() {
  return webgl1;
}

export function hasWebgl2() {
  return webgl2;
}

export function getCpuCount() {
  return navigator.hardwareConcurrency || 4;
}

async function checkWebgpu() {
  if (!("gpu" in navigator)) {
    return false;
  }

  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) {
    return false;
  }

  const gpuDevice = await adapter.requestDevice();
  if (!gpuDevice) {
    return false;
  }

  const canvas = document.createElement("canvas");
  return canvas.getContext("webgpu") !== null;
}

function checkWebgl1() {
  const canvas = document.createElement("canvas");
  const glContext = canvas.getContext("webgl");
  if (!glContext) {
    return false;
  }

  // This is required to store high precision orbits for the `deep` implementation.
  return glContext.getExtension("OES_texture_float") !== null;
}

function checkWebgl2() {
  const canvas = document.createElement("canvas");
  return canvas.getContext("webgl2") !== null;
}
