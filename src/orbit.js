// Orbit model for Starship Flight 15 (Ship 42).
// State vector fitted (Gauss-Newton, J2 gravity) to 161 telemetry samples
// from the StarDash public feed, T+27 min to T+1 h 50 min.
export const MU = 3.986004418e14;
export const RE = 6378137;
export const J2 = 1.08262668e-3;

export const LIFTOFF = 1794610056; // unix s, 2026-11-13 22:47:36 UTC (feed t0)
export const EPOCH = 1794616655.770291; // unix s of the fitted state
// ECI (true-of-date, rotated from ECEF by GMST): x y z [m], vx vy vz [m/s]
export const STATE = [
  6627347.315658415, -575537.2575734828, -54508.60261978928,
  549.576766121611, 6646.873332325338, -3931.1642525848983,
];
export const FIT = { samples: 161, rmsM: 276, fromMet: 1620, toMet: 6600 };

// Planned events, seconds after liftoff (SpaceX timeline)
export const EVENTS = [
  { met: 26 * 60 + 10, label: 'Orbit insertion burn' },
  { met: 7 * 3600 + 15 * 60 + 35, label: 'Mid-mission return check (Chile)' },
  { met: 20 * 3600 + 41 * 60 + 55, label: 'Final return check (Hawaii)' },
  { met: 21 * 3600 + 35 * 60 + 57, label: 'Deorbit burn' },
];
export const DEORBIT = LIFTOFF + 21 * 3600 + 35 * 60 + 57;

export function gmst(unix) {
  const d = unix / 86400 + 2440587.5 - 2451545.0;
  const deg = (280.46061837 + 360.98564736629 * d) % 360;
  return ((deg + 360) % 360) * Math.PI / 180;
}

function deriv(s, o) {
  const x = s[0], y = s[1], z = s[2];
  const r2 = x * x + y * y + z * z, r = Math.sqrt(r2);
  const k = -MU / (r2 * r), q = 1.5 * J2 * RE * RE / r2, zz = 5 * z * z / r2;
  o[0] = s[3]; o[1] = s[4]; o[2] = s[5];
  o[3] = k * x * (1 + q * (1 - zz));
  o[4] = k * y * (1 + q * (1 - zz));
  o[5] = k * z * (1 + q * (3 - zz));
}

const k1 = new Float64Array(6), k2 = new Float64Array(6), k3 = new Float64Array(6),
  k4 = new Float64Array(6), tmp = new Float64Array(6);
function rk4(s, h) {
  deriv(s, k1);
  for (let i = 0; i < 6; i++) tmp[i] = s[i] + h / 2 * k1[i];
  deriv(tmp, k2);
  for (let i = 0; i < 6; i++) tmp[i] = s[i] + h / 2 * k2[i];
  deriv(tmp, k3);
  for (let i = 0; i < 6; i++) tmp[i] = s[i] + h * k3[i];
  deriv(tmp, k4);
  for (let i = 0; i < 6; i++) s[i] += h / 6 * (k1[i] + 2 * k2[i] + 2 * k3[i] + k4[i]);
}

export function propagate(state, dt) {
  const s = Float64Array.from(state);
  const n = Math.max(1, Math.ceil(Math.abs(dt) / 10)), h = dt / n;
  for (let i = 0; i < n; i++) rk4(s, h);
  return s;
}

// Ephemeris table from t0 to t1 (unix s) at `step` seconds. Rows of 6.
export function ephemeris(t0, t1, step = 10) {
  const n = Math.floor((t1 - t0) / step) + 1;
  const out = new Float64Array(n * 6);
  const s = propagate(STATE, t0 - EPOCH);
  for (let i = 0; i < n; i++) {
    out.set(s, i * 6);
    rk4(s, step);
  }
  return { t0, step, n, data: out };
}

// Cubic Hermite interpolation of the table. Returns [x,y,z,vx,vy,vz].
export function sample(eph, t, out = new Float64Array(6)) {
  let u = (t - eph.t0) / eph.step;
  u = Math.min(Math.max(u, 0), eph.n - 1 - 1e-9);
  const i = Math.floor(u), f = u - i, h = eph.step;
  const a = i * 6, b = a + 6, d = eph.data;
  const f2 = f * f, f3 = f2 * f;
  const h00 = 2 * f3 - 3 * f2 + 1, h10 = f3 - 2 * f2 + f, h01 = -2 * f3 + 3 * f2, h11 = f3 - f2;
  for (let k = 0; k < 3; k++) {
    out[k] = h00 * d[a + k] + h10 * h * d[a + 3 + k] + h01 * d[b + k] + h11 * h * d[b + 3 + k];
    out[3 + k] = d[a + 3 + k] + f * (d[b + 3 + k] - d[a + 3 + k]);
  }
  return out;
}

