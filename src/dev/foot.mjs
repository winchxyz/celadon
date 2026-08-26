// ============================================================
//  Can you touch the bottom of the pot?
//
//  Reported from an iPad: "the bottom of the clay just cannot be
//  widened or narrowed". It was two faults on top of each other, and
//  the first one hid behind the second.
//
//  Below the floor a section is not a wall, it is solid clay — ri is 0
//  and ro is the whole radius — so the midpoint between them lands
//  halfway to the axis. radiiAt handed that back as "the wall you are
//  resting on", and shape() carries the wall's middle TO where the hand
//  asks, so a push outward was given a target two centimetres BEHIND
//  the wall that was actually there. dr = max(0, target - mid) is then
//  zero: bellying the foot out did nothing at all. Collaring it in takes
//  min(0, ...), so that direction worked perfectly, which is why the
//  fault read as "the bottom is stuck" rather than as a dead control.
//
//  And underneath that, shape() skipped every sub-floor section, so the
//  bottom centimetre of every pot was a stub of fixed diameter while the
//  wall above it flared from 4.1 cm to 6.5 under the same drag.
//
//  Run:  node src/dev/foot.mjs
// ============================================================
import { Clay } from '../sim/clay.js';
import { FORMS } from '../game/lore.js';
import { radiiAt } from '../sim/hand.js';

let bad = 0;
const NL = String.fromCharCode(10);
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };

console.log(NL + '  CAN YOU TOUCH THE BOTTOM OF THE POT?' + NL);

/* The cup from the first commission, at the size the screenshot showed. */
const fresh = () => {
  const c = new Clay({ mass: 500, seed: 7 });
  c.sculpt(FORMS.cup.profile, 9.7, 10.1, 0.68, 0.7);
  c.derive();
  return c;
};
const NS = fresh().ro.length;
const DT = 1 / 60, REF = 2.6;

/** A steady sideways stroke at one height, driven the way hand.js drives it. */
const stroke = (ty, dir, frames = 40) => {
  const c = fresh();
  const before = [...c.ro];
  const { ro, ri } = radiiAt(c, ty);
  const mid = (ro + ri) * 0.5;
  let carry = mid;
  for (let n = 0; n < frames; n++) {
    const dR = dir * 0.045;
    carry = Math.max(mid - 1.6, Math.min(mid + 1.6, carry + dR));
    c.shape(carry, ty, 1, Math.abs(dR) / REF * 26, 8, dir > 0);
    c.step(DT, 8, { dryRate: 0.34 });
  }
  const rAt = (h) => { const i = Math.round(h / c.height * (NS - 1)); return [before[i], c.ro[i]]; };
  let moved = 0;
  for (let k = 0; k < NS; k++) moved += Math.abs(c.ro[k] - before[k]);
  return { moved, rAt, c };
};

/* ---- 1. the foot is not frozen ------------------------------------- */
{
  const s = stroke(0.4, +1);
  const [was, now] = s.rAt(0.3);
  console.log(`         a stroke outward at 0.4 cm takes the base from ${was.toFixed(2)} to ${now.toFixed(2)} cm`);
  ok(now > was + 0.1,
     `the bottom of the pot answers a sideways stroke (${was.toFixed(2)} -> ${now.toFixed(2)} cm)`);

  const t = stroke(0.4, -1);
  const [w2, n2] = t.rAt(0.3);
  ok(n2 < w2 - 0.02, `and answers it in the other direction too (${w2.toFixed(2)} -> ${n2.toFixed(2)} cm)`);
}

/* ---- 2. both directions work, low down ----------------------------- */
{
  // The whole shape of the bug: one direction worked and the other did
  // not, at the same height, with the same drag.
  const LOW = 0.5;
  const out = stroke(LOW, +1).moved;
  const inn = stroke(LOW, -1).moved;
  console.log(`         at ${LOW} cm: outward moves ${out.toFixed(1)}, inward ${inn.toFixed(1)}`);
  ok(out > inn * 0.2,
     `bellying out low down is not a dead control next to collaring in ` +
     `(${out.toFixed(1)} against ${inn.toFixed(1)})`);
}

/* ---- 3. and it is not wildly weaker than the same stroke up the wall */
{
  const low = stroke(0.5, +1).moved;
  const high = stroke(2.9, +1).moved;
  console.log(`         the same stroke moves ${low.toFixed(1)} at 0.5 cm and ${high.toFixed(1)} at 2.9 cm`);
  ok(low > high * 0.12,
     `the bottom of the pot is worth touching (${low.toFixed(1)} against ${high.toFixed(1)} up the wall)`);
}

/* ---- 4. the clay is still conserved --------------------------------- */
{
  // dy = V / A, so spreading a base makes it shallower rather than
  // making clay out of nothing. If that ever stops being true, a player
  // can widen their way to a bigger pot.
  const c = fresh();
  const m0 = c.mass();
  const { ro, ri } = radiiAt(c, 0.5);
  let carry = (ro + ri) * 0.5;
  for (let n = 0; n < 120; n++) {
    carry += 0.045;
    c.shape(carry, 0.5, 1, 0.45, 8, true);
    c.step(DT, 8, { dryRate: 0.34 });
  }
  const m1 = c.mass();
  console.log(`         120 frames of spreading the foot: ${m0.toFixed(0)} g -> ${m1.toFixed(0)} g`);
  ok(Math.abs(m1 - m0) < m0 * 0.02,
     `spreading the foot does not create clay (${m0.toFixed(0)} g -> ${m1.toFixed(0)} g)`);
}

/* ---- 5. and the base still stands ----------------------------------- */
{
  const c = fresh();
  const { ro, ri } = radiiAt(c, 0.4);
  let carry = (ro + ri) * 0.5;
  for (let n = 0; n < 200; n++) {
    carry += 0.05;
    c.shape(carry, 0.4, 1, 0.45, 8, true);
    c.step(DT, 8, { dryRate: 0.34 });
  }
  const floor = c.floorSection();
  const bored = floor === 0 || c.ri[0] > 0.02;
  ok(!bored, 'spreading it does not punch a hole through the bottom');
  ok(!c.dead, `and does not destroy the pot${c.dead ? ' (' + c.deadReason + ')' : ''}`);

  // and the same held the other way, which is a potter undercutting a
  // foot and is the easier of the two to overdo
  const d = fresh();
  const r2 = radiiAt(d, 0.4);
  let hold = (r2.ro + r2.ri) * 0.5;
  for (let n = 0; n < 200; n++) {
    hold -= 0.05;
    d.shape(hold, 0.4, 1, 0.45, 8, false);
    d.step(DT, 8, { dryRate: 0.34 });
  }
  const sane = [...d.ro, ...d.ri, d.height].every((v) => isFinite(v) && v >= 0);
  console.log(`         200 frames of cutting it back in: ${d.mass().toFixed(0)} g, ` +
              `${d.height.toFixed(1)} cm tall${d.dead ? ', destroyed: ' + d.deadReason : ''}`);
  ok(sane, 'and cutting the foot back in leaves the geometry finite and positive');
}

console.log(bad ? NL + `  ${bad} FAILED` + NL : NL + '  the whole pot is reachable' + NL);
process.exit(bad ? 1 : 0);
