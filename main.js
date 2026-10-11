/**
 * Gallina Prófuga VR — eres una gallina en una granja y el granjero quiere degollarte.
 * Estilo "I Am Cat": misiones de caos (popó a la gente, tirar cubetas, picotear al cerdo…)
 * y niveles con dificultad creciente. WebXR para Meta Quest 3 / 3S + modo escritorio.
 * Three.js r180 se carga desde el CDN fijado en index.html. Sin assets externos.
 */
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const CFG = {
  walkSpeed: 2.7, gravity: 7.5, flapVel: 3.95, maxFlaps: 3,
  radius: 0.22, height: 0.42, eyeHeight: 0.4,
  vrScale: 0.26,              // en VR el jugador se encoge: así el granjero se ve gigante
  poopCooldown: 0.4, maxPoop: 5, poopRegen: 9, startPoop: 3,
  catchRadius: 0.8, lives: 3, peckRange: 1.15, yard: 17.6,
};
const STORAGE_KEY = 'gallina-profuga-vr-best-v1';
const COOP = { x: 12, z: 9 };
const PEN = { x: -10, z: 9, half: 3 };

const $ = (id) => document.getElementById(id);
const ui = {
  interface: $('interface'), play: $('playButton'), results: $('results'), subtitle: $('panelSubtitle'),
  level: $('levelLabel'), lives: $('livesLabel'), score: $('scoreLabel'), poop: $('poopLabel'),
  missions: $('missionList'), banner: $('banner'), hint: $('hint'), pause: $('pause'), flash: $('flash'), best: $('bestText'),
};

// ---------------------------------------------------------------- renderer / escena / rig
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.domElement.className = 'webgl';
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fd3ff);
scene.fog = new THREE.Fog(0x9fd8ff, 28, 95);
scene.add(new THREE.HemisphereLight(0xcfe9ff, 0x4f7a2f, 1.15));
const sun = new THREE.DirectionalLight(0xfff1d0, 2.3);
sun.position.set(20, 32, 12);
scene.add(sun);

// El rig "player" lleva la cámara (y los controles en VR). Su posición es la de las patas.
const player = new THREE.Group();
scene.add(player);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 160);
camera.position.set(0, CFG.eyeHeight, 0);
player.add(camera);

// ---------------------------------------------------------------- audio sintetizado
let actx = null;
function audio() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch { /* sin audio */ } }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function tone(freq, dur, type = 'square', vol = 0.05, slide = 0, delay = 0) {
  const ac = audio(); if (!ac) return;
  const t = ac.currentTime + delay;
  const o = ac.createOscillator(), g = ac.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t);
  if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ac.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.05, freq = 900) {
  const ac = audio(); if (!ac) return;
  const n = Math.floor(ac.sampleRate * dur), buf = ac.createBuffer(1, n, ac.sampleRate), d = buf.getChannelData(0);
  for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
  const s = ac.createBufferSource(), f = ac.createBiquadFilter(), g = ac.createGain();
  s.buffer = buf; f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = vol;
  s.connect(f).connect(g).connect(ac.destination); s.start();
}
const sfx = {
  cluck() { tone(520, 0.08, 'square', 0.04, 300); tone(700, 0.1, 'square', 0.03, -250, 0.07); },
  flap() { noise(0.14, 0.06, 500); },
  plop() { tone(240, 0.12, 'sine', 0.06, -160); },
  splat() { noise(0.2, 0.1, 350); tone(130, 0.22, 'sawtooth', 0.05, -70); },
  eat() { tone(880, 0.05, 'square', 0.04, 200); tone(1100, 0.06, 'square', 0.04, 200, 0.06); },
  peck() { tone(900, 0.04, 'square', 0.05, -400); },
  bonk() { tone(180, 0.15, 'triangle', 0.07, -100); },
  grunt() { tone(120, 0.25, 'sawtooth', 0.06, 40); tone(95, 0.2, 'sawtooth', 0.05, 20, 0.2); },
  yell() { tone(300, 0.3, 'sawtooth', 0.07, -120); },
  scream() { tone(900, 0.35, 'sawtooth', 0.05, 500); },
  caught() { [220, 180, 140, 90].forEach((f, i) => tone(f, 0.26, 'sawtooth', 0.08, -30, i * 0.14)); },
  level() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.2, 'triangle', 0.07, 0, i * 0.11)); },
  done() { tone(1200, 0.08, 'triangle', 0.05); tone(1600, 0.12, 'triangle', 0.05, 0, 0.08); },
  tick() { tone(1500, 0.03, 'sine', 0.03); },
};

// ---------------------------------------------------------------- constructores de geometría
const matCache = new Map();
const mat = (color) => { let m = matCache.get(color); if (!m) { m = new THREE.MeshLambertMaterial({ color }); matCache.set(color, m); } return m; };
function box(w, h, d, color, x, y, z, parent = scene) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color)); m.position.set(x, y + h / 2, z); parent.add(m); return m;
}
function cyl(rt, rb, h, color, x, y, z, parent = scene, seg = 10) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color)); m.position.set(x, y + h / 2, z); parent.add(m); return m;
}
function sph(r, color, x, y, z, parent = scene, seg = 10) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)), mat(color)); m.position.set(x, y, z); parent.add(m); return m;
}
function cone(r, h, color, x, y, z, parent = scene, seg = 8) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(color)); m.position.set(x, y + h / 2, z); parent.add(m); return m;
}

// Obstáculos: cajas alineadas a los ejes. El jugador choca con ellas y puede pararse encima.
const obstacles = [];
function block(x, z, w, h, d, tag, y0 = 0) {
  const o = { min: new THREE.Vector3(x - w / 2, y0, z - d / 2), max: new THREE.Vector3(x + w / 2, y0 + h, z + d / 2), tag };
  obstacles.push(o); return o;
}
const peckables = [];
const anims = [];
function animate(dur, fn, done) { anims.push({ t: 0, dur, fn, done }); }
const ease = (k) => 1 - Math.pow(1 - k, 3);

// ---------------------------------------------------------------- la granja
const C = {
  grass: 0x6fae3d, dirt: 0xa77b4a, wood: 0x8a5a2b, woodLight: 0xb98954, barn: 0xb8352c, roof: 0x5c3a28,
  hay: 0xe3c35a, hayDark: 0xc9a63f, metal: 0x9aa4ad, skin: 0xf1c7a0, denim: 0x3a5f9e, shirt: 0xd94f3b,
  hat: 0xd9b36b, pink: 0xf4a8b8, white: 0xfafafa, red: 0xd63a2f, yellow: 0xf2c230, orange: 0xf08a24,
  leaf: 0x3f8f3a, trunk: 0x6b4423, dress: 0x7f4fb0, apron: 0xfff1d6, poop: 0x5a3b1f, corn: 0xffd43b,
  cornLeaf: 0x5aa84a, bucket: 0x7c8a95, stone: 0x8d8d8d, dark: 0x2a2a2a, cloud: 0xffffff, sky: 0x8fd3ff,
};
const buckets = [];
let scarecrow = null;

