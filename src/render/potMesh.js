// ============================================================
//  CELADON — vessel geometry
//
//  The mesh is a static lathe lattice (K profile stations x RSEG
//  radial steps). Nothing about its shape lives in the vertex
//  buffer: every frame the CPU writes a K x 4 RGBA float texture
//  describing the current meridian profile, and the vertex shader
//  revolves it. Updating a pot therefore costs ~350 texel writes
//  instead of 45,000 vertex writes, and all the sweeping,
//  ring-throwing and wobble happens on the GPU.
//
//  Profile texture rows
//    row 0  (r, y, nr, ny)          meridian point + 2D outward normal
//    row 1  (ox, oz, dox, doz)      off-centre offset and its d/dy
//    row 2  (ring, arcT, curv, --)  throwing-ring amp, arc param, curvature
//    row 3  (moist, scar, stress, secT)
// ============================================================

import * as THREE from 'three';
import { NS } from '../sim/clay.js';
import { clamp, clamp01, TAU } from '../core/util.js';

export const RIM = 9;
export const K = 2 * NS + RIM + 4;     // meridian stations
export const RSEG = 128;               // radial subdivisions

export const SIDE = { BASE: 3, OUTER: 0, RIM: 1, INNER: 2 };

/* ------------------------------------------------------------------ */
/*  Static lattice                                                     */
/* ------------------------------------------------------------------ */

let _geo = null;

export function potGeometry() {
  if (_geo) return _geo;

  const cols = RSEG + 1;
  const count = K * cols;
  const pos = new Float32Array(count * 3);        // filled by the vertex shader
  const uv = new Float32Array(count * 2);
  const side = new Float32Array(count);
  const nrm = new Float32Array(count * 3);

  // side is static per station; fill from the assembly layout
  const sideOf = (k) => {
    if (k < 3) return SIDE.BASE;
    if (k < 3 + NS) return SIDE.OUTER;
    if (k < 3 + NS + RIM) return SIDE.RIM;
    return SIDE.INNER;
  };

  let v = 0;
  for (let k = 0; k < K; k++) {
    const s = sideOf(k);
    const vk = (k + 0.5) / K;
    for (let j = 0; j < cols; j++) {
      uv[v * 2] = j / RSEG;
      uv[v * 2 + 1] = vk;
      side[v] = s;
      nrm[v * 3 + 1] = 1;
      v++;
    }
  }

  const idx = [];
  for (let k = 0; k < K - 1; k++) {
    for (let j = 0; j < RSEG; j++) {
      const a = k * cols + j;
      const b = (k + 1) * cols + j;
      const c = a + 1;
      const d = b + 1;
      idx.push(a, b, d, a, d, c);
    }
  }

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setIndex(count > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 20, 0), 90);
  g.boundingBox = new THREE.Box3(new THREE.Vector3(-40, -2, -40), new THREE.Vector3(40, 60, 40));
  _geo = g;
  return g;
}

/* ------------------------------------------------------------------ */
/*  Profile buffer                                                     */
/* ------------------------------------------------------------------ */

export class ProfileBuffer {
  constructor() {
    this.data = new Float32Array(K * 4 * 4);      // width K, height 4, RGBA
    this.tex = new THREE.DataTexture(this.data, K, 4, THREE.RGBAFormat, THREE.FloatType);
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.wrapS = THREE.ClampToEdgeWrapping;
    this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.generateMipmaps = false;
    this.tex.needsUpdate = true;

    // scratch meridian
    this.pr = new Float32Array(K);
    this.py = new Float32Array(K);
    this.pox = new Float32Array(K);
    this.poz = new Float32Array(K);
    this.pring = new Float32Array(K);
    this.psec = new Float32Array(K);
    this.pmoist = new Float32Array(K);
    this.pscar = new Float32Array(K);
    this.pstress = new Float32Array(K);

    this.top = 0;
    this.rmax = 0;
  }