export function eciToEcef(p, unix) {
  const th = gmst(unix), c = Math.cos(th), s = Math.sin(th);
  return [c * p[0] + s * p[1], -s * p[0] + c * p[1], p[2]];
}

// WGS-84 geodetic latitude, longitude [deg] and height [m]
export function geodetic(e) {
  const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f);
  const p = Math.hypot(e[0], e[1]);
  let lat = Math.atan2(e[2], p * (1 - e2)), N = a;
  for (let i = 0; i < 5; i++) {
    N = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
    lat = Math.atan2(e[2] + e2 * N * Math.sin(lat), p);
  }
  const h = p / Math.cos(lat) - N;
  return { lat: lat * 180 / Math.PI, lon: Math.atan2(e[1], e[0]) * 180 / Math.PI, alt: h };
}

// Unit vector to the Sun in ECI (low-precision almanac formula)
export function sunDir(unix) {
  const n = unix / 86400 + 2440587.5 - 2451545.0, r = Math.PI / 180;
  const L = 280.460 + 0.9856474 * n, g = (357.528 + 0.9856003 * n) * r;
  const lam = (L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g)) * r;
  const eps = (23.439 - 4e-7 * n) * r;
  return [Math.cos(lam), Math.cos(eps) * Math.sin(lam), Math.sin(eps) * Math.sin(lam)];
}

// Summary of the orbit: inclination, nodal period, min and max height
export function summary() {
  const s = STATE;
  const hx = s[1] * s[5] - s[2] * s[4], hy = s[2] * s[3] - s[0] * s[5], hz = s[0] * s[4] - s[1] * s[3];
  const inc = Math.acos(hz / Math.hypot(hx, hy, hz)) * 180 / Math.PI;
  const eph = ephemeris(EPOCH, EPOCH + 4 * 3600, 5);
  const nodes = [];
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < eph.n; i++) {
    const t = eph.t0 + i * eph.step, d = eph.data, a = i * 6;
    if (i > 0 && d[a - 4] < 0 && d[a + 2] >= 0) {
      nodes.push(t - eph.step * d[a + 2] / (d[a + 2] - d[a - 4]));
    }
    if (nodes.length >= 1 && nodes.length < 2) {
      const g = geodetic(eciToEcef([d[a], d[a + 1], d[a + 2]], t));
      lo = Math.min(lo, g.alt); hi = Math.max(hi, g.alt);
    }
  }
  return { inc, period: nodes[1] - nodes[0], firstNode: nodes[0], minAlt: lo, maxAlt: hi };
}

// ---------- deorbit, entry and landing (planned timeline) ----------
export const BURN = LIFTOFF + 21 * 3600 + 35 * 60 + 57;  // deorbit burn start
export const ENTRY = LIFTOFF + 22 * 3600 + 10 * 60 + 46; // entry begins
export const LAND = LIFTOFF + 22 * 3600 + 32 * 60 + 34;  // tower catch
export const STARBASE = { lat: 25.9972, lon: -97.1554 };
const ENTRY_ALT = 100e3; // assumed height at the published entry time
const OMEGA = 7.2921150e-5;

export function geoToEcef(lat, lon, h) {
  const a = 6378137, f = 1 / 298.257223563, e2 = f * (2 - f), la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  const N = a / Math.sqrt(1 - e2 * Math.sin(la) ** 2);
  return [(N + h) * Math.cos(la) * Math.cos(lo), (N + h) * Math.cos(la) * Math.sin(lo), (N * (1 - e2) + h) * Math.sin(la)];
}
export function ecefToEci(e, unix) {
  const th = gmst(unix), c = Math.cos(th), s = Math.sin(th);
  return [c * e[0] - s * e[1], s * e[0] + c * e[1], e[2]];
}
// Speed relative to the rotating Earth [m/s]
export function groundSpeed(s) {
  return Math.hypot(s[3] + OMEGA * s[1], s[4] - OMEGA * s[0], s[5]);
}
function retro(s, dv) {
  const o = Float64Array.from(s), v = Math.hypot(s[3], s[4], s[5]);
  for (let i = 3; i < 6; i++) o[i] *= 1 - dv / v;
  return o;
}

