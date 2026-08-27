// ============================================================
//  CELADON — glaze application and flow
//
//  Glaze lives in a 2D field wrapped around the vessel:
//      x = angle around the axis      (wraps)
//      y = arc position along the meridian, 0 at the foot,
//          up the outside, over the rim, down the inside to 1
//
//  Each cell carries the thickness of up to three glaze layers plus
//  a wax-resist mask. During the firing the field is integrated
//  forward in time: molten glaze flows downhill at a rate set by
//  h^3 / viscosity, which is why a thick coat runs and a thin one
//  does not, and why the runs always start where the wall is steep.
// ============================================================

import { clamp, clamp01, lerp, smoothstep, TAU } from '../core/util.js';
import { SLOTS, viscosity, meltPoint } from './glaze.js';
import * as THREE from 'three';

export const GW = 192;   // angular cells
export const GH = 160;   // meridian cells

/**
 * How far up the wall counts as "the foot".
 *
 * One number, read by the sponge and by the inspector. They each had
 * their own — 0.2625 cm of full-strength wiping against 0.55 cm of
 * grading — and a tool that cannot satisfy the test it is measured by
 * is not a tool, it is a trap.
 */
export const FOOT_BAND = 0.55;

export class GlazeField {
  constructor() {
    // One float, read back as its bits: this is how a float becomes a
    // half. It comes first because _push needs it, and _push runs
    // before this constructor is finished.
    const bits = new ArrayBuffer(4);
    this._f32 = new Float32Array(bits);
    this._u32 = new Uint32Array(bits);
    this._lo = GH; this._hi = -1;

    this.data = new Float32Array(GW * GH * 4);   // t0,t1,t2,wax

    /* The picture the shader reads, in half floats rather than floats.
       This is why the glaze was invisible on an iPad.
       Sampling a 32-bit float texture with LINEAR filtering is not core
       WebGL2 -- it needs OES_texture_float_linear, and iOS does not have
       it. Where the extension is missing the texture is incomplete for
       that filter and every sample comes back black, so the glaze went
       on, the field filled up, the firing used it, and the pot stayed
       bare. Nothing in the console, and nothing wrong on a desktop.
       Half floats filter linearly as core WebGL2 everywhere. What is
       stored here are coat thicknesses between 0 and 1, so eleven bits
       of mantissa is far more than the surface can show. */
    this.half = new Uint16Array(GW * GH * 4);
    this.tex = new THREE.DataTexture(this.half, GW, GH, THREE.RGBAFormat, THREE.HalfFloatType);
    this.tex.wrapS = THREE.RepeatWrapping;
    this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.generateMipmaps = false;
    this._push();

    // meridian lookup, rebuilt whenever the body changes
    this.mY = new Float32Array(GH);      // height above the wheel head
    this.mR = new Float32Array(GH);      // radius
    this.mDown = new Float32Array(GH);   // downhill gravity component (0..1)
    this.mSide = new Float32Array(GH);   // 0 outer, 1 rim, 2 inner, 3 base
    this.mCirc = new Float32Array(GH);   // circumference, for volume conservation

    this._scratch = new Float32Array(GW * GH * 4);
    this.slotIds = [null, null, null];
    this.runHistory = 0;
    this._touch();
  }

  clear() {
    this.data.fill(0);
    this.runHistory = 0;
    this._push();
  }

  /** Rebuild the meridian lookup table from a ProfileBuffer. */
  bindProfile(pb) {
    const K = pb.count;
    const pr = pb.pr, py = pb.py;
    // arc-length parameterise
    const arc = new Float32Array(K);
    let tot = 0;
    for (let k = 1; k < K; k++) {
      tot += Math.hypot(pr[k] - pr[k - 1], py[k] - py[k - 1]);
      arc[k] = tot;
    }
    const inv = tot > 1e-5 ? 1 / tot : 1;

    let k = 0;
    for (let j = 0; j < GH; j++) {
      const t = j / (GH - 1);
      const target = t * tot;
      while (k < K - 2 && arc[k + 1] < target) k++;
      const seg = Math.max(1e-6, arc[k + 1] - arc[k]);
      const f = clamp01((target - arc[k]) / seg);
      const r = lerp(pr[k], pr[k + 1], f);
      const y = lerp(py[k], py[k + 1], f);
      this.mR[j] = r;
      this.mY[j] = y;
      this.mCirc[j] = Math.max(0.05, TAU * r);
      // downhill component: how much of the surface tangent points down
      const dx = pr[k + 1] - pr[k], dy = py[k + 1] - py[k];
      const l = Math.hypot(dx, dy) || 1;
      this.mDown[j] = clamp01(Math.abs(dy / l));
      // which surface are we on
      const kk = k / K;
      this.mSide[j] = kk < 0.012 ? 3 : kk < 0.5 ? 0 : kk < 0.53 ? 1 : 2;
    }
    this.arcTotal = tot;
    this.topY = Math.max(...this.mY);
  }

