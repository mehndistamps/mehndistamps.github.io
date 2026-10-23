import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

const rect = (page, sel) => page.locator(sel).first().evaluate((e) => {
  const r = e.getBoundingClientRect();
  return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
});

test.describe('layout & alignment', () => {
  test('no horizontal scrolling', async ({ page }) => {
    await openApp(page);
    const { scroll, client } = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth, client: document.documentElement.clientWidth }));
    expect(scroll).toBeLessThanOrEqual(client);
  });

  test('every sidebar label is vertically centred on its control', async ({ page }) => {
    await openApp(page);
    const off = await page.$$eval('aside .row', (rows) => rows.filter((r) => r.checkVisibility()).map((row) => {
      const l = row.querySelector('label'), c = row.querySelector('input, select');
      const a = l.getBoundingClientRect(), b = c.getBoundingClientRect();
      return { id: c.id, dy: Math.abs((a.top + a.height / 2) - (b.top + b.height / 2)) };
    }).filter((x) => x.dy > 2));
    expect(off).toEqual([]);
  });

  test('all sidebar controls start on the same column', async ({ page }) => {
    await openApp(page);
    const lefts = await page.$$eval('aside .row', (rows) => rows.filter((r) => r.checkVisibility())
      .map((r) => Math.round(r.querySelector('input, select').getBoundingClientRect().left)));
    expect(Math.max(...lefts) - Math.min(...lefts)).toBeLessThanOrEqual(1);
  });

  test('text fields and selects share one width and height', async ({ page }) => {
    await openApp(page);
    const sizes = await page.$$eval('aside .row input[type=number], aside .row select',
      (els) => els.filter((e) => e.checkVisibility()).map((e) => `${Math.round(e.getBoundingClientRect().width)}x${Math.round(e.getBoundingClientRect().height)}`));
    expect(new Set(sizes).size).toBe(1);
  });

  test('labels are not clipped or overlapping their controls', async ({ page }) => {
    await openApp(page);
    const bad = await page.$$eval('aside .row', (rows) => rows.filter((r) => r.checkVisibility()).filter((row) => {
      const l = row.querySelector('label'), c = row.querySelector('input, select');
      return l.scrollWidth > l.clientWidth + 1 || l.getBoundingClientRect().right > c.getBoundingClientRect().left + 0.5;
    }).map((r) => r.querySelector('label').textContent));
    expect(bad).toEqual([]);
  });

  test('section arrows stay inside the sidebar', async ({ page }) => {
    await openApp(page);
    const lefts = await page.$$eval('aside summary', (s) => s.map((e) => e.getBoundingClientRect().left));
    for (const l of lefts) expect(l).toBeGreaterThanOrEqual(8);
  });

  test('export buttons have equal height; same-row buttons share a top edge', async ({ page }) => {
    await openApp(page);
    const boxes = await page.$$eval('.exports button', (bs) => bs.map((b) => b.getBoundingClientRect()).map((r) => ({ top: Math.round(r.top), h: Math.round(r.height) })));
    expect(new Set(boxes.map((b) => b.h)).size).toBe(1);
    const rows = {};
    for (const b of boxes) (rows[Math.round(b.top / 10)] ??= []).push(b.top);
    for (const tops of Object.values(rows)) expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
  });

  test('export buttons do not overlap each other or the stats', async ({ page }) => {
    await openApp(page);
    const boxes = await page.$$eval('.exports > *', (els) => els.map((e) => e.getBoundingClientRect()).map((r) => [r.left, r.top, r.right, r.bottom]));
    for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      const overlap = a[0] < b[2] - 0.5 && b[0] < a[2] - 0.5 && a[1] < b[3] - 0.5 && b[1] < a[3] - 0.5;
      expect(overlap, `elements ${i} and ${j} overlap`).toBe(false);
    }
  });

  test('3D canvas fills its stage exactly', async ({ page }) => {
    await openApp(page);
    const stage = await rect(page, '#stage');
    const cv = await rect(page, '#stage canvas');
    for (const k of ['left', 'right', 'top', 'bottom']) expect(Math.abs(stage[k] - cv[k])).toBeLessThanOrEqual(1);
    expect(stage.height).toBeGreaterThanOrEqual(280);
  });

  test('3D stage height stays stable (no resize feedback loop)', async ({ page }) => {
    await openApp(page);
    const h1 = (await rect(page, '#stage')).height;
    await page.waitForTimeout(800);
    const h2 = (await rect(page, '#stage')).height;
    expect(h2).toBe(h1);
  });

  test('toolbar items are vertically centred on one line', async ({ page }) => {
    await openApp(page);
    const centres = await page.$$eval('.toolbar > *', (els) => els.map((e) => { const r = e.getBoundingClientRect(); return { c: r.top + r.height / 2, top: r.top }; }));
    const lines = {};
    for (const x of centres) (lines[Math.round(x.top / 12)] ??= []).push(x.c);
    for (const cs of Object.values(lines)) expect(Math.max(...cs) - Math.min(...cs)).toBeLessThanOrEqual(1.5);
  });

  test('impression preview stays inside its card', async ({ page }) => {
    await openApp(page);
    const card = await rect(page, 'main .card');
    const cv = await rect(page, '#impression');
    expect(cv.left).toBeGreaterThanOrEqual(card.left);
    expect(cv.right).toBeLessThanOrEqual(card.right);
    expect(cv.bottom).toBeLessThanOrEqual(card.bottom);
  });

  test('upload zone is prominent and touch friendly', async ({ page }) => {
    await openApp(page);
    const box = await rect(page, '#drop');
    expect(box.height).toBeGreaterThanOrEqual(44);
    const section = await rect(page, 'aside > details');
    expect(box.width).toBeGreaterThan(section.width * 0.8);
    const draw = await rect(page, '#openDoodle');
    expect(draw.height).toBeGreaterThanOrEqual(44);
    expect(Math.abs(draw.width - box.width)).toBeLessThanOrEqual(1);
  });

  test('dark mode uses a dark background with readable text', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await openApp(page);
    const { bg, fg } = await page.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor, fg: getComputedStyle(document.body).color }));
    const lum = (s) => {
      const [r, g, b] = s.match(/\d+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    expect(lum(bg)).toBeLessThan(0.05);
    expect((Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05)).toBeGreaterThan(7);
  });

  test('muted text keeps WCAG AA contrast in light mode', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await openApp(page);
    const ratio = await page.evaluate(() => {
      const lum = (s) => {
        const [r, g, b] = s.match(/\d+/g).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
        return 0.2126 * r + 0.7152 * g + 0.0722 * b;
      };
      const fg = getComputedStyle(document.querySelector('.row label')).color;
      const bg = getComputedStyle(document.querySelector('aside')).backgroundColor;
      return (Math.max(lum(fg), lum(bg)) + 0.05) / (Math.min(lum(fg), lum(bg)) + 0.05);
    });
    expect(ratio).toBeGreaterThan(4.5);
  });

  test('screenshot for visual review', async ({ page }, info) => {
    await openApp(page);
    await page.waitForTimeout(300);
    await page.screenshot({ path: info.outputPath('full.png'), fullPage: true });
  });
});

