#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2 uResolution;
uniform vec3 uCenterZoom;
uniform int uMaxIter;
uniform int uSamples;
uniform int uPaletteId;
uniform int uPaletteInterpolation;
uniform int uUsePerturb;
uniform int uOrbitCount;
uniform int uFunctionId;
uniform vec2 uParam0;

#define MAX_ITER 10000
#define MAX_SUPER_SAMPLES 64
#define MIN_VARIANCE_SAMPLES 4
#define SUPER_SAMPLE_VARIANCE 0.0005

layout(std140) uniform OrbitBlock {
  vec4 uOrbitData[MAX_ITER / 2];
};

vec2 complex_square(vec2 c) {
  return vec2(c.x * c.x - c.y * c.y, 2.0 * c.x * c.y);
}

vec2 complex_mul(vec2 c0, vec2 c1) {
  return vec2(c0.x * c1.x - c0.y * c1.y, c0.x * c1.y + c0.y * c1.x);
}

float complex_square_mod(vec2 c) {
  return dot(c, c);
}

float rand(vec2 co) {
  return fract(sin(dot(co, vec2(12.9898, 78.233))) * 43758.5453);
}

const vec3 RED = vec3(1, 0, 0);
const vec3 YELLOW = vec3(1, 1, 0);
const vec3 GREEN = vec3(0, 1, 0);
const vec3 CYAN = vec3(0, 1, 1);
const vec3 BLUE = vec3(0, 0, 1);
const vec3 MAGENTA = vec3(1, 0, 1);
const vec3 BLACK = vec3(0, 0, 0);
const vec3 WHITE = vec3(1, 1, 1);
const vec3 UNUSED = BLACK;

const int MAX_COLORS = 6;

const vec3 ELECTRIC[MAX_COLORS] = vec3[](
  BLUE, WHITE, UNUSED, UNUSED, UNUSED, UNUSED
);
const vec3 RAINBOW[MAX_COLORS] = vec3[](
  YELLOW, GREEN, CYAN, BLUE, MAGENTA, RED
);
const vec3 ZEBRA[MAX_COLORS] = vec3[](
  WHITE, BLACK, UNUSED, UNUSED, UNUSED, UNUSED
);

const vec3 WIKI0 = vec3(0, 7, 100) / 255.0;
const vec3 WIKI1 = vec3(32, 107, 203) / 255.0;
const vec3 WIKI2 = vec3(237, 255, 255) / 255.0;
const vec3 WIKI3 = vec3(255, 170, 0) / 255.0;
const vec3 WIKI4 = vec3(0, 2, 0) / 255.0;
const vec3 WIKIPEDIA[MAX_COLORS] = vec3[](
  WIKI0, WIKI1, WIKI2, WIKI3, WIKI4, UNUSED
);
const float WIKIPEDIA_POSITIONS[MAX_COLORS] = float[](
  0.0, 0.16, 0.42, 0.6425, 0.8575, 1.0
);

float fmod(float a, float b) {
  return a - b * floor(a / b);
}

vec3 interpolatePaletteSpline(vec3 palette[MAX_COLORS], int count, float t) {
  float wrapped = fmod(t, 1.0);
  float scaled = wrapped * float(count);
  int i = int(min(scaled, float(count) - 0.001));
  float localT = scaled - float(i);

  int i0 = i;
  int i1 = (i + 1) % count;
  int im1 = (i + count - 1) % count;
  int i2 = (i + 2) % count;

  vec3 p0 = palette[i0];
  vec3 p1 = palette[i1];
  vec3 m0 = 0.5 * (palette[i1] - palette[im1]);
  vec3 m1 = 0.5 * (palette[i2] - palette[i0]);

  float t2 = localT * localT;
  float t3 = t2 * localT;

  return (2.0 * t3 - 3.0 * t2 + 1.0) * p0
    + (t3 - 2.0 * t2 + localT) * m0
    + (-2.0 * t3 + 3.0 * t2) * p1
    + (t3 - t2) * m1;
}

vec3 interpolatePaletteLinear(vec3 palette[MAX_COLORS], int count, float t) {
  float wrapped = fmod(t, 1.0);
  float scaled = wrapped * float(count);
  int i = int(min(scaled, float(count) - 0.001));
  float localT = scaled - float(i);

  vec3 c0 = palette[i];
  vec3 c1 = palette[(i + 1) % count];

  return c0 + localT * (c1 - c0);
}

vec3 interpolatePalettePos(
  vec3 palette[MAX_COLORS],
  float positions[MAX_COLORS],
  int count,
  float index
) {
  int lastIndex = count - 1;
  float t = fmod(index, 1.0);
  float firstPos = positions[0];
  float lastPos = positions[lastIndex];
  if (t <= firstPos) {
    return palette[0];
  }
  if (t >= lastPos) {
    float span = 1.0 - lastPos + firstPos;
    float wrapT = (t - lastPos) / span;
    float u = (float(lastIndex) + wrapT) / float(count);
    if (uPaletteInterpolation == 0) {
      return interpolatePaletteLinear(palette, count, u);
    }
    return interpolatePaletteSpline(palette, count, u);
  }
  for (int i = 0; i < lastIndex; i++) {
    float t0 = positions[i];
    float t1 = positions[i + 1];
    if (t >= t0 && t <= t1) {
      float localT = (t - t0) / (t1 - t0);
      float u = (float(i) + localT) / float(count);
      if (uPaletteInterpolation == 0) {
        return interpolatePaletteLinear(palette, count, u);
      }
      return interpolatePaletteSpline(palette, count, u);
    }
  }
  return palette[lastIndex];
}

