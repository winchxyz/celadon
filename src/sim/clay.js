// ============================================================
//  CELADON — clay body simulation
//
//  The vessel is modelled in *material coordinates*: the clay is
//  divided into NS stacked ring-sections, each holding a fixed
//  volume V[i] of clay. A section is described by its inner and
//  outer radius (ri, ro). Its height therefore follows from mass
//  conservation:
//
//      A[i]  = PI * (ro^2 - ri^2)          cross-section area
//      dy[i] = V[i] / A[i]                 section height
//
//  Everything a potter knows falls out of that one identity:
//    * thinning a wall (ro -> ri) shrinks A, so the pot GROWS TALLER
//    * bellying out (ri,ro both up) grows A, so the pot gets SHORTER
//    * collaring in (ri,ro both down) shrinks A, so it RISES again
//    * no operation can ever create or destroy clay
//
//  On top of that sit the things that make throwing hard: moisture,
//  centrifugal hoop stress, the weight of the column above, plastic
//  slumping past the yield point, off-centre wobble, and tearing.
//
//  Units are centimetres, grams, seconds.
// ============================================================

import { clamp, clamp01, lerp, smoothstep, gauss, makeRng, blur1, TAU } from '../core/util.js';

export const NS = 168;                 // material sections
export const RHO = 1.92;               // g/cm^3 wet clay
export const G = 981;                  // cm/s^2
/**
 * How far the hand must travel to do one unit of work, in centimetres.
 * Shaping is paid for by DISTANCE DRAGGED, never by time held, so a
 * careful slow stroke and a quick one along the same path do the same
 * thing. It lives here rather than with the hand because the clay caps
 * its own motion against it.
 */
export const DRAG_REF = 22.0;

export const W_MIN = 0.085;            // cm — below this the wall tears
export const W_CRIT = 0.16;            // cm — danger zone
export const MAX_H = 46;               // cm — physical ceiling for a thrown pot

export const STAGE = {
  WEDGE: 'wedge',
  THROW: 'throw',
  LEATHER: 'leather',
  TRIM: 'trim',
  BISQUE: 'bisque',
  GLAZE: 'glaze',
  FIRE: 'fire',
  DONE: 'done',
};

/* ------------------------------------------------------------------ */

export class Clay {
  constructor(opts = {}) {
    this.seed = opts.seed ?? 12345;
    this.rng = makeRng(this.seed);
    this.stage = STAGE.THROW;

    this.ri = new Float32Array(NS);
    this.ro = new Float32Array(NS);
    this.V = new Float32Array(NS);
    this.m = new Float32Array(NS);       // moisture 0..1
    this.ox = new Float32Array(NS);      // off-centre offset, clay frame
    this.oz = new Float32Array(NS);
    this.ring = new Float32Array(NS);    // throwing-ring amplitude (cm)
    this.scar = new Float32Array(NS);    // accumulated damage 0..1
    this.stress = new Float32Array(NS);
    this.comp = new Float32Array(NS);    // compression / "trueness of wall"

    // derived
    this.dy = new Float32Array(NS);
    this.y = new Float32Array(NS + 1);
    this.A = new Float32Array(NS);
    this._tmp = new Float32Array(NS);

    this.height = 0;
    this.maxR = 0;
    this.shrink = 1;                     // cumulative linear shrinkage

    // history / telemetry used by scoring
    this.stats = {
      pulls: 0, collapses: 0, tears: 0, waterUsed: 0,
      maxHeight: 0, maxStress: 0, timeThrown: 0,
      wobbleIntegral: 0, ribbed: 0, trimmed: 0,
      startMass: 0, opened: false, centered: false,
    };
    this.dead = false;
    this.deadReason = '';

    this.reset(opts.mass ?? 1250, opts.wobble ?? 0.55);
  }

  /* ---------------- initialisation ---------------- */

  /** Fresh wedged mound of clay on the wheel head. */
  reset(massG, wobbleAmt = 0.55) {
    const rng = this.rng;
    const vol = massG / RHO;                       // cm^3
    // A squat dome: r(t) = R * sqrt(1 - 0.82 t^2)
    const H0 = Math.cbrt(vol) * 1.02;
    let shape = new Float32Array(NS);
    for (let i = 0; i < NS; i++) {
      const t = (i + 0.5) / NS;
      shape[i] = Math.sqrt(Math.max(0.02, 1 - 0.42 * t * t)) * (1 - 0.20 * Math.pow(t, 5));
    }
    // solve R so that sum(PI r^2 dy) = vol with dy = H0/NS
    let s = 0;
    const dy0 = H0 / NS;
    for (let i = 0; i < NS; i++) s += Math.PI * shape[i] * shape[i] * dy0;
    const R = Math.sqrt(vol / s);

    for (let i = 0; i < NS; i++) {
      this.ri[i] = 0;
      this.ro[i] = shape[i] * R;
      this.A[i] = Math.PI * this.ro[i] * this.ro[i];
      this.V[i] = this.A[i] * dy0;
      this.m[i] = 0.62 + rng.gauss() * 0.02;
      this.ring[i] = 0;
      this.scar[i] = 0;
      this.stress[i] = 0;
      this.comp[i] = 0.4;
    }

    // Wedging never leaves it perfectly true. A low-frequency lateral drift.
    const ph = rng() * TAU, ph2 = rng() * TAU;
    for (let i = 0; i < NS; i++) {
      const t = i / NS;
      const a = wobbleAmt * (0.35 + 0.65 * t);
      this.ox[i] = a * (0.7 * Math.sin(ph + t * 2.1) + 0.3 * Math.sin(ph2 + t * 5.3));
      this.oz[i] = a * (0.7 * Math.cos(ph * 1.3 + t * 1.7) + 0.3 * Math.cos(ph2 + t * 4.1));
    }

    this.stats.startMass = massG;
    this.dead = false;
    this.deadReason = '';
    this.derive();
  }