function buildFarm() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(C.grass));
  ground.rotation.x = -Math.PI / 2; scene.add(ground);
  const yard = new THREE.Mesh(new THREE.CircleGeometry(16, 28), mat(C.dirt));
  yard.rotation.x = -Math.PI / 2; yard.position.set(0, 0.01, -2); scene.add(yard);
  for (let i = 0; i < 40; i++) {
    const p = new THREE.Mesh(new THREE.CircleGeometry(0.4 + Math.random() * 1.2, 8), mat(C.grass));
    p.rotation.x = -Math.PI / 2; p.position.set((Math.random() - 0.5) * 30, 0.02, (Math.random() - 0.5) * 30 - 2); scene.add(p);
  }

  // Cerca perimetral (visual) + paredes invisibles altas para que la gallina no escape volando.
  const Y = CFG.yard;
  const fenceLine = (x1, z1, x2, z2) => {
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz), n = Math.round(len / 2.5);
    for (let i = 0; i <= n; i++) box(0.14, 1.1, 0.14, C.wood, x1 + dx * i / n, 0, z1 + dz * i / n);
    for (const y of [0.45, 0.85]) {
      const r = box(len, 0.08, 0.06, C.woodLight, (x1 + x2) / 2, y, (z1 + z2) / 2);
      r.rotation.y = -Math.atan2(dz, dx);
    }
  };
  fenceLine(-Y, -Y, Y, -Y); fenceLine(-Y, Y, Y, Y); fenceLine(-Y, -Y, -Y, Y); fenceLine(Y, -Y, Y, Y);
  block(0, -Y, Y * 2 + 1, 6, 0.3, 'fence'); block(0, Y, Y * 2 + 1, 6, 0.3, 'fence');
  block(-Y, 0, 0.3, 6, Y * 2 + 1, 'fence'); block(Y, 0, 0.3, 6, Y * 2 + 1, 'fence');

  // Granero
  box(9, 6, 7, C.barn, -11, 0, -9);
  box(1.8, 3, 0.2, C.roof, -11, 0, -5.45);
  for (const s of [-1, 1]) { const r = box(5.4, 0.25, 7.6, C.roof, -11 + s * 2.25, 5.9, -9); r.rotation.z = -s * 0.55; r.position.y = 6.9; }
  box(0.4, 0.4, 0.4, C.white, -11, 4.2, -5.42);
  block(-11, -9, 9, 7, 7, 'barn');

  // Gallinero: 3 paredes + techo, abierto hacia el patio (-z). Es zona segura.
  const cx = COOP.x, cz = COOP.z;
  box(3.2, 1.75, 0.12, C.woodLight, cx, 0, cz + 1.25); block(cx, cz + 1.25, 3.2, 1.75, 0.12, 'coop');
  for (const s of [-1, 1]) { box(0.12, 1.75, 2.6, C.woodLight, cx + s * 1.55, 0, cz); block(cx + s * 1.55, cz, 0.12, 1.75, 2.6, 'coop'); }
  box(3.6, 0.18, 3.0, C.roof, cx, 1.75, cz); block(cx, cz, 3.6, 0.18, 3.0, 'coopRoof', 1.75);
  box(1.2, 0.5, 0.5, C.roof, cx, 1.93, cz + 0.6);
  for (let i = -1; i <= 1; i++) box(0.8, 0.4, 0.5, C.hay, cx + i * 1.0, 0.05, cz + 0.9);
  box(0.9, 0.06, 1.4, C.woodLight, cx, 0.0, cz - 1.9).rotation.x = 0.0;
  const sign = box(1.4, 0.4, 0.05, C.white, cx, 2.15, cz - 1.45);
  sign.material = mat(0xfff1d6);

  // Corral del cerdo
  const px = PEN.x, pz = PEN.z, ph = PEN.half;
  const penSide = (x1, z1, x2, z2) => {
    const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz), n = Math.round(len / 1.5);
    for (let i = 0; i <= n; i++) box(0.12, 0.6, 0.12, C.wood, x1 + dx * i / n, 0, z1 + dz * i / n);
    const r = box(len, 0.07, 0.06, C.woodLight, (x1 + x2) / 2, 0.45, (z1 + z2) / 2); r.rotation.y = -Math.atan2(dz, dx);
  };
  penSide(px - ph, pz - ph, px + ph, pz - ph); penSide(px - ph, pz + ph, px + ph, pz + ph);
  penSide(px - ph, pz - ph, px - ph, pz + ph); penSide(px + ph, pz - ph, px + ph, pz + ph);
  block(px, pz - ph, ph * 2, 0.55, 0.15, 'pen'); block(px, pz + ph, ph * 2, 0.55, 0.15, 'pen');
  block(px - ph, pz, 0.15, 0.55, ph * 2, 'pen'); block(px + ph, pz, 0.15, 0.55, ph * 2, 'pen');
  const mud = new THREE.Mesh(new THREE.CircleGeometry(2.2, 14), mat(0x7a5a3a)); mud.rotation.x = -Math.PI / 2; mud.position.set(px, 0.015, pz); scene.add(mud);

  // Pacas de heno (se puede subir a ellas)
  for (const [x, z, ry] of [[3, -6, 0.2], [-2, -12.5, -0.3], [6.5, -13.5, 0.1], [-5, 2, 0.5], [15, -4, 0], [-15.5, -2, 0.2], [2, 6, -0.4], [9, 2, 0.3], [15.4, 9, 0]]) {
    const b = box(1.3, 0.85, 0.9, C.hay, x, 0, z);
    for (const o of [-0.35, 0.35]) box(1.32, 0.08, 0.92, C.hayDark, x, 0.38 + o * 0.9, z);
    void ry; block(x, z, 1.3, 0.85, 0.9, 'hay'); void b;
  }
  // Pila de dos pacas: una rampa para alcanzar lugares altos
  box(1.3, 0.85, 0.9, C.hay, 4.3, 0.85, -6); block(4.3, -6, 1.3, 0.85, 0.9, 'hay', 0.85);
  box(1.3, 0.85, 0.9, C.hay, 4.3, 0, -6); block(4.3, -6, 1.3, 0.85, 0.9, 'hay');

  // Bebedero, pozo, tractor
  box(2.4, 0.5, 0.7, C.metal, 0, 0, -3); block(0, -3, 2.4, 0.5, 0.7, 'trough');
  const w = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.5), new THREE.MeshLambertMaterial({ color: 0x4aa8d8 })); w.rotation.x = -Math.PI / 2; w.position.set(0, 0.46, -3); scene.add(w);
  cyl(0.8, 0.85, 0.9, C.stone, 6, 0, 3, scene, 12); for (const s of [-1, 1]) box(0.1, 1.9, 0.1, C.wood, 6 + s * 0.7, 0, 3);
  const wr = box(2.0, 0.1, 1.4, C.roof, 6, 1.9, 3); wr.rotation.x = 0.35; block(6, 3, 1.7, 1.0, 1.7, 'well');
  box(2.4, 1.1, 1.4, C.red, 14, 0.5, -12); box(1.2, 1.0, 1.3, C.dark, 13.6, 1.6, -12); box(0.6, 0.3, 0.6, C.metal, 15.1, 1.6, -12);
  for (const [x, z, r] of [[12.9, -11.1, 0.55], [12.9, -12.9, 0.55], [15.2, -11.0, 0.42], [15.2, -13.0, 0.42]]) { const t = cyl(r, r, 0.3, C.dark, x, r, z, scene, 12); t.rotation.x = Math.PI / 2; t.position.y = r; }
  block(14, -12, 3.0, 2.6, 2.0, 'tractor');

  // Espantapájaros (se derriba a picotazos)
  scarecrow = new THREE.Group(); scarecrow.position.set(-2, 0, -15); scene.add(scarecrow);
  cyl(0.06, 0.06, 1.9, C.wood, 0, 0, 0, scarecrow); box(1.4, 0.07, 0.07, C.wood, 0, 1.45, 0, scarecrow);
  box(0.55, 0.7, 0.3, C.denim, 0, 0.8, 0, scarecrow); box(1.3, 0.2, 0.22, C.shirt, 0, 1.3, 0, scarecrow);
  sph(0.24, C.hay, 0, 1.8, 0, scarecrow); cyl(0.38, 0.38, 0.05, C.hat, 0, 2.0, 0, scarecrow); cyl(0.2, 0.22, 0.18, C.hat, 0, 2.04, 0, scarecrow);
  for (const s of [-1, 1]) sph(0.035, C.dark, s * 0.09, 1.85, 0.21, scarecrow);
  scarecrow.userData = { hits: 0, down: false, peck: () => peckScarecrow() };
  peckables.push(scarecrow); block(-2, -15, 0.4, 1.9, 0.4, 'scarecrow');

  // Cubetas (se tiran a picotazos)
  for (const [x, z] of [[-5.5, -4.5], [2, -9], [8.5, -2.5], [-8, 2.5], [10, 12], [-3, 12.5]]) {
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
    cyl(0.2, 0.16, 0.4, C.bucket, 0, 0, 0, g, 12); cyl(0.17, 0.17, 0.03, 0x4aa8d8, 0, 0.38, 0, g, 12);
    const h = cyl(0.015, 0.015, 0.46, C.metal, 0, 0.3, 0, g, 6); h.rotation.z = Math.PI / 2; h.position.y = 0.42;
    g.userData = { tipped: false, peck: () => tipBucket(g) };
    peckables.push(g); buckets.push(g);
  }

  // Árboles
  for (const [x, z] of [[-16, -16], [16, -16.5], [16.5, 15.5], [-16.5, 15.5], [-3, 16], [17, 5], [-17, 6]]) {
    cyl(0.22, 0.3, 2.2, C.trunk, x, 0, z, scene, 8); block(x, z, 0.5, 2.2, 0.5, 'tree');
    sph(1.5, C.leaf, x, 2.9, z, scene, 10); sph(1.1, C.leaf, x + 0.8, 3.6, z - 0.4, scene, 8); sph(1.0, C.leaf, x - 0.7, 3.5, z + 0.5, scene, 8);
  }

  // Maizal exterior (instanciado), casa del granjero, lomas y nubes: solo decoración.
  const stalk = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1.7, 0.12), mat(C.cornLeaf), 520);
  const m4 = new THREE.Matrix4(); let k = 0;
  for (let i = 0; i < 520; i++) {
    const side = i % 2 ? 1 : -1; const x = side * (21 + (i % 13) * 1.1 + Math.random() * 0.4); const z = -24 + Math.floor(i / 26) * 2.4 + Math.random() * 0.6;
    m4.makeTranslation(x, 0.85, z); stalk.setMatrixAt(k++, m4);
  }
  scene.add(stalk);
  box(11, 5, 8, 0xf1e2c4, 0, 0, -31); const hr = box(12.5, 0.3, 9, C.roof, 0, 5.1, -31); hr.rotation.x = 0.0;
  cone(7.5, 3.2, C.roof, 0, 5.2, -31, scene, 4).rotation.y = Math.PI / 4;
  box(1.2, 2.2, 0.1, C.wood, 0, 0, -26.95); for (const s of [-1, 1]) box(1.4, 1.2, 0.1, 0x9fd8ff, s * 3.5, 2.2, -26.95);
  for (const [x, z, r] of [[-60, -70, 28], [55, -75, 24], [80, -20, 20], [-85, 10, 22], [0, 90, 26], [-50, 70, 18], [70, 60, 22]]) { const h = sph(r, 0x5f9b3a, x, -r * 0.55, z, scene, 14); h.scale.y = 0.45; }
  const cloudMat = new THREE.MeshLambertMaterial({ color: C.cloud, fog: false });
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group(); g.position.set((Math.random() - 0.5) * 140, 26 + Math.random() * 10, -40 - Math.random() * 60); scene.add(g);
    for (let j = 0; j < 4; j++) { const s = new THREE.Mesh(new THREE.SphereGeometry(3 + Math.random() * 3, 8, 6), cloudMat); s.position.set(j * 4 - 6, Math.random() * 1.5, (Math.random() - 0.5) * 3); g.add(s); }
  }
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(6, 24), new THREE.MeshBasicMaterial({ color: 0xfff4c2, fog: false })); sunDisc.position.set(60, 70, -110); sunDisc.lookAt(0, 0, 0); scene.add(sunDisc);
}

