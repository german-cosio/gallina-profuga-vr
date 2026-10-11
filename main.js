/**
 * Gallina Prófuga VR — eres una gallina en una granja y el granjero quiere degollarte.
 * Estilo "I Am Cat": misiones de caos (popó y huevazos a la gente, tirar cubetas, picotear al
 * cerdo…), vuelo con energía, vista en primera o tercera persona y niveles con dificultad creciente.
 * WebXR para Meta Quest 3 / 3S + modo escritorio. Three.js r180 desde el CDN fijado en index.html.
 * Todo (texturas, modelos, sonido) se genera en código: sin assets externos.
 */
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const CFG = {
  walkSpeed: 3.0, gravity: 7.5, flapVel: 3.95, flapCost: 8, flapInterval: 0.28, stamina: 100,
  staminaRegenGround: 32, staminaRegenAir: 3, glideGravity: 0.45, glideSpeed: 1.3, ceiling: 18,
  radius: 0.22, height: 0.42, eyeHeight: 0.4,
  vrScaleFirst: 0.26, vrScaleThird: 0.6,   // en VR el jugador se encoge: así el granjero se ve gigante
  thirdDist: 2.4, thirdHeight: 0.55, vrThirdBack: 1.2,
  poopCooldown: 0.4, maxPoop: 5, poopRegen: 9, startPoop: 3,
  maxEggs: 6, eggRegen: 7, startEggs: 4, eggSpeed: 19, eggCooldown: 0.3,
  catchRadius: 0.8, lives: 3, peckRange: 1.15, yard: 34,
};
const STORAGE_KEY = 'gallina-profuga-vr-best-v2';
const COOP = { x: 18, z: 14 };
const PEN = { x: -16, z: 16, half: 4 };
const PASTURE = { x: 22, z: -18, half: 6 };
const WINDMILL = { x: -4, z: -28 };
const POND = { x: 0, z: 25, r: 6 };

const $ = (id) => document.getElementById(id);
const ui = {
  interface: $('interface'), play: $('playButton'), results: $('results'), subtitle: $('panelSubtitle'),
  level: $('levelLabel'), lives: $('livesLabel'), score: $('scoreLabel'), poop: $('poopLabel'), eggs: $('eggLabel'), stamina: $('staminaBar'),
  missions: $('missionList'), banner: $('banner'), hint: $('hint'), pause: $('pause'), flash: $('flash'), best: $('bestText'), viewBtn: $('viewButton'),
};

// ---------------------------------------------------------------- renderer / escena / rig
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
renderer.domElement.className = 'webgl';
document.body.appendChild(renderer.domElement);
document.body.appendChild(VRButton.createButton(renderer));

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc9e6ff, 60, 260);
scene.add(new THREE.HemisphereLight(0xdbeeff, 0x55803a, 0.75));
const sun = new THREE.DirectionalLight(0xfff2d8, 2.6);
sun.position.set(26, 42, 18); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 1; sun.shadow.camera.far = 140;
sun.shadow.camera.left = sun.shadow.camera.bottom = -34; sun.shadow.camera.right = sun.shadow.camera.top = 34;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun); scene.add(sun.target);

// Cielo con gradiente (la misma esfera sirve de entorno para los reflejos PBR).
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { top: { value: new THREE.Color(0x2f6fd6) }, horizon: { value: new THREE.Color(0xcfe8ff) }, sunDir: { value: new THREE.Vector3(26, 42, 18).normalize() } },
  vertexShader: 'varying vec3 vW; void main(){ vW = (modelMatrix * vec4(position,1.0)).xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: 'uniform vec3 top, horizon, sunDir; varying vec3 vW; void main(){ vec3 d = normalize(vW); float h = clamp(d.y, 0.0, 1.0); vec3 c = mix(horizon, top, pow(h, 0.55)); float s = max(dot(d, sunDir), 0.0); c += vec3(1.0, 0.92, 0.7) * (pow(s, 600.0) * 1.6 + pow(s, 12.0) * 0.18); gl_FragColor = vec4(c, 1.0); }',
});
scene.add(new THREE.Mesh(new THREE.SphereGeometry(900, 24, 12), skyMat));
{
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene(); envScene.add(new THREE.Mesh(new THREE.SphereGeometry(50, 24, 12), skyMat));
  const ground = new THREE.Mesh(new THREE.CircleGeometry(60, 24), new THREE.MeshBasicMaterial({ color: 0x5a8c34 })); ground.rotation.x = -Math.PI / 2; ground.position.y = -1; envScene.add(ground);
  scene.environment = pmrem.fromScene(envScene, 0.02).texture; scene.environmentIntensity = 0.55; pmrem.dispose();
}

// El rig "player" lleva la cámara (y los controles en VR). La gallina es una entidad aparte:
// en primera persona el rig va pegado a ella; en tercera la cámara la sigue por detrás.
const player = new THREE.Group();
scene.add(player);
const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.05, 1200);
camera.position.set(0, CFG.eyeHeight, 0);
player.add(camera);
let view = 'third';

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
  crack() { noise(0.08, 0.12, 2200); tone(420, 0.1, 'triangle', 0.05, -200); },
  lay() { tone(660, 0.07, 'square', 0.035, 250); tone(990, 0.1, 'square', 0.03, 150, 0.08); },
  shoot() { noise(0.06, 0.05, 1500); tone(300, 0.08, 'sine', 0.04, 400); },
  eat() { tone(880, 0.05, 'square', 0.04, 200); tone(1100, 0.06, 'square', 0.04, 200, 0.06); },
  peck() { tone(900, 0.04, 'square', 0.05, -400); },
  bonk() { tone(180, 0.15, 'triangle', 0.07, -100); },
  grunt() { tone(120, 0.25, 'sawtooth', 0.06, 40); tone(95, 0.2, 'sawtooth', 0.05, 20, 0.2); },
  moo() { tone(150, 0.5, 'sawtooth', 0.06, -40); tone(110, 0.45, 'triangle', 0.05, -20, 0.15); },
  yell() { tone(300, 0.3, 'sawtooth', 0.07, -120); },
  dizzy() { [500, 420, 360, 300].forEach((f, i) => tone(f, 0.12, 'sine', 0.05, -40, i * 0.1)); },
  scream() { tone(900, 0.35, 'sawtooth', 0.05, 500); },
  caught() { [220, 180, 140, 90].forEach((f, i) => tone(f, 0.26, 'sawtooth', 0.08, -30, i * 0.14)); },
  level() { [523, 659, 784, 1046, 1318].forEach((f, i) => tone(f, 0.2, 'triangle', 0.07, 0, i * 0.11)); },
  done() { tone(1200, 0.08, 'triangle', 0.05); tone(1600, 0.12, 'triangle', 0.05, 0, 0.08); },
  tick() { tone(1500, 0.03, 'sine', 0.03); },
  swap() { tone(800, 0.06, 'sine', 0.04, 300); },
};

// ---------------------------------------------------------------- texturas procedurales
const rnd = Math.random;
const maxAniso = renderer.capabilities.getMaxAnisotropy();
function canvasTex(size, draw, repeat = 1) {
  const c = document.createElement('canvas'); c.width = c.height = size; const ctx = c.getContext('2d');
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat, repeat);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = Math.min(8, maxAniso); return t;
}
function speckle(ctx, size, n, colors, minS, maxS, alpha = 0.7) {
  for (let i = 0; i < n; i++) { ctx.fillStyle = colors[(rnd() * colors.length) | 0]; ctx.globalAlpha = alpha * (0.4 + rnd() * 0.6); const s = minS + rnd() * (maxS - minS); ctx.fillRect(rnd() * size, rnd() * size, s, s); }
  ctx.globalAlpha = 1;
}
function strokes(ctx, size, n, colors, len, width, angle = null) {
  ctx.lineWidth = width;
  for (let i = 0; i < n; i++) { ctx.strokeStyle = colors[(rnd() * colors.length) | 0]; ctx.globalAlpha = 0.35 + rnd() * 0.5; const x = rnd() * size, y = rnd() * size, a = angle ?? rnd() * Math.PI * 2, l = len * (0.5 + rnd()); ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); ctx.stroke(); }
  ctx.globalAlpha = 1;
}
function planks(ctx, size, base, dark, light, count, vertical = true) {
  ctx.fillStyle = base; ctx.fillRect(0, 0, size, size);
  const w = size / count;
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = i % 2 ? light : base; ctx.globalAlpha = 0.25 + rnd() * 0.3;
    if (vertical) ctx.fillRect(i * w, 0, w, size); else ctx.fillRect(0, i * w, size, w);
    ctx.globalAlpha = 1; ctx.fillStyle = dark;
    if (vertical) ctx.fillRect(i * w, 0, 3, size); else ctx.fillRect(0, i * w, size, 3);
  }
  strokes(ctx, size, 900, [dark, light], 60, 1, vertical ? Math.PI / 2 : 0);
}
const TEX = {
  grass: canvasTex(512, (c, s) => { c.fillStyle = '#5a9436'; c.fillRect(0, 0, s, s); speckle(c, s, 5000, ['#4e8a2e', '#6fae3d', '#86bf4a', '#3f7524', '#7fb344'], 1, 4); strokes(c, s, 2500, ['#3f7524', '#8bc455', '#5c9a39'], 9, 1.2); }, 90),
  dirt: canvasTex(512, (c, s) => { c.fillStyle = '#9a7044'; c.fillRect(0, 0, s, s); speckle(c, s, 4000, ['#8a6239', '#a97d4e', '#7a5531', '#b08a5c', '#6e4c2c'], 1, 5); for (let i = 0; i < 160; i++) { c.fillStyle = ['#7d7d78', '#9b968d', '#6a655c'][i % 3]; c.globalAlpha = 0.8; c.beginPath(); c.ellipse(rnd() * s, rnd() * s, 1 + rnd() * 3, 1 + rnd() * 2, rnd() * 3, 0, 7); c.fill(); } c.globalAlpha = 1; }, 12),
  planks: canvasTex(512, (c, s) => planks(c, s, '#8a5a2b', '#4f3016', '#a8743c', 6)),
  planksH: canvasTex(512, (c, s) => planks(c, s, '#9a6a36', '#56351a', '#b8844a', 6, false)),
  barn: canvasTex(512, (c, s) => planks(c, s, '#a8342a', '#5e1c15', '#c2453a', 8)),
  hay: canvasTex(512, (c, s) => { c.fillStyle = '#d4b24a'; c.fillRect(0, 0, s, s); strokes(c, s, 5000, ['#e8cc63', '#b8943a', '#f1dc7d', '#9c7a2b'], 28, 1.3); }, 2),
  shingles: canvasTex(512, (c, s) => { c.fillStyle = '#5a3a28'; c.fillRect(0, 0, s, s); const h = s / 10, w = s / 8; for (let r = 0; r < 10; r++) for (let i = -1; i < 9; i++) { const x = i * w + (r % 2 ? w / 2 : 0); c.fillStyle = ['#6a4531', '#4e3222', '#75503a'][(rnd() * 3) | 0]; c.fillRect(x + 1, r * h + 1, w - 2, h - 2); } speckle(c, s, 1500, ['#3f2619', '#80593f'], 1, 3); }, 3),
  tin: canvasTex(256, (c, s) => { c.fillStyle = '#8f9aa3'; c.fillRect(0, 0, s, s); for (let i = 0; i < 8; i++) { c.fillStyle = '#b3bcc4'; c.fillRect(i * 32, 0, 10, s); c.fillStyle = '#6c757d'; c.fillRect(i * 32 + 22, 0, 6, s); } speckle(c, s, 600, ['#7a6a55', '#5d6670'], 1, 3, 0.4); }, 4),
  denim: canvasTex(256, (c, s) => { c.fillStyle = '#3b5f9d'; c.fillRect(0, 0, s, s); speckle(c, s, 4000, ['#34558e', '#4468a8', '#2e4d80', '#5579b5'], 1, 2); }, 2),
  plaid: canvasTex(256, (c, s) => { c.fillStyle = '#c43e32'; c.fillRect(0, 0, s, s); c.fillStyle = '#8f2a22'; for (let i = 0; i < s; i += 40) { c.fillRect(i, 0, 9, s); c.fillRect(0, i, s, 9); } c.fillStyle = '#f0d9b5'; c.globalAlpha = 0.5; for (let i = 20; i < s; i += 40) { c.fillRect(i, 0, 3, s); c.fillRect(0, i, s, 3); } c.globalAlpha = 1; }, 2),
  dress: canvasTex(256, (c, s) => { c.fillStyle = '#7a4aa8'; c.fillRect(0, 0, s, s); for (let i = 0; i < 90; i++) { c.fillStyle = ['#f6d8e8', '#ffe9a8', '#cfe9ff'][i % 3]; c.beginPath(); c.arc(rnd() * s, rnd() * s, 3 + rnd() * 3, 0, 7); c.fill(); } }, 3),
  apron: canvasTex(256, (c, s) => { c.fillStyle = '#fff1d6'; c.fillRect(0, 0, s, s); speckle(c, s, 300, ['#e8cfa6', '#f8e3c4'], 2, 5); }, 2),
  cow: canvasTex(512, (c, s) => { c.fillStyle = '#f4efe6'; c.fillRect(0, 0, s, s); for (let i = 0; i < 14; i++) { c.fillStyle = '#1e1a18'; c.beginPath(); c.ellipse(rnd() * s, rnd() * s, 30 + rnd() * 60, 25 + rnd() * 45, rnd() * 3, 0, 7); c.fill(); } }, 1),
  pig: canvasTex(256, (c, s) => { c.fillStyle = '#f2a9b8'; c.fillRect(0, 0, s, s); speckle(c, s, 2500, ['#e898aa', '#f8bcc8', '#dc8d9e'], 1, 3); }, 2),
  leaf: canvasTex(256, (c, s) => { c.fillStyle = '#3f8a37'; c.fillRect(0, 0, s, s); speckle(c, s, 4500, ['#2f6f2a', '#56a44a', '#6fbf5a', '#275f23', '#8ccf6a'], 2, 6); }, 2),
  bark: canvasTex(256, (c, s) => { c.fillStyle = '#5e4026'; c.fillRect(0, 0, s, s); strokes(c, s, 700, ['#3d2816', '#7a5635', '#4a3119'], 90, 2, Math.PI / 2); speckle(c, s, 800, ['#3d2816', '#8a6440'], 1, 3); }, 2),
  stone: canvasTex(256, (c, s) => { c.fillStyle = '#8d8d8d'; c.fillRect(0, 0, s, s); for (let i = 0; i < 70; i++) { c.fillStyle = ['#7a7a76', '#9d9c96', '#6b6a66', '#a9a79f'][i % 4]; c.beginPath(); c.ellipse(rnd() * s, rnd() * s, 10 + rnd() * 22, 8 + rnd() * 16, rnd() * 3, 0, 7); c.fill(); c.strokeStyle = '#4e4d4a'; c.lineWidth = 2; c.stroke(); } }, 3),
  skin: canvasTex(128, (c, s) => { c.fillStyle = '#f1c7a0'; c.fillRect(0, 0, s, s); speckle(c, s, 600, ['#e7b58e', '#f7d4b1', '#dca47e'], 1, 3, 0.4); }),
  feather: canvasTex(256, (c, s) => { c.fillStyle = '#f7f3ea'; c.fillRect(0, 0, s, s); strokes(c, s, 1500, ['#e6e0d3', '#ffffff', '#d9d2c3'], 30, 1.4, Math.PI / 2); }, 2),
  metal: canvasTex(256, (c, s) => { c.fillStyle = '#9aa4ad'; c.fillRect(0, 0, s, s); strokes(c, s, 900, ['#7d8891', '#b9c3cb', '#6f7a84'], 40, 1); speckle(c, s, 400, ['#8a6a4a', '#5e6a73'], 1, 3, 0.35); }, 2),
  water: canvasTex(256, (c, s) => { c.fillStyle = '#4b9ad4'; c.fillRect(0, 0, s, s); strokes(c, s, 500, ['#6fb3e6', '#3a85c0', '#8fc8f0'], 60, 2, 0); }, 4),
  blade: (() => { const t = canvasTex(128, (c, s) => { c.clearRect(0, 0, s, s); for (let i = 0; i < 7; i++) { const x = 14 + i * 16 + rnd() * 6, h = 60 + rnd() * 60, bend = (rnd() - 0.5) * 30; c.fillStyle = ['#4f9a32', '#6fbf49', '#3d7d27', '#86c95c'][i % 4]; c.beginPath(); c.moveTo(x - 4, s); c.quadraticCurveTo(x + bend, s - h / 2, x + bend * 1.3, s - h); c.lineTo(x + 4, s); c.fill(); } }); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.repeat.set(1, 1); return t; })(),
};

