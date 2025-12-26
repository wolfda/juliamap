precision highp float;

uniform vec2 uResolution;
uniform vec3 uCenterZoom;
uniform int uMaxIter;
uniform int uSamples;
uniform int uPaletteId;
uniform int uPaletteInterpolation;
uniform int uUsePerturb;

uniform sampler2D uOrbitTex;
uniform vec2 uOrbitTexSize;
uniform int uOrbitCount;

uniform int uFunctionId;
uniform vec2 uParam0;

#define MAX_ITER 10000
#define MAX_REF_ORBIT 10000
#define BAILOUT 128.0
#define MAX_SUPER_SAMPLES 64
#define MIN_VARIANCE_SAMPLES 4
#define SUPER_SAMPLE_VARIANCE 0.0005

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

float fmod(float a, float b) {
  return a - b * floor(a / b);
}

const vec3 RED = vec3(1, 0, 0);
const vec3 YELLOW = vec3(1, 1, 0);
const vec3 GREEN = vec3(0, 1, 0);
const vec3 CYAN = vec3(0, 1, 1);
const vec3 BLUE = vec3(0, 0, 1);
const vec3 MAGENTA = vec3(1, 0, 1);
const vec3 BLACK = vec3(0, 0, 0);
const vec3 WHITE = vec3(1, 1, 1);

const vec3 ELECTRIC0 = BLUE;
const vec3 ELECTRIC1 = WHITE;

const vec3 ZEBRA0 = WHITE;
const vec3 ZEBRA1 = BLACK;

const vec3 WIKI0 = vec3(0, 7, 100) / 255.0;
const vec3 WIKI1 = vec3(32, 107, 203) / 255.0;
const vec3 WIKI2 = vec3(237, 255, 255) / 255.0;
const vec3 WIKI3 = vec3(255, 170, 0) / 255.0;
const vec3 WIKI4 = vec3(0, 2, 0) / 255.0;

float getWikipediaPosition(int index) {
  if (index == 0) return 0.0;
  else if (index == 1) return 0.16;
  else if (index == 2) return 0.42;
  else if (index == 3) return 0.6425;
  else return 0.8575;
}

vec3 getRainbowColorAtIndex(int index) {
  if (index == 0) return YELLOW;
  else if (index == 1) return GREEN;
  else if (index == 2) return CYAN;
  else if (index == 3) return BLUE;
  else if (index == 4) return MAGENTA;
  else return RED;
}

vec3 getWikipediaColorAtIndex(int index) {
  if (index == 0) return WIKI0;
  else if (index == 1) return WIKI1;
  else if (index == 2) return WIKI2;
  else if (index == 3) return WIKI3;
  else return WIKI4;
}

#define ELECTRIC_PALETTE_ID 0
#define RAINBOW_PALETTE_ID 1
#define ZEBRA_PALETTE_ID 2
#define WIKIPEDIA_PALETTE_ID 3

#define PALETTE_INTERPOLATION_LINEAR 0

vec3 getPaletteColorById(int paletteId, int index) {
  if (paletteId == ELECTRIC_PALETTE_ID) {
    return index == 0 ? ELECTRIC0 : ELECTRIC1;
  }
  if (paletteId == RAINBOW_PALETTE_ID) {
    return getRainbowColorAtIndex(index);
  }
  if (paletteId == ZEBRA_PALETTE_ID) {
    return index == 0 ? ZEBRA0 : ZEBRA1;
  }
  return getWikipediaColorAtIndex(index);
}

float getPalettePositionById(int paletteId, int index) {
  if (paletteId != WIKIPEDIA_PALETTE_ID) {
    return float(index);
  }
  return getWikipediaPosition(index);
}

vec3 interpolatePaletteSpline(int paletteId, int count, float index) {
  float wrapped = fmod(index, 1.0);
  float scaled = wrapped * float(count);
  int i = int(min(scaled, float(count) - 0.001));
  float localT = scaled - float(i);

  int i0 = i;
  int i1 = i + 1;
  if (i1 >= count) i1 -= count;
  int im1 = i - 1;
  if (im1 < 0) im1 += count;
  int i2 = i + 2;
  if (i2 >= count) i2 -= count;
  if (i2 >= count) i2 -= count;

  vec3 p0 = getPaletteColorById(paletteId, i0);
  vec3 p1 = getPaletteColorById(paletteId, i1);
  vec3 m0 = 0.5 * (getPaletteColorById(paletteId, i1) - getPaletteColorById(paletteId, im1));
  vec3 m1 = 0.5 * (getPaletteColorById(paletteId, i2) - getPaletteColorById(paletteId, i0));

  float t2 = localT * localT;
  float t3 = t2 * localT;

  return (2.0 * t3 - 3.0 * t2 + 1.0) * p0
    + (t3 - 2.0 * t2 + localT) * m0
    + (-2.0 * t3 + 3.0 * t2) * p1
    + (t3 - t2) * m1;
}

vec3 interpolatePaletteLinear(int paletteId, int count, float index) {
  float wrapped = fmod(index, 1.0);
  float scaled = wrapped * float(count);
  int i0 = int(min(scaled, float(count) - 0.001));
  int i1 = i0 + 1;
  if (i1 >= count) i1 -= count;
  float t = scaled - float(i0);
  vec3 c0 = getPaletteColorById(paletteId, i0);
  vec3 c1 = getPaletteColorById(paletteId, i1);
  return c0 + t * (c1 - c0);
}

