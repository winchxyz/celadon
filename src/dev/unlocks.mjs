// ============================================================
//  Can the campaign actually be played from one end to the other?
//
//  Unlocking is by array index and nothing else: s.commission is a
//  plain counter into COMMISSIONS, and rank, reputation and the day are
//  read nowhere in the decision. So the order of that array IS the
//  campaign, and a brief that asks for a glaze the player has not been
//  given yet is not a difficulty spike — it is a wall, with no way past
//  it and nothing on screen to explain why.
//
//  Nothing tested this, and it is one careless move away at all times.
//  Four glazes in the current order are handed over by the immediately
//  preceding commission: one slot of margin each. Swap any of those
//  pairs — while tuning pay, say — and the campaign stops dead at that
//  index for every player, forever, and every existing save is stuck
//  too because the counter never goes backwards.
//
//  Run:  node src/dev/unlocks.mjs
// ============================================================

import { COMMISSIONS, BODIES, FORMS, proceduralCommission } from '../game/lore.js';
import { GLAZES, GLAZE_BY_ID, EFFECTS_FOR } from '../sim/glaze.js';
import { blankSave } from '../game/save.js';

let bad = 0;
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };
const NL = String.fromCharCode(10);

console.log(NL + '  CAN THE CAMPAIGN BE PLAYED THROUGH?' + NL);

const start = blankSave();
const glazeIds = new Set(GLAZES.map((g) => g.id));
const bodyIds = new Set(BODIES.map((b) => b.id));

/* ------------------------------------------------------------------ */
console.log('  --- the catalogue the briefs point at ---');

ok(start.glazes.every((g) => glazeIds.has(g)),
  `the starting glazes exist (${start.glazes.join(', ')})`);
ok(start.bodies.every((b) => bodyIds.has(b)),
  `the starting bodies exist (${start.bodies.join(', ')})`);

const ids = COMMISSIONS.map((c) => c.id);
ok(new Set(ids).size === ids.length,
  `every commission id is unique (${ids.length} of them)`);

let dangling = [];
for (const c of COMMISSIONS) {
  const r = c.require ?? {};
  if (r.glaze && !glazeIds.has(r.glaze)) dangling.push(`${c.id} requires glaze "${r.glaze}"`);
  if (r.body && !bodyIds.has(r.body)) dangling.push(`${c.id} requires body "${r.body}"`);
  if (r.form && !FORMS[r.form]) dangling.push(`${c.id} requires form "${r.form}"`);
  if (c.unlocks?.glaze && !glazeIds.has(c.unlocks.glaze)) dangling.push(`${c.id} grants glaze "${c.unlocks.glaze}"`);
  if (c.unlocks?.body && !bodyIds.has(c.unlocks.body)) dangling.push(`${c.id} grants body "${c.unlocks.body}"`);
}
ok(dangling.length === 0, `no brief points at something that does not exist${dangling.length ? ': ' + dangling.join('; ') : ''}`);

/* An effect can only be asked for if the glaze in the same brief can
   actually produce it. The comment above COMMISSIONS records that
   'matureOnly' was listed as a legal effect for a long time and was
   never implemented, so a brief asking for it could never be met — that
   is exactly the shape of failure this catches. */
const mismatched = [];
for (const c of COMMISSIONS) {
  const r = c.require ?? {};
  if (!r.effect) continue;
  const can = EFFECTS_FOR[r.glaze] ?? [];
  if (!can.includes(r.effect)) {
    mismatched.push(`${c.id}: wants "${r.effect}" from ${r.glaze}, which does ${can.length ? can.join('/') : 'no effects at all'}`);
  }
}
ok(mismatched.length === 0,
  `every requested effect is one its own glaze can make${mismatched.length ? NL + '           ' + mismatched.join(NL + '           ') : ''}`);

/* ------------------------------------------------------------------ */
console.log(NL + '  --- walking the campaign in order ---');

const glazes = new Set(start.glazes);
const bodies = new Set(start.bodies);
const grantedAt = new Map();
start.glazes.forEach((g) => grantedAt.set(g, 0));
const blocked = [];
const slack = [];

