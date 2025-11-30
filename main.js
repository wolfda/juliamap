import { RenderOptions } from "./renderers/renderer.js";
import { appState, StateAttributes } from "./state.js";
import {
  getDefaultRenderingEngine,
  getSupportedRenderers,
} from "./renderers/renderers.js";
import { JuliaExplorer, Layout } from "./julia-explorer.js";
import { Palette } from "./palette.js";

import { AppStateEditor } from "./state-editor.js";
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
    options: new RenderOptions({
      palette: appState.palette,
      maxIter: appState.maxIter,
      deep: appState.deep,
      pixelDensity: appState.pixelDensity,
    }),
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
    case StateAttributes.VIEWPORT:
      const density =
        juliaExplorer.layout === Layout.JULIA
          ? juliaExplorer.juliaExplorer.dynamicPixelDensity
          : juliaExplorer.mandelExplorer.dynamicPixelDensity;
      appState.setDynamicPixelDensity(density);
      break;
    case StateAttributes.RENDERING_ENGINE:
      await updateRenderer();
      break;
    case StateAttributes.PALETTE:
      updatePalette();
      break;
    case StateAttributes.MAX_ITER:
      updateMaxIter();
      break;
    case StateAttributes.PIXEL_DENSITY:
      updatePixelDensity();
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
    options: new RenderOptions({
      palette: appState.palette,
      maxIter: appState.maxIter,
      deep: appState.deep,
      pixelDensity: appState.pixelDensity,
    }),
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
  juliaExplorer.mandelExplorer.render();
  juliaExplorer.juliaExplorer.render();
}

function updateMaxIter() {
  juliaExplorer.mandelExplorer.options.maxIter = appState.maxIter;
  juliaExplorer.juliaExplorer.options.maxIter = appState.maxIter;
  juliaExplorer.mandelExplorer.render();
  juliaExplorer.juliaExplorer.render();
}

function updatePixelDensity() {
  if (juliaExplorer.layout === Layout.JULIA) {
    juliaExplorer.juliaExplorer.options.pixelDensity = appState.pixelDensity;
    juliaExplorer.juliaExplorer.dynamicPixelDensity =
      appState.pixelDensity ?? juliaExplorer.juliaExplorer.dynamicPixelDensity;
    juliaExplorer.juliaExplorer.render();
  } else {
    juliaExplorer.mandelExplorer.options.pixelDensity = appState.pixelDensity;
    juliaExplorer.mandelExplorer.dynamicPixelDensity =
      appState.pixelDensity ?? juliaExplorer.mandelExplorer.dynamicPixelDensity;
    juliaExplorer.mandelExplorer.render();
  }
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
