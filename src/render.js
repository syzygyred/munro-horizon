// Draws a horizon strip: peaks positioned by relative bearing, sized by
// angular elevation above the horizon ("size = angular height" from the
// schematic-MVP design — no real terrain silhouette yet, that's Phase 2).

// Fraction of canvas height used per degree of elevation, rather than a
// fixed pixel constant — keeps glyphs from overrunning the HUD when the
// viewport is short (phone in landscape, mounted in a car).
const APEX_PX_PER_DEG_FRACTION = 0.032;
const APEX_PX_PER_DEG_MIN = 10;
const APEX_PX_PER_DEG_MAX = 30;
const MIN_HIT_RADIUS_PX = 18;

export class HorizonView {
  constructor(canvas, { fovDeg = 90, maxDistanceM = 50000, onSelect } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.fovDeg = fovDeg;
    this.maxDistanceM = maxDistanceM;
    this.onSelect = onSelect;
    this._hits = [];
    this._lastRender = null;

    this._resize();
    window.addEventListener('resize', () => {
      this._resize();
      // Rotating the phone (e.g. into landscape) resizes the canvas, which
      // clears it — redraw immediately rather than waiting for the next
      // sensor update (which could be a second or more away, or never if frozen).
      if (this._lastRender) {
        this.render(this._lastRender.peaksWithGeo, this._lastRender.headingDeg, this._lastRender.skyline);
      }
    });
    canvas.addEventListener('click', (e) => this._handlePoint(e.clientX, e.clientY));
    canvas.addEventListener('touchend', (e) => {
      const t = e.changedTouches[0];
      if (t) this._handlePoint(t.clientX, t.clientY);
    });
  }

  setFov(deg) {
    this.fovDeg = deg;
  }

  setMaxDistance(m) {
    this.maxDistanceM = m;
  }

