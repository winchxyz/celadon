// ============================================================
//  CELADON — procedural material library
//
//  Nothing in this game ships as an image file. Every surface in
//  the workshop is generated here at load time: an albedo, a
//  height field converted to a tangent-space normal map, and a
//  roughness map, all from the same pixel function.
// ============================================================

import * as THREE from 'three';
import { makeNoise2, clamp01, lerp, smoothstep, makeRng } from '../core/util.js';

const cache = new Map();

/**
 * Build a material texture set.
 * @param {string} key      cache key
 * @param {number} size     square resolution
 * @param {(x:number,y:number,n:any,rng:any)=>[r,g,b,h,rough]} fn
 *        x,y in [0,1); returns sRGB 0..1 colour, height 0..1, roughness 0..1
 */
export function makeMaterialMaps(key, size, fn, opts = {}) {
  if (cache.has(key)) return cache.get(key);

  const n = makeNoise2(opts.seed ?? 1337);
  const rng = makeRng(opts.seed ?? 1337);

  const alb = new Uint8ClampedArray(size * size * 4);
  const hgt = new Float32Array(size * size);
  const rgh = new Uint8ClampedArray(size * size * 4);

  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const o = (j * size + i) * 4;
      const p = fn(i / size, j / size, n, rng);
      alb[o] = p[0] * 255; alb[o + 1] = p[1] * 255; alb[o + 2] = p[2] * 255; alb[o + 3] = 255;
      hgt[j * size + i] = p[3];
      const r = p[4] * 255;
      rgh[o] = r; rgh[o + 1] = r; rgh[o + 2] = r; rgh[o + 3] = 255;
    }
  }

  // height -> tangent-space normal (Sobel, wrapping)
  const nrm = new Uint8ClampedArray(size * size * 4);
  const strength = opts.normalStrength ?? 2.2;
  const H = (i, j) => hgt[((j + size) % size) * size + ((i + size) % size)];
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx =
        (H(i + 1, j - 1) + 2 * H(i + 1, j) + H(i + 1, j + 1)) -
        (H(i - 1, j - 1) + 2 * H(i - 1, j) + H(i - 1, j + 1));
      const dy =
        (H(i - 1, j + 1) + 2 * H(i, j + 1) + H(i + 1, j + 1)) -
        (H(i - 1, j - 1) + 2 * H(i, j - 1) + H(i + 1, j - 1));
      let nx = -dx * strength, ny = -dy * strength, nz = 1;
      const l = Math.hypot(nx, ny, nz) || 1;
      const o = (j * size + i) * 4;
      nrm[o] = ((nx / l) * 0.5 + 0.5) * 255;
      nrm[o + 1] = ((ny / l) * 0.5 + 0.5) * 255;
      nrm[o + 2] = ((nz / l) * 0.5 + 0.5) * 255;
      nrm[o + 3] = 255;
    }
  }

  const mk = (data, srgb) => {
    const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };

  const set = { map: mk(alb, true), normalMap: mk(nrm, false), roughnessMap: mk(rgh, false), size };
  cache.set(key, set);
  return set;
}

/* ------------------------------------------------------------------ */
/*  Recipes                                                            */
/* ------------------------------------------------------------------ */

/* ==================================================================
   ONE MATERIAL, SIX MIXES

   Everything in this workshop is clay. Not "brick tinted to agree
   with clay" — a wall somebody pressed out of clay blocks, a floor
   that is a slab of it, a bucket pinched out of it.

   That is a decision about what the game IS, and it is the reason
   the room stopped looking photographic. Six recipes used to live
   here: brick with mortar joints, flagstones with grout, wood with
   its grain, brushed metal with turning marks, plaster, cloth. Every
   one of them was a photograph of a material, and no amount of
   warming the palette was ever going to change that. A brick wall
   with mortar lines standing next to a thumbprint in plasticine
   reads as a brick wall standing next to a thumbprint in plasticine.

   What is left is one surface, mixed six ways:

     - broad mottling at two to four centimetres, because that is the
       size of the marks a hand leaves and the size at which a
       surface reads as worked rather than as photographed
     - a sparse pale fleck of unmixed pigment, always LIGHTER than
       the body and always raised, never a dark pit
     - thumb dents: shallow, wide, few
     - no joints, no grout, no grain, no seams, no step edges

   Nothing here has a boundary. That single property is most of the
   difference between clay and masonry.
   ================================================================== */

