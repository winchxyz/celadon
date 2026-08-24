// ============================================================
//  Does anything grow through anything else?
//
//  Interpenetrating geometry is the loudest possible tell that nobody
//  built the thing you are looking at. The room shipped with three
//  kinds of it at once, and none of it was visible from the default
//  camera, which is exactly why it survived:
//
//    - three pairs of pots on the drying shelves grew through each
//      other, the worst by 11.7 cm, and the lathe is DoubleSide so an
//      overlap shows one pot's inner wall coming out of another's side;
//    - the 24-radius flywheel passed through all four legs, whose
//      inner faces stood at 16;
//    - and the four centring rings sat 1.12 cm INSIDE the solid wheel
//      head, so the one piece of surface detail on the object the
//      player stares at all game had never once rendered.
//
//  The Studio builds fine with a stubbed renderer, so this needs no GL.
//  World-space boxes throughout: the rings are rotated, and reading a
//  geometry's own bounding box ignores that and gets the answer wrong.
// ============================================================
import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { Studio } from '../render/studio.js';

const scene = new THREE.Scene();
const studio = new Studio(scene, { capabilities: { getMaxAnisotropy: () => 8 } });
scene.updateMatrixWorld(true);

// `precise` walks the actual vertices. Without it Box3 takes the
// geometry's own AABB and transforms its eight CORNERS, so any rotated
// object reports a box inflated by up to a factor of root two — which
// made a radially symmetric pot of radius 8.4 measure 10.9 and produced
// a page of intersections that were not there.
const box = (o) => new THREE.Box3().setFromObject(o, true);
const overlap1D = (a0, a1, b0, b1) => Math.min(a1, b1) - Math.max(a0, b0);

let bad = 0;
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };

console.log('\n  DOES ANYTHING GROW THROUGH ANYTHING ELSE?\n');

/* ---- the drying shelves ---------------------------------------- */
const pots = studio.shelfPots.map((m) => {
  const b = box(m);
  return {
    x: (b.min.x + b.max.x) / 2, y: Math.round((b.min.y + b.max.y) / 2 * 10) / 10,
    z: (b.min.z + b.max.z) / 2,
    r: Math.max(b.max.x - b.min.x, b.max.z - b.min.z) / 2, b,
  };
});
const byShelf = new Map();
for (const p of pots) {
  const key = Math.round(p.b.min.y);
  if (!byShelf.has(key)) byShelf.set(key, []);
  byShelf.get(key).push(p);
}
let worst = 0, pairs = 0;
for (const group of byShelf.values()) {
  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      const d = Math.hypot(group[i].x - group[j].x, group[i].z - group[j].z);
      const gap = group[i].r + group[j].r - d;
      if (gap > 0) { pairs++; worst = Math.max(worst, gap); }
    }
  }
}
ok(pairs === 0, `no two pots on a shelf grow through each other` +
   (pairs ? ` — ${pairs} pair(s), worst ${worst.toFixed(1)} cm` : ` (${pots.length} pots)`));

/* ---- the pots against the rack they stand in -------------------- */
const posts = [];
studio.rack.traverse((o) => {
  if (!o.isMesh) return;
  const b = box(o);
  // an upright is far taller than it is wide
  if (b.max.y - b.min.y > 100 && b.max.x - b.min.x < 20) posts.push(b);
});
let hitPosts = 0;
for (const p of pots) {
  for (const q of posts) {
    if (overlap1D(p.b.min.x, p.b.max.x, q.min.x, q.max.x) > 0.1 &&
        overlap1D(p.b.min.z, p.b.max.z, q.min.z, q.max.z) > 0.1 &&
        overlap1D(p.b.min.y, p.b.max.y, q.min.y, q.max.y) > 0.1) hitPosts++;
  }
}
ok(hitPosts === 0, `no pot grows through a rack upright (${posts.length} uprights)`);

/* ---- the wheel: flywheel against the legs ----------------------- */
const legs = [];
let flywheel = null;
studio.wheelGroup.traverse((o) => {
  if (!o.isMesh) return;
  const p = o.geometry.parameters ?? {};
  if (p.radiusTop >= 15 && p.height === 5) flywheel = o;
  if (p.height === 44) legs.push(o);
});
ok(!!flywheel && legs.length === 4, `found the flywheel and ${legs.length} legs`);
if (flywheel && legs.length) {
  const fb = box(flywheel);
  const flyR = flywheel.geometry.parameters.radiusTop;
  const clash = legs.filter((l) => {
    const lb = box(l);
    if (overlap1D(lb.min.y, lb.max.y, fb.min.y, fb.max.y) <= 0) return false;
    const lx = (lb.min.x + lb.max.x) / 2, lz = (lb.min.z + lb.max.z) / 2;
    const inner = Math.hypot(lx, lz) - Math.max(lb.max.x - lb.min.x, lb.max.z - lb.min.z) / 2;
    return inner < flyR;
  });
  ok(clash.length === 0, `the flywheel does not pass through the legs` +
     (clash.length ? ` — ${clash.length} of 4 skewered` : ''));
}

/* ---- the centring rings have to be ON the head, not in it ------- */
// Box3.setFromObject walks children, so measuring the head this way would
// include the rings and the comparison would always say "level with the
// surface". The head's own geometry only.
const headGeoBox = studio.wheelHead.geometry.boundingBox
  ?? (studio.wheelHead.geometry.computeBoundingBox(), studio.wheelHead.geometry.boundingBox);
const headTop = new THREE.Box3(headGeoBox.min.clone(), headGeoBox.max.clone())
  .applyMatrix4(studio.wheelHead.matrixWorld).max.y;
const rings = studio.wheelHead.children.filter((o) => o.isMesh && o.geometry.type === 'TorusGeometry');
const buried = rings.filter((r) => box(r).max.y <= headTop + 1e-4);
ok(rings.length > 0 && buried.length === 0,
   `all ${rings.length} centring rings break the head's surface` +
   (buried.length ? ` — ${buried.length} buried inside it and never render` : ''));

/* ---- and colour still lives in exactly one place ---------------- */
// The whole point of palette.js is that a colour is written down once.
// Three light colours and two material colours had drifted back out of
// it, which is how a scheme comes apart: not all at once, but one
// "just this one" at a time.
const src = readFileSync(new URL('../render/studio.js', import.meta.url), 'utf8');
const strays = [...src.matchAll(/0x[0-9a-fA-F]{6}/g)].map((m) => m[0])
  .filter((h) => h !== '0xffffff' && h !== '0x000000');
ok(strays.length === 0,
   'every colour in the studio comes from the palette' +
   (strays.length ? ' -- ' + strays.length + ' stray: ' + [...new Set(strays)].join(', ') : '') +
   " (0xffffff is _mat's guard, 0x000000 is emissive-off)");

console.log(bad ? `\n  ${bad} FAILED\n` : '\n  everything is assembled\n');
process.exit(bad ? 1 : 0);
