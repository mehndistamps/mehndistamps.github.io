import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PATTERNS } from './patterns.js';
import { traceMask } from './trace.js';
import { initGeometry, buildParts } from './geometry.js';
import { meshToStl, download } from './stl.js';

const $ = (id) => document.getElementById(id);
const NUM_FIELDS = ['blur', 'imgScale', 'imgRotate', 'width', 'height', 'corner', 'reliefDepth', 'padBase',
  'weight', 'shoulder', 'margin', 'border', 'borderInset', 'padInset', 'bodyThick', 'handleHeight',
  'knobDia', 'gripThick', 'res', 'smooth', 'minArea', 'threshold'];

// Shape/size each built-in motif is designed around.
const PRESET_SHAPES = {
  mandala: { shape: 'circle', width: 50 },
  lotus: { shape: 'circle', width: 45 },
  paisley: { shape: 'rect', width: 84, height: 25 },
  vine: { shape: 'rect', width: 84, height: 25 },
  jaal: { shape: 'rect', width: 50, height: 50 },
};

let uploaded = null; // HTMLImageElement
let result = null;

// ---------- controls ----------
const sourceSel = $('source');
for (const [k, v] of Object.entries(PATTERNS)) sourceSel.add(new Option(v.label, k));
sourceSel.add(new Option('Upload image…', 'upload'));
sourceSel.value = 'paisley';

function params() {
  const p = { source: sourceSel.value, shape: $('shape').value, handle: $('handle').value,
    invert: $('invert').checked, mirror: $('mirror').checked };
  for (const f of NUM_FIELDS) p[f] = parseFloat($(f).value) || 0;
  if (p.shape === 'circle' || p.shape === 'hex') p.height = p.width;
  p.res = Math.max(0.04, p.res);
  return p;
}

function syncVisibility() {
  const shape = $('shape').value;
  $('heightRow').style.display = shape === 'circle' || shape === 'hex' ? 'none' : '';
  $('cornerRow').style.display = shape === 'rect' ? '' : 'none';
  $('uploadRow').style.display = sourceSel.value === 'upload' ? '' : 'none';
}

sourceSel.addEventListener('change', () => {
  const preset = PRESET_SHAPES[sourceSel.value];
  if (preset) {
    $('shape').value = preset.shape;
    $('width').value = preset.width;
    if (preset.height) $('height').value = preset.height;
  }
  syncVisibility();
  schedule();
});
$('file').addEventListener('change', (e) => {
  const f = e.target.files[0];
  if (!f) return;
  const img = new Image();
  img.onload = () => { uploaded = img; schedule(); };
  img.src = URL.createObjectURL(f);
});
$('controls').addEventListener('input', (e) => {
  if (e.target.id === 'file' || e.target.id === 'source') return;
  syncVisibility();
  schedule();
});
$('explode').addEventListener('change', placeMeshes);
$('flipView').addEventListener('change', placeMeshes);

// ---------- design raster ----------
function rasterize(p) {
  const k = 1 / p.res; // px per mm
  const w = Math.max(8, Math.round(p.width * k));
  const h = Math.max(8, Math.round(p.height * k));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  if (p.blur > 0) ctx.filter = `blur(${p.blur * k}px)`;

  ctx.save();
  ctx.translate(w / 2, h / 2);
  ctx.rotate((p.imgRotate * Math.PI) / 180);
  ctx.scale(p.imgScale / 100, p.imgScale / 100);
  ctx.translate(-w / 2, -h / 2);
  if (p.source === 'upload') {
    if (uploaded) {
      const s = Math.min(w / uploaded.naturalWidth, h / uploaded.naturalHeight);
      const iw = uploaded.naturalWidth * s, ih = uploaded.naturalHeight * s;
      ctx.drawImage(uploaded, (w - iw) / 2, (h - ih) / 2, iw, ih);
    }
  } else {
    PATTERNS[p.source].draw(ctx, w, h, k);
  }
  ctx.restore();

  const data = ctx.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = data[i * 4 + 3] / 255;
    const lum = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) * a + 255 * (1 - a);
    mask[i] = (lum < p.threshold) !== p.invert ? 1 : 0;
  }
  return { mask, w, h };
}

// ---------- impression preview ----------
function drawImpression(r) {
  const cv = $('impression');
  const { W, H } = r.dims;
  const scale = Math.min(10, 1600 / W, 520 / H);
  const pad = 12;
  cv.width = Math.round(W * scale + pad * 2);
  cv.height = Math.round(H * scale + pad * 2);
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fbf8f2';
  ctx.fillRect(0, 0, cv.width, cv.height);
  const tx = (x) => cv.width / 2 + x * scale;
  const ty = (y) => cv.height / 2 - y * scale;
  const path = (polys) => {
    ctx.beginPath();
    for (const poly of polys) {
      poly.forEach(([x, y], i) => (i ? ctx.lineTo(tx(x), ty(y)) : ctx.moveTo(tx(x), ty(y))));
      ctx.closePath();
    }
  };
  path(r.outlinePolys);
  ctx.strokeStyle = '#d9cbb8';
  ctx.setLineDash([6, 4]);
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.setLineDash([]);
  path(r.reliefPolys);
  ctx.fillStyle = '#7a2e12'; // henna
  ctx.fill('evenodd');
}

