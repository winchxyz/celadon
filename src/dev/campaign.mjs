// ============================================================
//  Can the campaign actually be played, in order?
//
//  Three commissions in a row asked for a glaze that only arrived on
//  completing them. c9 wanted Guild Blue and unlocked Guild Blue; c10
//  wanted Salt Vapour and unlocked Salt Vapour; c11 wanted Raku and
//  unlocked Raku. A required glaze is not a gate but a mark — it is one
//  of the brief's requirements and it feeds briefOk — so those three
//  were quietly unwinnable: one requirement short every time, and
//  payMultiplier docks an unmet brief from 1.15 to 0.7. A third of the
//  fee, for a job nobody could do.
//
//  Nothing in the game said so. Nothing could: it is a property of the
//  ORDER of the campaign, not of any one commission, and the only way
//  to see it is to walk the whole thing from an empty save.
//
//  Run:  node src/dev/campaign.mjs
// ============================================================
import { COMMISSIONS, FORMS, BODIES, RANKS, proceduralCommission } from '../game/lore.js';
import { GLAZES, GLAZE_BY_ID, maturePoint, fuelCost, guildSchedule, fire, EFFECTS_FOR } from '../sim/glaze.js';
import { blankSave, unlock } from '../game/save.js';
import { payMultiplier } from '../game/scoring.js';

let bad = 0;
const NL = String.fromCharCode(10);
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };

console.log(NL + '  THE CAMPAIGN, WALKED FROM AN EMPTY SAVE' + NL);

/* Every effect the appraisal can actually detect. hasEffect is not
   exported, so this is the list it switches on — kept here so that an
   effect added to a brief but not to the switch is caught. */
const REAL_EFFECTS = new Set([
  'crystal', 'oilspot', 'hare', 'carbon', 'craze', 'peel', 'opal', 'metal', 'copperRed',
]);

const s = blankSave();
const owned = { glaze: () => s.glazes, body: () => s.bodies };
const missing = { glaze: [], body: [], effect: [], form: [], temp: [] };
let lastPay = 0, sags = [];

console.log('   #   commission                      needs         have?   pay   rep');
COMMISSIONS.forEach((c, i) => {
  const r = c.require || {};
  const wants = [];

  if (r.glaze) {
    const has = s.glazes.includes(r.glaze);
    wants.push(`${GLAZE_BY_ID[r.glaze]?.name ?? r.glaze}${has ? '' : '  <-- NOT YET'}`);
    if (!has) missing.glaze.push(`${c.id} asks for ${r.glaze}, which it unlocks itself`);
  }
  if (r.body) {
    const has = s.bodies.includes(r.body);
    wants.push(`${BODIES.find((b) => b.id === r.body)?.name ?? r.body}${has ? '' : '  <-- NOT YET'}`);
    if (!has) missing.body.push(`${c.id} asks to be thrown in ${r.body}, which the player does not have`);
  }
  if (r.effect && !REAL_EFFECTS.has(r.effect)) missing.effect.push(`${c.id} asks for "${r.effect}", which nothing can produce`);
  if (r.form && !FORMS[r.form]) missing.form.push(`${c.id} asks for the form "${r.form}", which does not exist`);

  // a temperature bound that cannot contain the glaze it is asked of
  if (r.glaze && GLAZE_BY_ID[r.glaze]) {
    const mat = maturePoint(GLAZE_BY_ID[r.glaze]);
    if (r.minPeak && mat < r.minPeak - 165) missing.temp.push(`${c.id}: ${r.glaze} matures at ${Math.round(mat)}, brief demands at least ${r.minPeak}`);
    if (r.maxPeak && mat > r.maxPeak + 165) missing.temp.push(`${c.id}: ${r.glaze} matures at ${Math.round(mat)}, brief forbids above ${r.maxPeak}`);
  }

  if (c.pay < lastPay * 0.7) sags.push(`${c.id} pays ${c.pay} after ${lastPay}`);
  lastPay = c.pay;

  console.log(`   ${String(i + 1).padStart(2)}  ${c.title.slice(0, 30).padEnd(31)} ${(wants.join(' + ') || '-').padEnd(38)} ${String(c.pay).padStart(4)}  ${String(c.rep).padStart(4)}`);

  // completing it
  if (c.unlocks?.glaze) unlock(s, 'glaze', c.unlocks.glaze);
  if (c.unlocks?.body) unlock(s, 'body', c.unlocks.body);
  if (c.unlocks?.title) unlock(s, 'title', c.unlocks.title);
});

console.log('');
ok(missing.glaze.length === 0,
   `every brief asks for a glaze the player already has${missing.glaze.length ? ':' + NL + '            ' + missing.glaze.join(NL + '            ') : ''}`);