  /**
   * Build a body directly from a silhouette function rather than by
   * throwing it. Used for the menu backdrop and for standing finished
   * pieces back on the shelf.
   *
   * @param {(t:number)=>number} profileFn  radius as a fraction of the widest point
   */
  sculpt(profileFn, H, D, wall = 0.42, floorT = 0.7) {
    const dy = H / NS;
    const R = D * 0.5;
    const baseT = clamp(floorT / Math.max(1e-3, H), 0.008, 0.6);
    for (let i = 0; i < NS; i++) {
      const t = (i + 0.5) / NS;
      const ro = Math.max(0.12, profileFn(t) * R);
      let ri = 0;
      if (t > baseT) {
        const ease = smoothstep(baseT, baseT + 0.10, t);
        ri = Math.max(0, ro - wall) * ease;
      }
      this.ro[i] = ro;
      this.ri[i] = Math.min(ri, ro - 0.06);
      this.V[i] = Math.PI * (this.ro[i] ** 2 - this.ri[i] ** 2) * dy;
      this.m[i] = 0.5;
      this.scar[i] = 0;
      this.stress[i] = 0;
      this.ring[i] = 0.006 + 0.004 * Math.sin(i * 0.7);
      this.ox[i] = 0; this.oz[i] = 0;
      this.comp[i] = 0.8;
    }
    this.dead = false;
    this.derive();
    return this;
  }

  /* ---------------- derived quantities ---------------- */

  derive() {
    const { ri, ro, V, A, dy, y } = this;
    let acc = 0, maxR = 0;
    for (let i = 0; i < NS; i++) {
      // hard constraints
      if (ri[i] < 0) ri[i] = 0;
      if (ro[i] < ri[i] + 0.02) ro[i] = ri[i] + 0.02;
      const a = Math.PI * (ro[i] * ro[i] - ri[i] * ri[i]);
      A[i] = a;
      let h = V[i] / a;
      if (!isFinite(h)) h = 0.001;
      dy[i] = clamp(h, 0.0005, 4);
      y[i] = acc;
      acc += dy[i];
      if (ro[i] > maxR) maxR = ro[i];
    }
    y[NS] = acc;
    this.height = acc;
    this.maxR = maxR;
    if (acc > this.stats.maxHeight) this.stats.maxHeight = acc;
  }

  /** Height at the centre of section i. */
  ymid(i) { return (this.y[i] + this.y[i + 1]) * 0.5; }