function tipBucket(g) {
  if (g.userData.tipped) return;
  g.userData.tipped = true; sfx.bonk();
  animate(0.45, (k) => { g.rotation.z = ease(k) * 1.5; g.position.y = Math.sin(k * Math.PI) * 0.15; });
  game.score += 25; progress('bucket'); say('¡Cubeta al suelo! +25');
}
function resetBuckets() { for (const g of buckets) { g.userData.tipped = false; g.rotation.z = 0; g.position.y = 0; } }
function peckScarecrow() {
  const u = scarecrow.userData; if (u.down) return;
  u.hits++; sfx.bonk();
  animate(0.3, (k) => { scarecrow.rotation.z = Math.sin(k * Math.PI * 2) * 0.15 * (1 - k); });
  if (u.hits >= 5) {
    u.down = true; game.score += 80;
    animate(0.8, (k) => { scarecrow.rotation.x = ease(k) * 1.45; }, () => progress('scarecrow'));
    say('¡El espantapájaros cayó! +80');
  } else say(`Espantapájaros: ${u.hits}/5 picotazos`);
}
function resetScarecrow() { scarecrow.userData.hits = 0; scarecrow.userData.down = false; scarecrow.rotation.set(0, 0, 0); }

// ---------------------------------------------------------------- personajes
function makeHuman({ pants, shirt, skin, hatColor, hair, dress }) {
  const g = new THREE.Group();
  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(s * 0.15, 0.85, 0); g.add(piv); legs.push(piv);
    box(0.22, 0.85, 0.24, pants, 0, -0.85, 0, piv); box(0.24, 0.12, 0.32, C.dark, 0, -0.85, 0.03, piv);
  }
  if (dress) { const d = cone(0.5, 1.05, dress, 0, 0.35, 0, g, 14); d.position.y = 0.35 + 0.525; box(0.3, 0.45, 0.04, C.apron, 0, 0.55, 0.42, g); }
  box(0.62, 0.72, 0.38, shirt, 0, 0.85, 0, g);
  if (!dress) { box(0.5, 0.5, 0.42, pants, 0, 0.85, 0, g); for (const s of [-1, 1]) box(0.08, 0.5, 0.42, pants, s * 0.18, 1.2, 0, g); }
  const head = sph(0.24, skin, 0, 1.82, 0, g, 12);
  for (const s of [-1, 1]) sph(0.04, C.dark, s * 0.09, 1.87, 0.21, g, 6);
  sph(0.05, skin, 0, 1.78, 0.24, g, 6);
  box(0.16, 0.03, 0.02, 0x7a2a1a, 0, 1.7, 0.23, g);
  if (hatColor) { cyl(0.38, 0.38, 0.05, hatColor, 0, 2.0, 0, g, 14); cyl(0.2, 0.23, 0.2, hatColor, 0, 2.04, 0, g, 12); }
  if (hair) { sph(0.25, hair, 0, 1.9, -0.05, g, 10).scale.set(1, 0.75, 1); sph(0.14, hair, 0, 2.12, -0.12, g, 8); }
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(s * 0.4, 1.5, 0); g.add(piv); arms.push(piv);
    box(0.17, 0.62, 0.17, shirt, 0, -0.62, 0, piv); sph(0.09, skin, 0, -0.64, 0, piv, 8);
  }
  return { g, legs, arms, head };
}
function makeFarmer() {
  const h = makeHuman({ pants: C.denim, shirt: C.shirt, skin: C.skin, hatColor: C.hat });
  const tool = new THREE.Group(); tool.position.set(0, -0.64, 0.1); h.arms[1].add(tool);
  const handle = cyl(0.03, 0.03, 0.24, C.wood, 0, 0, 0, tool, 6); handle.rotation.x = Math.PI / 2; handle.position.set(0, 0, 0);
  const blade = box(0.04, 0.26, 0.36, C.metal, 0, -0.05, 0.3, tool); blade.position.y = 0.02;
  box(0.045, 0.03, 0.36, 0xd0d8dd, 0, 0.15, 0.3, tool);
  return { ...h, tool };
}
function makeWife() {
  const h = makeHuman({ pants: 0x5a3b6b, shirt: C.dress, skin: 0xf3cfb2, hair: 0x6b6b6b, dress: C.dress });
  const broom = new THREE.Group(); broom.position.set(0, -0.6, 0.05); h.arms[1].add(broom);
  cyl(0.025, 0.025, 1.3, C.woodLight, 0, -0.3, 0, broom, 6); box(0.2, 0.3, 0.14, C.hay, 0, 0.98, 0, broom);
  return h;
}
function makePig() {
  const g = new THREE.Group();
  const body = sph(0.5, C.pink, 0, 0.5, 0, g, 12); body.scale.set(1, 0.78, 1.45);
  sph(0.3, C.pink, 0, 0.55, 0.72, g, 10); const sn = cyl(0.12, 0.13, 0.12, 0xe68aa0, 0, 0.47, 0.98, g, 10); sn.rotation.x = Math.PI / 2; sn.position.y = 0.52;
  for (const s of [-1, 1]) { sph(0.035, C.dark, s * 0.11, 0.66, 0.95, g, 6); cone(0.09, 0.2, 0xe68aa0, s * 0.18, 0.72, 0.6, g, 6).rotation.x = -0.4; }
  for (const [x, z] of [[-0.25, 0.4], [0.25, 0.4], [-0.25, -0.4], [0.25, -0.4]]) cyl(0.08, 0.08, 0.3, 0xe68aa0, x, 0, z, g, 6);
  const tail = cyl(0.03, 0.03, 0.25, 0xe68aa0, 0, 0.6, -0.75, g, 5); tail.rotation.x = 0.8;
  return { g };
}
function makeHen(color = C.white) {
  const g = new THREE.Group();
  sph(0.2, color, 0, 0.26, 0, g, 10).scale.set(1, 0.9, 1.3);
  sph(0.12, color, 0, 0.47, 0.2, g, 8);
  cone(0.045, 0.12, C.orange, 0, 0.4, 0.32, g, 6).rotation.x = Math.PI / 2;
  box(0.05, 0.08, 0.1, C.red, 0, 0.56, 0.2, g); box(0.04, 0.09, 0.04, C.red, 0, 0.3, 0.3, g);
  for (const s of [-1, 1]) { sph(0.025, C.dark, s * 0.07, 0.5, 0.29, g, 6); cyl(0.015, 0.015, 0.12, C.orange, s * 0.07, 0, 0, g, 5); }
  const t = box(0.14, 0.14, 0.05, color, 0, 0.36, -0.28, g); t.rotation.x = 0.6;
  return { g };
}