ok(missing.body.length === 0,
   `and for a clay they already have${missing.body.length ? ':' + NL + '            ' + missing.body.join(NL + '            ') : ''}`);
ok(missing.effect.length === 0,
   `every effect asked for is one the kiln can produce${missing.effect.length ? ':' + NL + '            ' + missing.effect.join(NL + '            ') : ''}`);
ok(missing.form.length === 0,
   `every form asked for exists${missing.form.length ? ': ' + missing.form.join(', ') : ''}`);
ok(missing.temp.length === 0,
   `no brief fixes a temperature its own glaze cannot mature at${missing.temp.length ? ':' + NL + '            ' + missing.temp.join(NL + '            ') : ''}`);

/* ---- the shelf is worth filling ---------------------------------- */
{
  const unlocked = new Set(COMMISSIONS.flatMap((c) => (c.unlocks?.glaze ? [c.unlocks.glaze] : [])));
  const asked = new Set(COMMISSIONS.map((c) => c.require?.glaze).filter(Boolean));
  const never = GLAZES.map((g) => g.id).filter((g) => !asked.has(g));
  console.log(`         ${unlocked.size} glazes are given out, ${asked.size} are ever asked for`);
  ok(unlocked.size >= GLAZES.length - 2,
     `the campaign hands out all but the two you start with (${unlocked.size} of ${GLAZES.length - 2})`);
  ok(never.length <= 2,
     `almost every glaze is asked for by name at some point ` +
     `(never asked for: ${never.length ? never.join(', ') : 'none'})`);
}

/* ---- the money works --------------------------------------------- */
{
  console.log('');
  ok(sags.length === 0, `the fee never falls away sharply${sags.length ? ': ' + sags.join('; ') : ''}`);

  // walk it again, buying clay, paying for wood and firing, at a
  // middling standard of work
  let coin = blankSave().coin, broke = null, clayTotal = 0, woodTotal = 0;
  const MIDDLING = 72;
  const BALL = 1500;   // an ordinary ball; clay is priced against it
  COMMISSIONS.forEach((c) => {
    const g = GLAZE_BY_ID[c.require?.glaze] ?? GLAZE_BY_ID.ash;
    // the brief may name the clay; otherwise the cheapest will do
    const b = BODIES.find((x) => x.id === c.require?.body) ?? BODIES[0];
    const clay = Math.max(1, Math.round(b.price * BALL / 1500));
    const wood = fuelCost(guildSchedule([g], { meanWall: 0.45 }, c.require));
    clayTotal += clay; woodTotal += wood;
    if (clay + wood > coin && !broke) {
      broke = `${c.id}: ${clay} for clay and ${wood} for wood, ${coin} in the purse`;
    }
    coin -= clay + wood;
    coin += Math.round(c.pay * payMultiplier(MIDDLING, true));
  });
  console.log(`         a middling potter spends ${clayTotal} on clay and ${woodTotal} on wood, ` +
              `and finishes with ${coin} ash-marks`);
  ok(!broke, `and is never unable to buy the clay and light the kiln${broke ? ' — ' + broke : ''}`);
  ok(coin > 0, 'the campaign is not a slow bankruptcy');
  ok(clayTotal > 0, `the clay is actually paid for (${clayTotal} marks across the campaign)`);
}

/* ---- the rank ladder is reachable -------------------------------- */
{
  // A commission's `rep` is a base, not a payout: appraise multiplies it
  // by payMultiplier(total, briefOk) * 0.9, which is 1.81 for perfect
  // work and about 1.21 for a middling pot. Comparing the bare sum
  // against the ladder is comparing the wrong number.
  const base = COMMISSIONS.reduce((a, c) => a + c.rep, 0);
  const top = RANKS[RANKS.length - 1];
  const at = (score) => Math.round(base * payMultiplier(score, true) * 0.9);
  console.log(`         the ladder tops out at ${top.at} rep ("${top.name}")`);
  console.log(`         the campaign is worth ${at(100)} played perfectly, ${at(72)} played middlingly, ` +
              `${at(50)} scraped through`);
  ok(at(100) >= top.at,
     `playing every commission perfectly reaches the last rank (${at(100)} of ${top.at})`);
  ok(at(50) < top.at,
     `and scraping through every one of them does not (${at(50)} of ${top.at})`);

  /* WHEN it arrives, not only whether. The ledger paints rankFor(rep) in
     the corner of the screen at all times, so a ladder that tops out
     halfway leaves the back half of the campaign with no progression at
     all and hands the player the last title ten jobs before the
     commission that ceremonially confers it. */
  const arrivesAt = (score) => {
    let rep = 0;
    for (let i = 0; i < COMMISSIONS.length; i++) {
      rep += Math.round(COMMISSIONS[i].rep * payMultiplier(score, true) * 0.9);
      if (rep >= top.at) return i + 1;
    }
    return Infinity;
  };
  const perfect = arrivesAt(100), middling = arrivesAt(72);
  const n = COMMISSIONS.length;
  console.log(`         "${top.name}" is reached at commission ${perfect} of ${n} played perfectly, ` +
              `${middling === Infinity ? 'never' : middling} played middlingly`);
  ok(perfect > n * 0.7,
     `the last rank is not handed out in the first two thirds of the campaign ` +
     `(commission ${perfect} of ${n})`);
}