  /** Assemble the closed meridian from a Clay body. */
  build(c) {
    const { ri, ro, ring, ox, oz, m, scar, stress, y } = c;
    const pr = this.pr, py = this.py;
    const ymid = (i) => (y[i] + y[i + 1]) * 0.5;

    let p = 0;
    const put = (r, yy, o1, o2, rg, sec, mo, sc, st) => {
      pr[p] = r; py[p] = yy;
      this.pox[p] = o1; this.poz[p] = o2;
      this.pring[p] = rg; this.psec[p] = sec;
      this.pmoist[p] = mo; this.pscar[p] = sc; this.pstress[p] = st;
      p++;
    };

    // ---- base disc -------------------------------------------------
    const r0 = ro[0];
    put(0, 0, ox[0], oz[0], 0, 0, m[0], scar[0], stress[0]);
    put(r0 * 0.62, 0, ox[0], oz[0], 0, 0, m[0], scar[0], stress[0]);
    put(r0 * 0.985, Math.min(0.05, y[1] * 0.35), ox[0], oz[0], 0, 0, m[0], scar[0], stress[0]);

    // ---- outer wall, bottom to rim ---------------------------------
    for (let i = 0; i < NS; i++) {
      put(ro[i], ymid(i), ox[i], oz[i], ring[i], i / (NS - 1), m[i], scar[i], stress[i]);
    }

    // ---- rounded rim ------------------------------------------------
    const t = NS - 1;
    const rOut = ro[t], rIn = ri[t];
    const cR = (rOut + rIn) * 0.5;
    const rad = Math.max(0.012, (rOut - rIn) * 0.5);
    const yTop = ymid(t);
    const dome = rIn < 0.06 ? 0.86 : 0.5;
    const peak = (y[NS] - yTop) + rad * dome;
    for (let q = 1; q <= RIM; q++) {
      const th = (q / (RIM + 1)) * Math.PI;
      put(cR + rad * Math.cos(th), yTop + peak * Math.sin(th),
        ox[t], oz[t], 0, 1, m[t], scar[t], stress[t]);
    }

    // ---- inner wall, rim to floor ------------------------------------
    for (let i = NS - 1; i >= 0; i--) {
      put(ri[i], ymid(i), ox[i], oz[i], ring[i] * 0.35, i / (NS - 1), m[i], scar[i], stress[i]);
    }
    put(0, Math.max(0.006, ymid(0) * 0.6), ox[0], oz[0], 0, 0, m[0], scar[0], stress[0]);

    this.top = y[NS];
    this.rmax = c.maxR;
    this.count = p;
    return p;
  }

  /** Build + write the texture. */
  update(c) {
    this.build(c);
    const d = this.data;
    const pr = this.pr, py = this.py;

    // arc length parameterisation for glaze mapping
    let arc = 0;
    const arcs = this.psec; // reuse? no — keep secT. use a local
    const A = this._arc || (this._arc = new Float32Array(K));
    A[0] = 0;
    for (let k = 1; k < K; k++) {
      arc += Math.hypot(pr[k] - pr[k - 1], py[k] - py[k - 1]);
      A[k] = arc;
    }
    const inv = arc > 1e-5 ? 1 / arc : 1;
    this.arcLen = arc;                 // centimetres up the whole meridian

    for (let k = 0; k < K; k++) {
      // ---- meridian normal from central difference ------------------
      const k0 = Math.max(0, k - 1), k1 = Math.min(K - 1, k + 1);
      let tx = pr[k1] - pr[k0];
      let ty = py[k1] - py[k0];
      let l = Math.hypot(tx, ty);
      if (l < 1e-7) { tx = 0; ty = 1; l = 1; }
      tx /= l; ty /= l;
      const nr = ty, ny = -tx;            // CCW loop -> outward normal

      // ---- curvature (for edge wear / glaze pooling) ----------------
      const ka = Math.max(0, k - 2), kb = Math.min(K - 1, k + 2);
      let t2x = pr[kb] - pr[ka], t2y = py[kb] - py[ka];
      const l2 = Math.hypot(t2x, t2y) || 1;
      const curv = (tx * (t2y / l2) - ty * (t2x / l2)) * 6;

      // ---- offset derivative for the skew normal --------------------
      const dy = py[k1] - py[k0];
      const inv2 = Math.abs(dy) > 1e-4 ? 1 / dy : 0;
      const dox = (this.pox[k1] - this.pox[k0]) * inv2;
      const doz = (this.poz[k1] - this.poz[k0]) * inv2;

      const o = k * 4;
      d[o + 0] = pr[k]; d[o + 1] = py[k]; d[o + 2] = nr; d[o + 3] = ny;

      const o1 = (K + k) * 4;
      d[o1 + 0] = this.pox[k]; d[o1 + 1] = this.poz[k];
      d[o1 + 2] = clamp(dox, -3, 3); d[o1 + 3] = clamp(doz, -3, 3);

      const o2 = (2 * K + k) * 4;
      d[o2 + 0] = this.pring[k];
      d[o2 + 1] = A[k] * inv;
      d[o2 + 2] = clamp(curv, -4, 4);
      d[o2 + 3] = 0;

      const o3 = (3 * K + k) * 4;
      d[o3 + 0] = this.pmoist[k];
      d[o3 + 1] = this.pscar[k];
      d[o3 + 2] = clamp01(this.pstress[k] * 0.6);
      d[o3 + 3] = this.psec[k];
    }
    this.tex.needsUpdate = true;
  }