const yardWaypoints = [[-3, -2], [-9, -16], [8, -16], [14, -5], [6, 3], [-2, 11], [-16, 15], [-16, 2]];
const wifeWaypoints = [[4, -10], [-4, -14], [10, 2], [0, 6], [-4, 13], [8, 14]];
const farmer = { ...makeFarmer(), type: 'farmer', radius: 0.42, height: 2.1, state: 'patrol', wpi: 0, timer: 0, speed: 1.3, chaseSpeed: 2.1, rage: 0, lost: 0, phase: 0, moving: false, heading: 0, stuck: 0, lastPos: new THREE.Vector3(), splats: [] };
const wife = { ...makeWife(), type: 'wife', radius: 0.42, height: 2.0, state: 'wander', wpi: 0, timer: 0, speed: 1.0, rage: 0, phase: 0, moving: false, heading: 0, active: false, fleeDir: new THREE.Vector3(1, 0, 0), stuck: 0, lastPos: new THREE.Vector3(), splats: [] };
const pig = { ...makePig(), type: 'pig', radius: 0.5, state: 'idle', timer: 0, target: new THREE.Vector3(PEN.x, 0, PEN.z), phase: 0, wobble: 0, heading: 0 };
const hens = [];
farmer.g.position.set(-3, 0, -2); scene.add(farmer.g);
wife.g.position.set(4, 0, -10); wife.g.visible = false; scene.add(wife.g);
pig.g.position.set(PEN.x, 0, PEN.z); scene.add(pig.g);
for (const [c, x, z] of [[C.white, 2, 2], [0xd9803a, -6, -8], [0x3a3a3a, 10, -8]]) {
  const h = { ...makeHen(c), target: new THREE.Vector3(x, 0, z), timer: 0, hop: 0, phase: 0, recruited: false };
  h.g.position.set(x, 0, z); scene.add(h.g); hens.push(h);
  h.g.userData = { peck: () => peckHen(h) }; peckables.push(h.g);
}
farmer.g.userData = { peck: () => { sfx.yell(); say('Don Ramiro: "¡Ay, mis tobillos! ¡Ven acá, pollo!"'); farmer.rage = 5; farmer.state = 'chase'; game.score += 15; } };
wife.g.userData = { peck: () => { sfx.scream(); say('Doña Chona: "¡Aaay! ¡Gallina atrevida!"'); flee(wife); game.score += 15; } };
pig.g.userData = { peck: () => peckPig() };
peckables.push(farmer.g, wife.g, pig.g);

function peckPig() {
  sfx.grunt(); pig.wobble = 0.6; pig.timer = 0; game.score += 30;
  pig.target.set(PEN.x + (Math.random() - 0.5) * 4.4, 0, PEN.z + (Math.random() - 0.5) * 4.4);
  progress('pig'); say('¡Oink! El cerdo se enoja +30');
}
function peckHen(h) {
  sfx.cluck(); h.hop = 0.5; game.score += 10;
  if (!h.recruited) { h.recruited = true; progress('hen'); }
  say('¡Cloc cloc! +10');
}
function flee(npc) { npc.state = 'flee'; npc.timer = 4; npc.fleeDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize(); }