// ---------------------------------------------------------------- constructores de geometría
const matCache = new Map();
function mat(key, opts = {}) {
  if (matCache.has(key)) return matCache.get(key);
  let m;
  if (typeof key === 'number') m = new THREE.MeshStandardMaterial({ color: key, roughness: 0.85, metalness: 0.0, ...opts });
  else { const t = TEX[key]; m = new THREE.MeshStandardMaterial({ map: t, bumpMap: t, bumpScale: 0.6, roughness: 0.9, metalness: 0.0, ...opts }); }
  matCache.set(key, m); return m;
}
mat('metal', { roughness: 0.45, metalness: 0.7, bumpScale: 0.3 });
mat('tin', { roughness: 0.5, metalness: 0.6, bumpScale: 0.3 });
mat('water', { roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.86, bumpScale: 0.2 });
mat('skin', { roughness: 0.7, bumpScale: 0.15 });
mat('feather', { roughness: 0.8, bumpScale: 0.3 });
mat('grass', { roughness: 1.0, bumpScale: 0.8 });
mat('dirt', { roughness: 1.0, bumpScale: 1.0 });
function shadowed(m, cast = true, receive = true) { m.castShadow = cast; m.receiveShadow = receive; return m; }
function box(w, h, d, key, x, y, z, parent = scene, shadow = true) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(key)); m.position.set(x, y + h / 2, z); parent.add(m); if (shadow) shadowed(m); return m;
}
function cyl(rt, rb, h, key, x, y, z, parent = scene, seg = 12, shadow = true) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(key)); m.position.set(x, y + h / 2, z); parent.add(m); if (shadow) shadowed(m); return m;
}
function sph(r, key, x, y, z, parent = scene, seg = 12, shadow = true) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(6, seg - 2)), mat(key)); m.position.set(x, y, z); parent.add(m); if (shadow) shadowed(m); return m;
}
function cone(r, h, key, x, y, z, parent = scene, seg = 10, shadow = true) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, seg), mat(key)); m.position.set(x, y + h / 2, z); parent.add(m); if (shadow) shadowed(m); return m;
}
function instanced(geo, key, items, { shadow = true, colors = null } = {}) {
  const im = new THREE.InstancedMesh(geo, mat(key), items.length); const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), s3 = new THREE.Vector3(), p3 = new THREE.Vector3();
  items.forEach((it, i) => { p3.set(it.x, it.y ?? 0, it.z); e.set(it.rx ?? 0, it.ry ?? 0, it.rz ?? 0); q.setFromEuler(e); s3.setScalar(it.s ?? 1); if (it.sy) s3.y = it.sy; m4.compose(p3, q, s3); im.setMatrixAt(i, m4); if (colors) im.setColorAt(i, colors[i % colors.length]); });
  if (shadow) shadowed(im, true, true); scene.add(im); return im;
}

// Obstáculos: cajas alineadas a los ejes. La gallina choca con ellas y puede pararse encima.
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
const C = { wood: 0x8a5a2b, roof: 0x5c3a28, skin: 0xf1c7a0, white: 0xfafafa, red: 0xd63a2f, yellow: 0xf2c230, orange: 0xf08a24, leaf: 0x3f8f3a, poop: 0x5a3b1f, corn: 0xffd43b, cornLeaf: 0x5aa84a, bucket: 0x7c8a95, dark: 0x2a2a2a, cloud: 0xffffff, egg: 0xfff3dc, yolk: 0xffc226 };
const buckets = [];
let scarecrow = null, windmillBlades = null;

function fenceRun(x1, z1, x2, z2, posts, h = 1.1, step = 2.5) {
  const dx = x2 - x1, dz = z2 - z1, len = Math.hypot(dx, dz), n = Math.round(len / step), ry = -Math.atan2(dz, dx);
  for (let i = 0; i <= n; i++) posts.push({ x: x1 + dx * i / n, z: z1 + dz * i / n, sy: h / 1.1 });
  for (const y of [h * 0.4, h * 0.78]) { const r = box(len, 0.08, 0.06, 'planksH', (x1 + x2) / 2, y, (z1 + z2) / 2); r.rotation.y = ry; }
}

