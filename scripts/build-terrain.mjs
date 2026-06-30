// Builds the Phase 2 terrain dataset: downloads OS Terrain 50 (free,
// CC BY 4.0 / OS OpenData — no API key needed), extracts the 7 National
// Grid 100km squares that contain Munro summits (NC, NG, NH, NJ, NM, NN,
// NO — see scripts/build-munros.mjs's Grid ref column), and packs each
// into a compact Int16 binary elevation grid at native 50m resolution.
//
// Origins below were read directly from sample tile headers in the
// downloaded data (not derived from the OS grid-letter formula, to avoid
// transcription error) — see the chat history for how they were found.
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';

const SOURCE_URL =
  'https://api.os.uk/downloads/v1/products/Terrain50/downloads?area=GB&format=ASCII+Grid+and+GML+%28Grid%29&redirect';
const CACHE_ZIP = path.join(os.tmpdir(), 'terr50_gagg_gb.zip');
const OUT_DIR = new URL('../public/data/terrain/', import.meta.url).pathname;
const SCRATCH = path.join(os.tmpdir(), 'terrain50-build');

const SQUARE_ORIGINS = {
  NC: { e: 200000, n: 900000 },
  NG: { e: 100000, n: 800000 },
  NH: { e: 200000, n: 800000 },
  NJ: { e: 300000, n: 800000 },
  NM: { e: 100000, n: 700000 },
  NN: { e: 200000, n: 700000 },
  NO: { e: 300000, n: 700000 },
};
const SQUARE_SIZE_M = 100000;
const CELLSIZE_M = 50;
const SQUARE_DIM = SQUARE_SIZE_M / CELLSIZE_M; // 2000 cells per side

function ensureSourceZip() {
  if (existsSync(CACHE_ZIP)) {
    console.log(`Using cached download at ${CACHE_ZIP}`);
    return;
  }
  console.log('Downloading OS Terrain 50 (GB, ~161MB)...');
  execSync(`curl -L -o "${CACHE_ZIP}" "${SOURCE_URL}"`, { stdio: 'inherit' });
}

function parseAsc(text) {
  const lines = text.split('\n');
  const header = {};
  let i = 0;
  while (i < lines.length) {
    const parts = lines[i].trim().split(/\s+/);
    const key = parts[0]?.toLowerCase();
    if (['ncols', 'nrows', 'xllcorner', 'yllcorner', 'cellsize', 'nodata_value'].includes(key)) {
      header[key] = Number(parts[1]);
      i++;
    } else break;
  }
  const ncols = header.ncols, nrows = header.nrows;
  const rows = new Array(nrows);
  for (let r = 0; r < nrows; r++) {
    rows[r] = lines[i + r].trim().split(/\s+/).map(Number);
  }
  return { ...header, rows };
}

function buildSquare(code, origin) {
  console.log(`Building ${code}...`);
  const grid = new Int16Array(SQUARE_DIM * SQUARE_DIM); // defaults to 0 (sea level / no data)

  const squareDir = path.join(SCRATCH, code.toLowerCase());
  mkdirSync(squareDir, { recursive: true });
  execSync(`unzip -o -q "${CACHE_ZIP}" "data/${code.toLowerCase()}/*" -d "${SCRATCH}"`, { stdio: 'inherit' });

  const listing = execSync(`unzip -l "${CACHE_ZIP}" "data/${code.toLowerCase()}/*.zip"`, { encoding: 'utf-8' });
  const tileZips = [...listing.matchAll(/data\/[a-z]{2}\/(\w+_OST50GRID_\d+)\.zip/g)].map((m) => m[0]);

  let tileCount = 0;
  for (const tileZipRel of tileZips) {
    const tileZipAbs = path.join(SCRATCH, tileZipRel);
    if (!existsSync(tileZipAbs)) continue;
    const ascListing = execSync(`unzip -l "${tileZipAbs}"`, { encoding: 'utf-8' });
    const ascMatch = ascListing.match(/([A-Z]{2}\d{2}\.asc)/);
    if (!ascMatch) continue;
    const ascText = execSync(`unzip -p "${tileZipAbs}" "${ascMatch[1]}"`, { encoding: 'utf-8' });
    const tile = parseAsc(ascText);

    const colOff = Math.round((tile.xllcorner - origin.e) / CELLSIZE_M);
    // .asc rows go north->south; our grid is stored the same way (row 0 = north edge)
    const rowOffFromTop = Math.round((origin.n + SQUARE_SIZE_M - (tile.yllcorner + tile.nrows * CELLSIZE_M)) / CELLSIZE_M);

    for (let r = 0; r < tile.nrows; r++) {
      const destRow = rowOffFromTop + r;
      if (destRow < 0 || destRow >= SQUARE_DIM) continue;
      for (let c = 0; c < tile.ncols; c++) {
        const destCol = colOff + c;
        if (destCol < 0 || destCol >= SQUARE_DIM) continue;
        const v = tile.rows[r][c];
        grid[destRow * SQUARE_DIM + destCol] = Number.isFinite(v) ? Math.round(v) : 0;
      }
    }
    tileCount++;
  }

  writeFileSync(path.join(OUT_DIR, `${code}.bin`), Buffer.from(grid.buffer));
  console.log(`  ${code}: ${tileCount} tiles merged, wrote ${code}.bin`);
  return { code, ncols: SQUARE_DIM, nrows: SQUARE_DIM, cellsize: CELLSIZE_M, xllcorner: origin.e, yllcorner: origin.n };
}

mkdirSync(OUT_DIR, { recursive: true });
ensureSourceZip();

const index = Object.entries(SQUARE_ORIGINS).map(([code, origin]) => buildSquare(code, origin));
writeFileSync(path.join(OUT_DIR, 'index.json'), JSON.stringify({ squares: index }));

rmSync(SCRATCH, { recursive: true, force: true });
console.log('Done. Wrote public/data/terrain/{index.json, NC.bin, NG.bin, NH.bin, NJ.bin, NM.bin, NN.bin, NO.bin}');