// ---------------------------------------------------------------- maíz (recarga popó)
const cornItems = [];
const cornGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.3, 8);
function randomSpot(margin = 0.8) {
  for (let i = 0; i < 40; i++) {
    const x = (Math.random() - 0.5) * 32, z = (Math.random() - 0.5) * 32;
    if (Math.abs(x - PEN.x) < PEN.half + 1 && Math.abs(z - PEN.z) < PEN.half + 1) continue;
    if (Math.abs(x - COOP.x) < 2.5 && Math.abs(z - COOP.z) < 2.5) continue;
    if (obstacles.some((o) => x > o.min.x - margin && x < o.max.x + margin && z > o.min.z - margin && z < o.max.z + margin && o.max.y > 0.3 && o.tag !== 'fence')) continue;
    return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(0, 0, 4);
}
function buildCorn() {
  for (let i = 0; i < 9; i++) {
    const g = new THREE.Group();
    const cob = new THREE.Mesh(cornGeo, mat(C.corn)); cob.position.y = 0.2; g.add(cob);
    for (const s of [-1, 1]) { const l = box(0.05, 0.3, 0.12, C.cornLeaf, s * 0.06, 0.03, 0, g); l.rotation.z = s * 0.4; }
    scene.add(g); cornItems.push({ g, active: true, timer: 0, spin: Math.random() * 6 });
    g.position.copy(randomSpot());
  }
}
function respawnCorn() { for (const c of cornItems) { c.active = true; c.g.visible = true; c.g.position.copy(randomSpot()); } }

// ---------------------------------------------------------------- popó
const poops = [], splats = [];
const poopGeo = new THREE.SphereGeometry(0.055, 8, 6), splatGeo = new THREE.CircleGeometry(0.13, 10);
const poopMat = mat(C.poop);
const splatMat = new THREE.MeshLambertMaterial({ color: C.poop, transparent: true, opacity: 0.95 });
function poop() {
  if (game.state !== 'playing') return;
  if (game.cooldown > 0) return;
  if (game.charges <= 0) { sfx.tick(); say('Sin popó: come maíz 🌽'); return; }
  game.charges--; game.cooldown = CFG.poopCooldown; refreshHUD(); sfx.plop();
  const head = headPos(), fwd = headForward();
  const m = new THREE.Mesh(poopGeo, poopMat); scene.add(m);
  const vel = new THREE.Vector3().copy(fwd).multiplyScalar(-1.25).add(playerVel.clone().multiplyScalar(0.45)); vel.y = 0.45;
  poops.push({ m, pos: new THREE.Vector3(head.x, player.position.y + 0.17, head.z), vel });
  m.position.copy(poops[poops.length - 1].pos);
}
function groundAt(x, z, y) {
  let g = 0;
  for (const o of obstacles) if (x > o.min.x && x < o.max.x && z > o.min.z && z < o.max.z && o.max.y <= y + 0.05 && o.max.y > g) g = o.max.y;
  return g;
}
function addSplat(x, y, z) {
  const s = new THREE.Mesh(splatGeo, splatMat.clone()); s.rotation.x = -Math.PI / 2; s.position.set(x, y + 0.006, z); s.rotation.z = Math.random() * 6;
  s.scale.setScalar(0.8 + Math.random() * 0.6); scene.add(s); splats.push({ m: s, life: 25 });
  if (splats.length > 40) { const old = splats.shift(); scene.remove(old.m); }
}
function hitNPC(npc, p) {
  const hit = sph(0.09, C.poop, 0, 0, 0, npc.g, 7);
  const local = npc.g.worldToLocal(p.pos.clone()); hit.position.copy(local); hit.scale.set(1, 0.5, 1);
  npc.splats.push(hit); if (npc.splats.length > 8) npc.g.remove(npc.splats.shift());
  sfx.splat();
  const hat = p.pos.y > npc.height - 0.5;
  const pts = hat ? 120 : 50; game.score += pts;
  if (npc === farmer) {
    progress('poopFarmer'); farmer.rage = 6; farmer.state = 'chase';
    say(hat ? `¡EN EL SOMBRERO! +${pts} · Don Ramiro: "¡Mi sombrero nuevo!"` : `¡PLAF en las botas! +${pts} · Don Ramiro: "¡Pollo asqueroso!"`);
    sfx.yell();
  } else {
    progress('poopWife'); flee(wife); sfx.scream();
    say(hat ? `¡EN EL PEINADO! +${pts} · Doña Chona: "¡AAAAY!"` : `¡PLAF en el vestido! +${pts} · Doña Chona: "¡Cochina!"`);
  }
}
function updatePoops(dt) {
  for (let i = poops.length - 1; i >= 0; i--) {
    const p = poops[i];
    p.vel.y -= CFG.gravity * dt; p.pos.addScaledVector(p.vel, dt); p.m.position.copy(p.pos);
    let gone = false;
    for (const npc of [farmer, wife]) {
      if (!npc.g.visible) continue;
      const dx = p.pos.x - npc.g.position.x, dz = p.pos.z - npc.g.position.z;
      if (dx * dx + dz * dz < 0.42 * 0.42 && p.pos.y > 0.02 && p.pos.y < npc.height) { hitNPC(npc, p); gone = true; break; }
    }
    const gy = groundAt(p.pos.x, p.pos.z, p.pos.y + 0.1);
    if (!gone && p.pos.y <= gy + 0.03) { addSplat(p.pos.x, gy, p.pos.z); gone = true; }
    if (gone || p.pos.y < -2) { scene.remove(p.m); poops.splice(i, 1); }
  }
  for (let i = splats.length - 1; i >= 0; i--) {
    const s = splats[i]; s.life -= dt; if (s.life < 5) s.m.material.opacity = Math.max(0, s.life / 5);
    if (s.life <= 0) { scene.remove(s.m); splats.splice(i, 1); }
  }
}

// ---------------------------------------------------------------- picotazo
const raycaster = new THREE.Raycaster();
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion();
function peckFrom(obj) {
  if (game.state !== 'playing') return;
  obj.getWorldPosition(_o); obj.getWorldQuaternion(_q); _d.set(0, 0, -1).applyQuaternion(_q).normalize();
  raycaster.set(_o, _d); raycaster.far = CFG.peckRange;
  sfx.peck(); beakPeck();
  for (const o of peckables) o.updateMatrixWorld(true);
  const hits = raycaster.intersectObjects(peckables, true);
  for (const h of hits) {
    let o = h.object; while (o && !o.userData?.peck) o = o.parent;
    if (o) { o.userData.peck(); return; }
  }
}

// ---------------------------------------------------------------- misiones y niveles
const MISSION = {
  corn: (n) => ({ type: 'corn', need: n, text: `Come ${n} maíces` }),
  poopFarmer: (n) => ({ type: 'poopFarmer', need: n, text: `Hazle popó a Don Ramiro` }),
  poopWife: (n) => ({ type: 'poopWife', need: n, text: `Hazle popó a Doña Chona` }),
  bucket: (n) => ({ type: 'bucket', need: n, text: `Tira cubetas a picotazos` }),
  pig: (n) => ({ type: 'pig', need: n, text: `Picotea al cerdo` }),
  roof: () => ({ type: 'roof', need: 1, text: `Súbete al techo del gallinero` }),
  scarecrow: () => ({ type: 'scarecrow', need: 1, text: `Derriba al espantapájaros (5 picotazos)` }),
  survive: (s) => ({ type: 'survive', need: s, text: `Sobrevive ${s} s seguidos fuera del gallinero`, seconds: true }),
  hen: (n) => ({ type: 'hen', need: n, text: `Recluta gallinas a picotazos` }),
};
const LEVELS = [
  { name: 'Bienvenida al corral', farmerSpeed: 2.1, wife: false, missions: [MISSION.corn(3), MISSION.bucket(2), MISSION.poopFarmer(1)] },
  { name: 'Caos en la granja', farmerSpeed: 2.4, wife: true, missions: [MISSION.poopWife(2), MISSION.pig(3), MISSION.roof()] },
  { name: 'La venganza de la gallina', farmerSpeed: 2.7, wife: true, missions: [MISSION.poopFarmer(3), MISSION.scarecrow(), MISSION.survive(40)] },
];
function genLevel(i) {
  const k = i - 2;
  const pool = [MISSION.corn(4 + k), MISSION.poopFarmer(2 + k), MISSION.poopWife(2 + k), MISSION.bucket(Math.min(6, 3 + k)), MISSION.pig(3 + k), MISSION.roof(), MISSION.scarecrow(), MISSION.survive(30 + 5 * k), MISSION.hen(3)];
  const missions = []; while (missions.length < 3) { const m = pool.splice(Math.floor(Math.random() * pool.length), 1)[0]; missions.push(m); }
  const names = ['Pánico en el patio', 'Don Ramiro afila el machete', 'Noche de caldo… o no', 'La gallina indomable', 'Rebelión en la granja'];
  return { name: names[k % names.length] + ` ${k > 4 ? 'II' : ''}`.trimEnd(), farmerSpeed: Math.min(3.5, 2.75 + 0.15 * k), wife: true, missions };
}

const game = {
  state: 'menu', level: 0, score: 0, lives: CFG.lives, charges: CFG.startPoop, cooldown: 0, regen: 0,
  missions: [], levelName: '', timer: 0, time: 0, best: JSON.parse(localStorage.getItem(STORAGE_KEY) || '{"level":0,"score":0}'),
};
function progress(type, n = 1) {
  let changed = false;
  for (const m of game.missions) {
    if (m.type !== type || m.complete) continue;
    m.done = Math.min(m.need, m.done + n); changed = true;
    if (m.done >= m.need) { m.complete = true; game.score += 60; sfx.done(); banner('✓ MISIÓN CUMPLIDA'); }
  }
  if (changed) { refreshHUD(); if (game.missions.every((m) => m.complete)) levelUp(); }
}
function loadLevel(i) {
  const def = LEVELS[i] || genLevel(i);
  game.level = i; game.levelName = def.name;
  game.missions = def.missions.map((m) => ({ ...m, done: 0, complete: false }));
  farmer.chaseSpeed = def.farmerSpeed; farmer.speed = 1.3 + i * 0.08; farmer.rage = 0; farmer.state = 'patrol';
  wife.active = def.wife; wife.g.visible = def.wife; wife.state = 'wander';
  for (const npc of [farmer, wife]) { for (const s of npc.splats) npc.g.remove(s); npc.splats.length = 0; }
  resetBuckets(); resetScarecrow(); respawnCorn();
  banner(`NIVEL ${i + 1}: ${def.name.toUpperCase()}`);
  refreshHUD();
}
function levelUp() {
  sfx.level(); game.score += 100 * (game.level + 1); game.lives = Math.min(5, game.lives + 1);
  game.state = 'levelup'; game.timer = 2.4;
  banner(`¡NIVEL ${game.level + 1} SUPERADO!  +1 vida`);
  saveBest();
}
function saveBest() {
  if (game.level + 1 > game.best.level || (game.level + 1 === game.best.level && game.score > game.best.score)) {
    game.best = { level: game.level + 1, score: game.score }; localStorage.setItem(STORAGE_KEY, JSON.stringify(game.best));
  }
}
function startGame() {
  audio();
  game.score = 0; game.lives = CFG.lives; game.charges = CFG.startPoop; game.cooldown = 0; game.regen = 0; game.time = 0;
  respawnPlayer(); loadLevel(0); game.state = 'playing';
  document.body.classList.add('playing'); ui.pause.hidden = true;
  say('¡Corre, gallina! Popó: clic izq. / gatillo · Picotazo: clic der. / agarre · Aletea: Espacio / A');
  if (!renderer.xr.isPresenting) renderer.domElement.requestPointerLock?.();
}
function respawnPlayer() {
  player.position.set(COOP.x, 0, COOP.z + 0.2); playerVel.set(0, 0, 0); vy = 0; flaps = CFG.maxFlaps;
  if (!renderer.xr.isPresenting) { player.rotation.y = 0; pitch = 0; camera.rotation.x = 0; }
  else { snapTurnTo(0); }
}
function caught() {
  game.state = 'caught'; game.timer = 2.0; game.lives--;
  sfx.caught(); flash();
  farmer.state = 'stunned'; farmer.timer = 3.5;
  for (const m of game.missions) if (m.type === 'survive') m.done = 0;
  banner(game.lives > 0 ? '¡CASI TE DEGÜELLAN! 🔪' : '¡TE ATRAPARON!');
  say(game.lives > 0 ? `Don Ramiro: "¡Esta vez te escapaste, pollo!"  Vidas: ${game.lives}` : 'Don Ramiro: "¡Al caldo!"');
  refreshHUD();
}
function gameOver() {
  game.state = 'over'; saveBest();
  document.body.classList.remove('playing');
  document.exitPointerLock?.();
  ui.results.style.display = 'block';
  ui.results.innerHTML = `<b>FIN DE LA GALLINA</b><br>Llegaste al nivel ${game.level + 1} · ${game.score} puntos<br>Récord: nivel ${game.best.level} · ${game.best.score} puntos`;
  ui.subtitle.textContent = 'Don Ramiro ganó esta vez… pero las gallinas no se rinden.';
  ui.play.textContent = '▶ JUGAR OTRA VEZ';
  banner('FIN · aprieta el gatillo para reintentar');
  vrBanner.hold = true;
}

// ---------------------------------------------------------------- HUD (DOM + panel en VR)
function refreshHUD() {
  ui.level.textContent = `Nivel ${game.level + 1} · ${game.levelName}`;
  ui.lives.textContent = '🐔'.repeat(Math.max(0, game.lives)) || '—';
  ui.score.textContent = String(game.score);
  ui.poop.textContent = '💩'.repeat(game.charges) + '·'.repeat(CFG.maxPoop - game.charges);
  ui.missions.innerHTML = game.missions.map((m) => `<li class="${m.complete ? 'done' : ''}">${m.text}<span class="n">${m.seconds ? Math.floor(m.done) : m.done}/${m.need}</span></li>`).join('');
  vrHud.dirty = true;
}
function makeCanvasPlane(w, h, pw, ph) {
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  mesh.renderOrder = 999; mesh.visible = false; camera.add(mesh);
  return { canvas, ctx: canvas.getContext('2d'), tex, mesh, dirty: true };
}
const vrHud = makeCanvasPlane(560, 360, 0.28, 0.18);
vrHud.mesh.position.set(-0.19, -0.13, -0.5); vrHud.mesh.rotation.set(-0.15, 0.25, 0);
const vrBanner = makeCanvasPlane(900, 220, 0.5, 0.122);
vrBanner.mesh.position.set(0, 0.1, -0.55); vrBanner.timer = 0; vrBanner.text = ''; vrBanner.sub = ''; vrBanner.hold = false;
const vrFlash = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ color: 0xd6261a, transparent: true, opacity: 0.4, depthTest: false }));
vrFlash.position.z = -0.3; vrFlash.visible = false; vrFlash.renderOrder = 998; camera.add(vrFlash);
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
function drawVRHud() {
  const c = vrHud.ctx, W = vrHud.canvas.width, H = vrHud.canvas.height;
  c.clearRect(0, 0, W, H); c.fillStyle = 'rgba(26,15,6,0.82)'; roundRect(c, 0, 0, W, H, 28); c.fill();
  c.fillStyle = '#ffd36b'; c.font = 'bold 30px sans-serif'; c.fillText(`NIVEL ${game.level + 1} · ${game.levelName}`, 24, 46);
  c.fillStyle = '#fff3df'; c.font = '27px sans-serif';
  c.fillText(`VIDAS ${'♥'.repeat(Math.max(0, game.lives))}    PUNTOS ${game.score}`, 24, 90);
  c.fillText(`POPÓ ${'●'.repeat(game.charges)}${'○'.repeat(CFG.maxPoop - game.charges)}`, 24, 128);
  c.font = '25px sans-serif'; let y = 178;
  for (const m of game.missions) {
    c.fillStyle = m.complete ? '#8fe28a' : '#fff3df';
    const n = `${m.seconds ? Math.floor(m.done) : m.done}/${m.need}`;
    c.fillText(`${m.complete ? '✓' : '○'} ${m.text}`, 24, y); c.fillStyle = '#ffd36b'; c.textAlign = 'right'; c.fillText(n, W - 24, y); c.textAlign = 'left'; y += 36;
  }
  vrHud.tex.needsUpdate = true; vrHud.dirty = false;
}
function drawVRBanner() {
  const c = vrBanner.ctx, W = vrBanner.canvas.width, H = vrBanner.canvas.height;
  c.clearRect(0, 0, W, H);
  if (!vrBanner.text && !vrBanner.sub) { vrBanner.tex.needsUpdate = true; return; }
  c.fillStyle = 'rgba(26,15,6,0.78)'; roundRect(c, 0, 0, W, H, 34); c.fill();
  c.textAlign = 'center'; c.fillStyle = '#ffd36b'; c.font = 'bold 54px sans-serif'; c.fillText(vrBanner.text, W / 2, vrBanner.sub ? 92 : 130);
  if (vrBanner.sub) { c.fillStyle = '#fff3df'; c.font = '30px sans-serif'; wrapText(c, vrBanner.sub, W / 2, 150, W - 60, 34); }
  c.textAlign = 'left'; vrBanner.tex.needsUpdate = true;
}
function wrapText(c, text, x, y, maxW, lh) {
  const words = text.split(' '); let line = '';
  for (const w of words) { const t = line + w + ' '; if (c.measureText(t).width > maxW && line) { c.fillText(line, x, y); line = w + ' '; y += lh; } else line = t; }
  c.fillText(line, x, y);
}
let bannerTimer = 0, sayTimer = 0;
function banner(text) {
  ui.banner.textContent = text; ui.banner.classList.add('show'); bannerTimer = 2.4;
  vrBanner.text = text; vrBanner.timer = 2.6; vrBanner.hold = false; drawVRBanner(); vrBanner.mesh.visible = renderer.xr.isPresenting;
}
function say(text) {
  ui.hint.textContent = text; sayTimer = 3.5;
  vrBanner.sub = text; vrBanner.timer = Math.max(vrBanner.timer, 3.2); drawVRBanner(); vrBanner.mesh.visible = renderer.xr.isPresenting;
}
function flash() { ui.flash.classList.add('on'); setTimeout(() => ui.flash.classList.remove('on'), 120); vrFlash.visible = renderer.xr.isPresenting; setTimeout(() => { vrFlash.visible = false; }, 220); }