// ---------- 3D view ----------
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
view.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(35, 1, 1, 5000);
camera.up.set(0, 0, 1);
camera.position.set(90, -140, 110);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
scene.add(new THREE.HemisphereLight(0xfff6ea, 0x40342a, 1.4));
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(80, -60, 160);
scene.add(sun);
const fill = new THREE.DirectionalLight(0xffffff, 0.6);
fill.position.set(-100, 80, -60);
scene.add(fill);

const bodyMat = new THREE.MeshStandardMaterial({ color: 0xc8a27a, roughness: 0.7 });
const padMat = new THREE.MeshStandardMaterial({ color: 0xc8483a, roughness: 0.85 });
const group = new THREE.Group();
scene.add(group);
let bodyObj = null, padObj = null, framed = false;

function toGeometry(mesh) {
  const g = new THREE.BufferGeometry();
  const { vertProperties: vp, numProp: np, triVerts } = mesh;
  const pos = new Float32Array((vp.length / np) * 3);
  for (let i = 0, j = 0; i < vp.length; i += np, j += 3) {
    pos[j] = vp[i]; pos[j + 1] = vp[i + 1]; pos[j + 2] = vp[i + 2];
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(triVerts, 1));
  const flat = g.toNonIndexed();
  flat.computeVertexNormals();
  g.dispose();
  return flat;
}

function showMeshes(r) {
  for (const o of [bodyObj, padObj]) if (o) { group.remove(o); o.geometry.dispose(); }
  bodyObj = new THREE.Mesh(toGeometry(r.bodyMesh), bodyMat);
  padObj = new THREE.Mesh(toGeometry(r.padMesh), padMat);
  group.add(bodyObj, padObj);
  placeMeshes();
  if (!framed) {
    const size = Math.max(r.dims.W, r.dims.H, 30);
    camera.position.set(size * 1.1, -size * 1.7, size * 1.3);
    controls.target.set(0, 0, 4);
    framed = true;
  }
}

function placeMeshes() {
  if (!padObj) return;
  padObj.position.z = $('explode').checked ? -10 : 0;
  group.rotation.x = $('flipView').checked ? Math.PI : 0;
}

function resize() {
  const r = view.getBoundingClientRect();
  const w = r.width - 24, h = Math.max(340, r.height - 60);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(view);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

// ---------- build ----------
let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 200);
}

function rebuild() {
  const status = $('status');
  try {
    const p = params();
    const t0 = performance.now();
    const { mask, w, h } = rasterize(p);
    const loops = traceMask(mask, w, h, p.res, { mirror: p.mirror, minArea: p.minArea });
    result = buildParts(loops, p);
    drawImpression(result);
    showMeshes(result);
    const ms = Math.round(performance.now() - t0);
    const g = (v) => (v * 1.24 / 1000).toFixed(1); // PLA/TPU ≈ 1.24 g/cm³ (TPU ~1.21)
    $('stats').textContent =
      `${result.dims.W.toFixed(1)} × ${result.dims.H.toFixed(1)} mm · ` +
      `handle: ${result.handle} · body ≈ ${g(result.volumes.body)} g · pad ≈ ${g(result.volumes.pad)} g · ${ms} ms`;
    status.textContent = p.source === 'upload' && !uploaded ? 'Choose an image to upload' : '';
    for (const id of ['dlBody', 'dlPad', 'dlOne']) $(id).disabled = false;
  } catch (err) {
    console.error(err);
    status.textContent = `Couldn't build: ${err.message || err}`;
  }
}

function baseName() {
  const p = params();
  const src = p.source === 'upload' ? 'custom' : p.source;
  return `mehndi-${src}-${Math.round(p.width)}x${Math.round(p.height)}`;
}
$('dlBody').onclick = () => result && download(meshToStl(result.bodyPrint, 'body'), `${baseName()}-body-PLA.stl`);
$('dlPad').onclick = () => result && download(meshToStl(result.padPrint, 'pad'), `${baseName()}-pad-TPU.stl`);
$('dlOne').onclick = () => result && download(meshToStl(result.onePiecePrint, 'one-piece'), `${baseName()}-onepiece.stl`);

// ---------- start ----------
syncVisibility();
initGeometry()
  .then(() => { $('status').textContent = ''; rebuild(); })
  .catch((e) => { $('status').textContent = `Geometry engine failed to load: ${e.message || e}`; });
