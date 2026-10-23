// Drawing pad for doodling a mehndi design directly in the app.
//
// Strokes are stored as vectors in millimetres, centred on the block, with
// y pointing down (screen/image convention). Symmetry is stored per stroke and
// expanded at render time, so the same strokes render crisply both on screen
// and into the high-resolution mask used to build the stamp.

const STORAGE_KEY = 'mehndi-doodle-v1';

export const SYMMETRIES = {
  none: 'Off',
  mirror: 'Mirror ↔',
  mirror4: 'Mirror 4-way',
  radial6: 'Radial 6',
  radial8: 'Radial 8',
  kaleido8: 'Kaleidoscope 8',
  radial12: 'Radial 12',
};

// 2D transforms (as [a, b, c, d] for x' = a x + c y, y' = b x + d y) for a symmetry.
function symmetryTransforms(sym) {
  const rot = (t) => [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t)];
  const flip = ([a, b, c, d]) => [-a, -b, c, d]; // mirror across the vertical axis, then rotate
  if (sym === 'mirror') return [[1, 0, 0, 1], [-1, 0, 0, 1]];
  if (sym === 'mirror4') return [[1, 0, 0, 1], [-1, 0, 0, 1], [1, 0, 0, -1], [-1, 0, 0, -1]];
  const m = /^(radial|kaleido)(\d+)$/.exec(sym || '');
  if (!m) return [[1, 0, 0, 1]];
  const n = Number(m[2]);
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = rot((i * 2 * Math.PI) / n);
    out.push(r);
    if (m[1] === 'kaleido') out.push(flip(r));
  }
  return out;
}

function tracePath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  if (pts.length === 2) ctx.lineTo(pts[1][0], pts[1][1]);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i][0] + pts[i + 1][0]) / 2, my = (pts[i][1] + pts[i + 1][1]) / 2;
    ctx.quadraticCurveTo(pts[i][0], pts[i][1], mx, my);
  }
  if (pts.length > 2) ctx.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
}

// Draw strokes onto a context already scaled to millimetres with the origin
// at the block centre.
export function renderStrokes(ctx, strokes, { ink = '#000', paper = '#fff' } = {}) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const s of strokes) {
    if (!s.points.length) continue;
    const color = s.tool === 'eraser' ? paper : ink;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;
    for (const [a, b, c, d] of symmetryTransforms(s.sym)) {
      ctx.save();
      ctx.transform(a, b, c, d, 0, 0);
      if (s.tool === 'dots') {
        for (const [x, y] of s.points) {
          ctx.beginPath();
          ctx.arc(x, y, s.size * 0.75, 0, Math.PI * 2);
          ctx.fill();
        }
      } else {
        const w = s.tool === 'eraser' ? s.size * 3 : s.size;
        if (s.points.length === 1) {
          ctx.beginPath();
          ctx.arc(s.points[0][0], s.points[0][1], w / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.lineWidth = w;
          tracePath(ctx, s.points);
          ctx.stroke();
        }
      }
      ctx.restore();
    }
  }
}

// Block outline in mm, y down (matches geometry.outlineFor).
function outlinePath(ctx, { shape, W, H, corner }) {
  ctx.beginPath();
  if (shape === 'circle') ctx.arc(0, 0, W / 2, 0, Math.PI * 2);
  else if (shape === 'oval') ctx.ellipse(0, 0, W / 2, H / 2, 0, 0, Math.PI * 2);
  else if (shape === 'hex') {
    for (let i = 0; i < 6; i++) {
      const t = ((30 + 60 * i) * Math.PI) / 180;
      ctx.lineTo((W / 2) * Math.cos(t), -(W / 2) * Math.sin(t));
    }
    ctx.closePath();
  } else ctx.roundRect(-W / 2, -H / 2, W, H, Math.min(corner, W / 2, H / 2));
}

export function loadStrokes() {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(v) ? v : [];
  } catch { return []; }
}

function saveStrokes(strokes) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(strokes)); } catch { /* private mode etc. */ }
}