// Pico de la gallina, pegado a la cámara: recuerda que eres un pollo.
const beak = new THREE.Group(); camera.add(beak); beak.position.set(0, -0.11, -0.3);
const beakTop = cone(0.035, 0.09, C.orange, 0, 0, 0, beak, 6); beakTop.rotation.x = -Math.PI / 2; beakTop.position.set(0, 0.01, -0.03);
const beakBot = cone(0.03, 0.07, 0xd97a1e, 0, 0, 0, beak, 6); beakBot.rotation.x = -Math.PI / 2; beakBot.position.set(0, -0.015, -0.02);
function beakPeck() { animate(0.22, (k) => { beak.position.z = -0.3 - Math.sin(k * Math.PI) * 0.08; beak.position.y = -0.11 - Math.sin(k * Math.PI) * 0.03; }); }

// ---------------------------------------------------------------- entrada: escritorio
const keys = new Set();
let pitch = 0;
const locked = () => document.pointerLockElement === renderer.domElement;
addEventListener('keydown', (e) => {
  if (e.repeat) return; keys.add(e.code);
  if (game.state !== 'playing') return;
  if (e.code === 'Space') { e.preventDefault(); flap(); }
  if (e.code === 'KeyE') peckFrom(camera);
  if (e.code === 'KeyQ') poop();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => {
  if (renderer.xr.isPresenting || !locked() || game.state !== 'playing') return;
  if (e.button === 0) poop(); else if (e.button === 2) peckFrom(camera);
});
addEventListener('mousemove', (e) => {
  if (!locked() || renderer.xr.isPresenting) return;
  player.rotation.y -= e.movementX * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.0022, -1.25, 1.25); camera.rotation.x = pitch;
});
document.addEventListener('pointerlockchange', () => {
  if (renderer.xr.isPresenting) return;
  if (locked()) { if (game.state === 'paused') { game.state = 'playing'; ui.pause.hidden = true; } }
  else if (game.state === 'playing') { game.state = 'paused'; ui.pause.hidden = false; }
});
ui.pause.addEventListener('click', () => renderer.domElement.requestPointerLock?.());
ui.play.addEventListener('click', () => { ui.results.style.display = 'none'; startGame(); });

// ---------------------------------------------------------------- entrada: Meta Quest
const xr = { mx: 0, my: 0, turnLatched: false, flapLatched: false };
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.7 }));
  ray.scale.z = CFG.peckRange / CFG.vrScale; ctrl.add(ray);
  const tip = sph(0.02, C.orange, 0, 0, 0, ctrl, 6); void tip;
  ctrl.visible = false;
  ctrl.addEventListener('connected', () => { ctrl.visible = true; });
  ctrl.addEventListener('disconnected', () => { ctrl.visible = false; });
  ctrl.addEventListener('selectstart', () => {
    if (game.state === 'menu' || game.state === 'over') { ui.results.style.display = 'none'; startGame(); }
    else poop();
  });
  ctrl.addEventListener('squeezestart', () => peckFrom(ctrl));
  player.add(ctrl);
}
const dead = (v) => (Math.abs(v) < 0.18 ? 0 : v);
function pollXR() {
  const session = renderer.xr.getSession(); if (!session) return;
  let mx = 0, my = 0, turn = 0, flapBtn = false;
  for (const src of session.inputSources) {
    const gp = src.gamepad; if (!gp) continue;
    const ax = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0];
    if (src.handedness === 'right') turn = ax[0]; else { mx = ax[0]; my = -ax[1]; }
    if (gp.buttons[4]?.pressed || gp.buttons[5]?.pressed) flapBtn = true;
  }
  xr.mx = dead(mx); xr.my = dead(my);
  if (Math.abs(turn) > 0.6) { if (!xr.turnLatched) { snapTurn(turn > 0 ? -Math.PI / 6 : Math.PI / 6); xr.turnLatched = true; } } else xr.turnLatched = false;
  if (flapBtn && !xr.flapLatched && game.state === 'playing') flap();
  xr.flapLatched = flapBtn;
}
const _h1 = new THREE.Vector3(), _h2 = new THREE.Vector3();
function snapTurn(angle) {
  camera.getWorldPosition(_h1); player.rotation.y += angle; player.updateMatrixWorld(true);
  camera.getWorldPosition(_h2); player.position.add(_h1.sub(_h2)); player.updateMatrixWorld(true);
}
function snapTurnTo(yaw) { snapTurn(yaw - player.rotation.y); }
renderer.xr.addEventListener('sessionstart', () => {
  audio();
  document.body.classList.add('in-xr');
  player.scale.setScalar(CFG.vrScale); camera.rotation.set(0, 0, 0); pitch = 0;
  vrHud.mesh.visible = true; vrHud.dirty = true;
  if (game.state === 'paused') { game.state = 'playing'; ui.pause.hidden = true; }
  if (game.state === 'menu') { banner('GALLINA PRÓFUGA VR'); say('Aprieta el gatillo para empezar · Stick izq. moverte · Stick der. girar · A/X aletear · Agarre picotazo'); vrBanner.hold = true; }
  if (game.state === 'over') { banner('FIN · aprieta el gatillo para reintentar'); vrBanner.hold = true; }
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-xr');
  player.scale.setScalar(1); camera.position.set(0, CFG.eyeHeight, 0); camera.rotation.set(0, 0, 0); pitch = 0;
  vrHud.mesh.visible = false; vrBanner.mesh.visible = false; vrFlash.visible = false;
  if (game.state === 'playing') { game.state = 'paused'; ui.pause.hidden = false; }
});

