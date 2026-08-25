// ============================================================
//  Can you actually aim it?
//
//  The banding wheel in the glaze room accumulated angular velocity on
//  every pointermove and applied it once per frame with no dt. A brisk
//  400 px drag arrives as forty events inside a frame or two, so it
//  built about 3.2 rad PER FRAME — eleven thousand degrees a second —
//  and then coasted through nine more turns. Painting was impossible.
//
//  What is held down here is the thing the player feels: how far the pot
//  turns for a given hand movement, that it is the same at any frame
//  rate, and that a flick cannot run away.
//
//  Run:  node src/dev/controls.mjs
// ============================================================
import * as THREE from 'three';
import { game, eng, rig, step, DT } from './realgame.mjs';

let bad = 0;
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };
const NL = String.fromCharCode(10);
const deg = (r) => r * 180 / Math.PI;

console.log(NL + '  CAN YOU ACTUALLY AIM IT?' + NL);

/* Drive the same handler the browser drives, with the same event shape. */
const canvas = eng.canvas;
const rightDown = () => canvas.dispatchEvent(mkEvent('pointerdown', { button: 2 }));
const rightUp = () => canvas.dispatchEvent(mkEvent('pointerup', { button: 2 }));
function mkEvent(type, props = {}) {
  return { type, button: 0, clientX: 800, clientY: 450, movementX: 0, movementY: 0,
           preventDefault() {}, ...props };
}
const drag = (px, events) => {
  const per = px / events;
  for (let i = 0; i < events; i++) {
    canvas.dispatchEvent(mkEvent('pointermove', { movementX: per, clientX: 800 + per * (i + 1) }));
  }
};

/* get to the glaze room */
game.startThrow(); step(150);
game.startTrim(); step(40);
game.startGlaze(); step(30);
ok(game.state === 'glaze', `in the glaze room (state "${game.state}")`);

/* ---- 1. the drag is one to one and predictable -------------------- */
let before = game.pot.rotation.y;
rightDown(); drag(400, 40); rightUp();
const dragged = Math.abs(game.pot.rotation.y - before);
console.log(`         a 400 px drag turns it ${deg(dragged).toFixed(0)}°`);
ok(deg(dragged) > 90 && deg(dragged) < 200,
   `a 400 px drag is most of a half-turn, not a blur (${deg(dragged).toFixed(0)}°)`);

/* ---- 1b. and it turns the way the hand goes ----------------------- */
// Reported as "inverted", and it was: dragging right moved the mark you
// were aiming at a third of the screen to the LEFT. What matters is not
// the sign of a rotation but where a point on the near face ends up, so
// that is what this measures: project a mark on the side of the pot
// facing the camera, drag right, and require that it moves right.
{
  const nearAng = Math.atan2(eng.camera.position.x - game.pot.position.x,
                             eng.camera.position.z - game.pot.position.z);
  // The mark has to be the material point that is facing the camera NOW,
  // not a fixed world angle: the pot has already been turned by the test
  // above, and a point on the FAR side crosses the screen the other way.
  game._band = 0;
  const rot0 = game.pot.rotation.y;
  const mat = nearAng - rot0;
  const markX = (rot) => {
    const a = mat + rot;
    return new THREE.Vector3(8 * Math.sin(a), 8, 8 * Math.cos(a)).project(eng.camera).x;
  };
  const x0 = markX(rot0);
  rightDown(); drag(200, 20); rightUp();
  game._band = 0;
  const x1 = markX(game.pot.rotation.y);
  ok(x1 > x0,
     `drag right and the near face of the pot goes right ` +
     `(the mark crossed the screen ${x0.toFixed(2)} -> ${x1.toFixed(2)})`);
}

/* ---- 2. it scales with the distance, not the event count ---------- */
game._band = 0;
before = game.pot.rotation.y;
rightDown(); drag(400, 4); rightUp();          // same distance, a tenth of the events
const coarse = Math.abs(game.pot.rotation.y - before);
ok(Math.abs(coarse - dragged) < dragged * 0.05,
   `the same distance in 4 events turns it the same as in 40 ` +
   `(${deg(coarse).toFixed(0)}° vs ${deg(dragged).toFixed(0)}°)`);

/* ---- 3. a flick coasts, but cannot run away ----------------------- */
game._band = 0; game._bandV = 0;
rightDown(); drag(600, 20); rightUp();
const thrown = Math.abs(game._band);
console.log(`         a hard flick leaves it spinning at ${deg(thrown).toFixed(0)}°/s`);
ok(thrown > 0, 'a flick does set it coasting');
ok(deg(thrown) <= 200,
   `and no flick can spin it faster than half a turn a second (${deg(thrown).toFixed(0)}°/s)`);

let coastFrames = 0, coastStart = game.pot.rotation.y;
while (game._band && coastFrames++ < 3000) game.update(DT);
const coasted = Math.abs(game.pot.rotation.y - coastStart);
console.log(`         it coasts ${(coasted / (2 * Math.PI)).toFixed(2)} turns and stops`);
ok(coasted / (2 * Math.PI) < 1.5,
   `the coast is under a turn and a half, not nine (${(coasted / (2 * Math.PI)).toFixed(2)})`);

