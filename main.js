import { RenderOptions, RenderingEngine } from "./renderers/renderer.js";
import { AppState } from "./state.js";
import {
  getDefaultRenderingEngine,
  isEngineSupported,
} from "./renderers/renderers.js";
import { JuliaExplorer, Layout } from "./julia-explorer.js";
import { Complex } from "./complex.js";
import { Palette } from "./palette.js";

import { ControlPanel } from "./control-panel.js";
const MAX_UPDATE_STATS_FREQ = 10;

let appState = null;
let juliaExplorer = null;
let updateURLTimeoutId = null;
let controlPanel = null;
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
      pixelDensity: appState.pixelDensity,
    }),
    onChanged: updateURL,
    onRendered: updateStats,
  });
  juliaExplorer.mandelExplorer.map.moveTo(appState.mcenter, appState.mzoom);
  juliaExplorer.juliaExplorer.map.moveTo(appState.jcenter, appState.jzoom);
  juliaExplorer.setLayout(appState.layout ?? Layout.MANDEL);
  juliaExplorer.updateJuliaFn();
  juliaExplorer.resize(window.innerWidth, window.innerHeight);
  const rendererOptions = await getSupportedRenderers();
  controlPanel = new ControlPanel({
    renderer: appState.renderingEngine ? appState.renderingEngine + (appState.deep ? ".deep" : "") : "auto",
    palette: appState.palette ?? "wikipedia",
    maxIter: appState.maxIter,
    pixelDensity: appState.pixelDensity,
    renderers: rendererOptions,
  });
  controlPanel.addEventListener("rendererChange", async (e) => {
    await changeRenderer(e.detail);
  });
  controlPanel.addEventListener("paletteChange", (e) => {
    changePalette(e.detail);
  });
  controlPanel.addEventListener("maxIterChange", (e) => {
    changeIter(e.detail);
  });
  controlPanel.addEventListener("pixelDensityChange", (e) => {
    changePixelDensity(e.detail);
  });
  controlPanel.updateIterDefault(getDefaultIter());
  controlPanel.updateDynamicPixelDensity(juliaExplorer.mandelExplorer.dynamicPixelDensity);
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
    appState.pixelDensity = juliaExplorer.mandelExplorer.options.pixelDensity;
    appState.updateAddressBar();
    if (controlPanel) {
      controlPanel.updateIterDefault(getDefaultIter());
      controlPanel.updateDynamicPixelDensity(
        juliaExplorer.mandelExplorer.dynamicPixelDensity
      );
    }
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

function getDefaultIter() {
  return Math.round(200 * (1 + juliaExplorer.mandelExplorer.map.zoom));
}

async function getSupportedRenderers() {
  const list = [];
  if (await isEngineSupported(RenderingEngine.WEBGPU)) {
    list.push("webgpu", "webgpu.deep");
  }
  if (await isEngineSupported(RenderingEngine.WEBGL2)) {
    list.push("webgl2", "webgl2.deep");
  }
  if (await isEngineSupported(RenderingEngine.WEBGL1)) {
    list.push("webgl1", "webgl1.deep");
  }
  if (await isEngineSupported(RenderingEngine.CPU)) {
    list.push("cpu");
  }
  return list;
}


async function changeRenderer(selection) {
  let renderer = selection;
  let deep = null;
  if (selection !== "auto") {
    const parts = selection.split(".");
    renderer = parts[0];
    deep = parts[1] === "deep";
  } else {
    renderer = await getDefaultRenderingEngine();
  }
  if (
    renderer === juliaExplorer.mandelExplorer.renderer.id() &&
    deep === appState.deep
  ) {
    return;
  }

  const mcenter = juliaExplorer.mandelExplorer.map.center;
  const mzoom = juliaExplorer.mandelExplorer.map.zoom;
  const jcenter = juliaExplorer.juliaExplorer.map.center;
  const jzoom = juliaExplorer.juliaExplorer.map.zoom;
  const layout = juliaExplorer.layout;

  juliaExplorer.detach();

  juliaExplorer = await JuliaExplorer.create({
    renderingEngine: renderer,
    options: new RenderOptions({
      palette: appState.palette,
      maxIter: appState.maxIter,
      deep: deep,
      pixelDensity: appState.pixelDensity,
    }),
    onChanged: updateURL,
    onRendered: updateStats,
  });
  juliaExplorer.mandelExplorer.map.moveTo(mcenter, mzoom);
  juliaExplorer.juliaExplorer.map.moveTo(jcenter, jzoom);
  juliaExplorer.setLayout(layout);
  juliaExplorer.updateJuliaFn();
  juliaExplorer.resize(window.innerWidth, window.innerHeight);

  appState.renderingEngine = selection === "auto" ? null : renderer;
  appState.deep = selection === "auto" ? null : deep;
  updateURL();
}

function changePalette(palette) {
  appState.palette = palette === "wikipedia" ? null : palette;
  juliaExplorer.mandelExplorer.options.palette = palette;
  juliaExplorer.juliaExplorer.options.palette = palette;
  juliaExplorer.mandelExplorer.render();
  juliaExplorer.juliaExplorer.render();
  updateURL();
}

function changeIter(iter) {
  appState.maxIter = iter;
  juliaExplorer.mandelExplorer.options.maxIter = iter;
  juliaExplorer.juliaExplorer.options.maxIter = iter;
  juliaExplorer.mandelExplorer.render();
  juliaExplorer.juliaExplorer.render();
  updateURL();
}

function changePixelDensity(pd) {
  appState.pixelDensity = pd;
  juliaExplorer.mandelExplorer.options.pixelDensity = pd;
  juliaExplorer.juliaExplorer.options.pixelDensity = pd;
  juliaExplorer.mandelExplorer.dynamicPixelDensity = pd ?? juliaExplorer.mandelExplorer.dynamicPixelDensity;
  juliaExplorer.juliaExplorer.dynamicPixelDensity = pd ?? juliaExplorer.juliaExplorer.dynamicPixelDensity;
  juliaExplorer.mandelExplorer.render();
  juliaExplorer.juliaExplorer.render();
  updateURL();
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