function buildFarm() {
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(700, 700), mat('grass')); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const yard = new THREE.Mesh(new THREE.CircleGeometry(22, 40), mat('dirt')); yard.rotation.x = -Math.PI / 2; yard.position.set(-2, 0.012, -4); yard.receiveShadow = true; scene.add(yard);
  for (const [x, z, w, d, ry] of [[12, 6, 5, 30, 0.6], [-14, -2, 5, 26, -0.7], [0, 16, 4, 20, 0.1]]) { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, d), mat('dirt')); p.rotation.x = -Math.PI / 2; p.rotation.z = ry; p.position.set(x, 0.011, z); p.receiveShadow = true; scene.add(p); }

  // Cerca perimetral y de corrales (postes instanciados) + paredes invisibles muy altas.
  const Y = CFG.yard, posts = [];
  fenceRun(-Y, -Y, Y, -Y, posts); fenceRun(-Y, Y, Y, Y, posts); fenceRun(-Y, -Y, -Y, Y, posts); fenceRun(Y, -Y, Y, Y, posts);
  block(0, -Y, Y * 2 + 2, 60, 0.3, 'fence'); block(0, Y, Y * 2 + 2, 60, 0.3, 'fence'); block(-Y, 0, 0.3, 60, Y * 2 + 2, 'fence'); block(Y, 0, 0.3, 60, Y * 2 + 2, 'fence');
  const { x: px, z: pz, half: ph } = PEN;
  fenceRun(px - ph, pz - ph, px + ph, pz - ph, posts, 0.65, 1.6); fenceRun(px - ph, pz + ph, px + ph, pz + ph, posts, 0.65, 1.6); fenceRun(px - ph, pz - ph, px - ph, pz + ph, posts, 0.65, 1.6); fenceRun(px + ph, pz - ph, px + ph, pz + ph, posts, 0.65, 1.6);
  block(px, pz - ph, ph * 2, 0.55, 0.15, 'pen'); block(px, pz + ph, ph * 2, 0.55, 0.15, 'pen'); block(px - ph, pz, 0.15, 0.55, ph * 2, 'pen'); block(px + ph, pz, 0.15, 0.55, ph * 2, 'pen');
  const mud = new THREE.Mesh(new THREE.CircleGeometry(3, 18), mat(0x6f5236, { roughness: 0.6 })); mud.rotation.x = -Math.PI / 2; mud.position.set(px, 0.015, pz); mud.receiveShadow = true; scene.add(mud);
  const { x: cx2, z: cz2, half: ch } = PASTURE;
  fenceRun(cx2 - ch, cz2 - ch, cx2 + ch, cz2 - ch, posts, 1.0, 2); fenceRun(cx2 - ch, cz2 + ch, cx2 + ch, cz2 + ch, posts, 1.0, 2); fenceRun(cx2 - ch, cz2 - ch, cx2 - ch, cz2 + ch, posts, 1.0, 2); fenceRun(cx2 + ch, cz2 - ch, cx2 + ch, cz2 + ch, posts, 1.0, 2);
  block(cx2, cz2 - ch, ch * 2, 0.95, 0.15, 'pasture'); block(cx2, cz2 + ch, ch * 2, 0.95, 0.15, 'pasture'); block(cx2 - ch, cz2, 0.15, 0.95, ch * 2, 'pasture'); block(cx2 + ch, cz2, 0.15, 0.95, ch * 2, 'pasture');
  instanced(new THREE.BoxGeometry(0.16, 1.1, 0.16).translate(0, 0.55, 0), 'planks', posts);

  // Granero con silo
  const bx = -20, bz = -16;
  box(12, 7, 9, 'barn', bx, 0, bz); block(bx, bz, 12, 9, 9, 'barn');
  box(2.6, 3.6, 0.25, 'planks', bx, 0, bz + 4.55); box(0.08, 3.6, 0.3, 0x3a2414, bx, 0, bz + 4.6);
  for (const s of [-1, 1]) { const r = box(7.2, 0.3, 9.8, 'shingles', bx + s * 3.0, 6.9, bz); r.rotation.z = -s * 0.56; r.position.y = 8.2; }
  box(1.2, 1.2, 0.2, 0xd9e8f5, bx, 4.8, bz + 4.55); box(1.6, 0.8, 0.25, 'planks', bx + 4.4, 5.6, bz + 4.55);
  cyl(3, 3, 12, 'tin', -30, 0, -12, scene, 20); cone(3.3, 2.2, 'tin', -30, 12, -12, scene, 20); block(-30, -12, 6, 14, 6, 'silo');

  // Gallinero: 3 paredes + techo, abierto hacia el patio (-z). Es zona segura.
  const cx = COOP.x, cz = COOP.z;
  box(3.2, 1.75, 0.12, 'planks', cx, 0, cz + 1.25); block(cx, cz + 1.25, 3.2, 1.75, 0.12, 'coop');
  for (const s of [-1, 1]) { box(0.12, 1.75, 2.6, 'planks', cx + s * 1.55, 0, cz); block(cx + s * 1.55, cz, 0.12, 1.75, 2.6, 'coop'); }
  box(3.6, 0.18, 3.0, 'shingles', cx, 1.75, cz); block(cx, cz, 3.6, 0.18, 3.0, 'coopRoof', 1.75);
  box(1.2, 0.5, 0.5, 'shingles', cx, 1.93, cz + 0.6);
  for (let i = -1; i <= 1; i++) box(0.8, 0.4, 0.5, 'hay', cx + i * 1.0, 0.05, cz + 0.9);
  box(0.9, 0.06, 1.4, 'planksH', cx, 0, cz - 1.9);
  box(1.4, 0.4, 0.05, 0xfff1d6, cx, 2.15, cz - 1.45);

  // Pacas de heno (se puede subir a ellas)
  const hay = [[3, -6], [-2, -12.5], [6.5, -13.5], [-5, 2], [15, -4], [-15.5, -2], [2, 6], [9, 2], [21.4, 14], [-24, 6], [26, 24], [-8, 26], [30, -2], [-26, -26], [12, -24], [16, 28]];
  for (const [x, z] of hay) { const b = box(1.3, 0.85, 0.9, 'hay', x, 0, z); b.rotation.y = (rnd() - 0.5) * 0.2; block(x, z, 1.3, 0.85, 0.9, 'hay'); }
  box(1.3, 0.85, 0.9, 'hay', 4.3, 0.85, -6); block(4.3, -6, 1.3, 0.85, 0.9, 'hay', 0.85); box(1.3, 0.85, 0.9, 'hay', 4.3, 0, -6); block(4.3, -6, 1.3, 0.85, 0.9, 'hay');
  box(1.3, 0.85, 0.9, 'hay', -24, 0.85, 6); block(-24, 6, 1.3, 0.85, 0.9, 'hay', 0.85);

  // Bebedero, pozo, tractor, leña
  box(2.4, 0.5, 0.7, 'metal', 0, 0, -4); block(0, -4, 2.4, 0.5, 0.7, 'trough');
  const tw = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.5), mat('water')); tw.rotation.x = -Math.PI / 2; tw.position.set(0, 0.46, -4); scene.add(tw);
  cyl(0.8, 0.85, 0.9, 'stone', 10, 0, 6, scene, 14); for (const s of [-1, 1]) box(0.1, 1.9, 0.1, 'planks', 10 + s * 0.7, 0, 6);
  const wr = box(2.0, 0.1, 1.4, 'shingles', 10, 1.9, 6); wr.rotation.x = 0.35; block(10, 6, 1.7, 1.0, 1.7, 'well');
  box(2.6, 1.1, 1.5, 'barn', -8, 0.5, -24); box(1.3, 1.1, 1.4, 0x25302e, -8.4, 1.6, -24); box(0.7, 0.3, 0.6, 'metal', -6.9, 1.6, -24);
  for (const [x, z, r] of [[-9.3, -23.1, 0.55], [-9.3, -24.9, 0.55], [-6.9, -23.0, 0.42], [-6.9, -25.0, 0.42]]) { const t = cyl(r, r, 0.32, 0x1f1f1f, x, r, z, scene, 14); t.rotation.x = Math.PI / 2; t.position.y = r; }
  block(-8, -24, 3.2, 2.6, 2.2, 'tractor');
  const logs = []; for (let i = 0; i < 9; i++) logs.push({ x: -12 + (i % 4) * 0.5 - 0.75, y: 0.22 + Math.floor(i / 4) * 0.4, z: 4, rx: Math.PI / 2, rz: 0, s: 1 });
  instanced(new THREE.CylinderGeometry(0.2, 0.2, 1.6, 8), 'bark', logs); block(-12, 4, 2.2, 0.9, 1.6, 'logs');

  // Molino: torre, aspas giratorias y una plataforma arriba (misión: aterrizar volando).
  const { x: wx, z: wz } = WINDMILL;
  cyl(1.0, 1.7, 8, 'planks', wx, 0, wz, scene, 10); block(wx, wz, 2.6, 8, 2.6, 'windmillTower');
  box(3.2, 0.2, 3.2, 'planksH', wx, 8, wz); block(wx, wz, 3.2, 0.2, 3.2, 'windmill', 8);
  box(1.6, 1.4, 1.6, 'planks', wx, 8.2, wz); cone(1.3, 1.0, 'shingles', wx, 9.6, wz, scene, 8);
  cyl(0.08, 0.08, 1.2, 'metal', wx, 8.9, wz + 0.6, scene, 6).rotation.x = Math.PI / 2;
  windmillBlades = new THREE.Group(); windmillBlades.position.set(wx, 8.9, wz + 1.3); scene.add(windmillBlades);
  for (let i = 0; i < 4; i++) { const g = new THREE.Group(); g.rotation.z = i * Math.PI / 2; windmillBlades.add(g); box(0.1, 3.6, 0.08, 'planks', 0, 0, 0, g); box(0.7, 3.2, 0.03, 0xf1e6d2, 0.4, 0.3, 0, g); }

  // Huerto de manzanos, hortaliza y estanque
  const trunks = [], crowns = [], apples = [];
  const treeAt = (x, z, s = 1, apple = false) => {
    trunks.push({ x, z, s, sy: s }); block(x, z, 0.6 * s, 2.4 * s, 0.6 * s, 'tree');
    for (let i = 0; i < 4; i++) crowns.push({ x: x + (i ? (rnd() - 0.5) * 1.8 * s : 0), y: (2.9 + (i ? rnd() * 1.2 : 0)) * s, z: z + (i ? (rnd() - 0.5) * 1.8 * s : 0), s: (i ? 0.9 + rnd() * 0.5 : 1.5) * s, ry: rnd() * 6 });
    if (apple) for (let i = 0; i < 7; i++) apples.push({ x: x + (rnd() - 0.5) * 2.4, y: 2.2 + rnd() * 1.6, z: z + (rnd() - 0.5) * 2.4, s: 1 });
  };
  for (let i = 0; i < 3; i++) for (let j = 0; j < 4; j++) treeAt(25 + i * 3.4, -2 + j * 3.4, 0.75, true);
  for (const [x, z] of [[-31, -31], [31, -31], [31, 31], [-31, 31], [-8, 32], [32, 10], [-32, 24], [12, -32], [-20, 30], [-32, -2], [30, -26]]) treeAt(x, z, 1.0 + rnd() * 0.4);
  instanced(new THREE.CylinderGeometry(0.22, 0.32, 2.6, 8).translate(0, 1.3, 0), 'bark', trunks);
  instanced(new THREE.SphereGeometry(1, 10, 8), 'leaf', crowns, { colors: [new THREE.Color(0xa8e090), new THREE.Color(0x8fd07a), new THREE.Color(0xbdf0a0)] });
  instanced(new THREE.SphereGeometry(0.11, 7, 6), C.red, apples, { shadow: false });
  const veg = []; for (let r = 0; r < 5; r++) for (let i = 0; i < 12; i++) veg.push({ x: 2 + i * 0.6, z: -9 + r * 0.9, s: 0.8 + rnd() * 0.4, ry: rnd() * 6 });
  instanced(new THREE.SphereGeometry(0.25, 7, 5).scale(1, 0.7, 1).translate(0, 0.15, 0), 'leaf', veg, { shadow: false });
  for (let r = 0; r < 5; r++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(8, 0.5), mat('dirt')); p.rotation.x = -Math.PI / 2; p.position.set(5.3, 0.013, -9 + r * 0.9); scene.add(p); }
  const pond = new THREE.Mesh(new THREE.CircleGeometry(POND.r, 32), mat('water')); pond.rotation.x = -Math.PI / 2; pond.position.set(POND.x, 0.02, POND.z); pond.receiveShadow = true; scene.add(pond);
  const shore = new THREE.Mesh(new THREE.RingGeometry(POND.r - 0.2, POND.r + 1.2, 32), mat('dirt')); shore.rotation.x = -Math.PI / 2; shore.position.set(POND.x, 0.014, POND.z); scene.add(shore);
  const reeds = []; for (let i = 0; i < 40; i++) { const a = rnd() * 6.3, d = POND.r + 0.3 + rnd() * 0.8; reeds.push({ x: POND.x + Math.cos(a) * d, z: POND.z + Math.sin(a) * d, s: 0.8 + rnd() * 0.6, sy: 1, rz: (rnd() - 0.5) * 0.2 }); }
  instanced(new THREE.CylinderGeometry(0.02, 0.04, 1.2, 5).translate(0, 0.6, 0), C.cornLeaf, reeds, { shadow: false });

  // Espantapájaros (se derriba a picotazos o huevazos)
  scarecrow = new THREE.Group(); scarecrow.position.set(8, 0, -13); scene.add(scarecrow);
  cyl(0.06, 0.06, 1.9, 'planks', 0, 0, 0, scarecrow); box(1.4, 0.07, 0.07, 'planks', 0, 1.45, 0, scarecrow);
  box(0.55, 0.7, 0.3, 'denim', 0, 0.8, 0, scarecrow); box(1.3, 0.2, 0.22, 'plaid', 0, 1.3, 0, scarecrow);
  sph(0.24, 'hay', 0, 1.8, 0, scarecrow); cyl(0.38, 0.38, 0.05, 'hay', 0, 2.0, 0, scarecrow); cyl(0.2, 0.22, 0.18, 'hay', 0, 2.04, 0, scarecrow);
  for (const s of [-1, 1]) sph(0.035, C.dark, s * 0.09, 1.85, 0.21, scarecrow, 6);
  scarecrow.userData = { hits: 0, down: false, peck: () => peckScarecrow() };
  peckables.push(scarecrow); block(8, -13, 0.4, 1.9, 0.4, 'scarecrow');

  // Cubetas (se tiran a picotazos o huevazos)
  for (const [x, z] of [[-5.5, -4.5], [2, -9], [8.5, -2.5], [-8, 2.5], [10, 12], [-3, 12.5], [20, -8], [-22, -4], [-10, 20], [14, 22]]) {
    const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
    cyl(0.2, 0.16, 0.4, 'metal', 0, 0, 0, g, 14); cyl(0.17, 0.17, 0.03, 'water', 0, 0.38, 0, g, 14, false);
    const h = cyl(0.015, 0.015, 0.46, 'metal', 0, 0.3, 0, g, 6, false); h.rotation.z = Math.PI / 2; h.position.y = 0.42;
    g.userData = { tipped: false, peck: () => tipBucket(g) };
    peckables.push(g); buckets.push(g);
  }

  // Pasto, flores y piedras instanciados dentro de la cerca
  const tufts = []; for (let i = 0; i < 2600; i++) { const x = (rnd() - 0.5) * 66, z = (rnd() - 0.5) * 66; if (Math.hypot(x + 2, z + 4) < 21 || Math.hypot(x - POND.x, z - POND.z) < POND.r + 1) continue; tufts.push({ x, z, ry: rnd() * 3.14, s: 0.7 + rnd() * 0.9 }); }
  const tuftGeo = new THREE.PlaneGeometry(0.6, 0.45).translate(0, 0.22, 0);
  const tuftMat = new THREE.MeshStandardMaterial({ map: TEX.blade, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 1 });
  const tuftMesh = new THREE.InstancedMesh(tuftGeo, tuftMat, tufts.length); { const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0); tufts.forEach((t, i) => { p.set(t.x, 0, t.z); q.setFromAxisAngle(up, t.ry); s.setScalar(t.s); m4.compose(p, q, s); tuftMesh.setMatrixAt(i, m4); }); }
  tuftMesh.receiveShadow = true; scene.add(tuftMesh);
  const flowers = []; const fcols = [new THREE.Color(0xffffff), new THREE.Color(0xffd34d), new THREE.Color(0xff7aa8), new THREE.Color(0xa78bff)];
  for (let i = 0; i < 500; i++) { const x = (rnd() - 0.5) * 66, z = (rnd() - 0.5) * 66; if (Math.hypot(x + 2, z + 4) < 22 || Math.hypot(x - POND.x, z - POND.z) < POND.r + 1) continue; flowers.push({ x, y: 0.12, z, s: 1 }); }
  instanced(new THREE.SphereGeometry(0.07, 6, 5), C.white, flowers, { shadow: false, colors: fcols });
  const rocks = []; for (let i = 0; i < 70; i++) rocks.push({ x: (rnd() - 0.5) * 66, z: (rnd() - 0.5) * 66, s: 0.2 + rnd() * 0.5, ry: rnd() * 6, rx: rnd() * 0.5 });
  instanced(new THREE.DodecahedronGeometry(1, 0), 'stone', rocks.filter((r) => Math.hypot(r.x - POND.x, r.z - POND.z) > POND.r + 1));

  // Fuera de la cerca: maizales, casa del granjero, lomas y montañas.
  const stalks = []; for (let i = 0; i < 1800; i++) { const side = i % 2 ? 1 : -1; stalks.push({ x: side * (37 + (i % 15) * 1.3 + rnd() * 0.5), z: -52 + Math.floor(i / 30) * 1.8 + rnd() * 0.6, s: 0.9 + rnd() * 0.3, ry: rnd() * 6 }); }
  instanced(new THREE.BoxGeometry(0.12, 1.9, 0.12).translate(0, 0.95, 0), C.cornLeaf, stalks, { shadow: false });
  box(14, 5.5, 9, 0xf1e2c4, 0, 0, -50); cone(10, 4, 'shingles', 0, 5.5, -50, scene, 4).rotation.y = Math.PI / 4;
  box(1.2, 2.2, 0.1, 'planks', 0, 0, -45.45); for (const s of [-1, 1]) box(1.6, 1.3, 0.1, 0xbfe3ff, s * 4, 2.2, -45.45); box(1.2, 2.5, 1.2, 'stone', 4.5, 7, -50);
  for (const [x, z, r] of [[-90, -110, 40], [85, -115, 34], [120, -30, 30], [-125, 15, 34], [0, 130, 38], [-80, 100, 28], [100, 90, 32]]) { const h = sph(r, 0x5f9b3a, x, -r * 0.55, z, scene, 16, false); h.scale.y = 0.45; }
  for (const [x, z, r, h] of [[-220, -300, 90, 120], [60, -340, 110, 150], [260, -200, 80, 100], [-320, -80, 100, 110], [300, 120, 90, 120]]) { cone(r, h, 0x6f7f8c, x, -5, z, scene, 7, false); cone(r * 0.35, h * 0.35, 0xf4f8ff, x, h * 0.65 - 5, z, scene, 7, false); }
  const cloudMat = new THREE.MeshStandardMaterial({ color: C.cloud, fog: false, roughness: 1, emissive: 0x444444 });
  for (let i = 0; i < 14; i++) {
    const g = new THREE.Group(); g.position.set((rnd() - 0.5) * 500, 60 + rnd() * 25, -120 - rnd() * 200); scene.add(g);
    for (let j = 0; j < 5; j++) { const s = new THREE.Mesh(new THREE.SphereGeometry(7 + rnd() * 8, 8, 6), cloudMat); s.position.set(j * 9 - 18, rnd() * 3, (rnd() - 0.5) * 6); g.add(s); }
  }
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
  } else say(`Espantapájaros: ${u.hits}/5 golpes`);
}
function resetScarecrow() { scarecrow.userData.hits = 0; scarecrow.userData.down = false; scarecrow.rotation.set(0, 0, 0); }

