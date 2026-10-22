// Built-in mehndi-style motifs, drawn black-on-white onto a canvas.
// Every draw fn gets (ctx, w, h, k) where w/h are canvas pixels and k = px per mm.
// Black = raised (inks), white = recessed.

const TAU = Math.PI * 2;

function setup(ctx, k, lineMm = 0.9) {
  ctx.fillStyle = '#000';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = lineMm * k;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
}

function dot(ctx, x, y, r) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

// Teardrop petal pointing along +x from (0,0) to (len,0), half-width wid.
function petalPath(ctx, len, wid) {
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(len * 0.25, -wid * 1.3, len * 0.75, -wid * 0.9, len, 0);
  ctx.bezierCurveTo(len * 0.75, wid * 0.9, len * 0.25, wid * 1.3, 0, 0);
  ctx.closePath();
}

function radialPetals(ctx, cx, cy, count, r0, r1, wid, mode, phase = 0) {
  for (let i = 0; i < count; i++) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(phase + (i * TAU) / count);
    ctx.translate(r0, 0);
    petalPath(ctx, r1 - r0, wid);
    mode === 'fill' ? ctx.fill() : ctx.stroke();
    ctx.restore();
  }
}

function ring(ctx, cx, cy, r) {
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TAU);
  ctx.stroke();
}

function dotRing(ctx, cx, cy, r, count, dr) {
  for (let i = 0; i < count; i++) {
    const a = (i * TAU) / count;
    dot(ctx, cx + r * Math.cos(a), cy + r * Math.sin(a), dr);
  }
}

function mandala(ctx, w, h, k) {
  setup(ctx, k);
  const cx = w / 2, cy = h / 2;
  const R = Math.min(w, h) / 2 - 1.5 * k;
  dot(ctx, cx, cy, R * 0.07);
  ring(ctx, cx, cy, R * 0.13);
  radialPetals(ctx, cx, cy, 8, R * 0.17, R * 0.46, R * 0.09, 'stroke');
  radialPetals(ctx, cx, cy, 8, R * 0.22, R * 0.38, R * 0.03, 'fill');
  ring(ctx, cx, cy, R * 0.5);
  radialPetals(ctx, cx, cy, 16, R * 0.53, R * 0.71, R * 0.045, 'fill', TAU / 32);
  dotRing(ctx, cx, cy, R * 0.78, 24, R * 0.022);
  // scalloped outer edge
  const n = 20;
  ctx.beginPath();
  for (let i = 0; i < n; i++) {
    const a0 = (i * TAU) / n, a1 = ((i + 1) * TAU) / n, am = (a0 + a1) / 2;
    const r = R * 0.86, ro = R * 0.98;
    const p0 = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
    const p1 = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
    const c = [cx + ro * 1.04 * Math.cos(am), cy + ro * 1.04 * Math.sin(am)];
    if (i === 0) ctx.moveTo(...p0);
    ctx.quadraticCurveTo(c[0], c[1], p1[0], p1[1]);
  }
  ctx.closePath();
  ctx.stroke();
}

function lotus(ctx, w, h, k) {
  setup(ctx, k);
  const cx = w / 2, cy = h * 0.62;
  const S = Math.min(w, h * 1.3) * 0.46;
  ctx.save();
  ctx.translate(cx, cy);
  const petals = [
    [-90, 1.0, 0.24], [-125, 0.85, 0.2], [-55, 0.85, 0.2],
    [-160, 0.7, 0.17], [-20, 0.7, 0.17],
  ];
  for (const [deg, len, wid] of petals) {
    ctx.save();
    ctx.rotate((deg * Math.PI) / 180);
    petalPath(ctx, S * len, S * wid);
    ctx.stroke();
    ctx.translate(S * len * 0.15, 0);
    petalPath(ctx, S * len * 0.55, S * wid * 0.35);
    ctx.fill();
    ctx.restore();
  }
  // base cup
  ctx.beginPath();
  ctx.ellipse(0, S * 0.05, S * 0.45, S * 0.14, 0, 0, Math.PI);
  ctx.stroke();
  for (let i = -3; i <= 3; i++) dot(ctx, i * S * 0.12, S * 0.3, S * 0.035);
  ctx.restore();
}

