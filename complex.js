const DEBUG_MODE = false;
const BITS_PER_DECIMAL = Math.log10(2);

export class Complex {
  constructor(x, y) {
    this.x = x ?? 0;
    this.y = y ?? 0;
  }

  // z = a
  set(a) {
    this.x = a.x;
    this.y = a.y;
    return this;
  }

  // z = z + a
  add(a) {
    this.x += a.x;
    this.y += a.y;
    return this;
  }

  // z = z - a
  sub(a) {
    this.x -= a.x;
    this.y -= a.y;
    return this;
  }

  // z = (x * a, y * (b ?? a))
  mulScalar(a, b) {
    this.x *= a;
    this.y *= b ?? a;
    return this;
  }

  // z = (x / a, y / (b ?? a))
  divScalar(a, b) {
    this.x /= a;
    this.y /= b ?? a;
    return this;
  }

  // z = z²
  square() {
    const x = this.x * this.x - this.y * this.y;
    this.y = 2 * this.x * this.y;
    this.x = x;
    return this;
  }

  // return |z|²
  squareMod() {
    return this.x * this.x + this.y * this.y;
  }

  // z == a
  equals(a) {
    return (
      (a instanceof Complex || a instanceof ConstComplex) &&
      this.x === a.x &&
      this.y === a.y
    );
  }

  project(a) {
    const sourcePlane = a.plane ?? COMPLEX_PLANE;
    if (!sourcePlane.isBigComplex()) {
      this.x = a.x;
      this.y = a.y;
    } else {
      this.x = sourcePlane.asNumber(a.x);
      this.y = sourcePlane.asNumber(a.y);
    }
    return this;
  }

  clone() {
    return new Complex(this.x, this.y);
  }

  const() {
    return DEBUG_MODE ? new ConstComplex(this.x, this.y) : this;
  }
}

class ConstComplex {
  constructor(x, y) {
    this.x = x ?? 0;
    this.y = y ?? 0;
  }

  clone() {
    return new Complex(this.x, this.y);
  }

  const() {
    return this;
  }
}

class ComplexPlane {
  complex(x, y) {
    return new Complex(x, y);
  }

  constComplex(x, y) {
    return new ConstComplex(x, y);
  }

  scalar(x) {
    if (DEBUG_MODE && typeof x !== "number") {
      throw new TypeError("Unexpected scalar type " + typeof x);
    }
    return x;
  }

  log2(x) {
    return Math.log(x) / Math.LN2;
  }

  asNumber(x) {
    if (DEBUG_MODE && typeof x !== "number") {
      throw new TypeError("Unexpected type " + typeof x);
    }
    return x;
  }

  isBigComplex() {
    return false;
  }
}

export const COMPLEX_PLANE = new ComplexPlane();

// Represents the implicit unit of the mantissa.
const MANTISSA_UNIT = 1n << 52n;
const F64_BUFFER = new DataView(new ArrayBuffer(8));

// Decode a ieee-754 64-bit float, and extract the sign, exponent, mantissa
// sign (1 bit) | exponent (11 bits) | mantissa (52 bits)
//
// The float value can be reconstructed with the following formula:
// value = (−1)^sign * (1 + mantissa * 2^-52) * 2^(exponent − 1023)
//
// See https://en.wikipedia.org/wiki/Double-precision_floating-point_format
function ieee754Parts(x) {
  F64_BUFFER.setFloat64(0, x);
  const high = F64_BUFFER.getUint32(0);
  const low = F64_BUFFER.getUint32(4);
  const sign = (high >>> 31) & 0x1;
  const exponent = (high >>> 20) & 0x7ff;
  const fractionHigh = high & 0xfffff;
  const fractionLow = low;
  const fraction = (BigInt(fractionHigh) << 32n) | BigInt(fractionLow);
  return { sign, exponent, fraction };
}

export class BigComplexPlane {
  /**
   * All numbers in the plane are expressed with a scale factor of 2^exponent.
   */
  constructor(exponent) {
    this.exponent = typeof x === "bigint" ? exponent : BigInt(exponent);
  }

  /**
   * @param {Number} x
   * @return {BigInt}
   */
  asBigInt(x) {
    if (typeof x === "bigint" || x === undefined || x === null) {
      return x;
    }
    const {
      sign: x_sign,
      exponent: x_exponent,
      fraction: x_fraction,
    } = ieee754Parts(x);
    if (x_exponent === 0 && x_fraction === 0n) {
      return 0n;
    } else if (x_exponent === 0x7ff && x_fraction === 0n) {
      throw new Error("Invalid float: infinity");
    } else if (x_exponent === 0x7ff) {
      throw new Error("Invalid float: NaN");
    }
    const exponent = this.exponent + BigInt(x_exponent - 1023 - 52);
    const mantissa = MANTISSA_UNIT | x_fraction;
    const base = exponent >= 0 ? mantissa << exponent : mantissa >> -exponent;
    return x_sign ? -base : base;
  }

  /**
   * @param {BigInt} x
   * @returns {Number}
   */
  asNumber(x) {
    if (x === 0n) {
      return 0;
    }
    return Number(x) * Math.pow(2, -Number(this.exponent));
  }