// ---------------------------------------------------------------- personajes
function makeHuman({ pants, shirt, skin, hatKey, hair, dress }) {
  const g = new THREE.Group();
  const legs = [], arms = [];
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(s * 0.15, 0.85, 0); g.add(piv); legs.push(piv);
    box(0.22, 0.85, 0.24, pants, 0, -0.85, 0, piv); box(0.24, 0.12, 0.32, C.dark, 0, -0.85, 0.03, piv);
  }
  if (dress) { const d = cone(0.5, 1.05, dress, 0, 0.35, 0, g, 16); d.position.y = 0.35 + 0.525; box(0.3, 0.45, 0.04, 'apron', 0, 0.55, 0.42, g); }
  box(0.62, 0.72, 0.38, shirt, 0, 0.85, 0, g);
  if (!dress) { box(0.5, 0.5, 0.42, pants, 0, 0.85, 0, g); for (const s of [-1, 1]) box(0.08, 0.5, 0.42, pants, s * 0.18, 1.2, 0, g); }
  const head = sph(0.24, skin, 0, 1.82, 0, g, 16);
  for (const s of [-1, 1]) { sph(0.045, C.white, s * 0.09, 1.87, 0.2, g, 8); sph(0.025, C.dark, s * 0.09, 1.87, 0.235, g, 6); sph(0.05, skin, s * 0.24, 1.82, 0, g, 6); }
  sph(0.05, skin, 0, 1.78, 0.24, g, 8);
  box(0.16, 0.03, 0.02, 0x7a2a1a, 0, 1.7, 0.23, g);
  for (const s of [-1, 1]) box(0.08, 0.02, 0.02, 0x3a2a1a, s * 0.09, 1.93, 0.22, g);
  if (hatKey) { cyl(0.38, 0.38, 0.05, hatKey, 0, 2.0, 0, g, 16); cyl(0.2, 0.23, 0.2, hatKey, 0, 2.04, 0, g, 14); cyl(0.215, 0.215, 0.05, 0x5a3a1a, 0, 2.06, 0, g, 14); }
  if (hair) { sph(0.25, hair, 0, 1.9, -0.05, g, 12).scale.set(1, 0.75, 1); sph(0.14, hair, 0, 2.12, -0.12, g, 10); }
  for (const s of [-1, 1]) {
    const piv = new THREE.Group(); piv.position.set(s * 0.4, 1.5, 0); g.add(piv); arms.push(piv);
    box(0.17, 0.62, 0.17, shirt, 0, -0.62, 0, piv); sph(0.09, skin, 0, -0.64, 0, piv, 8);
  }
  return { g, legs, arms, head };
}
function makeFarmer() {
  const h = makeHuman({ pants: 'denim', shirt: 'plaid', skin: 'skin', hatKey: 'hay' });
  sph(0.2, 0x7a5a3a, 0, 1.68, 0.12, h.g, 10).scale.set(1, 0.6, 0.8);
  const tool = new THREE.Group(); tool.position.set(0, -0.64, 0.1); h.arms[1].add(tool);
  const handle = cyl(0.03, 0.03, 0.24, 'planks', 0, 0, 0, tool, 6); handle.rotation.x = Math.PI / 2;
  const blade = box(0.04, 0.26, 0.36, 'metal', 0, -0.05, 0.3, tool); blade.position.y = 0.02;
  box(0.045, 0.03, 0.36, 0xd0d8dd, 0, 0.15, 0.3, tool);
  return { ...h, tool };
}
function makeWife() {
  const h = makeHuman({ pants: 0x5a3b6b, shirt: 'dress', skin: 'skin', hair: 0x6b6b6b, dress: 'dress' });
  const broom = new THREE.Group(); broom.position.set(0, -0.6, 0.05); h.arms[1].add(broom);
  cyl(0.025, 0.025, 1.3, 'planks', 0, -0.3, 0, broom, 6); box(0.2, 0.3, 0.14, 'hay', 0, 0.98, 0, broom);
  return h;
}
function makePig() {
  const g = new THREE.Group();
  const body = sph(0.5, 'pig', 0, 0.5, 0, g, 16); body.scale.set(1, 0.78, 1.45);
  sph(0.3, 'pig', 0, 0.55, 0.72, g, 12); const sn = cyl(0.12, 0.13, 0.12, 0xe68aa0, 0, 0.47, 0.98, g, 10); sn.rotation.x = Math.PI / 2; sn.position.y = 0.52;
  for (const s of [-1, 1]) { sph(0.035, C.dark, s * 0.11, 0.66, 0.95, g, 6); cone(0.09, 0.2, 0xe68aa0, s * 0.18, 0.72, 0.6, g, 6).rotation.x = -0.4; sph(0.02, C.dark, s * 0.04, 0.52, 1.05, g, 5); }
  for (const [x, z] of [[-0.25, 0.4], [0.25, 0.4], [-0.25, -0.4], [0.25, -0.4]]) cyl(0.08, 0.08, 0.3, 0xe68aa0, x, 0, z, g, 6);
  const tail = cyl(0.03, 0.03, 0.25, 0xe68aa0, 0, 0.6, -0.75, g, 5); tail.rotation.x = 0.8;
  return { g };
}
function makeCow() {
  const g = new THREE.Group();
  const body = sph(0.75, 'cow', 0, 1.0, 0, g, 16); body.scale.set(1, 0.85, 1.6);
  const head = sph(0.38, 'cow', 0, 1.25, 1.25, g, 14); head.scale.set(0.85, 0.8, 1.1);
  const muzzle = sph(0.26, 0xe8b9b0, 0, 1.08, 1.6, g, 10); muzzle.scale.set(1, 0.7, 0.8);
  for (const s of [-1, 1]) { sph(0.045, C.dark, s * 0.15, 1.38, 1.55, g, 6); cone(0.06, 0.3, 0xe9dfcf, s * 0.3, 1.6, 1.05, g, 6).rotation.z = -s * 0.5; cone(0.08, 0.3, 0xe8b9b0, s * 0.42, 1.38, 1.05, g, 6).rotation.z = -s * 1.4; }
  for (const [x, z] of [[-0.35, 0.65], [0.35, 0.65], [-0.35, -0.7], [0.35, -0.7]]) { cyl(0.12, 0.11, 0.75, 'cow', x, 0, z, g, 8); cyl(0.13, 0.13, 0.08, C.dark, x, 0, z, g, 8); }
  sph(0.22, 0xf4b8c0, 0, 0.55, -0.35, g, 8).scale.set(1, 0.7, 1);
  const tail = cyl(0.03, 0.03, 0.8, 'cow', 0, 0.45, -1.2, g, 5); tail.rotation.x = 0.4;
  return { g };
}
function makeHen(color = 'feather', scale = 1) {
  const g = new THREE.Group();
  const body = sph(0.2, color, 0, 0.26, 0, g, 12); body.scale.set(1, 0.9, 1.3);
  sph(0.12, color, 0, 0.47, 0.2, g, 10);
  cone(0.045, 0.12, C.orange, 0, 0.4, 0.32, g, 6).rotation.x = Math.PI / 2;
  box(0.05, 0.08, 0.1, C.red, 0, 0.56, 0.2, g); box(0.04, 0.09, 0.04, C.red, 0, 0.3, 0.3, g);
  const legs = [], wings = [];
  for (const s of [-1, 1]) {
    sph(0.025, C.dark, s * 0.07, 0.5, 0.29, g, 6);
    const lp = new THREE.Group(); lp.position.set(s * 0.07, 0.14, 0); g.add(lp); legs.push(lp); cyl(0.015, 0.015, 0.14, C.orange, 0, -0.14, 0, lp, 5); box(0.06, 0.01, 0.07, C.orange, 0, -0.14, 0.02, lp);
    const wp = new THREE.Group(); wp.position.set(s * 0.17, 0.3, -0.02); g.add(wp); wings.push(wp); const w = box(0.03, 0.14, 0.24, color, s * 0.015, -0.1, 0, wp); w.rotation.x = 0.2;
  }
  const t = box(0.14, 0.14, 0.05, color, 0, 0.36, -0.28, g); t.rotation.x = 0.6;
  g.scale.setScalar(scale);
  return { g, legs, wings };
}

const yardWaypoints = [[-6, -6], [-24, -30], [8, -30], [28, -6], [20, 6], [6, 20], [-8, 30], [-26, 26], [-30, 0], [-12, 8]];
const wifeWaypoints = [[10, -14], [-8, -20], [14, 2], [0, 8], [-6, 22], [12, 26], [-28, -24], [24, 24]];
const farmer = { ...makeFarmer(), type: 'farmer', radius: 0.42, height: 2.1, state: 'patrol', wpi: 0, timer: 0, speed: 1.5, chaseSpeed: 2.3, rage: 0, lost: 0, phase: 0, moving: false, heading: 0, stuck: 0, lastPos: new THREE.Vector3(), splats: [] };
const wife = { ...makeWife(), type: 'wife', radius: 0.42, height: 2.0, state: 'wander', wpi: 0, timer: 0, speed: 1.1, rage: 0, phase: 0, moving: false, heading: 0, active: false, fleeDir: new THREE.Vector3(1, 0, 0), stuck: 0, lastPos: new THREE.Vector3(), splats: [] };
const pig = { ...makePig(), type: 'pig', radius: 0.5, state: 'idle', timer: 0, target: new THREE.Vector3(PEN.x, 0, PEN.z), phase: 0, wobble: 0, heading: 0, height: 1.0, splats: [] };
const cow = { ...makeCow(), type: 'cow', radius: 0.8, timer: 0, target: new THREE.Vector3(PASTURE.x, 0, PASTURE.z), phase: 0, wobble: 0, height: 1.8, splats: [] };
const hens = [];
farmer.g.position.set(-6, 0, -6); scene.add(farmer.g);
wife.g.position.set(10, 0, -14); wife.g.visible = false; scene.add(wife.g);
pig.g.position.set(PEN.x, 0, PEN.z); scene.add(pig.g);
cow.g.position.set(PASTURE.x, 0, PASTURE.z); scene.add(cow.g);
for (const [c, x, z] of [['feather', 2, 2], [0xd9803a, -6, -8], [0x3a3a3a, 10, -8], ['feather', 20, 22], [0xb86a2a, -20, -2]]) {
  const h = { ...makeHen(c), target: new THREE.Vector3(x, 0, z), timer: 0, hop: 0, phase: 0, recruited: false };
  h.g.position.set(x, 0, z); scene.add(h.g); hens.push(h);
  h.g.userData = { peck: () => peckHen(h) }; peckables.push(h.g);
}
farmer.g.userData = { peck: () => { sfx.yell(); say('Don Ramiro: "¡Ay, mis tobillos! ¡Ven acá, pollo!"'); farmer.rage = 5; farmer.state = 'chase'; game.score += 15; } };
wife.g.userData = { peck: () => { sfx.scream(); say('Doña Chona: "¡Aaay! ¡Gallina atrevida!"'); flee(wife); game.score += 15; } };
pig.g.userData = { peck: () => peckPig() };
cow.g.userData = { peck: () => peckCow() };
peckables.push(farmer.g, wife.g, pig.g, cow.g);