  idx(i, j) { return (j * GW + i) * 4; }

  /**
   * Is there any glaze in this layer, or was the bucket only opened?
   *
   * The difference matters because a pot carries three layers and no
   * more. Clicking down the shelf to see what the colours are should
   * cost nothing; putting a brush to the pot should cost a layer.
   */
  hasPaint(slot, eps = 1e-4) {
    if (slot < 0 || slot > 2) return false;
    const d = this.data;
    for (let i = slot; i < d.length; i += 4) if (d[i] > eps) return true;
    return false;
  }

  /* ---------------- application ---------------- */

  /** Brush / sponge a patch of glaze. angle 0..1, arcT 0..1. */
  brush(angle, arcT, radius, slot, amount, wax = false) {
    const ci = angle * GW, cj = arcT * (GH - 1);
    const ri = Math.ceil(radius * GW) + 1;
    const rj = Math.ceil(radius * GH) + 1;
    for (let dj = -rj; dj <= rj; dj++) {
      const j = Math.round(cj + dj);
      if (j < 0 || j >= GH) continue;
      for (let di = -ri; di <= ri; di++) {
        let i = Math.round(ci + di);
        i = ((i % GW) + GW) % GW;
        const du = di / GW, dv = dj / GH;
        const d = Math.hypot(du, dv) / Math.max(1e-5, radius);
        if (d > 1) continue;
        const w = Math.pow(1 - d * d, 1.6);
        const o = this.idx(i, j);
        if (wax) {
          this.data[o + 3] = Math.min(1, this.data[o + 3] + w * amount);
        } else {
          const resist = 1 - this.data[o + 3];
          this.data[o + slot] = clamp(this.data[o + slot] + w * amount * resist, 0, 0.62);
        }
      }
    }
    this._touch(cj - rj, cj + rj);
  }

  /**
   * DIP — invert the pot and lower it into the bucket to a depth.
   * Everything below `depthY` (measured from the rim downward) gets
   * an even coat, with a heavier bead where it came out of the glaze.
   */
  dip(depthFrac, slot, thickness) {
    const top = this.topY;
    const cut = top * (1 - clamp01(depthFrac));
    for (let j = 0; j < GH; j++) {
      const y = this.mY[j];
      if (y < cut) continue;
      // a dipped surface is thicker where it drained, i.e. lower down
      const drain = smoothstep(top, cut, y);
      const edge = 1 + 0.55 * Math.exp(-(((y - cut) / (top * 0.06)) ** 2));
      const amt = thickness * (0.82 + 0.34 * drain) * edge;
      for (let i = 0; i < GW; i++) {
        const o = this.idx(i, j);
        const resist = 1 - this.data[o + 3];
        // slight unevenness — no dip is perfectly even
        const n = 0.94 + 0.12 * Math.sin(i * 0.31 + j * 0.11) * Math.sin(i * 0.07 - j * 0.23);
        this.data[o + slot] = clamp(this.data[o + slot] + amt * n * resist, 0, 0.7);
      }
    }
    this._touch();
  }

  /** POUR — a ribbon of glaze down one side, with real runs. */
  pour(angle, widthFrac, slot, thickness, fromArc = 0.5) {
    const ci = angle * GW;
    const halfW = Math.max(1, widthFrac * GW * 0.5);
    for (let j = 0; j < GH; j++) {
      const t = j / (GH - 1);
      if (t > fromArc) continue;
      const falloff = smoothstep(fromArc, fromArc - 0.55, t);
      for (let d = -Math.ceil(halfW * 1.6); d <= Math.ceil(halfW * 1.6); d++) {
        let i = Math.round(ci + d);
        i = ((i % GW) + GW) % GW;
        const w = Math.exp(-((d / halfW) ** 2) * 1.4);
        if (w < 0.02) continue;
        const o = this.idx(i, j);
        const resist = 1 - this.data[o + 3];
        const wobble = 1 + 0.25 * Math.sin(j * 0.19 + d * 0.9);
        this.data[o + slot] = clamp(
          this.data[o + slot] + thickness * w * (0.45 + 0.75 * falloff) * wobble * resist, 0, 0.75
        );
      }
    }
    this._touch(0, fromArc * (GH - 1));
  }

