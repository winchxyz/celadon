// ============================================================
//  Headless integration test of the REAL Game object.
//
//  Everything except the renderer is real: Game, Hand, Clay, the
//  coach, the HUD calls, the screen-to-clay mapping. Only WebGL is
//  stubbed out. This is the layer the simulation benches could not
//  reach, and it is where the bugs that reached the player lived.
//
//  Run:  node src/dev/gametest.mjs
// ============================================================

import * as THREE from 'three';
import { raycastPot } from '../sim/glazeField.js';
import { SIDE } from '../render/potMesh.js';
import {
  radiiAt, NS, game, rig, hudLog, DT,
  point, step, aim, dragCm, holdCm, dragPx, outwardPx, screenOf, M, camera, CAMERA,
} from './realgame.mjs';

let fails = 0;
const check = (name, ok, detail) => {
  if (!ok) fails++;
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(46)} ${detail}`);
};

console.log('\n  THE REAL GAME, DRIVEN BY A REAL MOUSE PATH\n');

// sanity: the solver must actually land where it is asked to
{
  const [x, y] = aim(4.0, 3.0);
  point(x, y); game._updateToolPoint();
  console.log(`  aim check: asked for r=4.00 y=3.00, got ` +
    `r=${game.tool.r.toFixed(2)} y=${game.tool.y.toFixed(2)} at (${x.toFixed(0)}, ${y.toFixed(0)}) px
