// ============================================================
//  Three layers, and what happens when you ask for a fourth.
//
//  A pot carries three glazes: the field is an RGBA texture and the
//  three colour channels are the three coat thicknesses, with the alpha
//  holding the wax. That is a real limit, not a rule someone invented.
//
//  What was NOT real was the way the fourth pick behaved. It took the
//  third slot and said nothing, leaving the paint exactly where it was
//  on the pot while the layer it lived in came to name a different
//  glaze — so every stroke of tenmoku silently became shino, with a
//  different colour, a different chemistry, a different maturing
//  temperature, and no undo in the glaze room to take it back.
//
//  What is held down here: browsing costs nothing, painting costs a
//  layer, and nothing you have painted is ever taken away from you.
//
//  Run:  node src/dev/slots.mjs
// ============================================================
import { game, step } from './realgame.mjs';
import { GLAZE_BY_ID } from '../sim/glaze.js';
import { SLOTS } from '../sim/glaze.js';

let bad = 0;
const NL = String.fromCharCode(10);
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };

/* The headless HUD is a stub; these two are display only. */
const toasts = [];
game.hud.updateGlazeSelection = () => {};
game.hud.toast = (t) => { toasts.push(String(t)); };

console.log(NL + '  THREE LAYERS' + NL);

game.startThrow(); step(150);
game.startTrim(); step(30);
game.startGlaze(); step(30);

const F = game.field;
const own = (id) => { if (!game.save.glazes.includes(id)) game.save.glazes.push(id); };
const ids = () => game.slots.map((s) => (s ? s.id : null));
const paint = (ch) => { let s = 0; for (let i = ch; i < F.data.length; i += 4) s += F.data[i]; return s; };

ok(SLOTS === 3, `a pot carries ${SLOTS} glaze layers`);

/* ---- 1. opening buckets to look costs nothing --------------------- */
{
  F.clear();
  game.slots = [null, null, null];
  for (const id of ['ash', 'celadon', 'tenmoku', 'shino', 'oxblood', 'chun']) {
    own(id);
    game._pickGlaze(id);
  }
  console.log(`         six buckets opened without painting: ${JSON.stringify(ids())}`);
  ok(ids()[2] === 'chun',
     'reading down the shelf swaps the bucket in your hand, not the pot: the ' +
     'last one looked at is the one you are holding');
  ok(game.slots.filter(Boolean).length === 3,
     'and it never accumulates more than three');
  ok(paint(0) + paint(1) + paint(2) === 0, 'no glaze went on the pot');
}

/* ---- 2. a layer you have painted with is not taken away ----------- */
{
  F.clear();
  game.slots = [null, null, null];
  const laid = {};
  let ang = 0.15;
  for (const id of ['ash', 'celadon', 'tenmoku']) {
    own(id);
    game._pickGlaze(id);
    F.brush(ang, 0.5, 0.09, game.slotIndex, 0.4);
    F.upload();
    laid[id] = { slot: game.slotIndex, sum: paint(game.slotIndex) };
    ang += 0.2;
  }
  const before = ids();
  const paintBefore = [paint(0), paint(1), paint(2)];
  console.log(`         three glazes painted on: ${JSON.stringify(before)}`);

  toasts.length = 0;
  own('shino');
  game._pickGlaze('shino');
  const after = ids();

  ok(JSON.stringify(before) === JSON.stringify(after),
     `a fourth glaze does not displace one that is already on the pot ` +
     `(${JSON.stringify(after)})`);
  ok(JSON.stringify(paintBefore) === JSON.stringify([paint(0), paint(1), paint(2)]),
     'and not a stroke of what was painted is changed');
  ok(F.slotIds[2] === 'tenmoku',
     `the third layer still means the glaze it was painted with (${F.slotIds[2]})`);
  ok(toasts.some((t) => /already carrying/i.test(t)),
     `and the player is told why, in words: "${(toasts[0] || '').slice(0, 72)}..."`);
  ok(!game._glazeRoomLeft(), 'the game knows there is no room left');
}

/* ---- 3. an opened-but-unused layer is still free ------------------ */
{
  F.clear();
  game.slots = [null, null, null];
  own('ash'); game._pickGlaze('ash');
  F.brush(0.2, 0.5, 0.09, game.slotIndex, 0.4); F.upload();
  own('celadon'); game._pickGlaze('celadon');
  F.brush(0.5, 0.5, 0.09, game.slotIndex, 0.4); F.upload();
  own('tenmoku'); game._pickGlaze('tenmoku');   // opened, never used

  ok(game._glazeRoomLeft(), 'a bucket opened and not used leaves room');
  toasts.length = 0;
  own('shino'); game._pickGlaze('shino');
  ok(ids()[2] === 'shino',
     `so changing your mind about it costs nothing (${JSON.stringify(ids())})`);
  ok(!toasts.some((t) => /already carrying/i.test(t)), 'and nobody is told off for it');
  ok(paint(0) > 0 && paint(1) > 0 && paint(2) === 0,
     'the two layers that were painted are untouched, the third is still clean');
}

/* ---- 4. picking a glaze already on the pot just selects it -------- */
{
  const wasIds = ids();
  const wasPaint = [paint(0), paint(1), paint(2)];
  game._pickGlaze('ash');
  ok(game.slotIndex === 0, 'reaching for a glaze already on the pot goes back to its layer');
  ok(JSON.stringify(ids()) === JSON.stringify(wasIds)
     && JSON.stringify([paint(0), paint(1), paint(2)]) === JSON.stringify(wasPaint),
     'and changes nothing else');
}

/* ---- 5. hasPaint tells the truth ---------------------------------- */
{
  F.clear();
  ok(!F.hasPaint(0) && !F.hasPaint(1) && !F.hasPaint(2), 'a cleared field has no paint in it');
  F.brush(0.5, 0.5, 0.09, 1, 0.4);
  ok(!F.hasPaint(0) && F.hasPaint(1) && !F.hasPaint(2),
     'and a stroke in one layer is seen in that layer and no other');
  ok(!F.hasPaint(3) && !F.hasPaint(-1),
     'the wax channel is not a glaze layer, and neither is nothing');
}

console.log(bad ? NL + `  ${bad} FAILED` + NL
                : NL + '  browsing is free, painting costs a layer, and nothing is taken back' + NL);
process.exit(bad ? 1 : 0);