  /** SPRAY — even mist over the visible hemisphere. */
  spray(angle, slot, thickness, spread = 0.34) {
    for (let j = 0; j < GH; j++) {
      if (this.mSide[j] > 1.5) continue;   // spray does not reach inside
      for (let i = 0; i < GW; i++) {
        let d = Math.abs(((i / GW - angle + 1.5) % 1) - 0.5);
        const w = Math.exp(-((d / spread) ** 2) * 2.2);
        if (w < 0.015) continue;
        const o = this.idx(i, j);
        const resist = 1 - this.data[o + 3];
        this.data[o + slot] = clamp(this.data[o + slot] + thickness * w * resist, 0, 0.5);
      }
    }
    this._touch();
  }

  /**
   * Wipe the foot — mandatory, or the pot welds to the shelf.
   *
   * The sponge and the inspector have to agree about where the foot is,
   * and they did not. This took everything off at full strength only
   * below heightCm * 0.35 — 0.2625 cm for the 0.75 the game passes —
   * while footClean() judges every row out to 0.55 cm at full weight.
   * At 0.55 the old falloff removed 36.7% and left 63.3% standing, so
   * one press of the sponge could not clear the kiln's own gate.
   *
   * What that looked like from the outside: tap the sponge, get a green
   * "Foot wiped clean.", press for the kiln, and be told the foot is
   * still covered. The coach's line does not change either, because it
   * was already showing the same string, so nothing on screen says to
   * tap again. Measured across the eight forms at nine sizes each, 23
   * of 72 failed on one tap — every form has sizes that fail.
   *
   * The full-strength band now reaches whatever footClean grades, and
   * the two read the same constant so they cannot drift apart again.
   * The feather above it is still there, so there is a soft edge rather
   * than a razor line where the glaze stops.
   */
  wipeFoot(heightCm = 0.7) {
    const inner = Math.min(FOOT_BAND, heightCm * 0.9);
    for (let j = 0; j < GH; j++) {
      if (this.mSide[j] > 1.5) continue;
      if (this.mY[j] > heightCm) continue;
      const f = smoothstep(heightCm, inner, this.mY[j]);
      for (let i = 0; i < GW; i++) {
        const o = this.idx(i, j);
        for (let s = 0; s < SLOTS; s++) this.data[o + s] *= 1 - f;
      }
    }
    this._touch();
  }

  /** Is the foot clean enough to sit on a shelf? 1 = clean. */
  footClean(heightCm = FOOT_BAND) {
    let worst = 0;
    for (let j = 0; j < GH; j++) {
      if (this.mSide[j] > 1.5 || this.mY[j] > heightCm) continue;
      for (let i = 0; i < GW; i += 4) {
        const o = this.idx(i, j);
        const t = this.data[o] + this.data[o + 1] + this.data[o + 2];
        if (t > worst) worst = t;
      }
    }
    return clamp01(1 - worst / 0.16);
  }

  /* ---------------- statistics ---------------- */

  stats() {
    const sum = [0, 0, 0], cov = [0, 0, 0];
    let cells = 0, anyCov = 0, evenAcc = 0;
    const outer = [];
    for (let j = 0; j < GH; j++) {
      if (this.mSide[j] === 3) continue;
      for (let i = 0; i < GW; i += 2) {
        const o = this.idx(i, j);
        let tot = 0;
        for (let s = 0; s < SLOTS; s++) {
          const v = this.data[o + s];
          sum[s] += v;
          if (v > 0.012) cov[s]++;
          tot += v;
        }
        if (tot > 0.012) anyCov++;
        if (this.mSide[j] < 1.5) outer.push(tot);
        cells++;
      }
    }
    const n = Math.max(1, cells);
    // evenness of the outer coat
    if (outer.length) {
      const mean = outer.reduce((a, b) => a + b, 0) / outer.length;
      let v = 0;
      for (const o of outer) v += (o - mean) ** 2;
      evenAcc = clamp01(1 - Math.sqrt(v / outer.length) / Math.max(0.03, mean * 0.9));
    }
    return {
      meanThick: sum.map((s, i) => (cov[i] > 0 ? s / cov[i] : 0)),
      coverage: cov.map((c) => c / n),
      totalCoverage: anyCov / n,
      evenness: evenAcc,
      footClean: this.footClean(),
    };
  }