test.describe('phone layout', () => {
  test.beforeEach(({ page }) => {
    test.skip(page.viewportSize().width > 820, 'phone-only checks');
  });

  test('order is Design, then previews, then the other settings', async ({ page }) => {
    await openApp(page, { expand: false });
    const design = await rect(page, 'aside > details:first-child');
    const main = await rect(page, 'main');
    const block = await page.locator('summary', { hasText: 'Block' }).boundingBox();
    expect(design.bottom).toBeLessThanOrEqual(main.top + 1);
    expect(main.bottom).toBeLessThanOrEqual(block.y + 1);
  });

  test('preview is reachable without scrolling far', async ({ page }) => {
    await openApp(page, { expand: false });
    const main = await rect(page, 'main');
    expect(main.top).toBeLessThan(page.viewportSize().height * 0.9);
  });

  test('only the Design section starts expanded', async ({ page }) => {
    await openApp(page, { expand: false });
    const open = await page.$$eval('aside > details', (d) => d.map((x) => x.open));
    expect(open[0]).toBe(true);
    expect(open.slice(1).every((o) => !o)).toBe(true);
  });

  test('bottom bar is pinned and never hides the last content', async ({ page }) => {
    await openApp(page);
    const bar = await rect(page, '.mobile-bar');
    const vp = page.viewportSize();
    expect(Math.round(bar.bottom)).toBe(vp.height);
    await expect(page.locator('#mbDownload')).toBeEnabled();
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const lastSummary = await page.locator('aside > details').last().boundingBox();
    expect(lastSummary.y + lastSummary.height).toBeLessThanOrEqual(bar.top + 1);
  });

  test('bottom bar opens the drawing pad and downloads', async ({ page }) => {
    await openApp(page);
    await page.click('#mbDraw');
    await expect(page.locator('#doodle')).toBeVisible();
    await page.click('#doodleDone');
    const names = [];
    page.on('download', (d) => names.push(d.suggestedFilename()));
    await page.click('#mbDownload');
    await expect.poll(() => names.length).toBe(2);
  });

  test('form fields use 16px text so iOS does not zoom', async ({ page }) => {
    await openApp(page);
    for (const d of await page.$$('aside > details')) await d.evaluate((x) => { x.open = true; });
    const small = await page.$$eval('input[type=number], select', (els) => els.filter((e) => e.checkVisibility())
      .filter((e) => parseFloat(getComputedStyle(e).fontSize) < 16).map((e) => e.id));
    expect(small).toEqual([]);
  });

  test('touch targets are at least 40px tall', async ({ page }) => {
    await openApp(page);
    for (const d of await page.$$('aside > details')) await d.evaluate((x) => { x.open = true; });
    const small = await page.$$eval('button, input[type=number], select, summary', (els) => els.filter((e) => e.checkVisibility())
      .map((e) => ({ id: e.id || e.textContent.trim().slice(0, 20), h: e.getBoundingClientRect().height })).filter((x) => x.h < 40));
    expect(small).toEqual([]);
  });

  test('page scrolls with one finger over the 3D view', async ({ page }) => {
    await openApp(page);
    const ta = await page.$eval('#stage canvas', (c) => getComputedStyle(c).touchAction);
    expect(ta).toBe('pan-y');
    await expect(page.locator('#touchHint')).toBeVisible();
  });
});

