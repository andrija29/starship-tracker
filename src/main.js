import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import * as O from './orbit.js';
import { analyze, compass } from './observer.js';

const $ = (id) => document.getElementById(id);
const KM = 1 / 6378.137; // scene units per km (Earth radius = 1)
const STEP = 10;

// ---------- time window ----------
const nowUnix = Date.now() / 1000;
const live = nowUnix >= O.EPOCH && nowUnix < O.LAND - 300;
const W0 = live ? nowUnix : O.EPOCH;
const W1 = O.LAND;
const eph = O.mission(W0, STEP);
const sum = O.summary();

// ECI (x,y,z) -> scene (x, z, -y), so the north pole is +Y
const toScene = (p, v = new THREE.Vector3()) => v.set(p[0], p[2], -p[1]).multiplyScalar(KM / 1000);

// ---------- renderer ----------
const canvas = $('scene');
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e) {
  $('nogl').hidden = false;
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setClearColor(0x05070d);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 200);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.enablePan = false;
controls.minDistance = 1.25;
controls.maxDistance = 12;
controls.rotateSpeed = 0.5;

const root = new THREE.Group(); // inertial frame; counter-rotated for the Earth-fixed view
scene.add(root);

// stars
{
  const n = 1800, pos = new Float32Array(n * 3), col = new Float32Array(n * 3);
  let seed = 42;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < n; i++) {
    const z = rnd() * 2 - 1, a = rnd() * Math.PI * 2, r = Math.sqrt(1 - z * z), b = 0.35 + rnd() * 0.65;
    pos.set([r * Math.cos(a) * 90, z * 90, r * Math.sin(a) * 90], i * 3);
    col.set([b, b, b * (0.9 + rnd() * 0.2)], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  root.add(new THREE.Points(g, new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true })));
}