  /* ---------------- flow during the firing ---------------- */

  /**
   * One step of molten flow. dtHours is kiln time, T is Celsius.
   * Returns how much total movement happened (drives the "it's running"
   * warning in the HUD).
   */
  flow(dtHours, T, glazes) {
    const eta = [];
    const mob = [];
    let anyMolten = false;
    for (let s = 0; s < SLOTS; s++) {
      const g = glazes[s];
      if (!g) { eta.push(1e9); mob.push(0); continue; }
      const mp = meltPoint(g);
      const molten = smoothstep(mp - 20, mp + 70, T);
      const e = Math.max(0.02, viscosity(g, T));
      eta.push(e);
      mob.push((molten * (g.runaway ? 2.6 : 1)) / e);
      if (molten > 0.02) anyMolten = true;
    }
    if (!anyMolten) return 0;

    const d = this.data, tmp = this._scratch;
    tmp.set(d);
    let moved = 0;
    const kFlow = dtHours * 0.9;

    for (let j = 1; j < GH; j++) {
      const side = this.mSide[j];
      /* Only the inner wall, not "2 or 3".
         mSide is 0 outer, 1 rim, 2 inner, 3 BASE, and `> 1.5` swept the
         base in with the inside — so the one base row that has any
         downhill component at all (j30, 0.0977, right at the edge of
         the foot) ran its glaze to j + 1, which is the first row of the
         OUTER WALL. Glaze at the foot flowed up the pot. It is a single
         row out of a hundred and sixty, but it is at the foot, which is
         the one place the firing judges for welding to the shelf. */
      const inner = side === 2;
      const jTo = inner ? j + 1 : j - 1;
      if (jTo < 0 || jTo >= GH) continue;
      const down = this.mDown[j];
      if (down < 0.02) continue;
      const circHere = this.mCirc[j], circTo = Math.max(0.05, this.mCirc[jTo]);
      const ratio = circHere / circTo;

      for (let i = 0; i < GW; i++) {
        const o = this.idx(i, j), o2 = this.idx(i, jTo);
        for (let s = 0; s < SLOTS; s++) {
          const h = d[o + s];
          if (h < 0.004 || mob[s] <= 0) continue;
          // Poiseuille: flux goes as h^3
          let q = kFlow * mob[s] * down * h * h * h * 42;
          q = Math.min(q, h * 0.42);
          if (q < 1e-6) continue;
          tmp[o + s] -= q;
          tmp[o2 + s] += q * ratio;
          moved += q;
        }
      }
    }

    // surface tension: a molten glaze evens itself out sideways
    const smooth = clamp01(dtHours * 0.5);
    if (smooth > 0.001) {
      for (let j = 0; j < GH; j++) {
        for (let i = 0; i < GW; i++) {
          const o = this.idx(i, j);
          const oL = this.idx((i + GW - 1) % GW, j);
          const oR = this.idx((i + 1) % GW, j);
          for (let s = 0; s < SLOTS; s++) {
            if (mob[s] <= 0) continue;
            const avg = (tmp[oL + s] + tmp[oR + s]) * 0.5;
            tmp[o + s] = lerp(tmp[o + s], avg, smooth * 0.35);
          }
        }
      }
    }

    d.set(tmp);
    this.runHistory += moved;
    this._push();
    return moved;
  }

  /** How far the glaze crept toward the foot. */
  footRisk() {
    let worst = 0;
    for (let j = 0; j < GH; j++) {
      if (this.mSide[j] > 1.5) continue;
      if (this.mY[j] > 0.32) continue;
      for (let i = 0; i < GW; i += 3) {
        const o = this.idx(i, j);
        const t = this.data[o] + this.data[o + 1] + this.data[o + 2];
        if (t > worst) worst = t;
      }
    }
    return worst;
  }

