#version 300 es
precision highp float;
out vec4 fragColor;

uniform vec2 uResolution;
uniform vec3 uCenterZoom;
uniform int uMaxIter;
uniform int uSamples;
uniform int uPaletteId;
uniform int uUsePerturb;
uniform int uOrbitCount;
uniform int uFunctionId;
uniform vec2 uParam0;

#define MAX_ITER 10000

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

const vec3 ELECTRIC[2] = vec3[](BLUE, WHITE);
const vec3 RAINBOW[6] = vec3[](YELLOW, GREEN, CYAN, BLUE, MAGENTA, RED);
const vec3 ZEBRA[2] = vec3[](WHITE, BLACK);

const vec3 WIKIPEDIA[5] = vec3[](
  vec3(0, 7, 100) / 255.0,
  vec3(32, 107, 203) / 255.0,
  vec3(237, 255, 255) / 255.0,
  vec3(255, 170, 0) / 255.0,
  vec3(0, 2, 0) / 255.0
);

vec3 interpolatePalette6Color(vec3 palette[6], float index) {
  float len = 6.0;
  int i0 = int(mod(len * index - 1.0, len));
  int i1 = int(mod(len * index, len));
  float t = mod(len * index, 1.0);
  return palette[i0] + t * (palette[i1] - palette[i0]);
}

vec3 interpolatePalette5Color(vec3 palette[5], float index) {
  float len = 5.0;
  int i0 = int(mod(len * index - 1.0, len));
  int i1 = int(mod(len * index, len));
  float t = mod(len * index, 1.0);
  return palette[i0] + t * (palette[i1] - palette[i0]);
}

vec3 interpolatePalette2Color(vec3 palette[2], float index) {
  float len = 2.0;
  int i0 = int(mod(len * index - 1.0, len));
  int i1 = int(mod(len * index, len));
  float t = mod(len * index, 1.0);
  return palette[i0] + t * (palette[i1] - palette[i0]);
}

vec3 getPalette2Color(vec3 palette[2], float index) {
  return palette[int(mod(index, 1.0) * 2.0)];
}

vec3 rainbowColor(float escapeVelocity) {
  return interpolatePalette6Color(RAINBOW, escapeVelocity / 150.0);
}

vec3 electricColor(float escapeVelocity) {
  return interpolatePalette2Color(ELECTRIC, escapeVelocity / 100.0);
}

vec3 zebraColor(float escapeVelocity) {
  return getPalette2Color(ZEBRA, escapeVelocity / 5.0);
}

vec3 wikipediaColor(float escapeVelocity) {
  return interpolatePalette5Color(WIKIPEDIA, escapeVelocity / 15.0 + 0.2);
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
  vec3 color = vec3(0);
  for (int i = 0; i < samples; i++) {
    vec2 jitter =
      vec2(
        rand(gl_FragCoord.xy + float(i)),
        rand(gl_FragCoord.yx + float(i) * 1.3)
      ) - 0.5;
    color += renderOne(sampleCoord + jitter, scaleFactor);
  }
  return color / float(samples);
}

void main() {
  vec2 scaleFactor = (4.0 / uResolution.x) * exp2(-uCenterZoom.z);
  vec3 col;
  if (uSamples <= 1) {
    col = renderOne(gl_FragCoord.xy, scaleFactor);
  } else {
    col = renderSuperSample(gl_FragCoord.xy, scaleFactor, uSamples);
  }
  fragColor = vec4(col, 1.0);
}
