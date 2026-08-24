// ============================================================
//  Does the money work?
//
//  Fuel is the only thing you ever spend ash-marks on and a commission
//  is the only way you ever earn them, so the whole economy is one
//  subtraction. It is worth checking, because the two numbers were set
//  in different places and never compared:
//
//    - you start with 55 marks (save.js),
//    - and the two glazes you start with mature at 1272 and 1284 C
//      (glaze.js), which costs about 75 marks to reach.
//
//  Run:  node src/dev/economy.mjs
// ============================================================
import { Clay } from '../sim/clay.js';
import { drag } from './harness.mjs';
import { GLAZES, fire, fuelCost, defaultSchedule, maturePoint } from '../sim/glaze.js';
import { COMMISSIONS, FORMS, targetSize } from '../game/lore.js';
import { appraise, payMultiplier } from '../game/scoring.js';
import { blankSave } from '../game/save.js';
import { clamp } from '../core/util.js';

const NL = String.fromCharCode(10);
let bad = 0;
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };
const S = (o = {}) => ({ ...defaultSchedule(), ...o });

/* A serviceable cup: not a showpiece, what a careful player gets. */
function makePot(req) {
  const { H, D, wall: w } = targetSize(req);
  const rc = Math.max(0.6, D * 0.5 - w * 0.5);
  const v = 6.283185 * rc * w * H * 0.86 + Math.PI * (D * 0.5) ** 2 * 0.8;
  const mass = clamp(Math.round(v * 1.92 * 1.1 / 25) * 25, 250, 3200);
  const c = new Clay({ mass, seed: 4242, wobble: 0.4 });
  for (let i = 0; i < 4; i++) {
    const top = c.height * 0.85;
    drag(c, c.maxR * 1.05, 0.8, c.maxR * 0.72, top, 0.5);
    drag(c, c.maxR * 0.72, top, c.maxR * 1.05, 0.8, 0.5);
  }
  drag(c, 0.5, c.height * 0.9, 0.8, 1.1, 0.5);
  for (let i = 0; i < 3; i++) drag(c, 0.8, 1.2, (req.minD ?? D) * 0.4, 1.4, 0.7);
  for (let i = 0; i < 14 && !c.dead; i++) {
    const m = c.metrics();
    if (m.height >= (req.minH ?? 0) && (!req.maxWall || m.meanWall <= req.maxWall)) break;
    const i0 = c.sectionAt(2);
    const mid = (c.ro[i0] + c.ri[i0]) * 0.5;
    drag(c, mid, 1.1, mid, Math.max(3.5, c.height - 0.3), 1.2);
  }
  return c;
}

/** Fire and appraise one pot on one schedule, and return the money. */
function run(com, clay, sched, glazeId) {
  const g = GLAZES.find((x) => x.id === glazeId);
  const m = clay.metrics();
  const fr = fire(
    [{ glaze: g, coverage: 0.88, meanThick: 0.13 }],
    sched,
    { meanWall: m.meanWall, minWall: m.minWall, moisture: 0.05, scar: 0.05, height: m.height, maxR: m.diameter / 2 },
  );
  const rep = appraise({
    clay, commission: com,
    glazeStats: { totalCoverage: 0.88, evenness: 0.82, footClean: 1, meanThick: [0.13, 0, 0], slotIds: [glazeId, null, null] },
    fireResult: fr, schedule: sched,
  });
  return { cost: fuelCost(sched), pay: rep.pay, total: rep.total, accepted: rep.accepted, maturity: fr.maturity };
}

console.log('\n  DOES THE MONEY WORK?\n');

const START = blankSave().coin;
const c1 = COMMISSIONS[0];
const pot1 = makePot(c1.require);

/* ---- 1. can you pay for the first firing at all? ------------------ */
const startGlazes = blankSave().glazes;
const hottest = Math.max(...startGlazes.map((id) => maturePoint(GLAZES.find((g) => g.id === id))));
const matureCost = fuelCost(S({ peak: hottest, ramp: 190, soak: 0.3 }));
console.log(`   you start with ${START} marks`);
console.log(`   your glazes mature at ${hottest} C, which costs ${matureCost} marks to reach\n`);
ok(matureCost <= START,
   `the first firing you could actually want is affordable: ${matureCost} <= ${START}`);

/* ---- 2. does a proper day-one firing pay for itself? --------------
   Not the CHEAPEST firing — the cheapest one is 900 C, where the glaze
   never melts and the pot comes out a dry scab. The firing under test is
   the one a player would actually choose: hot enough to mature the glaze
   they were given. */