`);
}

check('a fresh lump is not considered open', !M().opened,
  `H=${M().height.toFixed(1)} opened=${M().opened}`);

// ---- 1. holding the button still, on the wall ----------------------
{
  const h0 = M().height, t0 = M().trueness;
  holdCm(game.clay.maxR * 0.92, 3.0, 10);   // ten seconds of holding
  check('10 s of holding does not grow the pot', Math.abs(M().height - h0) < 1.0,
    `${h0.toFixed(1)} -> ${M().height.toFixed(1)} cm`);
  check('10 s of holding does not bend it', M().trueness >= t0 - 0.05,
    `trueness ${t0.toFixed(2)} -> ${M().trueness.toFixed(2)}`);
}

// ---- 2. centring by moving up and down the side --------------------
{
  const t0 = M().trueness;
  for (let i = 0; i < 5; i++) {
    const R = game.clay.maxR;
    dragCm(R * 0.95, 1.2, R * 0.80, game.clay.height * 0.85, 0.5);
    dragCm(R * 0.80, game.clay.height * 0.85, R * 0.95, 1.2, 0.5);
  }
  check('moving up and down the side centres it', M().trueness > Math.max(0.75, t0),
    `trueness ${t0.toFixed(2)} -> ${M().trueness.toFixed(2)}`);
  check('centring did not stretch it', M().height < 14,
    `H=${M().height.toFixed(1)} cm`);
}

// ---- 3. the hand label names what it is doing ----------------------
{
  game.pointer.down = true;
  for (let i = 0; i < 20; i++) { const [x, y] = aim(game.clay.maxR * 0.92, 3.0); point(x, y); step(1); }
  const restVerb = hudLog.hand && hudLog.hand.verb;
  game.pointer.down = false; step(2);
  check('a hand on an unopened lump says CENTRE', restVerb === 'CENTRE',
    `label = ${restVerb}`);
}

// ---- 4. opening from the middle of the top -------------------------
{
  for (let i = 0; i < 10 && !M().opened; i++) {
    // press down the middle, then push out along the floor
    dragCm(0.25, game.clay.height * 0.92, 0.35, 1.1, 0.5);
    dragCm(0.35, 1.1, game.clay.maxR * 0.62, 1.2, 0.6);
  }
  check('pressing down the middle opens the floor', M().opened,
    `opened=${M().opened}  minWall=${M().minWall.toFixed(2)}`);
}

// ---- 5. dragging up lifts, dragging out widens ---------------------
{
  const h0 = M().height;
  {
    const rr = radiiAt(game.clay, 2.0);
    const w = (rr.ri + rr.ro) * 0.5;
    dragCm(w, 1.4, w, Math.max(3.5, M().height - 0.5), 1.0);
  }
  const lifted = M().height - h0;
  check('dragging up lifts the pot', lifted > 0.8,
    `H ${h0.toFixed(1)} -> ${M().height.toFixed(1)} cm  (label ${hudLog.hand?.verb ?? '-'})`);

  const d0 = M().diameter, h1 = M().height;
  for (let i = 0; i < 3; i++) {
    const y = M().height * 0.5;
    const rr = radiiAt(game.clay, y);
    const w = (rr.ri + rr.ro) * 0.5;
    dragCm(w, y, w + 2.6, y, 0.7);
  }
  check('dragging sideways widens the pot', M().diameter > d0 + 0.8,
    `D ${d0.toFixed(1)} -> ${M().diameter.toFixed(1)} cm, H ${h1.toFixed(1)} -> ${M().height.toFixed(1)}`);
}

// ---- 6. the coach is talking about the right thing -----------------
check('the coach says something', !!hudLog.coach, `"${(hudLog.coach || '').slice(0, 62)}..."`);

// ---- 7. undo ------------------------------------------------------
{
  const h0 = M().height;
  {
    const rr = radiiAt(game.clay, 2.0);
    const w = (rr.ri + rr.ro) * 0.5;
    dragCm(w, 1.4, w, Math.max(3.5, M().height - 0.5), 0.9);
  }
  const h1 = M().height;
  game.undo();
  check('Ctrl+Z gives back what the last drag took',
    Math.abs(M().height - h0) < Math.abs(h1 - h0) * 0.5 + 0.4,
    `${h0.toFixed(1)} -> ${h1.toFixed(1)} -> undo -> ${M().height.toFixed(1)} cm`);
}

// ---- 8. nothing died -----------------------------------------------
{
  // The mark under the hand is a HAND, drawn into the clay as a
  // silhouette. It used to be a band right round the pot, and the
  // reason mattered: a band has no side, so it could not do what the
  // spot before it did — jump across the piece as the cursor crossed
  // the middle, and sit on the outer wall while the hand worked down
  // the bore.
  //
  // A hand shape cannot be sideless, so the side is TOLD to it from the
  // hand's own position rather than guessed at: 4 means outside, 5
  // means inside. That keeps what the band was protecting, and this
  // check is written to prove it — the mark must follow the hand up and
  // down the profile, ignore the wheel entirely, and be on the same
  // face the hand is.
  const u = game.mat.userData.u;
  const [xl, yl] = aim(game.clay.maxR * 0.9, 2.0);
  point(xl, yl); step(3);
  const low = u.uCursor.value.y;
  const [xh, yh] = aim(game.clay.maxR * 0.9, Math.max(4, game.clay.height - 1.5));
  point(xh, yh); step(3);
  const high = u.uCursor.value.y;

  // now hold still and let the wheel run
  const spun0 = game.pot.rotation.y;
  const held = [];
  for (let i = 0; i < 30; i++) { step(1); held.push(u.uCursor.value.y); }
  const turned = Math.abs(game.pot.rotation.y - spun0) / (Math.PI * 2);
  const wobble = Math.max(...held) - Math.min(...held);

  const shapeIsHand = u.uCursorBand.value === 4 || u.uCursorBand.value === 5;
  check('the mark follows the hand and ignores the wheel',
    shapeIsHand && high - low > 0.15 && turned > 0.25 && wobble < 0.02,
    `band=${u.uCursorBand.value}, arc ${low.toFixed(2)} -> ${high.toFixed(2)} up the wall, ` +
    `${turned.toFixed(2)} rev of wheel moved it ${wobble.toFixed(3)}`);

  /* ...and the face the mark is drawn on must be the face the ray
     actually struck.
     This used to aim at a screen point derived from a radius of 0.2 of
     the widest, halfway up, and demand the INSIDE band. From a side
     view that point is behind the front wall, so a ray to it meets the
     outside first — the old check passed only because the face was
     chosen from the cursor's RADIUS rather than from what the ray met,
     and that same reasoning put the mark on the bore whenever the
     player aimed at the middle of the silhouette, where nothing outside
     the pot can see it. That was the bug: the hand was drawing all
     along, on the far side of the wall.
     The scenario the old check described is also out of reach: the
     camera stops at phi 0.70 (engine.js limits it, because the hand
     stops following the cursor at steeper angles), and at 0.70 the ray
     meets the RIM, never the bore. So the invariant is tested instead
     of the unreachable case — whatever the ray hits, the band agrees
     with it. */
  const faces = [];
  for (const [r, y] of [[game.clay.maxR * 0.9, game.clay.height * 0.5],
                        [game.clay.maxR * 0.5, game.clay.height * 0.3],
                        [game.clay.maxR * 0.2, game.clay.height * 0.7],
                        [game.clay.maxR * 0.95, game.clay.height * 0.8]]) {
    const [px, py] = aim(Math.max(0.3, r), Math.max(1, y));
    point(px, py); step(3);
    const dir = new THREE.Vector3(game.pointer.nx, game.pointer.ny, 0.5)
      .unproject(game.eng.camera).sub(game.eng.camera.position).normalize();
    const org = game.eng.camera.position.clone().sub(game.pot.position);
    const h = raycastPot(org, dir, game.pb);
    const side = h.hit ? game.pb.sideOf(h.k) : null;
    const wantOutside = side === null ? null
      : (side === SIDE.OUTER || side === SIDE.BASE || side === SIDE.RIM);
    const band = u.uCursorBand.value;
    faces.push({ side, wantOutside, band,
      ok: wantOutside === null ? true : band === (wantOutside ? 4 : 5) });
  }
  const outsideBand = faces[0].band;
  const agree = faces.filter((f) => f.ok).length;
  check('the mark is drawn on the face the ray struck',
    agree === faces.length,
    `${agree}/${faces.length} aims agree; ` +
    faces.map((f) => `${f.side === null ? 'miss' : ['out','rim','in','base'][f.side]}->${f.band}`).join(' '));
}

// ---- dragging down brings a too-tall pot back down ------------------
{
  const h0 = M().height;
  for (let i = 0; i < 3; i++) {
    const y = Math.max(1.5, game.clay.height * 0.55);
    const rr = radiiAt(game.clay, y);
    const w = (rr.ri + rr.ro) * 0.5;
    dragCm(w, Math.max(3.5, game.clay.height - 0.5), w, 1.4, 1.0);
  }
  check('dragging down presses the pot back down', M().height < h0 - 1.5,
    `H ${h0.toFixed(1)} -> ${M().height.toFixed(1)} cm  (label ${hudLog.hand?.verb ?? '-'})`);
}

// ---- and it must still widen when you look INTO the pot -------------
{
  // Looking down into a tall pot is exactly what you do to work inside
  // one. The point where the cursor's ray runs closest to the axis
  // slides along the axis as the view steepens, so a sideways drag was
  // read as a pull and the vase grew upward instead of opening out.
  // Checked at the steepest angle the camera is now allowed to reach.
  const phi0 = rig.goalPhi;
  rig.goalPhi = rig.minPhi ?? 0.30; rig.update(0.016);   // as steep as the game allows
  const h0 = M().height;
  // Measured where the hand actually works, not at the widest point of
  // the whole pot: on a tall piece the base is the widest thing there
  // is, so opening out the middle would not move that number at all.
  // Followed on a fixed RING of clay, not a fixed height. The pot gets
  // shorter as it opens out, so a height halfway up is not the same
  // piece of clay before and after — measuring there compares one part
  // of the wall with another.
  const wallOf = i => (game.clay.ri[i] + game.clay.ro[i]) * 0.5;
  let moved = 0;
  for (let i = 0; i < 3; i++) {
    const y = Math.max(1.5, game.clay.height * 0.5);
    const ring = game.clay.sectionAt(y);
    const w = wallOf(ring);
    // put the cursor on the wall, then drag OUTWARD ON SCREEN — the
    // only thing a player can actually aim with
    const [x0, y0] = screenOf(w, y);
    point(x0, y0); game._updateToolPoint();
    const [ux, uy] = outwardPx();
    dragPx(x0, y0, ux * 70, uy * 70, 0.7);
    moved += wallOf(ring) - w;
  }
  const grew = M().height - h0;
  rig.goalPhi = phi0; rig.update(0.016);
  check('widening still widens with the camera down the neck',
    moved > 0.6 && grew < 0.5,
    `wall moved out ${moved.toFixed(2)} cm, H ${h0.toFixed(1)} -> ${M().height.toFixed(1)}`);
}

// ---- the glaze room says what the job is --------------------------
{
  // Bisque drinks glaze invisibly: a bare patch and a good one look
  // much the same in the room and come out of the fire completely
  // different. Without a number for coverage and an order to do things
  // in, there is nothing for a player to go on.
  game.startGlaze();
  step(2);
  const said = [];
  const grab = () => { game._glazeCoachText = null; game._updateGlazeCoach(); return hudLog.coach || ''; };
  said.push(grab());                                  // nothing on it yet
  // the coat the game's own dial opens at. This used to be 1.1 — nearly
  // four times the slider's MAXIMUM of 0.30, a thickness no player can
  // reach — and once the coach learned to say "that coat is heavy" in
  // units the game actually produces, this walk-through was the only
  // thing in the game still able to trigger it.
  game.field.dip(0.92, game.slotIndex, 0.13);
  game.field.upload();
  said.push(grab());                                  // now it is covered
  game.field.wipeFoot(0.7);
  said.push(grab());                                  // foot clean -> kiln
  const cov = game.field.stats().totalCoverage;
  check('the glaze room walks you through it',
    /Dip/i.test(said[0]) && said[1] !== said[0] && /kiln/i.test(said[2]) && cov > 0.5,
    `${Math.round(cov * 100)}% covered; ends with "${said[2].replace(/<[^>]+>/g, '').slice(0, 40)}..."`);
}

// ---- the firing is something you can watch ------------------------
{
  // A firing was forty seconds of a shut door. All of the kiln's light
  // came from how hot the WARE was, so the first twelve seconds of a
  // newly lit kiln had no fire in them at all; the glaze melt ran for
  // the whole firing and was never sent to the GPU, so the pot did not
  // change; and nothing anywhere said what was happening or how far
  // along it was.
  game.save.coin = 9999;
  game.field.dip(0.9, game.slotIndex, 1.0);
  game.startKiln(); step(30);
  game.lightKiln();

  let uploads = 0;
  const realUpload = game.field.upload.bind(game.field);
  game.field.upload = (...a) => { uploads++; return realUpload(...a); };

  let fireEarly = 0, said = new Set();
  const dur = game.firing.dur;
  while (game.state === 'firing') {
    step(1);
    const prog = game.firing.t / dur;
    if (prog > 0.03 && prog < 0.15) fireEarly = Math.max(fireEarly, game._kilnFire ?? 0);
    if (game._fireText) said.add(game._fireText.replace(/<[^>]+>/g, '').slice(0, 24));
  }
  game.field.upload = realUpload;

  check('the kiln is alight from the moment it is lit', fireEarly > 0.6,
    `fire was at ${(fireEarly * 100).toFixed(0)}% in the first tenth of the firing`);
  check('the melting glaze reaches the screen', uploads > 20,
    `${uploads} texture uploads during the firing`);
  check('the firing says what it is doing', said.size >= 3,
    `${said.size} distinct things said`);
}

// ---- the bench is looking through the game's own camera ------------
{
  // Not a detail. Every check that involves aiming — where the hand
  // lands, whether a sideways drag still widens as the view steepens —
  // is only worth anything if the camera it is aimed through is the one
  // the game ships. These were two hardcoded copies of the same numbers
  // and nothing compared them, so a change to the field of view or the
  // tilt limits would have left the whole suite passing against a
  // camera that no longer existed.
  const ok = camera.fov === CAMERA.fov
    && camera.near === CAMERA.near && camera.far === CAMERA.far
    && rig.minPhi === CAMERA.minPhi && rig.maxPhi === CAMERA.maxPhi;
  check('the bench looks through the game’s own camera', ok,
    `fov ${camera.fov}, tilt ${CAMERA.minPhi}..${CAMERA.maxPhi}, taken from engine.js`);
}

check('the pot survived a normal session', !game.clay.dead,
  game.clay.dead ? game.clay.deadReason : `H=${M().height.toFixed(1)} D=${M().diameter.toFixed(1)} true=${M().trueness.toFixed(2)}`);

console.log(fails ? `\n  ${fails} FAILING\n` : '\n  all clear\n');
process.exit(fails ? 1 : 0);