/**
 * One clay surface. `tint` is the pigment; everything else is how it
 * was handled.
 *
 * Every frequency here is rounded to a whole number of features across
 * the tile, and the noise is told to wrap at that number before each
 * sample. Without it the tile does not close, and since these are small
 * tiles repeated seven times across a five-metre floor, not closing
 * means a visible grid ruled across every surface in the room.
 */
function clayRecipe(tint, opts = {}) {
  const cell = opts.cell ?? 3.4;          // the master mark, in "cells" across the tile
  const dents = opts.dents ?? 1.0;        // how thoroughly a thumb went over it
  const fleck = opts.fleck ?? 0.5;        // unmixed pigment
  const vary = opts.vary ?? 0.10;         // how far the pigment wanders

  // whole numbers of features across the tile, or it will not wrap
  const fBig  = Math.max(2, Math.round(cell));
  const fMid  = Math.max(3, Math.round(cell * 2.6));
  const fDent = Math.max(3, Math.round(cell * 1.7));
  const fSpec = Math.max(4, Math.round(cell * 5.5));

  return (x, y, n) => {
    // the broad mark of a hand: this is the only structure the surface has
    n.tile(fBig);
    const big = n.fbm(x * fBig, y * fBig, 4);
    n.tile(fMid);
    const mid = n.fbm(x * fMid, y * fMid, 3);
    // shallow, wide, few — a thumb, not a chisel
    n.tile(fDent);
    const dent = Math.pow(Math.max(0, n(x * fDent + 11, y * fDent + 7)), 2.2);
    // unmixed pigment, sparse and pale
    n.tile(fSpec);
    const sp = Math.pow(Math.max(0, n(x * fSpec + 31, y * fSpec + 17)), 7) * fleck;
    n.tile(0);

    const v = 1 + (big - 0.5) * vary * 2 + (mid - 0.5) * vary * 0.7;
    const c = [
      clamp01(tint[0] * v + sp * 0.30),
      clamp01(tint[1] * v + sp * 0.27),
      clamp01(tint[2] * v + sp * 0.23),
    ];
    // Height carries the same marks, so the relief and the colour are
    // the same event rather than two unrelated noises laid on top.
    const h = clamp01(0.45 + (big - 0.5) * 0.55 + (mid - 0.5) * 0.18
                      - dent * 0.30 * dents + sp * 0.25);
    // matte, and never polished anywhere
    const rough = clamp01(0.80 - sp * 0.06 + (0.5 - big) * 0.08);
    return [c[0], c[1], c[2], h, rough];
  };
}

/* Six mixes of one body — and every one of them is GREY.
   That is the point. These tints used to carry colour as well as
   structure, so every surface got its hue twice: once from the
   texture and once again from the material, and the two were always
   the same brown. Colour lives in palette.js now and only there;
   what varies here is how the stuff was handled — the size of the
   mark, how thoroughly a thumb went over it, how much unmixed
   pigment shows. Structure, not hue. */
const MIX = {
  plaster: { tint: [0.88, 0.88, 0.88], seed: 11, cell: 2.6, dents: 0.8, fleck: 0.35, vary: 0.09 },
  brick:   { tint: [0.88, 0.88, 0.88], seed: 22, cell: 3.0, dents: 1.2, fleck: 0.55, vary: 0.13 },
  wood:    { tint: [0.88, 0.88, 0.88], seed: 33, cell: 3.6, dents: 1.0, fleck: 0.40, vary: 0.12 },
  stone:   { tint: [0.88, 0.88, 0.88], seed: 44, cell: 2.8, dents: 1.1, fleck: 0.45, vary: 0.10 },
  metal:   { tint: [0.88, 0.88, 0.88], seed: 55, cell: 3.2, dents: 0.9, fleck: 0.30, vary: 0.08 },
  cloth:   { tint: [0.88, 0.88, 0.88], seed: 66, cell: 3.0, dents: 0.7, fleck: 0.50, vary: 0.11 },
};

/* ==================================================================
   THE KILN, AND THE ONE PLACE MASONRY IS RIGHT

   Everything else in this workshop is one unbroken surface, on purpose:
   a joint is what separates masonry from a thing pinched out of a lump.
   The kiln is the exception, and it has to be, because a kiln with no
   courses in it is not a kiln — it is a brown box, which is exactly how
   it read. It is also not really an exception: a kiln is built out of
   clay bricks, so this is the same material, just in blocks somebody
   stacked rather than in a slab somebody smoothed.

   What keeps it inside the language is HOW the joint is drawn. There is
   no dark line and no step. Each brick is a pillow: the height field
   swells in the middle of the face and falls away to the bed, and the
   only colour difference is that one brick was fired a shade differently
   from the next. Read at the size a hand makes them, not at the size a
   machine cuts them.
   ================================================================== */
