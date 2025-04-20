import { RenderOptions } from "./renderers/renderer.js";
import { AppState } from "./state.js";
import { getDefaultRenderingEngine } from "./renderers/renderers.js";
import { JuliaExplorer, Layout } from "./julia-explorer.js";

let appState = null;
let juliaExplorer = null;
let updateURLTimeoutId = null;

/**
 * On DOMContentLoaded, read URL state, resize canvas, attach events,
 * init GPU or WebGL, and do an initial render.
 */
window.addEventListener("DOMContentLoaded", async () => {
  appState = AppState.parseFromAddressBar();
  juliaExplorer = await JuliaExplorer.create({
    renderingEngine:
      appState.renderingEngine ?? (await getDefaultRenderingEngine()),
    options: new RenderOptions({
      palette: appState.palette,
      maxIter: appState.maxIter,
      deep: appState.deep,
    }),
    onChanged: updateURL,
    onRendered: updateRendingEngine,
  });
  juliaExplorer.mandelExplorer.map.moveTo(
    appState.mcenter,
    appState.mzoom
  );
  juliaExplorer.juliaExplorer.map.moveTo(appState.jcenter, appState.jzoom);
  juliaExplorer.setLayout(appState.layout ?? Layout.MANDEL);
  juliaExplorer.updateJuliaFn();
  juliaExplorer.resize(window.innerWidth, window.innerHeight);
  window.addEventListener("resize", () => {
    juliaExplorer.resize(window.innerWidth, window.innerHeight);
  });
});

document.addEventListener("keydown", (e) => {
  if (e.key === "d") {
    let fractalExplorer;
    switch (juliaExplorer.layout) {
      case Layout.MANDEL:
        fractalExplorer = juliaExplorer.mandelExplorer;
        break;

      case Layout.JULIA:
        fractalExplorer = juliaExplorer.juliaExplorer;
        break;

      case Layout.SPLIT:
        return;
    }
    const originalZoom = fractalExplorer.map.zoom;
    fractalExplorer.animateZoom(0, originalZoom, 12000);
  } else if (e.key === "s") {
    juliaExplorer.setLayout(
      juliaExplorer.layout !== Layout.SPLIT ? Layout.SPLIT : Layout.MANDEL
    );
  }
});

function updateURL() {
  clearTimeout(updateURLTimeoutId);
  updateURLTimeoutId = setTimeout(() => {
    appState.mcenter = juliaExplorer.mandelExplorer.map.center;
    appState.mzoom = juliaExplorer.mandelExplorer.map.zoom;
    appState.jcenter = juliaExplorer.juliaExplorer.map.center;
    appState.jzoom = juliaExplorer.juliaExplorer.map.zoom;
    appState.layout = juliaExplorer.layout;
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
