// ============================================================
//  Does a save survive the campaign changing shape?
//
//  Progress through the campaign is stored as a POSITION in the
//  COMMISSIONS array, and the campaign has just grown from twelve to
//  twenty-four, mostly in the middle. Left alone, a player who had
//  finished five commissions would be handed whichever job now sits
//  sixth, and one who had finished the whole thing would be dropped
//  back into the middle of it.
//
//  Neither the game nor any other bench can see that: it is a property
//  of an old save meeting a new list, and there is no old save in the
//  repository to meet it with. So this makes one.
//
//  Run:  node src/dev/savemig.mjs
// ============================================================
import { COMMISSIONS } from '../game/lore.js';

const store = {};
globalThis.localStorage = {
  getItem: (k) => store[k] ?? null,
  setItem: (k, v) => { store[k] = v; },
  removeItem: (k) => { delete store[k]; },
};

const { load, blankSave } = await import('../game/save.js');

let bad = 0;
const NL = String.fromCharCode(10);
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };

console.log(NL + '  AN OLD SAVE MEETS A LONGER CAMPAIGN' + NL);

/* The twelve the old versions counted against. */
const OLD = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12'];

const put = (o) => { store['celadon.save.v1'] = JSON.stringify({ ...blankSave(), ...o }); };
const nextOf = (s) => (s.commission < COMMISSIONS.length ? COMMISSIONS[s.commission].id : '(procedural)');

console.log(`         the campaign is ${COMMISSIONS.length} commissions now, and was ${OLD.length}` + NL);

/* What must hold is not that the next job is the SAME one — a
   commission inserted just after the last one they finished is new
   content landing exactly where it belongs, and handing it to them is
   right. What must hold is that nobody is sent backwards: the job they
   are given must never be one they have already done. */
const backwards = [];
for (const v of [1, 2]) {
  for (const done of [0, 1, 5, 8, 12]) {
    put({ v, commission: done, coin: 300, rep: 900 });
    const s = load();
    const finished = OLD.slice(0, done);
    const nowPlays = nextOf(s);
    const repeat = finished.includes(nowPlays);
    if (repeat) backwards.push(`v${v} at ${done}: handed ${nowPlays} again`);
    console.log(
      `         v${v} save, ${String(done).padStart(2)} done  ->  v${s.v}, index ${String(s.commission).padStart(2)}` +
      `   next job ${nowPlays.padEnd(13)}${repeat ? '  ALREADY DONE' : ''}`);
  }
}

console.log('');
ok(backwards.length === 0,
   `no old save is sent back to a commission it has already finished` +
   `${backwards.length ? ':' + NL + '            ' + backwards.join(NL + '            ') : ''}`);

/* A finished campaign stays finished. */
{
  put({ v: 1, commission: 12, proceduralN: 4 });
  const s = load();
  ok(s.commission >= COMMISSIONS.length,
     `a player who had finished the old campaign is still finished, not returned to the middle ` +
     `(index ${s.commission} of ${COMMISSIONS.length})`);
}

/* A current save is not touched. */
{
  put({ v: 3, commission: 7 });
  const s = load();
  ok(s.commission === 7 && s.v === 3, 'a current save is passed through unchanged');
}

/* Nonsense is not trusted. */
{
  store['celadon.save.v1'] = JSON.stringify({ v: 99, commission: 5 });
  ok(load().commission === 0, 'a save from a version that does not exist yet is not read');
  store['celadon.save.v1'] = '{ not json';
  const warn = console.warn; console.warn = () => {};   // the warning is the point, not the noise
  ok(load().commission === 0, 'and neither is a corrupted one');
  console.warn = warn;
}

console.log(bad ? NL + `  ${bad} FAILED` + NL
                : NL + '  an old save comes back to the job it was on' + NL);
process.exit(bad ? 1 : 0);