  /**
   * Say which rows of the field have moved. Everything outside them is
   * still correct in `half` from the last push, so it does not have to
   * be converted again — and the brush, which is the tool a player holds
   * down for minutes at a time, touches about a dozen of the hundred and
   * sixty.
   */
  _touch(lo = 0, hi = GH - 1) {
    if (!this.dirty) { this._lo = GH; this._hi = -1; }
    this._lo = Math.max(0, Math.min(this._lo, Math.floor(lo)));
    this._hi = Math.min(GH - 1, Math.max(this._hi, Math.ceil(hi)));
    this.dirty = true;
  }

  /**
   * Copy the simulation into the picture the GPU reads.
   *
   * The two were one array until the texture had to become half float
   * for the sake of iOS, so this conversion is the price of the pot
   * being visible there at all. It is worth spending it carefully: the
   * conversion is written out by hand rather than calling
   * THREE.DataUtils.toHalfFloat per element, which measured 3.76ms for
   * the full field against 1.25ms for this — and it only runs over the
   * rows that actually moved.
   */
  _push() {
    const lo = this.dirty ? this._lo : 0;
    const hi = this.dirty ? this._hi : GH - 1;
    if (hi >= lo) {
      const d = this.data, h = this.half;
      const f32 = this._f32, u32 = this._u32;
      const end = (hi + 1) * GW * 4;
      for (let i = lo * GW * 4; i < end; i++) {
        f32[0] = d[i];
        const x = u32[0];
        const sign = (x >>> 16) & 0x8000;
        const e = ((x >>> 23) & 0xff) - 112;
        if (e <= 0) { h[i] = sign; continue; }            // zero or subnormal
        if (e >= 31) { h[i] = sign | 0x7c00; continue; }  // infinity
        h[i] = sign | (e << 10) | ((x & 0x7fffff) >>> 13);
      }
    }
    this.tex.needsUpdate = true;
    this.dirty = false;
    this._lo = GH; this._hi = -1;
  }

  upload() {
    if (this.dirty) this._push();
  }

  /**
   * Quantise to bytes at a reduced resolution so a whole gallery fits
   * in localStorage. 64x48 is more than enough for a thumbnail and for
   * standing the piece back on a shelf.
   */
  /**
   * The field as it actually is, not a thumbnail of it.
   *
   * snapshot() samples 192x160 down to 64x48 by nearest neighbour, so a
   * piece on the shelf was drawn from a ninth of the cells it was
   * glazed with: peak thickness measured 0.566 before a save and 0.475
   * after, and every edge a brush had left came back moved by up to
   * three cells. That was the price of keeping saves small, and it
   * turns out not to be a price that has to be paid.
   *
   * Full resolution, deflated: 12,234 bytes for a realistically glazed
   * pot, 16,312 once base64'd — against 16,384 for the thumbnail. The
   * same storage, for all of it. It compresses that hard because 78% of
   * the field is zero (a pot rarely uses more than one or two of the
   * three slots) and the rest is smooth, and because the channels are
   * written out PLANAR rather than interleaved: RLE on the interleaved
   * bytes came to 128,652, and on the planes to 51,752.
   *
   * Byte-identical on the round trip. What is left is the 8-bit quant
   * of a 0..0.7 range, a maximum error of 0.00193 — under half a step.
   *
   * Async because CompressionStream is, and it is 8ms once per firing.
   * Where it is missing — Safari before 16.4 — the caller keeps the
   * thumbnail it already has, so nothing breaks, it is just softer.
   */
  async snapshotExact() {
    if (typeof CompressionStream !== 'function') return null;
    const N = this.data.length;
    const cells = N / 4;
    const planar = new Uint8Array(N);
    for (let c = 0; c < 4; c++) {
      // wax is a plain 0..1; the three glaze slots are stored against 0.7
      const scale = c === 3 ? 1 : 1 / 0.7;
      for (let k = 0; k < cells; k++) {
        planar[c * cells + k] = Math.round(clamp01(this.data[k * 4 + c] * scale) * 255);
      }
    }
    try {
      const cs = new CompressionStream('deflate-raw');
      const w = cs.writable.getWriter();
      w.write(planar);
      w.close();
      const buf = new Uint8Array(await new Response(cs.readable).arrayBuffer());
      let s = '';
      const CH = 4096;
      for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode.apply(null, buf.subarray(i, i + CH));
      return { v: 2, w: GW, h: GH, z: btoa(s) };
    } catch (e) {
      console.warn('celadon: exact snapshot failed, keeping the thumbnail', e);
      return null;
    }
  }

