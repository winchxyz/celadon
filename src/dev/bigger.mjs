// ============================================================
//  "There is no way to make the pot bigger — it only gets
//   thinner and longer."
//
//  Grabs the pot from five different places and drags outward, then
//  inward, through the real Hand. Every grip must widen and every
//  grip must narrow.
//
//  Run:  node src/dev/bigger.mjs
// ============================================================

import { drag, openedPot, radiiAt, capacity } from './harness.mjs';

const base = openedPot({ mass: 1100, seed: 5 });
const b = { H: base.height, D: base.maxR * 2, cap: capacity(base) };
console.log(`\n  starting pot:  ${b.H.toFixed(1)} cm tall, ${b.D.toFixed(1)} cm across, holds ${b.cap.toFixed(0)} ml\n`);

const grabs = [
  ['deep inside the bore', (ri, ro) => ri - 1.2],
  ['just inside the wall', (ri, ro) => ri - 0.1],
  ['ON the wall  <-- what everyone does', (ri, ro) => (ri + ro) * 0.5],
  ['on the outside face', (ri, ro) => ro],
  ['1.5 cm clear of the pot', (ri, ro) => ro + 1.5],
];

const TRAVEL = 2.6;      // far enough that every grip reaches the clay
let broken = 0;

function run(outward) {
  console.log(outward
    ? '  DRAGGING OUTWARD (should make it wider and shorter)\n'
    : '\n  DRAGGING INWARD (should make it narrower and taller)\n');
  console.log('  grabbed                                 height      width     capacity');
  console.log('  --------------------------------------  ---------   --------  ---------');
  for (const [label, pick] of grabs) {
    const c = openedPot({ mass: 1100, seed: 5 });
    for (let pass = 0; pass < 3; pass++) {
      for (const hf of [0.30, 0.55, 0.80]) {
        const y = Math.max(1.4, c.height * hf);
        const rr = radiiAt(c, y);
        const r0 = pick(rr.ri, rr.ro) + (outward ? 0 : TRAVEL);
        const r1 = outward ? r0 + TRAVEL : Math.max(0.2, r0 - TRAVEL);
        drag(c, r0, y, r1, y, 0.7, { jitter: 0.2 });
      }
    }
    const D = c.maxR * 2, H = c.height, cap = capacity(c);
    const ok = outward ? D > b.D + 0.5 : D < b.D - 0.3;
    if (!ok) broken++;
    console.log('  ' + label.padEnd(38) +
      `  ${H.toFixed(1).padStart(4)} cm` + (outward ? (H < b.H ? ' v' : ' ^') : (H > b.H ? ' ^' : ' v')) +
      `   ${D.toFixed(1).padStart(4)} cm` + (ok ? (outward ? ' ^' : ' v') : ' --') +
      `  ${cap.toFixed(0).padStart(5)} ml` +
      (ok ? '' : '   <-- NOTHING HAPPENED'));
  }
}

run(true);
run(false);

console.log(broken
  ? `\n  ${broken} grip(s) do nothing — the shaping control is still broken\n`
  : '\n  every grip works in both directions\n');
process.exit(broken ? 1 : 0);
