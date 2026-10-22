import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PATTERNS } from './patterns.js';
import { traceMask } from './trace.js';
import { initGeometry, buildParts } from './geometry.js';
import { meshToStl, download } from './stl.js';
import { luminance, otsu, adaptiveMask, trimToInk } from './imageproc.js';

const $ = (id) => document.getElementById(id);
const NUM_FIELDS = ['blur', 'imgScale', 'imgRotate', 'width', 'height', 'corner', 'reliefDepth', 'padBase',
  'weight', 'shoulder', 'margin', 'border', 'borderInset', 'padInset', 'bodyThick', 'handleHeight',
  'knobDia', 'gripThick', 'res', 'smooth', 'minArea', 'threshold', 'adaptive'];

// Shape/size each built-in motif is designed around.
const PRESET_SHAPES = {
  mandala: { shape: 'circle', width: 50 },
  lotus: { shape: 'circle', width: 45 },
  paisley: { shape: 'rect', width: 84, height: 25 },
  vine: { shape: 'rect', width: 84, height: 25 },
  jaal: { shape: 'rect', width: 50, height: 50 },
};

const upload = { raw: null, src: null, name: '', thumbUrl: null }; // src: trimmed canvas or raw image
let result = null;
let builds = 0;

// ---------- controls ----------
const sourceSel = $('source');
for (const [k, v] of Object.entries(PATTERNS)) sourceSel.add(new Option(v.label, k));
sourceSel.add(new Option('Uploaded image', 'upload'));
sourceSel.value = 'paisley';

function params() {
  const p = { source: sourceSel.value, shape: $('shape').value, handle: $('handle').value,
    threshMode: $('threshMode').value, invert: $('invert').checked, mirror: $('mirror').checked };
  for (const f of NUM_FIELDS) p[f] = parseFloat($(f).value) || 0;
  if (p.shape === 'circle' || p.shape === 'hex') p.height = p.width;
  p.width = Math.max(5, p.width);
  p.height = Math.max(5, p.height);
  p.res = Math.max(0.04, p.res);
  return p;
}

function show(id, on) { $(id).style.display = on ? '' : 'none'; }

function syncVisibility() {
  const shape = $('shape').value, mode = $('threshMode').value, isUpload = sourceSel.value === 'upload';
  show('heightRow', shape !== 'circle' && shape !== 'hex');
  show('cornerRow', shape === 'rect');
  show('thresholdRow', mode === 'manual');
  show('adaptiveRow', mode === 'adaptive');
  show('trimRow', isUpload);
  show('fitRow', isUpload);
  $('dropActions').classList.toggle('show', isUpload && !!upload.src);
}

function applyPreset(name) {
  const preset = PRESET_SHAPES[name];
  if (!preset) return;
  $('shape').value = preset.shape;
  $('width').value = preset.width;
  if (preset.height) $('height').value = preset.height;
}

sourceSel.addEventListener('change', () => {
  if (sourceSel.value === 'upload' && !upload.src) $('file').click();
  applyPreset(sourceSel.value);
  syncVisibility();
  schedule();
});
$('controls').addEventListener('input', (e) => {
  if (['file', 'source', 'trim', 'fit'].includes(e.target.id)) return;
  syncVisibility();
  schedule();
});
$('trim').addEventListener('change', () => { if (upload.raw) { prepareUpload(false); schedule(); } });
$('explode').addEventListener('change', placeMeshes);
$('flipView').addEventListener('change', placeMeshes);

// ---------- uploads: click, drag & drop, paste ----------
const IMAGE_EXT = /\.(jpe?g|png|webp|gif|bmp|svg|avif|heic|heif|tiff?)$/i;

function uploadError(msg) { $('uploadError').textContent = msg || ''; }

function handleFile(file) {
  uploadError('');
  if (!file) return;
  if (!(file.type.startsWith('image/') || IMAGE_EXT.test(file.name))) {
    uploadError(`"${file.name}" isn't an image. Use a JPEG, PNG, WebP or SVG of your henna design.`);
    return;
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    if (upload.thumbUrl) URL.revokeObjectURL(upload.thumbUrl);
    Object.assign(upload, { raw: img, name: file.name, thumbUrl: url });
    prepareUpload(true);
    $('dropThumb').outerHTML = `<img id="dropThumb" alt="" src="${url}">`;
    const iw = img.naturalWidth, ih = img.naturalHeight;
    $('dropText').innerHTML = '<strong></strong><small></small>';
    $('dropText').querySelector('strong').textContent = file.name;
    $('dropText').querySelector('small').textContent = `${iw} × ${ih}px · click or drop to replace`;
    sourceSel.value = 'upload';
    syncVisibility();
    rebuild();
  };
  img.onerror = () => {
    URL.revokeObjectURL(url);
    uploadError(/\.(heic|heif)$/i.test(file.name)
      ? 'This browser can\'t open HEIC photos. Export it as JPEG first (Share → Save as JPEG), then upload.'
      : `Couldn't read "${file.name}". Try saving it as JPEG or PNG.`);
  };
  img.src = url;
}

// Trim margins and (first time) size the block to the design's proportions.
function prepareUpload(firstLoad) {
  upload.src = $('trim').checked ? trimToInk(upload.raw) : upload.raw;
  if (firstLoad && $('fit').checked) {
    const sw = upload.src.naturalWidth || upload.src.width;
    const sh = upload.src.naturalHeight || upload.src.height;
    const aspect = sh / sw;
    if (Math.abs(aspect - 1) < 0.08) {
      if ($('shape').value === 'rect') $('height').value = $('width').value;
    } else {
      if (!['rect', 'oval'].includes($('shape').value)) $('shape').value = 'rect';
      const W = parseFloat($('width').value) || 60;
      const H = Math.round(W * aspect);
      if (H < 10) { $('height').value = 10; $('width').value = Math.round(10 / aspect); }
      else if (H > 200) { $('height').value = 200; $('width').value = Math.max(10, Math.round(200 / aspect)); }
      else $('height').value = H;
    }
  }
}

