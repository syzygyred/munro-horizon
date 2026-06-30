// Wraps Geolocation + DeviceOrientation behind a single subscribable state
// object, with the iOS 13+ motion-permission dance and a mock mode for
// desktop development without real sensors.

const MOVING_SPEED_THRESHOLD_MS = 1; // ~3.6 km/h — below this, trust compass over GPS course

export class SensorHub {
  constructor() {
    this.state = {
      lat: null,
      lon: null,
      altitude: null,
      heading: null,
      headingSource: null, // 'gps' | 'compass' | 'mock'
      speed: null,
      error: null,
    };
    this._listeners = new Set();
    this._geoWatchId = null;
    this._orientationHandler = null;
  }

  subscribe(fn) {
    this._listeners.add(fn);
    fn(this.state);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) fn(this.state);
  }

  static needsOrientationPermission() {
    return typeof DeviceOrientationEvent !== 'undefined'
      && typeof DeviceOrientationEvent.requestPermission === 'function';
  }

  // Starts the geolocation watch immediately and synchronously (must be
  // called directly inside a tap handler, before any `await`). iOS Safari
  // ties the location-permission prompt to the tap's transient user
  // activation; awaiting something else first (e.g. the motion-permission
  // prompt) can let that activation expire, causing a silent auto-deny
  // with no dialog ever shown.
  start() {
    if (!('geolocation' in navigator)) {
      throw new Error('Geolocation is not supported on this device.');
    }
    this._geoWatchId = navigator.geolocation.watchPosition(
      (pos) => this._onPosition(pos),
      (err) => this._onError(err),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 },
    );
  }

  // Safe to call after start(), even though it's async — orientation's own
  // permission prompt is independently tied to its own call, not start()'s.
  async requestOrientationPermission() {
    if (SensorHub.needsOrientationPermission()) {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') {
        throw new Error('Motion & orientation permission was not granted — compass heading will be unavailable.');
      }
    }
    this._orientationHandler = (e) => this._onOrientation(e);
    window.addEventListener('deviceorientationabsolute', this._orientationHandler, true);
    window.addEventListener('deviceorientation', this._orientationHandler, true);
  }

  stop() {
    if (this._geoWatchId != null) {
      navigator.geolocation.clearWatch(this._geoWatchId);
      this._geoWatchId = null;
    }
    if (this._orientationHandler) {
      window.removeEventListener('deviceorientationabsolute', this._orientationHandler, true);
      window.removeEventListener('deviceorientation', this._orientationHandler, true);
      this._orientationHandler = null;
    }
  }

  _onPosition(pos) {
    const { latitude, longitude, altitude, heading, speed } = pos.coords;
    this.state.lat = latitude;
    this.state.lon = longitude;
    if (altitude != null) this.state.altitude = altitude;
    this.state.speed = speed;
    this.state.error = null;

    if (heading != null && speed != null && speed > MOVING_SPEED_THRESHOLD_MS) {
      this.state.heading = heading;
      this.state.headingSource = 'gps';
    }
    this._emit();
  }

  _onOrientation(e) {
    let heading = null;
    if (typeof e.webkitCompassHeading === 'number') {
      heading = e.webkitCompassHeading; // iOS Safari: true heading already, no inversion needed
    } else if (e.alpha != null) {
      heading = (360 - e.alpha) % 360; // alpha is CCW from the device's initial orientation
    }
    if (heading == null) return;

    const movingFast = (this.state.speed ?? 0) > MOVING_SPEED_THRESHOLD_MS;
    if (this.state.headingSource === 'gps' && movingFast) return; // trust GPS course while driving

    this.state.heading = heading;
    this.state.headingSource = 'compass';
    this._emit();
  }

  _onError(err) {
    const friendly = {
      1: 'Location permission denied. On iPhone: Settings → Privacy & Security → Location Services → Safari Websites → While Using.',
      2: 'Location unavailable — check GPS signal.',
      3: 'Location request timed out — retrying…',
    };
    this.state.error = friendly[err.code] || err.message || 'Location error';
    this._emit();
  }

  setMock({ lat, lon, altitude = 0, heading = 0 }) {
    this.state = { lat, lon, altitude, heading, headingSource: 'mock', speed: 0, error: null };
    this._emit();
  }
}