  /** Nearest section index to a world height (cm). */
  sectionAt(h) {
    const { y } = this;
    if (h <= 0) return 0;
    if (h >= this.height) return NS - 1;
    let lo = 0, hi = NS - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (y[mid + 1] < h) lo = mid + 1; else hi = mid;
    }
    return lo;
  }

  /** Wall thickness of section i. */
  wall(i) { return this.ro[i] - this.ri[i]; }

  /**
   * Is there a real interior yet — a bore worth calling a pot, rather
   * than a thumbprint? Treating a tenth of a millimetre as "opened" let
   * the game move on to lifting while the piece was still a solid lump,
   * so every touch stretched it into a tower.
   */
  isOpen() {
    let n = 0;
    for (let i = 0; i < NS; i++) {
      if (this.ri[i] > 0.30 * this.ro[i] && this.ri[i] > 0.5) n++;
    }
    return n > NS * 0.22;
  }

  /** Index of the lowest section with an actual interior. */
  floorSection() {
    for (let i = 0; i < NS; i++) if (this.ri[i] > 0.012) return i;
    return NS;
  }

  /** Total clay mass in grams. */
  mass() {
    let v = 0;
    for (let i = 0; i < NS; i++) v += this.V[i];
    return v * RHO;
  }

  /** Mass sitting above section i, in grams. */
  massAbove(i) {
    let v = 0;
    for (let j = i + 1; j < NS; j++) v += this.V[j];
    return v * RHO;
  }

  /* ---------------- aggregate metrics for the HUD ---------------- */

  /**
   * Is section i part of the WALL, as opposed to the floor or the
   * shoulder where the floor turns into the wall? A wall has a real
   * interior: its inner radius is most of its outer radius. The
   * shoulder does not, and averaging it in makes a 3 mm wall read as
   * 27 mm — which quietly made "wall under 6 mm" impossible to satisfy.
   */
  isWall(i) {
    return this.ri[i] > 0.34 * this.ro[i] && this.ri[i] > 0.25;
  }

  metrics() {
    let minW = 99, meanW = 0, wob = 0, maxStress = 0, meanM = 0, n = 0;
    const f = this.floorSection();
    const wallIdx = [];
    for (let i = 0; i < NS; i++) {
      meanM += this.m[i];
      if (this.stress[i] > maxStress) maxStress = this.stress[i];
      const o = Math.hypot(this.ox[i], this.oz[i]);
      wob += o * (0.3 + 0.7 * (i / NS));
      if (i >= f && this.isWall(i)) {
        const w = this.wall(i);
        if (w < minW) minW = w;
        meanW += w; n++;
        wallIdx.push(i);
      }
    }
    if (n === 0) {
      // still a solid lump: report the lump
      minW = this.ro[0]; meanW = this.ro[0]; n = 1;
    }
    meanW /= n;
    wob /= NS;

    // Evenness over the wall's vertical run — the true mark of skill.
    // The lowest slice is skipped: the foot of a thrown pot is meant to
    // be heavier than its lip, and marking that down punishes good work.
    let varW = 0, nv = 0;
    const skip = Math.floor(wallIdx.length * 0.14);
    let evenMean = 0;
    for (let k = skip; k < wallIdx.length; k++) evenMean += this.wall(wallIdx[k]);
    evenMean /= Math.max(1, wallIdx.length - skip);
    for (let k = skip; k < wallIdx.length; k++) {
      varW += (this.wall(wallIdx[k]) - evenMean) ** 2; nv++;
    }
    varW = Math.sqrt(varW / Math.max(1, nv));

    return {
      minWall: minW,
      meanWall: meanW,
      wallEven: clamp01(1 - varW / Math.max(0.20, evenMean * 1.55)),
      wobble: wob,
      trueness: clamp01(1 - wob / 0.62),
      stress: maxStress,
      moisture: clamp01(meanM / NS),
      height: this.height,
      diameter: this.maxR * 2,
      mass: this.mass(),
      /* The clay's own thermal expansion, carried through to the firing.
         Every body in the game declares one — Blackhill 6.0, Ashstone
         6.4, Saltflat 6.6, Reach Porcelain 6.9 — and fire() was reading
         a flat 6.4 for all of them, so which clay a pot was thrown in
         made no difference whatever to whether its glaze crazed. That
         is the one property of a body a fired pot shows most plainly. */
      coe: this.bodyDef?.coe,
      opened: this.isOpen(),
    };
  }

  /* ==================================================================
     TOOLS
     Every tool receives a contact point in the meridian plane
     (tr = radius in cm, ty = height in cm), a pressure 0..1 and dt.
     ================================================================== */

  _kernel(ty, sigma) {
    // returns {i0,i1} range worth touching
    const i = this.sectionAt(ty);
    const span = Math.max(2, Math.ceil((sigma * 3) / Math.max(0.02, this.dy[i])));
    return { c: i, i0: Math.max(0, i - span), i1: Math.min(NS - 1, i + span) };
  }

  /** Shared bookkeeping: drag, friction, wobble injection. */
  _contact(i, press, dt, w) {
    const dry = clamp01((0.34 - this.m[i]) / 0.34);
    // dry clay grabs and knocks the pot off true
    const knock = dry * press * w * dt * 0.55;
    this.ox[i] += knock * (this.rng() - 0.5) * 2.2;
    this.oz[i] += knock * (this.rng() - 0.5) * 2.2;
    this.scar[i] = clamp01(this.scar[i] + dry * press * w * dt * 0.16);
    // working the clay uses up water
    this.m[i] = clamp01(this.m[i] - press * w * dt * 0.017);
    this.comp[i] = clamp01(this.comp[i] + press * w * dt * 0.55);
  }

  /** CENTRE — force the spinning mound onto the axis. */
  center(tr, ty, press, dt, omega) {
    const spin = clamp01(omega / 9);
    const k = this._kernel(ty, 3.4);
    let did = 0;
    for (let i = k.i0; i <= k.i1; i++) {
      const d = this.ymid(i) - ty;
      const w = gauss(d, 3.4);
      const rate = 3.4 * press * w * spin * dt;
      this.ox[i] -= this.ox[i] * clamp01(rate);
      this.oz[i] -= this.oz[i] * clamp01(rate);
      // coning also compacts and slightly narrows
      const target = lerp(this.ro[i], tr, clamp01(press * w * spin * dt * 1.1));
      this.ro[i] = lerp(this.ro[i], Math.max(0.6, target), 0.55);
      this.m[i] = clamp01(this.m[i] - press * w * dt * 0.02);
      this.comp[i] = clamp01(this.comp[i] + press * w * dt * 0.8);
      did += w;
    }
    // smooth the mound as it centres — without lengthening it
    this._smoothProfile(2, 0, clamp01(dt * 14));
    this.derive();
    if (this.metrics().trueness > 0.86) this.stats.centered = true;
    return did;
  }

  /** OPEN — drive the interior down and out from the top. */
  open(tr, ty, press, dt, omega) {
    const spin = clamp01(omega / 6);
    if (spin < 0.15) return 0;
    // Opening works downward from the rim: every section above the tool
    // gets its interior pushed toward tr.
    const floorY = Math.max(0.40, ty);
    let did = 0;
    let lowest = NS;
    for (let i = 0; i < NS; i++) {
      const ym = this.ymid(i);
      if (ym < floorY - 0.25) continue;
      if (i < lowest) lowest = i;
      const depth = clamp01((ym - floorY) / 1.6 + 0.25);
      const w = depth;
      const rate = clamp01(press * w * spin * dt * 2.2);
      const maxRi = Math.max(0, this.ro[i] - W_MIN * 3.4);
      const tgt = Math.min(tr, maxRi);
      if (tgt > this.ri[i]) {
        const ri0 = this.ri[i], ro0 = this.ro[i];
        const ri1 = lerp(ri0, tgt, rate);
        // Opening displaces clay outward, it does not thin the wall.
        // Hold the ring's cross-section (minus a little) so the pot gets
        // WIDER rather than taller — height is what pulling is for.
        const A = Math.max(0.02, ro0 * ro0 - ri0 * ri0);
        this.ri[i] = ri1;
        this.ro[i] = Math.sqrt(A + ri1 * ri1);
      }
      this._contact(i, press, dt, w);
      did += w;
    }
    this.stats.opened = true;
    // smoothing must not creep down into the floor, or the pot loses
    // its bottom without anyone noticing
    this._blurAbove(this.ri, lowest, 2);
    this.derive();
    return did;
  }

  /**
   * PULL — the lift. Squeeze the wall between inner and outer hand and
   * draw upward. Thinning the wall converts thickness into height.
   */
  pull(tr, ty, press, dt, omega, dragUp) {
    const spin = clamp01(omega / 6);
    if (spin < 0.12) return 0;
    const k = this._kernel(ty, 1.35);
    const up = clamp01(dragUp);
    const floor = this.floorSection();
    // A pot grows upward faster than a hand can travel, so a lift always
    // ends where the rim used to be. In life the clay above your fingers
    // is carried up with them; here it is too, with the effect falling
    // off above the hand. Without this every pot keeps a heavy collar
    // that there is no way to reach.
    const upper = ty > this.height - Math.max(3.5, this.height * 0.35);
    const i1 = upper ? NS - 1 : k.i1;
    const carry = Math.max(2.5, this.height * 0.42);
    let did = 0;
    for (let i = k.i0; i <= i1; i++) {
      if (i < floor) continue;              // that is the floor, not the wall
      const d = this.ymid(i) - ty;
      let w = gauss(d, 1.35);
      if (upper && d > 0) w = Math.max(w, 0.80 * Math.exp(-d / carry));
      if (w < 0.02) continue;
      const wall = this.wall(i);
      const plastic = this.plasticity(i);
      // A thick wall gives way to the hand far more readily than a thin
      // one, which is why squeezing to a fixed finger gap EVENS a wall
      // instead of running away with the thinnest part of it.
      if (this.tooTall && this.height > MAX_H) continue;   // it will not go higher
      const conv = clamp(wall / 0.30, 0.15, 6.0);
      // how hard we squeeze; upward drag is what actually lifts
      const rate = clamp01(press * w * spin * plastic * dt * (0.75 + 2.4 * up) * conv);
      const targetW = Math.max(W_MIN * 0.92, wall * (1 - 0.55 * rate));
      const mid = (this.ri[i] + this.ro[i]) * 0.5;
      // pulling also draws the wall slightly toward the tool radius
      const newMid = lerp(mid, tr, rate * 0.30);
      this.ri[i] = Math.max(0, newMid - targetW * 0.5);
      this.ro[i] = this.ri[i] + targetW;
      // fingers leave a spiral of throwing rings
      this.ring[i] = clamp(this.ring[i] + rate * 0.055, 0, 0.10);
      this._contact(i, press, dt, w);
      did += w;
    }
    this.stats.pulls += dt * up * press;
    this._smoothWall(1, floor, clamp01(dt * 20));
    this.derive();
    return did;
  }

  /** SHAPE — press from whichever side the tool is on. Belly out or collar in. */
  shape(tr, ty, press, dt, omega, fromInside) {
    const spin = clamp01(omega / 6);
    if (spin < 0.12) return 0;
    const k = this._kernel(ty, 1.9);
    const floor = this.floorSection();
    const atRim = ty > this.height - 2.2;
    const i1 = atRim ? NS - 1 : k.i1;
    const h0 = this._heightNow();
    // Collaring must never make the piece wider. Squeezing clay inward
    // thickens the wall, and smoothing spreads that thickness into the
    // neighbouring rings, so gathering a neck in could push the outside
    // outward — narrowing the pot showed on the gauges as widening it.
    let roWas = null;
    if (!fromInside) {
      roWas = this._roWas || (this._roWas = new Float32Array(NS));
      roWas.set(this.ro);
    }
    let did = 0;
    for (let i = k.i0; i <= i1; i++) {
      if (i < floor) continue;
      const d = this.ymid(i) - ty;
      let w = gauss(d, 1.9);
      if (atRim && d > 0) w = Math.max(w, 0.8);
      if (w < 0.02) continue;
      const wall = this.wall(i);
      const plastic = this.plasticity(i);
      // Bellying out has to be as strong a lever as lifting, or a pot
      // that has grown too tall can never be brought back down and the
      // only advice left is "start again".
      // A heavy wall needs help to move; a thin one must not be
      // PUNISHED for being thin. Scaling the response by thickness in
      // both directions meant widening throttled itself: every push out
      // thins the wall a little, which weakened the next push, which is
      // why it worked at first and then quietly stopped paying out.
      const conv = clamp(wall / 0.34, 1.0, 3.4);
      // Collaring compounds on itself — narrower means less cross-section,
      // which means taller, which means more wall left to collar. Half
      // strength keeps a stray inward drag from shooting the pot into a
      // tube, while still closing a neck over a few passes.
      const dir = fromInside ? 1 : 0.5;
      const rate = clamp01(press * w * spin * plastic * dt * 5.2 * conv * dir);

      // The WALL moves to where the hand is — the whole wall, carried
      // bodily outward or inward with its thickness intact.
      //
      // It used to drive the inner surface at the target and let the
      // outer one trail, so the step size included the full wall
      // thickness. On a thin wall the bore caught the outside up, the
      // ring collapsed to the minimum, and because height is volume
      // over cross-section the pot shot upward instead of widening.
      // That is why the deeper the hollow got, the sooner widening
      // turned into lifting.
      // `tr` is where the middle of the wall should end up. The hand
      // works out that number from how it is resting against the clay,
      // which is the only place that knows it.
      const mid = (this.ri[i] + this.ro[i]) * 0.5;
      let dr = (tr - mid) * rate;
      dr = fromInside ? Math.max(0, dr) : Math.min(0, dr);

      // The wall stretches around the circumference as it travels out
      // and gathers as it comes in, so its thickness follows the RADIUS
      // — not the number of frames the button was held. Shaving a fixed
      // fraction off per frame wore the wall away to nothing on a long
      // push, and with height being volume over cross-section the pot
      // then started climbing instead of spreading, which is exactly
      // what went wrong the deeper the hollow got.
      // The wall can never travel further than the hand did. Without
      // this the target is simply a position to chase, so a hand that
      // started out in mid air held a full lead from the first frame
      // and moved far more clay than one that started on the wall —
      // the same drag paying out differently depending on where you
      // happened to grab. Now only the length of the stroke counts.
      const reach = dt * DRAG_REF * 1.25 * w;
      dr = clamp(dr, -reach, reach);

      const m0 = Math.max(0.05, mid);
      const m2 = Math.max(0.05, mid + dr);
      let t2 = Math.max(W_MIN * 0.9, wall * clamp(Math.pow(m0 / m2, 0.6), 0.6, 1.7));
      // Gathering clay in thickens the wall, but collaring must not
      // push the OUTSIDE outward: squeezing a neck shut used to swell
      // the piece, so narrowing it read on the gauges as widening.
      if (dr < 0) t2 = Math.min(t2, Math.max(W_MIN * 0.9, 2 * (this.ro[i] - m2)));
      this.ri[i] = Math.max(0, m2 - t2 * 0.5);
      this.ro[i] = this.ri[i] + t2;
      this._contact(i, press, dt, w);
      did += w;
    }
    this._smoothWall(1, floor, clamp01(dt * 20));

    if (roWas) {
      for (let i = 0; i < NS; i++) {
        if (this.ro[i] > roWas[i]) {
          const t = this.ro[i] - this.ri[i];
          this.ro[i] = roWas[i];
          this.ri[i] = Math.max(0, this.ro[i] - t);
        }
      }
    }

    // Pushing the wall outward is never allowed to make the piece
    // taller. That is not so much a law of clay as the promise the
    // control makes to the player: drag outward, get wider. Any upward
    // creep left here is the simulation's own arithmetic, and it is
    // what turned widening into climbing once the wall got thin. The
    // clay has to go somewhere, so it goes where the hand asked — out.
    if (fromInside && did > 0 && h0 > 1e-4) {
      const h1 = this._heightNow();
      if (isFinite(h1) && h1 > h0 * 1.0005) {
        const g = clamp(Math.sqrt(h1 / h0), 1, 1.03);
        for (let i = 0; i < NS; i++) { this.ro[i] *= g; this.ri[i] *= g; }
      }
    }
    this.derive();
    return did;
  }

  /**
   * COMPRESS — the hand pushes down and the wall gathers under it.
   *
   * The exact inverse of a lift. Lifting stretches the wall thinner and
   * the piece grows; pressing down gathers it thicker and the piece
   * comes back down, because a ring holds a fixed amount of clay and
   * its height is that clay divided by its cross-section. Nothing is
   * added or taken away — it is the same clay, standing shorter.
   *
   * Without this the controls only ran one way. Every stroke a player
   * could make grew the pot or widened it; a piece that had gone too
   * tall could only be rescued by bellying it out, and if it was
   * already wide enough there was nothing left to do but start again.
   */
  compress(tr, ty, press, dt, omega) {
    const spin = clamp01(omega / 6);
    if (spin < 0.12) return 0;
    const k = this._kernel(ty, 1.35);
    const floor = this.floorSection();
    // Everything above the hand comes down with it, the same way
    // everything above a lift is carried up.
    const upper = ty > this.height - Math.max(3.5, this.height * 0.35);
    const i1 = upper ? NS - 1 : k.i1;
    const carry = Math.max(2.5, this.height * 0.42);
    let did = 0;
    for (let i = k.i0; i <= i1; i++) {
      if (i < floor) continue;
      const d = this.ymid(i) - ty;
      let w = gauss(d, 1.35);
      if (upper && d > 0) w = Math.max(w, 0.80 * Math.exp(-d / carry));
      if (w < 0.02) continue;
      const wall = this.wall(i);
      const plastic = this.plasticity(i);
      // A THIN wall gathers up under the hand readily, where a thick one
      // resists — the mirror of a thick wall giving way to a lift. So a
      // pot that has been drawn up too far is exactly the one that comes
      // back down most willingly.
      const conv = clamp(0.30 / Math.max(wall, 0.06), 0.15, 6.0);
      const rate = clamp01(press * w * spin * plastic * dt * 3.0 * conv);
      const mid = (this.ri[i] + this.ro[i]) * 0.5;
      const targetW = wall * (1 + 0.85 * rate);
      // pressing also draws the wall slightly toward the tool radius
      const newMid = lerp(mid, tr, rate * 0.22);
      this.ri[i] = Math.max(0, newMid - targetW * 0.5);
      this.ro[i] = this.ri[i] + targetW;
      // compressed clay is denser, and denser clay survives the fire
      this.comp[i] = clamp01(this.comp[i] + rate * 0.55);
      this.ring[i] = clamp(this.ring[i] + rate * 0.02, 0, 0.10);
      this._contact(i, press, dt, w);
      did += w;
    }
    this.stats.compressed = (this.stats.compressed || 0) + dt * press;
    this._smoothWall(1, floor, clamp01(dt * 20));
    this.derive();
    return did;
  }

  /**
   * Let the wall relax under the hand, in real time.
   *
   * Shaping smooths as it goes, but it is paid for in WORK — the
   * distance the hand travelled — because that is what drives the
   * shaping itself. Relaxing is not like that: a hand resting on
   * turning clay evens it out by being there, and how much it evens
   * depends on how long, not on how far it moved. Charging relaxation
   * at the work rate made it about eighteen times weaker than intended,
   * which is how a stroke could leave a crease a centimetre deep in a
   * single ring and nothing would take it out again.
   */
  settle(ty, press, dt) {
    if (press <= 0.02) return;
    this._smoothWall(1, this.floorSection(), clamp01(press * dt * 5.0));
    this.derive();
  }

  /** RIB — a wooden rib compresses and trues the surface. Kills rings. */
  rib(tr, ty, press, dt, omega) {
    const spin = clamp01(omega / 7);
    const k = this._kernel(ty, 2.4);
    let did = 0;
    for (let i = k.i0; i <= k.i1; i++) {
      const d = this.ymid(i) - ty;
      const w = gauss(d, 2.4);
      if (w < 0.02) continue;
      const rate = clamp01(press * w * spin * dt * 2.2);
      this.ring[i] *= 1 - rate * 0.9;
      this.ox[i] *= 1 - rate * 0.85;
      this.oz[i] *= 1 - rate * 0.85;
      this.scar[i] = clamp01(this.scar[i] - rate * 0.25);
      this.comp[i] = clamp01(this.comp[i] + rate * 0.7);
      this.m[i] = clamp01(this.m[i] - rate * 0.02);
      did += w;
    }
    // a rib is a straight edge — it averages the silhouette, but it must
    // neither smear the interior down through the floor nor grow the pot
    const floor = this.floorSection();
    this._smoothProfile(3, 0, clamp01(dt * 16));
    this._smoothWall(2, floor, clamp01(dt * 16));
    this.stats.ribbed += dt * press;
    this.derive();
    return did;
  }

  /** WATER — slip and lubrication. Too much and the wall goes to soup. */
  water(ty, press, dt) {
    const k = this._kernel(ty, 3.4);
    for (let i = k.i0; i <= k.i1; i++) {
      const d = this.ymid(i) - ty;
      const w = gauss(d, 3.4);
      // a sponge, not a hose: one second used to take it to soup
      this.m[i] = Math.min(0.82, this.m[i] + press * w * dt * 0.22);
    }
    this.stats.waterUsed += press * dt;
    return 1;
  }

  /** TRIM — leather-hard only. Cuts clay away from the outside. */
  trim(tr, ty, press, dt, omega) {
    const spin = clamp01(omega / 5);
    if (spin < 0.1) return 0;
    const k = this._kernel(ty, 0.85);
    let did = 0;
    for (let i = k.i0; i <= k.i1; i++) {
      const d = this.ymid(i) - ty;
      const w = gauss(d, 0.85);
      if (w < 0.02) continue;
      const rate = clamp01(press * w * spin * dt * 2.4);
      const tgt = Math.max(this.ri[i] + W_MIN * 1.15, Math.min(this.ro[i], tr));
      const before = Math.PI * (this.ro[i] ** 2 - this.ri[i] ** 2);
      this.ro[i] = lerp(this.ro[i], tgt, rate);
      const after = Math.PI * (this.ro[i] ** 2 - this.ri[i] ** 2);
      // trimming removes clay: shed the volume so height stays put
      this.V[i] *= after / Math.max(1e-6, before);
      this.ring[i] *= 1 - rate * 0.8;
      did += w;
    }
    this.stats.trimmed += dt * press;
    this._smoothProfile(1, 0, clamp01(dt * 14));
    this.derive();
    return did;
  }

  /**
   * NEEDLE — level the rim. Everything above the cut is sliced away,
   * which is what a potter does when the lip has gone uneven.
   */
  cutRim(ty) {
    const cut = clamp(ty, 0.6, this.height);
    let removed = 0;
    for (let i = NS - 1; i >= 0; i--) {
      const top = this.y[i + 1];
      const bot = this.y[i];
      if (bot >= cut) { removed += this.V[i]; this.V[i] = 1e-5; this.scar[i] = 0; }
      else if (top > cut) {
        const keep = (cut - bot) / Math.max(1e-5, top - bot);
        removed += this.V[i] * (1 - keep);
        this.V[i] *= keep;
      }
    }
    // redistribute the removed clay into the remaining wall, as a potter
    // would by wedging it back into the ball — here it just goes away
    this.derive();
    // collapse the emptied sections onto the new rim so the mesh stays sane
    let last = NS - 1;
    while (last > 2 && this.V[last] <= 2e-5) last--;
    for (let i = last + 1; i < NS; i++) {
      this.ri[i] = this.ri[last];
      this.ro[i] = this.ro[last];
      this.ring[i] = 0;
      this.ox[i] = this.ox[last];
      this.oz[i] = this.oz[last];
    }
    this.derive();
    return removed;
  }

  /** Height the body would have with its current radii. */
  _heightNow() {
    let acc = 0;
    for (let i = 0; i < NS; i++) {
      const a = Math.PI * (this.ro[i] * this.ro[i] - this.ri[i] * this.ri[i]);
      acc += Math.min(4, this.V[i] / Math.max(1e-3, a));   // same clamp derive() uses
    }
    return acc;
  }

  /**
   * Smooth the silhouette WITHOUT making the pot taller.
   *
   * Cross-section goes as the square of the radius, so blurring a
   * tapered profile always lowers the total area — and since height is
   * volume over area, every smoothing pass silently lengthened the
   * piece. Centring and ribbing both smooth every frame, so a hand
   * resting on the clay grew the pot upward for as long as it was
   * held, whatever the player was trying to do. Rescaling the radii
   * afterwards makes smoothing what it should be: a change of shape,
   * not a change of size.
   */
  /**
   * Smooth the wall without eroding it.
   *
   * Blurring the inner and outer radii as two separate curves does not
   * keep the distance between them: wherever the silhouette bends, one
   * side is pulled in further than the other, so every pass shaves a
   * little more off the thinnest ring. Over a long push that ground the
   * wall down to the tearing limit, and because height is volume over
   * cross-section the pot started climbing instead of spreading.
   * Smoothing the CENTRELINE and the THICKNESS separately cannot do
   * that — thickness is smoothed as its own quantity, never as a
   * leftover of two other numbers.
   */
  _smoothWall(radius, from, amount = 1) {
    const before = this._heightNow();
    const mid = this._smid || (this._smid = new Float32Array(NS));
    const th = this._sth || (this._sth = new Float32Array(NS));
    for (let i = 0; i < NS; i++) {
      mid[i] = (this.ro[i] + this.ri[i]) * 0.5;
      th[i] = this.ro[i] - this.ri[i];
    }
    this._blurAbove(mid, from, radius, amount);
    this._blurAbove(th, from, radius, amount);
    for (let i = Math.max(0, from); i < NS; i++) {
      const t = Math.max(W_MIN * 0.9, th[i]);
      this.ri[i] = Math.max(0, mid[i] - t * 0.5);
      this.ro[i] = this.ri[i] + t;
    }
    const after = this._heightNow();
    if (before > 1e-4 && after > 1e-4 && isFinite(before) && isFinite(after)) {
      // Put the height back by adjusting THICKNESS, not radius.
      //
      // Scaling the radii works too, but it is a lever on the
      // silhouette that runs on every frame of every stroke, so a small
      // consistent bias compounds. That is the mechanism that once
      // spread a teacup to a hundred and ninety metres, and a milder
      // version of it was still letting a drag carry the wall further
      // than the hand actually went. Cross-section goes as radius times
      // thickness, so thickness corrects it just as well — and cannot
      // inflate the silhouette.
      const f = clamp(after / before, 0.94, 1.06);
      if (f > 1.0002 || f < 0.9998) {
        for (let i = Math.max(0, from); i < NS; i++) {
          // A ring with no bore is SOLID and must stay solid. Rebuilding
          // it from a scaled thickness hands it an inner radius out of
          // nowhere, which bores a hole through the base of the pot —
          // and once the floor is gone the game stops being able to tell
          // floor from wall, works the base as though it were the side,
          // and the piece cannot be recovered at all. For solid clay the
          // cross-section goes as the square of the radius, so that is
          // what gets corrected.
          if (this.ri[i] <= 1e-4) {
            this.ro[i] = Math.max(W_MIN, this.ro[i] * Math.sqrt(f));
            continue;
          }
          const m = (this.ro[i] + this.ri[i]) * 0.5;
          const t = Math.max(W_MIN * 0.9, (this.ro[i] - this.ri[i]) * f);
          this.ri[i] = Math.max(0, m - t * 0.5);
          this.ro[i] = this.ri[i] + t;
        }
      }
    }
  }

  _smoothProfile(radius, from = 0, amount = 1) {
    const before = this._heightNow();
    this._blurAbove(this.ro, from, radius, amount);
    if (from > 0) this._blurAbove(this.ri, from, radius, amount);
    const after = this._heightNow();
    // The correction is a nudge and nothing more. If a ring's
    // cross-section has collapsed, _heightNow goes to infinity, and an
    // unclamped ratio scales every radius by a factor of a thousand —
    // which is exactly how a pot ended up a hundred and ninety metres
    // across.
    if (before > 1e-4 && after > 1e-4 && isFinite(before) && isFinite(after)) {
      // Corrected through THICKNESS, exactly as _smoothWall does and for
      // exactly the same reason. Scaling the radii is a lever on the
      // silhouette that runs on every frame of every stroke, and a hand
      // resting on an opened pot comes through here sixty times a
      // second: a steady hand — the one thing a player reaches for to
      // CALM a pot down — was inflating it from twenty-four centimetres
      // across to fifty-three, and deepening the kink while it went. On
      // a solid lump the two are the same operation anyway, because
      // there the wall IS the radius.
      const f = clamp(after / before, 0.94, 1.06);
      if (f > 1.0002 || f < 0.9998) {
        for (let i = Math.max(0, from); i < NS; i++) {
          // A ring with no bore is SOLID and must stay solid. Rebuilding
          // it from a scaled thickness hands it an inner radius out of
          // nowhere, which bores a hole through the base of the pot —
          // and once the floor is gone the game stops being able to tell
          // floor from wall, works the base as though it were the side,
          // and the piece cannot be recovered at all. For solid clay the
          // cross-section goes as the square of the radius, so that is
          // what gets corrected.
          if (this.ri[i] <= 1e-4) {
            this.ro[i] = Math.max(W_MIN, this.ro[i] * Math.sqrt(f));
            continue;
          }
          const m = (this.ro[i] + this.ri[i]) * 0.5;
          const t = Math.max(W_MIN * 0.9, (this.ro[i] - this.ri[i]) * f);
          this.ri[i] = Math.max(0, m - t * 0.5);
          this.ro[i] = this.ri[i] + t;
        }
      }
    }
  }

  /** Smooth an array from `from` upward, leaving the floor alone. */
  _blurAbove(arr, from, radius = 1, amount = 1) {
    const t = this._tmp3 || (this._tmp3 = new Float32Array(NS));
    const lo = Math.max(0, from);
    for (let i = lo; i < NS; i++) {
      let s = 0, c = 0;
      for (let k = -radius; k <= radius; k++) {
        let j = i + k;
        if (j < lo) j = lo;
        if (j >= NS) j = NS - 1;
        s += arr[j]; c++;
      }
      t[i] = s / c;
    }
    // Smoothing is a RATE, not an event. Replacing the profile with its
    // blur outright once per frame meant the very first frame of a
    // press — the one frame where the hand has no speed yet and so
    // counts as a steady rib — restructured the whole silhouette at
    // once. On a wide piece that reshaping alone lifted the pot by two
    // centimetres, which is why merely touching the clay made it grow.
    // It also made the simulation depend on the frame rate.
    if (amount >= 1) { for (let i = lo; i < NS; i++) arr[i] = t[i]; return; }
    for (let i = lo; i < NS; i++) arr[i] += (t[i] - arr[i]) * amount;
  }

  /**
   * Steady the wall without reshaping it: take the wobble out and
   * compact the clay, but leave the silhouette alone. This is what a
   * hand resting on a turning pot does. Coning — squeezing the lump
   * narrower and therefore taller — is work, and work needs movement;
   * doing it on dwell meant a hand left on the clay grew the piece
   * upward for as long as it sat there.
   */
  trueUp(ty, press, dt, omega, sigma = 3.4) {
    const spin = clamp01(omega / 7);
    if (spin < 0.05) return 0;
    const k = this._kernel(ty, sigma);
    let did = 0;
    for (let i = k.i0; i <= k.i1; i++) {
      const w = gauss(this.ymid(i) - ty, sigma);
      if (w < 0.02) continue;
      const rate = clamp01(press * w * spin * dt * 2.6);
      this.ox[i] *= 1 - rate * 0.85;
      this.oz[i] *= 1 - rate * 0.85;
      this.comp[i] = clamp01(this.comp[i] + rate * 0.5);
      did += w;
    }
    return did;
  }

  /** Knock the wall sideways — an unsteady hand, or a catch. */
  nudge(ty, amount, sigma = 2.0) {
    if (amount <= 0) return;
    const k = this._kernel(ty, sigma);
    const ax = (this.rng() - 0.5) * 2, az = (this.rng() - 0.5) * 2;
    for (let i = k.i0; i <= k.i1; i++) {
      const w = gauss(this.ymid(i) - ty, sigma);
      this.ox[i] += ax * amount * w;
      this.oz[i] += az * amount * w;
    }
  }

  /** Plasticity: how readily the clay moves under the hand. */
  plasticity(i) {
    const m = this.m[i];
    // peak workability around 0.55; stiff when dry, slack when sodden
    return clamp(0.15 + 1.5 * Math.exp(-((m - 0.58) ** 2) / (2 * 0.19 ** 2)), 0.12, 1.0);
  }

  /** Yield strength (arbitrary but consistent units) at section i. */
  yieldStrength(i) {
    const m = this.m[i];
    // dry clay is strong, wet clay is weak; damage weakens it further
    const base = 2.3e5 * (1.28 - m) ** 1.55;
    return Math.max(1.4e4, base * (1 - 0.72 * this.scar[i]) * (0.72 + 0.5 * this.comp[i]));
  }

  /* ==================================================================
     PASSIVE PHYSICS — runs every frame
     ================================================================== */

  step(dt, omega, ambient = {}) {
    if (this.dead) return;
    const dry = ambient.dryRate ?? 1;
    const isWet = this.stage === STAGE.THROW;
    this.stats.timeThrown += dt;

    const f = this.floorSection();
    let collapse = 0;

    // --- moisture loss -------------------------------------------------
    if (isWet) {
      const evap = (0.0011 + 0.00052 * omega) * dry * dt;
      for (let i = 0; i < NS; i++) {
        // thin exposed walls dry faster
        const expose = 1 + 0.9 * clamp01(0.5 - this.wall(i)) + 0.35 * (i / NS);
        this.m[i] = clamp01(this.m[i] - evap * expose);
      }
      blur1(this.m, 2, 1, this._tmp);
    }

    // --- stress, slump, tearing ---------------------------------------
    let above = 0;
    const massArr = this._tmp;
    for (let i = NS - 1; i >= 0; i--) { massArr[i] = above; above += this.V[i] * RHO; }

    for (let i = 0; i < NS; i++) {
      const w = Math.max(1e-3, this.wall(i));
      const rc = (this.ri[i] + this.ro[i]) * 0.5;
      const circ = TAU * rc;
      const sigG = (massArr[i] * G) / Math.max(1e-3, circ * w);        // column weight
      const sigC = RHO * omega * omega * rc * rc * (0.28 + 0.9 * (i / NS)) *
        (0.35 / Math.max(0.08, w));                                     // hoop
      const Y = this.yieldStrength(i);
      const s = (sigG + sigC) / Y;
      this.stress[i] = s;
      if (s > this.stats.maxStress) this.stats.maxStress = s;

      if (!isWet) continue;

      if (s > 1) {
        const over = Math.min(3.5, s - 1);
        const rate = clamp01(over * dt * 1.5);
        // Plastic flow: the wall bulges and slumps, offset amplifies.
        // The outward step is capped because hoop stress goes as the
        // square of the radius, so an uncapped slump feeds itself —
        // wider means more load means wider still — and a pot could
        // spread to a hundred metres across in a few seconds.
        this.ro[i] += Math.min(rate * 0.30 * w, 0.018);
        this.ri[i] -= Math.min(rate * 0.05 * w, 0.004);
        if (this.ri[i] < 0) this.ri[i] = 0;
        this.ox[i] *= 1 + rate * 1.6;
        this.oz[i] *= 1 + rate * 1.6;
        this.scar[i] = clamp01(this.scar[i] + rate * 0.30);
        collapse += over * dt;
      }

      // --- tearing --------------------------------------------------
      if (i >= f && w < W_CRIT) {
        const t = (W_CRIT - w) / W_CRIT;
        this.scar[i] = clamp01(this.scar[i] + t * t * dt * (0.35 + 0.4 * omega / 10));
      }
      if (i >= f && w < W_MIN) {
        this.scar[i] = 1;
        this.stats.tears += dt;
      }
    }

    // --- wobble dynamics ----------------------------------------------
    if (isWet && omega > 0.4) {
      // A pot that is running true stays true. This used to compound at
      // about fourteen percent a second no matter what the player did,
      // so any piece left on the wheel for half a minute bent itself
      // into a hook and there was nothing to be done about it.
      const grow = (ambient.forgiving === true ? 0 : 0.035) * clamp01(omega / 12) * dt;
      for (let i = 0; i < NS; i++) {
        const o = Math.hypot(this.ox[i], this.oz[i]);
        if (grow > 0 && o > 0.25) {
          const amp = 1 + grow * clamp01((o - 0.25) / 0.9) * (0.4 + 0.6 * (i / NS));
          this.ox[i] *= amp;
          this.oz[i] *= amp;
        }
        this.stats.wobbleIntegral += o * dt * 0.02;
      }
      // wobble propagates upward through the wall
      const t2 = this._tmp2 || (this._tmp2 = new Float32Array(NS));
      blur1(this.ox, 2, 1, t2);
      blur1(this.oz, 2, 1, t2);
    }

    // --- catastrophic failure ------------------------------------------
    if (isWet) {
      const forgiving = ambient.forgiving === true;
      this.tooTall = this.height > MAX_H * (forgiving ? 0.92 : 1);
      if (collapse > (forgiving ? 1.7 : 0.9)) {
        this.kill('The wall let go. The whole thing came down in a spiral.');
      }
      let torn = 0;
      for (let i = f; i < NS; i++) if (this.scar[i] > 0.985 && this.wall(i) < W_MIN) torn++;
      if (torn > (forgiving ? 12 : 5)) {
        this.kill('The wall tore through. Water found the hole and the rest followed.');
      }
      // With the assist on, a pot that is getting away from you stops
      // growing and says so, rather than folding up without warning.
      if (this.height > MAX_H && !forgiving) {
        this.kill('It grew past what wet clay can hold and folded on itself.');
      }
      // Nothing thrown from a few kilos of clay is half a metre across.
      // If it has got there it has left the wheel head.
      if (this.maxR > 26) {
        this.kill('It spread out under the speed and went off the wheel head in one piece.');
      }
      const met = this.metrics();
      if (met.wobble > (forgiving ? 3.2 : 1.9)) {
        this.kill('It walked off the wheel head. Nothing true was ever going to come of it.');
      }
    }

    this.derive();
  }

  kill(reason) {
    if (this.dead) return;
    this.dead = true;
    this.deadReason = reason;
    this.stats.collapses++;
  }

  /* ==================================================================
     STAGE TRANSITIONS
     ================================================================== */

  /** Dry to leather-hard: ~5% linear shrinkage, moisture drops. */
  toLeather() {
    this.applyShrink(0.952);
    for (let i = 0; i < NS; i++) this.m[i] = 0.28 + this.rng() * 0.02;
    this.stage = STAGE.LEATHER;
  }

  /** Bisque firing: another ~4% and the body is now rigid and porous. */
  toBisque() {
    this.applyShrink(0.963);
    for (let i = 0; i < NS; i++) this.m[i] = 0.02;
    this.stage = STAGE.BISQUE;
  }

  /** Glaze firing: vitrification, ~5% more. */
  toVitrified() {
    this.applyShrink(0.951);
    this.stage = STAGE.DONE;
  }

  applyShrink(k) {
    for (let i = 0; i < NS; i++) {
      this.ri[i] *= k;
      this.ro[i] *= k;
      this.ring[i] *= k;
      this.ox[i] *= k;
      this.oz[i] *= k;
      this.V[i] *= k * k * k;
    }
    this.shrink *= k;
    this.derive();
  }

  /* ==================================================================
     UNDO
     ================================================================== */

  saveState() {
    return {
      ri: this.ri.slice(), ro: this.ro.slice(), V: this.V.slice(),
      m: this.m.slice(), ox: this.ox.slice(), oz: this.oz.slice(),
      ring: this.ring.slice(), scar: this.scar.slice(), comp: this.comp.slice(),
      dead: this.dead, deadReason: this.deadReason,
    };
  }

  loadState(s) {
    if (!s) return false;
    this.ri.set(s.ri); this.ro.set(s.ro); this.V.set(s.V);
    this.m.set(s.m); this.ox.set(s.ox); this.oz.set(s.oz);
    this.ring.set(s.ring); this.scar.set(s.scar); this.comp.set(s.comp);
    this.dead = s.dead; this.deadReason = s.deadReason;
    this.stress.fill(0);
    this.derive();
    return true;
  }

  /* ==================================================================
     SERIALISATION (for the gallery)
     ================================================================== */

  snapshot() {
    return {
      ri: Array.from(this.ri, (v) => +v.toFixed(4)),
      ro: Array.from(this.ro, (v) => +v.toFixed(4)),
      dy: Array.from(this.dy, (v) => +v.toFixed(4)),
      ring: Array.from(this.ring, (v) => +v.toFixed(4)),
      ox: Array.from(this.ox, (v) => +v.toFixed(4)),
      oz: Array.from(this.oz, (v) => +v.toFixed(4)),
      h: this.height,
      r: this.maxR,
    };
  }

  static fromSnapshot(s) {
    const c = new Clay({ mass: 900 });
    for (let i = 0; i < NS; i++) {
      c.ri[i] = s.ri[i]; c.ro[i] = s.ro[i]; c.ring[i] = s.ring[i] || 0;
      c.ox[i] = s.ox?.[i] || 0; c.oz[i] = s.oz?.[i] || 0;
      c.V[i] = Math.PI * (c.ro[i] ** 2 - c.ri[i] ** 2) * (s.dy[i] || 0.01);
      c.m[i] = 0; c.scar[i] = 0;
    }
    c.stage = STAGE.DONE;
    c.derive();
    return c;
  }
}
