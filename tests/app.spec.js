import { test, expect } from '@playwright/test';
import { openApp, rebuiltAfter, makeHennaJpeg, parseStl, canvasInk } from './helpers.js';

test.describe('loading & presets', () => {
  test('loads without errors and builds the default block', async ({ page }) => {
    const errors = await openApp(page);
    await expect(page.locator('#stats')).toContainText('84.0 × 25.0 mm');
    await expect(page.locator('#stats')).toContainText('handle: grip');
    for (const id of ['#dlBody', '#dlPad', '#dlOne', '#dlBoth']) await expect(page.locator(id)).toBeEnabled();
    await expect(page.locator('#status')).toHaveText('');
    expect(errors).toEqual([]);
  });

  test('every built-in motif builds and draws an impression', async ({ page }) => {
    await openApp(page);
    const expected = { mandala: 'knob', lotus: 'knob', paisley: 'grip', vine: 'grip', jaal: 'knob' };
    for (const [preset, handle] of Object.entries(expected)) {
      await rebuiltAfter(page, () => page.selectOption('#source', preset));
      await expect(page.locator('#stats')).toContainText(`handle: ${handle}`);
      expect(await canvasInk(page, '#impression'), preset).toBeGreaterThan(0.05);
    }
  });

  test('3D preview actually renders the model', async ({ page }) => {
    await openApp(page);
    await page.waitForTimeout(300);
    expect(await canvasInk(page, '#stage canvas')).toBeGreaterThan(0.02);
  });

  test('shape choice shows only the relevant fields', async ({ page }) => {
    await openApp(page);
    await page.selectOption('#shape', 'circle');
    await expect(page.locator('#heightRow')).toBeHidden();
    await expect(page.locator('#cornerRow')).toBeHidden();
    await page.selectOption('#shape', 'oval');
    await expect(page.locator('#heightRow')).toBeVisible();
    await expect(page.locator('#cornerRow')).toBeHidden();
    await page.selectOption('#shape', 'rect');
    await expect(page.locator('#cornerRow')).toBeVisible();
  });

  test('threshold mode shows the matching control', async ({ page }) => {
    await openApp(page);
    await expect(page.locator('#thresholdRow')).toBeHidden();
    await page.selectOption('#threshMode', 'manual');
    await expect(page.locator('#thresholdRow')).toBeVisible();
    await page.selectOption('#threshMode', 'adaptive');
    await expect(page.locator('#adaptiveRow')).toBeVisible();
    await expect(page.locator('#thresholdRow')).toBeHidden();
  });

  test('changing a size updates the model', async ({ page }) => {
    await openApp(page);
    await rebuiltAfter(page, () => page.fill('#width', '100'));
    await expect(page.locator('#stats')).toContainText('100.0 × 25.0 mm');
  });
});

