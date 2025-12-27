import { appState, StateAttributes } from "../core/state.js";
import {
  getDefaultRenderingEngine,
  getSupportedRenderers,
} from "../renderers/renderers.js";
import { JuliaExplorer } from "../ui/julia-explorer.js";
import { Palette } from "../core/palette.js";
import { Layout } from "../core/state.js";
import { AppStateEditor } from "../ui/state-editor.js";
const MAX_UPDATE_STATS_FREQ = 10;

let juliaExplorer = null;
let controlPanel = null;
let updateStatsTimeoutId = null;
let lastStatsUpdate = null;

/**
 * On DOMContentLoaded, read URL state, resize canvas, attach events,
 * init GPU or WebGL, and do an initial render.
 */
window.addEventListener("DOMContentLoaded", async () => {
  juliaExplorer = await JuliaExplorer.create({
    renderingEngine:
      appState.renderingEngine ?? (await getDefaultRenderingEngine()),
    options: {
      palette: appState.palette,
      paletteInterpolation: appState.paletteInterpolation,
      maxIter: appState.maxIter,
      deepMode: appState.deepMode,
      maxSuperSamples: appState.maxSuperSamples,
      normalMap: appState.normalMap,
    },
    layout: appState.layout ?? Layout.MANDEL,
    onChanged: onViewportChanged,
    onRendered: updateStats,
  });
  juliaExplorer.mandelExplorer.map.moveTo(appState.mcenter, appState.mzoom);
  juliaExplorer.juliaExplorer.map.moveTo(appState.jcenter, appState.jzoom);
  juliaExplorer.setLayout(appState.layout ?? Layout.MANDEL);
  juliaExplorer.updateJuliaFn();
  juliaExplorer.resize(window.innerWidth, window.innerHeight);
  const supportedRenderers = await getSupportedRenderers();
  controlPanel = new AppStateEditor(supportedRenderers);
  appState.addEventListener("change", onAppStateChanged);
  window.addEventListener("resize", () => {
    juliaExplorer.resize(window.innerWidth, window.innerHeight);
  });
  document
    .getElementById("downloadIcon")
    .addEventListener("click", downloadViewport);
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
    const center = fractalExplorer.map.center;
    const duration = originalZoom * 1000 * 0.5;
    fractalExplorer.animateDive(center, 0, originalZoom, duration);
  }
});