function kilnBrickRecipe(opts = {}) {
  const cols = opts.cols ?? 4;          // bricks across the tile
  const rows = opts.rows ?? 8;          // courses down it
  const bed = opts.bed ?? 0.016;        // joint width, in tile units
  // the bed has to be the same width on both axes, and the cell is not
  // square, so the fraction differs per axis
  const jx = bed * cols, jy = bed * rows;
  const hash = (a, b) => {
    const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  return (x, y, n) => {
    const gy = y * rows, row = Math.floor(gy), fy = gy - row;
    // running bond: every other course starts half a brick over
    const gx = x * cols + (row & 1 ? 0.5 : 0);
    const col = Math.floor(gx), fx = gx - col;

    // distance in from the bed, 0 at the joint and 1 on the face
    const ex = Math.min(fx, 1 - fx) / jx;
    const ey = Math.min(fy, 1 - fy) / jy;
    const face = smoothstep(0, 1, clamp01(Math.min(ex, ey)));

    // no two bricks came out of the fire the same
    const bh = hash(col, row & 1023);
    const bv = 0.86 + 0.26 * bh;

    // the clay the bricks are made of, at the scale of a hand
    const grain = n.fbm(x * 7.0, y * 11.0, 3);
    const soot = Math.pow(clamp01(n(x * 3.0 + 5, y * 4.0 + 9)), 2.0);

    const v = clamp01(bv * (0.74 + 0.30 * face) * (0.94 + 0.12 * (grain - 0.5)) * (1 - soot * 0.14));
    // pillowed, not chamfered: the swell is the whole of the relief
    const h = clamp01(0.24 + 0.52 * face + 0.16 * (bh - 0.5) + 0.10 * (grain - 0.5));
    const rough = clamp01(0.86 - 0.06 * face + 0.05 * soot);
    return [v, v, v, h, rough];
  };
}

export function kilnBrickMaps(size = 512) {
  return makeMaterialMaps('kiln-brick', size, kilnBrickRecipe(), { seed: 77, normalStrength: 1.5 });
}

function clayMaps(name, size = 512) {
  const m = MIX[name];
  // Relief is a thumb in plasticine, not masonry — one strength for the
  // whole world, so nothing has a sharper edge than anything else.
  // Relief is a thumb in plasticine, not masonry — one strength for the
  // whole world, so nothing has a sharper edge than anything else. The
  // normal map is kept for the pot's own body and dropped everywhere in
  // the room: a bumped wall is a story about microstructure, and
  // microstructure is the photographic scale by definition.
  return makeMaterialMaps(`clay-${name}`, size,
    clayRecipe(m.tint, m), { seed: m.seed, normalStrength: 1.1 });
}

export function plasterMaps(size = 512) { return clayMaps('plaster', size); }
export function brickMaps(size = 512) { return clayMaps('brick', size); }
export function woodMaps(size = 512) { return clayMaps('wood', size); }
export function stoneFloorMaps(size = 512) { return clayMaps('stone', size); }
export function metalMaps(size = 256) { return clayMaps('metal', size); }
export function clothMaps(size = 256) { return clayMaps('cloth', size); }

export function radialSprite(size = 128, power = 2.2, inner = 1.0) {
  const key = `sprite_${size}_${power}_${inner}`;
  if (cache.has(key)) return cache.get(key);
  const d = new Uint8ClampedArray(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const x = (i + 0.5) / size - 0.5, y = (j + 0.5) / size - 0.5;
      const r = Math.hypot(x, y) * 2;
      const v = Math.pow(Math.max(0, 1 - r), power) * inner;
      const o = (j * size + i) * 4;
      d[o] = d[o + 1] = d[o + 2] = 255;
      d[o + 3] = clamp01(v) * 255;
    }
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

export function noiseTexture(size = 256, seed = 3) {
  const key = `noise_${size}_${seed}`;
  if (cache.has(key)) return cache.get(key);
  const rng = makeRng(seed);
  const d = new Uint8ClampedArray(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    d[i * 4] = rng() * 255; d[i * 4 + 1] = rng() * 255;
    d[i * 4 + 2] = rng() * 255; d[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(d, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.needsUpdate = true;
  cache.set(key, t);
  return t;
}

export function disposeAll() {
  for (const v of cache.values()) {
    if (v.map) { v.map.dispose(); v.normalMap.dispose(); v.roughnessMap.dispose(); }
    else if (v.dispose) v.dispose();
  }
  cache.clear();
}