export function createDoodle({ dialog, getBlock, onChange }) {
  const q = (sel) => dialog.querySelector(sel);
  const canvas = q('canvas');
  const pad = q('.pad');
  const ctx = canvas.getContext('2d');
  let strokes = loadStrokes();
  let redo = [];
  let live = null;     // stroke being drawn
  let view = { s: 1, block: null };
  let tool = 'pen';
  const sizeEl = q('#doodleSize'), symEl = q('#doodleSym'), sizeOut = q('#doodleSizeOut');
  for (const [k, v] of Object.entries(SYMMETRIES)) symEl.add(new Option(v, k));
  symEl.value = 'radial8';

  const css = (name) => getComputedStyle(dialog).getPropertyValue(name).trim();

  function layout() {
    const block = getBlock();
    const pw = pad.clientWidth, ph = pad.clientHeight;
    if (!pw || !ph) return;
    const s = Math.min(pw / (block.W * 1.06), ph / (block.H * 1.06));
    const dpr = Math.min(3, devicePixelRatio || 1);
    canvas.style.width = `${Math.floor(block.W * 1.06 * s)}px`;
    canvas.style.height = `${Math.floor(block.H * 1.06 * s)}px`;
    canvas.width = Math.floor(block.W * 1.06 * s * dpr);
    canvas.height = Math.floor(block.H * 1.06 * s * dpr);
    view = { s, dpr, block };
    draw();
  }

  function draw() {
    const { s, dpr, block } = view;
    if (!block) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(s * dpr, 0, 0, s * dpr, canvas.width / 2, canvas.height / 2);
    const paper = css('--paper') || '#fbf8f2';
    // paper inside the block, clipped so strokes past the edge don't show
    outlinePath(ctx, block);
    ctx.fillStyle = paper;
    ctx.fill();
    ctx.save();
    outlinePath(ctx, block);
    ctx.clip();
    // symmetry guides
    const sym = symEl.value;
    ctx.strokeStyle = 'rgba(180, 68, 43, 0.18)';
    ctx.lineWidth = 1 / s;
    ctx.setLineDash([4 / s, 4 / s]);
    const R = Math.hypot(block.W, block.H);
    ctx.beginPath();
    if (sym === 'mirror' || sym === 'mirror4') {
      ctx.moveTo(0, -R); ctx.lineTo(0, R);
      if (sym === 'mirror4') { ctx.moveTo(-R, 0); ctx.lineTo(R, 0); }
    } else if (sym !== 'none') {
      // a ray along each copy's "up" direction
      for (const [, , c, d] of symmetryTransforms(sym)) { ctx.moveTo(0, 0); ctx.lineTo(-c * R, -d * R); }
    }
    ctx.stroke();
    ctx.setLineDash([]);
    renderStrokes(ctx, live ? [...strokes, live] : strokes, { ink: '#7a2e12', paper });
    ctx.restore();
    // edge-margin guide
    ctx.save();
    ctx.setLineDash([3 / s, 3 / s]);
    ctx.strokeStyle = 'rgba(120, 90, 60, 0.45)';
    ctx.lineWidth = 1 / s;
    outlinePath(ctx, block);
    ctx.stroke();
    ctx.restore();
    q('#doodleUndo').disabled = !strokes.length;
    q('#doodleRedo').disabled = !redo.length;
    q('#doodleClear').disabled = !strokes.length;
  }

  const toMm = (e) => {
    const r = canvas.getBoundingClientRect();
    return [(e.clientX - r.left - r.width / 2) / view.s, (e.clientY - r.top - r.height / 2) / view.s];
  };

  let activePointer = null, lastDot = null;
  canvas.addEventListener('pointerdown', (e) => {
    if (activePointer !== null) return; // one finger draws; ignore extra touches
    activePointer = e.pointerId;
    canvas.setPointerCapture(e.pointerId);
    const p = toMm(e);
    live = { tool, size: Number(sizeEl.value), sym: symEl.value, points: [p] };
    lastDot = p;
    draw();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== activePointer || !live) return;
    const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of events.length ? events : [e]) {
      const p = toMm(ev);
      if (live.tool === 'dots') {
        const gap = live.size * 2.4;
        if (Math.hypot(p[0] - lastDot[0], p[1] - lastDot[1]) >= gap) { live.points.push(p); lastDot = p; }
      } else {
        const last = live.points[live.points.length - 1];
        if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.25) live.points.push(p);
      }
    }
    draw();
  });
  const finish = (e) => {
    if (e.pointerId !== activePointer) return;
    activePointer = null;
    if (live) {
      strokes.push(live);
      redo = [];
      live = null;
      commit();
    }
  };
  canvas.addEventListener('pointerup', finish);
  canvas.addEventListener('pointercancel', finish);

  function commit() {
    saveStrokes(strokes);
    draw();
    onChange(strokes);
  }

  q('#doodleUndo').addEventListener('click', () => { if (strokes.length) { redo.push(strokes.pop()); commit(); } });
  q('#doodleRedo').addEventListener('click', () => { if (redo.length) { strokes.push(redo.pop()); commit(); } });
  q('#doodleClear').addEventListener('click', () => {
    if (!strokes.length) return;
    redo = [...strokes].reverse(); // clearing is undoable via redo
    strokes = [];
    commit();
  });
  dialog.querySelectorAll('[data-tool]').forEach((b) => b.addEventListener('click', () => {
    tool = b.dataset.tool;
    dialog.querySelectorAll('[data-tool]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
  }));
  const syncSize = () => { sizeOut.textContent = `${Number(sizeEl.value).toFixed(1)} mm`; };
  sizeEl.addEventListener('input', syncSize);
  syncSize();
  let symTouched = false;
  symEl.addEventListener('change', () => { symTouched = true; draw(); });
  dialog.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
      e.preventDefault();
      q(e.shiftKey ? '#doodleRedo' : '#doodleUndo').click();
    }
  });
  new ResizeObserver(() => dialog.open && layout()).observe(pad);

  return {
    open() {
      // until the user picks one: radial symmetry for round-ish blocks, mirror for long border blocks
      if (!symTouched) {
        const { W, H } = getBlock();
        symEl.value = Math.max(W, H) / Math.min(W, H) > 1.4 ? 'mirror4' : 'radial8';
      }
      dialog.showModal();
      requestAnimationFrame(layout);
    },
    get strokes() { return strokes; },
  };
}
