// Can you get OUT of a bad shape?
//
// The report: at some point widening or narrowing stops moving the pot
// and starts pinching one thin band of it, and that band cannot be got
// back. So this makes a crease the way a player would, then tries every
// stroke the game offers to remove it, and measures.
import { openedPot, drag, hold, radiiAt, NS } from './harness.mjs';

// how kinked is the silhouette? biggest jump between neighbouring rings
function roughness(c) {
  // Only the wall. Where the floor turns up into the side there is a
  // corner by design, and a foot ring is not a defect.
  const lo = c.floorSection() + 5;
  let worst = 0, at = 0;
  for (let i = lo; i < NS - 2; i++) {
    if (!c.isWall(i) || !c.isWall(i - 1)) continue;
    const a = (c.ri[i - 1] + c.ro[i - 1]) * 0.5;
    const b = (c.ri[i] + c.ro[i]) * 0.5;
    const d = Math.abs(b - a) / Math.max(1e-4, c.dy[i]);   // cm of radius per cm of height
    if (d > worst) { worst = d; at = i; }
  }
  return { worst, at };
}
const show = (t, c) => { const r = roughness(c);
  console.log(`  ${t.padEnd(30)} H=${c.height.toFixed(1).padStart(5)} D=${(c.maxR*2).toFixed(1).padStart(5)}` +
    `  kink=${r.worst.toFixed(2)}@${r.at}  floor=${c.floorSection()} open=${c.isOpen()?'y':'n'}` +
    `  wall=${c.metrics().meanWall.toFixed(2)}`); return r.worst; };

console.log('\n  MAKING A CREASE, THEN TRYING TO GET IT OUT\n');
const c = openedPot({ mass: 1100, seed: 5 });
show('opened', c);

// a few normal widening strokes, all at the same height - what a player
// does when they are trying to open a bowl out
for (let i = 0; i < 6; i++) {
  const y = Math.max(1.5, c.height * 0.45);
  const rr = radiiAt(c, y);
  const m = (rr.ri + rr.ro) * 0.5;
  drag(c, m, y, m + 2.4, y, 0.6);
}
const made = show('after 6 widening strokes', c);

// now try to get it out, the way a player would
const yk = c.ymid(roughness(c).at);
for (let i = 0; i < 6; i++) {
  const rr = radiiAt(c, yk);
  hold(c, (rr.ri + rr.ro) * 0.5, yk, 1.2);
}
const held = show('6 s of a steady hand', c);

for (let i = 0; i < 4; i++) {
  const rr = radiiAt(c, Math.max(1.5, c.height * 0.5));
  const m = (rr.ri + rr.ro) * 0.5;
  drag(c, m, 1.4, m, Math.max(3, c.height - 0.6), 1.0);   // lift through it
}
const lifted = show('4 lifts through it', c);

console.log(`\n  crease made: ${made.toFixed(2)}   after steadying: ${held.toFixed(2)}   after lifting: ${lifted.toFixed(2)}`);
const ok = made < 1.2 || held < made * 0.6 || lifted < made * 0.6;
console.log(ok ? '\n  a bad shape can be worked back\n' : '\n  THE CREASE WILL NOT COME OUT — the pot is a dead end\n');
process.exit(ok ? 0 : 1);
