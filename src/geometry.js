// Builds the printable parts with manifold-3d (watertight booleans in WASM).
//
// Assembled frame: body sits on z = 0 with the handle going up (+z); the TPU
// pad hangs below it with the stamp face at the lowest z. The design is laid
// out in XY exactly as it will appear on paper, so no mirroring is needed.

import Module from 'https://cdn.jsdelivr.net/npm/manifold-3d@3.3.2/manifold.js';

let wasm;
export async function initGeometry() {
  wasm = await Module({
    locateFile: () => 'https://cdn.jsdelivr.net/npm/manifold-3d@3.3.2/manifold.wasm',
  });
  wasm.setup();
  return wasm;
}

// Collects every WASM object created during one build so they can be freed.
function arena() {
  const objs = new Set();
  const t = (o) => (objs.add(o), o);
  t.free = () => objs.forEach((o) => o.delete());
  return t;
}

export function outlineFor(p, t) {
  const { CrossSection } = wasm;
  const { shape, width: W, height: H, corner } = p;
  switch (shape) {
    case 'circle':
      return t(CrossSection.circle(W / 2, 160));
    case 'oval':
      return t(t(CrossSection.circle(1, 160)).scale([W / 2, H / 2]));
    case 'hex':
      return t(t(CrossSection.circle(W / 2, 6)).rotate(30));
    default: {
      const r = Math.min(corner, W / 2 - 0.01, H / 2 - 0.01);
      if (r <= 0) return t(CrossSection.square([W, H], true));
      return t(t(CrossSection.square([W - 2 * r, H - 2 * r], true)).offset(r, 'Round', 2, 48));
    }
  }
}

// 2D relief region: traced design, cleaned up, clipped to the block, plus optional border.
export function reliefSection(loops, p, t) {
  const { CrossSection } = wasm;
  const outline = outlineFor(p, t);
  let cs = t(new CrossSection(loops, 'EvenOdd'));
  if (p.smooth > 0) cs = t(cs.simplify(p.smooth));
  if (p.weight !== 0) cs = t(cs.offset(p.weight, 'Round', 2, 24));
  cs = t(cs.intersect(t(outline.offset(-p.margin, 'Round', 2, 48))));
  if (p.border > 0) {
    const outer = t(outline.offset(-p.borderInset, 'Round', 2, 48));
    const ring = t(outer.subtract(t(outer.offset(-p.border, 'Round', 2, 48))));
    cs = t(cs.add(ring));
  }
  // tiny net growth: shapes that touch at a single corner (or holes touching
  // their outline) get a sliver of material, otherwise the STL has edges
  // shared by 4 faces
  cs = t(t(cs.offset(0.02, 'Miter', 2)).simplify(0.005));
  return { outline, relief: cs };
}

function knob(p, t, minDim) {
  const { CrossSection } = wasm;
  const Hh = p.handleHeight;
  let rk = Math.min(p.knobDia / 2, minDim * 0.48);
  const rs = Math.max(3, rk * 0.45);
  const fl = Math.min(3, rs * 0.6);
  let b = rk * 0.55;
  let z1 = Hh - b - (rk - rs);
  if (z1 < fl + 1) { // too short for the bulb: shrink it
    rk = Math.max(rs + 1, rs + (Hh - fl - 1) * 0.5);
    b = rk * 0.55;
    z1 = Math.max(fl + 0.5, Hh - b - (rk - rs));
  }
  const z2 = z1 + (rk - rs);
  const pts = [[0, 0], [rs + fl, 0], [rs, fl], [rs, z1], [rk, z2]];
  for (let i = 1; i <= 16; i++) {
    const a = (i / 16) * (Math.PI / 2);
    pts.push([rk * Math.cos(a), z2 + b * Math.sin(a)]);
  }
  pts.push([0, z2 + b]);
  return t(t(new CrossSection([pts], 'NonZero')).revolve(96));
}

function grip(p, t, W, H) {
  const { CrossSection } = wasm;
  const L = Math.max(8, Math.min(W * 0.78, W - 6));
  const th = Math.min(p.gripThick, H * 0.55);
  const Hh = p.handleHeight;
  const r = th / 2, fl = Math.max(0.5, Math.min(3, (H - th) / 2 - 0.5));
  // profile in (u = -z, v = y) so that rotating about Y puts the extrusion on X
  const prof = [[0, -r - fl], [0, r + fl], [-fl, r], [-(Hh - r), r]];
  for (let i = 1; i < 16; i++) {
    const a = (i / 16) * Math.PI;
    prof.push([-(Hh - r) - r * Math.sin(a), r * Math.cos(a)]);
  }
  prof.push([-(Hh - r), -r], [-fl, -r]);
  return t(t(t(new CrossSection([prof], 'NonZero')).extrude(L)).rotate([0, 90, 0])).translate([-L / 2, 0, 0]);
}

function bbox2(cs) {
  const b = cs.bounds();
  return [b.max[0] - b.min[0], b.max[1] - b.min[1]];
}

export function buildParts(loops, p) {
  const { Manifold } = wasm;
  const t = arena();
  try {
    const { outline, relief } = reliefSection(loops, p, t);
    const [W, H] = bbox2(outline);
    const T = p.bodyThick, pb = p.padBase, rd = p.reliefDepth;

    // --- body + handle (PLA) ---
    let body = t(outline.extrude(T));
    let handle = p.handle;
    if (handle === 'auto') handle = W / H > 1.6 ? 'grip' : 'knob';
    if (handle === 'knob') body = t(body.add(t(knob(p, t, Math.min(W, H)).translate([0, 0, T]))));
    if (handle === 'grip') body = t(body.add(t(grip(p, t, W, H).translate([0, 0, T]))));

    // --- stamp pad (TPU) ---
    const padOutline = p.padInset > 0 ? t(outline.offset(-p.padInset, 'Round', 2, 48)) : outline;
    let pad = t(t(padOutline.extrude(pb)).translate([0, 0, -pb]));
    const sh = Math.min(p.shoulder, rd * 0.6);
    if (!relief.isEmpty()) {
      pad = t(pad.add(t(t(relief.extrude(rd + 0.01)).translate([0, 0, -pb - rd]))));
      if (sh > 0) {
        // widened base under every line: keeps thin TPU features from folding over
        const base = t(t(t(relief.offset(p.shoulder, 'Round', 2, 16)).intersect(padOutline)).simplify(0.005));
        pad = t(pad.add(t(t(base.extrude(sh + 0.01)).translate([0, 0, -pb - sh]))));
      }
    }

    const out = {
      handle,
      dims: { W, H },
      reliefPolys: relief.toPolygons(),
      outlinePolys: outline.toPolygons(),
      reliefArea: relief.area(),
      // assembled meshes for the preview
      bodyMesh: body.getMesh(),
      padMesh: pad.getMesh(),
      // print-ready orientations
      bodyPrint: body.getMesh(),                                     // flat bottom on bed, handle up
      padPrint: t(pad.rotate([180, 0, 0])).getMesh(),                  // backing on bed, relief up
      onePiecePrint: t(t(body.add(pad)).translate([0, 0, pb + rd])).getMesh(), // relief face on bed
    };
    out.volumes = { body: body.volume(), pad: pad.volume() };
    return out;
  } finally {
    t.free();
  }
}
