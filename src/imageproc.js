// Image helpers for turning uploaded henna designs (scans, photos, line art)
// into a clean black/white mask.

// Luminance per pixel; transparent pixels count as white paper.
export function luminance(data, n) {
  const lum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = data[i * 4 + 3] / 255;
    lum[i] = (0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]) * a + 255 * (1 - a);
  }
  return lum;
}

// Otsu's method: the threshold that best separates ink from paper.
export function otsu(lum) {
  const hist = new Float64Array(256);
  for (let i = 0; i < lum.length; i++) hist[Math.min(255, lum[i] | 0)]++;
  const total = lum.length;
  let sumAll = 0;
  for (let t = 0; t < 256; t++) sumAll += t * hist[t];
  let sumB = 0, wB = 0, best = 0, bestT = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sumAll - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; bestT = t; }
  }
  // a nearly blank image has no real split: keep everything as paper
  return best === 0 ? 0 : bestT + 0.5;
}

// Bradley-Roth adaptive threshold: a pixel is ink when it is noticeably darker
// than its neighbourhood. Copes with shadows and uneven light in phone photos.
export function adaptiveMask(lum, w, h, strengthPct, windowPx) {
  const W = w + 1;
  const integral = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let row = 0;
    for (let x = 0; x < w; x++) {
      row += lum[y * w + x];
      integral[(y + 1) * W + x + 1] = integral[y * W + x + 1] + row;
    }
  }
  const r = Math.max(4, windowPx >> 1);
  const k = 1 - strengthPct / 100;
  const mask = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r), y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r), x1 = Math.min(w, x + r + 1);
      const sum = integral[y1 * W + x1] - integral[y0 * W + x1] - integral[y1 * W + x0] + integral[y0 * W + x0];
      const count = (x1 - x0) * (y1 - y0);
      mask[y * w + x] = lum[y * w + x] * count < sum * k ? 1 : 0;
    }
  }
  return mask;
}

// Crop an image to the bounding box of its ink, with a little padding.
// Returns a canvas (drawable like an image) or the original if nothing to trim.
export function trimToInk(img, padFrac = 0.03) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const s = Math.min(1, 800 / Math.max(iw, ih));
  const w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  const lum = luminance(ctx.getImageData(0, 0, w, h).data, w * h);
  const t = otsu(lum);
  // count ink per row/column; ignore rows/cols with only a stray speck
  const rows = new Uint32Array(h), cols = new Uint32Array(w);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (lum[y * w + x] < t) { rows[y]++; cols[x]++; }
  }
  const minCount = 2;
  let x0 = cols.findIndex((v) => v >= minCount), y0 = rows.findIndex((v) => v >= minCount);
  if (x0 < 0 || y0 < 0) return img;
  let x1 = w - 1, y1 = h - 1;
  while (cols[x1] < minCount) x1--;
  while (rows[y1] < minCount) y1--;
  const pad = Math.round(Math.max(x1 - x0, y1 - y0) * padFrac);
  x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad);
  x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
  if (x0 === 0 && y0 === 0 && x1 === w - 1 && y1 === h - 1) return img;
  const sx = x0 / s, sy = y0 / s, sw = (x1 - x0 + 1) / s, sh = (y1 - y0 + 1) / s;
  const out = document.createElement('canvas');
  out.width = Math.round(sw); out.height = Math.round(sh);
  const octx = out.getContext('2d');
  octx.fillStyle = '#fff';
  octx.fillRect(0, 0, out.width, out.height);
  octx.drawImage(img, sx, sy, sw, sh, 0, 0, out.width, out.height);
  return out;
}