let plan = null;
// Deorbit burn size (solved so the ship is at ENTRY_ALT at the published entry
// time) and the schematic entry path from there to the Starbase tower.
export function entryPlan() {
  if (plan) return plan;
  const atBurn = propagate(STATE, BURN + 5 - EPOCH);
  const altAtEntry = (dv) => geodetic(eciToEcef(propagate(retro(atBurn, dv), ENTRY - BURN - 5), ENTRY)).alt;
  let lo = 20, hi = 120;
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (altAtEntry(m) > ENTRY_ALT) lo = m; else hi = m; }
  const dv = (lo + hi) / 2;
  const afterBurn = retro(atBurn, dv);
  const sE = propagate(afterBurn, ENTRY - BURN - 5);
  const eE = eciToEcef(sE, ENTRY), gE = geodetic(eE);
  const surf0 = geoToEcef(gE.lat, gE.lon, 0), surf1 = geoToEcef(STARBASE.lat, STARBASE.lon, 0);
  const r0 = Math.hypot(...surf0), r1 = Math.hypot(...surf1);
  const u0 = surf0.map((x) => x / r0), u1 = surf1.map((x) => x / r1);
  const ang = Math.acos(u0[0] * u1[0] + u0[1] * u1[1] + u0[2] * u1[2]);
  const T = LAND - ENTRY, range = ang * 6371e3;
  const vg0 = groundSpeed(sE) * r0 / Math.hypot(...eE);
  // Glide: speed falls from vg0 to Mach 1 (300 m/s) three minutes before the
  // catch, as in the published timeline, then to zero in the final descent.
  const T2 = 180, T1 = T - T2, vS = 300, d2 = vS * T2 / 2, d1 = range - d2;
  const p = 1 / (1 - (d1 - vS * T1) / ((vg0 - vS) * T1)) - 1;
  plan = { dv, atBurn, afterBurn, gE, u0, u1, r0, r1, ang, T, T1, T2, vS, vg0, d1, d2, range, p, h0: gE.alt };
  return plan;
}
function entryEci(t) {
  const P = entryPlan(), dt = Math.min(Math.max(t - ENTRY, 0), P.T);
  let dist, h;
  if (dt <= P.T1) {
    const x = dt / P.T1;
    dist = P.vS * dt + (P.vg0 - P.vS) * P.T1 * (x - Math.pow(x, P.p + 1) / (P.p + 1));
    h = 20e3 + (P.h0 - 20e3) * Math.pow(1 - x, 1.4);
  } else {
    const y = (dt - P.T1) / P.T2;
    dist = P.d1 + P.vS * P.T2 * (y - y * y / 2);
    h = 20e3 * (1 - y) * (1 - 0.35 * y) / 1; // faster at first, slowing for the catch
  }
  const s = Math.min(dist / P.range, 1);
  const a = Math.sin((1 - s) * P.ang) / Math.sin(P.ang), b = Math.sin(s * P.ang) / Math.sin(P.ang);
  const r = P.r0 + (P.r1 - P.r0) * s + h;
  return ecefToEci([0, 1, 2].map((k) => (a * P.u0[k] + b * P.u1[k]) * r), t);
}

// Full state at any time from the fit epoch to after landing
export function missionState(t, from) {
  const P = entryPlan();
  if (t >= ENTRY) {
    const a = entryEci(t - 0.5), b = entryEci(t + 0.5), c = entryEci(t);
    return Float64Array.from([c[0], c[1], c[2], b[0] - a[0], b[1] - a[1], b[2] - a[2]]);
  }
  if (t >= BURN + 5) return propagate(P.afterBurn, t - BURN - 5);
  return from ? propagate(from.s, t - from.t) : propagate(STATE, t - EPOCH);
}

// Table from t0 through landing; same layout as ephemeris()
export function mission(t0, step = 10) {
  const n = Math.floor((LAND - t0) / step) + 3;
  const out = new Float64Array(n * 6);
  let cur = { s: propagate(STATE, t0 - EPOCH), t: t0 };
  for (let i = 0; i < n; i++) {
    const t = t0 + i * step;
    const s = missionState(t, cur);
    if (t < BURN + 5) cur = { s, t };
    out.set(s, i * 6);
  }
  return { t0, step, n, data: out };
}