// Earth with day and night sides
const loader = new THREE.TextureLoader();
const tex = (url) => { const t = loader.load(url); t.anisotropy = 8; return t; };
const sunU = { value: new THREE.Vector3(1, 0, 0) };
const earth = new THREE.Mesh(
  new THREE.SphereGeometry(1, 128, 64),
  new THREE.ShaderMaterial({
    uniforms: { dayMap: { value: tex('day.jpg') }, nightMap: { value: tex('night.jpg') }, sun: sunU },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main(){ vUv=uv; vN=normalize(mat3(modelMatrix)*normal); vec4 w=modelMatrix*vec4(position,1.0); vP=w.xyz;
      gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform sampler2D dayMap; uniform sampler2D nightMap; uniform vec3 sun;
      varying vec2 vUv; varying vec3 vN; varying vec3 vP;
      void main(){ vec3 n=normalize(vN); float d=dot(n,sun);
      vec3 day=texture2D(dayMap,vUv).rgb; vec3 night=texture2D(nightMap,vUv).rgb;
      float k=smoothstep(-0.12,0.18,d);
      vec3 lit=day*(0.42+0.68*clamp(d,0.0,1.0));
      vec3 dark=day*0.10+night*vec3(1.25,1.05,0.8);
      vec3 c=mix(dark,lit,k);
      float rim=pow(1.0-max(dot(n,normalize(cameraPosition-vP)),0.0),3.0);
      c+=vec3(0.25,0.45,0.85)*rim*(0.25+0.75*k);
      gl_FragColor=vec4(c,1.0); }`,
  }),
);
root.add(earth);

// thin atmosphere halo
root.add(new THREE.Mesh(
  new THREE.SphereGeometry(1.035, 96, 48),
  new THREE.ShaderMaterial({
    uniforms: { sun: sunU },
    transparent: true, side: THREE.BackSide, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `varying vec3 vN; varying vec3 vP; void main(){ vN=normalize(mat3(modelMatrix)*normal);
      vec4 w=modelMatrix*vec4(position,1.0); vP=w.xyz; gl_Position=projectionMatrix*viewMatrix*w; }`,
    fragmentShader: `uniform vec3 sun; varying vec3 vN; varying vec3 vP;
      void main(){ vec3 n=normalize(vN); float f=pow(max(dot(n,normalize(vP-cameraPosition)),0.0),4.0);
      float s=0.25+0.75*smoothstep(-0.3,0.3,dot(n,sun));
      gl_FragColor=vec4(vec3(0.3,0.55,1.0)*f*s*0.9,1.0); }`,
  }),
));

// ---------- paths ----------
const N = eph.n;
const orbitPts = new Float32Array(N * 3), trackPts = new Float32Array(N * 3);
const v = new THREE.Vector3();
for (let i = 0; i < N; i++) {
  const t = eph.t0 + i * STEP, d = eph.data, a = i * 6;
  const p = [d[a], d[a + 1], d[a + 2]];
  toScene(p, v).toArray(orbitPts, i * 3);
  toScene(O.eciToEcef(p, t), v).normalize().multiplyScalar(1.004).toArray(trackPts, i * 3);
}
const lineMats = [];
function fatLine(pts, color, width, opacity) {
  const g = new LineGeometry();
  g.setPositions(pts);
  const m = new LineMaterial({ color, linewidth: width, transparent: true, opacity, depthWrite: false });
  lineMats.push(m);
  return new Line2(g, m);
}
const orbitLine = fatLine(orbitPts, 0x7fb4ff, 1.4, 0.55);
root.add(orbitLine);
const trackAhead = fatLine(trackPts, 0xffb347, 1.5, 0.38);
const trackDone = fatLine(trackPts, 0xffc76b, 3, 1);
earth.add(trackAhead, trackDone);

// Sun line: the day/night boundary, a great circle facing the Sun
const sunLine = (() => {
  const pts = new Float32Array(361 * 3);
  for (let i = 0; i <= 360; i++) {
    const a = i * Math.PI / 180;
    pts.set([Math.cos(a) * 1.007, Math.sin(a) * 1.007, 0], i * 3);
  }
  const g = new LineGeometry();
  g.setPositions(pts);
  const m = new LineMaterial({ color: 0xffffff, linewidth: 2, transparent: true, opacity: 0.85, depthWrite: false,
    dashed: true, dashSize: 0.035, gapSize: 0.02 });
  lineMats.push(m);
  const l = new Line2(g, m);
  l.computeLineDistances();
  return l;
})();
root.add(sunLine);
const Z_AXIS = new THREE.Vector3(0, 0, 1), sunLocal = new THREE.Vector3();

// Times when the ship crosses into or out of Earth's shadow
const shadowAt = (p, t) => {
  const s = O.sunDir(t), d = p[0] * s[0] + p[1] * s[1] + p[2] * s[2];
  return d < 0 && p[0] * p[0] + p[1] * p[1] + p[2] * p[2] - d * d < O.RE * O.RE;
};
const crossings = [];
{
  let prev = null;
  for (let i = 0; i < N; i++) {
    const t = eph.t0 + i * STEP, a = i * 6;
    const dark = shadowAt([eph.data[a], eph.data[a + 1], eph.data[a + 2]], t);
    if (prev !== null && dark !== prev && t <= W1) crossings.push({ t: t - STEP / 2, dark });
    prev = dark;
  }
}

// ---------- markers ----------
function dotTexture(inner, outer) {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const x = c.getContext('2d');
  const g = x.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner); g.addColorStop(0.16, inner); g.addColorStop(0.3, outer); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}
const ship = new THREE.Sprite(new THREE.SpriteMaterial({
  map: dotTexture('#ffffff', 'rgba(255,184,77,0.55)'), sizeAttenuation: false, depthWrite: false, transparent: true,
}));
ship.scale.setScalar(0.055);
root.add(ship);

const nadirGeo = new THREE.BufferGeometry();
nadirGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
root.add(new THREE.Line(nadirGeo, new THREE.LineBasicMaterial({ color: 0xffc76b, transparent: true, opacity: 0.7 })));

const groundDot = new THREE.Sprite(new THREE.SpriteMaterial({
  map: dotTexture('#ffc76b', 'rgba(255,184,77,0.25)'), sizeAttenuation: false, depthWrite: false, transparent: true,
}));
groundDot.scale.setScalar(0.022);
root.add(groundDot);

const sunDot = new THREE.Sprite(new THREE.SpriteMaterial({
  map: dotTexture('#ffffff', 'rgba(255,240,170,0.6)'), sizeAttenuation: false, depthWrite: false, transparent: true,
}));
sunDot.scale.setScalar(0.04);
root.add(sunDot);

// Starbase, Texas (launch and planned catch site)
const base = new THREE.Sprite(new THREE.SpriteMaterial({
  map: dotTexture('#8fe3ff', 'rgba(90,200,255,0.35)'), sizeAttenuation: false, depthWrite: false, transparent: true,
}));
base.scale.setScalar(0.024);
{
  const la = 25.9972 * Math.PI / 180, lo = -97.1554 * Math.PI / 180;
  base.position.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)).multiplyScalar(1.006);
}
earth.add(base);

// ---------- state ----------
let simT = W0, playing = true, speed = 1, view = 'follow', sync = live;
let lastFrame = performance.now(), followBlend = 1;
const st = new Float64Array(6);
const shipPos = new THREE.Vector3(), tmpV = new THREE.Vector3(), sunV = new THREE.Vector3();

// start camera above the ship's first position
O.sample(eph, W0, st);
toScene(st, shipPos);
camera.position.copy(shipPos).normalize().multiplyScalar(3.4);
camera.position.y += 0.9;
controls.update();

// ---------- HUD ----------
const pad = (n, w = 2) => String(Math.floor(Math.abs(n))).padStart(w, '0');
const hms = (s) => `${pad(s / 3600)}:${pad((s % 3600) / 60)}:${pad(s % 60)}`;
const fmtUTC = (u) => new Date(u * 1000).toISOString().slice(11, 19);
const localFmt = new Intl.DateTimeFormat([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
const dayFmt = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const el = {};
for (const id of ['phase', 'next', 'toLand', 'utc', 'local', 'met', 'lat', 'lon', 'alt', 'spd', 'rev', 'light', 'lightDot', 'over',
  'tStart', 'tEnd', 'scrub', 'play', 'ticks', 'shipLabel', 'baseLabel', 'sunLabel', 'summary', 'note', 'windowLabel']) el[id] = $(id);

el.summary.innerHTML =
  `<div><dt>Altitude</dt><dd>${(sum.minAlt / 1000).toFixed(0)} × ${(sum.maxAlt / 1000).toFixed(0)} km</dd></div>` +
  `<div><dt>Inclination</dt><dd>${sum.inc.toFixed(1)}°</dd></div>` +
  `<div><dt>Period</dt><dd>${(sum.period / 60).toFixed(1)} min</dd></div>` +
  `<div><dt>Planned catch</dt><dd>${fmtUTC(O.LAND)} UTC</dd></div>`;
const span = (W1 - W0) / 3600;
el.windowLabel.textContent = live
  ? `From now to the planned tower catch, ${span.toFixed(1)} h away`
  : 'Replay from the telemetry fix to the planned tower catch';
if (!live) {
  el.note.hidden = false;
  el.note.textContent = nowUnix >= O.LAND - 300
    ? 'The planned landing time has passed, so this replays the flight from the telemetry fix on 14 Nov, 00:37 UTC.'
    : 'Your clock is earlier than the telemetry fix, so this starts at the fix (14 Nov, 00:37 UTC).';
}
el.tStart.textContent = `${fmtUTC(W0).slice(0, 5)} UTC`;
el.tEnd.textContent = `${fmtUTC(W1).slice(0, 5)} UTC`;
el.scrub.max = String(Math.round(W1 - W0));
const events = [
  { t: O.LIFTOFF + 26135, label: 'Mid-mission return check (Chile)' },
  { t: O.LIFTOFF + 74515, label: 'Final return check (Hawaii)' },
  { t: O.BURN, label: 'Deorbit burn' },
  { t: O.ENTRY, label: 'Reentry begins' },
  { t: O.LAND, label: 'Tower catch at Starbase' },
];
function phase(t) {
  if (t < O.BURN) return 'Coasting in orbit';
  if (t < O.BURN + 10) return 'Deorbit burn';
  if (t < O.ENTRY) return 'Falling toward reentry';
  if (t < O.LAND - 18) return 'Reentry and glide';
  if (t < O.LAND) return 'Landing burn';
  return 'Caught by the tower';
}
for (const ev of events) {
  const t = ev.t;
  if (t <= W0 || t >= W1) continue;
  const m = document.createElement('span');
  m.className = 'tick';
  m.style.left = `${((t - W0) / (W1 - W0)) * 100}%`;
  m.innerHTML = `<i></i><b>${ev.label}<br>${fmtUTC(t).slice(0, 5)} UTC</b>`;
  if ((t - W0) / (W1 - W0) > 0.8) m.classList.add('right');
  el.ticks.appendChild(m);
}

const REGIONS = [ // coarse boxes, good enough for a one-word readout
  ['North America', 15, 72, -168, -52], ['South America', -56, 13, -82, -34], ['Africa', -35, 37, -18, 52],
  ['Europe', 36, 71, -10, 40], ['Asia', 5, 77, 40, 180], ['Australia', -44, -10, 112, 154],
];
function over(lat, lon) {
  for (const [n, a, b, c, d] of REGIONS) if (lat >= a && lat <= b && lon >= c && lon <= d) return n;
  if (lon > -70 && lon < 20) return 'Atlantic Ocean';
  if (lon >= 20 && lon < 120 && lat < 25) return 'Indian Ocean';
  return 'Pacific Ocean';
}

function setPlaying(p) {
  playing = p;
  el.play.textContent = p ? 'Pause' : 'Play';
  el.play.setAttribute('aria-pressed', String(p));
}
el.play.addEventListener('click', () => {
  if (!playing && simT >= W1 - 1) simT = W0;
  if (playing) sync = false;
  setPlaying(!playing);
});
el.scrub.addEventListener('input', () => { simT = W0 + Number(el.scrub.value); sync = false; });
for (const b of document.querySelectorAll('[data-speed]')) {
  b.addEventListener('click', () => {
    speed = Number(b.dataset.speed);
    document.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    sync = speed === 1 && Date.now() / 1000 > W0 && Date.now() / 1000 < W1;
    setPlaying(true);
  });
}
for (const b of document.querySelectorAll('[data-view]')) {
  b.addEventListener('click', () => {
    setView(b.dataset.view);
  });
}
function setView(v) {
  // the Earth-fixed view counter-rotates the scene, so turn the camera with it to avoid a jump
  const th = O.gmst(simT), Y = new THREE.Vector3(0, 1, 0);
  if (v === 'fixed' && view !== 'fixed') camera.position.applyAxisAngle(Y, -th);
  if (v !== 'fixed' && view === 'fixed') camera.position.applyAxisAngle(Y, th);
  view = v;
  document.querySelectorAll('[data-view]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.view === v)));
  if (view === 'follow') followBlend = 0;
}
$('showOrbit').addEventListener('change', (e) => { orbitLine.visible = e.target.checked; });
$('showSun').addEventListener('change', (e) => {
  sunLine.visible = sunDot.visible = e.target.checked;
  el.sunLabel.style.display = e.target.checked ? '' : 'none';
});
$('showTrack').addEventListener('change', (e) => { trackAhead.visible = trackDone.visible = e.target.checked; });

// ---------- "I'm here": observer location, closest approach, visibility ----------
const you = new THREE.Sprite(new THREE.SpriteMaterial({
  map: dotTexture('#ffffff', 'rgba(120,255,170,0.55)'), sizeAttenuation: false, depthWrite: false, transparent: true,
}));
you.scale.setScalar(0.03);
you.visible = false;
earth.add(you);
const ui = {};
for (const id of ['here', 'pickBanner', 'pickCancel', 'obs', 'youLabel']) ui[id] = $(id);
let picking = false, viewBeforePick = 'follow', observer = null, youTick = null;
const localDT = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', hour12: false });

function setPicking(on) {
  picking = on;
  ui.pickBanner.hidden = !on;
  canvas.style.cursor = on ? 'crosshair' : '';
  ui.here.hidden = on;
  if (on) { viewBeforePick = view; setView('fixed'); } else setView(viewBeforePick);
}
ui.here.addEventListener('click', () => setPicking(!picking));
ui.pickCancel.addEventListener('click', () => setPicking(false));

let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
// dragging the globe while following the ship hands control to the user in the Earth-fixed view
// (listening on window in the capture phase so nothing can swallow the move events)
window.addEventListener('pointermove', (e) => {
  if (view === 'follow' && downAt && Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4) setView('fixed');
}, true);
const endDrag = () => { setTimeout(() => { downAt = null; }, 0); };
window.addEventListener('pointerup', endDrag, true);
window.addEventListener('pointercancel', endDrag, true);
canvas.addEventListener('pointerup', (e) => {
  if (!picking || !downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return;
  const r = canvas.getBoundingClientRect();
  const ray = new THREE.Raycaster();
  ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
  const hit = ray.intersectObject(earth, false)[0];
  if (!hit) return;
  const p = earth.worldToLocal(hit.point.clone()).normalize();
  // the globe is drawn as a sphere, so p.y gives geocentric latitude; convert to geodetic
  const lat = Math.atan(Math.tan(Math.asin(p.y)) / (1 - 0.00669438)) * 180 / Math.PI;
  const lon = Math.atan2(-p.z, p.x) * 180 / Math.PI;
  setPicking(false);
  setObserver(lat, lon, true);
});

function whyNot(p) {
  if (p.why === 'low') return `it climbs only ${Math.max(0, p.max.el).toFixed(0)}° above your horizon`;
  if (p.why === 'day') return 'it passes in daylight';
  if (p.why === 'twilight') return 'your sky is still too bright (twilight)';
  return 'the ship is in Earth’s shadow, so it reflects no sunlight';
}

function setObserver(lat, lon, save) {
  observer = analyze(eph, lat, lon, W0, O.LAND);
  const la = lat * Math.PI / 180, lo = lon * Math.PI / 180;
  you.position.set(Math.cos(la) * Math.cos(lo), Math.sin(la), -Math.cos(la) * Math.sin(lo)).multiplyScalar(1.006);
  you.visible = true;
  ui.youLabel.style.display = '';
  if (save) { try { localStorage.setItem('observer', JSON.stringify([lat, lon])); } catch (e) { /* storage unavailable */ } }

  const c = observer.closest, b = observer.best, hi = observer.highest;
  const skyWord = { day: 'Daytime', twilight: 'Twilight', night: 'Night' }[c.sky];
  let verdict, cls, detail;
  if (b) {
    cls = 'yes';
    verdict = observer.visibleCount > 1 ? `Visible on ${observer.visibleCount} passes` : 'Visible';
    const weak = b.visMax.el < 20 || b.visSec < 60;
    detail = `Best pass ${fmtUTC(b.visStart.t)} to ${fmtUTC(b.visEnd.t + 10)} UTC (${localDT.format(b.visMax.t * 1000)} on your clock). ` +
      `Look ${compass(b.visMax.az)}, about ${b.visMax.el.toFixed(0)}° above the horizon` +
      (compass(b.visStart.az) !== compass(b.visEnd.az) ? `; it moves from ${compass(b.visStart.az)} to ${compass(b.visEnd.az)}. ` : '. ') +
      (weak ? 'It is low and brief, so you need a clear horizon.' : 'It should look like a bright star moving steadily across the sky.');
  } else if (!hi) {
    cls = 'no';
    verdict = 'Not visible';
    detail = `The ship never rises above your horizon. Its orbit stays between ${sum.inc.toFixed(1)}° north and south.`;
  } else {
    cls = 'no';
    verdict = 'Not visible';
    detail = `${observer.passes.length} pass${observer.passes.length > 1 ? 'es' : ''} above your horizon before landing, none you can see. ` +
      `On the highest one (${fmtUTC(hi.max.t).slice(0, 5)} UTC) ${whyNot(hi)}.`;
  }
  const cWhy = c.el < 10 ? 'it is too low in your sky' : c.sunEl > -6 ? 'your sky is too bright' : 'the ship is in Earth’s shadow';
  const cNote = b && !c.visible ? ` At that moment ${cWhy}, so watch the top-ranked pass instead.` : '';
  const cWhere = c.el < 0 ? `${Math.abs(c.el).toFixed(0)}° below your horizon` : `${c.el.toFixed(0)}° above your horizon toward ${compass(c.az)}`;
  const clock = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false });
  const sight = (p) => (p.visible ? `Visible, ${p.visSec >= 60 ? `${Math.round(p.visSec / 60)} min` : `${p.visSec} s`}`
    : { low: 'Too low', day: 'Daylight', twilight: 'Sky too bright', shadow: 'Ship in shadow' }[p.why]);
  const skyName = { day: 'Day', twilight: 'Twilight', night: 'Night' };
  const rows = observer.ranked.map((p, i) => {
    const isClosest = c.t >= p.start.t - 10 && c.t <= p.end.t + 10;
    const t = p.visible ? p.visMax.t : isClosest ? c.t : p.near.t;
    return `<tr data-t="${t}" tabindex="0" class="${p.visible ? 'vis' : ''}"><td>${i + 1}</td>` +
      `<td>${fmtUTC(t).slice(0, 5)}</td><td>${clock.format(t * 1000)}</td>` +
      `<td>${Math.round(p.near.range / 1000).toLocaleString('en-GB')} km${isClosest ? ' <em>closest</em>' : ''}</td>` +
      `<td>${Math.max(0, p.max.el).toFixed(0)}° ${compass(p.max.az)}</td>` +
      `<td><span class="sky ${p.sky}"></span>${skyName[p.sky]}</td><td>${sight(p)}</td></tr>`;
  }).join('');
  ui.obs.hidden = false;
  ui.obs.innerHTML =
    `<div class="obshead"><span>You: ${Math.abs(lat).toFixed(2)}° ${lat >= 0 ? 'N' : 'S'}, ${Math.abs(lon).toFixed(2)}° ${lon >= 0 ? 'E' : 'W'}</span>` +
    '<button type="button" id="obsClear" aria-label="Remove my location">Remove</button></div>' +
    `<div class="verdict ${cls}"><i></i>${verdict}</div>` +
    `<p>${detail}</p>` +
    `<p class="soft">Closest approach: ${fmtUTC(c.t)} UTC (${localDT.format(c.t * 1000)} on your clock), ` +
    `${Math.round(c.range / 1000).toLocaleString('en-GB')} km away, ${cWhere}. Your sky then: ${skyWord.toLowerCase()}.${cNote}</p>` +
    (rows ? '<div class="tablewrap"><table><caption>Passes over your horizon, best sighting first</caption>' +
      '<thead><tr><th>#</th><th>UTC</th><th>Your clock</th><th>Nearest</th><th>Highest</th><th>Your sky</th><th>Sighting</th></tr></thead>' +
      `<tbody>${rows}</tbody></table></div>` : '') +
    '<div class="obsbtns"><button type="button" id="obsGo">Show closest approach</button>' +
    '<button type="button" id="obsLive">Back to live</button></div>';
  const jump = (t) => {
    simT = t; sync = false; setPlaying(false); setView('fixed');
    // in the Earth-fixed view the scene axes are the Earth's, so this puts the camera above the observer
    const dist = Math.max(camera.position.length(), 2.6);
    camera.position.copy(you.position).normalize().multiplyScalar(dist);
    ui.obs.querySelectorAll('tr[data-t]').forEach((r) => r.classList.toggle('sel', Math.abs(Number(r.dataset.t) - t) < 1));
  };
  $('obsGo').addEventListener('click', () => jump(c.t));
  $('obsLive').addEventListener('click', () => {
    speed = 1; sync = live; if (!live) simT = W0;
    document.querySelectorAll('[data-speed]').forEach((x) => x.setAttribute('aria-pressed', String(x.dataset.speed === '1')));
    setPlaying(true); setView('follow');
    ui.obs.querySelectorAll('tr.sel').forEach((r) => r.classList.remove('sel'));
  });
  ui.obs.querySelectorAll('tr[data-t]').forEach((r) => {
    const go = () => jump(Number(r.dataset.t));
    r.addEventListener('click', go);
    r.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
  });
  $('obsClear').addEventListener('click', clearObserver);
  ui.here.querySelector('b').textContent = 'Change my location';
  if (save) jump(c.t); // a fresh pick goes straight to the closest approach

  if (youTick) youTick.remove();
  youTick = document.createElement('span');
  youTick.className = 'tick you';
  youTick.style.left = `${((c.t - W0) / (W1 - W0)) * 100}%`;
  youTick.innerHTML = `<i></i><b>Closest to you<br>${fmtUTC(c.t).slice(0, 5)} UTC</b>`;
  if ((c.t - W0) / (W1 - W0) > 0.8) youTick.classList.add('right');
  el.ticks.appendChild(youTick);
}
function clearObserver() {
  observer = null;
  you.visible = false;
  ui.youLabel.style.display = 'none';
  ui.obs.hidden = true;
  if (youTick) { youTick.remove(); youTick = null; }
  ui.here.querySelector('b').textContent = 'Find best sighting opportunities';
  try { localStorage.removeItem('observer'); } catch (e) { /* storage unavailable */ }
}
ui.youLabel.style.display = 'none';
try {
  const saved = JSON.parse(localStorage.getItem('observer') || 'null');
  if (Array.isArray(saved) && saved.length === 2 && saved.every(Number.isFinite)) setObserver(saved[0], saved[1], false);
} catch (e) { /* storage unavailable */ }

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.fov = w < h ? 52 : 38;
  camera.updateProjectionMatrix();
  for (const m of lineMats) m.resolution.set(w, h);
}
new ResizeObserver(resize).observe(canvas);
resize();

function place(label, world, hiddenBehind) {
  tmpV.copy(world).project(camera);
  // hidden if the Earth blocks the line of sight
  const toCam = camera.position.clone().sub(world), L = toCam.length();
  toCam.divideScalar(L);
  const b = world.dot(toCam), disc = b * b - (world.lengthSq() - 0.98);
  const blocked = hiddenBehind && disc > 0 && -b + Math.sqrt(disc) > 0 && -b - Math.sqrt(disc) < L && b < 0;
  if (blocked || tmpV.z > 1) { label.style.opacity = '0'; return; }
  label.style.opacity = '1';
  label.style.transform =
    `translate(${((tmpV.x + 1) / 2) * canvas.clientWidth}px, ${((1 - tmpV.y) / 2) * canvas.clientHeight}px)`;
}

let hudClock = 0;
function frame(now) {
  const dt = Math.max(0, Math.min((now - lastFrame) / 1000, 0.1));
  lastFrame = now;
  if (playing) {
    if (sync && speed === 1) simT = Math.min(Math.max(Date.now() / 1000, W0), W1);
    else simT += dt * speed;
    if (simT >= W1) { simT = W1; setPlaying(false); }
  }

  const th = O.gmst(simT);
  earth.rotation.y = th;
  root.rotation.y = view === 'fixed' ? -th : 0;
  root.updateMatrixWorld(true);

  O.sample(eph, simT, st);
  toScene(st, shipPos);
  ship.position.copy(shipPos);
  groundDot.position.copy(shipPos).normalize().multiplyScalar(1.005);
  const np = nadirGeo.attributes.position;
  np.setXYZ(0, shipPos.x, shipPos.y, shipPos.z);
  np.setXYZ(1, groundDot.position.x, groundDot.position.y, groundDot.position.z);
  np.needsUpdate = true;

  const done = Math.max(1, Math.min(N - 1, Math.floor((simT - W0) / STEP)));
  trackDone.geometry.instanceCount = done;

  const s = O.sunDir(simT);
  sunLocal.set(s[0], s[2], -s[1]);
  sunLine.quaternion.setFromUnitVectors(Z_AXIS, sunLocal);
  sunDot.position.copy(sunLocal).multiplyScalar(1.008);
  sunV.copy(sunLocal).applyQuaternion(root.quaternion);
  sunU.value.copy(sunV);

  const shipWorld = shipPos.clone().applyQuaternion(root.quaternion);
  if (view === 'follow') {
    const dist = camera.position.length();
    const want = shipWorld.clone().normalize();
    want.y += 0.28;
    want.normalize().multiplyScalar(dist);
    followBlend = Math.min(1, followBlend + dt / 0.7);
    camera.position.lerp(want, followBlend * followBlend).setLength(dist);
  }
  controls.update();
  renderer.render(scene, camera);

  place(el.shipLabel, shipWorld, true);
  place(el.sunLabel, sunDot.position.clone().applyQuaternion(root.quaternion), true);
  if (you.visible) place(ui.youLabel, you.getWorldPosition(new THREE.Vector3()), true);
  place(el.baseLabel, base.getWorldPosition(new THREE.Vector3()), true);

  if (now - hudClock > 90) {
    hudClock = now;
    const g = O.geodetic(O.eciToEcef(st, simT));
    el.utc.textContent = fmtUTC(simT);
    el.local.textContent = `${dayFmt.format(simT * 1000)} · ${localFmt.format(simT * 1000)} local`;
    el.met.textContent = `T+${hms(simT - O.LIFTOFF)}`;
    el.lat.textContent = `${Math.abs(g.lat).toFixed(2)}° ${g.lat >= 0 ? 'N' : 'S'}`;
    el.lon.textContent = `${Math.abs(g.lon).toFixed(2)}° ${g.lon >= 0 ? 'E' : 'W'}`;
    el.alt.textContent = `${(g.alt / 1000).toFixed(1)} km`;
    el.alt.textContent = `${((simT >= O.LAND ? 0 : Math.max(g.alt, 0)) / 1000).toFixed(1)} km`;
    el.spd.textContent = `${(simT >= O.LAND ? 0 : O.groundSpeed(st) * 3.6).toFixed(0)} km/h`;
    el.rev.textContent = `${Math.floor((Math.min(simT, O.ENTRY) - (O.LIFTOFF + 1590)) / sum.period) + 1}`;
    el.phase.textContent = phase(simT);
    el.toLand.textContent = simT >= O.LAND ? 'Landed' : `Catch in ${hms(O.LAND - simT)}`;
    const nx = events.find((e) => e.t > simT);
    el.next.textContent = nx ? `Next: ${nx.label}, ${fmtUTC(nx.t)} UTC` : 'Planned flight complete';
    const d = st[0] * s[0] + st[1] * s[1] + st[2] * s[2];
    const perp = Math.sqrt(Math.max(0, st[0] * st[0] + st[1] * st[1] + st[2] * st[2] - d * d));
    const dark = d < 0 && perp < O.RE;
    el.light.textContent = dark ? 'In Earth’s shadow' : 'In sunlight';
    el.lightDot.dataset.state = dark ? 'dark' : 'sun';
    const cx = crossings.find((c) => c.t > simT);
    el.over.textContent = cx ? `${cx.dark ? 'sunset' : 'sunrise'} in ${hms(cx.t - simT).slice(3)}` : '';
    if (document.activeElement !== el.scrub) el.scrub.value = String(Math.round(simT - W0));
    el.scrub.style.setProperty('--p', `${((simT - W0) / (W1 - W0)) * 100}%`);
  }
  requestAnimationFrame(frame);
}
setPlaying(playing);
requestAnimationFrame(frame);
window.__setObserver = setObserver;
window.__viz = { get observer() { return observer; }, get simT() { return simT; }, set simT(x) { simT = x; }, W0, W1, live };
