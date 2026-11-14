// What an observer on the ground sees: closest approach, passes and visibility.
import * as O from './orbit.js';

const DEG = 180 / Math.PI;
const MIN_EL = 10;   // degrees above the horizon for a pass to be worth looking at
const DARK_SUN = -6; // Sun this far below the horizon: sky dark enough (end of civil twilight)

export function inShadow(p, t) {
  const s = O.sunDir(t), d = p[0] * s[0] + p[1] * s[1] + p[2] * s[2];
  return d < 0 && p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - d * d < O.RE * O.RE;
}

export function compass(az) {
  const names = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];
  return names[Math.round((((az % 360) + 360) % 360) / 22.5) % 16];
}

export function sky(sunEl) {
  if (sunEl > 0) return 'day';
  if (sunEl > DARK_SUN) return 'twilight';
  return 'night';
}

// Observer frame at geodetic lat/lon (degrees), sea level
function site(lat, lon) {
  const la = lat / DEG, lo = lon / DEG;
  return {
    pos: O.geoToEcef(lat, lon, 0),
    up: [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)],
    east: [-Math.sin(lo), Math.cos(lo), 0],
    north: [-Math.sin(la) * Math.cos(lo), -Math.sin(la) * Math.sin(lo), Math.cos(la)],
  };
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const st = new Float64Array(6);
// Where the ship is in the observer's sky at time t
export function look(eph, S, t) {
  O.sample(eph, t, st);
  const e = O.eciToEcef(st, t);
  const d = [e[0] - S.pos[0], e[1] - S.pos[1], e[2] - S.pos[2]];
  const range = Math.hypot(d[0], d[1], d[2]);
  const sunE = O.eciToEcef(O.sunDir(t), t);
  return {
    t,
    range,
    el: Math.asin(dot(d, S.up) / range) * DEG,
    az: ((Math.atan2(dot(d, S.east), dot(d, S.north)) * DEG) + 360) % 360,
    sunEl: Math.asin(dot(sunE, S.up)) * DEG,
    lit: !inShadow(st, t),
  };
}
const seen = (L) => L.el >= MIN_EL && L.sunEl <= DARK_SUN && L.lit;

export function analyze(eph, lat, lon, tFrom, tTo) {
  const S = site(lat, lon), step = 10;
  let closest = null;
  const passes = [];
  let cur = null;
  for (let t = tFrom; t <= tTo; t += step) {
    const L = look(eph, S, t);
    if (!closest || L.range < closest.range) closest = L;
    if (L.el > 0) {
      if (!cur) cur = { start: L, max: L, near: L, end: L, visSec: 0, visStart: null, visEnd: null, visMax: null };
      if (L.el > cur.max.el) cur.max = L;
      if (L.range < cur.near.range) cur.near = L;
      cur.end = L;
      if (seen(L)) {
        cur.visSec += step;
        if (!cur.visStart) cur.visStart = L;
        cur.visEnd = L;
        if (!cur.visMax || L.el > cur.visMax.el) cur.visMax = L;
      }
    } else if (cur) { passes.push(cur); cur = null; }
  }
  if (cur) passes.push(cur);

  // refine the closest approach to the second
  for (let t = Math.max(tFrom, closest.t - step); t <= Math.min(tTo, closest.t + step); t += 1) {
    const L = look(eph, S, t);
    if (L.range < closest.range) closest = L;
  }
  O.sample(eph, closest.t, st);
  const g = O.geodetic(O.eciToEcef(st, closest.t));
  const la1 = lat / DEG, la2 = g.lat / DEG, dl = (g.lon - lon) / DEG;
  closest.groundKm = 6371 * Math.acos(Math.min(1, Math.sin(la1) * Math.sin(la2) + Math.cos(la1) * Math.cos(la2) * Math.cos(dl)));
  closest.shipHeightKm = g.alt / 1000;
  closest.sky = sky(closest.sunEl);
  closest.visible = seen(closest);

  for (const p of passes) {
    p.visible = p.visSec > 0;
    if (p.visible) p.why = '';
    else if (p.max.el < MIN_EL) p.why = 'low';
    else if (p.max.sunEl > 0) p.why = 'day';
    else if (p.max.sunEl > DARK_SUN) p.why = 'twilight';
    else p.why = 'shadow';
  }
  // Best sighting first: visible passes, then night, twilight, day; nearest first within each.
  // passes that never clear 10 degrees go last whatever the sky
  const group = (p) => (p.visible ? 0 : p.max.el < MIN_EL ? 4 : p.max.sunEl <= DARK_SUN ? 1 : p.max.sunEl <= 0 ? 2 : 3);
  for (const p of passes) { p.sky = sky(p.near.sunEl); p.group = group(p); }
  const ranked = passes.slice().sort((a, b) => a.group - b.group || a.near.range - b.near.range);
  const visible = passes.filter((p) => p.visible).sort((a, b) => b.visMax.el - a.visMax.el);
  const highest = passes.slice().sort((a, b) => b.max.el - a.max.el)[0] || null;
  return { lat, lon, closest, passes, ranked, best: visible[0] || null, visibleCount: visible.length, highest };
}