test.describe('app icon', () => {
  test('favicon, home-screen icon and manifest are wired up and load', async ({ page, request }) => {
    await openApp(page);
    const hrefs = await page.$$eval('link[rel~="icon"], link[rel="apple-touch-icon"], link[rel="manifest"]',
      (ls) => ls.map((l) => l.href));
    expect(hrefs.length).toBe(4);
    for (const href of hrefs) expect((await request.get(href)).ok(), href).toBe(true);
    const manifest = await (await request.get(hrefs.find((h) => h.endsWith('.webmanifest')))).json();
    expect(manifest.name).toBe('Mehndi Print Blocks');
    const base = new URL(hrefs.find((h) => h.endsWith('.webmanifest')));
    for (const icon of manifest.icons) {
      expect((await request.get(new URL(icon.src, base).href)).ok(), icon.src).toBe(true);
    }
    expect(manifest.icons.some((i) => i.purpose === 'maskable')).toBe(true);
  });

  test('header logo sits centred beside the title', async ({ page }) => {
    await openApp(page);
    const logo = await page.locator('header .logo').boundingBox();
    const title = await page.locator('header h1').boundingBox();
    expect(logo.width).toBe(28);
    expect(await page.$eval('header .logo', (i) => i.complete && i.naturalWidth > 0)).toBe(true);
    expect(Math.abs((logo.y + logo.height / 2) - (title.y + title.height / 2))).toBeLessThanOrEqual(1.5);
  });
});
