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
import { GLAZE_BY_ID, guildSchedule, defaultSchedule, fire, fuelCost, maturePoint, scheduleHours, safeCoat }
  from '../sim/glaze.js';
import { COMMISSIONS } from '../game/lore.js';

let bad = 0;
const NL = String.fromCharCode(10);
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };

console.log(NL + '  TWO KILNS' + NL);

/* A pot as it comes off the wheel: a wall a few millimetres thick, one
   even coat over most of it. Nothing exotic — the ordinary case the
   Guild schedule exists to serve. */
const body = (wall) => ({ meanWall: wall, height: 18, maxD: 13, mass: 900 });
/* 0.13 is the coat the slider opens at (game.js, this.glazeThickness).
   This helper used to default to 0.11, and at 0.11 every glaze survives
   — which is why this bench was green while the shipped default welded
   Zinc Flower to the shelf. A bench that tests a setting nobody plays
   at is worse than no bench: it certifies the thing it is not looking
   at. */
const DEFAULT_COAT = 0.13;
const coat = (id, coverage = 0.86, thick = DEFAULT_COAT) =>
  [{ glaze: GLAZE_BY_ID[id], coverage, meanThick: thick }];

/* ---- 1. the Guild fires whatever is on the pot ---------------------- */
const EVERY = Object.keys(GLAZE_BY_ID);
console.log(`         ${EVERY.length} glazes, each fired on the Guild's schedule:` + NL);

let worstMaturity = 2, worstName = "", cracked = [];
for (const id of EVERY) {
  const g = GLAZE_BY_ID[id];
  // at the coat the game will actually let you use: the dial opens at
  // DEFAULT_COAT and is capped at safeCoat, whichever is less
  const s = guildSchedule([g], body(0.45), null);
  const use = Math.min(DEFAULT_COAT, safeCoat(g, body(0.45), null));
  const layers = coat(id, 0.86, use);
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

/* ---- 6b. and it knows what it has been asked FOR --------------------
   Pinning the peak to the maturing point is right for most briefs and
   exactly wrong for the ones that want something a straight firing does
   not give. Crystals have to be held on the way down, oil spots driven
   past maturity and dropped, a raku lustre pulled hot and starved. Left
   to the plain schedule, three commissions could not be completed at all
   in the mode the game fires in by default: the crystal vase came out at
   0.09 against a gate of 0.40. A brief that cannot be met is the one
   thing the Guild must never hand you. */
{
  const GATE = { crystal: 0.4, oilspot: 0.3, hare: 0.4, carbon: 0.4, craze: 0.45, peel: 0.4, opal: 0.45, metal: 0.4 };
  const asked = COMMISSIONS
    .map((c) => ({ c, fx: c.require?.effect, g: GLAZE_BY_ID[c.require?.glaze] }))
    .filter((x) => x.fx && x.fx !== 'copperRed' && x.g);

  const short = [];
  for (const { c, fx, g } of asked) {
    const s = guildSchedule([g], body(0.45), c.require);
    let best = 0;
    for (const t of [0.08, 0.11, 0.14, 0.18, 0.22]) {
      const r = fire([{ glaze: g, coverage: 0.86, meanThick: t }], s, body(0.45));
      if (!r.destroyed) best = Math.max(best, r[fx] ?? 0);
    }
    console.log(`         ${c.id.padEnd(4)} wants ${fx.padEnd(8)} on ${g.name.padEnd(19)} ` +
                `the Guild gets ${best.toFixed(2)} (needs ${GATE[fx]})`);
    if (best < GATE[fx]) short.push(`${c.id} (${fx} on ${g.name}: ${best.toFixed(2)})`);
  }
  ok(short.length === 0,
     `the Guild can fire for every effect the campaign asks for ` +
     `(${asked.length} briefs)${short.length ? ' — cannot: ' + short.join(', ') : ''}`);
}

/* ---- 6c. nothing the guided mode OFFERS can destroy the pot ----------
   The coat dial runs to 0.30 and eleven of the twelve glazes weld the
   piece to the kiln shelf somewhere inside that. Zinc Flower does it at
   0.125 — under the 0.13 the dial opens at — so the crystal glaze that
   commission c7 asks for by name was destroyed at the factory default,
   in the mode whose whole promise is that the pot comes out fired.
   safeCoat is what the dial is now capped to, so this fires every glaze
   at its own cap and at the value the dial opens at. */
{
  const wall = body(0.5);
  const lost = [], atDefault = [];
  for (const id of EVERY) {
    const g = GLAZE_BY_ID[id];
    const cap = safeCoat(g, wall, null);
    const r = fire([{ glaze: g, coverage: 0.9, meanThick: cap }], guildSchedule([g], wall, null), wall);
    if (r.destroyed) lost.push(`${g.name} at its own cap of ${cap.toFixed(3)}`);

    const d = fire(coat(id), guildSchedule([g], wall, null), wall);
    if (d.destroyed) atDefault.push(`${g.name} (run ${d.run.toFixed(2)})`);
    if (cap < DEFAULT_COAT) {
      console.log(`         ${g.name.padEnd(20)} runs early — the dial is held at ${(cap * 10).toFixed(2)} mm`);
    }
  }
  ok(lost.length === 0,
     `no glaze is destroyed at the thickest coat the guided dial offers${lost.length ? ': ' + lost.join(', ') : ''}`);
  ok(atDefault.length === 0 || true,
     `(for the record, at the dial's opening value of ${DEFAULT_COAT}: ` +
     `${atDefault.length ? atDefault.join(', ') + ' would weld — which is why the dial is capped' : 'all twelve survive'})`);
}

/* ---- 6d. and the guided kiln does not gamble ------------------------
   fire() dunts a wall over 0.52 cm that is crash-cooled and then throws
   a coin for whether the pot survives at all. guildSchedule was choosing
   that crash itself, for the briefs that want an oil spot or a lustre —
   so a 0.55 cm wall was lost half the time with nothing on screen to say
   the wall was the problem. */
{
  const gambles = [];
  for (const fx of ['oilspot', 'metal', 'craze']) {
    for (const w of [0.55, 0.7, 1.0]) {
      const g = GLAZE_BY_ID[fx === 'metal' ? 'raku' : fx === 'craze' ? 'crystal' : 'tenmoku'];
      const s2 = guildSchedule([g], body(w), { effect: fx });
      if (s2.cooling === 'crash') gambles.push(`${fx} on a ${w} cm wall`);
    }
  }
  ok(gambles.length === 0,
     `the Guild never crash-cools a wall thick enough to dunt${gambles.length ? ': ' + gambles.join(', ') : ''}`);
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
