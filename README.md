# Mehndi Print Blocks

Turn a mehndi design into a 3D-printable block stamp, right in the browser.

**Live app:** https://mehndistamps.github.io/

- **Upload your own henna design** (JPEG, PNG, WebP, SVG): click, drag & drop, or paste. Blank margins are trimmed, the block is sized to the design, and **Photo mode** handles shadows in phone pictures. Or pick a built-in motif (mandala, lotus, paisley border, vine border, jaal lattice). Dark areas become the raised printing surface.
- Choose the block shape (rectangle, circle, oval, hexagon), size, relief depth and handle (knob or grip bar).
- Download STLs:
  - **Body + handle** (PLA) — prints flat side down, handle up
  - **Stamp pad** (TPU) — prints backing down, relief up; glue to the body with flexible contact cement or double-sided tape
  - **One-piece** — single material or multi-material, relief face down

No supports needed. Geometry is built with [manifold-3d](https://github.com/elalish/manifold) (watertight booleans in WebAssembly) and previewed with three.js.

## Run locally

```bash
npm install
npm run serve
```

Then open http://localhost:8765.

## UI tests

Playwright tests cover presets, the 3D preview, JPEG upload (picker, drag & drop, paste, photo mode, bad files), STL downloads (parsed and size-checked), and layout/alignment at desktop and phone sizes.

```bash
npx playwright install chromium
npm test              # against a local server
npm run test:live     # against https://mehndistamps.github.io
```