  /** Nearest meridian station to a point in the (r, y) plane. */
  /**
   * The station nearest a point on the profile.
   *
   * `outside` says which face the hand is on, and it matters: the
   * profile runs up the outer wall, over the rim and back DOWN the
   * inner one, so the outer and inner faces of the same ring are only a
   * wall's thickness apart in (r, y) but at opposite ends of the arc.
   * Nearest-by-distance alone would flip between them on a thin wall,
   * which is how a hand resting plainly on the outside of a pot got its
   * mark drawn down inside it.
   */
  nearest(r, y, outside = null) {
    const want = outside === null ? null : (outside ? SIDE.OUTER : SIDE.INNER);
    let best = 0, bd = 1e18, bestAny = 0, bdAny = 1e18;
    for (let k = 0; k < this.count; k++) {
      const d = (this.pr[k] - r) ** 2 + (this.py[k] - y) ** 2;
      if (d < bdAny) { bdAny = d; bestAny = k; }
      if (want !== null && this.sideOf(k) !== want) continue;
      if (d < bd) { bd = d; best = k; }
    }
    if (want === null || bd > 1e17) { best = bestAny; bd = bdAny; }
    const arc = this._arc ? this._arc[best] / Math.max(1e-6, this._arc[this.count - 1]) : 0;
    return { k: best, arcT: arc, dist: Math.sqrt(bd) };
  }

  /** Which face of the pot a profile station belongs to. */
  sideOf(k) {
    if (k < 3) return SIDE.BASE;
    if (k < 3 + NS) return SIDE.OUTER;
    if (k < 3 + NS + RIM) return SIDE.RIM;
    return SIDE.INNER;
  }

  /** Outer and inner radius at a world height, for tool contact tests. */
  radiiAt(y) {
    let ro = 0, ri = 0;
    const half = Math.floor(this.count / 2);
    for (let k = 3; k < half; k++) {
      if (this.py[k] <= y && this.py[k + 1] >= y) { ro = this.pr[k]; break; }
      if (k === half - 1) ro = this.pr[k];
    }
    for (let k = this.count - 2; k > half; k--) {
      if (this.py[k] <= y && this.py[k - 1] >= y) { ri = this.pr[k]; break; }
    }
    return { ro, ri };
  }

  dispose() { this.tex.dispose(); }
}

/* ------------------------------------------------------------------ */
/*  A tiny CPU silhouette, used by the UI (gallery thumbnails, guides) */
/* ------------------------------------------------------------------ */

export function silhouette(c, n = 64) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const s = Math.min(NS - 1, Math.floor(t * NS));
    out.push({ y: (c.y[s] + c.y[s + 1]) * 0.5, ro: c.ro[s], ri: c.ri[s] });
  }
  return out;
}

/** Golden-ratio / proportion analysis used by the appraiser. */
export function proportions(c) {
  const h = c.height;
  if (h < 0.4) return { ratio: 1, grace: 0, waist: 0, lip: 0 };
  let maxR = 0, maxAt = 0, minR = 1e9, minAt = 0;
  const f = c.floorSection();
  for (let i = f; i < NS; i++) {
    if (c.ro[i] > maxR) { maxR = c.ro[i]; maxAt = i / NS; }
    if (c.ro[i] < minR && i > f + NS * 0.15) { minR = c.ro[i]; minAt = i / NS; }
  }
  const ratio = h / Math.max(0.4, maxR * 2);
  // grace: how smooth the silhouette's second derivative is
  let bend = 0, n = 0;
  for (let i = f + 2; i < NS - 2; i++) {
    const d2 = c.ro[i + 2] - 2 * c.ro[i] + c.ro[i - 2];
    bend += d2 * d2; n++;
  }
  bend = Math.sqrt(bend / Math.max(1, n));
  const grace = clamp01(1 - bend / 0.05);
  return {
    ratio,
    grace,
    waist: clamp01(1 - minR / Math.max(0.2, maxR)),
    lip: maxAt,
    bellyAt: maxAt,
    neckAt: minAt,
    maxR,
  };
}
