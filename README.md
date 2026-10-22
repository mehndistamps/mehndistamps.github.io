# Mehndi Print Blocks

Turn a mehndi design into a 3D-printable block stamp, right in the browser.

**Live app:** https://mehndistamps.github.io/

- Pick a built-in motif (mandala, lotus, paisley border, vine border, jaal lattice) or upload a PNG/JPG/SVG — dark areas become the raised printing surface.
- Choose the block shape (rectangle, circle, oval, hexagon), size, relief depth and handle (knob or grip bar).
- Download STLs:
  - **Body + handle** (PLA) — prints flat side down, handle up
  - **Stamp pad** (TPU) — prints backing down, relief up; glue to the body with flexible contact cement or double-sided tape
  - **One-piece** — single material or multi-material, relief face down

No supports needed. Geometry is built with [manifold-3d](https://github.com/elalish/manifold) (watertight booleans in WebAssembly) and previewed with three.js.

## Run locally

```bash
python3 -m http.server 8765
```

Then open http://localhost:8765.
