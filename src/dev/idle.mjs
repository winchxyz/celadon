// ============================================================
//  The failures a player actually hits — driven through the real
//  Hand, so these cannot pass while the game misbehaves.
//
//    1. holding the button still must not grow the pot
//    2. a pot left turning must not bend itself
//    3. a pot that has run out of true must be recoverable
//    4. a dab of water must not turn the clay to soup
//    5. an unopened lump must not stretch into a tower
//    6. the pot must get wider when you drag outward
//    7. widening must never turn into lifting, however deep the hollow
//    8. the first frame of a press must not jolt the pot
//    7. widening must never turn into lifting, however deep the hollow
//    8. the first frame of a press must not jolt the pot
//
//  Run:  node src/dev/idle.mjs
// ============================================================

import { Clay, NS } from '../sim/clay.js';
import { Hand } from '../sim/hand.js';
import { drag, hold, spin, openedPot, radiiAt, capacity, fmt } from './harness.mjs';

let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(48)} ${detail}`);
};

console.log('\n  THE THINGS THAT ACTUALLY GO WRONG\n');

/* 1 ---------------------------------------------------------------- */
{
  const c = openedPot();
  const h0 = c.height, t0 = c.metrics().trueness;
  const rr = radiiAt(c, c.height * 0.5);
  hold(c, (rr.ro + rr.ri) * 0.5, c.height * 0.5, 10);
  check('holding the button still does not lift it', Math.abs(c.height - h0) < 0.6,
    `10 s held: ${h0.toFixed(1)} -> ${c.height.toFixed(1)} cm`);
  check('holding still trues it rather than bending it',
    c.metrics().trueness >= t0 - 0.02,
    `trueness ${t0.toFixed(2)} -> ${c.metrics().trueness.toFixed(2)}`);
}

/* 2 ---------------------------------------------------------------- */
{
  const c = openedPot();
  const t0 = c.metrics().trueness;
  spin(c, 45);
  check('45 s untouched on the wheel keeps it true',
    c.metrics().trueness >= t0 - 0.05,
    `trueness ${t0.toFixed(2)} -> ${c.metrics().trueness.toFixed(2)}`);
}

/* 3 ---------------------------------------------------------------- */
{
  const c = openedPot();
  for (let i = 0; i < NS; i++) { c.ox[i] += 0.75; c.oz[i] += 0.35; }
  const t0 = c.metrics().trueness;
  const hand = new Hand(); hand.grab();
  for (let i = 0; i < 8; i++) {
    hold(c, radiiAt(c, 1 + i).ro, 1.0 + i * 0.9, 0.9, { hand });
  }
  check('a steady hand brings it back to true',
    c.metrics().trueness > t0 + 0.25,
    `trueness ${t0.toFixed(2)} -> ${c.metrics().trueness.toFixed(2)}`);
}

/* 4 ---------------------------------------------------------------- */
{
  const c = openedPot();
  const m0 = c.metrics().moisture;
  for (let f = 0; f < 60; f++) c.water(c.height * 0.5, 1, 1 / 60);
  const m1 = c.metrics().moisture;
  check('one second of water does not drown it', m1 < 0.80,
    `moisture ${(m0 * 100).toFixed(0)} -> ${(m1 * 100).toFixed(0)}`);
  for (let f = 0; f < 600; f++) c.water(c.height * 0.5, 1, 1 / 60);
  check('water cannot be held down into soup', c.metrics().moisture <= 0.83,
    `after 10 s: ${(c.metrics().moisture * 100).toFixed(0)}`);
}

/* 5 ---------------------------------------------------------------- */
{
  const c = new Clay({ mass: 500, seed: 8, wobble: 0.4 });
  const h0 = c.height;
  for (let i = 0; i < 8; i++) {
    drag(c, c.maxR * 0.95, 1.0, c.maxR * 0.95, c.height * 0.9, 0.8);
  }
  check('a solid lump will not stretch into a tower', c.height < h0 * 1.6,
    `${h0.toFixed(1)} -> ${c.height.toFixed(1)} cm, opened=${c.isOpen()}`);
}

/* 6 ---------------------------------------------------------------- */
{
  const c = openedPot({ mass: 1100, seed: 5 });
  const d0 = c.maxR * 2, cap0 = capacity(c);
  for (let pass = 0; pass < 3; pass++) {
    for (const hf of [0.30, 0.55, 0.80]) {
      const y = Math.max(1.4, c.height * hf);
      const rr = radiiAt(c, y);
      const r0 = (rr.ri + rr.ro) * 0.5;             // ON the wall
      drag(c, r0, y, r0 + 2.4, y, 0.7, { jitter: 0.2 });
    }
  }
  const d1 = c.maxR * 2, cap1 = capacity(c);
  // A range, not just "bigger": the first version of this passed while
  // the pot spread to a hundred and ninety metres across.
  check('dragging outward from the wall makes it bigger',
    d1 > d0 + 1.0 && cap1 > cap0 * 1.3 && d1 < 45 && !c.dead,
    `${d0.toFixed(1)} -> ${d1.toFixed(1)} cm across, ${cap0.toFixed(0)} -> ${cap1.toFixed(0)} ml` +
    (c.dead ? '  DEAD: ' + c.deadReason : ''));
}

/* 7 ---------------------------------------------------------------- */
{
  // The player's report: "the deeper you make the hole the worse it
  // gets, and at some point instead of widening it starts lifting the
  // clay upward". Widening is checked here as a one-way street.
  let worst = 0, worstAt = '';
  for (const deepen of [0, 4, 10]) {
    const c = openedPot({ mass: 1100, seed: 5 });
    for (let i = 0; i < deepen; i++) {
      drag(c, 0.5, c.height * 0.95, 0.9, Math.max(0.5, c.height * 0.14), 0.7);
    }
    let prev = c.height;
    for (let pass = 0; pass < 6; pass++) {
      const y = Math.max(1.4, c.height * 0.6);
      const rr = radiiAt(c, y);
      const m = (rr.ri + rr.ro) * 0.5;
      drag(c, m, y, m + 2.4, y, 0.7);
      const grew = c.height - prev;
      if (grew > worst) { worst = grew; worstAt = `depth ${deepen}, pass ${pass}`; }
      prev = c.height;
    }
  }
  check('widening never lifts, however deep the hollow', worst < 0.25,
    `worst climb ${worst.toFixed(2)} cm` + (worst > 0.25 ? `  at ${worstAt}` : ''));
}

/* 8 ---------------------------------------------------------------- */
{
  // The first frame of a press has no hand speed yet, so it reads as a
  // steady rib. That frame used to smooth the whole silhouette at once
  // and threw the pot upward by two centimetres — "every time you touch
  // the clay it grows".
  const c = openedPot({ mass: 1100, seed: 5 });
  for (let i = 0; i < 3; i++) {
    const yy = c.height * 0.55, r2 = radiiAt(c, yy);
    drag(c, (r2.ri + r2.ro) * 0.5, yy, (r2.ri + r2.ro) * 0.5 + 2.6, yy, 0.7);
  }
  const y = c.height * 0.55, rr = radiiAt(c, y);
  const r = (rr.ri + rr.ro) * 0.5;
  const before = c.height;
  const hand = new Hand(); hand.grab();
  hand.apply(c, { r, y, pr: r, py: y, press: 1, contact: 1, omega: 8.4 }, 1 / 60);
  const jolt = Math.abs(c.height - before);
  check('touching the clay does not jolt it', jolt < 0.05,
    `one frame: ${before.toFixed(2)} -> ${c.height.toFixed(2)} cm`);
}

console.log(fails ? `\n  ${fails} FAILING\n` : '\n  all clear\n');
process.exit(fails ? 1 : 0);
