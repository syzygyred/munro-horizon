import './style.css';
import { SensorHub } from './sensors.js';
import { HorizonView } from './render.js';
import { distanceMetres, bearing, angularHeightDeg, relativeBearing } from './geo.js';

// Fallback eye-level when the device gives no altitude (common on iOS Safari
// without precise/3D location): a typical Highland road elevation.
const DEFAULT_OBSERVER_HEIGHT_M = 250;

// A9 layby near Dalwhinnie, facing west toward the Ben Alder group —
// used as the desktop "demo" viewpoint, see plan's verification section.
const DEMO_LOCATION = { lat: 56.9336, lon: -4.2406, heading: 270, altitude: 380 };

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
};

let munros = [];
let lastState = null;
let frozen = false;

const hub = new SensorHub();
const view = new HorizonView(els.canvas, { onSelect: showInfo });

async function loadMunros() {
  const res = await fetch('/data/munros.json');
  munros = await res.json();
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

function draw(state) {
  if (!state || state.lat == null) return;

  const maxDistanceM = Number(els.rangeRange.value) * 1000;
  const observer = {
    lat: state.lat,
    lon: state.lon,
    heightM: state.altitude ?? DEFAULT_OBSERVER_HEIGHT_M,
    heading: state.heading ?? 0,
  };

  const withGeo = computeGeoForPeaks(observer).filter((p) => p.distanceM <= maxDistanceM);

  view.setFov(Number(els.fovRange.value));
  view.setMaxDistance(maxDistanceM);
  view.render(withGeo, observer.heading);

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

els.fovRange.addEventListener('input', () => draw(lastState));
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

hub.subscribe((state) => {
  lastState = state;
  if (state.lat == null && state.error) {
    updateStatusBar(state);
    return;
  }
  if (!frozen) draw(state);
  else updateStatusBar(state);
});

els.startBtn.addEventListener('click', async () => {
  els.startError.hidden = true;
  try {
    await hub.requestPermissions();
    hub.start();
    enterRunningState();
  } catch (err) {
    els.startError.textContent = err.message;
    els.startError.hidden = false;
  }
});

els.demoBtn.addEventListener('click', () => {
  hub.setMock(DEMO_LOCATION);
  enterRunningState();
});

loadMunros();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
