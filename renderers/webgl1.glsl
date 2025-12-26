precision highp float;

uniform vec2 uResolution;
uniform vec3 uCenterZoom;
uniform int uMaxIter;
uniform int uSamples;
uniform int uPaletteId;
uniform int uUsePerturb;

uniform sampler2D uOrbitTex;
uniform vec2 uOrbitTexSize;
uniform int uOrbitCount;

uniform int uFunctionId;
uniform vec2 uParam0;

#define MAX_ITER 10000
#define MAX_REF_ORBIT 10000
#define BAILOUT 128.0

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

const vec3 ELECTRIC0 = BLUE;
const vec3 ELECTRIC1 = WHITE;

const vec3 ZEBRA0 = WHITE;
const vec3 ZEBRA1 = BLACK;

const vec3 WIKI0 = vec3(0, 7, 100) / 255.0;
const vec3 WIKI1 = vec3(32, 107, 203) / 255.0;
const vec3 WIKI2 = vec3(237, 255, 255) / 255.0;
const vec3 WIKI3 = vec3(255, 170, 0) / 255.0;
const vec3 WIKI4 = vec3(0, 2, 0) / 255.0;

vec3 getRainbowColorAtIndex(int index) {
  if (index == 0) return YELLOW;
  else if (index == 1) return GREEN;
  else if (index == 2) return CYAN;
  else if (index == 3) return BLUE;
  else if (index == 4) return MAGENTA;
  else return RED;
}

vec3 interpolateRainbowPalette(float index) {
  float len = 6.0;
  float pos = len * index;
  int idx0 = int(mod(pos - 1.0, len));
  int idx1 = int(mod(pos, len));
  return mix(
    getRainbowColorAtIndex(idx0),
    getRainbowColorAtIndex(idx1),
    fract(pos)
  );
}

vec3 getWikipediaColorAtIndex(int index) {
  if (index == 0) return WIKI0;
  else if (index == 1) return WIKI1;
  else if (index == 2) return WIKI2;
  else if (index == 3) return WIKI3;
  else return WIKI4;
}

vec3 interpolateWikipediaPalette(float index) {
  float len = 5.0;
  float pos = len * index;
  int idx0 = int(mod(pos - 1.0, len));
  int idx1 = int(mod(pos, len));
  return mix(
    getWikipediaColorAtIndex(idx0),
    getWikipediaColorAtIndex(idx1),
    fract(pos)
  );
}

vec3 interpolateElectricPalette(float index) {
  float len = 2.0;
  float pos = len * index;
  int idx0 = int(mod(pos - 1.0, len));
  int idx1 = int(mod(pos, len));
  vec3 colorFrom = idx0 == 0 ? ELECTRIC0 : ELECTRIC1;
  vec3 colorTo = idx1 == 0 ? ELECTRIC0 : ELECTRIC1;
  return mix(colorFrom, colorTo, fract(pos));
}

vec3 electricColor(float escapeVelocity) {
  return interpolateElectricPalette(escapeVelocity / 100.0);
}

vec3 rainbowColor(float escapeVelocity) {
  return interpolateRainbowPalette(escapeVelocity / 150.0);
}

vec3 zebraColor(float escapeVelocity) {
  float modIndex = mod(escapeVelocity / 5.0, 1.0);
  return int(modIndex * 2.0) == 0 ? ZEBRA0 : ZEBRA1;
}

vec3 wikipediaColor(float escapeVelocity) {
  return interpolateWikipediaPalette(escapeVelocity / 15.0 + 0.2);
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

#define ELECTRIC_PALETTE_ID 0
#define RAINBOW_PALETTE_ID 1
#define ZEBRA_PALETTE_ID 2
#define WIKIPEDIA_PALETTE_ID 3

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
  vec3 color = vec3(0.0);
  for (int i = 0; i < 64; i++) {
    if (i >= samples) {
      break;
    }
    vec2 jitter = vec2(
      rand(gl_FragCoord.xy + float(i)),
      rand(gl_FragCoord.yx + float(i) * 1.3)
    ) - 0.5;
    color += renderOne(sampleCoord + jitter, scaleFactor);
  }
  return color / float(samples);
}

void main() {
  vec2 scaleFactor = (4.0 / uResolution.x) * exp2(-uCenterZoom.z);

  if (uSamples <= 1) {
    gl_FragColor = vec4(renderOne(gl_FragCoord.xy, scaleFactor), 1);
  } else {
    gl_FragColor = vec4(renderSuperSample(gl_FragCoord.xy, scaleFactor, uSamples), 1);
  }
}
