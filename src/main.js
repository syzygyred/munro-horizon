import './style.css';
import { SensorHub } from './sensors.js';
import { HorizonView } from './render.js';
import { distanceMetres, bearing, angularHeightDeg, relativeBearing } from './geo.js';
import { latLonToGrid } from './osgb.js';
import { TerrainStore, raySkyline, isVisible } from './terrain.js';

// FOV (the "lens"): low = telephoto/zoomed-in, high = wide-angle. Pinch and
// the Zoom slider both drive this. 10° gives roughly a 6x reach vs the ~60°
// of normal vision; 160° is an ultra-wide panorama.
const MIN_FOV = 10;
const MAX_FOV = 160;

// Fallback eye-level when the device gives no altitude (common on iOS Safari
// without precise/3D location): a typical Highland road elevation.
const DEFAULT_OBSERVER_HEIGHT_M = 250;

// Added to the DEM's ground elevation at the observer's own position, once
// terrain data is loaded — sitting/standing height. GPS altitude is too
// noisy (often off by 10-50m) to use directly: even a small mismatch from
// the DEM's own value at that exact spot creates a steep false "obstruction"
// in the very first ray step, since a tiny height gap over a tiny distance
// is still a large angle.
const EYE_HEIGHT_OFFSET_M = 2;

// A82 layby on Rannoch Moor near Black Corries, facing NNE toward the
// Loch Treig / Ben Alder group — a famously open, unobstructed viewpoint
// (verified visible-peak count with the terrain ray-caster before adopting
// it, see the chat history; an earlier guessed Dalwhinnie coordinate
// turned out to have a real nearer ridge blocking most of that group).
const DEMO_LOCATION = { lat: 56.6330, lon: -4.8250, heading: 30, altitude: 320 };

const els = {
  canvas: document.getElementById('horizon'),
  startScreen: document.getElementById('start-screen'),
  startBtn: document.getElementById('start-btn'),
  demoBtn: document.getElementById('demo-btn'),
  startError: document.getElementById('start-error'),
  hud: document.getElementById('hud'),
  headingReadout: document.getElementById('heading-readout'),
  gpsReadout: document.getElementById('gps-readout'),
  fovRange: document.getElementById('fov-range'),
  fovValue: document.getElementById('fov-value'),
  rangeRange: document.getElementById('range-range'),
  rangeValue: document.getElementById('range-value'),
  freezeBtn: document.getElementById('freeze-btn'),
  infoPanel: document.getElementById('info-panel'),
  infoClose: document.getElementById('info-close'),
  infoName: document.getElementById('info-name'),
  infoHeight: document.getElementById('info-height'),
  infoDistance: document.getElementById('info-distance'),
  infoBearing: document.getElementById('info-bearing'),
  infoNumber: document.getElementById('info-number'),
  terrainStatus: document.getElementById('terrain-status'),
};

let munros = [];
let lastState = null;
let frozen = false;
let terrainReady = false;

const hub = new SensorHub();
const view = new HorizonView(els.canvas, {
  onSelect: showInfo,
  minFov: MIN_FOV,
  maxFov: MAX_FOV,
  onFovChange: applyFov,
});
const terrain = new TerrainStore();

// rAF-coalesced redraw for interactive changes (pinch, slider) — keeps the
// live zoom smooth at the display's refresh rate without queuing a full
// ray-cast per touch event. Distinct from the slower sensor throttle, which
// trades latency for battery while just driving along.
let rafPending = false;
function requestRedraw() {
  if (rafPending) return;
  rafPending = true;
  requestAnimationFrame(() => {
    rafPending = false;
    draw(lastState);
  });
}

function applyFov(fov) {
  const clamped = Math.max(MIN_FOV, Math.min(MAX_FOV, Math.round(fov)));
  els.fovRange.value = String(clamped);
  els.fovValue.textContent = `${clamped}°`;
  requestRedraw();
}

async function loadMunros() {
  const res = await fetch(`${import.meta.env.BASE_URL}data/munros.json`);
  munros = await res.json();
  // Precompute each Munro's National Grid position once — terrain lookups
  // and line-of-sight checks need OSGB36 easting/northing, not lat/lon.
  for (const m of munros) {
    const { easting, northing } = latLonToGrid(m.lat, m.lon);
    m.easting = easting;
    m.northing = northing;
  }
}

function loadTerrain() {
  els.terrainStatus.textContent = 'Loading terrain data (one-time, ~20MB)…';
  terrain
    .loadAll((loaded, total) => {
      els.terrainStatus.textContent = `Loading terrain data… ${loaded}/${total}`;
    })
    .then(() => {
      terrainReady = true;
      els.terrainStatus.textContent = '';
      if (!frozen) draw(lastState);
    })
    .catch((err) => {
      els.terrainStatus.textContent = 'Terrain data unavailable — showing schematic peaks.';
      console.warn('Terrain load failed:', err);
    });
}

function computeGeoForPeaks(observer) {
  return munros.map((m) => {
    const distanceM = distanceMetres(observer, m);
    const bearingDeg = bearing(observer, m);
    const elevationDeg = angularHeightDeg({
      observerHeightM: observer.heightM,
      targetHeightM: m.heightM,
      distanceM,
    });
    const relBearing = relativeBearing(bearingDeg, observer.heading ?? 0);
    return { ...m, distanceM, bearingDeg, elevationDeg, relBearing };
  });
}

