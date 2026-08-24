// ============================================================
//  Can a player actually make the pot wider — and keep going?
//
//  The report from the wheel: "at first it works, then it gets very
//  hard and progress stops." So this does not ask whether one drag
//  widens the pot; it asks whether the TWELFTH drag still does.
//
//  Run:  node src/dev/widen.mjs
// ============================================================

import { game, radiiAt, dragCm, M } from './realgame.mjs';
import { COMMISSIONS } from '../game/lore.js';

const c = () => game.clay;

// centre and open, the way the coach tells you to
for (let i = 0; i < 5; i++) {
  const R = c().maxR;
  dragCm(R * 0.95, 1.2, R * 0.80, c().height * 0.85, 0.5);
  dragCm(R * 0.80, c().height * 0.85, R * 0.95, 1.2, 0.5);
}
for (let i = 0; i < 10 && !c().isOpen(); i++) {
  dragCm(0.25, c().height * 0.92, 0.35, 1.1, 0.5);
  dragCm(0.35, 1.1, c().maxR * 0.62, 1.2, 0.6);
}

console.log('\n  TWELVE HONEST ATTEMPTS TO WIDEN THE POT\n');
console.log('  pass   width    gained   height   wall   moist  plast   conv   rate');
console.log('  ----   ------   ------   ------   ----   -----  -----   ----   ----');

let prev = M().diameter;
let stalled = 0, firstStall = -1, lateFrom = 0;
for (let pass = 1; pass <= 12; pass++) {
  if (pass === 9) lateFrom = M().diameter;
  const y = Math.max(1.5, c().height * 0.55);
  const rr = radiiAt(c(), y);
  const mid = (rr.ri + rr.ro) * 0.5;

  // the numbers shape() will be working from, at the ring under the hand
  const i = c().sectionAt(y);
  const wall = c().wall(i);
  const plast = c().plasticity(i);
  const conv = Math.min(3.4, Math.max(0.30, wall / 0.34));

  dragCm(mid, y, mid + 2.6, y, 0.7);

  const d = M().diameter, gained = d - prev;
  if (gained < 0.35) { stalled++; if (firstStall < 0) firstStall = pass; }
  console.log(`  ${String(pass).padStart(4)}   ${d.toFixed(1).padStart(6)}   ` +
    `${(gained >= 0 ? '+' : '') + gained.toFixed(2)}`.padStart(6) +
    `   ${M().height.toFixed(1).padStart(6)}   ${wall.toFixed(2)}   ` +
    `${(M().moisture * 100).toFixed(0).padStart(5)}  ${plast.toFixed(2)}   ${conv.toFixed(2)}   ` +
    `${(plast * conv).toFixed(2)}` + (gained < 0.35 ? '   <-- STALLED' : ''));
  prev = d;
}

// The complaint this bench exists for was not "it never widens", it was
// "it widens, and then quietly stops paying out". So the twelfth stroke
// has to still be worth something, not just the first.
const late = M().diameter - lateFrom;
const ok = stalled === 0 && late > 2.0 && !c().dead;
console.log('');
console.log(`  ${stalled} of 12 passes did nothing`
  + (firstStall > 0 ? `, first at pass ${firstStall}` : ''));
console.log(`  the last four strokes were still worth ${late.toFixed(1)} cm of width`);
console.log('');
console.log(ok ? '  widening keeps paying out'
               : '  WIDENING STALLS — this is what players complain about');
console.log('');
process.exit(ok ? 0 : 1);