// La gallina protagonista: entidad de juego + modelo visible en tercera persona.
const chicken = { pos: new THREE.Vector3(COOP.x, 0, COOP.z + 0.2), heading: Math.PI, ...makeHen('feather', 1.15) };
scene.add(chicken.g); chicken.g.rotation.y = Math.PI; chicken.g.visible = view === 'third';
let wingFlap = 0;

function peckPig() {
  sfx.grunt(); pig.wobble = 0.6; pig.timer = 0; game.score += 30;
  pig.target.set(PEN.x + (rnd() - 0.5) * 5, 0, PEN.z + (rnd() - 0.5) * 5);
  progress('pig'); say('¡Oink! El cerdo se enoja +30');
}
function peckCow() {
  sfx.moo(); cow.wobble = 0.8; cow.timer = 0; game.score += 30;
  cow.target.set(PASTURE.x + (rnd() - 0.5) * 9, 0, PASTURE.z + (rnd() - 0.5) * 9);
  progress('cow'); say('¡Muuu! La vaca se asusta +30');
}
function peckHen(h) {
  sfx.cluck(); h.hop = 0.5; game.score += 10;
  if (!h.recruited) { h.recruited = true; progress('hen'); }
  say('¡Cloc cloc! +10');
}
function flee(npc) { npc.state = 'flee'; npc.timer = 4; npc.fleeDir.set(rnd() - 0.5, 0, rnd() - 0.5).normalize(); }

// ---------------------------------------------------------------- maíz (recarga popó)
const cornItems = [];
const cornGeo = new THREE.CylinderGeometry(0.07, 0.07, 0.3, 8);
function randomSpot(margin = 0.8) {
  for (let i = 0; i < 60; i++) {
    const x = (rnd() - 0.5) * 64, z = (rnd() - 0.5) * 64;
    if (Math.abs(x - PEN.x) < PEN.half + 1 && Math.abs(z - PEN.z) < PEN.half + 1) continue;
    if (Math.abs(x - PASTURE.x) < PASTURE.half + 1 && Math.abs(z - PASTURE.z) < PASTURE.half + 1) continue;
    if (Math.abs(x - COOP.x) < 2.5 && Math.abs(z - COOP.z) < 2.5) continue;
    if (Math.hypot(x - POND.x, z - POND.z) < POND.r + 1) continue;
    if (obstacles.some((o) => x > o.min.x - margin && x < o.max.x + margin && z > o.min.z - margin && z < o.max.z + margin && o.max.y > 0.3 && o.tag !== 'fence')) continue;
    return new THREE.Vector3(x, 0, z);
  }
  return new THREE.Vector3(0, 0, 4);
}
function buildCorn() {
  for (let i = 0; i < 16; i++) {
    const g = new THREE.Group();
    const cob = new THREE.Mesh(cornGeo, mat(C.corn, { roughness: 0.5 })); cob.position.y = 0.2; cob.castShadow = true; g.add(cob);
    for (const s of [-1, 1]) { const l = box(0.05, 0.3, 0.12, C.cornLeaf, s * 0.06, 0.03, 0, g, false); l.rotation.z = s * 0.4; }
    scene.add(g); cornItems.push({ g, active: true, timer: 0, spin: rnd() * 6 });
    g.position.copy(randomSpot());
  }
}
function respawnCorn() { for (const c of cornItems) { c.active = true; c.g.visible = true; c.g.position.copy(randomSpot()); } }

// ---------------------------------------------------------------- apuntado, popó y huevos
const _o = new THREE.Vector3(), _d = new THREE.Vector3(), _q = new THREE.Quaternion(), _fwd = new THREE.Vector3(), _hp = new THREE.Vector3();
function headPos() { return camera.getWorldPosition(_hp); }
function headForward() { camera.getWorldQuaternion(_q); _fwd.set(0, 0, -1).applyQuaternion(_q); _fwd.y = 0; if (_fwd.lengthSq() < 1e-4) _fwd.set(0, 0, -1); return _fwd.normalize(); }
function chickenForward(out) { if (view === 'first') return out.copy(headForward()); return out.set(Math.sin(chicken.heading), 0, Math.cos(chicken.heading)); }
// Origen y dirección de picotazos y huevos: la dirección viene de la cámara o del control;
// el origen, de la cabeza de la gallina (en tercera persona) o del propio objeto (en primera).
const aimRay = new THREE.Raycaster(), aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.45), _aimPt = new THREE.Vector3();
function aim(obj) {
  obj.getWorldQuaternion(_q); _d.set(0, 0, -1).applyQuaternion(_q).normalize(); obj.getWorldPosition(_o);
  if (view === 'first') return { o: _o, d: _d };
  // Tercera persona (estilo TPS): el puntero elige el punto al que se apunta y el tiro sale de la gallina.
  aimRay.set(_o, _d); aimRay.far = 80;
  for (const p of peckables) p.updateMatrixWorld(true);
  const hit = aimRay.intersectObjects(peckables, true)[0];
  if (hit) _aimPt.copy(hit.point);
  else if (!aimRay.ray.intersectPlane(aimPlane, _aimPt)) _aimPt.copy(_o).addScaledVector(_d, 40);
  _o.set(chicken.pos.x, chicken.pos.y + 0.45, chicken.pos.z);
  _d.subVectors(_aimPt, _o).normalize();
  return { o: _o, d: _d };
}
const projectiles = [], splats = [];
const poopGeo = new THREE.SphereGeometry(0.055, 8, 6), splatGeo = new THREE.CircleGeometry(0.13, 12);
const eggGeo = new THREE.SphereGeometry(0.07, 10, 8).scale(1, 1.3, 1);
const poopMat = mat(C.poop, { roughness: 0.6 }), eggMat = mat(C.egg, { roughness: 0.35 });
const npcs = () => [farmer, wife, pig, cow];
function poop() {
  if (game.state !== 'playing') return;
  if (game.cooldown > 0) return;
  if (game.charges <= 0) { sfx.tick(); say('Sin popó: come maíz 🌽'); return; }
  game.charges--; game.cooldown = CFG.poopCooldown; refreshHUD(); sfx.plop();
  const fwd = chickenForward(new THREE.Vector3());
  const m = new THREE.Mesh(poopGeo, poopMat); m.castShadow = true; scene.add(m);
  const vel = fwd.multiplyScalar(-1.25).add(playerVel.clone().multiplyScalar(0.45)); vel.y = 0.45;
  projectiles.push({ kind: 'poop', m, pos: new THREE.Vector3(chicken.pos.x, chicken.pos.y + 0.17, chicken.pos.z), vel });
  m.position.copy(projectiles[projectiles.length - 1].pos);
}
function shootEgg(obj) {
  if (game.state !== 'playing') return;
  if (game.eggCooldown > 0) return;
  if (game.eggs <= 0) { sfx.tick(); say('Sin huevos: espera a poner otro 🥚'); return; }
  game.eggs--; game.eggCooldown = CFG.eggCooldown; refreshHUD(); sfx.shoot(); beakPeck();
  const { o, d } = aim(obj);
  const m = new THREE.Mesh(eggGeo, eggMat); m.castShadow = true; scene.add(m);
  const vel = d.clone().multiplyScalar(CFG.eggSpeed).add(playerVel.clone().multiplyScalar(0.5)); vel.y += 1.2;
  const pos = o.clone().addScaledVector(d, 0.3); if (view === 'first' && obj === camera) pos.y = chicken.pos.y + 0.3;
  projectiles.push({ kind: 'egg', m, pos, vel });
  m.position.copy(pos);
}
function groundAt(x, z, y) {
  let g = 0;
  for (const o of obstacles) if (x > o.min.x && x < o.max.x && z > o.min.z && z < o.max.z && o.max.y <= y + 0.05 && o.max.y > g) g = o.max.y;
  return g;
}
function addSplat(x, y, z, kind) {
  const col = kind === 'egg' ? C.yolk : C.poop;
  const s = new THREE.Mesh(splatGeo, new THREE.MeshStandardMaterial({ color: col, transparent: true, opacity: 0.95, roughness: 0.4 }));
  s.rotation.x = -Math.PI / 2; s.position.set(x, y + 0.006, z); s.rotation.z = rnd() * 6; s.scale.setScalar(0.8 + rnd() * 0.6); scene.add(s);
  if (kind === 'egg') { const w = new THREE.Mesh(splatGeo, new THREE.MeshStandardMaterial({ color: 0xfff8ee, transparent: true, opacity: 0.9, roughness: 0.5 })); w.rotation.x = -Math.PI / 2; w.position.set(x, y + 0.004, z); w.scale.setScalar(1.6); scene.add(w); splats.push({ m: w, life: 25 }); }
  splats.push({ m: s, life: 25 });
  while (splats.length > 60) { const old = splats.shift(); scene.remove(old.m); }
}
function hitNPC(npc, p) {
  const hit = sph(0.09, p.kind === 'egg' ? C.yolk : C.poop, 0, 0, 0, npc.g, 8, false);
  const local = npc.g.worldToLocal(p.pos.clone()); hit.position.copy(local); hit.scale.set(1, 0.5, 1);
  npc.splats.push(hit); if (npc.splats.length > 8) npc.g.remove(npc.splats.shift());
  const hat = p.pos.y > npc.height - 0.5;
  const egg = p.kind === 'egg';
  const pts = (hat ? 120 : 50) + (egg ? 20 : 0); game.score += pts;
  if (egg) sfx.crack(); else sfx.splat();
  if (npc === farmer) {
    progress(egg ? 'eggFarmer' : 'poopFarmer');
    if (egg) { farmer.state = 'dazed'; farmer.timer = 1.8; farmer.rage = 4; sfx.dizzy(); say(hat ? `¡HUEVAZO EN LA CARA! +${pts} · Don Ramiro: "¡No veo nada!"` : `¡Huevazo! +${pts} · Don Ramiro ve estrellitas`); }
    else { farmer.rage = 6; farmer.state = 'chase'; sfx.yell(); say(hat ? `¡EN EL SOMBRERO! +${pts} · Don Ramiro: "¡Mi sombrero nuevo!"` : `¡PLAF en las botas! +${pts} · Don Ramiro: "¡Pollo asqueroso!"`); }
  } else if (npc === wife) {
    progress(egg ? 'eggWife' : 'poopWife'); flee(wife); sfx.scream();
    say(hat ? `¡EN EL PEINADO! +${pts} · Doña Chona: "¡AAAAY!"` : `¡PLAF en el vestido! +${pts} · Doña Chona: "¡Cochina!"`);
  } else if (npc === cow) { progress('eggCow'); sfx.moo(); cow.wobble = 0.8; say(`¡Muuu! La vaca quedó pringada +${pts}`); }
  else { sfx.grunt(); pig.wobble = 0.6; say(`¡Oink! +${pts}`); }
}
function updateProjectiles(dt) {
  for (let i = projectiles.length - 1; i >= 0; i--) {
    const p = projectiles[i];
    p.vel.y -= CFG.gravity * dt * (p.kind === 'egg' ? 0.9 : 1); p.pos.addScaledVector(p.vel, dt); p.m.position.copy(p.pos);
    if (p.kind === 'egg') p.m.rotation.x += dt * 12;
    let gone = false;
    for (const npc of npcs()) {
      if (!npc.g.visible) continue;
      const dx = p.pos.x - npc.g.position.x, dz = p.pos.z - npc.g.position.z, r = npc.radius + 0.05;
      if (dx * dx + dz * dz < r * r && p.pos.y > -0.05 && p.pos.y < npc.height) { hitNPC(npc, p); gone = true; break; }
    }
    if (!gone && p.kind === 'egg') {
      for (const b of buckets) if (!b.userData.tipped && p.pos.distanceTo(b.position) < 0.4) { tipBucket(b); gone = true; break; }
      if (!gone && !scarecrow.userData.down && Math.hypot(p.pos.x - scarecrow.position.x, p.pos.z - scarecrow.position.z) < 0.5 && p.pos.y < 2.2) { peckScarecrow(); gone = true; }
      if (!gone) for (const o of obstacles) if (o.tag !== 'fence' && p.pos.x > o.min.x && p.pos.x < o.max.x && p.pos.z > o.min.z && p.pos.z < o.max.z && p.pos.y > o.min.y && p.pos.y < o.max.y) { addSplat(p.pos.x, groundAt(p.pos.x, p.pos.z, p.pos.y + 0.1), p.pos.z, 'egg'); sfx.crack(); gone = true; break; }
    }
    const gy = groundAt(p.pos.x, p.pos.z, p.pos.y + 0.1);
    if (!gone && p.pos.y <= gy + 0.03) { addSplat(p.pos.x, gy, p.pos.z, p.kind); if (p.kind === 'egg') sfx.crack(); gone = true; }
    if (gone || p.pos.y < -2 || Math.abs(p.pos.x) > 60 || Math.abs(p.pos.z) > 60) { scene.remove(p.m); projectiles.splice(i, 1); }
  }
  for (let i = splats.length - 1; i >= 0; i--) {
    const s = splats[i]; s.life -= dt; if (s.life < 5) s.m.material.opacity = Math.max(0, s.life / 5);
    if (s.life <= 0) { scene.remove(s.m); splats.splice(i, 1); }
  }
}