  _resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
  }

  _handlePoint(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;

    let best = null;
    let bestDist = Infinity;
    for (const hit of this._hits) {
      const d = Math.hypot(hit.x - x, hit.y - y);
      if (d <= hit.radius && d < bestDist) {
        best = hit.peak;
        bestDist = d;
      }
    }
    if (best && this.onSelect) this.onSelect(best);
  }

  // peaksWithGeo: [{ name, heightM, distanceM, bearingDeg, relBearing, elevationDeg, ... }]
  // skyline (optional, Phase 2): [{ azimuthDeg, elevationDeg }, ...] ray-cast terrain
  // silhouette from src/terrain.js. When present, peaksWithGeo should already be
  // occlusion-filtered (only genuinely visible Munros) — the real ridgeline is drawn
  // instead of schematic triangles, with labels/tap-targets placed at each peak's
  // own angle (which lands on the silhouette, since the peak IS part of the terrain).
  render(peaksWithGeo, headingDeg, skyline = null) {
    this._lastRender = { peaksWithGeo, headingDeg, skyline };
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);
    this._drawSky(ctx, width, height);

    const baseline = height * 0.68;
    this._drawHorizonLine(ctx, width, baseline);
    this._drawCompassTicks(ctx, width, baseline, headingDeg);

    const pixelsPerDegree = width / this.fovDeg;
    const apexPxPerDegElevation = Math.min(
      APEX_PX_PER_DEG_MAX,
      Math.max(APEX_PX_PER_DEG_MIN, height * APEX_PX_PER_DEG_FRACTION),
    );

    const visible = peaksWithGeo
      .filter((p) => Math.abs(p.relBearing) <= this.fovDeg / 2 + 1)
      .filter((p) => p.elevationDeg > -0.5) // below geometric horizon: can't be seen
      .sort((a, b) => b.distanceM - a.distanceM); // far peaks drawn first, near ones on top

    const glyphs = visible.map((p) => {
      const x = width / 2 + p.relBearing * pixelsPerDegree;
      const apexHeightPx = Math.max(6, p.elevationDeg * apexPxPerDegElevation + 14);
      const baseWidthPx = Math.min(80, Math.max(14, apexHeightPx * 0.7));
      const opacity = Math.max(0.35, 1 - (p.distanceM / this.maxDistanceM) * 0.65);
      return { peak: p, x, apexY: baseline - apexHeightPx, apexHeightPx, baseWidthPx, opacity };
    });

    this._hits = [];
    if (skyline) {
      this._drawTerrainSilhouette(ctx, width, baseline, skyline, headingDeg, apexPxPerDegElevation);
    } else {
      for (const g of glyphs) {
        this._drawPeakGlyph(ctx, g.x, baseline, g.apexHeightPx, g.baseWidthPx, g.opacity);
      }
    }
    for (const g of glyphs) {
      this._hits.push({
        x: g.x,
        y: g.apexY,
        radius: Math.max(MIN_HIT_RADIUS_PX, g.baseWidthPx / 2),
        peak: g.peak,
      });
    }

    this._drawLabels(ctx, glyphs);
    this._drawCenterMarker(ctx, width, height);
  }

  _drawTerrainSilhouette(ctx, width, baseline, skyline, headingDeg, apexPxPerDegElevation) {
    const pixelsPerDegree = width / this.fovDeg;
    const points = skyline.map((s) => {
      const rel = ((s.azimuthDeg - headingDeg + 540) % 360) - 180;
      const x = width / 2 + rel * pixelsPerDegree;
      const y = baseline - Math.max(0, s.elevationDeg) * apexPxPerDegElevation;
      return [x, y];
    });

    ctx.fillStyle = 'rgba(60, 50, 45, 0.85)';
    ctx.strokeStyle = 'rgba(255, 240, 220, 0.9)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(points[0][0], baseline);
    for (const [x, y] of points) ctx.lineTo(x, y);
    ctx.lineTo(points[points.length - 1][0], baseline);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }

  // Greedily place labels for the most prominent (tallest-on-screen) peaks
  // first, skipping any whose box would overlap an already-placed label —
  // avoids the unreadable pile-up when many Munros cluster in one direction.
  _drawLabels(ctx, glyphs) {
    const ordered = [...glyphs].sort((a, b) => b.apexHeightPx - a.apexHeightPx);
    const placed = [];

    for (const g of ordered) {
      const text = g.peak.name;
      const subtext = `${Math.round(g.peak.heightM)}m · ${(g.peak.distanceM / 1000).toFixed(1)}km`;
      ctx.font = '11px -apple-system, sans-serif';
      const textWidth = Math.max(ctx.measureText(text).width, ctx.measureText(subtext).width);

      const rect = {
        left: g.x - textWidth / 2 - 4,
        right: g.x + textWidth / 2 + 4,
        top: g.apexY - 32,
        bottom: g.apexY - 4,
      };
      const overlaps = placed.some(
        (r) => rect.left < r.right && rect.right > r.left && rect.top < r.bottom && rect.bottom > r.top,
      );
      if (overlaps) continue;
      placed.push(rect);

      ctx.textAlign = 'center';
      ctx.fillStyle = `rgba(255,255,255,${Math.min(1, g.opacity + 0.3)})`;
      ctx.font = '11px -apple-system, sans-serif';
      ctx.fillText(text, g.x, g.apexY - 6);
      ctx.fillStyle = `rgba(220,220,220,${g.opacity})`;
      ctx.font = '10px -apple-system, sans-serif';
      ctx.fillText(subtext, g.x, g.apexY - 18);
    }
  }

  _drawSky(ctx, width, height) {
    const grad = ctx.createLinearGradient(0, 0, 0, height);
    grad.addColorStop(0, '#0d1b2a');
    grad.addColorStop(1, '#3a6ea5');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, width, height);
  }

  _drawHorizonLine(ctx, width, baseline) {
    ctx.fillStyle = '#1b2a1f';
    ctx.fillRect(0, baseline, width, 1000);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, baseline);
    ctx.lineTo(width, baseline);
    ctx.stroke();
  }

  _drawCompassTicks(ctx, width, baseline, headingDeg) {
    const pixelsPerDegree = width / this.fovDeg;
    const dirs = [
      { deg: 0, label: 'N' }, { deg: 45, label: 'NE' }, { deg: 90, label: 'E' },
      { deg: 135, label: 'SE' }, { deg: 180, label: 'S' }, { deg: 225, label: 'SW' },
      { deg: 270, label: 'W' }, { deg: 315, label: 'NW' },
    ];
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    ctx.font = '12px -apple-system, sans-serif';
    ctx.textAlign = 'center';
    for (const d of dirs) {
      let rel = ((d.deg - headingDeg + 540) % 360) - 180;
      if (Math.abs(rel) > this.fovDeg / 2 + 1) continue;
      const x = width / 2 + rel * pixelsPerDegree;
      ctx.fillRect(x - 0.5, baseline - 6, 1, 6);
      ctx.fillText(d.label, x, baseline - 10);
    }
  }

  _drawCenterMarker(ctx, width, height) {
    ctx.strokeStyle = 'rgba(255,80,80,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(width / 2, 0);
    ctx.lineTo(width / 2, height);
    ctx.stroke();
  }

  _drawPeakGlyph(ctx, x, baseline, apexHeightPx, baseWidthPx, opacity) {
    const apexY = baseline - apexHeightPx;

    ctx.fillStyle = `rgba(60, 50, 45, ${opacity})`;
    ctx.strokeStyle = `rgba(255, 240, 220, ${Math.min(1, opacity + 0.2)})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x - baseWidthPx / 2, baseline);
    ctx.lineTo(x, apexY);
    ctx.lineTo(x + baseWidthPx / 2, baseline);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}