vec3 interpolatePalette(vec3 palette[MAX_COLORS], int count, float t) {
  if (uPaletteInterpolation == 0) {
    return interpolatePaletteLinear(palette, count, t);
  }
  return interpolatePaletteSpline(palette, count, t);
}

vec3 getPaletteColor(vec3 palette[MAX_COLORS], int count, float t) {
  return palette[int(fmod(t, 1.0) * float(count))];
}

vec3 rainbowColor(float escapeVelocity) {
  return interpolatePalette(RAINBOW, 6, escapeVelocity / 150.0);
}

vec3 electricColor(float escapeVelocity) {
  return interpolatePalette(ELECTRIC, 2, escapeVelocity / 100.0);
}

vec3 zebraColor(float escapeVelocity) {
  return getPaletteColor(ZEBRA, 2, escapeVelocity / 5.0);
}

vec3 wikipediaColor(float escapeVelocity) {
  return interpolatePalettePos(WIKIPEDIA, WIKIPEDIA_POSITIONS, 5, escapeVelocity / 150.0);
}

#define ELECTRIC_PALETTE_ID 0
#define RAINBOW_PALETTE_ID 1
#define ZEBRA_PALETTE_ID 2
#define WIKIPEDIA_PALETTE_ID 3

vec3 getColor(float escapeVelocity) {
  if (escapeVelocity >= float(uMaxIter)) {
    return BLACK;
  }
  switch (uPaletteId) {
    case ELECTRIC_PALETTE_ID:
      return electricColor(escapeVelocity);
    case RAINBOW_PALETTE_ID:
      return rainbowColor(escapeVelocity);
    case ZEBRA_PALETTE_ID:
      return zebraColor(escapeVelocity);
    case WIKIPEDIA_PALETTE_ID:
    default:
      return wikipediaColor(escapeVelocity);
  }
}

#define FN_MANDELBROT 0
#define FN_JULIA 1
#define BAILOUT 128.0

vec2 getOrbitPoint(int index) {
  vec4 point = uOrbitData[index >> 1];
  return (index & 1) == 0 ? point.xy : point.zw;
}

float smoothEscapeVelocity(int iter, float squareMod) {
  return float(iter) + 1.0 - log(log(squareMod)) / log(2.0);
}

float julia(vec2 z0, vec2 c) {
  vec2 z = z0;
  for (int i = 0; i < uMaxIter; i++) {
    z = complex_square(z) + c;

    float squareMod = complex_square_mod(z);
    if (squareMod > BAILOUT * BAILOUT) {
      return smoothEscapeVelocity(i, squareMod);
    }
  }
  return float(uMaxIter);
}

float juliaPerturb(vec2 dz0, vec2 dc) {
  vec2 dz = dz0;
  vec2 z = getOrbitPoint(0);

  for (int i = 0; i < uMaxIter && i < uOrbitCount - 1; i++) {
    dz = complex_mul(2.0 * z + dz, dz) + dc;
    z = getOrbitPoint(i + 1);

    float squareMod = complex_square_mod(z + dz);
    if (squareMod > BAILOUT * BAILOUT) {
      return smoothEscapeVelocity(i, squareMod);
    }
  }
  return float(uMaxIter);
}

vec3 renderOne(vec2 fragCoord, vec2 scaleFactor) {
  float escapeVelocity = 0.0;
  if (uUsePerturb == 0) {
    vec2 pos = uCenterZoom.xy + (fragCoord - 0.5 * uResolution) * scaleFactor;
    switch (uFunctionId) {
      case FN_JULIA:
        escapeVelocity = julia(pos, uParam0);
        break;
      case FN_MANDELBROT:
      default:
        escapeVelocity = julia(vec2(0.0), pos);
        break;
    }
  } else {
    vec2 delta = (fragCoord - uCenterZoom.xy) * scaleFactor;
    switch (uFunctionId) {
      case FN_JULIA:
        escapeVelocity = juliaPerturb(delta, vec2(0.0));
        break;
      case FN_MANDELBROT:
      default:
        escapeVelocity = juliaPerturb(vec2(0.0), delta);
        break;
    }
  }
  return getColor(escapeVelocity);
}

vec3 renderSuperSample(vec2 sampleCoord, vec2 scaleFactor, int samples) {
  vec3 mean = vec3(0.0);
  vec3 m2 = vec3(0.0);
  int sampleCount = 0;

  for (int i = 0; i < MAX_SUPER_SAMPLES; i++) {
    if (i >= samples) {
      break;
    }
    vec2 jitter = vec2(
      rand(gl_FragCoord.xy + float(i)),
      rand(gl_FragCoord.yx + float(i) * 1.3)
    ) - 0.5;
    vec3 sampleColor = renderOne(sampleCoord + jitter, scaleFactor);
    sampleCount += 1;
    vec3 delta = sampleColor - mean;
    mean += delta / float(sampleCount);
    vec3 delta2 = sampleColor - mean;
    m2 += delta * delta2;

    int minVarianceSamples = min(samples, MIN_VARIANCE_SAMPLES);
    if (sampleCount >= minVarianceSamples) {
      float denom = max(float(sampleCount - 1), 1.0);
      vec3 variance = m2 / denom;
      float maxVariance = max(variance.r, max(variance.g, variance.b));
      if (maxVariance <= SUPER_SAMPLE_VARIANCE) {
        break;
      }
    }
  }
  return mean;
}

void main() {
  vec2 scaleFactor = vec2((4.0 / uResolution.x) * exp2(-uCenterZoom.z));
  vec3 col;
  if (uSamples <= 1) {
    col = renderOne(gl_FragCoord.xy, scaleFactor);
  } else {
    col = renderSuperSample(gl_FragCoord.xy, scaleFactor, uSamples);
  }
  fragColor = vec4(col, 1.0);
}