COMMISSIONS.forEach((c, i) => {
  const at = i + 1;
  const r = c.require ?? {};
  if (r.glaze && !glazes.has(r.glaze)) {
    blocked.push(`#${at} ${c.id} needs glaze "${r.glaze}", granted ${grantedAt.has(r.glaze) ? 'at #' + grantedAt.get(r.glaze) : 'never'}`);
  } else if (r.glaze) {
    const got = grantedAt.get(r.glaze) ?? 0;
    if (got > 0 && !slack.some((s) => s.glaze === r.glaze)) slack.push({ glaze: r.glaze, got, need: at, gap: at - got });
  }
  if (r.body && !bodies.has(r.body)) blocked.push(`#${at} ${c.id} needs body "${r.body}", not yet granted`);

  if (c.unlocks?.glaze) { glazes.add(c.unlocks.glaze); grantedAt.set(c.unlocks.glaze, at); }
  if (c.unlocks?.body) bodies.add(c.unlocks.body);
});

ok(blocked.length === 0,
  `every one of the ${COMMISSIONS.length} briefs is satisfiable when it is handed over`
  + (blocked.length ? NL + '           ' + blocked.join(NL + '           ') : ''));

console.log(NL + '     margin between a glaze arriving and first being demanded:');
slack.sort((a, b) => a.gap - b.gap);
for (const s of slack) {
  console.log(`       ${s.glaze.padEnd(9)} granted #${String(s.got).padStart(2)}  demanded #${String(s.need).padStart(2)}  margin ${s.gap}`);
}
/* Blocked briefs are not in `slack` at all — they never got a margin,
   they got a wall. Folding `blocked` into this test stops it printing a
   reassuring "ok" underneath a campaign that cannot be finished. */
const tightest = slack.length ? slack[0].gap : 99;
ok(blocked.length === 0 && tightest >= 1,
  `nothing is demanded before it is granted (tightest margin ${tightest}${blocked.length ? `, but ${blocked.length} brief(s) are walled off entirely` : ''})`);

/* Not a failure — a standing note that these are the pairs a reorder
   would break first. */
const onTheEdge = slack.filter((s) => s.gap === 1);
if (onTheEdge.length) {
  console.log(NL + `     NOTE: ${onTheEdge.length} glaze(s) arrive one commission before they are needed`);
  console.log(`     (${onTheEdge.map((s) => s.glaze).join(', ')}) — reordering across those pairs breaks the campaign.`);
}

/* ------------------------------------------------------------------ */
console.log(NL + '  --- and the endless work after it ---');

/* The procedural generator is handed the unlocked sets, so it must not
   be able to ask for anything outside them. Run a lot of them. */
let seed = 1;
const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
rng.pick = (a) => a[Math.floor(rng() * a.length)];
rng.range = (a, b) => a + rng() * (b - a);

const unlockedG = [...glazes], unlockedB = [...bodies];
const strays = [];
for (let n = 1; n <= 400; n++) {
  const c = proceduralCommission(rng, n, unlockedG, unlockedB);
  const r = c.require ?? {};
  if (r.glaze && !glazes.has(r.glaze)) strays.push(`#${n} asks for locked glaze "${r.glaze}"`);
  if (r.body && !bodies.has(r.body)) strays.push(`#${n} asks for locked body "${r.body}"`);
  if (r.effect && !(EFFECTS_FOR[r.glaze] ?? []).includes(r.effect)) {
    strays.push(`#${n} asks "${r.effect}" from ${r.glaze}, which cannot make it`);
  }
  if (r.form && !FORMS[r.form]) strays.push(`#${n} asks for form "${r.form}"`);
}
ok(strays.length === 0,
  `400 procedural briefs stay inside what the player owns`
  + (strays.length ? NL + '           ' + strays.slice(0, 6).join(NL + '           ')
    + (strays.length > 6 ? NL + `           ...and ${strays.length - 6} more` : '') : ''));

console.log(NL + (bad ? `  ${bad} FAILED` : '  the campaign can be finished') + NL);
process.exit(bad ? 1 : 0);
