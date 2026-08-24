// ============================================================
//  The open shed keeps no books.
//
//  Free mode runs the same wheel, trimming, glaze and kiln code as the
//  campaign with the scoring apparatus switched off. The whole point is
//  that a player can wander in, mess about, and come back to find their
//  campaign exactly where they left it — so what is actually worth
//  testing is the NEGATIVE: that nothing in here writes to the save.
//
//  Run:  node src/dev/freemode.mjs
// ============================================================
import { game, step } from './realgame.mjs';
import { GLAZES, fuelCost, defaultSchedule } from '../sim/glaze.js';

let bad = 0;
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };
const NL = String.fromCharCode(10);
const snap = (s) => ({
  coin: s.coin, day: s.day, rep: s.rep, commission: s.commission,
  glazes: s.glazes.length, bodies: s.bodies.length,
  gallery: s.gallery.length, best: s.best, proceduralN: s.proceduralN,
});

console.log(NL + '  THE OPEN SHED KEEPS NO BOOKS' + NL);

const s = game.save;
const before = snap(s);

/* ---- getting in ---------------------------------------------------- */
game.startFree();
step(90);
ok(game.free === true, 'the flag is set');
ok(game.state === 'throw', `it drops you straight at the wheel (state "${game.state}")`);
ok(Object.keys(game.commission.require ?? {}).length === 0,
   'there is no brief to satisfy');

/* ---- every glaze, not the two you were given ----------------------- */
ok(game._freeGlazes().length === GLAZES.length,
   `every glaze is on the shelf: ${game._freeGlazes().length} of ${GLAZES.length}`);
ok(s.glazes.length === before.glazes,
   `and the campaign still only owns the ${before.glazes} it earned`);

/* ---- the fire costs nothing ---------------------------------------- */
game.startTrim(); step(40);
game.startGlaze(); step(40);
game.startKiln(); step(40);
const coinBefore = s.coin;
const wouldCost = fuelCost(game.schedule);
game.lightKiln();
ok(game.state === 'firing', 'the kiln lights');
ok(s.coin === coinBefore,
   `and charges nothing: ${coinBefore} -> ${s.coin} (the campaign would have paid ${wouldCost})`);
ok(wouldCost > 0, `the same firing does cost something in the campaign (${wouldCost})`);

/* ---- run it out and check the ledger ------------------------------- */
let guard = 0;
while (game.state === 'firing' && guard++ < 6000) step(6);
step(60 * 12);
const after = snap(s);

const drift = Object.keys(before).filter((k) => before[k] !== after[k]);
ok(drift.length === 0,
   `a whole firing leaves the campaign untouched${drift.length
     ? ` — moved: ${drift.map((k) => `${k} ${before[k]}->${after[k]}`).join(', ')}` : ''}`);

/* ---- and leaving puts it back ------------------------------------- */
game.showTitle();
ok(game.free === false, 'going back to the title clears the flag');

console.log(bad ? NL + `  ${bad} FAILED` + NL : NL + '  nothing was written down' + NL);
process.exit(bad ? 1 : 0);
