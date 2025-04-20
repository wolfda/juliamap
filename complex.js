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

  divScalar(a, b) {
    this.x /= a;
    this.y /= b ?? a;
    return this;
  }

  // z = |z|²
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
}

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
    this.exponent = BigInt(exponent);
  }

  /** 
   * @param {Number} x
   * @return {BigInt}
   */
  asBigInt(x) {
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
   * @param {BigInt} bx
   * @returns {Number}
   */
  asNumber(bx) {
    if (bx === 0n) {
      return 0;
    }
    return Number(bx) * Math.pow(2, -Number(this.exponent));
  }

  complex(x, y) {
    return new BigComplex(this, this.asBigInt(x), this.asBigInt(y));
  }
}

export class BigComplex {
  constructor(plane, x, y) {
    this.plane = plane;
    this.x = x;
    this.y = y;
  }

  assertSameExponent(a) {
    if (this.plane !== a.plane && this.plane.exponent !== a.plane.exponent) {
      throw new Error(
        "Mismatch BigComplex exponent: " +
          this.plane.exponent +
          " != " +
          a.plane.exponent
      );
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

  // z = |z|²
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
}