// ---------------------------------------------------------------- picotazo
const raycaster = new THREE.Raycaster();
function peckFrom(obj) {
  if (game.state !== 'playing') return;
  const { o, d } = aim(obj);
  raycaster.set(o, d); raycaster.far = CFG.peckRange + (view === 'third' ? 0.25 : 0);
  sfx.peck(); beakPeck();
  for (const p of peckables) p.updateMatrixWorld(true);
  const hits = raycaster.intersectObjects(peckables, true);
  for (const h of hits) {
    let x = h.object; while (x && !x.userData?.peck) x = x.parent;
    if (x) { x.userData.peck(); return; }
  }
}

// ---------------------------------------------------------------- misiones y niveles
const MISSION = {
  corn: (n) => ({ type: 'corn', need: n, text: `Come ${n} maíces` }),
  poopFarmer: (n) => ({ type: 'poopFarmer', need: n, text: `Hazle popó a Don Ramiro` }),
  poopWife: (n) => ({ type: 'poopWife', need: n, text: `Hazle popó a Doña Chona` }),
  eggFarmer: (n) => ({ type: 'eggFarmer', need: n, text: `Dale huevazos a Don Ramiro` }),
  eggWife: (n) => ({ type: 'eggWife', need: n, text: `Dale huevazos a Doña Chona` }),
  eggCow: (n) => ({ type: 'eggCow', need: n, text: `Dale huevazos a la vaca` }),
  bucket: (n) => ({ type: 'bucket', need: n, text: `Tira cubetas` }),
  pig: (n) => ({ type: 'pig', need: n, text: `Picotea al cerdo` }),
  cow: (n) => ({ type: 'cow', need: n, text: `Picotea a la vaca` }),
  roof: () => ({ type: 'roof', need: 1, text: `Súbete al techo del gallinero` }),
  windmill: () => ({ type: 'windmill', need: 1, text: `Aterriza en lo alto del molino` }),
  fly: (s) => ({ type: 'fly', need: s, text: `Vuela ${s} s en total (a más de 1.5 m)`, seconds: true }),
  scarecrow: () => ({ type: 'scarecrow', need: 1, text: `Derriba al espantapájaros (5 golpes)` }),
  survive: (s) => ({ type: 'survive', need: s, text: `Sobrevive ${s} s seguidos fuera del gallinero`, seconds: true }),
  hen: (n) => ({ type: 'hen', need: n, text: `Recluta gallinas a picotazos` }),
};
const LEVELS = [
  { name: 'Bienvenida al corral', farmerSpeed: 2.3, wife: false, missions: [MISSION.corn(3), MISSION.bucket(2), MISSION.eggFarmer(1)] },
  { name: 'Caos en la granja', farmerSpeed: 2.6, wife: true, missions: [MISSION.poopFarmer(1), MISSION.pig(3), MISSION.fly(6)] },
  { name: 'La venganza de la gallina', farmerSpeed: 2.9, wife: true, missions: [MISSION.poopWife(2), MISSION.roof(), MISSION.scarecrow()] },
  { name: 'Vuelo de altura', farmerSpeed: 3.1, wife: true, missions: [MISSION.eggWife(2), MISSION.windmill(), MISSION.survive(40)] },
];
function genLevel(i) {
  const k = i - 3;
  const pool = [MISSION.corn(4 + k), MISSION.poopFarmer(2 + k), MISSION.poopWife(2 + k), MISSION.eggFarmer(3 + k), MISSION.eggWife(2 + k), MISSION.eggCow(2 + k), MISSION.bucket(Math.min(8, 3 + k)), MISSION.pig(3 + k), MISSION.cow(2 + k), MISSION.roof(), MISSION.windmill(), MISSION.fly(10 + 4 * k), MISSION.scarecrow(), MISSION.survive(30 + 5 * k), MISSION.hen(3 + Math.min(2, k))];
  const missions = []; while (missions.length < 3) missions.push(pool.splice((rnd() * pool.length) | 0, 1)[0]);
  const names = ['Pánico en el patio', 'Don Ramiro afila el machete', 'Noche de caldo… o no', 'La gallina indomable', 'Rebelión en la granja', 'Huevos a discreción'];
  return { name: names[k % names.length] + (k >= names.length ? ' II' : ''), farmerSpeed: Math.min(3.9, 3.2 + 0.15 * k), wife: true, missions };
}

const game = {
  state: 'menu', level: 0, score: 0, lives: CFG.lives, charges: CFG.startPoop, cooldown: 0, regen: 0, eggs: CFG.startEggs, eggCooldown: 0, eggRegen: 0, stamina: CFG.stamina,
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
  farmer.chaseSpeed = def.farmerSpeed; farmer.speed = 1.5 + i * 0.08; farmer.rage = 0; farmer.state = 'patrol';
  wife.active = def.wife; wife.g.visible = def.wife; wife.state = 'wander';
  for (const npc of npcs()) { for (const s of npc.splats) npc.g.remove(s); npc.splats.length = 0; }
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
  game.eggs = CFG.startEggs; game.eggCooldown = 0; game.eggRegen = 0; game.stamina = CFG.stamina;
  respawnPlayer(); loadLevel(0); game.state = 'playing';
  document.body.classList.add('playing'); ui.pause.hidden = true;
  say(renderer.xr.isPresenting ? '¡Corre, gallina! Gatillo: huevo · Agarre: picotazo · A/X: volar · B/Y: popó · Clic stick der.: cambiar vista' : '¡Corre, gallina! Clic izq.: huevo · Clic der. / E: picotazo · Q: popó · Mantén Espacio: volar · C: cambiar vista');
  if (!renderer.xr.isPresenting) lockPointer();
}
function respawnPlayer() {
  chicken.pos.set(COOP.x, 0, COOP.z + 0.2); chicken.heading = Math.PI; playerVel.set(0, 0, 0); vy = 0; game.stamina = CFG.stamina;
  if (!renderer.xr.isPresenting) { player.rotation.y = 0; pitch = 0; } else snapTurnTo(0);
  placeRig(true);
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
  ui.eggs.textContent = '🥚'.repeat(game.eggs) + '·'.repeat(CFG.maxEggs - game.eggs);
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
const vrHud = makeCanvasPlane(560, 400, 0.28, 0.2);
vrHud.mesh.position.set(-0.19, -0.13, -0.5); vrHud.mesh.rotation.set(-0.15, 0.25, 0);
const vrBanner = makeCanvasPlane(900, 220, 0.5, 0.122);
vrBanner.mesh.position.set(0, 0.1, -0.55); vrBanner.timer = 0; vrBanner.text = ''; vrBanner.sub = ''; vrBanner.hold = false;
const vrFlash = new THREE.Mesh(new THREE.PlaneGeometry(3, 3), new THREE.MeshBasicMaterial({ color: 0xd6261a, transparent: true, opacity: 0.4, depthTest: false }));
vrFlash.position.z = -0.3; vrFlash.visible = false; vrFlash.renderOrder = 998; camera.add(vrFlash);
function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }
let lastStaminaDrawn = -1;
function drawVRHud() {
  const c = vrHud.ctx, W = vrHud.canvas.width, H = vrHud.canvas.height;
  c.clearRect(0, 0, W, H); c.fillStyle = 'rgba(26,15,6,0.82)'; roundRect(c, 0, 0, W, H, 28); c.fill();
  c.fillStyle = '#ffd36b'; c.font = 'bold 30px sans-serif'; c.fillText(`NIVEL ${game.level + 1} · ${game.levelName}`, 24, 46);
  c.fillStyle = '#fff3df'; c.font = '27px sans-serif';
  c.fillText(`VIDAS ${'♥'.repeat(Math.max(0, game.lives))}    PUNTOS ${game.score}`, 24, 90);
  c.fillText(`POPÓ ${'●'.repeat(game.charges)}${'○'.repeat(CFG.maxPoop - game.charges)}   HUEVOS ${'●'.repeat(game.eggs)}${'○'.repeat(CFG.maxEggs - game.eggs)}`, 24, 128);
  c.fillStyle = '#5a4a2a'; roundRect(c, 24, 146, W - 48, 16, 8); c.fill(); c.fillStyle = '#7fe0a0'; roundRect(c, 24, 146, (W - 48) * Math.max(0.02, game.stamina / CFG.stamina), 16, 8); c.fill();
  c.fillStyle = '#c9b291'; c.font = 'bold 16px sans-serif'; c.fillText('ENERGÍA DE VUELO', 24, 182);
  c.font = '25px sans-serif'; let y = 222;
  for (const m of game.missions) {
    c.fillStyle = m.complete ? '#8fe28a' : '#fff3df';
    const n = `${m.seconds ? Math.floor(m.done) : m.done}/${m.need}`;
    c.fillText(`${m.complete ? '✓' : '○'} ${m.text}`, 24, y); c.fillStyle = '#ffd36b'; c.textAlign = 'right'; c.fillText(n, W - 24, y); c.textAlign = 'left'; y += 36;
  }
  vrHud.tex.needsUpdate = true; vrHud.dirty = false; lastStaminaDrawn = Math.round(game.stamina / 5);
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

// Pico y alas pegados a la cámara en primera persona: recuerdan que eres un pollo.
const fpRig = new THREE.Group(); camera.add(fpRig);
const beak = new THREE.Group(); fpRig.add(beak); beak.position.set(0, -0.11, -0.3);
const beakTop = cone(0.035, 0.09, C.orange, 0, 0, 0, beak, 8, false); beakTop.rotation.x = -Math.PI / 2; beakTop.position.set(0, 0.01, -0.03);
const beakBot = cone(0.03, 0.07, 0xd97a1e, 0, 0, 0, beak, 8, false); beakBot.rotation.x = -Math.PI / 2; beakBot.position.set(0, -0.015, -0.02);
function beakPeck() { animate(0.22, (k) => { beak.position.z = -0.3 - Math.sin(k * Math.PI) * 0.08; beak.position.y = -0.11 - Math.sin(k * Math.PI) * 0.03; }); }
const fpWings = [];
for (const s of [-1, 1]) {
  const piv = new THREE.Group(); piv.position.set(s * 0.16, -0.17, -0.22); fpRig.add(piv);
  const w = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.14), new THREE.MeshStandardMaterial({ map: TEX.feather, side: THREE.DoubleSide, roughness: 0.9 }));
  w.position.set(s * 0.13, 0, 0); w.rotation.x = -0.5; piv.add(w); piv.rotation.z = s * 0.1; fpWings.push(piv);
}