test.describe('henna design upload', () => {
  test('JPEG upload via the picker becomes the design and fits the block', async ({ page }, info) => {
    const errors = await openApp(page);
    const file = info.outputPath('henna.jpg');
    (await import('node:fs')).writeFileSync(file, await makeHennaJpeg(page));
    await rebuiltAfter(page, () => page.setInputFiles('#file', file));
    await expect(page.locator('#source')).toHaveValue('upload');
    await expect(page.locator('#dropText')).toContainText('henna.jpg');
    await expect(page.locator('#dropThumb')).toHaveJSProperty('tagName', 'IMG');
    await expect(page.locator('#dropActions')).toBeVisible();
    await expect(page.locator('#trimRow')).toBeVisible();
    // trimmed to the round motif → block becomes roughly square
    const w = Number(await page.inputValue('#width')), h = Number(await page.inputValue('#height'));
    expect(Math.abs(w - h) / w).toBeLessThan(0.15);
    expect(await canvasInk(page, '#impression')).toBeGreaterThan(0.05);
    await expect(page.locator('#status')).toHaveText('');
    expect(errors).toEqual([]);
  });

  test('uploaded design downloads as valid STLs (body, pad, one-piece)', async ({ page }, info) => {
    await openApp(page);
    const file = info.outputPath('henna.jpg');
    (await import('node:fs')).writeFileSync(file, await makeHennaJpeg(page));
    await rebuiltAfter(page, () => page.setInputFiles('#file', file));

    const save = async (sel) => {
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click(sel)]);
      const path = info.outputPath(dl.suggestedFilename());
      await dl.saveAs(path);
      return { name: dl.suggestedFilename(), stl: parseStl(path) };
    };
    const body = await save('#dlBody');
    const pad = await save('#dlPad');
    const one = await save('#dlOne');
    expect(body.name).toMatch(/^mehndi-henna-\d+x\d+-body-PLA\.stl$/);
    expect(pad.name).toMatch(/-pad-TPU\.stl$/);
    for (const { stl } of [body, pad, one]) {
      expect(stl.sizeOk).toBe(true);
      expect(stl.triangles).toBeGreaterThan(100);
      expect(stl.min[2]).toBeCloseTo(0, 3); // sits on the print bed
    }
    // pad = backing (2) + relief (2); body = 8 + 22 handle
    expect(pad.stl.size[2]).toBeCloseTo(4, 1);
    expect(body.stl.size[2]).toBeCloseTo(30, 1);
    expect(one.stl.size[2]).toBeCloseTo(34, 1);
    const w = Number(await page.inputValue('#width'));
    expect(body.stl.size[0]).toBeCloseTo(w, 0);
  });

  test('"Download both" saves body and pad', async ({ page }, info) => {
    await openApp(page);
    const names = [];
    page.on('download', (d) => names.push(d.suggestedFilename()));
    await page.click('#dlBoth');
    await expect.poll(() => names.length).toBe(2);
    expect(names.some((n) => n.endsWith('-body-PLA.stl'))).toBe(true);
    expect(names.some((n) => n.endsWith('-pad-TPU.stl'))).toBe(true);
  });

  test('drag and drop a JPEG onto the page', async ({ page }) => {
    await openApp(page);
    const bytes = await makeHennaJpeg(page);
    await rebuiltAfter(page, () => page.evaluate((b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bin], 'dropped-mehndi.jpeg', { type: 'image/jpeg' }));
      const target = document.getElementById('drop');
      for (const type of ['dragenter', 'dragover', 'drop']) {
        target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
      }
    }, bytes.toString('base64')));
    await expect(page.locator('#dropText')).toContainText('dropped-mehndi.jpeg');
    await expect(page.locator('#drop')).not.toHaveClass(/dragging/);
  });

  test('pasting an image from the clipboard uploads it', async ({ page }) => {
    await openApp(page);
    const bytes = await makeHennaJpeg(page);
    await rebuiltAfter(page, () => page.evaluate((b64) => {
      const bin = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const dt = new DataTransfer();
      dt.items.add(new File([bin], 'x.jpg', { type: 'image/jpeg' }));
      window.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt }));
    }, bytes.toString('base64')));
    await expect(page.locator('#source')).toHaveValue('upload');
  });

  test('phone photo with a shadow: Photo mode beats Auto', async ({ page }, info) => {
    await openApp(page);
    const file = info.outputPath('photo.jpg');
    (await import('node:fs')).writeFileSync(file, await makeHennaJpeg(page, { photo: true }));
    await rebuiltAfter(page, () => page.setInputFiles('#file', file));
    await rebuiltAfter(page, () => page.selectOption('#threshMode', 'auto'));
    const autoInk = await canvasInk(page, '#impression');
    await rebuiltAfter(page, () => page.selectOption('#threshMode', 'adaptive'));
    const photoInk = await canvasInk(page, '#impression');
    // the shadowed corner turns into a solid blob with a global threshold;
    // adaptive keeps just the lines
    expect(photoInk).toBeGreaterThan(0.03);
    expect(photoInk).toBeLessThan(autoInk);
    await expect(page.locator('#status')).toHaveText('');
  });

  test('a non-image file shows a friendly error and keeps the design', async ({ page }, info) => {
    await openApp(page);
    const file = info.outputPath('notes.txt');
    (await import('node:fs')).writeFileSync(file, 'hello');
    await page.setInputFiles('#file', file);
    await expect(page.locator('#uploadError')).toContainText("isn't an image");
    await expect(page.locator('#source')).toHaveValue('paisley');
  });

  test('a corrupt JPEG shows an error', async ({ page }, info) => {
    await openApp(page);
    const file = info.outputPath('broken.jpg');
    (await import('node:fs')).writeFileSync(file, Buffer.from('not really a jpeg'));
    await page.setInputFiles('#file', file);
    await expect(page.locator('#uploadError')).toContainText("Couldn't read");
  });

  test('Remove goes back to a built-in design', async ({ page }, info) => {
    await openApp(page);
    const file = info.outputPath('henna.jpg');
    (await import('node:fs')).writeFileSync(file, await makeHennaJpeg(page));
    await rebuiltAfter(page, () => page.setInputFiles('#file', file));
    await rebuiltAfter(page, () => page.click('#clearUpload'));
    await expect(page.locator('#source')).toHaveValue('paisley');
    await expect(page.locator('#dropActions')).toBeHidden();
    await expect(page.locator('#dropText')).toContainText('Upload your henna design');
  });

  test('upload zone is keyboard accessible', async ({ page }) => {
    // start listening before the page loads so file-chooser interception is already active
    const chooserPromise = page.waitForEvent('filechooser');
    await openApp(page);
    await page.focus('#drop');
    await page.keyboard.press('Enter');
    const chooser = await chooserPromise;
    expect(chooser.isMultiple()).toBe(false);
  });
});
