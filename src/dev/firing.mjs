// ============================================================
//  Two kilns.
//
//  The firing was one screen with six controls, five of which could ruin
//  a pot in ways nothing told you about until the kiln was opened a day
//  later. The one that mattered most had to land within about 25 C of a
//  number that is a property of a glaze chosen an hour earlier and never
//  shown. That is not difficulty; it is a memory test with a very long
//  feedback loop, and it was the only way to fire.
//
//  So there are two now. This holds down what each one promises:
//    the Guild's       a pot that was thrown and glazed properly comes
//                      out fired. Every glaze on it reaches maturity,
//                      nothing cracks on the way up, and you can afford
//                      to light it.
//    your own          all six controls, and every way to lose it is
//                      still there for anyone who wants them.
//
//  Run:  node src/dev/firing.mjs
// ============================================================
import { GLAZE_BY_ID, guildSchedule, defaultSchedule, fire, fuelCost, maturePoint, scheduleHours }
  from '../sim/glaze.js';

let bad = 0;
const NL = String.fromCharCode(10);
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };

console.log(NL + '  TWO KILNS' + NL);

/* A pot as it comes off the wheel: a wall a few millimetres thick, one
   even coat over most of it. Nothing exotic — the ordinary case the
   Guild schedule exists to serve. */
const body = (wall) => ({ meanWall: wall, height: 18, maxD: 13, mass: 900 });
const coat = (id, coverage = 0.86, thick = 0.11) =>
  [{ glaze: GLAZE_BY_ID[id], coverage, meanThick: thick }];

/* ---- 1. the Guild fires whatever is on the pot ---------------------- */
const EVERY = Object.keys(GLAZE_BY_ID);
console.log(`         ${EVERY.length} glazes, each fired on the Guild's schedule:` + NL);

let worstMaturity = 2, worstName = "", cracked = [];
for (const id of EVERY) {
  const g = GLAZE_BY_ID[id];
  const layers = coat(id);
  const s = guildSchedule([g], body(0.45), null);
  const r = fire(layers, s, body(0.45));
  if (r.maturity < worstMaturity) { worstMaturity = r.maturity; worstName = g.name; }
  if (r.destroyed) cracked.push(g.name);
}
console.log(`         the least well matured was ${worstName} at ${(worstMaturity * 100).toFixed(0)}%`);
ok(worstMaturity > 0.85,
   `every glaze in the game reaches maturity on the Guild's schedule ` +
   `(worst: ${worstName}, ${(worstMaturity * 100).toFixed(0)}%)`);
ok(cracked.length === 0,
   `and none of them is destroyed in the firing${cracked.length ? ': ' + cracked.join(', ') : ''}`);

/* ---- 2. it aims at the glaze, not at a fixed number ------------------ */
{
  const cool = GLAZE_BY_ID[EVERY.reduce((a, b) =>
    (maturePoint(GLAZE_BY_ID[b]) < maturePoint(GLAZE_BY_ID[a]) ? b : a))];
  const hot = GLAZE_BY_ID[EVERY.reduce((a, b) =>
    (maturePoint(GLAZE_BY_ID[b]) > maturePoint(GLAZE_BY_ID[a]) ? b : a))];
  const sc = guildSchedule([cool], body(0.45), null);
  const sh = guildSchedule([hot], body(0.45), null);
  console.log(`         ${cool.name} asks for ${Math.round(maturePoint(cool))}, the schedule goes to ${sc.peak}`);
  console.log(`         ${hot.name} asks for ${Math.round(maturePoint(hot))}, the schedule goes to ${sh.peak}`);
  ok(Math.abs(sc.peak - maturePoint(cool)) < 2 && Math.abs(sh.peak - maturePoint(hot)) < 2,
     'the peak is the maturing point of the glaze that is actually on the pot');
  ok(sh.peak > sc.peak + 100, 'so a hot glaze and a cool one get different firings');
}

/* ---- 3. two glazes: the hotter one decides -------------------------- */
{
  const a = GLAZE_BY_ID.ash, b = GLAZE_BY_ID.celadon;
  const s = guildSchedule([a, b], body(0.45), null);
  const want = Math.max(maturePoint(a), maturePoint(b));
  ok(Math.abs(s.peak - want) < 2,
     `with two glazes on the pot it fires to the hotter one (${s.peak} vs ${Math.round(want)})`);
  const r = fire([...coat('ash', 0.5), ...coat('celadon', 0.4)], s, body(0.45));
  ok(r.maturity > 0.8, `and both come out as glass (${(r.maturity * 100).toFixed(0)}% matured)`);
}

/* ---- 4. the climb is safe for the wall that was actually thrown ------ */
{
  const walls = [0.3, 0.45, 0.7, 1.1, 1.8];
  const results = walls.map((w) => {
    const s = guildSchedule([GLAZE_BY_ID.ash], body(w), null);
    const r = fire(coat('ash'), s, body(w));
    return { w, ramp: s.ramp, destroyed: r.destroyed, hours: scheduleHours(s) };
  });
  for (const r of results) {
    console.log(`         a ${r.w.toFixed(2)} cm wall climbs at ${r.ramp}/hr, ${r.hours.toFixed(0)} hr` +
                (r.destroyed ? '  DESTROYED' : ''));
  }
  ok(results.every((r) => !r.destroyed),
     'no wall thickness a player can throw is cracked by the Guild ramp');
  ok(results[0].ramp > results[4].ramp,
     'a thin pot is fired faster than a thick one, which is the whole point of measuring it');
}

/* ---- 5. and you can afford to light it ------------------------------ */
{
  const s = guildSchedule([GLAZE_BY_ID.ash], body(0.45), null);
  const cost = fuelCost(s);
  const START = 55;   // the purse a new potter has, from save.js
  console.log(`         the first firing costs ${cost} ash-marks against a purse of ${START}`);
  ok(cost <= START,
     `a new potter can pay for the Guild's firing on day one (${cost} of ${START})`);
}

/* ---- 6. the brief's atmosphere is honoured --------------------------- */
{
  const red = guildSchedule([GLAZE_BY_ID.oxblood], body(0.45), { atmos: 'reduction' });
  const air = guildSchedule([GLAZE_BY_ID.oxblood], body(0.45), { atmos: 'oxidation' });
  ok(red.reduction > 0.5, `a brief asking for reduction gets it (${(red.reduction * 100).toFixed(0)}%)`);
  ok(air.reduction < 0.25, `and one asking for air gets that (${(air.reduction * 100).toFixed(0)}%)`);
}

/* ---- 7. doing it by hand can still go wrong ------------------------- */
{
  // If the hard mode cannot be lost, there is no hard mode.
  const s = defaultSchedule();
  s.peak = 1050;                       // well under anything's maturity
  const r = fire(coat('celadon'), s, body(0.45));
  ok(r.maturity < 0.5,
     `firing it yourself, 200 degrees short still comes out underfired ` +
     `(${(r.maturity * 100).toFixed(0)}% matured)`);

  const s2 = defaultSchedule();
  s2.ramp = 320;                       // straight up, on a thick wall
  const r2 = fire(coat('ash'), s2, body(1.6));
  ok(r2.destroyed || r2.defects.length > 0,
     'and slamming a thick pot up at 320/hr still damages it');
}

console.log(bad ? NL + `  ${bad} FAILED` + NL
                : NL + '  the Guild fires it properly, and you can still ruin it yourself' + NL);
process.exit(bad ? 1 : 0);