// ---------------------------------------------------------------- vista: primera / tercera persona
function currentScale() { return renderer.xr.isPresenting ? (view === 'first' ? CFG.vrScaleFirst : CFG.vrScaleThird) : 1; }
function applyView() {
  chicken.g.visible = view === 'third'; fpRig.visible = view === 'first';
  if (renderer.xr.isPresenting) { player.scale.setScalar(currentScale()); for (const r of ctrlRays) r.scale.z = (CFG.peckRange + 0.25) / currentScale(); }
  else if (view === 'first') { camera.position.set(0, CFG.eyeHeight, 0); camera.rotation.x = pitch; }
  placeRig(true);
  if (ui.viewBtn) ui.viewBtn.textContent = view === 'third' ? '👁 Vista: tercera persona (C)' : '👁 Vista: primera persona (C)';
}
function toggleView() { view = view === 'first' ? 'third' : 'first'; sfx.swap(); applyView(); say(view === 'third' ? 'Tercera persona: ves a tu gallina desde atrás' : 'Primera persona: ojos de gallina'); }
const _rigTarget = new THREE.Vector3();
// Coloca el rig de la cámara según la vista. En primera persona la física ya lo movió.
function placeRig(immediate = false, dt = 0) {
  if (view === 'first') { if (immediate) { player.position.copy(chicken.pos); if (renderer.xr.isPresenting) { player.updateMatrixWorld(true); const h = headPos(); player.position.x += chicken.pos.x - h.x; player.position.z += chicken.pos.z - h.z; } } return; }
  if (renderer.xr.isPresenting) { const yaw = player.rotation.y; _rigTarget.set(chicken.pos.x + Math.sin(yaw) * CFG.vrThirdBack, chicken.pos.y, chicken.pos.z + Math.cos(yaw) * CFG.vrThirdBack); }
  else {
    _rigTarget.copy(chicken.pos);
    // Encuadre TPS: la cámara orbita por detrás y arriba, pero mira menos hacia abajo de lo que
    // sugiere su elevación, para que la mira del centro apunte varios metros por delante.
    const e = THREE.MathUtils.clamp(0.42 - pitch * 0.6, 0.06, 1.25);
    camera.position.set(0, CFG.thirdHeight + CFG.thirdDist * Math.sin(e), CFG.thirdDist * Math.cos(e));
    camera.rotation.x = THREE.MathUtils.clamp(-0.23 + pitch * 0.65, -1.1, 0.7);
  }
  if (immediate) player.position.copy(_rigTarget); else player.position.lerp(_rigTarget, 1 - Math.exp(-12 * dt));
}

// ---------------------------------------------------------------- entrada: escritorio
const keys = new Set();
let pitch = 0;
const locked = () => document.pointerLockElement === renderer.domElement;
addEventListener('keydown', (e) => {
  if (e.repeat) return; keys.add(e.code);
  if (e.code === 'KeyC' && game.state !== 'menu') toggleView();
  if (game.state !== 'playing') return;
  if (e.code === 'Space') { e.preventDefault(); flap(); }
  if (e.code === 'KeyE') peckFrom(camera);
  if (e.code === 'KeyQ') poop();
  if (e.code === 'KeyF') shootEgg(camera);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('contextmenu', (e) => e.preventDefault());
renderer.domElement.addEventListener('mousedown', (e) => {
  if (renderer.xr.isPresenting || !locked() || game.state !== 'playing') return;
  if (e.button === 0) shootEgg(camera); else if (e.button === 2) peckFrom(camera); else if (e.button === 1) poop();
});
addEventListener('mousemove', (e) => {
  if (!locked() || renderer.xr.isPresenting) return;
  player.rotation.y -= e.movementX * 0.0022;
  pitch = THREE.MathUtils.clamp(pitch - e.movementY * 0.0022, -1.25, 1.25); if (view === 'first') camera.rotation.x = pitch;
});
document.addEventListener('pointerlockchange', () => {
  if (renderer.xr.isPresenting) return;
  if (locked()) { if (game.state === 'paused') { game.state = 'playing'; ui.pause.hidden = true; } }
  else if (game.state === 'playing') { game.state = 'paused'; ui.pause.hidden = false; }
});
function lockPointer() { try { renderer.domElement.requestPointerLock?.()?.catch?.(() => {}); } catch { /* sin pointer lock */ } }
ui.pause.addEventListener('click', lockPointer);
ui.play.addEventListener('click', () => { ui.results.style.display = 'none'; startGame(); });
ui.viewBtn?.addEventListener('click', () => { view = view === 'first' ? 'third' : 'first'; applyView(); });

// ---------------------------------------------------------------- entrada: Meta Quest
const xr = { mx: 0, my: 0, turnLatched: false, flapHeld: false, poopLatched: false, viewLatched: false };
const ctrlRays = [];
for (let i = 0; i < 2; i++) {
  const ctrl = renderer.xr.getController(i);
  const ray = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -1)]), new THREE.LineBasicMaterial({ color: 0xffd36b, transparent: true, opacity: 0.7 }));
  ray.scale.z = CFG.peckRange / CFG.vrScaleThird; ctrl.add(ray); ctrlRays.push(ray);
  sph(0.02, C.orange, 0, 0, 0, ctrl, 6, false);
  ctrl.visible = false;
  ctrl.addEventListener('connected', () => { ctrl.visible = true; });
  ctrl.addEventListener('disconnected', () => { ctrl.visible = false; });
  ctrl.addEventListener('selectstart', () => {
    if (game.state === 'menu' || game.state === 'over') { ui.results.style.display = 'none'; startGame(); }
    else shootEgg(ctrl);
  });
  ctrl.addEventListener('squeezestart', () => peckFrom(ctrl));
  player.add(ctrl);
}
const dead = (v) => (Math.abs(v) < 0.18 ? 0 : v);
function pollXR() {
  const session = renderer.xr.getSession(); if (!session) return;
  let mx = 0, my = 0, turn = 0, flapBtn = false, poopBtn = false, viewBtn = false;
  for (const src of session.inputSources) {
    const gp = src.gamepad; if (!gp) continue;
    const ax = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0];
    if (src.handedness === 'right') { turn = ax[0]; if (gp.buttons[3]?.pressed) viewBtn = true; } else { mx = ax[0]; my = -ax[1]; }
    if (gp.buttons[4]?.pressed) flapBtn = true;
    if (gp.buttons[5]?.pressed) poopBtn = true;
  }
  xr.mx = dead(mx); xr.my = dead(my);
  if (Math.abs(turn) > 0.6) { if (!xr.turnLatched) { snapTurn(turn > 0 ? -Math.PI / 6 : Math.PI / 6); xr.turnLatched = true; } } else xr.turnLatched = false;
  xr.flapHeld = flapBtn;
  if (poopBtn && !xr.poopLatched) poop(); xr.poopLatched = poopBtn;
  if (viewBtn && !xr.viewLatched && game.state !== 'menu') toggleView(); xr.viewLatched = viewBtn;
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
  camera.rotation.set(0, 0, 0); pitch = 0;
  // Sombras más baratas en el visor.
  renderer.shadowMap.type = THREE.PCFShadowMap; sun.shadow.mapSize.set(1024, 1024); sun.shadow.map?.dispose(); sun.shadow.map = null; renderer.shadowMap.needsUpdate = true;
  applyView();
  vrHud.mesh.visible = true; vrHud.dirty = true;
  if (game.state === 'paused') { game.state = 'playing'; ui.pause.hidden = true; }
  if (game.state === 'menu') { banner('GALLINA PRÓFUGA VR'); say('Gatillo: empezar / huevo · Agarre: picotazo · A/X: volar (mantén) · B/Y: popó · Clic stick der.: cambiar vista'); vrBanner.hold = true; }
  if (game.state === 'over') { banner('FIN · aprieta el gatillo para reintentar'); vrBanner.hold = true; }
});
renderer.xr.addEventListener('sessionend', () => {
  document.body.classList.remove('in-xr');
  player.scale.setScalar(1); camera.position.set(0, CFG.eyeHeight, 0); camera.rotation.set(0, 0, 0); pitch = 0;
  applyView();
  vrHud.mesh.visible = false; vrBanner.mesh.visible = false; vrFlash.visible = false;
  if (game.state === 'playing') { game.state = 'paused'; ui.pause.hidden = false; }
});

// ---------------------------------------------------------------- física de la gallina (correr, aletear, volar, planear)
const playerVel = new THREE.Vector3();
let vy = 0, grounded = true, standingTag = null, bob = 0, flapTimer = 0;
function flap() {
  if (game.state !== 'playing' || game.stamina < CFG.flapCost || flapTimer > 0) return;
  game.stamina -= CFG.flapCost; flapTimer = CFG.flapInterval; vy = Math.max(vy, 0) * 0.3 + CFG.flapVel; grounded = false; wingFlap = 1; sfx.flap();
  if (chicken.pos.y > CFG.ceiling) vy = Math.min(vy, 0);
}
const inCoop = (x, y, z) => Math.abs(x - COOP.x) < 1.6 && Math.abs(z - COOP.z) < 1.45 && y < 1.6;
function updatePlayer(dt) {
  let mx = 0, my = 0;
  const flapHeld = renderer.xr.isPresenting ? xr.flapHeld : keys.has('Space');
  if (renderer.xr.isPresenting) { mx = xr.mx; my = xr.my; }
  else {
    if (keys.has('KeyW') || keys.has('ArrowUp')) my += 1; if (keys.has('KeyS') || keys.has('ArrowDown')) my -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) mx += 1; if (keys.has('KeyA') || keys.has('ArrowLeft')) mx -= 1;
  }
  const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
  flapTimer = Math.max(0, flapTimer - dt);
  if (flapHeld) flap();
  const airborne = !grounded && chicken.pos.y > 0.05;
  const gliding = airborne && vy < 0 && len > 0.1;
  const speed = CFG.walkSpeed * (gliding ? CFG.glideSpeed : 1);
  const fwd = headForward();
  const rx = -fwd.z, rz = fwd.x;
  playerVel.set((fwd.x * my + rx * mx) * speed, 0, (fwd.z * my + rz * mx) * speed);
  game.stamina = Math.min(CFG.stamina, game.stamina + dt * (grounded ? CFG.staminaRegenGround : CFG.staminaRegenAir));

  // Posición de referencia: en primera persona es la cabeza (incluye el movimiento físico en VR).
  let cx = chicken.pos.x, cz = chicken.pos.z;
  if (view === 'first') { const h = headPos(); cx = h.x; cz = h.z; }
  const pos = { x: cx + playerVel.x * dt, y: chicken.pos.y, z: cz + playerVel.z * dt };
  const prevY = pos.y;
  vy -= CFG.gravity * dt * (gliding ? CFG.glideGravity : 1); pos.y += vy * dt;
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
  if (view === 'first') { player.position.x += pos.x - cx; player.position.z += pos.z - cz; player.position.y = pos.y; }
  chicken.pos.set(pos.x, pos.y, pos.z);
  if (view === 'third') placeRig(false, dt);
  if (standingTag === 'coopRoof') progress('roof');
  if (standingTag === 'windmill') progress('windmill');
  if (pos.y > 1.5) { for (const m of game.missions) if (m.type === 'fly' && !m.complete) { m.done = Math.min(m.need, m.done + dt); if (m.done >= m.need) progress('fly', 0.001); else if (Math.floor(m.done) !== Math.floor(m.done - dt)) refreshHUD(); } }

  // Orientación y animación de la gallina (modelo en tercera persona, alas en primera).
  if (len > 0.1) chicken.heading = Math.atan2(playerVel.x, playerVel.z);
  else if (view === 'first') chicken.heading = Math.atan2(fwd.x, fwd.z);
  wingFlap = Math.max(0, wingFlap - dt * 4);
  const spread = gliding ? 1 : airborne ? 0.6 : 0.1;
  const flapAngle = Math.sin(wingFlap * Math.PI) * 0.9;
  for (let i = 0; i < 2; i++) { const s = i ? 1 : -1; fpWings[i].rotation.z = s * (0.1 + spread * 0.9 + flapAngle); fpWings[i].rotation.y = -s * spread * 0.4; }
  chicken.g.position.copy(chicken.pos);
  { let d = chicken.heading - chicken.g.rotation.y; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2; chicken.g.rotation.y += d * Math.min(1, dt * 12); }
  const run = len > 0.1 && grounded; bob += dt * (run ? 11 : 0);
  for (let i = 0; i < 2; i++) { const s = i ? 1 : -1; chicken.legs[i].rotation.x = run ? Math.sin(bob + i * Math.PI) * 0.8 : (airborne ? 0.6 : 0); chicken.wings[i].rotation.z = s * (spread * 1.2 + flapAngle * 1.3); }
  chicken.g.rotation.x = gliding ? -0.25 : airborne ? -0.1 : 0;
  chicken.g.rotation.z = run ? Math.sin(bob) * 0.05 : 0;

  if (!renderer.xr.isPresenting && view === 'first') {
    camera.position.y = CFG.eyeHeight + (run ? Math.sin(bob) * 0.018 : 0);
  }
  if (run && rnd() < dt * 0.25) sfx.cluck();
}

