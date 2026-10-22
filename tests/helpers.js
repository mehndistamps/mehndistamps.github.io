import { expect } from '@playwright/test';
import fs from 'node:fs';

// Open the app and wait for the first build; collects page errors.
export async function openApp(page) {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-builds', /[1-9]/);
  return errors;
}

export const builds = (page) => page.evaluate(() => Number(document.body.dataset.builds || 0));

// Run an action and wait until the app has rebuilt the model after it.
export async function rebuiltAfter(page, action) {
  const before = await builds(page);
  await action();
  await expect.poll(() => builds(page)).toBeGreaterThan(before);
}

// Draw a henna-style design in the browser and return it as JPEG bytes.
// photo: true adds a lighting gradient, paper texture and noise like a phone snap.
export async function makeHennaJpeg(page, { photo = false, w = 900, h = 600 } = {}) {
  const b64 = await page.evaluate(({ photo, w, h }) => {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (photo) {
      const g = ctx.createLinearGradient(0, 0, w, h);
      g.addColorStop(0, '#f4ead8'); g.addColorStop(0.55, '#c9bfae'); g.addColorStop(1, '#4a443c'); // strong shadow corner
      ctx.fillStyle = g;
    } else ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = ctx.fillStyle = photo ? '#5a2a14' : '#3b1a0c';
    ctx.lineWidth = 9; ctx.lineCap = 'round';
    // a margin of blank paper around the motif, so trimming has something to do
    const cx = w / 2, cy = h / 2, R = Math.min(w, h) * 0.3;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      ctx.beginPath(); ctx.ellipse(cx + Math.cos(a) * R * 0.6, cy + Math.sin(a) * R * 0.6, R * 0.22, R * 0.08, a, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(cx + Math.cos(a) * R * 1.15, cy + Math.sin(a) * R * 1.15, 8, 0, Math.PI * 2); ctx.fill();
    }
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.15, 0, Math.PI * 2); ctx.fill();
    if (photo) {
      const d = ctx.getImageData(0, 0, w, h);
      for (let i = 0; i < d.data.length; i += 4) {
        const n = (Math.random() - 0.5) * 30;
        d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n;
      }
      ctx.putImageData(d, 0, 0);
    }
    return c.toDataURL('image/jpeg', 0.85).split(',')[1];
  }, { photo, w, h });
  return Buffer.from(b64, 'base64');
}

// Parse a binary STL: triangle count, size check and bounding box.
export function parseStl(file) {
  const buf = fs.readFileSync(file);
  const n = buf.readUInt32LE(80);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let t = 0; t < n; t++) {
    for (let v = 0; v < 3; v++) {
      const o = 84 + t * 50 + 12 + v * 12;
      for (let k = 0; k < 3; k++) {
        const x = buf.readFloatLE(o + k * 4);
        if (x < min[k]) min[k] = x;
        if (x > max[k]) max[k] = x;
      }
    }
  }
  return { triangles: n, sizeOk: buf.length === 84 + n * 50, min, max, size: max.map((m, i) => m - min[i]) };
}

// Fraction of non-transparent / non-background pixels in a canvas.
export function canvasInk(page, selector) {
  return page.evaluate((sel) => {
    const src = document.querySelector(sel);
    const c = document.createElement('canvas');
    c.width = 200; c.height = Math.max(1, Math.round(200 * src.height / src.width));
    const ctx = c.getContext('2d');
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    let ink = 0;
    for (let i = 0; i < d.length; i += 4) {
      const lum = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
      if (d[i + 3] > 20 && lum < 200) ink++;
    }
    return ink / (d.length / 4);
  }, selector);
}