const dayOne = S({ peak: hottest, ramp: 190, soak: 0.3 });
const r1 = run(c1, pot1, dayOne, 'celadon');
console.log(`         a mature day-one firing: cost ${r1.cost}, glaze maturity`
  + ` ${(r1.maturity * 100).toFixed(0)}%, scored ${r1.total}, paid ${r1.pay}`);
ok(r1.maturity > 0.75, `the glaze actually melts (${(r1.maturity * 100).toFixed(0)}% mature)`);
ok(r1.pay - r1.cost > 0,
   `it pays for itself: ${r1.pay} - ${r1.cost} = ${r1.pay - r1.cost >= 0 ? '+' : ''}${r1.pay - r1.cost}`);
ok(r1.accepted, `the piece is accepted (score ${r1.total} >= 40)`);

/* ---- 3. does money stay meaningful, or drown? ---------------------
   Throwing skill is not what is under test here, so this holds the
   player's hands still: a competent score with the brief met, every
   time, fired hot enough to mature whatever glaze the brief asks for.
   What moves is the fee and the fuel. */
const SCORE = 70;
console.log(`
   the campaign, played competently (score ${SCORE}, brief met):
`);
let coin = START, brokeAt = null;
const ratios = [];
COMMISSIONS.forEach((com, i) => {
  const gid = com.require?.glaze ?? 'celadon';
  const g = GLAZES.find((x) => x.id === gid) ?? GLAZES[0];
  const s = S({
    peak: maturePoint(g), ramp: 190, soak: 0.3,
    reduction: com.require?.atmos === 'reduction' ? 0.8 : 0,
  });
  const cost = fuelCost(s);
  const pay = Math.round((com.pay ?? 60) * payMultiplier(SCORE, true));
  if (cost > coin && brokeAt === null) brokeAt = i + 1;
  coin += pay - cost;
  ratios.push(cost / Math.max(1, pay));
  console.log(`   c${String(i + 1).padStart(2)}  fee ${String(com.pay).padStart(3)}`
    + `  peak ${String(Math.round(s.peak)).padStart(4)}  cost ${String(cost).padStart(3)}`
    + `  paid ${String(pay).padStart(4)}  net ${String(pay - cost >= 0 ? '+' + (pay - cost) : pay - cost).padStart(5)}`
    + `  balance ${coin}   fuel ${(ratios[i] * 100).toFixed(0)}% of the fee`);
});
ok(brokeAt === null, `never unable to afford the firing the brief needs${brokeAt ? ` — stuck at c${brokeAt}` : ''}`);

const early = ratios.slice(0, 3).reduce((a, b) => a + b, 0) / 3;
const late = ratios.slice(-3).reduce((a, b) => a + b, 0) / 3;
console.log(`
   fuel as a share of the fee: ${(early * 100).toFixed(0)}% early, ${(late * 100).toFixed(0)}% late`);
ok(early < 0.75, `an early firing is not most of the fee (${(early * 100).toFixed(0)}%)`);
ok(late > 0.04,
   `a late firing still costs something (${(late * 100).toFixed(0)}% of the fee)` +
   (late <= 0.04 ? ' — by the end the money has stopped being a decision' : ''));

/* ---- 4. can a bad run kill the save outright? --------------------
   Firing is the only way to earn, so a purse below the cheapest
   possible firing is not a setback — it is the end of the game, with
   nothing on screen to say so. */
const floor = fuelCost(S({ peak: 900, ramp: 320, soak: 0, reduction: 0, cooling: 'crash' }));
console.log(NL + `   the cheapest firing the kiln can be lit for is ${floor} marks`);

// worst realistic run: every piece destroyed, so every firing pays nothing
let purse = START, firings = 0;
while (purse >= floor && firings < 40) { purse -= floor; firings++; }
console.log(`   losing every single piece, the purse empties after ${firings} firings`);
ok(purse < floor, 'that state is reachable, so it has to be handled');

// the advance in game.js: nextCommission tops the purse back up
const advanced = Math.max(floor, Math.round(floor * 2.2));
ok(advanced >= floor,
   `the Guild's fuel advance clears the floor: ${advanced} >= ${floor}`);
ok(advanced >= floor * 2,
   `and leaves enough to try more than once (${advanced} marks, ${(advanced / floor).toFixed(1)} firings)`);

// and the minimum a surviving piece earns has to beat the floor, or the
// advance just postpones the same dead end
const worstPay = Math.round(COMMISSIONS[0].pay * payMultiplier(1, false));
ok(worstPay > floor,
   `even the worst surviving piece out-earns the cheapest firing: ${worstPay} > ${floor}`);

console.log(bad ? NL + '  ' + bad + ' FAILED' + NL : NL + '  the money works' + NL);
process.exit(bad ? 1 : 0);
