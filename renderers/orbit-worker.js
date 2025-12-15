import { BigComplexPlane, COMPLEX_PLANE } from "../math/complex.js";
import { Orbit, FN_MANDELBROT, FN_JULIA } from "../math/julia.js";

function buildPlane(exponent) {
  return exponent === null || exponent === undefined
    ? COMPLEX_PLANE
    : new BigComplexPlane(exponent);
}

function buildComplex(plane, point) {
  return plane.complex(point.x, point.y);
}

function makeMap(mapData) {
  const plane = buildPlane(mapData.planeExponent);
  const center = buildComplex(plane, mapData.center);
  const zoom = mapData.zoom;

  return {
    plane,
    center,
    zoom,
    screenToComplex(sx, sy, width, height) {
      const c = plane.complex(0, 0).set(center);
      const scale = plane.pow2Scalar(-zoom);
      const delta = plane
        .complex(
          (sx - width * 0.5) * (4 / width),
          -(sy - height * 0.5) * (4 / width)
        )
        .mulScalar(scale);
      return c.add(delta);
    },
  };
}

function toComplexLike(data) {
  if (!data) {
    return COMPLEX_PLANE.complex(0, 0);
  }
  const plane = buildPlane(data.planeExponent);
  return plane.complex(data.x, data.y);
}

function computeOrbit(request) {
  const { map: mapData, width, height, maxIter, fnId, fnParam0 } = request;
  const map = makeMap(mapData);

  switch (fnId) {
    case FN_JULIA: {
      const plane = map.plane ?? COMPLEX_PLANE;
      const param0 = toComplexLike(fnParam0);
      const c = plane.complex().project(param0);
      return Orbit.searchForJulia(map, width, height, maxIter, c);
    }
    case FN_MANDELBROT:
    default:
      return Orbit.searchForMandelbrot(map, width, height, maxIter);
  }
}

function serializeOrbit(orbit) {
  if (!orbit) {
    return null;
  }
  return {
    sx: orbit.sx,
    sy: orbit.sy,
    escapeVelocity: orbit.escapeVelocity,
    iters: orbit.iters,
  };
}

self.onmessage = (event) => {
  const { requestId, payload } = event.data;
  try {
    const orbit = serializeOrbit(computeOrbit(payload));
    const transfer = orbit?.iters?.buffer ? [orbit.iters.buffer] : [];
    self.postMessage({ requestId, orbit }, transfer);
  } catch (err) {
    self.postMessage({
      requestId,
      error: err?.message ?? String(err),
    });
  }
};
