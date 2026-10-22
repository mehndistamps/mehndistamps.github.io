// Turn a binary pixel mask into closed polygon loops (in mm) by walking the
// boundary edges between "on" and "off" pixels. Diagonally touching pixels are
// kept as separate islands so loops never self-intersect.

// Direction codes: 0:+x 1:+y 2:-x 3:-y (image coords, y down)
const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

export function traceMask(mask, w, h, mmPerPx, { mirror = false, minArea = 0.3 } = {}) {
  const W = w + 1;
  const out = new Uint8Array(W * (h + 1)); // bitmask of outgoing edge dirs per grid vertex
  const on = (x, y) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] === 1;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x] !== 1) continue;
      if (!on(x, y - 1)) out[y * W + x] |= 1;               // top:    (x,y)->(x+1,y)
      if (!on(x + 1, y)) out[y * W + x + 1] |= 2;           // right:  (x+1,y)->(x+1,y+1)
      if (!on(x, y + 1)) out[(y + 1) * W + x + 1] |= 4;     // bottom: (x+1,y+1)->(x,y+1)
      if (!on(x - 1, y)) out[(y + 1) * W + x] |= 8;         // left:   (x,y+1)->(x,y)
    }
  }

  const sx = mirror ? -mmPerPx : mmPerPx;
  const toMm = (vx, vy) => [(vx - w / 2) * sx, (h / 2 - vy) * mmPerPx];
  const loops = [];
  const minAreaPx = minArea / (mmPerPx * mmPerPx);

  for (let v0 = 0; v0 < out.length; v0++) {
    while (out[v0]) {
      let d = 31 - Math.clz32(out[v0] & -out[v0]); // lowest set bit
      let vx = v0 % W, vy = (v0 / W) | 0;
      const pts = [];
      let area2 = 0;
      let prevD = -1;
      for (;;) {
        const v = vy * W + vx;
        out[v] &= ~(1 << d);
        if (d !== prevD) pts.push(vx, vy);
        const nx = vx + DX[d], ny = vy + DY[d];
        area2 += vx * ny - nx * vy;
        vx = nx; vy = ny;
        prevD = d;
        const m = out[vy * W + vx];
        if (!m) break; // back at start
        const left = (d + 1) & 3, right = (d + 3) & 3;
        if (m & (1 << left)) d = left;
        else if (m & (1 << d)) { /* straight */ }
        else d = right;
      }
      if (Math.abs(area2 / 2) < minAreaPx) continue;
      const poly = [];
      for (let i = 0; i < pts.length; i += 2) poly.push(toMm(pts[i], pts[i + 1]));
      if (poly.length >= 3) loops.push(poly);
    }
  }
  return loops;
}