// ---------------------------------------------------------------- física de la gallina
const playerVel = new THREE.Vector3();
let vy = 0, flaps = CFG.maxFlaps, grounded = true, standingTag = null, bob = 0;
const _fwd = new THREE.Vector3(), _hp = new THREE.Vector3();
function headPos() { return camera.getWorldPosition(_hp); }
function headForward() { camera.getWorldQuaternion(_q); _fwd.set(0, 0, -1).applyQuaternion(_q); _fwd.y = 0; if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1); return _fwd.normalize(); }
function flap() {
  if (game.state !== 'playing' || flaps <= 0) return;
  flaps--; vy = CFG.flapVel; grounded = false; sfx.flap();
}
const inCoop = (x, y, z) => Math.abs(x - COOP.x) < 1.6 && Math.abs(z - COOP.z) < 1.45 && y < 1.6;
function updatePlayer(dt) {
  let mx = 0, my = 0;
  if (renderer.xr.isPresenting) { mx = xr.mx; my = xr.my; }
  else {
    if (keys.has('KeyW') || keys.has('ArrowUp')) my += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) my -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  }
  const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
  const fwd = headForward();
  const rx = -fwd.z, rz = fwd.x;
  playerVel.set((fwd.x * my + rx * mx) * CFG.walkSpeed, 0, (fwd.z * my + rz * mx) * CFG.walkSpeed);

  const head = headPos();
  const pos = { x: head.x + playerVel.x * dt, y: player.position.y, z: head.z + playerVel.z * dt };
  const prevY = pos.y;
  vy -= CFG.gravity * dt; pos.y += vy * dt;
  grounded = false; standingTag = null;
  if (pos.y <= 0) { pos.y = 0; vy = 0; grounded = true; }
  const r = CFG.radius, h = CFG.height;
  for (const b of obstacles) {
    if (pos.x < b.min.x - r || pos.x > b.max.x + r || pos.z < b.min.z - r || pos.z > b.max.z + r) continue;
    if (pos.y >= b.max.y - 1e-3 || pos.y + h <= b.min.y) continue;
    if (vy <= 0 && prevY >= b.max.y - 0.1) { pos.y = b.max.y; vy = 0; grounded = true; standingTag = b.tag; continue; }
    if (vy > 0 && prevY + h <= b.min.y + 0.06) { pos.y = b.min.y - h; vy = 0; continue; }
    const px1 = (b.max.x + r) - pos.x, px2 = pos.x - (b.min.x - r), pz1 = (b.max.z + r) - pos.z, pz2 = pos.z - (b.min.z - r);
    const m = Math.min(px1, px2, pz1, pz2);
    if (m === px1) pos.x = b.max.x + r; else if (m === px2) pos.x = b.min.x - r; else if (m === pz1) pos.z = b.max.z + r; else pos.z = b.min.z - r;
  }
  if (grounded) flaps = CFG.maxFlaps;
  player.position.x += pos.x - head.x; player.position.z += pos.z - head.z; player.position.y = pos.y;
  if (standingTag === 'coopRoof') progress('roof');

  if (!renderer.xr.isPresenting) {
    const moving = len > 0.1 && grounded; bob += dt * (moving ? 11 : 0);
    camera.position.y = CFG.eyeHeight + (moving ? Math.sin(bob) * 0.018 : 0);
    if (moving && Math.random() < dt * 0.25) sfx.cluck();
  }
}

// ---------------------------------------------------------------- IA de los personajes
const _ray = new THREE.Ray(), _box = new THREE.Box3(), _hit = new THREE.Vector3(), _from = new THREE.Vector3(), _to = new THREE.Vector3();
const losBlockers = () => obstacles.filter((o) => o.max.y >= 0.8 && o.tag !== 'fence');
let _los = null;
function hasLOS(from, to) {
  _los ??= losBlockers();
  _ray.origin.copy(from); _ray.direction.subVectors(to, from); const d = _ray.direction.length(); _ray.direction.divideScalar(d);
  for (const o of _los) { _box.min.copy(o.min); _box.max.copy(o.max); if (_ray.intersectBox(_box, _hit) && _hit.distanceTo(from) < d) return false; }
  return true;
}
function npcBlocked(x, z, radius) {
  if (Math.abs(x) > CFG.yard - 0.6 || Math.abs(z) > CFG.yard - 0.6) return true;
  if (Math.abs(x - COOP.x) < 2.2 + radius && Math.abs(z - COOP.z) < 2.0 + radius) return true;
  if (Math.abs(x - PEN.x) < PEN.half + radius && Math.abs(z - PEN.z) < PEN.half + radius) return true;
  for (const o of obstacles) {
    if (o.max.y < 0.35 || o.tag === 'fence' || o.tag === 'pen') continue;
    if (x > o.min.x - radius && x < o.max.x + radius && z > o.min.z - radius && z < o.max.z + radius) return true;
  }
  return false;
}
const steerAngles = [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, 2.6, -2.6];
function moveNPC(npc, tx, tz, speed, dt) {
  const p = npc.g.position; let dx = tx - p.x, dz = tz - p.z; const dist = Math.hypot(dx, dz);
  npc.moving = false;
  if (dist < 0.15) return true;
  dx /= dist; dz /= dist; const step = Math.min(speed * dt, dist);
  for (const a of steerAngles) {
    const c = Math.cos(a), s = Math.sin(a), ddx = dx * c - dz * s, ddz = dx * s + dz * c;
    const nx = p.x + ddx * step, nz = p.z + ddz * step;
    if (npcBlocked(nx, nz, npc.radius)) continue;
    p.x = nx; p.z = nz; npc.heading = Math.atan2(ddx, ddz); npc.moving = true; break;
  }
  const t = npc.heading, cur = npc.g.rotation.y; let d = t - cur; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
  npc.g.rotation.y = cur + d * Math.min(1, dt * 9);
  return dist < 0.35;
}
function animateHuman(npc, dt, runMult = 1) {
  npc.phase += dt * (npc.moving ? 6.5 * runMult : 0);
  const sw = npc.moving ? Math.sin(npc.phase) * 0.65 : 0;
  npc.legs[0].rotation.x = sw; npc.legs[1].rotation.x = -sw;
  npc.arms[0].rotation.x = -sw * 0.7;
  if (npc === farmer && farmer.state === 'chase') npc.arms[1].rotation.x = -2.3 + Math.sin(npc.phase * 2) * 0.35;
  else if (npc === wife && wife.state === 'flee') npc.arms[1].rotation.x = -2.6;
  else npc.arms[1].rotation.x = sw * 0.7;
  if (!npc.moving && npc.state !== 'stunned') npc.legs[0].rotation.x = npc.legs[1].rotation.x = 0;
}
function trackStuck(npc, dt) {
  const p = npc.g.position;
  if (p.distanceToSquared(npc.lastPos) < 0.0004) npc.stuck += dt; else npc.stuck = 0;
  npc.lastPos.copy(p);
  return npc.stuck > 1.5;
}
function updateFarmer(dt) {
  const head = headPos(); const feetY = player.position.y;
  const p = farmer.g.position; const dist = Math.hypot(head.x - p.x, head.z - p.z);
  const playing = game.state === 'playing';
  const chickenSafe = inCoop(head.x, feetY, head.z);
  if (farmer.rage > 0) farmer.rage -= dt;
  _from.set(p.x, 1.6, p.z); _to.set(head.x, feetY + 0.3, head.z);
  const sees = playing && !chickenSafe && dist < 9.5 && (farmer.rage > 0 || hasLOS(_from, _to));

  if (farmer.state === 'stunned') {
    farmer.timer -= dt; farmer.moving = false;
    farmer.g.rotation.y += dt * 1.5;
    if (farmer.timer <= 0) farmer.state = 'patrol';
  } else if (farmer.state === 'patrol') {
    const wp = yardWaypoints[farmer.wpi];
    if (moveNPC(farmer, wp[0], wp[1], farmer.speed, dt) || trackStuck(farmer, dt)) { farmer.wpi = (farmer.wpi + 1) % yardWaypoints.length; farmer.stuck = 0; }
    if (sees) { farmer.state = 'chase'; farmer.lost = 0; sfx.yell(); say(['Don Ramiro: "¡Ven acá, pollo del demonio!"', 'Don Ramiro: "¡Hoy hay caldo!"', 'Don Ramiro: "¡No corras, que es peor!"'][Math.floor(Math.random() * 3)]); }
  } else if (farmer.state === 'chase') {
    const mult = farmer.rage > 0 ? 1.3 : 1;
    if (chickenSafe) {
      // Se queda rondando la entrada del gallinero un rato y luego se aburre.
      moveNPC(farmer, COOP.x, COOP.z - 2.6, farmer.chaseSpeed * mult, dt);
      farmer.lost += dt;
      if (farmer.lost > 4) { farmer.state = 'wait'; farmer.timer = 3.5; say('Don Ramiro: "Ya saldrás, gallina cobarde…"'); }
    } else {
      moveNPC(farmer, head.x, head.z, farmer.chaseSpeed * mult, dt);
      if (sees) farmer.lost = 0; else farmer.lost += dt;
      if (dist > 14 || farmer.lost > 3) { farmer.state = 'patrol'; say('Don Ramiro: "¿Dónde se metió ese pollo?"'); }
      if (trackStuck(farmer, dt)) { farmer.stuck = 0; farmer.state = 'wait'; farmer.timer = 3.5; say('Don Ramiro: "Bájate de ahí, pollo… ya te agarraré."'); }
    }
    if (playing && dist < CFG.catchRadius && feetY < 1.45 && !chickenSafe) caught();
  } else if (farmer.state === 'wait') {
    farmer.timer -= dt; farmer.moving = false;
    if (farmer.timer <= 0) { farmer.state = 'patrol'; farmer.wpi = 4; }
    if (sees && !chickenSafe) { farmer.state = 'chase'; farmer.lost = 0; }
  }
  animateHuman(farmer, dt, farmer.state === 'chase' ? 1.4 : 1);
}
function updateWife(dt) {
  if (!wife.active) return;
  if (wife.state === 'flee') {
    wife.timer -= dt;
    const t = wife.g.position.clone().addScaledVector(wife.fleeDir, 3);
    if (!moveNPC(wife, t.x, t.z, 2.6, dt) && !wife.moving) wife.fleeDir.set(Math.random() - 0.5, 0, Math.random() - 0.5).normalize();
    if (Math.random() < dt * 0.8) sfx.scream();
    if (wife.timer <= 0) wife.state = 'wander';
  } else {
    const wp = wifeWaypoints[wife.wpi];
    if (moveNPC(wife, wp[0], wp[1], wife.speed, dt) || trackStuck(wife, dt)) { wife.wpi = (wife.wpi + 1) % wifeWaypoints.length; wife.stuck = 0; }
  }
  animateHuman(wife, dt, wife.state === 'flee' ? 1.6 : 1);
}
function updatePig(dt) {
  pig.timer -= dt;
  if (pig.timer <= 0) { pig.timer = 3 + Math.random() * 4; pig.target.set(PEN.x + (Math.random() - 0.5) * 4.4, 0, PEN.z + (Math.random() - 0.5) * 4.4); }
  const p = pig.g.position, dx = pig.target.x - p.x, dz = pig.target.z - p.z, d = Math.hypot(dx, dz);
  const sp = pig.wobble > 0 ? 2.4 : 0.6;
  if (d > 0.1) { p.x += dx / d * sp * dt; p.z += dz / d * sp * dt; const t = Math.atan2(dx, dz); let dd = t - pig.g.rotation.y; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2; pig.g.rotation.y += dd * Math.min(1, dt * 6); pig.phase += dt * sp * 4; }
  p.x = THREE.MathUtils.clamp(p.x, PEN.x - 2.3, PEN.x + 2.3); p.z = THREE.MathUtils.clamp(p.z, PEN.z - 2.3, PEN.z + 2.3);
  if (pig.wobble > 0) { pig.wobble -= dt; pig.g.rotation.z = Math.sin(pig.wobble * 30) * 0.2; } else pig.g.rotation.z = 0;
  pig.g.position.y = Math.abs(Math.sin(pig.phase)) * 0.03;
}
function updateHens(dt) {
  for (const h of hens) {
    h.timer -= dt;
    const p = h.g.position;
    if (h.timer <= 0) { h.timer = 2 + Math.random() * 4; h.target.set(THREE.MathUtils.clamp(p.x + (Math.random() - 0.5) * 8, -15, 15), 0, THREE.MathUtils.clamp(p.z + (Math.random() - 0.5) * 8, -15, 15)); }
    const dx = h.target.x - p.x, dz = h.target.z - p.z, d = Math.hypot(dx, dz);
    if (d > 0.2) {
      const nx = p.x + dx / d * 0.9 * dt, nz = p.z + dz / d * 0.9 * dt;
      if (!npcBlocked(nx, nz, 0.25)) { p.x = nx; p.z = nz; h.g.rotation.y = Math.atan2(dx, dz); h.phase += dt * 10; } else h.timer = 0;
    }
    if (h.hop > 0) { h.hop -= dt; p.y = Math.sin(Math.max(0, h.hop) * Math.PI * 2) * 0.2; h.g.rotation.y += dt * 12; } else p.y = Math.abs(Math.sin(h.phase)) * 0.02;
  }
}

