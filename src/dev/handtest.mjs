// ============================================================
//  Bench for the hand controls.
//
//  Mirrors exactly what Game._updateThrow does to the clay, so the
//  question "can a person who is not precise make a pot with this?"
//  can be answered without a GPU.
//
//  Run:  node src/dev/handtest.mjs
// ============================================================

import { Clay, NS } from '../sim/clay.js';
import { clamp, clamp01 } from '../core/util.js';

const DT = 1 / 60;
const REF = 22.0;          // cm of drag = one second of hand-work
const FPS_PER_CM = 1 / 12; // a hand moves ~12 cm/s across the screen

/** Radii of the wall at a height, straight off the section array. */
function radiiAt(c, y) {
  const i = c.sectionAt(clamp(y, 0, Math.max(0.01, c.height - 1e-4)));
  return { ro: c.ro[i], ri: c.ri[i] };
}

/**
 * Drag the hand from (r0,y0) to (r1,y1) over `secs` seconds, applying
 * exactly the rules in Game._updateThrow.
 */
function drag(c, r0, y0, r1, y1, secs, omega = 8.4, opts = {}) {
  const frames = Math.max(2, Math.round(secs / DT));
  let pr = r0, py = y0;
  let grabSide = null;
  let press = 0, velR = 0, velY = 0;

  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1);
    const r = r0 + (r1 - r0) * t;
    const y = y0 + (y1 - y0) * t;
    press = press + (1 - press) * (1 - Math.exp(-12 * DT));

    const { ro, ri } = radiiAt(c, y);
    const mid = (ro + ri) * 0.5;
    const opened = c.floorSection() < NS;
    if (grabSide === null) grabSide = r < mid;

    const contact = clamp01(
      smooth(ro + 5.0, ro + 5.0 * 0.35, r) *
      smooth(-1.2, -0.2, y) * smooth(c.height + 3.0, c.height + 0.6, y)
    );
    const p = press * contact;

    velR = velR + ((r - pr) / DT - velR) * (1 - Math.exp(-13 * DT));
    velY = velY + ((y - py) / DT - velY) * (1 - Math.exp(-13 * DT));
    const dR = velR * DT, dY = velY * DT;
    const dwell = DT * 0.30;

    if (p > 0.02 && !c.dead) {
      let intent;
      if (!opened) {
        intent = (r < Math.max(1.8, ro * 0.62) && y > c.height * 0.42) ? 'open' : 'centre';
      } else {
        const fl = Math.min(NS - 1, c.floorSection());
        intent = (y < c.y[fl] + 0.4 && r < ri + 0.9) ? 'open' : 'shape';
      }
      if (opts.force) intent = opts.force;

      if (intent === 'centre') {
        c.center(clamp(r, 0.8, ro + 1.5), y, p, dwell + Math.hypot(dR, dY) / REF, omega);
      } else if (intent === 'open') {
        c.open(clamp(r, 0, Math.max(0.4, ro - 0.45)), Math.max(0.45, y), p,
          dwell + (Math.max(0, -dY) + Math.max(0, dR)) / REF, omega);
      } else {
        const wUp = Math.max(0, dY) / REF;
        const wOut = Math.max(0, dR) / REF;
        const wIn = Math.max(0, -dR) / REF;
        if (wUp > 1e-5) c.pull(clamp(r, mid - 1.3, mid + 1.3), y, p, wUp + dwell * 0.4, omega, 1);
        const shapeR = clamp(r, mid - 1.2, mid + 1.2);
        if (wOut > 1e-5) c.shape(shapeR, y, p, wOut, omega, true);
        if (wIn > 1e-5) c.shape(shapeR, y, p, wIn, omega, false);
        if (wUp + wOut + wIn < 1e-5) c.rib(r, y, p * 0.5, dwell, omega);
      }
    }
    c.step(DT, omega, { dryRate: 0.34 });
    pr = r; py = y;
    if (c.dead) break;
  }
}

function smooth(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
}

const show = (label, c) => {
  const m = c.metrics();
  console.log(
    `${label.padEnd(22)} H=${m.height.toFixed(1).padStart(5)}cm  ` +
    `D=${m.diameter.toFixed(1).padStart(5)}cm  ` +
    `wall=${m.meanWall.toFixed(2)}  min=${m.minWall.toFixed(2)}  ` +
    `even=${m.wallEven.toFixed(2)}  true=${m.trueness.toFixed(2)}  ` +
    `open=${m.opened ? 'y' : 'n'}${c.dead ? '  DEAD: ' + c.deadReason : ''}`
  );
};