/* ---- and the work that comes after it ----------------------------- */
{
  console.log('');
  /* The endless mode used to open at ninety marks — a ninety per cent
     cut the moment the campaign's nine-hundred-mark finale was behind
     you — and it generated a form, a glaze, a height and a wall and
     nothing else, so every job after the campaign was the same job.
     Both are worth holding down, and so is the thing that makes a
     generated brief dangerous: it is written by a dice roll, and a dice
     roll can ask for an effect the named glaze has no way to produce. */
  const rng = Object.assign(() => (rng._s = (rng._s * 16807) % 2147483647) / 2147483647, { _s: 12345 });
  rng.pick = (a) => a[Math.floor(rng() * a.length) % a.length];

  const allGlazes = GLAZES.map((g) => g.id);
  const allBodies = BODIES.map((b) => b.id);
  const made = [];
  for (let n = 1; n <= 200; n++) made.push(proceduralCommission(rng, n, allGlazes, allBodies));

  const impossible = made.filter((c) => {
    const fx = c.require.effect;
    if (!fx) return false;
    return !(EFFECTS_FOR[c.require.glaze] ?? []).includes(fx);
  });
  ok(impossible.length === 0,
     `no generated brief asks a glaze for an effect it cannot produce (200 drawn)` +
     `${impossible.length ? ': ' + impossible.slice(0, 3).map((c) => `${c.require.glaze}+${c.require.effect}`).join(', ') : ''}`);

  /* And the pairings the table promises are real. This is the guard on
     EFFECTS_FOR itself: if the chemistry moves under it, a generated
     brief starts asking for something the kiln stopped producing, and
     nothing else in the game would ever say so. */
  const GATE = { crystal: 0.4, oilspot: 0.3, hare: 0.4, carbon: 0.4, craze: 0.45, peel: 0.4, opal: 0.45, metal: 0.4 };
  const body = { meanWall: 0.45, coe: 6.4 };
  const broken = [];
  for (const [gid, list] of Object.entries(EFFECTS_FOR)) {
    for (const fx of list) {
      if (fx === 'copperRed') continue;    // checked by its own commission
      const g = GLAZE_BY_ID[gid];
      let best = 0;
      for (const t of [0.08, 0.11, 0.14, 0.18, 0.22]) {
        const r = fire([{ glaze: g, coverage: 0.86, meanThick: t }], guildSchedule([g], body, { effect: fx }), body);
        if (!r.destroyed) best = Math.max(best, r[fx] ?? 0);
      }
      if (best < GATE[fx]) broken.push(`${gid} cannot show ${fx} (${best.toFixed(2)} of ${GATE[fx]})`);
    }
  }
  ok(broken.length === 0,
     `every pairing the table promises comes out of the kiln` +
     `${broken.length ? ':' + NL + '            ' + broken.join(NL + '            ') : ''}`);

  const first = made[0], later = made[49];
  const lastCampaign = COMMISSIONS[COMMISSIONS.length - 1];
  console.log(`         the campaign ends at ${lastCampaign.pay} marks; the first standing order pays ` +
              `${first.pay}, the fiftieth ${later.pay}`);
  ok(first.pay > lastCampaign.pay * 0.4,
     `finishing the campaign is not answered with a ninety per cent pay cut ` +
     `(${first.pay} after ${lastCampaign.pay})`);
  ok(later.pay > first.pay, 'and the standing orders climb rather than flatten');

  const withEffect = made.filter((c) => c.require.effect).length;
  const withAtmos = made.filter((c) => c.require.atmos).length;
  const withBody = made.filter((c) => c.require.body).length;
  console.log(`         of 200 drawn: ${withEffect} name an effect, ${withAtmos} an atmosphere, ${withBody} a clay`);
  ok(withEffect + withAtmos + withBody > 60,
     `the endless work asks for more than a shape and a colour ` +
     `(${withEffect + withAtmos + withBody} of 200 carry something else)`);
}

console.log(bad ? NL + `  ${bad} FAILED` + NL
                : NL + '  it can be played from an empty save, in order, without cheating' + NL);
process.exit(bad ? 1 : 0);
