export class MarkerOverlay {
  constructor(map, canvas, dpr = window.devicePixelRatio ?? 1) {
    this.map = map;
    this.canvas = canvas;
    this.dpr = dpr;
    this.markers = new Map();

    this.element = document.createElement("div");
    this.element.style.position = "absolute";
    this.element.style.left = "0";
    this.element.style.top = "0";
    this.element.style.width = "100%";
    this.element.style.height = "100%";
    this.element.style.pointerEvents = "none";
  }

  setMarker(id, { point, color = "#ff0000", radius = 4 } = {}) {
    if (!point) {
      this.removeMarker(id);
      return;
    }
    let marker = this.markers.get(id);
    if (!marker) {
      const el = document.createElement("div");
      el.style.position = "absolute";
      el.style.borderRadius = "50%";
      el.style.transform = "translate(-50%, -50%)";
      el.style.pointerEvents = "none";
      marker = { el, point, color, radius };
      this.markers.set(id, marker);
      this.element.appendChild(el);
    }
    marker.point = point;
    marker.color = color;
    marker.radius = radius;
    marker.el.style.width = `${radius * 2}px`;
    marker.el.style.height = `${radius * 2}px`;
    marker.el.style.backgroundColor = color;
  }

  removeMarker(id) {
    const marker = this.markers.get(id);
    if (!marker) {
      return;
    }
    marker.el.remove();
    this.markers.delete(id);
  }

  clear() {
    for (const id of this.markers.keys()) {
      this.removeMarker(id);
    }
  }

  update() {
    const width = this.canvas.width;
    const height = this.canvas.height;
    for (const marker of this.markers.values()) {
      const { sx, sy } = this.map.complexToScreen(marker.point, width, height);
      marker.el.style.left = `${sx / this.dpr}px`;
      marker.el.style.top = `${sy / this.dpr}px`;
    }
  }
}