vec3 interpolatePalette(int paletteId, int count, float index) {
  if (uPaletteInterpolation == PALETTE_INTERPOLATION_LINEAR) {
    return interpolatePaletteLinear(paletteId, count, index);
  }
  return interpolatePaletteSpline(paletteId, count, index);
}

vec3 interpolatePalettePos(int paletteId, int count, float index) {
  int lastIndex = count - 1;
  float t = fmod(index, 1.0);
  float firstPos = getPalettePositionById(paletteId, 0);
  float lastPos = getPalettePositionById(paletteId, lastIndex);

  if (t <= firstPos) {
    return getPaletteColorById(paletteId, 0);
  }
  if (t >= lastPos) {
    float span = 1.0 - lastPos + firstPos;
    float wrapT = (t - lastPos) / span;
    float u = (float(lastIndex) + wrapT) / float(count);
    return interpolatePalette(paletteId, count, u);
  }
  for (int i = 0; i < 6; i++) {
    if (i >= lastIndex) {
      break;
    }
    float t0 = getPalettePositionById(paletteId, i);
    float t1 = getPalettePositionById(paletteId, i + 1);
    if (t >= t0 && t <= t1) {
      float localT = (t - t0) / (t1 - t0);
      float u = (float(i) + localT) / float(count);
      return interpolatePalette(paletteId, count, u);
    }
  }
  return getPaletteColorById(paletteId, lastIndex);
}

vec3 getPaletteColor(int paletteId, int count, float index) {
  return getPaletteColorById(paletteId, int(fmod(index, 1.0) * float(count)));
}

vec3 electricColor(float escapeVelocity) {
  return interpolatePalette(ELECTRIC_PALETTE_ID, 2, escapeVelocity / 100.0);
}

vec3 rainbowColor(float escapeVelocity) {
  return interpolatePalette(RAINBOW_PALETTE_ID, 6, escapeVelocity / 150.0);
}

vec3 zebraColor(float escapeVelocity) {
  float modIndex = mod(escapeVelocity / 5.0, 1.0);
  return int(modIndex * 2.0) == 0 ? ZEBRA0 : ZEBRA1;
}

vec3 wikipediaColor(float escapeVelocity) {
  return interpolatePalettePos(WIKIPEDIA_PALETTE_ID, 5, escapeVelocity / 150.0);
}

vec2 getOrbitPoint(int index) {
  float texIndex = float(index / 2);
  vec2 texPos = vec2(
    mod(texIndex, uOrbitTexSize.x),
    floor(texIndex / uOrbitTexSize.x)
  );
  texPos = (texPos + 0.5) / uOrbitTexSize;

  vec4 orbit = texture2D(uOrbitTex, texPos);
  return mod(float(index), 2.0) == 0.0 ? orbit.rg : orbit.ba;
}

float smoothEscapeVelocity(int iter, float squareMod) {
  return float(iter) + 1.0 - log(log(squareMod)) / log(2.0);
}

float julia(vec2 z0, vec2 c) {
  vec2 z = z0;
  for (int i = 0; i < MAX_ITER; i++) {
    if (i >= uMaxIter) {
      break;
    }
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

  for (int i = 0; i < MAX_REF_ORBIT; i++) {
    if (i >= uMaxIter) {
      break;
    }
    dz = complex_mul(2.0 * z + dz, dz) + dc;
    z = getOrbitPoint(i + 1);

    float squareMod = complex_square_mod(z + dz);
    if (squareMod > BAILOUT * BAILOUT) {
      return smoothEscapeVelocity(i, squareMod);
    }
  }
  return float(uMaxIter);
}

#define FN_MANDELBROT 0
#define FN_JULIA 1

vec3 getColor(float escapeVelocity) {
  if (escapeVelocity >= float(uMaxIter)) {
    return BLACK;
  } else if (uPaletteId == ELECTRIC_PALETTE_ID) {
    return electricColor(escapeVelocity);
  } else if (uPaletteId == RAINBOW_PALETTE_ID) {
    return rainbowColor(escapeVelocity);
  } else if (uPaletteId == ZEBRA_PALETTE_ID) {
    return zebraColor(escapeVelocity);
  } else {
    return wikipediaColor(escapeVelocity);
  }
}

vec3 renderOne(vec2 fragCoord, vec2 scaleFactor) {
  float escapeVelocity = 0.0;
  if (uUsePerturb == 0) {
    vec2 pos = uCenterZoom.xy + (fragCoord - 0.5 * uResolution) * scaleFactor;
    if (uFunctionId == FN_JULIA) {
      escapeVelocity = julia(pos, uParam0);
    } else {
      escapeVelocity = julia(vec2(0.0), pos);
    }
  } else {
    vec2 delta = (fragCoord - uCenterZoom.xy) * scaleFactor;
    if (uFunctionId == FN_JULIA) {
      escapeVelocity = juliaPerturb(delta, vec2(0.0));
    } else {
      escapeVelocity = juliaPerturb(vec2(0.0), delta);
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
    vec3 sample = renderOne(sampleCoord + jitter, scaleFactor);
    sampleCount += 1;
    vec3 delta = sample - mean;
    mean += delta / float(sampleCount);
    vec3 delta2 = sample - mean;
    m2 += delta * delta2;

    int minVarianceSamples = samples < MIN_VARIANCE_SAMPLES
      ? samples
      : MIN_VARIANCE_SAMPLES;
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

  if (uSamples <= 1) {
    gl_FragColor = vec4(renderOne(gl_FragCoord.xy, scaleFactor), 1);
  } else {
    gl_FragColor = vec4(renderSuperSample(gl_FragCoord.xy, scaleFactor, uSamples), 1);
  }
}