/* ================================================================== */

console.log('\n--- A CARELESS BEGINNER: sloppy strokes, no precision -------------\n');
{
  const c = new Clay({ mass: 900, seed: 11, wobble: 0.6 });
  show('fresh ball', c);

  // three loose up-and-down strokes down the side, nowhere near exact
  for (let i = 0; i < 3; i++) {
    drag(c, 5.2, 1.0, 3.4, 7.0, 0.55);
    drag(c, 3.4, 7.0, 5.2, 1.0, 0.55);
  }
  show('after centring', c);

  // press the middle of the top and drag down then out
  drag(c, 0.6, c.height * 0.9, 0.9, 1.3, 0.5);
  drag(c, 0.9, 1.3, 4.2, 1.5, 0.7);
  show('after opening', c);

  // three unhurried lifts, hand roughly on the wall
  for (let i = 0; i < 3; i++) {
    const { ro, ri } = radiiAt(c, 2);
    drag(c, (ro + ri) * 0.5, 1.2, (ro + ri) * 0.5, Math.max(4, c.height * 0.95), 1.4);
    show(`after lift ${i + 1}`, c);
    if (c.dead) break;
  }

  // belly it out from inside
  for (let i = 0; i < 2; i++) {
    const { ri } = radiiAt(c, c.height * 0.4);
    drag(c, ri - 0.2, 1.6, ri + 1.6, c.height * 0.85, 1.0);
  }
  show('after bellying', c);
}

console.log('\n--- BELLYING: a purely sideways drag from inside -------------------\n');
{
  const c = new Clay({ mass: 1100, seed: 44, wobble: 0.4 });
  for (let i = 0; i < 3; i++) { drag(c, 5.2, 1.0, 3.4, 7.0, 0.55); drag(c, 3.4, 7.0, 5.2, 1.0, 0.55); }
  drag(c, 0.6, c.height * 0.9, 0.9, 1.3, 0.5);
  drag(c, 0.9, 1.3, 4.4, 1.5, 0.7);
  const { ro, ri } = radiiAt(c, 2);
  drag(c, (ro + ri) * 0.5, 1.2, (ro + ri) * 0.5, Math.max(4, c.height * 0.95), 1.4);
  show('lifted', c);
  // hand inside, straight out, at four heights
  for (let pass = 0; pass < 4; pass++) {
    for (const hf of [0.30, 0.50, 0.70]) {
      const y = c.height * hf;
      const rr = radiiAt(c, y);
      drag(c, rr.ri - 0.1, y, rr.ri + 1.5, y, 0.6);
    }
  }
  show('after bellying out', c);
  // then collar the neck in from outside
  for (let pass = 0; pass < 3; pass++) {
    const y = c.height * 0.9;
    const rr = radiiAt(c, y);
    drag(c, rr.ro + 0.4, y, rr.ro - 1.2, y, 0.6);
  }
  show('after collaring', c);
}

console.log('\n--- SPEED INDEPENDENCE: same path, 4x slower ----------------------\n');
{
  const mk = () => {
    const c = new Clay({ mass: 900, seed: 22, wobble: 0.4 });
    for (let i = 0; i < 3; i++) { drag(c, 5.2, 1.0, 3.4, 7.0, 0.55); drag(c, 3.4, 7.0, 5.2, 1.0, 0.55); }
    drag(c, 0.6, c.height * 0.9, 0.9, 1.3, 0.5);
    drag(c, 0.9, 1.3, 4.2, 1.5, 0.7);
    return c;
  };
  const fast = mk(), slow = mk();
  const { ro: fro, ri: fri } = radiiAt(fast, 2);
  drag(fast, (fro + fri) * 0.5, 1.2, (fro + fri) * 0.5, Math.max(4, fast.height * 0.95), 0.5);
  const { ro: sro, ri: sri } = radiiAt(slow, 2);
  drag(slow, (sro + sri) * 0.5, 1.2, (sro + sri) * 0.5, Math.max(4, slow.height * 0.95), 2.0);
  show('one lift, 0.5s', fast);
  show('one lift, 2.0s', slow);
  const dh = Math.abs(fast.height - slow.height) / Math.max(1, fast.height);
  console.log(`\n  height difference: ${(dh * 100).toFixed(1)}%  ` +
    `${dh < 0.12 ? 'OK — speed does not matter' : 'FAIL — still speed dependent'}`);
}