$('file').addEventListener('change', (e) => { handleFile(e.target.files[0]); e.target.value = ''; });
$('clearUpload').addEventListener('click', () => {
  if (upload.thumbUrl) URL.revokeObjectURL(upload.thumbUrl);
  Object.assign(upload, { raw: null, src: null, name: '', thumbUrl: null });
  $('dropThumb').outerHTML = '<span class="ph" id="dropThumb" aria-hidden="true">⇪</span>';
  $('dropText').innerHTML = '<strong>Upload your henna design</strong><small>JPEG, PNG, WebP or SVG</small>';
  sourceSel.value = 'paisley';
  applyPreset('paisley');
  uploadError('');
  syncVisibility();
  rebuild();
});

const drop = $('drop');
drop.tabIndex = 0;
drop.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  e.preventDefault();
  // input.click() from a keydown doesn't open Chrome's picker; showPicker() does
  try { $('file').showPicker(); } catch { $('file').click(); }
});
let dragDepth = 0;
window.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; drop.classList.add('dragging'); });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; drop.classList.remove('dragging'); } });
window.addEventListener('dragover', (e) => e.preventDefault());
window.addEventListener('drop', (e) => {
  e.preventDefault();
  dragDepth = 0;
  drop.classList.remove('dragging');
  handleFile(e.dataTransfer?.files?.[0]);
});
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) handleFile(new File([item.getAsFile()], 'pasted-design.png', { type: item.type }));
});

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
    const src = upload.src;
    if (src) {
      const sw = src.naturalWidth || src.width, sh = src.naturalHeight || src.height;
      const s = Math.min(w / sw, h / sh);
      ctx.drawImage(src, (w - sw * s) / 2, (h - sh * s) / 2, sw * s, sh * s);
    }
  } else {
    PATTERNS[p.source].draw(ctx, w, h, k);
  }
  ctx.restore();

  const lum = luminance(ctx.getImageData(0, 0, w, h).data, w * h);
  let mask;
  if (p.threshMode === 'adaptive') {
    mask = adaptiveMask(lum, w, h, p.adaptive, Math.round(Math.min(w, h) / 6));
  } else {
    const t = p.threshMode === 'auto' ? otsu(lum) : p.threshold;
    mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = lum[i] < t ? 1 : 0;
  }
  if (p.invert) for (let i = 0; i < mask.length; i++) mask[i] ^= 1;
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
const stage = $('stage');
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
stage.prepend(renderer.domElement);
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
let bodyObj = null, padObj = null, framedFor = '';

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
  // re-frame the camera when the block size changes noticeably
  const size = Math.max(r.dims.W, r.dims.H, 30);
  const key = String(Math.round(size / 10));
  if (key !== framedFor) {
    camera.position.set(size * 1.1, -size * 1.7, size * 1.3);
    controls.target.set(0, 0, 4);
    framedFor = key;
  }
}

function placeMeshes() {
  if (!padObj) return;
  padObj.position.z = $('explode').checked ? -10 : 0;
  group.rotation.x = $('flipView').checked ? Math.PI : 0;
}

function resize() {
  const w = stage.clientWidth, h = stage.clientHeight;
  if (!w || !h) return;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(stage);
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera); });

// ---------- build ----------
let timer = null;
function schedule() {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 200);
}

function rebuild() {
  clearTimeout(timer);
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
    const empty = result.reliefArea < 0.5;
    status.textContent = p.source === 'upload' && !upload.src ? 'Upload an image to start'
      : empty ? 'No design found: try another threshold mode or Invert' : '';
    for (const id of ['dlBody', 'dlPad', 'dlOne', 'dlBoth', 'dlBothSide']) $(id).disabled = false;
  } catch (err) {
    console.error(err);
    status.textContent = `Couldn't build: ${err.message || err}`;
  }
  document.body.dataset.builds = ++builds; // lets UI tests wait for a rebuild
}

function baseName() {
  const p = params();
  const src = p.source === 'upload'
    ? (upload.name.replace(/\.[^.]+$/, '').replace(/[^\w-]+/g, '-').slice(0, 40) || 'custom')
    : p.source;
  return `mehndi-${src}-${Math.round(p.width)}x${Math.round(p.height)}`;
}
const dlBody = () => result && download(meshToStl(result.bodyPrint, 'body'), `${baseName()}-body-PLA.stl`);
const dlPad = () => result && download(meshToStl(result.padPrint, 'pad'), `${baseName()}-pad-TPU.stl`);
const dlBoth = () => { dlBody(); setTimeout(dlPad, 400); };
$('dlBody').onclick = dlBody;
$('dlPad').onclick = dlPad;
$('dlOne').onclick = () => result && download(meshToStl(result.onePiecePrint, 'one-piece'), `${baseName()}-onepiece.stl`);
$('dlBoth').onclick = dlBoth;
$('dlBothSide').onclick = dlBoth;

// ---------- start ----------
syncVisibility();
initGeometry()
  .then(() => { $('status').textContent = ''; rebuild(); })
  .catch((e) => { $('status').textContent = `Geometry engine failed to load: ${e.message || e}`; });