// ---------------------------------------------------------------- maíz / temporizadores
function updateCorn(dt) {
  const head = headPos(); const feetY = player.position.y;
  for (const c of cornItems) {
    c.spin += dt; c.g.rotation.y = c.spin * 1.4; c.g.position.y = Math.sin(c.spin * 2.5) * 0.04;
    if (!c.active) { c.timer -= dt; if (c.timer <= 0) { c.active = true; c.g.visible = true; c.g.position.copy(randomSpot()); } continue; }
    const dx = head.x - c.g.position.x, dz = head.z - c.g.position.z;
    if (dx * dx + dz * dz < 0.42 * 0.42 && feetY < 0.6) {
      c.active = false; c.g.visible = false; c.timer = 14 + Math.random() * 6;
      game.charges = Math.min(CFG.maxPoop, game.charges + 1); game.score += 10; sfx.eat(); progress('corn'); say('¡Ñam! Maíz +1 popó'); refreshHUD();
    }
  }
}

// ---------------------------------------------------------------- bucle principal
const clock = new THREE.Clock();
function update(dt) {
  game.time += dt;
  for (let i = anims.length - 1; i >= 0; i--) { const a = anims[i]; a.t += dt; const k = Math.min(1, a.t / a.dur); a.fn(k); if (k >= 1) { anims.splice(i, 1); a.done?.(); } }
  const s = game.state;
  if (s === 'playing') {
    updatePlayer(dt); updatePoops(dt); updateCorn(dt);
    game.cooldown = Math.max(0, game.cooldown - dt);
    game.regen += dt; if (game.regen >= CFG.poopRegen && game.charges < CFG.maxPoop) { game.regen = 0; game.charges++; refreshHUD(); }
    const head = headPos();
    if (!inCoop(head.x, player.position.y, head.z)) {
      for (const m of game.missions) if (m.type === 'survive' && !m.complete) { m.done = Math.min(m.need, m.done + dt); if (m.done >= m.need) progress('survive', 0.001); else if (Math.floor(m.done) !== Math.floor(m.done - dt)) refreshHUD(); }
    }
  } else if (s === 'caught' || s === 'levelup') {
    game.timer -= dt; updatePoops(dt);
    if (game.timer <= 0) {
      if (s === 'caught') { if (game.lives <= 0) gameOver(); else { respawnPlayer(); game.state = 'playing'; } }
      else { loadLevel(game.level + 1); game.state = 'playing'; }
    }
  }
  if (s !== 'paused') { updateFarmer(dt); updateWife(dt); updatePig(dt); updateHens(dt); }

  if (bannerTimer > 0) { bannerTimer -= dt; if (bannerTimer <= 0) ui.banner.classList.remove('show'); }
  if (sayTimer > 0) { sayTimer -= dt; if (sayTimer <= 0) ui.hint.textContent = ''; }
  if (vrBanner.timer > 0 && !vrBanner.hold) { vrBanner.timer -= dt; if (vrBanner.timer <= 0) { vrBanner.text = ''; vrBanner.sub = ''; vrBanner.mesh.visible = false; } }
  if (vrHud.dirty && renderer.xr.isPresenting) drawVRHud();
}
renderer.setAnimationLoop((_, frame) => {
  const dt = Math.min(clock.getDelta(), 0.05);
  if (frame) pollXR();
  update(dt);
  renderer.render(scene, camera);
});
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });

// ---------------------------------------------------------------- arranque
buildFarm(); buildCorn();
player.position.set(COOP.x, 0, COOP.z + 0.2);
refreshHUD();
ui.best.textContent = game.best.level > 0
  ? `Tu récord: nivel ${game.best.level} · ${game.best.score} puntos. La popó sale por atrás: date la vuelta o tírala desde arriba.`
  : ui.best.textContent;

// Ganchos de depuración/pruebas automáticas (no afectan al juego).
window.__gallina = { game, player, camera, scene, farmer, wife, pig, hens, cornItems, update, progress, poop, flap, peckFrom, startGame, caught, obstacles, keys, renderer, loadLevel, levelUp };