  scalar(x) {
    if (DEBUG_MODE && typeof x !== "number") {
      throw new TypeError("Unexpected scalar type " + typeof x);
    }
    return this.asBigInt(x);
  }

  complex(x, y) {
    return new BigComplex(this, this.asBigInt(x), this.asBigInt(y));
  }

  constComplex(x, y) {
    return new ConstBigComplex(this, this.asBigInt(x), this.asBigInt(y));
  }

  log2(x) {
    if (x <= 0n) {
      return NaN;
    }
    let log = 0;
    while (x > 1n) {
      x >>= 1n;
      log++;
    }
    return log - Number(this.exponent);
  }

  isBigComplex() {
    return true;
  }

  scalarToString(x) {
    return `${x}e${this.exponent}`;
  }
}

export class BigComplex {
  constructor(plane, x, y) {
    this.plane = plane;
    this.x = x;
    this.y = y;
  }

  assertSameExponent(a) {
    if (DEBUG_MODE) {
      if (!(a instanceof BigComplex) && !(a instanceof ConstBigComplex)) {
        throw TypeError(
          `Unexpected type: ${a?.constructor?.name ?? typeof obj} != BigComplex`
        );
      }
      if (this.plane.exponent !== a.plane.exponent) {
        throw new Error(
          `Mismatch BigComplex exponent: ${this.plane.exponent} != ${a.plane.exponent}`
        );
      }
    }
  }

  setScalar(x, y) {
    this.x = this.plane.asBigInt(x);
    this.y = this.plane.asBigInt(y ?? x);
    return this;
  }

  // z = a
  set(a) {
    this.assertSameExponent(a);
    this.x = a.x;
    this.y = a.y;
    return this;
  }

  // z = z + a
  add(a) {
    this.assertSameExponent(a);
    this.x += a.x;
    this.y += a.y;
    return this;
  }

  // z = z - a
  sub(a) {
    this.assertSameExponent(a);
    this.x -= a.x;
    this.y -= a.y;
    return this;
  }

  mulScalar(x, y) {
    x = this.plane.asBigInt(x);
    y = this.plane.asBigInt(y);
    this.x = (this.x * x) >> this.plane.exponent;
    this.y = (this.y * (y ?? x)) >> this.plane.exponent;
    return this;
  }

  divScalar(x, y) {
    x = this.plane.asBigInt(x);
    y = this.plane.asBigInt(y);
    this.x = (this.x << this.plane.exponent) / x;
    this.y = (this.y << this.plane.exponent) / (y ?? x);
    return this;
  }

  // z = z²
  square() {
    const x = (this.x * this.x - this.y * this.y) >> this.plane.exponent;
    this.y = (this.x * this.y) >> (this.plane.exponent - 1n);
    this.x = x;
    return this;
  }

  // return |z|²
  squareMod() {
    return (this.x * this.x + this.y * this.y) >> this.plane.exponent;
  }

  equals(a) {
    return (
      (a instanceof BigComplex || a instanceof ConstBigComplex) &&
      this.plane.exponent === a.plane.exponent &&
      this.x === a.x &&
      this.y === a.y
    );
  }

  toString() {
    return `BigComplex(exponent=${this.plane.exponent}, x=${this.x}, y=${this.y})`;
  }

  project(a) {
    const sourcePlane = a.plane ?? COMPLEX_PLANE;
    if (!sourcePlane.isBigComplex()) {
      this.x = this.plane.asBigInt(a.x);
      this.y = this.plane.asBigInt(a.y);
    } else {
      const exponentDelta = this.plane.exponent - a.plane.exponent;
      if (exponentDelta === 0n) {
        this.x = a.x;
        this.y = a.y;
      } else if (exponentDelta > 0n) {
        this.x = a.x << exponentDelta;
        this.y = a.y << exponentDelta;
      } else {
        this.x = a.x >> -exponentDelta;
        this.y = a.y >> -exponentDelta;
      }
    }
    return this;
  }

  clone() {
    return new BigComplex(this.plane, this.x, this.y);
  }

  const() {
    return DEBUG_MODE ? new ConstBigComplex(this.plane, this.x, this.y) : this;
  }
}

class ConstBigComplex {
  constructor(plane, x, y) {
    this.plane = plane;
    this.x = x;
    this.y = y;
  }

  clone() {
    return new BigComplex(this.plane, this.x, this.y);
  }

  const() {
    return this;
  }
}

export function parseComplex(cStr, separator) {
  const [xStr, yStr] = cStr.split(separator ?? ",");
  if (xStr.indexOf("e") === -1) {
    return new Complex(parseFloat(xStr), parseFloat(yStr));
  }
  const [x, xExp] = xStr.split("e");
  const [y, yExp] = yStr.split("e");
  if (xExp !== yExp) {
    throw Error("Inconsistent exponent");
  }
  const plane = new BigComplexPlane(BigInt(xExp));
  return plane.complex(BigInt(x), BigInt(y));
}

export function renderComplex(c, zoom, separator) {
  if (c.plane === undefined) {
    // Native doubles
    const decimals = 3 + Math.ceil(zoom * BITS_PER_DECIMAL);
    return c.x.toFixed(decimals) + (separator ?? ",") + c.y.toFixed(decimals);
  }
  return c.plane.scalarToString(c.x) + (separator ?? ",") + c.plane.scalarToString(c.y);
}
