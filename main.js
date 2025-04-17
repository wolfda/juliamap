import {
  getDefaultRenderingEngine,
  RenderOptions,
} from "./renderers/renderer.js";
import { FractalExplorer } from "./fractal-explorer.js";
import { AppState } from "./state.js";

let appState = null;
let fractalExplorer = null;
let updateURLTimeoutId = null;

/**
 * On DOMContentLoaded, read URL state, resize canvas, attach events,
 * init GPU or WebGL, and do an initial render.
 */
window.addEventListener("DOMContentLoaded", async () => {
  const mandelbrotDiv = document.getElementById("mandelbrotDiv");
  appState = AppState.parseFromAddressBar();
  fractalExplorer = await FractalExplorer.create({
    divContainer: mandelbrotDiv,
    renderingEngine:
      appState.renderingEngine ?? (await getDefaultRenderingEngine()),
    options: new RenderOptions({
      palette: appState.palette,
      maxIter: appState.maxIter,
      deep: appState.deep,
    }),
    onMapChanged: updateURL,
    onRendered: updateRendingEngine,
  });
  fractalExplorer.map.moveTo(appState.x, appState.y, appState.zoom);
  fractalExplorer.resize(window.innerWidth, window.innerHeight);

  window.addEventListener("resize", () => {
    fractalExplorer.resize(window.innerWidth, window.innerHeight);
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "d") {
    // Store the current scale
    const originalZoom = fractalExplorer.map.zoom;

    // 1) Animate from current 0 to zoom
    fractalExplorer.animateZoom(0, originalZoom, 12000);
  }
});

function updateURL() {
  clearTimeout(updateURLTimeoutId);
  updateURLTimeoutId = setTimeout(() => {
    appState.x = fractalExplorer.map.x;
    appState.y = fractalExplorer.map.y;
    appState.zoom = fractalExplorer.map.zoom;
    appState.updateAddressBar();
  }, 200);
}

/**
 * Update the rendering engine overlay
 * @param renderContext {RenderContext}
 */
function updateRendingEngine(renderContext) {
  document.getElementById("flopStats").innerHTML =
    renderContext.id + (renderContext.options.deep === true ? ".deep" : "");
}