const SKYLINE_RAYS_PER_DEG = 2;

function draw(state) {
  if (!state || state.lat == null) return;

  const maxDistanceM = Number(els.rangeRange.value) * 1000;
  const fovDeg = Number(els.fovRange.value);
  const observer = {
    lat: state.lat,
    lon: state.lon,
    heightM: state.altitude ?? DEFAULT_OBSERVER_HEIGHT_M,
    heading: state.heading ?? 0,
  };

  let obsE, obsN;
  if (terrainReady) {
    ({ easting: obsE, northing: obsN } = latLonToGrid(observer.lat, observer.lon));
    const groundHeight = terrain.elevationAt(obsE, obsN);
    if (groundHeight != null) observer.heightM = groundHeight + EYE_HEIGHT_OFFSET_M;
  }

  let withGeo = computeGeoForPeaks(observer).filter((p) => p.distanceM <= maxDistanceM);
  let skyline = null;

  if (terrainReady) {
    const inFov = withGeo.filter((p) => Math.abs(p.relBearing) <= fovDeg / 2 + 1);
    withGeo = inFov.filter((p) =>
      isVisible(obsE, obsN, observer.heightM, p.easting, p.northing, p.heightM, terrain),
    );
    const nRays = Math.min(240, Math.max(60, Math.round(fovDeg * SKYLINE_RAYS_PER_DEG)));
    skyline = raySkyline(obsE, obsN, observer.heightM, observer.heading, fovDeg, nRays, maxDistanceM, terrain);
  }

  view.setFov(fovDeg);
  view.setMaxDistance(maxDistanceM);
  view.render(withGeo, observer.heading, skyline);

  updateStatusBar(state);
}

function updateStatusBar(state) {
  els.headingReadout.textContent =
    state.heading != null ? `${Math.round(state.heading)}° (${state.headingSource ?? '–'})` : 'no heading';
  els.gpsReadout.textContent =
    state.lat != null ? `${state.lat.toFixed(4)}, ${state.lon.toFixed(4)}` : state.error ?? 'no fix';
}

function showInfo(peak) {
  els.infoName.textContent = peak.name;
  els.infoHeight.textContent = `${peak.heightM.toFixed(1)} m`;
  els.infoDistance.textContent = `${(peak.distanceM / 1000).toFixed(1)} km`;
  els.infoBearing.textContent = `${Math.round(peak.bearingDeg)}°`;
  els.infoNumber.textContent = `#${peak.number}`;
  els.infoPanel.hidden = false;
}

els.infoClose.addEventListener('click', () => {
  els.infoPanel.hidden = true;
});

els.fovRange.addEventListener('input', () => applyFov(Number(els.fovRange.value)));
els.rangeRange.addEventListener('input', () => {
  els.rangeValue.textContent = `${els.rangeRange.value}km`;
  draw(lastState);
});

els.freezeBtn.addEventListener('click', () => {
  frozen = !frozen;
  els.freezeBtn.textContent = frozen ? 'Unfreeze' : 'Freeze';
  els.freezeBtn.classList.toggle('active', frozen);
  if (!frozen) draw(lastState);
});

function enterRunningState() {
  els.startScreen.hidden = true;
  els.hud.hidden = false;
}

// deviceorientation can fire 30-60x/sec on a real phone, but a full
// terrain ray-cast costs tens of ms — recomputing on every raw sensor
// event would peg the CPU while driving. Cap the sensor-driven redraw
// rate; direct draw() calls from user actions (sliders, freeze toggle,
// terrain finishing its first load) stay immediate.
const DRAW_THROTTLE_MS = 120;
let lastDrawTime = 0;
let pendingDrawTimeout = null;

function scheduleDraw(state) {
  const now = performance.now();
  const elapsed = now - lastDrawTime;
  if (elapsed >= DRAW_THROTTLE_MS) {
    lastDrawTime = now;
    draw(state);
  } else if (!pendingDrawTimeout) {
    pendingDrawTimeout = setTimeout(() => {
      pendingDrawTimeout = null;
      lastDrawTime = performance.now();
      draw(lastState);
    }, DRAW_THROTTLE_MS - elapsed);
  }
}

hub.subscribe((state) => {
  lastState = state;
  if (state.lat == null && state.error) {
    updateStatusBar(state);
    return;
  }
  if (!frozen) scheduleDraw(state);
  else updateStatusBar(state);
});

els.startBtn.addEventListener('click', () => {
  els.startError.hidden = true;
  try {
    // Must happen synchronously inside this handler — see the comment on
    // SensorHub.start() for why awaiting anything first breaks iOS Safari.
    hub.start();
  } catch (err) {
    els.startError.textContent = err.message;
    els.startError.hidden = false;
    return;
  }
  enterRunningState();
  // Orientation permission has its own tap-bound prompt; requesting it
  // after start() is fine, and a denial here is non-fatal (GPS course
  // still gives a heading once driving).
  hub.requestOrientationPermission().catch((err) => {
    console.warn(err.message);
  });
});

els.demoBtn.addEventListener('click', () => {
  hub.setMock(DEMO_LOCATION);
  enterRunningState();
});

loadMunros();
loadTerrain();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
