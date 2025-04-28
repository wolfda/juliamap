import { RenderOptions } from "./renderers/renderer.js";
import { AppState } from "./state.js";
import { getDefaultRenderingEngine } from "./renderers/renderers.js";
import { JuliaExplorer, Layout } from "./julia-explorer.js";
import { Complex } from "./complex.js";

const MAX_UPDATE_STATS_FREQ = 10;

let appState = null;
let juliaExplorer = null;
let updateURLTimeoutId = null;
let updateStatsTimeoutId = null;
let lastStatsUpdate = null;

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
    onRendered: updateStats,
  });
  juliaExplorer.mandelExplorer.map.moveTo(appState.mcenter, appState.mzoom);
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
    const screenCenter = new Complex(
      fractalExplorer.canvas.width / 2,
      fractalExplorer.canvas.height / 2
    );
    const duration = originalZoom * 1000 * 0.5;
    fractalExplorer.animateZoom(screenCenter, 0, originalZoom, duration);
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

function updateStats(renderContext) {
  if (updateStatsTimeoutId) {
    clearTimeout(updateStatsTimeoutId);
  }
  // Render stats one last time after all renderings are done
  updateStatsTimeoutId = setTimeout(doUpdateStats, 1000, renderContext);

  // Debounce to not refresh stats faster than MAX_UPDATE_STATS_FREQ
  const now = performance.now();
  if (
    lastStatsUpdate == null ||
    now - lastStatsUpdate > 1000 / MAX_UPDATE_STATS_FREQ
  ) {
    lastStatsUpdate = now;
    doUpdateStats(renderContext);
  }
}

function doUpdateStats(renderContext) {
  let lines = [];
  lines.push(
    renderContext.id + (renderContext.options.deep === true ? ".deep" : "")
  );

  if (renderContext.flops) {
    lines.push(floatToHumanReadable(renderContext.flops) + " flops");
  }

  if (juliaExplorer) {
    lines.push(juliaExplorer.fps() + " fps");
  }

  document.getElementById("flopStats").innerHTML = lines.join("<br/>");
}

function floatToHumanReadable(x) {
  if (x > 1e9) {
    return Math.floor(x * 1e-9) + "G";
  } else if (x > 1e6) {
    return Math.floor(x * 1e-6) + "M";
  } else if (x > 1e3) {
    return Math.floor(x * 1e-3) + "k";
  } else {
    return x;
  }
}
