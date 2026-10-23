import { test, expect } from '@playwright/test';
import { openApp, rebuiltAfter, parseStl, canvasInk } from './helpers.js';

// Drag across the drawing canvas; points are fractions of the canvas box.
async function stroke(page, pts) {
  const box = await page.locator('#doodleCanvas').boundingBox();
  const at = ([fx, fy]) => [box.x + fx * box.width, box.y + fy * box.height];
  await page.mouse.move(...at(pts[0]));
  await page.mouse.down();
  for (const p of pts.slice(1)) await page.mouse.move(...at(p), { steps: 8 });
  await page.mouse.up();
}

const SPOKE = [[0.5, 0.42], [0.53, 0.3], [0.5, 0.18]];

async function openRound(page) {
  await openApp(page);
  await page.evaluate(() => localStorage.clear());
  await rebuiltAfter(page, () => page.selectOption('#source', 'mandala')); // 50 mm circle block
  await page.click('#openDoodle');
  await expect(page.locator('#doodle')).toBeVisible();
}

test.describe('doodle editor', () => {
  test('opens a drawing pad that fits the screen', async ({ page }) => {
    await openRound(page);
    const vp = page.viewportSize();
    const dlg = await page.locator('#doodle').boundingBox();
    expect(dlg.x).toBeGreaterThanOrEqual(0);
    expect(dlg.y).toBeGreaterThanOrEqual(0);
    expect(dlg.x + dlg.width).toBeLessThanOrEqual(vp.width + 0.5);
    expect(dlg.y + dlg.height).toBeLessThanOrEqual(vp.height + 0.5);
    const cv = await page.locator('#doodleCanvas').boundingBox();
    expect(cv.width).toBeGreaterThan(Math.min(vp.width, 900) * 0.6);
    // round block → round symmetry by default
    await expect(page.locator('#doodleSym')).toHaveValue('radial8');
    for (const id of ['#doodleUndo', '#doodleRedo', '#doodleClear']) await expect(page.locator(id)).toBeDisabled();
  });

  test('long border block defaults to mirror symmetry', async ({ page }) => {
    await openApp(page); // paisley: 84 × 25
    await page.click('#openDoodle');
    await expect(page.locator('#doodleSym')).toHaveValue('mirror4');
  });

  test('drawing a stroke switches the stamp to the drawing and rebuilds it', async ({ page }) => {
    await openRound(page);
    await rebuiltAfter(page, () => stroke(page, SPOKE));
    await expect(page.locator('#source')).toHaveValue('doodle');
    await expect(page.locator('#doodleUndo')).toBeEnabled();
    await page.click('#doodleDone');
    await expect(page.locator('#doodle')).toBeHidden();
    await expect(page.locator('#doodleInfo')).toContainText('1 stroke saved');
    expect(await canvasInk(page, '#impression')).toBeGreaterThan(0.01);
    await expect(page.locator('#status')).toHaveText('');
  });

  test('radial symmetry repeats each stroke around the centre', async ({ page }) => {
    await openRound(page);
    await page.selectOption('#doodleSym', 'none');
    await rebuiltAfter(page, () => stroke(page, SPOKE));
    const one = await canvasInk(page, '#impression');
    await rebuiltAfter(page, () => page.click('#doodleUndo'));
    await page.selectOption('#doodleSym', 'radial8');
    await rebuiltAfter(page, () => stroke(page, SPOKE));
    const eight = await canvasInk(page, '#impression');
    expect(eight / one).toBeGreaterThan(5);
  });

  test('undo, redo and clear', async ({ page }) => {
    await openRound(page);
    await stroke(page, SPOKE);
    await stroke(page, [[0.3, 0.5], [0.35, 0.55]]);
    await expect(page.locator('#doodleInfo')).toContainText('2 strokes');
    await page.click('#doodleUndo');
    await expect(page.locator('#doodleInfo')).toContainText('1 stroke');
    await page.click('#doodleRedo');
    await expect(page.locator('#doodleInfo')).toContainText('2 strokes');
    await page.click('#doodleClear');
    await expect(page.locator('#doodleInfo')).toContainText('Doodle with');
    await expect(page.locator('#doodleRedo')).toBeEnabled(); // clear can be undone
    await page.click('#doodleRedo');
    await expect(page.locator('#doodleInfo')).toContainText('1 stroke');
  });

  test('dots tool and eraser', async ({ page }) => {
    await openRound(page);
    await page.selectOption('#doodleSym', 'none');
    // empty drawing: only the block outline shows in the impression
    await rebuiltAfter(page, () => stroke(page, [[0.5, 0.5], [0.52, 0.5]]));
    await rebuiltAfter(page, () => page.click('#doodleUndo'));
    const empty = await canvasInk(page, '#impression');
    await page.click('[data-tool="dots"]');
    await expect(page.locator('[data-tool="dots"]')).toHaveAttribute('aria-pressed', 'true');
    await page.fill('#doodleSize', '3');
    await rebuiltAfter(page, () => stroke(page, [[0.25, 0.5], [0.75, 0.5]]));
    const dots = await canvasInk(page, '#impression');
    expect(dots - empty).toBeGreaterThan(0.01);
    await page.click('[data-tool="eraser"]');
    await page.fill('#doodleSize', '4');
    await rebuiltAfter(page, () => stroke(page, [[0.2, 0.5], [0.8, 0.5]]));
    const erased = await canvasInk(page, '#impression');
    expect(erased - empty).toBeLessThan((dots - empty) * 0.1);
  });

  test('drawing survives a page reload', async ({ page }) => {
    await openRound(page);
    await stroke(page, SPOKE);
    await page.click('#doodleDone');
    await page.reload();
    await expect(page.locator('body')).toHaveAttribute('data-builds', /[1-9]/);
    await expect(page.locator('#doodleInfo')).toContainText('1 stroke saved');
    await rebuiltAfter(page, () => page.selectOption('#source', 'doodle'));
    await expect(page.locator('#doodle')).toBeHidden(); // has strokes → no need to open the pad
    expect(await canvasInk(page, '#impression')).toBeGreaterThan(0.01);
  });

  test('drawn design downloads as valid STLs', async ({ page }, info) => {
    await openRound(page);
    await rebuiltAfter(page, () => stroke(page, SPOKE));
    await page.click('#doodleDone');
    for (const [sel, h] of [['#dlBody', 30], ['#dlPad', 4]]) {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
      expect(dl.suggestedFilename()).toMatch(/^mehndi-drawing-50x50-/);
      const path = info.outputPath(dl.suggestedFilename());
      await dl.saveAs(path);
      const stl = parseStl(path);
      expect(stl.sizeOk).toBe(true);
      expect(stl.size[2]).toBeCloseTo(h, 1);
      expect(stl.size[0]).toBeCloseTo(50, 0);
    }
  });

  test('Escape closes the pad and keeps the drawing', async ({ page }) => {
    await openRound(page);
    await stroke(page, SPOKE);
    await page.keyboard.press('Escape');
    await expect(page.locator('#doodle')).toBeHidden();
    await expect(page.locator('#source')).toHaveValue('doodle');
  });

  test('drawing tools are big enough to tap', async ({ page }) => {
    test.skip(page.viewportSize().width > 820, 'phone-only check');
    await openRound(page);
    const small = await page.$$eval('#doodle button, #doodle select', (els) => els
      .map((e) => ({ t: e.textContent.trim() || e.id, h: e.getBoundingClientRect().height }))
      .filter((x) => x.h < 36));
    expect(small).toEqual([]);
  });
});
