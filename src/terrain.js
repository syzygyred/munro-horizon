// Loads the bundled OS Terrain 50 elevation grids and ray-casts the real
// skyline + per-Munro line-of-sight, replacing the Phase 1 schematic
// triangles with an actual terrain silhouette and proper occlusion.
import { angularHeightDeg } from './geo.js';

const STEP_M = 100; // ray-march step along each azimuth / line-of-sight check
const OCCLUSION_TOLERANCE_DEG = 0.05; // avoids a target's own cell self-occluding from interpolation noise

export class TerrainStore {
  constructor() {
    this.index = null;
    this.squares = new Map(); // code -> { meta, grid: Int16Array }
  }

  async loadAll(onProgress) {
    const base = `${import.meta.env.BASE_URL}data/terrain/`;
    this.index = await (await fetch(`${base}index.json`)).json();
    let loaded = 0;
    await Promise.all(
      this.index.squares.map(async (meta) => {
        const buf = await (await fetch(`${base}${meta.code}.bin`)).arrayBuffer();
        this.squares.set(meta.code, { meta, grid: new Int16Array(buf) });
        loaded++;
        onProgress?.(loaded, this.index.squares.length);
      }),
    );
  }

  _squareFor(easting, northing) {
    for (const sq of this.squares.values()) {
      const { meta } = sq;
      const w = meta.ncols * meta.cellsize, h = meta.nrows * meta.cellsize;
      if (
        easting >= meta.xllcorner && easting < meta.xllcorner + w &&
        northing >= meta.yllcorner && northing < meta.yllcorner + h
      ) {
        return sq;
      }
    }
    return null;
  }

  // Bilinear-interpolated elevation in metres, or null if outside bundled coverage.
  elevationAt(easting, northing) {
    const sq = this._squareFor(easting, northing);
    if (!sq) return null;
    const { meta, grid } = sq;
    const col = (easting - meta.xllcorner) / meta.cellsize;
    const row = (meta.yllcorner + meta.nrows * meta.cellsize - northing) / meta.cellsize;
    const c0 = Math.floor(col), r0 = Math.floor(row);
    if (c0 < 0 || r0 < 0 || c0 >= meta.ncols - 1 || r0 >= meta.nrows - 1) return null;
    const fc = col - c0, fr = row - r0;
    const at = (r, c) => grid[r * meta.ncols + c];
    const top = at(r0, c0) + (at(r0, c0 + 1) - at(r0, c0)) * fc;
    const bot = at(r0 + 1, c0) + (at(r0 + 1, c0 + 1) - at(r0 + 1, c0)) * fc;
    return top + (bot - top) * fr;
  }
}

// Marches outward along each azimuth in the FOV, tracking the steepest
// angular elevation seen — that running max is the true skyline.
export function raySkyline(observerE, observerN, observerH, headingDeg, fovDeg, nRays, maxDistM, terrain) {
  const skyline = [];
  for (let i = 0; i < nRays; i++) {
    const az = headingDeg - fovDeg / 2 + (fovDeg * i) / (nRays - 1);
    const rad = (az * Math.PI) / 180;
    const dx = Math.sin(rad), dy = Math.cos(rad);
    let bestAngle = -90;
    for (let d = STEP_M; d <= maxDistM; d += STEP_M) {
      const h = terrain.elevationAt(observerE + dx * d, observerN + dy * d);
      if (h == null) continue;
      const angle = angularHeightDeg({ observerHeightM: observerH, targetHeightM: h, distanceM: d });
      if (angle > bestAngle) bestAngle = angle;
    }
    skyline.push({ azimuthDeg: az, elevationDeg: bestAngle });
  }
  return skyline;
}

// True if nothing along the line of sight to (targetE, targetN, targetH)
// is angularly higher than the target itself — i.e. the peak isn't hidden
// behind a nearer ridge.
export function isVisible(observerE, observerN, observerH, targetE, targetN, targetH, terrain) {
  const dist = Math.hypot(targetE - observerE, targetN - observerN);
  if (dist < STEP_M) return true;
  const dx = (targetE - observerE) / dist, dy = (targetN - observerN) / dist;
  const targetAngle = angularHeightDeg({ observerHeightM: observerH, targetHeightM: targetH, distanceM: dist });

  for (let d = STEP_M; d < dist - STEP_M; d += STEP_M) {
    const h = terrain.elevationAt(observerE + dx * d, observerN + dy * d);
    if (h == null) continue;
    const angle = angularHeightDeg({ observerHeightM: observerH, targetHeightM: h, distanceM: d });
    if (angle > targetAngle + OCCLUSION_TOLERANCE_DEG) return false;
  }
  return true;
}