// ---------------------------------------------------------------- IA de los personajes
const _ray = new THREE.Ray(), _box = new THREE.Box3(), _hit = new THREE.Vector3(), _from = new THREE.Vector3(), _to = new THREE.Vector3();
let _los = null;
function hasLOS(from, to) {
  _los ??= obstacles.filter((o) => o.max.y >= 0.8 && o.tag !== 'fence' && o.tag !== 'pasture');
  _ray.origin.copy(from); _ray.direction.subVectors(to, from); const d = _ray.direction.length(); _ray.direction.divideScalar(d);
  for (const o of _los) { _box.min.copy(o.min); _box.max.copy(o.max); if (_ray.intersectBox(_box, _hit) && _hit.distanceTo(from) < d) return false; }
  return true;
}
function npcBlocked(x, z, radius) {
  if (Math.abs(x) > CFG.yard - 0.6 || Math.abs(z) > CFG.yard - 0.6) return true;
  if (Math.abs(x - COOP.x) < 2.2 + radius && Math.abs(z - COOP.z) < 2.0 + radius) return true;
  if (Math.abs(x - PEN.x) < PEN.half + radius && Math.abs(z - PEN.z) < PEN.half + radius) return true;
  if (Math.abs(x - PASTURE.x) < PASTURE.half + radius && Math.abs(z - PASTURE.z) < PASTURE.half + radius) return true;
  if (Math.hypot(x - POND.x, z - POND.z) < POND.r + radius) return true;
  for (const o of obstacles) {
    if (o.max.y < 0.35 || o.tag === 'fence' || o.tag === 'pen' || o.tag === 'pasture') continue;
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
  const cp = chicken.pos; const feetY = cp.y;
  const p = farmer.g.position; const dist = Math.hypot(cp.x - p.x, cp.z - p.z);
  const playing = game.state === 'playing';
  const chickenSafe = inCoop(cp.x, feetY, cp.z);
  if (farmer.rage > 0) farmer.rage -= dt;
  _from.set(p.x, 1.6, p.z); _to.set(cp.x, feetY + 0.3, cp.z);
  const sees = playing && !chickenSafe && dist < 12 && (farmer.rage > 0 || hasLOS(_from, _to));

  if (farmer.state === 'stunned' || farmer.state === 'dazed') {
    farmer.timer -= dt; farmer.moving = false;
    farmer.g.rotation.y += dt * (farmer.state === 'dazed' ? 4 : 1.5);
    if (farmer.timer <= 0) farmer.state = farmer.state === 'dazed' && farmer.rage > 0 ? 'chase' : 'patrol';
  } else if (farmer.state === 'patrol') {
    const wp = yardWaypoints[farmer.wpi];
    if (moveNPC(farmer, wp[0], wp[1], farmer.speed, dt) || trackStuck(farmer, dt)) { farmer.wpi = (farmer.wpi + 1) % yardWaypoints.length; farmer.stuck = 0; }
    if (sees) { farmer.state = 'chase'; farmer.lost = 0; sfx.yell(); say(['Don Ramiro: "¡Ven acá, pollo del demonio!"', 'Don Ramiro: "¡Hoy hay caldo!"', 'Don Ramiro: "¡No corras, que es peor!"'][(rnd() * 3) | 0]); }
  } else if (farmer.state === 'chase') {
    const mult = farmer.rage > 0 ? 1.3 : 1;
    if (chickenSafe) {
      moveNPC(farmer, COOP.x, COOP.z - 2.6, farmer.chaseSpeed * mult, dt);
      farmer.lost += dt;
      if (farmer.lost > 4) { farmer.state = 'wait'; farmer.timer = 3.5; say('Don Ramiro: "Ya saldrás, gallina cobarde…"'); }
    } else {
      moveNPC(farmer, cp.x, cp.z, farmer.chaseSpeed * mult, dt);
      if (sees) farmer.lost = 0; else farmer.lost += dt;
      if (dist > 18 || farmer.lost > 3) { farmer.state = 'patrol'; say('Don Ramiro: "¿Dónde se metió ese pollo?"'); }
      if (feetY > 3 && dist < 3) { farmer.lost += dt * 0.5; if (rnd() < dt * 0.2) say('Don Ramiro: "¡Baja de ahí, pollo volador!"'); }
      if (trackStuck(farmer, dt)) { farmer.stuck = 0; farmer.state = 'wait'; farmer.timer = 3.5; say('Don Ramiro: "Bájate de ahí, pollo… ya te agarraré."'); }
    }
    if (playing && dist < CFG.catchRadius && feetY < 1.45 && !chickenSafe) caught();
  } else if (farmer.state === 'wait') {
    farmer.timer -= dt; farmer.moving = false;
    if (farmer.timer <= 0) { farmer.state = 'patrol'; farmer.wpi = (farmer.wpi + 2) % yardWaypoints.length; }
    if (sees && !chickenSafe && feetY < 3) { farmer.state = 'chase'; farmer.lost = 0; }
  }
  animateHuman(farmer, dt, farmer.state === 'chase' ? 1.4 : 1);
}
function updateWife(dt) {
  if (!wife.active) return;
  if (wife.state === 'flee') {
    wife.timer -= dt;
    const t = wife.g.position.clone().addScaledVector(wife.fleeDir, 3);
    if (!moveNPC(wife, t.x, t.z, 2.6, dt) && !wife.moving) wife.fleeDir.set(rnd() - 0.5, 0, rnd() - 0.5).normalize();
    if (rnd() < dt * 0.8) sfx.scream();
    if (wife.timer <= 0) wife.state = 'wander';
  } else {
    const wp = wifeWaypoints[wife.wpi];
    if (moveNPC(wife, wp[0], wp[1], wife.speed, dt) || trackStuck(wife, dt)) { wife.wpi = (wife.wpi + 1) % wifeWaypoints.length; wife.stuck = 0; }
  }
  animateHuman(wife, dt, wife.state === 'flee' ? 1.6 : 1);
}
function updateAnimal(a, zone, dt, baseSpeed, scareSpeed, bobAmp) {
  a.timer -= dt;
  if (a.timer <= 0) { a.timer = 3 + rnd() * 5; a.target.set(zone.x + (rnd() - 0.5) * (zone.half * 2 - 1.4), 0, zone.z + (rnd() - 0.5) * (zone.half * 2 - 1.4)); }
  const p = a.g.position, dx = a.target.x - p.x, dz = a.target.z - p.z, d = Math.hypot(dx, dz);
  const sp = a.wobble > 0 ? scareSpeed : baseSpeed;
  if (d > 0.1) { p.x += dx / d * sp * dt; p.z += dz / d * sp * dt; const t = Math.atan2(dx, dz); let dd = t - a.g.rotation.y; while (dd > Math.PI) dd -= Math.PI * 2; while (dd < -Math.PI) dd += Math.PI * 2; a.g.rotation.y += dd * Math.min(1, dt * 6); a.phase += dt * sp * 4; }
  const lim = zone.half - 0.8; p.x = THREE.MathUtils.clamp(p.x, zone.x - lim, zone.x + lim); p.z = THREE.MathUtils.clamp(p.z, zone.z - lim, zone.z + lim);
  if (a.wobble > 0) { a.wobble -= dt; a.g.rotation.z = Math.sin(a.wobble * 30) * 0.2; } else a.g.rotation.z = 0;
  a.g.position.y = Math.abs(Math.sin(a.phase)) * bobAmp;
}
function updateHens(dt) {
  for (const h of hens) {
    h.timer -= dt;
    const p = h.g.position;
    if (h.timer <= 0) { h.timer = 2 + rnd() * 4; h.target.set(THREE.MathUtils.clamp(p.x + (rnd() - 0.5) * 10, -30, 30), 0, THREE.MathUtils.clamp(p.z + (rnd() - 0.5) * 10, -30, 30)); }
    const dx = h.target.x - p.x, dz = h.target.z - p.z, d = Math.hypot(dx, dz);
    if (d > 0.2) {
      const nx = p.x + dx / d * 0.9 * dt, nz = p.z + dz / d * 0.9 * dt;
      if (!npcBlocked(nx, nz, 0.25)) { p.x = nx; p.z = nz; h.g.rotation.y = Math.atan2(dx, dz); h.phase += dt * 10; h.legs[0].rotation.x = Math.sin(h.phase) * 0.7; h.legs[1].rotation.x = -Math.sin(h.phase) * 0.7; } else h.timer = 0;
    }
    if (h.hop > 0) { h.hop -= dt; p.y = Math.sin(Math.max(0, h.hop) * Math.PI * 2) * 0.2; h.g.rotation.y += dt * 12; } else p.y = Math.abs(Math.sin(h.phase)) * 0.02;
  }
}

// ---------------------------------------------------------------- maíz / temporizadores
function updateCorn(dt) {
  const cp = chicken.pos;
  for (const c of cornItems) {
    c.spin += dt; c.g.rotation.y = c.spin * 1.4; c.g.position.y = Math.sin(c.spin * 2.5) * 0.04;
    if (!c.active) { c.timer -= dt; if (c.timer <= 0) { c.active = true; c.g.visible = true; c.g.position.copy(randomSpot()); } continue; }
    const dx = cp.x - c.g.position.x, dz = cp.z - c.g.position.z;
    if (dx * dx + dz * dz < 0.42 * 0.42 && cp.y < 0.6) {
      c.active = false; c.g.visible = false; c.timer = 14 + rnd() * 6;
      game.charges = Math.min(CFG.maxPoop, game.charges + 1); game.score += 10; sfx.eat(); progress('corn'); say('¡Ñam! Maíz +1 popó'); refreshHUD();
    }
  }
}

// ---------------------------------------------------------------- bucle principal
const clock = new THREE.Clock();
function update(dt) {
  game.time += dt;
  for (let i = anims.length - 1; i >= 0; i--) { const a = anims[i]; a.t += dt; const k = Math.min(1, a.t / a.dur); a.fn(k); if (k >= 1) { anims.splice(i, 1); a.done?.(); } }
  if (windmillBlades) windmillBlades.rotation.z += dt * 0.9;
  const s = game.state;
  if (s === 'playing') {
    updatePlayer(dt); updateProjectiles(dt); updateCorn(dt);
    game.cooldown = Math.max(0, game.cooldown - dt); game.eggCooldown = Math.max(0, game.eggCooldown - dt);
    game.regen += dt; if (game.regen >= CFG.poopRegen && game.charges < CFG.maxPoop) { game.regen = 0; game.charges++; refreshHUD(); }
    game.eggRegen += dt; if (game.eggRegen >= CFG.eggRegen && game.eggs < CFG.maxEggs) { game.eggRegen = 0; game.eggs++; sfx.lay(); say('¡Pusiste un huevo! 🥚'); refreshHUD(); }
    if (!inCoop(chicken.pos.x, chicken.pos.y, chicken.pos.z)) {
      for (const m of game.missions) if (m.type === 'survive' && !m.complete) { m.done = Math.min(m.need, m.done + dt); if (m.done >= m.need) progress('survive', 0.001); else if (Math.floor(m.done) !== Math.floor(m.done - dt)) refreshHUD(); }
    }
    ui.stamina.style.width = `${Math.round(game.stamina)}%`;
    if (renderer.xr.isPresenting && Math.round(game.stamina / 5) !== lastStaminaDrawn) vrHud.dirty = true;
  } else if (s === 'caught' || s === 'levelup') {
    game.timer -= dt; updateProjectiles(dt);
    if (game.timer <= 0) {
      if (s === 'caught') { if (game.lives <= 0) gameOver(); else { respawnPlayer(); game.state = 'playing'; } }
      else { loadLevel(game.level + 1); game.state = 'playing'; }
    }
  } else if (s === 'menu' || s === 'over') { chicken.g.position.copy(chicken.pos); if (view === 'third') placeRig(false, dt); }
  if (s !== 'paused') { updateFarmer(dt); updateWife(dt); updateAnimal(pig, PEN, dt, 0.6, 2.4, 0.03); updateAnimal(cow, PASTURE, dt, 0.4, 2.0, 0.02); updateHens(dt); }

  // La sombra sigue a la gallina para tener detalle en un mundo grande.
  sun.position.set(chicken.pos.x + 26, 42, chicken.pos.z + 18); sun.target.position.copy(chicken.pos);

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
applyView();
refreshHUD();
if (game.best.level > 0) ui.best.textContent = `Tu récord: nivel ${game.best.level} · ${game.best.score} puntos. ${ui.best.textContent}`;

// Ganchos de depuración/pruebas automáticas (no afectan al juego).
window.__gallina = { game, player, camera, scene, chicken, farmer, wife, pig, cow, hens, cornItems, buckets, update, progress, poop, shootEgg, flap, peckFrom, startGame, caught, obstacles, keys, renderer, loadLevel, levelUp, CFG, toggleView, getView: () => view, setPitch: (v) => { pitch = v; if (view === 'first') camera.rotation.x = v; } };