function updateStats(renderContext) {
  clearTimeout(updateStatsTimeoutId);
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
  lines.push(renderContext.id);

  const zoom = getCurrentZoom();
  if (zoom != null) {
    lines.push("zoom ~" + zoomToOrderOfMagnitude(zoom));
  }

  if (renderContext.flops != null) {
    lines.push(floatToHumanReadable(renderContext.flops) + " flops");
  }

  document.getElementById("stats").innerHTML = lines.join("<br/>");
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

function getCurrentZoom() {
  if (!juliaExplorer) {
    return null;
  }
  switch (juliaExplorer.layout) {
    case Layout.MANDEL:
      return juliaExplorer.mandelExplorer.map.zoom;
    case Layout.JULIA:
      return juliaExplorer.juliaExplorer.map.zoom;
    case Layout.SPLIT:
      return Math.max(
        juliaExplorer.mandelExplorer.map.zoom,
        juliaExplorer.juliaExplorer.map.zoom
      );
    default:
      return null;
  }
}

function zoomToOrderOfMagnitude(zoom) {
  const log10_2 = Math.log10(2);
  const exp = Math.max(0, Math.round(zoom * log10_2));
  return "1e" + exp;
}

function onViewportChanged() {
  if (juliaExplorer) {
    appState.setViewport(
      juliaExplorer.mandelExplorer.map.center,
      juliaExplorer.mandelExplorer.map.zoom,
      juliaExplorer.juliaExplorer.map.center,
      juliaExplorer.juliaExplorer.map.zoom
    );
  }
}

async function onAppStateChanged(event) {
  switch (event.detail) {
    case StateAttributes.RENDERING_ENGINE:
      await updateRenderer();
      break;
    case StateAttributes.PALETTE:
      updatePalette();
      break;
    case StateAttributes.PALETTE_INTERPOLATION:
      updatePaletteInterpolation();
      break;
    case StateAttributes.DEEP_MODE:
      updateDeepMode();
      break;
    case StateAttributes.MAX_ITER:
      updateMaxIter();
      break;
    case StateAttributes.MAX_SUPER_SAMPLES:
      updateMaxSuperSamples();
      break;
    case StateAttributes.NORMAL_MAP:
      updateNormalMap();
      break;
    case StateAttributes.LAYOUT:
      juliaExplorer.setLayout(appState.layout);
      break;
  }
}

async function updateRenderer() {
  const renderer =
    appState.renderingEngine ?? (await getDefaultRenderingEngine());
  juliaExplorer.detach();
  juliaExplorer = await JuliaExplorer.create({
    renderingEngine: renderer,
    options: {
      palette: appState.palette,
      paletteInterpolation: appState.paletteInterpolation,
      maxIter: appState.maxIter,
      deepMode: appState.deepMode,
      maxSuperSamples: appState.maxSuperSamples,
      normalMap: appState.normalMap,
    },
    onChanged: onViewportChanged,
    onRendered: updateStats,
  });
  juliaExplorer.mandelExplorer.map.moveTo(appState.mcenter, appState.mzoom);
  juliaExplorer.juliaExplorer.map.moveTo(appState.jcenter, appState.jzoom);
  juliaExplorer.setLayout(appState.layout);
  juliaExplorer.updateJuliaFn();
}

function updatePalette() {
  const palette = appState.palette ?? Palette.WIKIPEDIA;
  juliaExplorer.mandelExplorer.options.palette = palette;
  juliaExplorer.juliaExplorer.options.palette = palette;
  juliaExplorer.mandelExplorer.render(true);
  juliaExplorer.juliaExplorer.render(true);
}

function updatePaletteInterpolation() {
  juliaExplorer.mandelExplorer.options.paletteInterpolation =
    appState.paletteInterpolation;
  juliaExplorer.juliaExplorer.options.paletteInterpolation =
    appState.paletteInterpolation;
  juliaExplorer.mandelExplorer.render(true);
  juliaExplorer.juliaExplorer.render(true);
}

function updateDeepMode() {
  juliaExplorer.mandelExplorer.options.deepMode = appState.deepMode;
  juliaExplorer.juliaExplorer.options.deepMode = appState.deepMode;
  juliaExplorer.mandelExplorer.render(true);
  juliaExplorer.juliaExplorer.render(true);
}

function updateMaxIter() {
  juliaExplorer.mandelExplorer.options.maxIter = appState.maxIter;
  juliaExplorer.juliaExplorer.options.maxIter = appState.maxIter;
  juliaExplorer.mandelExplorer.render(true);
  juliaExplorer.juliaExplorer.render(true);
}

function updateMaxSuperSamples() {
  if (juliaExplorer.layout === Layout.JULIA) {
    juliaExplorer.juliaExplorer.options.maxSuperSamples =
      appState.maxSuperSamples;
    juliaExplorer.juliaExplorer.render(true);
  } else {
    juliaExplorer.mandelExplorer.options.maxSuperSamples =
      appState.maxSuperSamples;
    juliaExplorer.mandelExplorer.render(true);
  }
}

function updateNormalMap() {
  juliaExplorer.mandelExplorer.options.normalMap = appState.normalMap;
  juliaExplorer.juliaExplorer.options.normalMap = appState.normalMap;
  juliaExplorer.mandelExplorer.render(true);
  juliaExplorer.juliaExplorer.render(true);
}

function downloadViewport() {
  const dpr = window.devicePixelRatio ?? 1;
  let canvas = null;
  if (juliaExplorer.layout === Layout.SPLIT) {
    const verticalSplit = window.innerWidth > window.innerHeight;
    canvas = document.createElement("canvas");
    canvas.width = window.innerWidth * dpr;
    canvas.height = window.innerHeight * dpr;
    const ctx = canvas.getContext("2d");
    if (verticalSplit) {
      ctx.drawImage(juliaExplorer.mandelExplorer.canvas, 0, 0);
      ctx.drawImage(
        juliaExplorer.juliaExplorer.canvas,
        juliaExplorer.mandelExplorer.canvas.width,
        0
      );
    } else {
      ctx.drawImage(juliaExplorer.mandelExplorer.canvas, 0, 0);
      ctx.drawImage(
        juliaExplorer.juliaExplorer.canvas,
        0,
        juliaExplorer.mandelExplorer.canvas.height
      );
    }
  } else if (juliaExplorer.layout === Layout.MANDEL) {
    canvas = juliaExplorer.mandelExplorer.canvas;
  } else {
    canvas = juliaExplorer.juliaExplorer.canvas;
  }
  const link = document.createElement("a");
  link.download = "juliamap.png";
  link.href = canvas.toDataURL("image/png");
  link.click();
}