  /** Read back a v2 snapshot. Async, for the same reason. */
  async restoreExact(snap) {
    if (!snap || snap.v !== 2 || !snap.z) return false;
    if (typeof DecompressionStream !== 'function') return false;
    try {
      const bin = atob(snap.z);
      const raw = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) raw[i] = bin.charCodeAt(i);
      const ds = new DecompressionStream('deflate-raw');
      const w = ds.writable.getWriter();
      w.write(raw);
      w.close();
      const planar = new Uint8Array(await new Response(ds.readable).arrayBuffer());
      const N = this.data.length;
      const cells = N / 4;
      if (planar.length !== N) {
        console.warn(`celadon: snapshot is ${planar.length} bytes, this field is ${N}`);
        return false;
      }
      for (let c = 0; c < 4; c++) {
        const scale = c === 3 ? 1 : 0.7;
        for (let k = 0; k < cells; k++) {
          this.data[k * 4 + c] = (planar[c * cells + k] / 255) * scale;
        }
      }
      this._push();
      return true;
    } catch (e) {
      console.warn('celadon: could not read the exact snapshot', e);
      return false;
    }
  }

  snapshot(sw = 64, sh = 48) {
    const out = new Uint8Array(sw * sh * 4);
    for (let j = 0; j < sh; j++) {
      const sj = Math.min(GH - 1, Math.round((j / (sh - 1)) * (GH - 1)));
      for (let i = 0; i < sw; i++) {
        const si = Math.min(GW - 1, Math.round((i / sw) * GW));
        const o = (sj * GW + si) * 4, q = (j * sw + i) * 4;
        /* The three glaze slots are stored against their 0.7 ceiling;
           the wax channel is a plain 0..1 and has no such ceiling. Put
           through the same divisor it saturated: a full resist of 1.0
           became clamp01(1/0.7) = 1 = 255, and came back as 0.7 — so a
           reloaded piece let glaze through where the player had waxed
           it solid. The shelf viewer restores and re-fires from this,
           so it is what the finished piece is drawn from. */
        for (let c = 0; c < 3; c++) out[q + c] = Math.round(clamp01(this.data[o + c] / 0.7) * 255);
        out[q + 3] = Math.round(clamp01(this.data[o + 3]) * 255);
      }
    }
    let s = '';
    const CH = 4096;
    for (let i = 0; i < out.length; i += CH) s += String.fromCharCode.apply(null, out.subarray(i, i + CH));
    return { w: sw, h: sh, d: btoa(s) };
  }

  restore(snap) {
    try {
      if (!snap || !snap.d) return false;
      const bin = atob(snap.d);
      const sw = snap.w || 64, sh = snap.h || 48;
      for (let j = 0; j < GH; j++) {
        const sj = Math.min(sh - 1, Math.round((j / (GH - 1)) * (sh - 1)));
        for (let i = 0; i < GW; i++) {
          const si = Math.min(sw - 1, Math.round((i / GW) * sw));
          const q = (sj * sw + si) * 4, o = (j * GW + i) * 4;
          for (let c = 0; c < 3; c++) {
            this.data[o + c] = (bin.charCodeAt(q + c) / 255) * 0.7;
          }
          this.data[o + 3] = bin.charCodeAt(q + 3) / 255;   // wax is 0..1
        }
      }
      this._push();
      return true;
    } catch (e) { return false; }
  }

  dispose() { this.tex.dispose(); }
}

/* ------------------------------------------------------------------ */
/*  CPU ray / lathe intersection                                       */
/*  The mesh is built on the GPU, so three's raycaster cannot see it.  */
/*  We march the ray and test against the meridian polygon instead.    */
/* ------------------------------------------------------------------ */

