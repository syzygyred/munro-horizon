const EARTH_RADIUS_M = 6371000;

// Standard terrestrial refraction coefficient (~13% of curvature is
// cancelled by atmospheric bending of light over long sightlines).
const REFRACTION_COEFF = 0.13;

function toRad(deg) {
  return (deg * Math.PI) / 180;
}

function toDeg(rad) {
  return (rad * 180) / Math.PI;
}

export function distanceMetres(a, b) {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dPhi = toRad(b.lat - a.lat);
  const dLambda = toRad(b.lon - a.lon);

  const sinDPhi2 = Math.sin(dPhi / 2);
  const sinDLambda2 = Math.sin(dLambda / 2);
  const h =
    sinDPhi2 * sinDPhi2 +
    Math.cos(phi1) * Math.cos(phi2) * sinDLambda2 * sinDLambda2;

  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function bearing(a, b) {
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLambda = toRad(b.lon - a.lon);

  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);

  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Angle above (+) or below (-) the geometric horizon, accounting for
// Earth's curvature and standard atmospheric refraction.
export function angularHeightDeg({ observerHeightM, targetHeightM, distanceM }) {
  const drop =
    ((1 - REFRACTION_COEFF) * (distanceM * distanceM)) / (2 * EARTH_RADIUS_M);
  const heightDiff = targetHeightM - observerHeightM - drop;
  return toDeg(Math.atan2(heightDiff, distanceM));
}

// Signed angle from `headingDeg` to `targetBearingDeg`, in (-180, 180].
// Negative = target is to the left, positive = to the right.
export function relativeBearing(targetBearingDeg, headingDeg) {
  return ((((targetBearingDeg - headingDeg + 180) % 360) + 360) % 360) - 180;
}

export function describePoint(observer, target) {
  const distanceM = distanceMetres(observer, target);
  const bearingDeg = bearing(observer, target);
  const elevationDeg = angularHeightDeg({
    observerHeightM: observer.heightM ?? 0,
    targetHeightM: target.heightM ?? 0,
    distanceM,
  });
  return { distanceM, bearingDeg, elevationDeg };
}
