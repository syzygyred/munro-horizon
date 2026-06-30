// WGS84 (GPS) lat/lon -> OSGB36 National Grid easting/northing.
// OS Terrain 50's grid is defined in OSGB36, not WGS84, so this conversion
// is needed to look up elevation under a live GPS fix. Formula: OS "Guide
// to coordinate systems in Great Britain", Annex B (Helmert) + Annex C
// (Redfearn's Transverse Mercator). Accurate to a few metres, well within
// the 50m grid resolution. Validated against DoBIH's lat/lon + grid-ref
// pairs in scripts/build-munros.mjs.

const TX = -446.448, TY = 125.157, TZ = -542.060;
const RX = degToRad(-0.1502 / 3600);
const RY = degToRad(-0.2470 / 3600);
const RZ = degToRad(-0.8421 / 3600);
const S = 20.4894e-6;

const WGS84_A = 6378137.0, WGS84_B = 6356752.314245;
const AIRY_A = 6377563.396, AIRY_B = 6356256.909;

const N_F0 = 0.9996012717;
const N_LAT0 = degToRad(49);
const N_LON0 = degToRad(-2);
const N_E0 = 400000;
const N_N0 = -100000;

function degToRad(deg) {
  return (deg * Math.PI) / 180;
}

function latLonToCartesian(lat, lon, h, a, b) {
  const e2 = 1 - (b * b) / (a * a);
  const phi = degToRad(lat);
  const lam = degToRad(lon);
  const nu = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  return {
    x: (nu + h) * Math.cos(phi) * Math.cos(lam),
    y: (nu + h) * Math.cos(phi) * Math.sin(lam),
    z: ((1 - e2) * nu + h) * Math.sin(phi),
  };
}

function cartesianToLatLon(x, y, z, a, b) {
  const e2 = 1 - (b * b) / (a * a);
  const p = Math.hypot(x, y);
  let phi = Math.atan2(z, p * (1 - e2));
  for (let i = 0; i < 10; i++) {
    const nu = a / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
    phi = Math.atan2(z + e2 * nu * Math.sin(phi), p);
  }
  return { lat: (phi * 180) / Math.PI, lon: (Math.atan2(y, x) * 180) / Math.PI };
}

function wgs84ToOsgb36LatLon(lat, lon) {
  const p = latLonToCartesian(lat, lon, 0, WGS84_A, WGS84_B);
  const x2 = TX + (1 + S) * (p.x - RZ * p.y + RY * p.z);
  const y2 = TY + (1 + S) * (RZ * p.x + p.y - RX * p.z);
  const z2 = TZ + (1 + S) * (-RY * p.x + RX * p.y + p.z);
  return cartesianToLatLon(x2, y2, z2, AIRY_A, AIRY_B);
}

// Returns { easting, northing } in metres (OSGB36 National Grid).
export function latLonToGrid(lat, lon) {
  const { lat: lat2, lon: lon2 } = wgs84ToOsgb36LatLon(lat, lon);
  const phi = degToRad(lat2);
  const lam = degToRad(lon2);
  const a = AIRY_A, b = AIRY_B, f0 = N_F0;
  const e2 = 1 - (b * b) / (a * a);
  const n = (a - b) / (a + b);
  const nu = (a * f0) / Math.sqrt(1 - e2 * Math.sin(phi) ** 2);
  const rho = (a * f0 * (1 - e2)) / (1 - e2 * Math.sin(phi) ** 2) ** 1.5;
  const eta2 = nu / rho - 1;

  const dPhi = phi - N_LAT0, sPhi = phi + N_LAT0;
  const Ma = (1 + n + (5 / 4) * n ** 2 + (5 / 4) * n ** 3) * dPhi;
  const Mb = (3 * n + 3 * n ** 2 + (21 / 8) * n ** 3) * Math.sin(dPhi) * Math.cos(sPhi);
  const Mc = ((15 / 8) * n ** 2 + (15 / 8) * n ** 3) * Math.sin(2 * dPhi) * Math.cos(2 * sPhi);
  const Md = (35 / 24) * n ** 3 * Math.sin(3 * dPhi) * Math.cos(3 * sPhi);
  const M = b * f0 * (Ma - Mb + Mc - Md);

  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi), tanPhi = Math.tan(phi);
  const tan2Phi = tanPhi * tanPhi, tan4Phi = tan2Phi * tan2Phi;

  const I = M + N_N0;
  const II = (nu / 2) * sinPhi * cosPhi;
  const III = (nu / 24) * sinPhi * cosPhi ** 3 * (5 - tan2Phi + 9 * eta2);
  const IIIA = (nu / 720) * sinPhi * cosPhi ** 5 * (61 - 58 * tan2Phi + tan4Phi);

  const IV = nu * cosPhi;
  const V = (nu / 6) * cosPhi ** 3 * (nu / rho - tan2Phi);
  const VI = (nu / 120) * cosPhi ** 5 * (5 - 18 * tan2Phi + tan4Phi + 14 * eta2 - 58 * tan2Phi * eta2);

  const dLam = lam - N_LON0;
  const northing = I + II * dLam ** 2 + III * dLam ** 4 + IIIA * dLam ** 6;
  const easting = N_E0 + IV * dLam + V * dLam ** 3 + VI * dLam ** 5;
  return { easting, northing };
}