export function raycastPot(origin, dir, pb, maxDist = 300) {
  const K = pb.count;
  const pr = pb.pr, py = pb.py;
  let lo = 0, hi = maxDist;

  // bounding cylinder cull
  let rmax = 0, ymax = 0;
  for (let k = 0; k < K; k++) { if (pr[k] > rmax) rmax = pr[k]; if (py[k] > ymax) ymax = py[k]; }
  rmax += 0.4; ymax += 0.4;

  /* ...and it has to actually narrow the march, which it never did.
     lo and hi stayed 0 and 300 while N is 320, so the ray was sampled
     every 0.94 units — and the wall of a thrown cup is about 0.6 thick.
     The near wall is THINNER THAN ONE STEP, so the march stepped clean
     over it and the first solid it found was the far wall. Every glaze
     tool then painted the back of the pot: hold a brush against the
     side facing you and the colour lands where you cannot see it. The
     three tools reported as "nothing happens" were all doing this.
     Clipping to where the ray is genuinely near the pot puts those 320
     samples across about ten units instead of three hundred, which is
     a step of 0.03 — twenty times finer than the wall it has to find. */
  {
    const a = dir.x * dir.x + dir.z * dir.z;
    const b = 2 * (origin.x * dir.x + origin.z * dir.z);
    const c = origin.x * origin.x + origin.z * origin.z - rmax * rmax;
    if (a > 1e-9) {
      const disc = b * b - 4 * a * c;
      if (disc < 0) return { hit: false };          // never comes near it
      const sq = Math.sqrt(disc);
      lo = Math.max(lo, (-b - sq) / (2 * a));
      hi = Math.min(hi, (-b + sq) / (2 * a));
    } else if (c > 0) {
      return { hit: false };                        // straight down, outside
    }
    // and the same for the height band the pot occupies
    if (Math.abs(dir.y) > 1e-9) {
      const t1 = (-1 - origin.y) / dir.y, t2 = (ymax - origin.y) / dir.y;
      lo = Math.max(lo, Math.min(t1, t2));
      hi = Math.min(hi, Math.max(t1, t2));
    } else if (origin.y < -1 || origin.y > ymax) {
      return { hit: false };
    }
    lo = Math.max(0, lo);
    if (hi <= lo) return { hit: false };
  }

  const inside = (r, y) => {
    // even-odd test of (r,y) against the closed meridian polygon
    let c = false;
    for (let a = 0, b = K - 1; a < K; b = a++) {
      const ya = py[a], yb = py[b];
      if ((ya > y) !== (yb > y)) {
        const x = pr[a] + ((y - ya) / (yb - ya)) * (pr[b] - pr[a]);
        if (r < x) c = !c;
      }
    }
    return c;
  };

  const N = 320;
  let prevIn = false, prevT = 0;
  for (let s = 0; s <= N; s++) {
    const t = lo + (hi - lo) * (s / N);
    const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
    if (y < -1 || y > ymax) { prevIn = false; prevT = t; continue; }
    const r = Math.hypot(x, z);
    if (r > rmax) { prevIn = false; prevT = t; continue; }
    const ins = inside(r, y);
    if (ins && !prevIn && s > 0) {
      // bisect for a clean surface point
      let a = prevT, b = t;
      for (let it = 0; it < 22; it++) {
        const m = (a + b) * 0.5;
        const px = origin.x + dir.x * m, pyy = origin.y + dir.y * m, pz = origin.z + dir.z * m;
        if (inside(Math.hypot(px, pz), pyy)) b = m; else a = m;
      }
      const hx = origin.x + dir.x * b, hy = origin.y + dir.y * b, hz = origin.z + dir.z * b;
      const hr = Math.hypot(hx, hz);
      // nearest meridian station
      let best = 0, bd = 1e9;
      for (let k = 0; k < K; k++) {
        const dd = (pr[k] - hr) ** 2 + (py[k] - hy) ** 2;
        if (dd < bd) { bd = dd; best = k; }
      }
      // arc parameter of the hit station (no allocation: this runs per frame)
      let tot = 0, upto = 0;
      for (let k = 1; k < K; k++) {
        tot += Math.hypot(pr[k] - pr[k - 1], py[k] - py[k - 1]);
        if (k === best) upto = tot;
      }
      const arc = tot > 0 ? upto / tot : 0;
      let ang = Math.atan2(hz, hx) / TAU;
      if (ang < 0) ang += 1;
      return { hit: true, x: hx, y: hy, z: hz, dist: b, angle: ang, arcT: arc, k: best, r: hr };
    }
    prevIn = ins; prevT = t;
  }
  return { hit: false };
}
