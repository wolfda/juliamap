export class Complex {
  constructor(x, y) {
    this.x = x;
    this.y = y;
  }

  // z = a
  set(a) {
    this.x = a.x;
    this.y = a.y;
  }

  // z = z + a
  add(a) {
    this.x += a.x;
    this.y += a.y;
  }

  // z = |z|²
  square() {
    const x = this.x * this.x - this.y * this.y;
    this.y = 2 * this.x * this.y;
    this.x = x;
  }

  // z = a + b
  setAdd(a, b) {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
  }

  // z = a²
  setSquare(a) {
    this.x = a.x * a.x - a.y * a.y;
    this.y = 2 * a.x * a.y;
  }

  // return |z|²
  squareMod() {
    return this.x * this.x + this.y * this.y;
  }
}