function paisley(ctx, x, y, s, flip) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip ? -s : s, s);
  // unit paisley ~ 1 tall, curled tip at top right
  const outline = () => {
    ctx.beginPath();
    ctx.moveTo(0, 0.5);
    ctx.bezierCurveTo(-0.45, 0.5, -0.45, -0.1, -0.15, -0.3);
    ctx.bezierCurveTo(0.05, -0.45, 0.3, -0.5, 0.32, -0.38);
    ctx.bezierCurveTo(0.34, -0.28, 0.2, -0.28, 0.2, -0.2);
    ctx.bezierCurveTo(0.4, 0.0, 0.45, 0.5, 0, 0.5);
    ctx.closePath();
  };
  outline();
  ctx.restore();
  ctx.stroke();
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(flip ? -s * 0.55 : s * 0.55, s * 0.55);
  ctx.translate(0, 0.25);
  outline();
  ctx.restore();
  ctx.fill();
}

function paisleyBorder(ctx, w, h, k) {
  setup(ctx, k);
  const m = 1.2 * k;
  ctx.beginPath();
  ctx.moveTo(m, m); ctx.lineTo(w - m, m);
  ctx.moveTo(m, h - m); ctx.lineTo(w - m, h - m);
  ctx.stroke();
  const inner = h - 2 * m;
  const count = Math.max(1, Math.round(w / (inner * 0.9)));
  const step = w / count;
  for (let i = 0; i < count; i++) {
    const x = step * (i + 0.5);
    paisley(ctx, x, h / 2, inner * 0.78, i % 2 === 1);
    if (i < count - 1) {
      dot(ctx, step * (i + 1), h / 2, inner * 0.06);
      dot(ctx, step * (i + 1), m + inner * 0.18, inner * 0.04);
      dot(ctx, step * (i + 1), h - m - inner * 0.18, inner * 0.04);
    }
  }
}

function vineBorder(ctx, w, h, k) {
  setup(ctx, k);
  const amp = h * 0.22, mid = h / 2;
  const waves = Math.max(1, Math.round(w / (h * 1.4)));
  const per = w / waves;
  ctx.beginPath();
  for (let x = 0; x <= w; x += 2) {
    const y = mid + amp * Math.sin((x / per) * TAU);
    x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.stroke();
  for (let i = 0; i < waves * 2; i++) {
    const x = per * (i / 2 + 0.25);
    const up = i % 2 === 0;
    const y = mid + amp * (up ? 1 : -1);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(up ? -Math.PI / 2 - 0.5 : Math.PI / 2 + 0.5);
    ctx.rotate(Math.PI);
    petalPath(ctx, h * 0.3, h * 0.08);
    ctx.fill();
    ctx.restore();
    dot(ctx, x + per * 0.15, mid + amp * (up ? -0.9 : 0.9), h * 0.05);
  }
}

function jaal(ctx, w, h, k) {
  setup(ctx, k, 0.8);
  const cell = Math.min(w, h) / Math.max(2, Math.round(Math.min(w, h) / (9 * k)));
  ctx.beginPath();
  for (let d = -h; d < w + h; d += cell) {
    ctx.moveTo(d, 0); ctx.lineTo(d + h, h);
    ctx.moveTo(d, h); ctx.lineTo(d + h, 0);
  }
  ctx.stroke();
  for (let y = 0; y <= h + 1; y += cell / 2) {
    const row = Math.round(y / (cell / 2));
    for (let x = row % 2 ? cell / 2 : 0; x <= w + 1; x += cell) {
      dot(ctx, x, y, cell * 0.09);
    }
  }
  for (let y = cell / 2; y < h; y += cell) {
    for (let x = 0; x <= w; x += cell) {
      radialPetals(ctx, x, y, 4, cell * 0.12, cell * 0.3, cell * 0.06, 'fill', Math.PI / 4);
    }
  }
}

export const PATTERNS = {
  mandala: { label: 'Mandala', draw: mandala },
  lotus: { label: 'Lotus', draw: lotus },
  paisley: { label: 'Paisley border', draw: paisleyBorder },
  vine: { label: 'Vine border', draw: vineBorder },
  jaal: { label: 'Jaal lattice', draw: jaal },
};
