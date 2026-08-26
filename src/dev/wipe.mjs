// ============================================================
//  Does one press of the sponge actually clean the foot?
//
//  The sponge and the kiln inspector are two different pieces of code
//  reading two different numbers, and for a long time they disagreed:
//  wipeFoot took glaze off at full strength only below heightCm * 0.35
//  — 0.2625 cm for the 0.75 the game passes it — while footClean judged
//  every row out to 0.55 cm at full weight. At 0.55 the sponge removed
//  36.7% and left the rest, so a single press could not satisfy the
//  test that press exists to satisfy.
//
//  From the player's side that is not a subtle balance issue. Tap the
//  sponge; a green toast says "Foot wiped clean."; press for the kiln;
//  the kiln says the foot is still covered. The coach line does not
//  change, because it was already showing that string. Nothing anywhere
//  tells you to tap again.
//
//  So: one press, every form, every size the briefs ask for.
//
//  Run:  node src/dev/wipe.mjs
// ============================================================

import { FOOT_BAND } from '../sim/glazeField.js';
import { game, step } from './realgame.mjs';

let bad = 0;
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };
const NL = String.fromCharCode(10);

/** What the sponge is actually called with, in game.js. */
const SPONGE = 0.75;
/** What the kiln refuses below, in game.js. */
const GATE = 0.4;
/** What the appraisal scolds below, in scoring.js. */
const SCOLD = 0.45;

console.log(NL + '  DOES ONE PRESS OF THE SPONGE CLEAN THE FOOT?' + NL);

ok(FOOT_BAND === 0.55,
  `the sponge and the inspector share one band (${FOOT_BAND} cm)`);

/* Real pots, thrown by the real Hand, with the field bound to the real
   profile buffer — because the first version of this bench built a bare
   GlazeField and called a setProfile() that does not exist. mY and
   mSide stayed at their defaults, the dip never reached the graded
   band, and it printed three green lines with the BUG STILL IN. A test
   that passes because the thing it is testing is not there is worse
   than no test. */
const failures = [];
const scolded = [];
let cases = 0;

for (const mass of [500, 800, 1200, 1600, 2000, 2400, 2800, 3200]) {
  game.mass = mass;
  game.startThrow(); step(150);
  game.startTrim?.(); step(20);
  game.startGlaze?.(); step(20);

  const f = game.field;
  let graded = 0;
  for (let j = 0; j < f.mY.length; j++) if (f.mSide[j] <= 1.5 && f.mY[j] <= FOOT_BAND) graded++;
  if (graded === 0) continue;             // nothing in the band to judge

  f.data.fill(0);
  f.dip(1.0, 0, 0.13);                    // glaze all the way down
  const before = f.footClean();
  f.wipeFoot(SPONGE);                     // one press, exactly as the game does
  const after = f.footClean();
  cases++;
  const h = game.clay ? game.clay.height.toFixed(1) : '?';
  if (after < GATE) failures.push(`${mass}g / ${h}cm: ${before.toFixed(3)} -> ${after.toFixed(3)}`);
  else if (after < SCOLD) scolded.push(`${mass}g / ${h}cm: ${after.toFixed(3)}`);
  console.log(`     ${String(mass).padStart(4)}g  ${String(h).padStart(5)}cm   footClean ${before.toFixed(3)} -> ${after.toFixed(3)}`);
}

ok(cases > 0, `${cases} pots had a foot to judge`);
ok(failures.length === 0,
  `one press clears the kiln gate on all ${cases} of them`
  + (failures.length ? NL + '           ' + failures.join(NL + '           ') : ''));

/* The gate and the appraisal use different thresholds — 0.40 and 0.45 —
   so there is a band where the kiln accepts a pot and the appraisal
   then tells the player off for the same foot. */
ok(scolded.length === 0,
  `and none land between the kiln's ${GATE} and the appraisal's ${SCOLD}`
  + (scolded.length ? NL + '           ' + scolded.join(NL + '           ') : ''));

console.log(NL + (bad ? `  ${bad} FAILED` : '  the sponge does what the toast says') + NL);
process.exit(bad ? 1 : 0);