/* ---- 4. the same at any frame rate -------------------------------- */
const spinFor = (dt, seconds) => {
  game._band = 2.0;
  const from = game.pot.rotation.y;
  for (let t = 0; t < seconds; t += dt) game.update(dt);
  return Math.abs(game.pot.rotation.y - from);
};
const at60 = spinFor(1 / 60, 1.2);
const at30 = spinFor(1 / 30, 1.2);
const at144 = spinFor(1 / 144, 1.2);
ok(Math.abs(at30 - at60) < at60 * 0.05 && Math.abs(at144 - at60) < at60 * 0.05,
   `one second of coasting travels the same at 30, 60 and 144 fps ` +
   `(${deg(at30).toFixed(0)}° / ${deg(at60).toFixed(0)}° / ${deg(at144).toFixed(0)}°)`);

/* ---- 5. the scroll wheel is the exact one ------------------------- */
game._band = 0;
before = game.pot.rotation.y;
canvas.dispatchEvent(mkEvent('wheel', { deltaY: 100, shiftKey: false }));
const notch = Math.abs(game.pot.rotation.y - before);
ok(deg(notch) > 3 && deg(notch) < 12,
   `one scroll notch is a small exact step, good for placing a brush (${deg(notch).toFixed(1)}°)`);
ok(game._band === 0, 'and it leaves no momentum behind');

/* ---- 6. and it can be played on a tablet -------------------------
   An iPad has no right button and no scroll wheel, which is two of the
   three things this game is steered with. One finger has to shape and
   only shape; two fingers have to carry everything the right button and
   the wheel used to. */
const touch = (type, id, x, y) => canvas.dispatchEvent({
  type, pointerId: id, pointerType: 'touch', button: 0,
  clientX: x, clientY: y, movementX: 0, movementY: 0, preventDefault() {},
});

console.log(NL + '   on a tablet:' + NL);

/* one finger shapes, and must not move the camera */
game.startThrow(); step(60);
{
  const th = rig.goalTheta;
  touch('pointerdown', 1, 700, 420);
  const pressed = game.pointer.down;
  for (let i = 0; i < 10; i++) touch('pointermove', 1, 700 + i * 8, 420);
  touch('pointerup', 1, 780, 420);
  ok(pressed, 'one finger presses the clay');
  ok(Math.abs(rig.goalTheta - th) < 1e-6, 'and does not drag the camera with it');
}

/* two fingers orbit, and must not leave a dent in the pot */
{
  const th = rig.goalTheta, ph = rig.goalPhi;
  touch('pointerdown', 1, 600, 400);
  touch('pointerdown', 2, 800, 400);
  for (let i = 0; i < 20; i++) {
    touch('pointermove', 1, 600 + i * 8, 400 + i * 3);
    touch('pointermove', 2, 800 + i * 8, 400 + i * 3);
  }
  const orbited = Math.abs(rig.goalTheta - th) > 1e-3 && Math.abs(rig.goalPhi - ph) > 1e-3;
  const clean = !game.pointer.down;
  touch('pointerup', 1, 760, 460); touch('pointerup', 2, 960, 460);
  ok(orbited, 'two fingers orbit the camera');
  ok(clean, 'and the finger that started as a press is taken off the clay');
}

/* pinch zooms */
{
  const r0 = rig.goalRadius;
  touch('pointerdown', 1, 600, 400); touch('pointerdown', 2, 800, 400);
  for (let i = 0; i < 15; i++) {
    touch('pointermove', 1, 600 - i * 6, 400);
    touch('pointermove', 2, 800 + i * 6, 400);
  }
  const r1 = rig.goalRadius;
  touch('pointerup', 1, 510, 400); touch('pointerup', 2, 890, 400);
  ok(r1 < r0 - 0.5, `pinching out moves the camera in (${r0.toFixed(1)} -> ${r1.toFixed(1)})`);
}

/* and in the glaze room two fingers turn the pot instead of orbiting */
game.startGlaze(); step(30);
{
  game._band = 0;
  const before = game.pot.rotation.y;
  touch('pointerdown', 1, 600, 400); touch('pointerdown', 2, 800, 400);
  for (let i = 0; i < 20; i++) {
    touch('pointermove', 1, 600 + i * 10, 400);
    touch('pointermove', 2, 800 + i * 10, 400);
  }
  const turned = Math.abs(game.pot.rotation.y - before);
  touch('pointerup', 1, 800, 400); touch('pointerup', 2, 1000, 400);
  ok(deg(turned) > 20, `a two-finger drag turns the pot (${deg(turned).toFixed(0)}°)`);
  ok(!game.pointer.right, 'and lifting both fingers ends the gesture');
}

console.log(bad ? NL + `  ${bad} FAILED` + NL : NL + '  it can be aimed, with a mouse or a thumb' + NL);
process.exit(bad ? 1 : 0);