console.log('\n--- AIM TOLERANCE: hand off the wall by 0, 1, 2, 3 cm -------------\n');
{
  for (const off of [0, 1, 2, 3]) {
    const c = new Clay({ mass: 900, seed: 33, wobble: 0.4 });
    for (let i = 0; i < 3; i++) { drag(c, 5.2, 1.0, 3.4, 7.0, 0.55); drag(c, 3.4, 7.0, 5.2, 1.0, 0.55); }
    drag(c, 0.6, c.height * 0.9, 0.9, 1.3, 0.5);
    drag(c, 0.9, 1.3, 4.2, 1.5, 0.7);
    const h0 = c.height;
    const { ro, ri } = radiiAt(c, 2);
    const mid = (ro + ri) * 0.5;
    drag(c, mid + off, 1.2, mid + off, Math.max(4, c.height * 0.95), 1.2);
    show(`off by ${off} cm`, c);
    console.log(`${''.padEnd(22)} lift = +${(c.height - h0).toFixed(1)} cm`);
  }
}

console.log('');

/* ================================================================== */
console.log('\n--- CAN A PLAYER ACTUALLY HIT COMMISSION 1? -----------------------');
console.log('    "A Cup, 8-14 cm tall, mean wall under 0.62 cm"\n');
{
  const { COMMISSIONS, FORMS } = await import('../game/lore.js');
  const { appraise } = await import('../game/scoring.js');
  const com = COMMISSIONS[0];
  const req = com.require;

  const c = new Clay({ mass: 500, seed: 55, wobble: 0.5 });

  // centre
  for (let i = 0; i < 3; i++) { drag(c, 4.4, 0.8, 2.6, 5.4, 0.55); drag(c, 2.6, 5.4, 4.4, 0.8, 0.55); }
  // open
  drag(c, 0.5, c.height * 0.9, 0.8, 1.1, 0.5);
  drag(c, 0.8, 1.1, 3.0, 1.3, 0.7);
  show('opened', c);

  // lift until the coach would stop asking for height
  for (let i = 0; i < 6; i++) {
    const m = c.metrics();
    if (m.meanWall <= req.maxWall && m.height >= req.minH) break;
    const rr = radiiAt(c, 2);
    drag(c, (rr.ro + rr.ri) * 0.5, 1.0, (rr.ro + rr.ri) * 0.5, Math.max(3.5, c.height * 0.95), 1.2);
    show(`lift ${i + 1}`, c);
    if (c.dead) break;
  }

  // too tall? widen from inside until the height comes back into range
  for (let i = 0; i < 8 && c.height > req.maxH; i++) {
    for (const hf of [0.35, 0.6, 0.85]) {
      const y = c.height * hf;
      const rr = radiiAt(c, y);
      drag(c, rr.ri - 0.1, y, rr.ri + 1.1, y, 0.5);
    }
    show(`widen ${i + 1}`, c);
    if (c.dead) break;
  }

  const m = c.metrics();
  show('FINAL', c);
  console.log('');
  const ok = (b) => (b ? 'MET    ' : 'missed ');
  console.log(`  ${ok(m.height >= req.minH)} at least ${req.minH} cm tall      -> ${m.height.toFixed(1)}`);
  console.log(`  ${ok(m.height <= req.maxH)} no taller than ${req.maxH} cm     -> ${m.height.toFixed(1)}`);
  console.log(`  ${ok(m.meanWall <= req.maxWall)} wall under ${req.maxWall} cm         -> ${m.meanWall.toFixed(2)}`);

  const rep = appraise({
    clay: c, commission: com,
    glazeStats: { totalCoverage: 0.86, evenness: 0.8, footClean: 1, meanThick: [0.13, 0, 0], slotIds: ['ash', null, null] },
    fireResult: { maturity: 0.85, defects: [], notes: [], destroyed: false, crystal: 0, oilspot: 0, hare: 0, opal: 0, metal: 0, peel: 0, carbon: 0, craze: 0.2, title: 'Even and quiet' },
    schedule: { peak: 1275, reduction: 0.2, cooling: 'normal' },
  });
  console.log(`\n  graded ${rep.total}/100  (${rep.grade.g} ${rep.grade.name})   ` +
    rep.rows.map((r) => `${r.k}=${r.v}`).join('  '));
}
console.log('');
