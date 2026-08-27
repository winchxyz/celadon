// ============================================================
//  Does the shelf show what came out of the kiln?
//
//  It did not. The gallery stored the glaze field as a 64x48 thumbnail
//  sampled by nearest neighbour out of the 192x160 the pot was actually
//  glazed with — a ninth of the cells — so a piece was drawn softer
//  than it was made, edges moved by up to three cells, and the peak
//  thickness read 0.475 where the pot had 0.566.
//
//  That was the price of keeping saves small, and it turned out not to
//  be a price anyone had to pay: deflating the whole field costs LESS
//  than the thumbnail did, because 78% of it is zero and the channels
//  are written out planar rather than interleaved.
//
//  Run:  node src/dev/shelf.mjs
// ============================================================

import { FOOT_BAND } from '../sim/glazeField.js';
import { game, step } from './realgame.mjs';

let bad = 0;
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };
const NL = String.fromCharCode(10);

console.log(NL + '  DOES THE SHELF SHOW WHAT CAME OUT OF THE KILN?' + NL);

if (typeof CompressionStream !== 'function') {
  console.log('   --    this runtime has no CompressionStream; nothing to check');
  process.exit(0);
}

/* A realistically glazed pot: a dip, a pour down one side, brushwork,
   a wax resist, and the foot wiped. Not a flat fill — the whole point
   is the edges, and a flat fill has none. */
game.startThrow(); step(200);
game.startTrim?.(); step(20);
game.startGlaze?.(); step(20);

const f = game.field;
f.data.fill(0);
f.dip(0.72, 0, 0.13);
for (let k = 0; k < 40; k++) f.pour(0.3, 0.17, 1, 0.13 * 0.016 * 3.4, 0.85);
for (let k = 0; k < 60; k++) f.brush(0.7, 0.55, 0.075, 2, 0.13 * 0.016 * 5.5);
for (let k = 0; k < 30; k++) f.brush(0.15, 0.3, 0.06, 0, 0.016 * 3.2, true);
f.wipeFoot(0.75);

const original = Float32Array.from(f.data);
const before = f.stats();

const thumb = f.snapshot();
const exact = await f.snapshotExact();

ok(!!exact && exact.v === 2, `an exact snapshot is produced (v${exact?.v})`);
ok(exact.z.length <= thumb.d.length,
  `and it is no larger than the thumbnail it replaces (${exact.z.length} vs ${thumb.d.length} chars)`);

const err = () => {
  let max = 0, sum = 0;
  for (let i = 0; i < original.length; i++) {
    const d = Math.abs(f.data[i] - original[i]);
    if (d > max) max = d;
    sum += d;
  }
  return { max, mean: sum / original.length };
};

f.data.fill(0);
f.restore(thumb);
const t = err();
const tStats = f.stats();

f.data.fill(0);
const got = await f.restoreExact(exact);
const e = err();
const eStats = f.stats();

ok(got, 'the exact snapshot reads back');

console.log(NL + `     worst cell   thumbnail ${t.max.toFixed(4)}   exact ${e.max.toFixed(4)}`);
console.log(`     mean cell    thumbnail ${t.mean.toFixed(6)}   exact ${e.mean.toFixed(6)}`);
console.log(`     coverage     was ${before.totalCoverage.toFixed(4)}   `
  + `thumbnail ${tStats.totalCoverage.toFixed(4)}   exact ${eStats.totalCoverage.toFixed(4)}`);

/* 8 bits over a 0..0.7 range is a step of 0.00275, so half a step is
   0.00137 and a whole one is the honest ceiling. Anything above that is
   resolution being thrown away, which is the thing being fixed. */
ok(e.max <= 0.00275,
  `no cell is off by more than one 8-bit step (worst ${e.max.toFixed(5)}, step 0.00275)`);
ok(e.max < t.max / 10,
  `and that is at least ten times closer than the thumbnail (${(t.max / e.max).toFixed(0)}x)`);
ok(Math.abs(eStats.totalCoverage - before.totalCoverage) < 0.002,
  `coverage survives (${before.totalCoverage.toFixed(4)} -> ${eStats.totalCoverage.toFixed(4)})`);

/* The wax channel has its own scale and got this wrong once already. */
let waxBefore = 0, waxAfter = 0;
for (let i = 3; i < original.length; i += 4) {
  if (original[i] > waxBefore) waxBefore = original[i];
  if (f.data[i] > waxAfter) waxAfter = f.data[i];
}
ok(Math.abs(waxAfter - waxBefore) < 0.01,
  `wax comes back at its own scale (${waxBefore.toFixed(3)} -> ${waxAfter.toFixed(3)})`);

/* And a whole shelf still fits in a browser's cupboard. */
const perPiece = exact.z.length + 2200;      // the field, plus the rest of an entry
const shelfMB = (perPiece * 24 * 2) / 1048576;   // localStorage counts UTF-16
console.log(NL + `     a full shelf of 24: about ${shelfMB.toFixed(2)} MB of a 5 MB store`);
ok(shelfMB < 2.5, `a full shelf leaves room for the rest of the save (${shelfMB.toFixed(2)} MB)`);

console.log(NL + (bad ? `  ${bad} FAILED` : '  the shelf shows the pot') + NL);
process.exit(bad ? 1 : 0);
