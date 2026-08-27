// ============================================================
//  CELADON — game loop and state machine
// ============================================================

import * as THREE from 'three';
import { clamp, clamp01, lerp, damp, smoothstep, fmt, pct, makeRng, TAU, blackbodyRGB } from '../core/util.js';
import { Clay, NS, STAGE, W_CRIT } from '../sim/clay.js';
import { Hand, radiiAt } from '../sim/hand.js';
import { potGeometry, ProfileBuffer, proportions } from '../render/potMesh.js';
import { createPotMaterial, applyFireResult } from '../render/potMaterial.js';
import { GlazeField, raycastPot } from '../sim/glazeField.js';
import {
  GLAZES, GLAZE_BY_ID, SLOTS, defaultSchedule, guildSchedule, safeCoat, fire as fireGlaze, fuelCost,
  kilnCurve, scheduleHours, COOLING, meltPoint, maturePoint,
} from '../sim/glaze.js';
import { COMMISSIONS, FORMS, BODIES, rankFor, OPENING, CODEX, proceduralCommission, targetSize } from './lore.js';
import { appraise, gradeFor, glazeName, liveRequirements } from './scoring.js';
import * as SaveIO from './save.js';
import { KILN_POS } from '../render/studio.js';
import { EXPOSURE0, CAMERA } from '../core/engine.js';
import { describeRequirements } from '../ui/hud.js';
import { dressPot, drawCard, cropPot, handOver } from './piece.js';

const ST = {
  TITLE: 'title', BRIEF: 'brief', THROW: 'throw', TRIM: 'trim',
  GLAZE: 'glaze', KILN: 'kiln', FIRING: 'firing', REVEAL: 'reveal',
};

const MAX_RPM = 190;

/* ---- the banding wheel in the glaze room -------------------------- */
/** How far the pot turns per pixel of a right-drag: a full turn ≈ 900 px. */
const BAND_RAD_PER_PX = 0.007;
/** Ceiling on a thrown spin, in radians per second — about half a turn. */
const BAND_MAX = 3.2;
/** One notch of the scroll wheel, for placing a brush exactly. */
const BAND_NOTCH = Math.PI / 30;   // 6 degrees

/* ---- the glaze tools ---------------------------------------------
   One table, because the mark drawn on the pot and the glaze that
   actually lands have to be the same shape and the same size. They were
   not. Every tool drew a circle: pour drew one of 0.10 while laying down
   a ribbon of 0.075, and spray drew a 7.2 cm disc for a curtain that
   runs the whole height of the wall — on a pot with 27 cm of wall that
   disc covered the vessel, which is what made the tools look broken.
   Both the field call and the cursor uniform are read from here now, so
   they cannot drift apart again.

   shape matches uCursorBand in potMaterial.js:
     0 spot · 2 curtain down one side · 3 ribbon running down. */
const GLAZE_TOOLS = {
  brush: { shape: 0, rad: 0.075 },
  wax:   { shape: 0, rad: 0.06 },
  /* Measured on the real field rather than guessed at.
     Spray was 0.22 turns of spread, and two seconds of holding put
     glaze over 219 degrees of the pot — 61% of the whole circumference
     from one press. That is not a spray, it is a fog, and it ends the
     decision the moment you touch it. 0.075 reaches about 74 degrees,
     which is a side, not a pot.
     Pour was 0.075 and laid down 47 degrees, which is a brush stroke
     (the brush does 54) — so it read as a stripe and nobody could tell
     what it was for. A pour off a jug is a broad sheet; 0.17 makes it
     about 103 degrees, wider than anything else on the belt. */
  spray: { shape: 2, spread: 0.075 },
  pour:  { shape: 3, widthFrac: 0.17 },
};

/** How far the mark actually reaches.
 *
 *  This used to report the HALF-POWER width — where the gaussian has
 *  fallen to 0.5 — which is a reasonable thing to draw and the wrong
 *  thing to promise. Glaze keeps landing well past that point: the loops
 *  in GlazeField carry on depositing until the weight drops under 0.02
 *  (pour) or 0.015 (spray), and measured, pour marked 19 degrees and
 *  covered 47. The ring said one thing and the pot did another, which is
 *  the single most confusing thing a cursor can do.
 *
 *  So the mark is now drawn at the cutoff the deposit loops actually
 *  use, and what you see is the edge of what you get.
 */
const reachFor = (k, cutoff) => Math.sqrt(Math.log(1 / cutoff) / k);

/** The size to hand the shader: centimetres for a spot, turns of angle
 *  for the two shapes that are bounded round the pot rather than along it. */
function cursorSize(t, arcLen) {
  if (t.shape === 0) return t.rad * arcLen;                     // cm
  if (t.shape === 2) return t.spread * reachFor(2.2, 0.015);    // turns
  return t.widthFrac * 0.5 * reachFor(1.4, 0.02);               // turns
}

export class Game {
  constructor(engine, studio, hud, audio) {
    this.eng = engine;
    this.studio = studio;
    this.hud = hud;
    this.audio = audio;
    this.save = SaveIO.load();
    this.rng = makeRng(Date.now() & 0xffff);

    this.state = ST.TITLE;
    this.t = 0;

    /* ---- vessel ---- */
    this.clay = null;
    this.pb = new ProfileBuffer();
    this.field = new GlazeField();
    this.mat = createPotMaterial();
    this.mat.userData.u.uProfile.value = this.pb.tex;
    this.mat.userData.u.uGlaze.value = this.field.tex;
    this.pot = new THREE.Mesh(potGeometry(), this.mat);
    this.pot.frustumCulled = false;
    this.pot.castShadow = true;
    this.pot.receiveShadow = true;
    this.pot.visible = false;
    engine.scene.add(this.pot);

    /* ---- target ghost ---- */
    // The target form is drawn as a fresnel shell: you see its silhouette
    // and its contour lines, and straight through the middle of it.
    this.ghost = new THREE.Mesh(
      new THREE.BufferGeometry(),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.BackSide,
        uniforms: {
          uCol: { value: new THREE.Color(0xf6f0e2) },
          uI: { value: 0.19 },
          uTop: { value: 1.0 },
        },
        vertexShader: `
          varying vec3 vN; varying vec3 vV; varying float vY;
          void main(){
            vN = normalize(normalMatrix * normal);
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vV = normalize(-mv.xyz);
            vY = position.y;
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: `
          uniform vec3 uCol; uniform float uI, uTop;
          varying vec3 vN; varying vec3 vV; varying float vY;
          void main(){
            // A chalk line round the shape you are aiming for, not a
            // hologram. Additive blending on a saturated teal made two
            // glowing cones that appeared to pass through the pot.
            //
            // And it has to STOP somewhere. The lathe ended in a hard
            // ellipse across the top, so the guide read as a pane of
            // glass standing on the wheel rather than as a line drawn in
            // the air. Both ends taper out instead.
            float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
            float edge = pow(rim, 5.5);
            float t = clamp(vY / max(0.001, uTop), 0.0, 1.0);
            float fade = smoothstep(0.0, 0.12, t) * smoothstep(1.0, 0.80, t);
            float a = edge * uI * fade;
            if (a < 0.006) discard;
            gl_FragColor = vec4(uCol, a);
          }`,
      })
    );
    this.ghost.visible = false;
    engine.scene.add(this.ghost);

    /* ---- tool marker ---- */
    this.marker = new THREE.Mesh(
      new THREE.SphereGeometry(0.55, 20, 14),
      new THREE.MeshBasicMaterial({ color: 0x8fd6bd, transparent: true, opacity: 0.85 })
    );
    this.marker.visible = false;
    engine.scene.add(this.marker);

    /* ---- wheel / input ---- */
    this.omega = 0;
    this.omegaTarget = 0;
    this.wheelAngle = 0;
    this.pointer = { x: 0, y: 0, nx: 0, ny: 0, down: false, right: false };
    this.tool = { r: 0, y: 0, pr: 0, py: 0, vy: 0, press: 0, contact: 0, angle: 0, arcT: 0 };
    this.toolId = 'hands';
    this.hand = new Hand();
    this.stressView = 0;
    this.showGhost = true;

    /* ---- per-run ---- */
    this.commission = null;
    this.body = BODIES[0];
    this.mass = 1250;
    this.slots = [null, null, null];
    this.slotIndex = 0;
    this.glazeThickness = 0.13;
    this.schedule = defaultSchedule();
    this.fireResult = null;
    this.report = null;
    this.firing = { t: 0, dur: 42, temp: 20, running: false, rising: true, moved: 0 };

    this._basis = {};
    this._ray = new THREE.Ray();
    this._v = new THREE.Vector3();
    this._plane = new THREE.Vector3();

    this._bindInput();
  }

  /* ================================================================
     INPUT
     ================================================================ */

  _bindInput() {
    const c = this.eng.canvas;
    const set = (e) => {
      const r = c.getBoundingClientRect();
      // A canvas can legitimately measure zero — a hidden tab, a
      // minimised window, a container collapsed by a stylesheet — and
      // dividing by that gives a NaN cursor. The damage is not cosmetic
      // and it is not recoverable: the hand is then applied at a NaN
      // radius, which writes NaN into the clay's offset and stress
      // arrays, and from that frame on trueness, wobble and every gauge
      // reading off them are NaN for the rest of the run, however big
      // the window gets afterwards.
      if (!(r.width > 0) || !(r.height > 0)) return;
      this.pointer.x = e.clientX - r.left;
      this.pointer.y = e.clientY - r.top;
      this.pointer.nx = (this.pointer.x / r.width) * 2 - 1;
      this.pointer.ny = -((this.pointer.y / r.height) * 2 - 1);
    };

    c.addEventListener('pointermove', (e) => {
      set(e);
      if (e.pointerType === 'touch' && this._touches && this._touches.size) {
        if (onTouchMove(e)) return;
      }
      if (this.pointer.right) {
        // In the glaze room you do not walk around the pot — you turn
        // the pot, on a banding wheel, exactly as you would with a
        // brush in your other hand. The room told players to "hold the
        // right button to turn the pot" and then orbited the camera
        // instead, which is a different thing entirely: the light and
        // the window swing round with you and the piece never presents
        // a fresh side. Sideways turns the wheel; up and down still
        // tilts the view, so you can look into the mouth.
        if (this.state === ST.GLAZE) {
          // The pot follows the mouse one to one, and a flick at the end
          // lets it coast — which is what a banding wheel does.
          //
          // It used to ACCUMULATE velocity: every pointermove added to
          // `_band`, and `_band` was then added to the rotation once per
          // frame with no dt. A brisk 400 px drag arrives as forty
          // events inside one or two frames, so it built 3.2 rad *per
          // frame* — about eleven thousand degrees a second — and then
          // coasted through nine more turns. You could not put a brush
          // anywhere near it.
          const dx = e.movementX ?? 0;
          // Plus, not minus. The surface under your hand has to travel
          // WITH your hand: drag right and the near face of the pot goes
          // right, the way it would if you put a finger on a real one.
          // It was inverted: a 200 px drag to the right moved the mark
          // you were aiming at 0.31 of the screen to the LEFT.
          this.pot.rotation.y += dx * BAND_RAD_PER_PX;
          // remember the last moments of the gesture, so the throw at
          // the end is the speed of the throw and not of the whole drag
          const now = performance.now();
          const gap = Math.max(1, now - (this._bandT ?? now));
          this._bandT = now;
          const v = dx * BAND_RAD_PER_PX / (gap / 1000);
          this._bandV = clamp((this._bandV ?? 0) * 0.6 + v * 0.4, -BAND_MAX, BAND_MAX);
          this.eng.rig.orbit(0, e.movementY ?? 0);
        } else {
          this.eng.rig.orbit(e.movementX ?? 0, e.movementY ?? 0);
        }
      }
    });

    /* ---- touch ---------------------------------------------------
     *
     * An iPad has no right button and no scroll wheel, which is two of
     * the three things this game is steered with. Pointer events already
     * deliver a finger as a pointerdown, so shaping worked; orbiting,
     * zooming and turning the pot on the banding wheel did not exist at
     * all, and there was no way to get to them.
     *
     * One finger does what the left button does. Two fingers do what the
     * right button and the wheel do: drag to orbit, pinch to zoom, and
     * in the glaze room a sideways two-finger drag turns the pot. The
     * second finger also takes back whatever the first one had started,
     * because a gesture that begins as a shaping stroke and turns into
     * an orbit must not leave a dent behind.
     */
    this._touches = new Map();

    const touchGeometry = () => {
      const pts = [...this._touches.values()];
      if (pts.length < 2) return null;
      const [a, b] = pts;
      return {
        cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2,
        spread: Math.hypot(a.x - b.x, a.y - b.y),
      };
    };

    const onTouchDown = (e) => {
      this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._touches.size === 2) {
        /* Two fingers mean "move the camera", and the first of them has
           usually already landed on the clay. Taking that dab back is
           right — but it used to call undo() every single time, whether
           the first finger had touched the pot or not, so a player who
           simply put two fingers down to look at their work threw away
           the last thing they had actually done. Two controls on one
           gesture, and the wrong one won.
           Only the dab this gesture started is taken back, and only
           while it is still a dab: once a stroke has been running for a
           quarter of a second it is work, and work is not discarded
           because a second finger arrived. */
        /* Two fingers move the camera. That is the whole of what they do.
           They used to also take back the last thing you did, on the
           theory that the first of the two had probably dabbed the clay
           on its way to the gesture — and that theory cost people work
           they meant to keep, on a control they were reaching for to
           look at it. One gesture, one job: whatever the first finger
           put on the pot stays there, and Ctrl+Z is still there for
           anyone who wants it back. */
        /* Cancel a dip that is being aimed, do not commit it.
           Releasing the first finger is how a dip is COMMITTED — hold
           to set the line, let go and the pot goes in the bucket — so
           putting a second finger down to orbit the pot fired the dip
           at whatever depth the line happened to be at, complete with
           the splash, before the camera had moved a pixel. Everything
           else on the belt paints while held and has nothing pending,
           which is why this line was right for them and wrong for the
           one tool that does not. */
        if (this.pointer.down) {
          this._dipHeld = false;
          this.pointer.down = false;
          this._onRelease();
        }
        this._pinch = this._pinchStart = touchGeometry();
        this._movedSince = new Set();
        this._bandAccum = 0;
        this._bandT = undefined;
        this._gesture = null;
        this.pointer.right = true;
        return true;
      }
      /* And so is going from two to three, for the same reason. */
      if (this._touches.size > 2) {
        this._pinch = this._pinchStart = touchGeometry();
        this._movedSince = new Set();
        this._bandAccum = 0;
        this._bandT = undefined;
        this._gesture = null;
        return true;
      }
      return false;
    };

    const onTouchMove = (e) => {
      const prev = this._touches.get(e.pointerId);
      if (!prev) return false;
      this._touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this._touches.size < 2) return false;

      const now = touchGeometry();
      const was = this._pinch;
      this._pinch = now;
      if (!was || !now) return true;

      const dSpread = now.spread - was.spread;
      const dx = now.cx - was.cx, dy = now.cy - was.cy;

      /* One gesture, one job.
         This used to zoom, orbit AND turn the pot on the same movement of
         the same two fingers, all three at once. Nobody pinches
         symmetrically — the midpoint always drifts — so every attempt to
         zoom also swung the camera and spun the work, and the three
         fought each other until it read as none of them happening. It is
         the same mistake the throwing hand used to make, and it has the
         same answer: decide what the movement is MOSTLY doing, once, and
         then do only that for as long as the fingers are down.
         The decision sticks for the gesture. Re-deciding every frame lets a
         pinch that drifts flicker between the two. */
      /* Measured from where the gesture STARTED, not frame to frame.
         Pointer events arrive one per finger, so in any single event only
         one of the two has moved — which makes the spread look like it
         changed even when the hand is travelling flat, and an arbiter
         reading per-event deltas picks "zoom" every time. Against a fixed
         reference the two quantities mean what they say: how much wider
         the fingers are than when they landed, and how far their midpoint
         has carried. */
      /* ...and not until EVERY finger has moved at least once.
         Measuring from a fixed reference was necessary and not
         sufficient. Events still arrive one per finger, so between the
         first move and the second the hand is half-reported: finger A
         has travelled 20px and finger B has not moved at all, which
         reads as the fingers being 20px further apart and the midpoint
         having carried only 10. spreadBy beats carriedBy, the arbiter
         commits to 'zoom', and it commits ON PURPOSE for the whole
         gesture — so a flat two-finger drag zoomed, every time, no
         matter how straight the hand went.
         Waiting for every current finger to have reported once makes
         the geometry a whole hand position rather than half of one. */
      this._movedSince ??= new Set();
      this._movedSince.add(e.pointerId);
      const from = this._pinchStart;
      if (from && !this._gesture && this._movedSince.size >= this._touches.size) {
        const spreadBy = Math.abs(now.spread - from.spread);
        const carriedBy = Math.hypot(now.cx - from.cx, now.cy - from.cy);
        if (spreadBy > 14 || carriedBy > 14) {
          this._gesture = spreadBy > carriedBy ? 'zoom' : 'drag';
        }
      }

      if (this._gesture === 'zoom') {
        this.eng.rig.zoom(-dSpread * 3.2);
      } else if (this._gesture === 'drag') {
        if (this.state === ST.GLAZE) {
          // in the glaze room the pot turns on its wheel instead
          this.pot.rotation.y += dx * BAND_RAD_PER_PX;
          /* The same sum the mouse does, instead of a stand-in for it.
             `* 22` is what you write when you mean "divide by the time
             that passed" and do not have it to hand: it is right only if
             events arrive 45ms apart. They arrive every 16ms at 60Hz and
             every 8 at 120, so a flick of the pot under a thumb carried
             about a third of the speed the same flick carried under a
             mouse, and a different third on a different screen. */
          /* One measurement per frame, not one per finger.
             Copying the mouse's sum straight across was not enough:
             touch delivers an event per finger, so the second of each
             pair arrives with a gap of about zero and dividing by it
             sent the velocity through the clamp — measured, a gentle
             drag that gave the mouse 1.32 rad/s gave the thumb the full
             3.2. The movement is accumulated and folded in once enough
             real time has passed to divide by, which is what the mouse
             path gets for free by only ever firing once. */
          const tNow = performance.now();
          this._bandAccum = (this._bandAccum ?? 0) + dx;
          const gap = tNow - (this._bandT ?? (tNow - 16));
          if (gap >= 8) {
            const v = this._bandAccum * BAND_RAD_PER_PX / (gap / 1000);
            this._bandV = clamp((this._bandV ?? 0) * 0.6 + v * 0.4, -BAND_MAX, BAND_MAX);
            this._bandT = tNow;
            this._bandAccum = 0;
          }
          this.eng.rig.orbit(0, dy);
        } else {
          this.eng.rig.orbit(dx, dy);
        }
      }
      return true;
    };

    const onTouchUp = (e) => {
      if (!this._touches.has(e.pointerId)) return false;
      this._touches.delete(e.pointerId);
      /* Going from three fingers to two is a NEW two-finger gesture.
         _pinch still held the centroid and spread of the three-finger
         arrangement, and the next move measured against it — so lifting
         one finger of three threw the camera the whole distance between
         two different hand shapes in a single event. Re-seeding from
         where the remaining fingers actually are makes that delta zero,
         which is what the player's hand did: nothing. */
      if (this._touches.size >= 2) {
        this._pinch = this._pinchStart = touchGeometry();
        this._movedSince = new Set();
        this._bandAccum = 0;
        this._bandT = undefined;
        this._gesture = null;
        return true;
      }
      if (this._touches.size < 2) {
        this._pinch = null;
        this._pinchStart = null;
        this._gesture = null;
        if (this.pointer.right) {
          this.pointer.right = false;
          if (this.state === ST.GLAZE) {
            this._band = Math.abs(this._bandV ?? 0) > 0.35 ? this._bandV : 0;
            this._bandV = 0;
          }
        }
        // lifting one of two fingers must not start shaping with the other
        return true;
      }
      return true;
    };

    c.addEventListener('pointerdown', (e) => {
      set(e);
      this.audio.resume();
      if (e.pointerType === 'touch') {
        try { c.setPointerCapture?.(e.pointerId); } catch { /* not fatal */ }
        if (onTouchDown(e)) return;
      }
      // Capturing the pointer is a nicety — it keeps a drag alive when the
      // cursor leaves the canvas — and it must never be able to take the
      // input with it. `?.` guards against the method being absent, not
      // against it THROWING, and it throws readily: NotFoundError when the
      // pointer is no longer active. That exception unwound the rest of
      // this handler, so the button press was never recorded and the
      // control simply did nothing.
      try { c.setPointerCapture?.(e.pointerId); } catch { /* not fatal */ }
      if (e.button === 2 || e.button === 1) { this.pointer.right = true; return; }
      this.pointer.down = true;
      this._onPress();
    });

    const up = (e) => {
      if (e && e.pointerType === 'touch') {
        const wasMulti = this._touches.size > 1;
        onTouchUp(e);
        if (wasMulti) return;
      }
      if (e && (e.button === 2 || e.button === 1)) {
        this.pointer.right = false;
        // let go mid-flick and the wheel carries on; let go having come
        // to rest and it stays where you put it
        if (this.state === ST.GLAZE) {
          this._band = Math.abs(this._bandV ?? 0) > 0.35 ? this._bandV : 0;
          this._bandV = 0; this._bandT = 0;
        }
        return;
      }
      this.pointer.down = false;
      this._onRelease();
    };
    c.addEventListener('pointerup', up);
    c.addEventListener('pointercancel', up);
    window.addEventListener('blur', () => {
      this.pointer.down = false; this.pointer.right = false;
      this._touches.clear(); this._pinch = null;
    });
    c.addEventListener('contextmenu', (e) => e.preventDefault());

    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      /* FIRING belongs on this list too. The kiln's key hints stay on
         screen through the firing and they say SCROLL zoom, but the
         state has moved on and this test did not know about it — so the
         wheel fell through to the branch below and spun up a wheel head
         that is not in the room, while the hint promised a camera. */
      if (e.shiftKey || this.state === ST.KILN || this.state === ST.FIRING
        || this.state === ST.REVEAL || this.state === ST.TITLE) {
        this.eng.rig.zoom(e.deltaY);
      } else if (this.state === ST.GLAZE) {
        // There is no wheel to speed up in the glaze room, so scrolling
        // used to do nothing at all here. It is the natural place for
        // the slow, exact turn you want when lining a brush up on a
        // spot: one notch, six degrees, no momentum.
        this._band = 0;
        this.pot.rotation.y += Math.sign(e.deltaY) * BAND_NOTCH;
      } else {
        this.setWheelSpeed(this.omegaTarget - Math.sign(e.deltaY) * 1.15);
      }
    }, { passive: false });

    window.addEventListener('keydown', (e) => this._onKey(e));
  }

  _onKey(e) {
    if (e.repeat && e.key !== ' ') return;
    const k = e.key;

    if (this.hud.overlayOpen) {
      /* Enter takes the primary action. Escape does NOT.
         They were the same key here, and the primary action on the
         confirmation that wipes the save is the button marked "Break
         it" — so Escape, which means cancel on every dialog anybody has
         ever used, erased the shelf, the codex, the standing and the
         ash-marks. Escape now takes the way out: the first button that
         is not the primary one, which is "No" on that dialog and
         "Back" on every panel. Where there is only a primary button —
         an overlay that just wants acknowledging — it still closes on
         Escape, because there the primary IS the way out. */
      if (k === 'Enter') {
        const b = this.hud.ovInner.querySelector('.btn.primary');
        if (b) { b.click(); e.preventDefault(); }
        return;
      }
      if (k === 'Escape') {
        const btns = [...this.hud.ovInner.querySelectorAll('.btn')];
        const out = btns.find((b) => !b.classList.contains('primary')) ?? (btns.length === 1 ? btns[0] : null);
        if (out) { out.click(); e.preventDefault(); }
        return;
      }
      return;
    }

    if ((e.ctrlKey || e.metaKey) && (k === 'z' || k === 'Z')) {
      e.preventDefault();
      if (this.state === ST.THROW || this.state === ST.TRIM) this.undo();
      return;
    }
    if (k === 'Enter') { e.preventDefault(); this.advance(); return; }
    if (k === 'Escape') { this.openMenu(); return; }
    if (k === 'Tab') { e.preventDefault(); this.stressView = this.stressView > 0.5 ? 0 : 1; return; }
    if (k === 'g' || k === 'G') { this.showGhost = !this.showGhost; return; }
    if (k === 'm' || k === 'M') {
      this.save.settings.sound = !this.save.settings.sound;
      this.audio.setMuted(!this.save.settings.sound);
      this.hud.toast(this.save.settings.sound ? 'Sound on' : 'Sound off');
      SaveIO.save(this.save);
      return;
    }

    // H folds the read-once panels away and brings them back
    if (k === 'h' || k === 'H') { this.hud.setBare(!this.hud.isBare()); this.audio.click(); return; }

    const map = this.hud.toolKeys();
    if (map[k]) { this.selectTool(map[k]); return; }

    if (k === ' ') {
      e.preventDefault();
      if (this.state === ST.THROW) { this.quickWater = true; }
      return;
    }
    if (k === '[' || k === 's' || k === 'S') this.setWheelSpeed(this.omegaTarget - 1.6);
    if (k === ']' || k === 'w' || k === 'W') this.setWheelSpeed(this.omegaTarget + 1.6);
  }

  setWheelSpeed(v, byPlayer = true) {
    /* A hand on the control takes the control.
       The assist damps omegaTarget toward its own idea of the right
       speed every frame at 2.2/s, so 89% of anything the player set
       was gone within a second — while the toast that introduces it
       says "W and S to take it over" in as many words. Either the
       message or the behaviour had to change, and the message was the
       one telling the truth about what a wheel is for. */
    if (byPlayer) this._wheelManual = true;
    this.omegaTarget = clamp(v, 0, (MAX_RPM * TAU) / 60);
  }

  /** 0..1 across the pedal's travel. */
  setWheelSpeedFrac(f) {
    this.setWheelSpeed(clamp01(f) * ((MAX_RPM * TAU) / 60));
  }

  selectTool(id) {
    this.toolId = id;
    this.hud.selectTool(id);
    this.audio.click(1.15, 0.09);
    if (this.state === ST.GLAZE) this._glazeHint(id);
  }

  /* ================================================================
     MERIDIAN MAPPING
     Turn the mouse into a point in the plane that contains the wheel
     axis and faces the camera.
     ================================================================ */

  _updateToolPoint() {
    const cam = this.eng.camera;
    const org = this.pot.position;

    // Ray from the cursor.
    this._v.set(this.pointer.nx, this.pointer.ny, 0.5).unproject(cam).sub(cam.position).normalize();
    const d = this._v;
    const ox = cam.position.x - org.x;
    const oy = cam.position.y - org.y;
    const oz = cam.position.z - org.z;

    // Closest approach between that ray and the wheel axis (the world Y
    // axis through the pot). Intersecting a plane through the axis is the
    // obvious thing to do and it is wrong: a ray through the middle of the
    // screen LIES IN that plane, so the intersection is undefined exactly
    // where the player spends most of their time. This is stable
    // everywhere, and its geometric meaning is the right one — the radius
    // of the cylinder the cursor is grazing.
    const dDotO = d.x * ox + d.y * oy + d.z * oz;
    const denom = Math.max(1e-3, 1 - d.y * d.y);
    const sc = (d.y * oy - dDotO) / denom;
    const px = ox + d.x * sc;
    const py = oy + d.y * sc;
    const pz = oz + d.z * sc;

    // which way round the pot the hand is, for the cursor ring and glazing
    let a = Math.atan2(pz, px) / TAU;
    if (a < 0) a += 1;

    this.tool.pr = this.tool.r;
    this.tool.py = this.tool.y;
    this.tool.r = clamp(Math.hypot(px, pz), 0, 40);
    this.tool.y = clamp(py, -1.5, 60);
    this.tool.side = 1;

    this.tool.angle = a;

    // reused, not reallocated: this runs sixty times a second
    if (!this.tool.world) this.tool.world = new THREE.Vector3();
    this.tool.world.set(org.x + px, org.y + py, org.z + pz);

    // ---- the pot's own directions, as drawn ------------------------
    //
    // The promise the game makes is stated in screen terms: move up to
    // make it taller, move outward to make it wider. Reading that from
    // the change in (r, y) instead makes it depend on the camera. The
    // point where the cursor's ray runs closest to the axis slides
    // ALONG the axis once you tilt down to look into a tall pot, so a
    // sideways drag gets read as a pull: past about sixty degrees more
    // of the stroke counts as lift than as widening, which is why a
    // tall vase would not open out and kept growing upward instead.
    //
    // So the two directions are measured where the player sees them,
    // and _readDrag resolves the stroke against them. Nothing about
    // the pointer's history is touched here: this runs many times per
    // frame as a probe whenever something needs to know where a point
    // on the clay would land on screen.
    let ux = px, uz = pz;
    const ul = Math.hypot(ux, uz);
    if (ul > 1e-3) { ux /= ul; uz /= ul; } else { ux = 1; uz = 0; }
    const P = this.tool.world;
    const sP = this._ndc(P.x, P.y, P.z, 0);
    const sOut = this._ndc(P.x + ux, P.y, P.z + uz, 1);      // one cm outward
    const sUp = this._ndc(P.x, P.y + 1, P.z, 2);             // one cm up
    const b = this.tool.basis || (this.tool.basis = {});
    b.oX = sOut.x - sP.x; b.oY = sOut.y - sP.y;
    b.uX = sUp.x - sP.x;  b.uY = sUp.y - sP.y;
  }

  /**
   * Resolve this frame's pointer movement into "outward" and "up" in
   * centimetres of clay. Called ONCE a frame — it is the only thing
   * that consumes the pointer's history.
   *
   * Looking straight down the axis projects to almost nothing, and the
   * screen then carries no information about height at all; the honest
   * answer there is that lift stops being on offer, rather than being
   * invented out of sideways movement.
   */
  _readDrag() {
    const first = !this._wasDown;
    const down = this.pointer.down;
    this._wasDown = down;
    // With the button up nothing is being shaped, so the previous
    // position follows the cursor rather than being left behind, and
    // the frame the button goes down starts from rest. Without both,
    // pressing at a fresh spot counts the whole journey there as the
    // first instant of the stroke.
    const held = down && !first;
    const mX = held ? this.pointer.nx - (this.pointer.pnx ?? this.pointer.nx) : 0;
    const mY = held ? this.pointer.ny - (this.pointer.pny ?? this.pointer.ny) : 0;
    this.pointer.pnx = this.pointer.nx;
    this.pointer.pny = this.pointer.ny;

    if (down && first) {
      // Take hold where the clay actually is under the cursor, when
      // there is a surface there to take hold of. The ray's closest
      // approach to the axis is a decent guess from side on and a poor
      // one from above, and looking down into a pot is exactly what you
      // do to work inside it. On a lump that has not been opened there
      // is no inner surface to find and the axis is what you are
      // reaching for, so that case keeps the old answer.
      this._holdR = this.tool.r;
      this._holdY = this.tool.y;
      this._holdA = this.tool.angle;
    }

    const b = held ? this._basisAt(this._holdR, this._holdY, this._holdA) : this.tool.basis;
    let dR = 0, dY = 0;
    if (b) {
      const det = b.oX * b.uY - b.uX * b.oY;
      const oLen2 = b.oX * b.oX + b.oY * b.oY;
      const uLen2 = b.uX * b.uX + b.uY * b.uY;
      if (Math.abs(det) > 0.06 * Math.sqrt(oLen2 * uLen2) && oLen2 > 1e-12 && uLen2 > 1e-12) {
        dR = (mX * b.uY - b.uX * mY) / det;
        dY = (b.oX * mY - mX * b.oY) / det;
      } else if (oLen2 > 1e-12) {
        dR = (mX * b.oX + mY * b.oY) / oLen2;
      }
    }
    // a single frame can never be worth more than a hand's width
    this.tool.dR = dR = clamp(dR, -4, 4);
    this.tool.dY = dY = clamp(dY, -4, 4);

    if (!down) return;

    // ---- while the clay is held, the hand moves BY the stroke --------
    //
    // Not by re-reading where the cursor's ray runs closest to the axis.
    // That point is a fine way to find the clay when nothing is being
    // held, but it is not a place on the pot: tilt the camera down and
    // it slides along the axis several times faster than the hand is
    // actually travelling. The stroke would then say "one centimetre
    // upward" while the hand itself walked most of the way up the pot,
    // smearing the work over rings the player never touched, so opening
    // a tall vase out did everything except widen it.
    //
    // Taking hold anchors the hand, and from then on it goes exactly
    // where the stroke says. Let go and it finds the clay again.
    this._holdR = clamp(this._holdR + dR, 0, 40);
    this._holdY = clamp(this._holdY + dY, -1.5, 60);
    this.tool.r = this._holdR;
    this.tool.y = this._holdY;
    this.tool.angle = this._holdA;
    const ang = this._holdA * TAU;
    this.tool.world.set(
      this.pot.position.x + this._holdR * Math.cos(ang),
      this.pot.position.y + this._holdY,
      this.pot.position.z + this._holdR * Math.sin(ang));
  }

  /** The pot's own two directions, as drawn, at a given point on it. */
  _basisAt(r, y, angTurns) {
    const ang = angTurns * TAU;
    const ux = Math.cos(ang), uz = Math.sin(ang);
    const ox = this.pot.position.x + r * ux;
    const oy = this.pot.position.y + y;
    const oz = this.pot.position.z + r * uz;
    const sP = this._ndc(ox, oy, oz, 0);
    const sOut = this._ndc(ox + ux, oy, oz + uz, 1);
    const sUp = this._ndc(ox, oy + 1, oz, 2);
    const b = this._heldBasis || (this._heldBasis = {});
    b.sx = sP.x; b.sy = sP.y;
    b.oX = sOut.x - sP.x; b.oY = sOut.y - sP.y;
    b.uX = sUp.x - sP.x;  b.uY = sUp.y - sP.y;
    return b;
  }

  /**
   * A world point in normalised device coordinates. Three scratch
   * vectors, because the caller holds all three at once — one shared
   * vector would have every reading alias the last.
   */
  _ndc(x, y, z, slot = 0) {
    if (!this._ndcV) this._ndcV = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    return this._ndcV[slot].set(x, y, z).project(this.eng.camera);
  }

  /**
   * Where the pointer meets the near face of the pot, in world bearing
   * and arc — the place the player is actually looking at. Null when
   * the pointer is off the clay, in which case the caller falls back to
   * the grazing bearing.
   */
  _seenPoint() {
    if (!this.pb || !this.pot) return null;
    const cam = this.eng.camera;
    const d = this._sDir || (this._sDir = new THREE.Vector3());
    const o = this._sOrg || (this._sOrg = new THREE.Vector3());
    d.set(this.pointer.nx, this.pointer.ny, 0.5).unproject(cam).sub(cam.position).normalize();
    o.copy(cam.position).sub(this.pot.position);
    const h = raycastPot(o, d, this.pb);
    return h.hit ? h : null;
  }

  /**
   * A world angle in the clay's own frame.
   *
   * The cursor ring is drawn in the shader off `uv.x`, which turns with
   * the mesh, while the hand is tracked in world space. Handing one
   * straight to the other glued the marker to the clay: it rode round
   * with the pot and was only ever in view from one side, instead of
   * staying put under the mouse.
   */
  _localAngle(turns) {
    // A mesh turned by `rotation.y` sends its own angle `a` to world
    // angle `a - rotation.y`, so coming back the other way ADDS it.
    const a = turns + this.pot.rotation.y / TAU;
    return a - Math.floor(a);
  }

  /* ================================================================
     STATE ENTRY
     ================================================================ */

  begin() {
    this.hud.show(false);
    this.eng.rig.frame(new THREE.Vector3(0, 11.5, 0), 46, 1.26, -2.42, true);
    this.eng.rig.autoSpin = 0.030;
    this.state = ST.TITLE;
    this._demoPot();
    this.showTitle();
  }

  _demoPot() {
    // a finished piece standing on the wheel, for the menu backdrop
    const c = new Clay({ mass: 1400, seed: 4242, wobble: 0 });
    c.sculpt(FORMS.jar.profile, 21.5, 19.5, 0.36, 0.8);
    this.clay = c;
    this.pb.update(c);
    this.field.clear();
    this.field.bindProfile(this.pb);
    this.field.dip(0.86, 0, 0.12);
    this.field.wipeFoot(0.6);
    this.field.upload();
    this.slots = [GLAZE_BY_ID.celadon, null, null];
    const sch = defaultSchedule();
    sch.reduction = 0.85;
    const res = fireGlaze([{ glaze: GLAZE_BY_ID.celadon, coverage: 0.9, meanThick: 0.12 }], sch,
      { meanWall: c.metrics().meanWall });
    applyFireResult(this.mat, res, this.slots);
    const u = this.mat.userData.u;
    u.uFired.value = 1; u.uWet.value = 0; u.uBisque.value = 1; u.uVitrified.value = 1;
    u.uBodyCol.value.set(BODIES[0].color); u.uBodyCol2.value.set(BODIES[0].color2);
    this.pot.visible = true;
    this.pot.position.set(0, 0, 0);
    this.omegaTarget = 0.5;
  }

  /* ---------------- title ---------------- */

  showTitle() {
    const s = this.save;
    this.free = false;
    const fresh = s.day === 1 && s.rep === 0 && s.gallery.length === 0;
    this.hud.openOverlay(`
      <div class="ov-kicker">The Ember Guild · Vess, the ninth winter</div>
      <div class="ov-title" style="letter-spacing:.16em">CELADON</div>
      <div class="ov-sub">A game about clay, fire, and a colour nobody living has seen the original of.</div>
      <div class="menu">
        <button data-a="play">${fresh ? 'Take the wheel' : 'Continue'}<small>${fresh ? 'NEW' : `DAY ${s.day} · ${rankFor(s.rep).name}`}</small></button>
        <button data-a="gallery" ${s.gallery.length ? '' : 'disabled'}>The shelf<small>${s.gallery.length} PIECES</small></button>
        <button data-a="free">The open shed<small>NO BRIEF · NO FEE</small></button>
        <button data-a="codex">The codex<small>${s.codex.length} FRAGMENTS</small></button>
        <button data-a="how">How to throw<small>CONTROLS</small></button>
        ${fresh ? '' : '<button data-a="wipe">Break everything and start again<small>ERASE</small></button>'}
      </div>
    `, true);
    this.hud.bindAll('.menu button', (b) => {
      const a = b.dataset.a;
      this.audio.resume(); this.audio.click();
      if (a === 'play') { this.hud.closeOverlay(); fresh ? this.showOpening() : this.nextCommission(); }
      if (a === 'free') { this.hud.closeOverlay(); this.startFree(); }
      if (a === 'gallery') this.showGallery(() => this.showTitle());
      if (a === 'codex') this.showCodex(() => this.showTitle());
      if (a === 'how') this.showHelp(() => this.showTitle());
      if (a === 'wipe') this.confirmWipe();
    });
  }

  confirmWipe() {
    this.hud.openOverlay(`
      <div class="ov-kicker">Are you sure</div>
      <div class="ov-title">Everything?</div>
      <div class="ov-sub">The shelf, the codex, the standing, the ash-marks. All of it.</div>
      <div class="ov-actions">
        <button class="btn" data-a="no">No</button>
        <button class="btn primary" data-a="yes">Break it</button>
      </div>`);
    this.hud.bind('[data-a="no"]', () => this.showTitle());
    this.hud.bind('[data-a="yes"]', () => {
      SaveIO.wipe();
      this.save = SaveIO.blankSave();
      this.audio.shatter();
      this.showTitle();
    });
  }

  showOpening() {
    let i = 0;
    const page = () => {
      this.hud.openOverlay(`
        <div class="ov-kicker">${i + 1} / ${OPENING.length}</div>
        <div class="ov-body" style="font-size:16px;max-width:58ch">${OPENING[i]}</div>
        <div class="ov-actions">
          <button class="btn primary" data-a="n">${i === OPENING.length - 1 ? 'Take the wheel' : 'Go on'}</button>
          <button class="btn ghost" data-a="s">Skip</button>
        </div>`);
      this.hud.bind('[data-a="n"]', () => {
        this.audio.click();
        i++;
        if (i >= OPENING.length) { this.hud.closeOverlay(); this.nextCommission(); }
        else page();
      });
      this.hud.bind('[data-a="s"]', () => { this.hud.closeOverlay(); this.nextCommission(); });
    };
    page();
  }

  showHelp(back) {
    this.hud.openOverlay(`
      <div class="ov-kicker">Controls</div>
      <div class="ov-title">How to throw</div>
      <div class="score-grid" style="margin-top:1.4em">
        <div class="ov-body">
          <p><em>There is one control.</em> Hold the left mouse button on the clay and move your hand.
          What happens depends on which way you drag, exactly as it would at a real wheel.
          The label by your hand always tells you what you are doing.</p>
          <p><em>Up</em> — lifts the wall and thins it. This is how a pot gets tall.<br>
          <em>Sideways, outward</em> — bellies it out. Wider, and shorter.<br>
          <em>Sideways, inward</em> — collars it in. Narrower, and taller.<br>
          <em>Down the middle of the top</em> — opens the floor.<br>
          <em>Side to side on a closed lump</em> — centres it.</p>
          <p>The wall follows your hand. You do not have to be inside or outside
          it — only to move in the direction you want the clay to go.</p>
          <p>How far you drag is what counts, never how fast. A slow, careful pull moves exactly as
          much clay as a quick one.</p>
        </div>
        <div class="ov-body">
          <p><em>The panel on the left</em> shows the shape you were asked for as a dashed outline and
          the shape on your wheel over the top of it. Get one inside the other.</p>
          <p><em>Ctrl+Z</em> takes back the last few seconds. Use it freely.</p>
          <p><em>Other keys</em> — <b>1-4</b> hands, rib, water, needle · <b>space</b> water ·
          <b>W</b>/<b>S</b> wheel speed · <b>right-drag</b> orbit · <b>Tab</b> stress view ·
          <b>G</b> ghost · <b>Enter</b> next stage · <b>Esc</b> menu.</p>
          <p style="color:var(--celadon-deep)">Clay is still clay. Too thin, too tall or too wet and it
          will come down — but with the assist on it will warn you first, and you can always take it back.</p>
        </div>
      </div>
      <div class="ov-actions"><button class="btn primary" data-a="b">Back</button></div>`);
    this.hud.bind('[data-a="b"]', () => { this.audio.click(); back(); });
  }

  /* ---------------- commission ---------------- */

  /**
   * The cheapest firing the kiln can be lit for at all.
   *
   * Below this the run is over: firing is the only way to earn, so a
   * player who cannot light the kiln can never get another mark, and
   * nothing in the interface tells them the game has ended.
   */
  /**
   * The cheapest firing the player can actually light.
   *
   * This used to be the cost of a 900-degree crash: the least a kiln can
   * be run for by somebody working every slider down. But the sliders
   * are not on screen unless the kiln has been taken by hand, and in
   * guild mode the schedule is chosen for you — so the floor the ruin
   * guard measured against was a firing the default player has no way to
   * ask for. Advancing them up to it still left them short of the only
   * firing on offer.
   */
  _floorFiring() {
    if (this.firingMode() === 'guild') {
      /* The brief, and nothing else.
         this.slots and this.clay are not reset until startThrow, and
         every caller of this runs before that — so the "glazes on the
         pot" it was reading were the ones on the pot the player had
         just sold, and the wall thickness was that pot's wall. A raku
         cup at 0.24 wall costs 23 to fire and tops the purse to 51; an
         ash-glazed piece at a 1.0 wall costs 53, and 60 if the brief
         also wants reduction. Sold one, handed the other, and the kiln
         cannot be lit — which is the exact dead end this guard exists
         to prevent, arrived at by the guard itself.
         The job ahead is described by its brief, so that is what it is
         measured from, with no clay yet because there is none yet. */
      const wanted = this.commission?.require?.glaze;
      const on = [GLAZE_BY_ID[wanted] ?? GLAZE_BY_ID[this.save.glazes[0]] ?? GLAZES[0]];
      return fuelCost(guildSchedule(on, null, this.commission?.require));
    }
    return fuelCost({ ...this.schedule, peak: 900, ramp: 320, soak: 0, reduction: 0, cooling: 'crash' });
  }

  /**
   * What a ball of this clay costs.
   *
   * BODIES has carried a price since the beginning and the brief screen
   * has printed it under every clay — "26 marks" under Reach Porcelain —
   * and no coin has ever changed hands for it. The only three places the
   * purse moved were the fuel advance, the fuel charge and the payout.
   * A client who wants a translucent white plate is telling you which
   * clay to buy, so there has to be something to buy it with.
   *
   * Priced by weight against an ordinary ball, because that is how clay
   * is sold and because it gives the weight slider a second meaning.
   */
  clayCost(body = this.body, mass = this.mass) {
    if (this.free || !body) return 0;
    return Math.max(1, Math.round((body.price ?? 0) * mass / 1500));
  }

  /**
   * Pay for the ball, once, when you sit down with it.
   *
   * Once per commission and not once per attempt: wedging the same ball
   * again after a collapse is what a potter does with the clay already
   * in front of them, and charging for it would turn a bad morning into
   * a spiral. And the guard runs afterwards, because a purse that could
   * pay for clay and then not for wood is a purse that has been walked
   * into a wall by the game rather than by the player.
   */
  _buyClay() {
    if (this.free || this._boughtClay) return 0;
    const cost = this.clayCost();
    if (cost <= 0) return 0;
    this._boughtClay = true;
    this.save.coin -= cost;
    this.hud.setLedger(this.save);
    this._fuelAdvance();
    return cost;
  }

  /**
   * Advance fuel against the next commission if the purse is empty.
   *
   * Losing three pieces in a row is a bad run, not a lost save. The
   * Guild owns the kiln — it would rather stake the wood and take the
   * fee than have the fire go out, which is the one thing its charter
   * actually forbids.
   */
  _fuelAdvance() {
    const s = this.save;
    const floor = this._floorFiring();
    if (s.coin >= floor) return 0;
    const advance = Math.max(floor, Math.round(floor * 2.2)) - s.coin;
    s.coin += advance;
    this.hud.toast(
      `The Guild advances you ${advance} ash-marks of wood against this one. It does not forget.`,
      'hot', 5200,
    );
    return advance;
  }

  /**
   * The open shed: a wheel, every glaze, and nobody waiting.
   *
   * Everything the campaign is about — a brief to satisfy, a fee, wood
   * you have to pay for, a standing that goes up and down — is the part
   * that makes it a game. It is also the part that stops it being a
   * place to just make a pot. This runs the identical wheel, trimming,
   * glaze and kiln code with all of that switched off: no requirements
   * to meet, no marks charged for the firing, no score at the end, and
   * the campaign save is not touched by anything that happens here.
   */
  startFree() {
    this.free = true;
    this.commission = {
      id: 'free',
      free: true,
      title: 'The open shed',
      from: 'Nobody is waiting',
      pay: 0, rep: 0,
      require: {},           // no brief: appraise() scores form on its own merits
    };
    this.mass = 900;
    this.hud.closeOverlay();
    this.startThrow();
    this.hud.toast('No brief, no fee, no fuel to pay for. Make something.', '', 4200);
  }

  /** Every glaze and every body, for the open shed. */
  _freeGlazes() { return GLAZES.map((g) => g.id); }

  nextCommission() {
    const s = this.save;
    this._boughtClay = false;    // a new job is a new ball
    if (s.commission < COMMISSIONS.length) {
      this.commission = COMMISSIONS[s.commission];
    } else {
      s.proceduralN++;
      this.commission = proceduralCommission(this.rng, s.proceduralN, s.glazes, s.bodies);
    }
    /* AFTER the new brief is in hand. The advance exists to guarantee
       the player can light the kiln for the job they are about to be
       given, and it was computed before they had been given it — so it
       sized itself against the commission that had just finished. */
    this._fuelAdvance();
    this.state = ST.BRIEF;
    this.showBrief();
  }

  showBrief() {
    const c = this.commission;
    const s = this.save;
    // Weigh out the ball from the shape actually asked for, rather than
    // from a rule of thumb. Too much clay is not a handicap you can throw
    // your way out of: a wall only gets thin by getting tall, so an
    // over-heavy ball makes a short brief literally unsatisfiable.
    this.mass = suggestedMass(c.require);
    const reqs = describeRequirements(c.require);
    const bodies = BODIES.filter((b) => s.bodies.includes(b.id));

    this.hud.openOverlay(`
      <div class="ov-kicker">Day ${s.day} · ${c.from}</div>
      <div class="ov-title">${c.title}</div>
      <div class="ov-sub">${c.text}</div>
      <div class="score-grid">
        <div>
          <div class="panel-h" style="border:0;padding:0;margin-bottom:1em"><span class="glyph">◈</span> THE BRIEF</div>
          <ul id="brief-reqs" style="list-style:none;display:flex;flex-direction:column;gap:.6em">
            ${reqs.map((r) => `<li style="font:400 13px/1.5 var(--serif);color:var(--ink-dim)">— ${r.label}</li>`).join('')}
          </ul>
          <div class="readout" style="margin-top:1.6em">
            <span class="k">PAYS</span> ${c.pay} ash-marks &nbsp; <span class="k">STANDING</span> +${c.rep}
          </div>
        </div>
        <div>
          <div class="panel-h" style="border:0;padding:0;margin-bottom:1em"><span class="glyph">◍</span> WEDGE THE CLAY</div>
          <div class="glaze-list" id="body-pick">
            ${bodies.map((b, i) => `
              <div class="glaze ${i === 0 ? 'sel' : ''}" data-b="${b.id}">
                <span class="sw" style="background:#${b.color.toString(16).padStart(6, '0')}"></span>
                <span><span class="gn">${b.name}</span><br><span class="gt"><b data-cost="${b.id}">${this.clayCost(b, this.mass)}</b> marks · ${b.id === 'porcelain' ? 'unforgiving' : b.id === 'blackhill' ? 'strong' : 'forgiving'}</span></span>
              </div>`).join('')}
          </div>
          <div id="body-desc" class="readout" style="margin:1em 0 1.4em;min-height:3.4em">${bodies[0]?.desc ?? ''}</div>
          <div class="slider-row">
            <label>BALL WEIGHT <span id="mv">${this.mass} g</span></label>
            <input id="mass" type="range" min="250" max="3200" step="25" value="${this.mass}">
          </div>
          <div class="readout">More clay means you can go bigger, and it costs more to be wrong.</div>
        </div>
      </div>
      <div class="ov-actions">
        <button class="btn primary" data-a="go">Sit down at the wheel</button>
        <button class="btn ghost" data-a="menu">Menu</button>
      </div>`);

    this.body = bodies[0] ?? BODIES[0];
    this.hud.bindAll('#body-pick .glaze', (e) => {
      for (const x of this.hud.ovInner.querySelectorAll('#body-pick .glaze')) x.classList.remove('sel');
      e.classList.add('sel');
      this.body = BODIES.find((b) => b.id === e.dataset.b);
      this.hud.ovInner.querySelector('#body-desc').textContent = this.body.desc;
      this.audio.click();
    });
    const mi = this.hud.ovInner.querySelector('#mass');
    mi.addEventListener('input', () => {
      this.mass = parseInt(mi.value, 10);
      this.hud.ovInner.querySelector('#mv').textContent = `${this.mass} g`;
      // clay is sold by weight, so the shelf has to re-price itself as
      // the ball grows — otherwise the slider is spending money silently
      for (const b of BODIES) {
        const cell = this.hud.ovInner.querySelector(`[data-cost="${b.id}"]`);
        if (cell) cell.textContent = String(this.clayCost(b, this.mass));
      }
    });
    this.hud.bind('[data-a="go"]', () => {
      this.audio.click();
      this._buyClay();
      this.startThrow();
    });
    this.hud.bind('[data-a="menu"]', () => this.openMenu());
  }

  openMenu() {
    if (this.hud.overlayOpen) { this.hud.closeOverlay(); return; }
    this.hud.openOverlay(`
      <div class="ov-kicker">Paused</div>
      <div class="ov-title">The shed</div>
      <div class="menu">
        <button data-a="resume">Back to work<small>ESC</small></button>
        ${this.state === ST.THROW || this.state === ST.TRIM
          ? '<button data-a="rethrow">Wedge it again<small>START THIS POT OVER</small></button>' : ''}
        <button data-a="gallery">The shelf<small>${this.save.gallery.length} PIECES</small></button>
        <button data-a="codex">The codex<small>${this.save.codex.length} FRAGMENTS</small></button>
        <button data-a="how">How to throw</button>
        <button data-a="title">Leave the wheel<small>MAIN MENU</small></button>
      </div>`);
    this.hud.bindAll('.menu button', (b) => {
      this.audio.click();
      const a = b.dataset.a;
      if (a === 'resume') this.hud.closeOverlay();
      if (a === 'gallery') this.showGallery(() => this.openMenu());
      if (a === 'codex') this.showCodex(() => this.openMenu());
      if (a === 'how') this.showHelp(() => this.openMenu());
      if (a === 'rethrow') { this.hud.closeOverlay(); this.startThrow(); }
      if (a === 'title') { this.hud.closeOverlay(); this.begin(); }
    });
  }

  /* ---------------- throwing ---------------- */

  startThrow() {
    this.hud.closeOverlay();
    const b = this.body;
    this.clay = new Clay({
      mass: this.mass,
      seed: (Math.random() * 1e9) | 0,
      wobble: 0.42 + Math.random() * 0.34,
    });
    this.clay.bodyDef = b;
    // clay body affects the physics
    this.clay._plasticK = b.plastic;
    this.clay._strengthK = b.strength;
    const yieldBase = this.clay.yieldStrength.bind(this.clay);
    this.clay.yieldStrength = (i) => yieldBase(i) * b.strength;
    const plasticBase = this.clay.plasticity.bind(this.clay);
    this.clay.plasticity = (i) => clamp(plasticBase(i) * b.plastic, 0.08, 1.4);

    this.field.clear();
    this.slots = [null, null, null];
    this.slotIndex = 0;
    this.fireResult = null;
    this.report = null;
    this.schedule = defaultSchedule();

    const u = this.mat.userData.u;
    u.uFired.value = 0;
    u.uWet.value = 1;
    u.uBisque.value = 0;
    u.uVitrified.value = 0;
    u.uSoot.value = 0;
    u.uHeat.value = 0;
    u.uBodyCol.value.set(b.color);
    u.uBodyCol2.value.set(b.color2);
    u.uGrog.value = b.grog;
    applyFireResult(this.mat, null, this.slots);

    this.pot.visible = true;
    this.pot.position.set(0, 0, 0);
    this.pot.rotation.y = 0;
    this.pb.update(this.clay);

    this._buildGhost();
    this.state = ST.THROW;
    this.omegaTarget = 0;
    this.eng.rig.autoSpin = 0;
    this.eng.rig.frame(new THREE.Vector3(0, 8, 0), 54, CAMERA.phi, CAMERA.theta);

    const assist = this.save.settings.assist !== false;
    this._undoStack = [];
    this._lastUndoAt = -9;
    this._pressed = false;
    this.hand.grab();
    this.hand.release();
    this.toolId = 'hands';
    // In assist the wheel is already turning when you sit down: a stopped
    // wheel is the single most common reason a first-timer presses on the
    // clay and nothing at all happens.
    this._wheelManual = false;   // a new pot hands the wheel back to the assist
    this.omegaTarget = assist ? 8.4 : 0;
    this.omega = assist ? 6.0 : 0;

    this.hud.show(true);
    this.hud.showGauges(true);
    this.hud.showFormView(true);
    this.hud.setToolset('throw', 'hands');
    this.hud.setStage('THE WHEEL', 'Put a hand on the clay and move it. Which way you drag is what it does.');
    this.hud.setCommission(this.commission, null);
    this.hud.setLedger(this.save);
    this.hud.hideContext();
    this.hud.setAdvance('Let it set up', true);
    this.hud.setKeyHints([
      ['DRAG', 'shape it'], ['RMB', 'orbit'], ['SCROLL', 'wheel speed'],
      ['SHIFT+SCROLL', 'zoom'], ['CTRL+Z', 'take it back'],
      ['1-4', 'tools'], ['SPACE', 'water'], ['TAB', 'stress'],
    ]);
    this.hud.toast('Hold the left button on the clay and move it. <b>Up</b> makes it taller, <b>down</b> presses it back down, <b>out</b> makes it wider, <b>in</b> makes it narrower.', '', 8500);
    this.save.stats.thrown++;
  }

  _buildGhost() {
    const form = FORMS[this.commission?.require?.form];
    if (!form) { this.ghost.visible = false; return; }
    const req = this.commission.require;
    const { H: h, D: d } = targetSize(req);
    const pts = [];
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      pts.push(new THREE.Vector2(Math.max(0.05, form.profile(t) * d * 0.5), t * h));
    }
    pts.unshift(new THREE.Vector2(0.02, 0));
    this.ghost.geometry.dispose();
    this.ghost.geometry = new THREE.LatheGeometry(pts, 64);
    this.ghost.visible = true;
    this.ghost.material.uniforms.uTop.value = h;
    this.ghostH = h;
  }

  _onPress() {
    // when this press began, so a second finger can tell a dab from work
    this._pressAt = performance.now();
    if (this.state === ST.GLAZE) this._glazeAction(true);
  }
  _onRelease() {
    if (this.state === ST.GLAZE) this._glazeAction(false);
  }

  /* ================================================================
     PER-FRAME
     ================================================================ */

  update(dt) {
    this.t += dt;
    const u = this.mat.userData.u;
    u.uTime.value = this.t;
    u.uStressView.value = damp(u.uStressView.value, this.stressView, 8, dt);

    // wheel inertia
    const spinUp = this.omegaTarget > this.omega ? 2.4 : 3.6;
    this.omega = damp(this.omega, this.omegaTarget, spinUp, dt);
    if (this.state === ST.THROW || this.state === ST.TRIM) {
      this.wheelAngle += this.omega * dt;
      this.pot.rotation.y = this.wheelAngle;
    }

    /* Looking at a finished piece is not a phase of the game, it is a
       pause in one, so the phase it paused does not get to keep running
       underneath. It was still running: the glaze room re-enables the
       dip marker every frame from the selected tool, so a bright green
       ball hung in the air beside a finished pot on the card you were
       about to send somebody. Everything the working state wants to
       draw or move is skipped; the camera and the room keep going,
       which is what lets you turn the piece and look at it. */
    if (this._viewing) {
      this.marker.visible = false;
      this.ghost.visible = false;
    } else {
      switch (this.state) {
        case ST.TITLE: this._updateTitle(dt); break;
        case ST.THROW: this._updateThrow(dt); break;
        case ST.TRIM: this._updateThrow(dt, true); break;
        case ST.GLAZE: this._updateGlaze(dt); break;
        case ST.KILN: this._updateKilnSetup(dt); break;
        case ST.FIRING: this._updateFiring(dt); break;
        case ST.REVEAL: this._updateReveal(dt); break;
        default: break;
      }
    }

    this.studio.update(dt, {
      omega: this.state === ST.THROW || this.state === ST.TRIM || this.state === ST.TITLE ? this.omega : 0,
      kilnHeat: this.state === ST.FIRING ? (this._kilnFire ?? 0) : (this._kilnHeat ?? 0),
      kilnTemp: this.firing.temp,
    });

    // Put the piece back in contact with the wheel. Without this it hovers,
    // and a hovering pot undoes every other thing the frame is doing.
    if (this.studio.setContact) {
      const onWheel = this.pot.visible && this.pot.position.lengthSq() < 1
        && (this.state === ST.THROW || this.state === ST.TRIM || this.state === ST.TITLE);
      this.studio.setContact(onWheel && this.clay ? this.clay.ro[0] : 0);
    }

    // Let the eye stop down when the window is in shot, and light the
    // near face while glazing — the one job that means walking all the
    // way round a piece that has a wall of daylight behind it.
    if (this.state !== ST.KILN && this.state !== ST.FIRING) {
      const wantFill = this.state === ST.GLAZE ? 0.85 : this.state === ST.REVEAL ? 0.35 : 0.12;
      if (this.studio.setCrouch) {
        this.studio.setCrouch(smoothstep(1.36, 1.66, this.eng.rig.phi));
      }
      const ex = this.studio.adapt(this.eng.camera, dt, wantFill);
      if (this.state !== ST.REVEAL) {
        this.eng.renderer.toneMappingExposure = EXPOSURE0 * ex;
        // Bloom is what actually swallows the pot: a bright pane bleeds
        // over everything standing in front of it, so the silhouette you
        // are trying to read disappears into the glow around it.
        if (this.eng.bloom) {
          this._bloom0 ??= this.eng.bloom.strength;
          this.eng.bloom.strength = this._bloom0 * clamp(0.30 + 1.75 * (ex - 0.6), 0.30, 1);
        }
      }
    }

    this.audio.update(dt, {
      omega: this.omega,
      contact: this.tool.contact * this.tool.press,
      moisture: this.clay ? this.clay.metrics().moisture : 0.5,
      kilnHeat: this._kilnHeat ?? 0,
      water: (this.quickWater || this.toolId === 'water') && this.pointer.down ? 1 : 0,
      musicOn: this.save.settings.music,
    });
    // the shortcut lasts exactly one frame, and the mixer has now had it
    this.quickWater = false;

    this.eng.grade.uniforms.uHaze.value = damp(
      this.eng.grade.uniforms.uHaze.value,
      (this._kilnHeat ?? 0) * (this.state === ST.FIRING ? 1 : 0.25), 2, dt
    );
  }

  _updateTitle(dt) {
    this.pot.rotation.y += dt * 0.16;
    this.ghost.visible = false;
  }

  /* ---------------- throwing ---------------- */

  /* ==================================================================
     THE HANDS
     ------------------------------------------------------------------
     One verb. You put a hand on the pot and move it, and what happens is
     decided by which way you moved — which is how a wheel actually works.
     Three rules make it playable:

       1. the hand SNAPS to the wall, so you cannot miss it
       2. work is measured by how far you DRAG, never by how fast, so a
          slow careful pull does exactly as much as a quick one
       3. the verb is named on screen while you do it, so the controls
          teach themselves
     ================================================================== */

  _updateThrow(dt, trimming = false) {
    const c = this.clay;
    if (!c) return;
    const u = this.mat.userData.u;
    const assist = this.save.settings.assist !== false;
    this._updateToolPoint();
    this._readDrag();

    // ---- press envelope ---------------------------------------------
    const want = this.pointer.down && !this.hud.overlayOpen ? 1 : 0;
    this.tool.press = damp(this.tool.press, want, want ? 12 : 18, dt);

    // ---- where is the wall at this height? --------------------------
    const { ro, ri } = radiiAt(c, this.tool.y);
    const opened = c.isOpen();
    // Which face the hand is on decides which end of the profile the
    // mark belongs at — the outer and inner faces of one ring are a
    // wall's thickness apart in space and half a profile apart in arc.
    this.tool.arcT = this.pb.nearest(this.tool.r, this.tool.y,
      this.tool.r >= (ri + ro) * 0.5).arcT;
    this.tool.contact = Hand.contact(c, this.tool.r, this.tool.y, ro);

    const tId = this.quickWater ? 'water' : this.toolId;
    const p = this.tool.press * this.tool.contact;
    const pressing = p > 0.02 && !c.dead;

    // One undo snapshot per press, and the drag starts from rest.
    // Gate on the BUTTON, not on `pressing`: the press envelope decays
    // over several frames after the button comes up, so keying off it
    // started a fresh "press" during the release — pushing an undo
    // snapshot of the work just done, which made Ctrl+Z hand back the
    // state it was supposed to take away.
    if (this.pointer.down && pressing && !this._pressed) {
      this._pressed = true;
      this.hand.grab();
      this._pushUndo();
    }
    if (!this.pointer.down) {
      if (this._pressed) this.hand.release();
      this._pressed = false; this._needleDone = false;
    }

    // ---- the wheel finds its own speed ------------------------------
    // A potter slows the wheel down as the pot opens out, because rim
    // speed is what throws a wide form off the wheel head. Held at one
    // speed, widening fed on itself: wider means more centrifugal load
    // means it slumps wider still, and a bowl ran away into a pancake.
    if (assist && tId === 'hands' && !this._wheelManual) {
      const want = clamp(40 / Math.max(4.2, c.maxR), 3.0, 8.6);
      this.setWheelSpeed(damp(this.omegaTarget, want, 2.2, dt), false);
      if (pressing && !this._toldWheel) {
        this._toldWheel = true;
        this.hud.toast('The wheel finds its own speed, slowing as the pot opens out. <b>W</b> and <b>S</b> to take it over.', '', 5200);
      }
    }

    let verb = '';
    let power = 0;

    if (tId === 'hands') {
      // The one and only place shaping happens — shared with the
      // headless benches, so what is tested is what runs.
      const r = this.hand.apply(c, {
        r: this.tool.r, y: this.tool.y,
        pr: this.tool.pr, py: this.tool.py,
        dR: this.tool.dR, dY: this.tool.dY,
        press: this.tool.press, contact: this.tool.contact,
        omega: this.omega,
      }, dt);
      verb = r.verb;
      power = r.power;
      if (r.lifted > 1e-5 && this.rng() < r.lifted * 90) {
        this.studio.spray.emit(
          this.tool.world.x, this.tool.world.y, this.tool.world.z,
          -this.tool.world.z * 1.4, 6, this.tool.world.x * 1.4, 1, 10
        );
      }
    } else if (pressing) {
      switch (tId) {
        case 'rib':
          c.rib(this.tool.r, this.tool.y, p, dt, this.omega);
          verb = 'SMOOTH'; power = p;
          break;
        case 'trim':
          c.trim(this.tool.r, this.tool.y, p, dt, this.omega);
          if (this.rng() < dt * 30 * p) {
            this.studio.spray.emit(this.tool.world.x, this.tool.world.y, this.tool.world.z, 0, 4, 0, 1, 14);
          }
          verb = 'TURN'; power = p;
          break;
        case 'water':
          c.water(this.tool.y, p, dt);
          if (this.rng() < dt * 8) this.audio.splash(0.10);
          verb = 'WATER'; power = p;
          break;
        default: break;
      }
    }

    // an unsteady hand walks the pot off true — only for potters who asked
    if (!assist && pressing && tId === 'hands') {
      const radial = Math.abs(this.tool.r - this.tool.pr) / Math.max(dt, 1e-4);
      if (radial > 6) {
        c.nudge(this.tool.y, Math.min(0.04, (radial - 6) * 0.001) * p * clamp01(this.omega / 8), 2.2);
      }
    }
    /* Not here. The state switch in update() runs BEFORE the audio
       mixer, so clearing the flag inside _updateThrow meant the mixer
       never once saw it true — the quick-water sound has never played
       from the shortcut, only from picking the tool. Cleared at the end
       of the frame instead, after everything that reads it. */

    // ---- the needle levels the rim on a click -----------------------
    if (tId === 'needle' && this.pointer.down && !this._needleDone && this.tool.contact > 0.3) {
      this._needleDone = true;
      this._pushUndo();
      const removed = c.cutRim(this.tool.y);
      if (removed > 1) {
        this.audio.click(0.6, 0.2);
        this.hud.toast('Rim levelled.', '', 1800);
      }
    }

    // ---- physics -----------------------------------------------------
    const before = c.dead;
    c.step(dt, this.omega, { dryRate: assist ? 0.34 : 1, forgiving: assist });
    if (c.dead && !before) this._collapse();

    this.pb.update(c);

    // ---- surface and cursor ------------------------------------------
    const met = c.metrics();
    u.uWet.value = trimming ? 0.25 : clamp01(0.35 + met.moisture * 0.9);
    u.uSlip.value = clamp01(this.tool.press * this.tool.contact * 0.8);
    // Where the hand is DRAWN is the spot the player can see under the
    // pointer — the near face of the pot. The radius and height that
    // drive the clay come from where the ray runs closest to the axis,
    // and that point is a quarter turn away from the one you are
    // looking at, so using its bearing to place the marker put it out
    // on the silhouette, or behind the pot entirely, while the hand
    // worked somewhere else.
    // A band round the pot at the height the hand is working, taken
    // from the hand's own position on the profile — so it follows you
    // down into the bore, and there is no side for it to jump to.
    u.uArcLen.value = this.pb.arcLen || 24;
    u.uCursorBand.value = 1;
    u.uCursor.value.set(0, this.tool.arcT,
      0.55 + 0.40 * this.tool.press, this.tool.contact * 0.85 + 0.08);

    this.ghost.visible = this.showGhost && !!FORMS[this.commission?.require?.form] && !trimming;

    // The hand marker sits ON the wall, never in mid-air — and always on
    // the near side, facing you.
    //
    // It used to be put wherever the cursor's ray first met the clay,
    // which sounds right and is not: reach into the bore and the first
    // thing the ray meets is the outer wall on the near side, so the
    // marker sat out there while the hand worked inside. Cross the
    // middle of the pot and the surface it found flipped to the other
    // side, throwing the marker across the piece. Its height and radius
    // are the hand's own; only the way round is chosen, and it is
    // always chosen toward the camera.
    const snapR = this.tool.contact > 0.05
      ? clamp(this.tool.r, Math.max(0, Math.min(ri, ro) - 0.4), ro + 0.6)
      : this.tool.r;
    const cam = this.eng.camera;
    const ang = Math.atan2(cam.position.z - this.pot.position.z,
                           cam.position.x - this.pot.position.x);
    this.marker.visible = true;
    this.marker.position.set(
      this.pot.position.x + snapR * Math.cos(ang),
      this.pot.position.y + this.tool.y,
      this.pot.position.z + snapR * Math.sin(ang)
    );
    this.marker.scale.setScalar(0.55 + this.tool.press * 0.7);
    this.marker.material.opacity = 0.14 + this.tool.contact * 0.42;

    // the floating label, projected to the screen
    this._v.copy(this.marker.position).project(this.eng.camera);
    const sx = (this._v.x * 0.5 + 0.5) * window.innerWidth;
    const sy = (-this._v.y * 0.5 + 0.5) * window.innerHeight;
    if (!verb && this.tool.contact > 0.15) {
      const intent = Hand.intent(c, this.tool.r, this.tool.y, ro, ri);
      verb = tId !== 'hands' ? tId.toUpperCase()
        : intent === 'centre' ? 'CENTRE' : intent === 'open' ? 'OPEN' : 'SHAPE';
    }
    this.hud.setHand(sx, sy, verb, power, this.tool.contact > 0.12 && !this.hud.overlayOpen);

    // ---- camera --------------------------------------------------------
    /* Keep the pot in shot as it grows — unless the player has taken
       the camera. This ran unconditionally, sixty times a second, so a
       pinch or a shift-scroll was overwritten before the next frame:
       zooming in the throwing room did nothing whatsoever, which is
       exactly how it was reported. The framing still follows the pot's
       height for anyone who has not touched it. */
    const th = Math.max(8, c.height);
    this.eng.rig.frame(
      new THREE.Vector3(0, th * 0.52, 0),
      this.eng.rig.zoomed ? null : clamp(30 + th * 1.55, 34, 96),
      null, null
    );

    this._hudThrow(met, trimming);
  }

  /* ---------------- undo ---------------- */

  _pushUndo() {
    if (!this.clay) return;
    if (this.t - (this._lastUndoAt != null ? this._lastUndoAt : -9) < 0.35) return;
    this._lastUndoAt = this.t;
    if (!this._undoStack) this._undoStack = [];
    this._undoStack.push(this.clay.saveState());
    if (this._undoStack.length > 30) this._undoStack.shift();
  }

  undo() {
    if (!this._undoStack || !this._undoStack.length || !this.clay) {
      this.hud.toast('Nothing to take back.', '', 1600);
      return;
    }
    this.clay.loadState(this._undoStack.pop());
    this.pb.update(this.clay);
    this.audio.click(0.7, 0.12);
    const n = this._undoStack.length;
    this.hud.toast(`Taken back. ${n} step${n === 1 ? '' : 's'} left.`, '', 1700);
  }

  _hudThrow(met, trimming) {
    const rpm = (this.omega * 60) / TAU;
    this.hud.setGauge('rpm', rpm / MAX_RPM, `${Math.round(rpm)}`,
      rpm > 155 ? 'bad' : rpm > 130 ? 'warn' : '');
    this.hud.setGauge('water', met.moisture, `${pct(met.moisture)}`,
      met.moisture > 0.86 ? 'bad' : met.moisture < 0.30 ? 'warn' : '');
    if (met.opened) {
      const wallN = clamp01(met.minWall / 1.1);
      this.hud.setGauge('wall', wallN, `${fmt(met.minWall, 2)}`,
        met.minWall < 0.12 ? 'bad' : met.minWall < W_CRIT ? 'warn' : '');
    } else {
      this.hud.setGauge('wall', 0, '—', '');
    }
    this.hud.setGauge('center', met.trueness, `${pct(met.trueness)}`,
      met.trueness < 0.45 ? 'bad' : met.trueness < 0.72 ? 'warn' : '');
    const st = clamp01(met.stress / 1.4);
    this.hud.setGauge('stress', st, `${pct(clamp01(met.stress))}`,
      met.stress > 1.0 ? 'bad' : met.stress > 0.72 ? 'warn' : '');
    this.hud.setVitals(met.height, met.diameter, met.mass);

    // coaching
    if (!trimming) {
      const now = this.t;
      if (!this._lastTip) this._lastTip = 0;
      if (now - this._lastTip > 7) {
        let tip = null, kind = '';
        if (this.omega < 2 && this.tool.press > 0.3) tip = 'The wheel is barely turning. Scroll it up.';
        else if (met.trueness < 0.55 && met.opened) { tip = 'It is running out of true and it will only get worse.'; kind = 'bad'; }
        else if (met.moisture < 0.26) { tip = 'The clay has gone dry. Give it water before it tears.'; kind = 'bad'; }
        else if (met.moisture > 0.88) { tip = 'Far too wet. Let it firm up or it will slump.'; kind = 'bad'; }
        else if (met.stress > 1.05) { tip = 'The wall is past what it can hold. Slow the wheel and get a rib on it.'; kind = 'bad'; }
        else if (met.minWall < 0.13) { tip = 'That wall is about to tear.'; kind = 'bad'; }
        if (tip) { this.hud.toast(tip, kind, 4200); this._lastTip = now; }
      }
    }

    if (this.clay.stats.centered) this.save.stats.centred = 1;
    const live = liveRequirements(this.clay, this.commission);
    this.hud.setCommission(this.commission, live);
    this.hud.setAdvance(trimming ? 'Bisque fire' : 'Let it set up', true);

    // the silhouette panel, a few times a second
    this._silhoAcc = (this._silhoAcc ?? 1) + 0.016;
    if (this._silhoAcc > 0.12) {
      this._silhoAcc = 0;
      this.hud.drawSilhouette(this.clay, this.commission);
    }
    if (!trimming) this._updateCoach(met, live);
  }

  /**
   * One instruction at a time. It reads the pot, not a script, so it
   * always names the thing that is actually missing.
   */
  _updateCoach(met, live) {
    const req = this.commission?.require ?? {};
    const form = FORMS[req.form];
    const wantH = req.minH ?? (form ? (form.ratio > 1 ? 20 : 10) : 12);

    let step = 1, text = null, done = false;

    if (met.moisture > 0.80) {
      step = 1;
      text = 'That is far too wet — the clay has gone to soup and will slump. ' +
        'Take your hand off it and let the wheel dry it for a moment.';
      this.hud.setCoach(step, text, false);
      return;
    }
    if (met.opened && met.trueness < 0.45) {
      step = 1;
      text = 'It is running out of true. <b>Hold the button without moving</b>, ' +
        'against the wall, and it will come back.';
      this.hud.setCoach(step, text, false);
      return;
    }
    if (met.trueness < 0.80 && !met.opened) {
      step = 1;
      text = 'Hold the left button on the clay and move your hand <b>up and down</b> the side. ' +
        'Watch <b>TRUENESS</b> climb — nothing else works until it does.';
    } else if (!met.opened) {
      step = 2;
      text = 'Now put your hand on the <b>middle of the top</b> and drag <b>down</b>, then <b>outward</b>, ' +
        'until it is a bowl and not a lump. Nothing will lift until it is hollow.';
    } else if (met.height < wantH * 0.62) {
      step = 3;
      text = 'Grab the wall and drag <b>upward</b>. Every centimetre you drag lifts it a little — ' +
        'slow is exactly as good as fast.';
    } else {
      // Order matters. Width first: widening also brings the height down,
      // so telling someone to thin the wall of a bowl that is still too
      // narrow sends them building a tower instead of a bowl.
      const order = ['minD', 'maxD', 'minH', 'maxH', 'maxWall', 'form'];
      const missing = order.filter((k) => live[k] && !live[k].ok);
      if (missing.length === 0) {
        step = 5; done = true;
        text = 'That matches the brief. Press <b>Continue</b> when you are happy with it.';
      } else {
        step = 4;
        const how = {
          form: 'Match the dashed outline on the left — that is the shape they asked for.',
          minH: 'It needs to be taller. Grab the wall and drag <b>upward</b>.',
          maxH: 'It is too tall. Drag <b>downward</b> to press it back down, or <b>sideways, outward</b> — widening also brings the height down.',
          minD: 'It is too narrow. Grab the wall and drag <b>sideways, outward</b>.',
          maxD: 'It is too wide. Drag <b>sideways, inward</b> to collar it in.',
          maxWall: 'The wall is still heavy. Drag <b>upward</b> to thin it, then widen it back down to size.',
        }[missing[0]];
        text = how;
      }
      if (this.clay.nearMax && !this.clay.tooTall) {
        step = 4;
        text = 'It is near as tall as wet clay will stand. ' +
          'Drag <b>sideways, outward</b> to widen it, which also brings the height down.';
      }
      if (this.clay.tooTall) {
        step = 4;
        text = 'It will not go any higher — there is only so much wet clay will stand. ' +
          'Drag <b>downward</b> to press it back down, or <b>sideways, outward</b> to widen it.';
      }
    }
    this.hud.setCoach(step, text, done);
  }

  _collapse() {
    this.audio.thud(0.8);
    this.eng.rig.kick(0.9);
    this.hud.toast(this.clay.deadReason, 'bad', 8000);
    this.save.stats.collapses++;
    /* Losing it because it was soaked is its own lesson, and the codex
       has a fragment about exactly that — "On too much water" — gated on
       stats.drowned. Nothing has ever incremented that counter, in any
       version, so the fragment could not be reached: it was written,
       shipped and unreachable.
       The threshold is measured, not picked. Fresh clay reads 0.62 mean
       moisture and dries toward 0.563 if left alone; working it with the
       water tool at a normal rate reaches 0.732, and soaking it
       continuously saturates at 0.82. 0.75 is above anything you arrive
       at without deliberately drowning it. */
    if ((this.clay?.metrics?.().moisture ?? 0) > 0.75) this.save.stats.drowned++;
    this.omegaTarget = 0;
    setTimeout(() => this._collapsedOverlay(), 1300);
  }

  _collapsedOverlay() {
    this.hud.openOverlay(`
      <div class="ov-kicker">It came down</div>
      <div class="ov-title">Wedge it again</div>
      <div class="ov-sub">${this.clay.deadReason}</div>
      <div class="ov-body"><p>Nothing is wasted. The clay goes back in the bag and you have learned
      something that cannot be read.</p></div>
      <div class="ov-actions">
        <button class="btn primary" data-a="again">Start over</button>
        <button class="btn ghost" data-a="menu">Menu</button>
      </div>`);
    this.hud.bind('[data-a="again"]', () => { this.audio.click(); this.startThrow(); });
    this.hud.bind('[data-a="menu"]', () => this.openMenu());
  }

  /* ---------------- glazing ---------------- */

  /**
   * Wipe the coach on the way into a new phase.
   *
   * The coaching line belongs to whatever the player is doing right now,
   * and nothing was clearing it at a phase boundary — so "Dip is the
   * evenest coat there is" sat across the middle of the kiln room,
   * advising the player about a bucket that is two rooms away. It cannot
   * live in setStage(), because the glaze tools and the firing narration
   * both call setStage repeatedly inside their own phase and would wipe
   * the coach they had just written.
   */
  _clearCoach() {
    this._fireText = null;
    this.hud.setCoach(0, null);
  }

  startTrim() {
    this._clearCoach();
    /* The throwing snapshots do not survive the drying.
       The stack is cleared when a throw begins and nowhere else, so
       every state from the wheel was still on it here — and toLeather()
       shrinks the body by 4.8% and sets the moisture down to leather.
       One Ctrl+Z in the trimming room handed back a pot that was wet
       again and 5% larger, which then finished 5.04% oversize against
       every dimension in the brief: a 20.0 cm throw ending at 19.24
       instead of 18.32. Undo belongs to the stage you are in. */
    this._undoStack = [];
    const c = this.clay;
    c.toLeather();
    this.pb.update(c);
    this.state = ST.TRIM;
    this.omegaTarget = 6.0;
    this.mat.userData.u.uWet.value = 0.25;
    this.hud.setToolset('trim', 'trim');
    this.hud.setStage('LEATHER-HARD', 'A day under cloth. Now turn the foot: cut away the surplus and leave a clean ring to stand on.');
    // Trimming used to inherit the throwing hints, which advertise water
    // and a wheel-speed control that do nothing to leather-hard clay.
    this.hud.setKeyHints([
      ['DRAG', 'cut the foot'], ['RMB', 'orbit'], ['SHIFT+SCROLL', 'zoom'],
      ['CTRL+Z', 'take it back'], ['ENTER', 'bisque fire'],
    ]);
    this.hud.setAdvance('Bisque fire');
    this.hud.toast('Dried to leather-hard. It shrank about five parts in a hundred.', '', 5200);
    this.audio.ring(1.4, false);
  }

  startGlaze() {
    this._clearCoach();
    // a wheel left spinning should not still be spinning next time
    this._band = 0; this._bandV = 0; this._bandT = 0;
    const c = this.clay;
    c.toBisque();
    this.pb.update(c);
    this.field.clear();
    this.field.bindProfile(this.pb);
    this.field.upload();
    this.save.firings++;

    this.state = ST.GLAZE;
    this.omegaTarget = 0;
    this.omega = 0;
    this.pot.rotation.y = 0;
    const u = this.mat.userData.u;
    u.uWet.value = 0;
    u.uBisque.value = 1;
    u.uFired.value = 0;
    u.uCursor.value.set(-9, -9, 0, 0);

    this.slots = [GLAZE_BY_ID[this.save.glazes[0]] ?? GLAZES[0], null, null];
    this.slotIndex = 0;
    applyFireResult(this.mat, null, this.slots);

    this.ghost.visible = false;
    this.marker.visible = false;
    this.hud.showGauges(false);
    this.hud.showFormView(false);
    this.hud.setHand(0, 0, '', 0, false);
    this.hud.setToolset('glaze', 'dip');
    this._glazeCoachText = null;
    this._updateGlazeCoach();
    this.hud.setStage('THE GLAZE ROOM', 'Bisque-fired: hard, porous, and thirsty. Whatever you put on now is what the fire gets to work with.');
    this.hud.setAdvance('To the kiln');
    this.hud.setKeyHints([
      ['LMB', 'apply'], ['RMB drag', 'turn the pot'], ['SCROLL', 'turn it a nudge'],
      ['SHIFT+SCROLL', 'zoom'], ['1-6', 'tools'], ['ENTER', 'to the kiln'],
    ]);
    this.hud.glazePanel(
      {
        glazes: this.free ? this._freeGlazes() : this.save.glazes,
        slot: this.slots[0]?.id,
        thickness: this.glazeThickness,
        // guided mode does not offer a coat that welds the pot to the shelf
        guided: this.firingMode() === 'guild',
        safeCoat: this.coatCeiling(this.slots[0]),
      },
      (id) => this._pickGlaze(id),
      (v) => { this.glazeThickness = v; },
    );
    // ...and the coat already on the dial has to obey the same ceiling,
    // because Zinc Flower's is below the value the dial opens at
    if (this.firingMode() === 'guild') {
      this.glazeThickness = Math.min(this.glazeThickness, this.coatCeiling(this.slots[0]));
    }
    // mark the one bucket already open, so the shelf reads correctly
    // before the player has touched anything
    this._glazeRoom = this._glazeRoomLeft();
    this.hud.updateGlazeSelection(this.slots[0]?.id, this.slots, this._glazeRoom);
    this.eng.rig.frame(new THREE.Vector3(0, c.height * 0.5, 0), clamp(28 + c.height * 1.5, 30, 80), 1.30, CAMERA.theta);
    this.hud.toast('Bisque fired. Another four parts in a hundred gone.', '', 4200);
    this._glazeHint('dip');
  }

  /** Is there anywhere to put another glaze: an empty layer, or one
   *  that was opened and never actually painted with. */
  _glazeRoomLeft() {
    return this.slots.some((s, i) => !s || !this.field.hasPaint(i));
  }

  _pickGlaze(id) {
    const g = GLAZE_BY_ID[id];
    if (!g) return;

    /* A pot carries three layers, and what used to happen on the fourth
       was the worst of all the things that could have happened: it took
       the third slot and said nothing. The paint stayed exactly where it
       was on the pot — but the layer it lived in now named a different
       glaze, so every stroke of tenmoku you had laid down quietly became
       shino. A different colour, a different chemistry, a different
       maturing temperature, and no way back: the glaze room has no undo.

       So a bucket you only OPENED costs nothing — clicking down the
       shelf to see what the colours are should be free — and a layer you
       have actually painted with is not taken away from you. */
    let idx = this.slots.findIndex((s) => s?.id === id);
    if (idx < 0) {
      const spare = (i) => i >= 0 && this.slots[i] && !this.field.hasPaint(i);
      idx = this.slots.findIndex((s) => !s);
      // then the bucket you are holding, if you have not used it — going
      // down the shelf reading labels should swap what is in your hand,
      // not quietly load a fourth, fifth and sixth glaze onto the pot
      if (idx < 0 && spare(this.slotIndex)) idx = this.slotIndex;
      if (idx < 0) idx = this.slots.findIndex((s, i) => spare(i));
      if (idx < 0) {
        const on = this.slots.filter(Boolean).map((s) => s.name);
        this.hud.toast(
          `This pot is already carrying ${on.slice(0, -1).join(', ')} and ${on[on.length - 1]}. `
          + 'Three is all it can hold.', 'bad', 5200);
        this.audio.click(0.6, 0.35);
        // and let the shelf show it, rather than only saying it once
        this._glazeRoom = false;
        this.hud.updateGlazeSelection(this.slots[this.slotIndex]?.id, this.slots, false);
        return;
      }
      this.slots[idx] = g;
    }
    this.slotIndex = idx;
    this.field.slotIds = this.slots.map((s) => s?.id ?? null);
    applyFireResult(this.mat, null, this.slots);
    this.hud.updateGlazeSelection(id, this.slots, this._glazeRoomLeft());
    this.audio.click(0.9, 0.1);
    /* Say what a glaze is the first time it is picked up, and after that
       shut up about it. The shelf row is already highlighted, its name
       and its temperature are already on it, and the description is on
       the row as a title — repeating all of it across the middle of the
       screen every single tap is how three paragraphs ended up over the
       pot in a screenshot. */
    this._metGlaze = this._metGlaze || new Set();
    if (!this._metGlaze.has(g.id)) {
      this._metGlaze.add(g.id);
      this.hud.toast(`${g.name} — ${g.desc}`, '', 4200);
    }

    /* Each glaze runs at its own thickness, and some of them run at a
       thinner coat than the dial opens at. Picking one has to bring the
       dial with it, or choosing Zinc Flower quietly arms a coat that
       welds the pot to the shelf. */
    if (this.firingMode() === 'guild') {
      const cap = this.coatCeiling(g);
      if (this.glazeThickness > cap) {
        this.glazeThickness = cap;
        this.hud.toast(
          `${g.name} runs easily — the coat is held at ${(cap * 10).toFixed(2)} mm.`, '', 3200);
      }
      this.hud.setCoatCeiling?.(cap, this.glazeThickness);
    }
  }

  /**
   * The glaze room, said out loud.
   *
   * The wheel walks a player through what to do next and the glaze room
   * did not, which is the whole of why it felt arbitrary: every tool
   * explained ITSELF, but nothing said what the job was, how far
   * through it you were, or when it was done. Bisque drinks glaze
   * invisibly — a bare patch and a good one look much the same in the
   * room and come out of the fire completely different — so without a
   * number for coverage there is nothing to go on at all.
   */
  _updateGlazeCoach() {
    const gs = this.field.stats();
    const req = this.commission?.require ?? {};
    const cover = gs.totalCoverage ?? 0;
    const foot = gs.footClean ?? 1;
    const cur = this.slots[this.slotIndex];
    const dom = gs.meanThick.indexOf(Math.max(...gs.meanThick));
    const thick = gs.meanThick[dom] ?? 0;
    const safe = this.safeCoat(this.slots[dom] ?? cur);

    let step = 1, text;
    if (req.glaze && cur && cur.id !== req.glaze) {
      text = `This one is to be glazed in <b>${glazeName(req.glaze)}</b>. Choose it on the right before you put anything on — what is underneath still shows.`;
    } else if (cover < 0.02) {
      step = 2;
      text = this._touchUI()
        ? 'Nothing on it yet. <b>Dip</b> is the evenest coat there is: hold on the pot, slide to set the line, let go.'
        : 'Nothing on it yet. <b>Dip</b> is the evenest coat there is: hold the button on the pot, move to set the line, let go.';
    } else if (cover < 0.55) {
      step = 3;
      text = `<b>${Math.round(cover * 100)}%</b> covered. Bare bisque comes out of the fire bare — `
        + `${this._touchUI() ? '<b>two fingers</b>' : '<b>drag with the right button</b>'} to turn the pot and get at the other side.`;
    } else if (cover < 0.88) {
      step = 3;
      text = `<b>${Math.round(cover * 100)}%</b> covered. Look for the misses where the pot turns away from you.`;
    } else if (thick > safe) {
      /* The two thresholds here used to be 0.55 and 1.9, against a
         number measured in centimetres that the coat slider can only
         drive between 0.038 and 0.286. So EVERY coat was "thin — raise
         the thickness" and none was ever "heavy": the only advice the
         game could give was to add more glaze, and adding more glaze is
         what welds the pot to the shelf. They are measured against what
         THIS glaze can actually carry now. */
      step = 4;
      text = 'That coat is <b>heavy</b>. Any more and it will run off the foot and weld the pot to the shelf.';
    } else if (thick < safe * 0.34) {
      step = 4;
      text = 'Covered, but the coat is <b>thin</b> — thin glaze goes dry and patchy over an edge. Another pass.';
    } else if (foot < 0.6) {
      step = 5;
      text = 'Now <b>wipe the foot</b> — the sponge, last on the belt. Molten glaze runs downward, and any that '
        + 'reaches the bottom glues the pot to the kiln shelf. It comes off the shelf in pieces.';
    } else {
      step = 6;
      text = `Covered${gs.evenness > 0.6 ? ' and even' : ''}, foot clean. <b>To the kiln.</b>`;
    }
    if (text !== this._glazeCoachText) {
      this._glazeCoachText = text;
      this.hud.setCoach(step, text);
    }
  }

  /**
   * What this tool wants you to do, in the words of the thing you are
   * holding it with.
   *
   * Every one of these named a mouse and a click, on a device that has
   * neither — "set the line with the mouse, click to lower the pot in",
   * read off an iPad. Worse than useless: it describes an interaction
   * that is not available, so a player who follows it exactly gets
   * nothing and concludes the tool is broken.
   */
  _glazeHint(tool) {
    // guarded: the benches run this in node, where there is no matchMedia
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
    const H = touch ? {
      dip: 'Hold anywhere on the pot and slide up or down to set the line. Let go and it goes in.',
      pour: 'Hold on the pot to pour a ribbon down the side facing you. The longer you hold, the further it runs.',
      brush: 'Drag to paint. Thin coats break over the edges; thick ones pool and run.',
      spray: 'Hold to mist the side facing you. Wide and soft, and it never reaches inside.',
      wax: 'Paint wax where you want no glaze at all. The foot, usually.',
      wipe: 'Tap to sponge the foot clean. Do not skip this — glaze on the foot welds the pot to the shelf.',
    } : {
      dip: 'Hold the button on the pot and move up or down to set the line. Let go and it goes in.',
      pour: 'Hold to pour a ribbon down the side facing you. The longer you hold, the further it runs.',
      brush: 'Drag to paint. Thin coats break over the edges; thick ones pool and run.',
      spray: 'Hold to mist the side facing you. Wide and soft, and it never reaches inside.',
      wax: 'Paint wax where you want no glaze at all. The foot, usually.',
      wipe: 'Click to sponge the foot clean. Do not skip this — glaze on the foot welds the pot to the shelf.',
    };
    if (H[tool]) this.hud.setStage('THE GLAZE ROOM', H[tool]);
  }

  _updateGlaze(dt) {
    // The banding wheel keeps turning after you let go of it. `_band` is
    // radians per SECOND, so this behaves the same at 30 fps and at 144.
    if (this._band) {
      this.pot.rotation.y += this._band * dt;
      this._band *= Math.exp(-2.2 * dt);
      if (Math.abs(this._band) < 0.02) this._band = 0;
    }
    this._updateToolPoint();
    // reading the whole field is not free; four times a second is plenty
    this._glazeTick = (this._glazeTick ?? 0) + dt;
    if (this._glazeTick > 0.25) {
      this._glazeTick = 0;
      this._updateGlazeCoach();
      // The pot fills up mid-stroke, not when a bucket is chosen, so the
      // shelf has to notice on its own. Otherwise the first a player
      // hears of the three-layer limit is being refused.
      const room = this._glazeRoomLeft();
      if (room !== this._glazeRoom) {
        this._glazeRoom = room;
        this.hud.updateGlazeSelection(this.slots[this.slotIndex]?.id, this.slots, room);
      }
    }
    const c = this.clay;
    const u = this.mat.userData.u;

    // ray onto the pot for the brush tools
    const cam = this.eng.camera;
    const dir = new THREE.Vector3(this.pointer.nx, this.pointer.ny, 0.5)
      .unproject(cam).sub(cam.position).normalize();
    const org = cam.position.clone().sub(this.pot.position);
    const hit = raycastPot(org, dir, this.pb);

    const tool = this.hud.tool;
    let cursorOn = 0;

    if (tool === 'dip') {
      /* _dipFrac is the GLAZE LINE, as a fraction of the height, and it
         is simply where the hand is. It used to be handed to dip() as a
         depth, and dip() reads a depth as "how far up from the foot the
         glaze reaches" — so the two ran in opposite directions and the
         marker ended up at the mirror image of the line it claimed to
         show. Measured on the real field: the marker at 0.20 of the
         height put the glaze line at 0.801, at 0.50 it put it at 0.514,
         and at 0.80 it put it at 0.206. Marker plus line came to 1.0
         every time, which is a sign error, not a matter of taste.
         Now the marker sits ON the line, and pushing the pot further
         down into the bucket covers more of it — which is what a hand
         and a bucket do. */
      const frac = clamp01(this.tool.y / Math.max(1, c.height));
      this._dipFrac = frac;
      u.uCursor.value.set(0.5, 0, 0, 0);
      this._dipLineY = frac * c.height;
      cursorOn = 0;
    } else if (hit.hit) {
      const t = GLAZE_TOOLS[tool] || GLAZE_TOOLS.brush;
      const arcLen = this.pb.arcLen || 24;
      u.uArcLen.value = arcLen;
      u.uCursorBand.value = t.shape;
      u.uCursor.value.set(this._localAngle(hit.angle), hit.arcT,
        cursorSize(t, arcLen), 0.9);
      cursorOn = 1;
      this._hit = hit;
    } else {
      u.uCursor.value.set(-9, -9, 0, 0);
      this._hit = null;
    }

    if (this.pointer.down && !this.hud.overlayOpen) {
      const slot = this.slotIndex;
      // The raycast answers in WORLD bearings and the glaze lives in the
      // pot's own frame. Those were the same number only for as long as
      // the pot could not be turned; now that it can, painting has to be
      // put back into the clay's frame or the brush lands somewhere the
      // player is not pointing.
      const hAng = hit.hit ? this._localAngle(hit.angle) : 0;
      if (tool === 'brush' && hit.hit) {
        this.field.brush(hAng, hit.arcT, GLAZE_TOOLS.brush.rad, slot, this.glazeThickness * dt * 5.5);
      } else if (tool === 'wax' && hit.hit) {
        this.field.brush(hAng, hit.arcT, GLAZE_TOOLS.wax.rad, slot, dt * 3.2, true);
      } else if (tool === 'pour' && hit.hit) {
        this.field.pour(hAng, GLAZE_TOOLS.pour.widthFrac, slot, this.glazeThickness * dt * 3.4, hit.arcT);
        if (this.rng() < dt * 10) this.audio.splash(0.07);
      } else if (tool === 'spray' && hit.hit) {
        /* A mist, not a hose. Two seconds of holding used to put down
           1236 units of glaze against the brush's 97 for the same two
           seconds — twelve times as much — and photographed, the pot
           was uniformly coated from foot to rim before the player had
           finished pressing. Spray is meant to be the tool you shade
           with; it was the tool that ended the decision. */
        this.field.spray(hAng, slot, this.glazeThickness * dt * 0.85, GLAZE_TOOLS.spray.spread);
      }
      this.field.upload();
    }

    // the ghost line for dipping
    this.marker.visible = tool === 'dip';
    if (tool === 'dip') {
      this.marker.position.set(0, this._dipLineY ?? 0, this.pb.rmax + 2.5);
      this.marker.scale.setScalar(1.1);
      this.marker.material.opacity = 0.9;
    }

    // the coverage survey walks 30k cells; six times a second is plenty
    this._statAcc = (this._statAcc ?? 1) + dt;
    if (this._statAcc > 0.16) {
      this._statAcc = 0;
      const gs = this.field.stats();
      gs.slotIds = this.slots.map((s) => s?.id ?? null);
      this._glazeStats = gs;
      this.hud.setCommission(this.commission,
        liveRequirements(this.clay, this.commission, gs, this.schedule, null));
    }
  }

  _glazeAction(down) {
    const tool = this.hud.tool;

    /* DIP — lower it in, and lift it out.
       This used to happen on the press, at whatever depth the pointer
       was already at. With a mouse that reads as "aim, then commit",
       because the line has been following the cursor for as long as it
       has been over the pot. A finger has no hover at all — the pointer
       does not exist until it lands — so on a tablet the pot went into
       the bucket at the depth of wherever you first touched, instantly,
       and there was no way to choose. The depth control did not exist.
       Holding now sets the line and letting go does the dip, which is
       one gesture that means the same thing under a thumb and under a
       mouse, and is what your hands do to a pot and a bucket. */
    if (tool === 'dip') {
      if (down) { this._dipHeld = true; return; }
      if (!this._dipHeld) return;
      this._dipHeld = false;
      // dip() takes a depth measured up from the foot; _dipFrac is the
      // line measured down from the rim. They are complements.
      this.field.dip(1 - clamp01(this._dipFrac ?? 0.2), this.slotIndex, this.glazeThickness);
      this.field.upload();
      this.audio.splash(0.34);
      /* The COATED fraction, not the dry one.
         _dipFrac is the glaze line measured up from the foot, and a dip
         coats everything ABOVE it — so with the line at 0.2 the pot
         comes out four-fifths covered and this said "Dipped to 20%".
         It was reporting the part that stayed out of the bucket. */
      this.hud.toast(
        `Dipped — ${Math.round(100 * (1 - clamp01(this._dipFrac ?? 0.2)))}% of the wall coated.`,
        '', 1500);
      return;
    }

    if (!down) return;
    if (tool === 'wipe') {
      this.field.wipeFoot(0.75);
      this.field.upload();
      /* Say what happened, do not assert it.
         This announced "Foot wiped clean." in green whatever the state
         of the foot, and for a long time that was simply untrue — the
         sponge could not reach what the kiln inspects, so the player
         was congratulated and then refused. The band is fixed now, but
         a tool reporting its own success without looking is how that
         went unnoticed for so long, so it looks. */
      this.audio.click(0.7, 0.14);
      const fc = this.field.footClean();
      if (fc > 0.92) this.hud.toast('Foot wiped clean.', 'good', 1800);
      else if (fc > 0.4) this.hud.toast('Foot mostly clean — go round it again.', '', 2400);
      else this.hud.toast('Still glaze on the foot. Wipe it again.', 'hot', 2600);
    }
  }

  /* ---------------- kiln ---------------- */

  startKiln() {
    this._clearCoach();
    this.state = ST.KILN;
    this.marker.visible = false;
    this.mat.userData.u.uCursor.value.set(-9, -9, 0, 0);
    this.hud.setToolset('none');
    this.hud.setStage('THE KILN', 'Everything you do from here is a bet. Set the schedule and light it.');
    this.hud.setAdvance('Light the kiln');
    this.hud.setKeyHints([
      ['DRAG', 'sliders'], ['RMB', 'orbit'], ['SCROLL', 'zoom'], ['ENTER', 'light it'],
    ]);
    // The hottest glaze actually on the pot decides how hot this fire has
    // to get, so the panel is told which one it is rather than leaving the
    // player to know that a celadon wants 1272 °C.
    const onPot = this.slots.filter(Boolean);
    const needs = onPot.length
      ? onPot.reduce((a, b) => (maturePoint(b) > maturePoint(a) ? b : a))
      : null;
    const need = needs ? { name: needs.name, temp: maturePoint(needs) } : null;

    // In the Guild's hands unless the player has asked for the kiln.
    // Recomputed on arrival rather than remembered, because it depends
    // on the glazes that ended up on THIS pot and the wall it was
    // thrown with, neither of which was known when the last one fired.
    if (this.firingMode() === 'guild') this._setGuildSchedule();

    this.hud.kilnPanel(
      this.schedule,
      () => this.hud.updateKilnPanel(this.schedule, this.save.coin, need),
      {
        mode: this.firingMode(),
        onMode: (m) => {
          this.save.settings.firing = m;
          this.audio.click();
          if (m === 'guild') this._setGuildSchedule();
          this.startKiln();          // rebuild the panel in the new mode
        },
      },
    );
    this.hud.updateKilnPanel(this.schedule, this.save.coin, need);

    // carry the pot to the kiln
    this._moveTo = new THREE.Vector3(KILN_POS.x, this.studio.kilnShelfY, KILN_POS.z);
    this.eng.rig.frame(
      new THREE.Vector3(KILN_POS.x, this.studio.kilnShelfY + 14, KILN_POS.z + 8), 150, 1.36, -0.10
    );
  }

  /** 'guild' or 'hand'. Guild unless the player has said otherwise. */
  firingMode() { return this.save.settings.firing === 'hand' ? 'hand' : 'guild'; }

  /** Is a finger driving this? The benches run headless, where asking is fatal. */
  _touchUI() {
    return typeof matchMedia === 'function' && matchMedia('(pointer:coarse)').matches;
  }

  /**
   * The thickest coat of this glaze that survives the firing it is going
   * to get. Cached: the answer only moves when the glaze or the brief
   * does, and working it out bisects against the real fire().
   *
   * This exists because the coat slider runs to 0.30 and eleven of the
   * twelve glazes weld the pot to the shelf somewhere inside that — Zinc
   * Flower at 0.125, which is UNDER the 0.13 the slider starts at. The
   * crystal glaze that commission c7 asks for by name was destroyed at
   * the factory default, in the mode that promises the pot comes out
   * fired.
   */
  safeCoat(glaze = this.slots[this.slotIndex]) {
    if (!glaze) return 0.30;
    const key = `${glaze.id}|${this.commission?.require?.effect ?? ''}|${this.commission?.require?.atmos ?? ''}`;
    this._safeCoats = this._safeCoats || new Map();
    if (!this._safeCoats.has(key)) {
      this._safeCoats.set(key,
        safeCoat(glaze, this.clay ? this.clay.metrics() : null, this.commission?.require));
    }
    return this._safeCoats.get(key);
  }

  /**
   * Where the coat dial stops, which is a little under the true limit.
   *
   * A dip beads where the pot came out of the bucket and lays down about
   * three per cent more than the number on the dial. Without the margin,
   * setting the dial to its own maximum and dipping once puts the coat
   * just past safe and the coach immediately calls it heavy — which
   * makes the ceiling a liar about the one thing it exists to promise.
   */
  coatCeiling(glaze = this.slots[this.slotIndex]) {
    return Math.max(0.04, 0.88 * this.safeCoat(glaze));
  }

  /**
   * Hand the kiln to the Guild: the schedule that fires the glazes that
   * are actually on this pot, at a rate this wall can take, in the air
   * the brief asked for.
   */
  _setGuildSchedule() {
    this.schedule = guildSchedule(
      this.slots.filter(Boolean),
      this.clay ? this.clay.metrics() : null,
      this.commission?.require,
    );
  }

  _updateKilnSetup(dt) {
    this.pot.position.lerp(this._moveTo, 1 - Math.exp(-3 * dt));
    this.pot.rotation.y += dt * 0.12;
    this._kilnHeat = damp(this._kilnHeat ?? 0, 0.10, 2, dt);
    this.firing.temp = 20;
  }

  lightKiln() {
    const cost = this.free ? 0 : fuelCost(this.schedule);
    if (!this.free && cost > this.save.coin) {
      this.hud.toast(`That firing costs ${cost} ash-marks and you have ${this.save.coin}.`, 'bad', 4200);
      return;
    }
    if (!this.free) { this.save.coin -= cost; this.hud.setLedger(this.save); }

    this.state = ST.FIRING;
    this._clearCoach();
    this.firing = { t: 0, dur: 40, temp: 20, running: true, rising: true, moved: 0, peakSeen: 0 };
    this._flowAcc = 0;
    this.hud.hideContext();
    this.hud.setStage('FIRING', 'Forty hours in about forty seconds. You cannot open it now.');
    this._fireText = null;
    this.hud.setAdvance('…', false);
    this.hud.toast(`${cost} ash-marks of wood. Damper closes at ${Math.round(this.schedule.reduceFrom)}°C.`, 'hot', 5000);
    this.audio.chime(true);
    // stay square on to the door for the whole firing, and creep in
    this.eng.rig.frame(new THREE.Vector3(KILN_POS.x, this.studio.kilnShelfY + 16, KILN_POS.z + 6), 172, 1.40, -0.02);
    this.eng.rig.autoSpin = 0;

    this._firingGlazes = this.slots.map((s) => s ?? null);
    this._preStats = this.field.stats();
  }

  /**
   * Say what the fire is doing.
   *
   * A firing was forty seconds of a shut door with a title over it and
   * nothing else — no temperature, no idea how far along it was, no
   * word for what was happening inside. Everything that makes a firing
   * worth watching is invisible by nature, which is exactly why it has
   * to be narrated: the point where the damper closes and the kiln
   * starts pulling oxygen out of the glaze is the single most important
   * moment in the whole process and it looks like nothing at all.
   */
  _firingNarration() {
    const f = this.firing;
    const T = Math.round(f.temp);
    const sch = this.schedule;
    const prog = clamp01(f.t / f.dur);
    const cooling = f.peakSeen > 900 && T < f.peakSeen - 40;
    let step, text;

    if (cooling) {
      step = 6;
      text = T > 700
        ? `<b>${T}°C</b> — cooling. The glass is setting. Come down too fast here and it crazes.`
        : `<b>${T}°C</b> — cooling. Nothing to do but wait for a door you can touch.`;
    } else if (T >= sch.peak - 25) {
      step = 5;
      text = `<b>${T}°C</b> — soaking at the top. The glaze is liquid and running; how long it sits here is how far it moves.`;
    } else if (sch.reduction > 0.05 && T >= sch.reduceFrom) {
      step = 4;
      text = `<b>${T}°C</b> — <b>reduction</b>. The damper is shut and the fire is starving. This is where copper turns red and iron turns green.`;
    } else if (T > 900) {
      step = 3;
      text = `<b>${T}°C</b> — the glaze has gone to glass and started to move.`;
    } else if (T > 250) {
      step = 2;
      text = `<b>${T}°C</b> — burning out. Whatever was left of the wax and the organics is going up the chimney.`;
    } else {
      step = 1;
      text = `<b>${T}°C</b> — water smoking. Slow, or it cracks.`;
    }
    text += `  <span style="opacity:.55">${Math.round(prog * 100)}% through</span>`;
    if (text !== this._fireText) { this._fireText = text; this.hud.setCoach(step, text); }
  }

  _updateFiring(dt) {
    const f = this.firing;
    f.t += dt;
    this._fireTick = (this._fireTick ?? 0) + dt;
    if (this._fireTick > 0.2) { this._fireTick = 0; this._firingNarration(); }
    const prog = clamp01(f.t / f.dur);
    const T = kilnCurve(this.schedule, prog);
    f.rising = T >= f.temp;
    f.temp = T;
    f.peakSeen = Math.max(f.peakSeen, T);

    // Glaze runs while it is molten. The flow solve touches ~92k cells,
    // so it is stepped at a fixed 20 Hz with the accumulated kiln time
    // rather than once per rendered frame.
    const hours = scheduleHours(this.schedule);
    this._flowAcc = (this._flowAcc ?? 0) + dt;
    if (T > 900 && this._flowAcc >= 0.05) {
      const dtHours = (this._flowAcc / f.dur) * hours;
      f.moved += this.field.flow(dtHours * 0.55, T, this._firingGlazes);
      // ...and SHOW it. The flow solve was running for the whole firing
      // and its results never left the CPU, so the one thing worth
      // watching — glaze softening, pooling, crawling down the side —
      // happened invisibly and the pot only changed once, at the end.
      this.field.upload();
      this._flowAcc = 0;
    } else if (T <= 900) {
      this._flowAcc = 0;
    }

    const u = this.mat.userData.u;
    const glow = clamp01((T - 480) / 780);
    u.uHeat.value = glow;
    u.uTemp.value = T;
    u.uSoot.value = clamp01(this.schedule.reduction * smoothstep(this.schedule.reduceFrom, this.schedule.reduceFrom + 200, T) * 0.5);
    // the glaze melts and becomes glass as it goes
    const meltProg = clamp01(smoothstep(1000, this.schedule.peak - 30, T) * (prog > 0.3 ? 1 : 0.6));
    u.uFired.value = Math.max(u.uFired.value, meltProg);
    if (!this._firedApplied && prog > 0.34) {
      this._firedApplied = true;
      const pre = this._preStats;
      // a bucket that was selected but never used is not a glaze layer
      const layers = this.slots.map((g, i) => (g && pre.coverage[i] > 0.012 && pre.meanThick[i] > 0.004) ? {
        glaze: g, coverage: pre.coverage[i], meanThick: pre.meanThick[i],
      } : null).filter(Boolean);
      this.fireResult = fireGlaze(layers, this.schedule, this.clay.metrics());
      applyFireResult(this.mat, this.fireResult, this.slots);
    }

    // The FIRE is not the pot.
    //
    // All of the kiln's light was driven by how hot the WARE was, so
    // for the first third of a firing — twelve seconds of a forty
    // second one — there was no fire at all: no flame at the mouth, no
    // light, nothing moving, on a kiln that had just been lit. A wood
    // kiln is at full blaze from the moment it catches; the ware
    // starts glowing much later and stops much sooner. They are two
    // different things and the room should be lit by the first one.
    const lit = smoothstep(0, 1.6, f.t);
    // "Falling from the peak" means nothing until there has BEEN a peak:
    // a kiln at sixty degrees is a kiln that was lit a moment ago, not
    // one that is going out.
    const wasHot = smoothstep(400, 900, f.peakSeen);
    const cooling = wasHot * smoothstep(f.peakSeen - 40, Math.max(80, f.peakSeen - 450), T);
    this._kilnFire = lit * (1 - 0.94 * cooling);
    this._kilnHeat = glow;
    // slow push toward the spy hole as it comes up to heat
    this.eng.rig.goalRadius = lerp(172, 104, smoothstep(0.10, 0.62, prog));
    this.eng.rig.goalTheta = -0.02 + Math.sin(prog * 2.4) * 0.10;
    this.eng.bloom.strength = 0.52 + glow * 0.22;
    // the eye stops down when it is looking into a kiln
    // 0.40 was the pre-overhaul stop-down and this was the one path the
        // fix in Studio.adapt() missed: it drove the WHOLE frame to 0.90 for
        // the forty seconds that are the best thing in the game, while every
        // other state runs between 1.26 and 1.50. The room is bright cream
        // now, so all a big cut does is drag the plaster and the floor into
        // the tone curve's toe. Put the contrast in the fire, not in the room.
        this.eng.renderer.toneMappingExposure = EXPOSURE0 * (1 - glow * 0.16);

    // shrink as it vitrifies
    if (!this._shrunk && prog > 0.42) {
      this._shrunk = true;
      this.clay.toVitrified();
      this.pb.update(this.clay);
      this.field.bindProfile(this.pb);
    }

    if (Math.floor(this.t * 6) !== this._lastFireLine) {
      this._lastFireLine = Math.floor(this.t * 6);
    this.hud.setStage('FIRING', `<b>${Math.round(T)}°C</b> &nbsp; ${
      f.rising ? (T > this.schedule.reduceFrom && this.schedule.reduction > 0.15 ? 'damper closed — reducing' : 'climbing')
        : (this.schedule.cooling === 'slow' && Math.abs(T - this.schedule.holdT) < 40 ? 'holding for crystal growth' : 'cooling')
    } &nbsp;·&nbsp; ${Math.round(prog * 100)}%`);
    }

    if (f.moved > 0.4 && !this._runWarned && f.rising) {
      this._runWarned = true;
      this.hud.toast('You can see it moving through the spy hole. The glaze is running.', 'hot', 4600);
    }

    if (prog >= 1) this.openKiln();
  }

  openKiln() {
    this.state = ST.REVEAL;
    this._clearCoach();
    this._kilnHeat = 0.12;
    this.eng.bloom.strength = 0.52;
    this.eng.renderer.toneMappingExposure = EXPOSURE0;
    this._firedApplied = false;
    this._shrunk = false;
    this._runWarned = false;

    const u = this.mat.userData.u;
    u.uHeat.value = 0;
    u.uFired.value = 1;
    u.uVitrified.value = 1;

    // final flow-adjusted statistics
    const gs = this.field.stats();
    gs.slotIds = this.slots.map((s) => s?.id ?? null);

    // a late check: did it run onto the shelf after all?
    const footRisk = this.field.footRisk();
    if (this.fireResult && !this.fireResult.destroyed && footRisk > 0.30) {
      this.fireResult.destroyed = true;
      this.fireResult.destroyReason =
        'It ran. There is a foot of glass welding the pot to the shelf and neither is coming off whole.';
      this.fireResult.defects.push('welded to shelf');
    }

    this.report = appraise({
      clay: this.clay,
      commission: this.commission,
      glazeStats: gs,
      fireResult: this.fireResult ?? { maturity: 0, defects: [], notes: [] },
      schedule: this.schedule,
    });

    if (this.report.destroyed) {
      this.pot.visible = false;
      this.audio.shatter(0.6);
      this.eng.rig.kick(0.7);
    } else {
      this.audio.ring(1.0 / Math.max(0.6, this.clay.height / 16), this.report.metrics.minWall < 0.09);
    }

    this.eng.rig.frame(new THREE.Vector3(0, this.clay.height * 0.5, 0), clamp(26 + this.clay.height * 1.4, 30, 76), 1.28, CAMERA.theta);
    this.eng.rig.autoSpin = 0.20;
    this.pot.position.set(0, 0, 0);

    this._applyResults();
    /* Held, so it can be cancelled. Enter during the reveal calls
       showReport() straight away (the ST.REVEAL case in _onEnter), and
       this timer then fired 1.5s later and opened the card a SECOND
       time — over whatever the player had moved on to. */
    clearTimeout(this._revealTimer);
    this._revealTimer = setTimeout(() => this.showReport(), 1500);
  }

  _applyResults() {
    const s = this.save;
    const r = this.report;
    // The open shed keeps no books. Not the fee, not the standing, not
    // the day, not the campaign's place in the queue — a player who
    // wanders in to mess about must not come back and find their run
    // advanced by three days and two commissions.
    if (this.free) {
      if ((this.fireResult?.craze ?? 0) > 0.5) s.crazed++;
      return;
    }
    s.coin += r.pay;
    s.rep += r.rep;
    s.day++;
    if (r.total > s.best) s.best = r.total;
    if ((this.fireResult?.craze ?? 0) > 0.5) s.crazed++;
    if (r.destroyed) s.stats.destroyed++;
    else s.stats.sold++;

    /* Cleared for EVERY result, not only the accepted ones.
       It was reset inside the acceptance branch, so a rejected piece
       left the previous commission's rewards standing — and the results
       card reads this list to draw "New in the shed". Fail a job and it
       congratulated you again on the glaze you were given for the one
       before, on the screen that had just told you the piece was
       refused. */
    this._newUnlocks = [];
    if (r.accepted && !this.commission.procedural) {
      s.commission = Math.max(s.commission, COMMISSIONS.indexOf(this.commission) + 1);
      const un = this.commission.unlocks;
      if (un) {
        if (un.glaze && SaveIO.unlock(s, 'glaze', un.glaze)) this._newUnlocks.push(GLAZE_BY_ID[un.glaze]?.name);
        if (un.body && SaveIO.unlock(s, 'body', un.body)) this._newUnlocks.push(BODIES.find((b) => b.id === un.body)?.name);
        if (un.title && SaveIO.unlock(s, 'title', un.title)) this._newUnlocks.push(un.title);
      }
      if (this.commission.lore && !s.codex.find((c) => c.h === this.commission.lore.h)) {
        s.codex.push(this.commission.lore);
      }
    }

    // codex fragments that unlock from play
    for (const frag of CODEX) {
      if (s.codex.find((c) => c.id === frag.id)) continue;
      try { if (frag.when(s)) s.codex.push({ id: frag.id, h: frag.h, p: frag.p }); } catch (e) { /* ignore */ }
    }

    // shelf
    if (!r.destroyed && r.total >= 30) {
      s.gallery.push({
        name: this.commission.title,
        form: this.commission.require?.form ?? 'jar',
        grade: r.grade.g,
        gradeName: r.grade.name,
        total: r.total,
        title: this.fireResult?.title ?? '',
        day: s.day - 1,
        body: this.body.id,
        // only the layers that actually went on the pot
        glazes: (this.fireResult?.slots ?? []).map((sl) => sl.id),
        clay: this.clay.snapshot(),
        field: this.field.snapshot(),
        fire: {
          peak: this.schedule.peak, reduction: this.schedule.reduction, cooling: this.schedule.cooling,
          soak: this.schedule.soak, holdHrs: this.schedule.holdHrs, holdT: this.schedule.holdT,
        },
      });
    }
    SaveIO.save(s);
    this.hud.setLedger(s);
  }

  _updateReveal(dt) {
    this._kilnHeat = damp(this._kilnHeat ?? 0, 0.12, 1.5, dt);
    this.pot.rotation.y += dt * 0.22;
  }

  showReport() {
    // whoever gets here first cancels the other route
    clearTimeout(this._revealTimer);
    this._revealTimer = null;
    const r = this.report;
    const gr = r.grade;
    const unl = this._newUnlocks ?? [];
    const lore = this.commission.lore;

    this.hud.openOverlay(`
      <div class="ov-kicker">${r.destroyed ? 'Opened the kiln' : `Day ${this.save.day - 1} · ${this.commission.from}`}</div>
      <div class="ov-title">${r.destroyed ? 'It did not survive' : (this.fireResult?.title ?? 'Fired')}</div>
      ${r.destroyed ? `<div class="ov-sub">${r.destroyReason}</div>` : ''}
      <div class="score-grid">
        <div class="score-rows">
          ${r.rows.map((row) => `
            <div class="srow">
              <span class="sk">${row.k}</span>
              <span class="sb"><i data-w="${row.v}"></i></span>
              <span class="sv">${row.v}</span>
            </div>`).join('')}
          <div class="srow total">
            <span class="sk">Assessed at</span>
            <span class="sb"><i data-w="${r.total}"></i></span>
            <span class="sv">${r.total}</span>
          </div>
          <div class="readout" style="margin-top:1.4em">
            ${this.free ? '' : `<span class="k">PAID</span> ${r.pay} ash-marks &nbsp;
            <span class="k">STANDING</span> +${r.rep}<br>`}
            <span class="k">HEIGHT</span> ${fmt(r.metrics.height, 1)} cm &nbsp;
            <span class="k">WALL</span> ${fmt(r.metrics.meanWall, 2)} cm
          </div>
        </div>
        </div>
        <div>
          <div class="grade">${gr.g}<small>${gr.name}</small></div>
          <ul class="notes">
            ${r.notes.slice(0, 7).map((n) => `<li class="${n.good ? 'good' : n.bad ? 'bad' : ''}">${n.t}</li>`).join('')}
          </ul>
        </div>
      </div>
      ${(unl.length || (r.accepted && lore)) ? `<div class="lore-row">
        ${unl.length ? `<div class="lore-card"><div class="lc-h">New in the shed</div><p>${unl.join(' · ')}</p></div>` : ''}
        ${(r.accepted && lore) ? `<div class="lore-card"><div class="lc-h">${lore.h}</div><p>${lore.p}</p></div>` : ''}
      </div>` : ''}
      <div class="ov-actions">
        <button class="btn primary" data-a="next">${this.free ? 'Throw another' : 'Next commission'}</button>
        <button class="btn" data-a="shelf">Put it on the shelf</button>
        <button class="btn ghost" data-a="menu">Menu</button>
      </div>`);

    requestAnimationFrame(() => {
      for (const i of this.hud.ovInner.querySelectorAll('.sb i')) {
        i.style.width = `${i.dataset.w}%`;
      }
    });
    this.audio.chime(r.total >= 55 && !r.destroyed);

    this.hud.bind('[data-a="next"]', () => {
      this.audio.click(); this.hud.closeOverlay();
      if (this.free) this.startFree(); else this.nextCommission();
    });
    this.hud.bind('[data-a="shelf"]', () => this.showGallery(() => this.showReport()));
    this.hud.bind('[data-a="menu"]', () => this.openMenu());
  }

  /* ---------------- gallery / codex ---------------- */

  showGallery(back) {
    const s = this.save;
    const items = [...s.gallery].reverse();
    this.hud.openOverlay(`
      <div class="ov-kicker">${items.length} pieces · best ${s.best}</div>
      <div class="ov-title">The shelf</div>
      <div class="ov-sub">Everything that came out of the kiln in one piece.</div>
      <div class="shelf">
        ${items.map((p, i) => `
          <button class="piece" data-p="${i}" title="Look at this one">
            <canvas data-i="${i}" width="150" height="112"></canvas>
            <div class="pn">${p.title || p.gradeName}</div>
            <div class="pg">${p.grade} · ${p.total} · DAY ${p.day}</div>
          </button>`).join('')}
      </div>
      <div class="ov-actions"><button class="btn primary" data-a="b">Back</button></div>`);
    // draw silhouettes
    for (const cv of this.hud.ovInner.querySelectorAll('.piece canvas')) {
      drawPieceThumb(cv, items[parseInt(cv.dataset.i, 10)]);
    }
    this.hud.bind('[data-a="b"]', () => { this.audio.click(); back(); });
    for (const el of this.hud.ovInner.querySelectorAll('.piece[data-p]')) {
      el.addEventListener('click', () => {
        this.audio.click();
        this.showPiece(items[parseInt(el.dataset.p, 10)], () => this.showGallery(back));
      });
    }
  }

  /**
   * One piece, on the wheel, turnable.
   *
   * The overlay is the soft one — the scrim clears away across the
   * middle — because the whole point is to look at the pot, not at a
   * card with a picture of it. The pot on the wheel IS the picture, and
   * the same drag that turns it while you are glazing turns it here.
   */
  showPiece(p, back) {
    if (!p || !p.clay) { back(); return; }
    /* Everything the viewer is about to overwrite, put somewhere safe.
       dressPot rebuilds the profile buffer and the glaze field in
       place, because those are the only ones there are — and the shelf
       is reachable from the pause menu, so it can be opened in the
       middle of glazing a pot. Without this, looking at an old piece
       silently replaced the wet one on the wheel and the glaze the
       player had spent the whole phase putting on it. The field is
       copied raw rather than through snapshot(), which downsamples
       192x160 to 64x48 and would hand back a blurred version of their
       work. */
    this._stash = this._stashPot();
    this._viewing = p;
    /* The soft overlay deliberately leaves the room visible, which is
       the point — but it leaves the working panels visible too, and a
       shelf of glaze buckets alongside a finished pot is somebody
       else's screen. Hidden by a class rather than by touching the
       panels themselves, so nothing has to be rebuilt to bring them
       back. */
    document.getElementById('hud')?.classList.add('viewing');
    dressPot(this, p);
    this.pot.visible = true;
    this.pot.position.set(0, 0, 0);
    this.pot.rotation.y = 0;
    this.ghost.visible = false;
    this.marker.visible = false;
    this.omegaTarget = 0;
    this._band = 0;

    const h = this.pb.top || 12;
    this.eng.rig.frame(new THREE.Vector3(0, h * 0.5, 0), Math.max(26, h * 3.4), 1.12, 0.9);

    const names = (p.glazes ?? []).map((id) => GLAZE_BY_ID[id]?.name).filter(Boolean);
    const bodyName = BODIES.find((b) => b.id === p.body)?.name ?? '';
    this.hud.openOverlay(`
      <div class="ov-kicker">Day ${p.day} · ${p.grade} · ${p.total}</div>
      <div class="ov-title">${p.title || p.gradeName || 'A pot'}</div>
      <div class="ov-sub">${p.name ?? ''}</div>
      <div class="readout" style="margin:1.2em 0 0">
        <span class="k">BODY</span> ${bodyName}<br>
        ${names.length ? `<span class="k">GLAZE</span> ${names.join(' · ')}<br>` : ''}
        ${p.fire?.peak ? `<span class="k">PEAK</span> ${Math.round(p.fire.peak)}°C` : ''}
      </div>
      <div class="ov-hint">Drag to turn it.</div>
      <div class="ov-actions">
        <button class="btn primary" data-a="card">Make a card</button>
        <button class="btn" data-a="b">Back to the shelf</button>
      </div>`, true);

    this.hud.bind('[data-a="b"]', () => {
      this.audio.click();
      this._viewing = null;
      document.getElementById('hud')?.classList.remove('viewing');
      this._restorePot(this._stash);
      this._stash = null;
      back();
    });
    this.hud.bind('[data-a="card"]', () => { this.audio.click(); this.showCard(p, () => this.showPiece(p, back)); });
  }

  /**
   * The card, and a line of your own on it.
   *
   * The picture is taken from the live canvas rather than re-rendered
   * somewhere else, so what gets shared is the view the player framed —
   * if they turned the pot to its good side, that is the side on the
   * card. toDataURL only sees the drawing buffer while it still holds
   * the frame, so the render and the grab happen in the same task.
   */
  showCard(p, back) {
    const build = () => {
      const cap = document.getElementById('card-caption')?.value ?? '';
      const sig = document.getElementById('card-sign')?.value ?? '';
      this.eng.render(0.016);
      const shot = cropPot(this.eng.renderer.domElement, this._potScreenX());
      return drawCard(shot, p, cap, sig);
    };

    this.hud.openOverlay(`
      <div class="ov-kicker">Sign it</div>
      <div class="ov-title">A card for it</div>
      <div class="card-wrap">
        <div class="card-preview"><img id="card-img" alt="the card"></div>
        <div class="card-fields">
          <label class="fl">Say something about it
            <textarea id="card-caption" rows="3" maxlength="140"
              placeholder="Third one this week. The first two are in the bin."></textarea></label>
          <label class="fl">Signed
            <input id="card-sign" maxlength="28" placeholder="your name" value="${(this.save.potter ?? '').replace(/"/g, '&quot;')}"></label>
          <div class="ov-actions" style="margin-top:1.4em">
            <button class="btn primary" data-a="send">Save or share</button>
            <button class="btn" data-a="b">Back</button>
          </div>
        </div>
      </div>`, true);

    const img = document.getElementById('card-img');
    const refresh = () => { img.src = build().toDataURL('image/png'); };
    refresh();
    for (const id of ['card-caption', 'card-sign']) {
      document.getElementById(id)?.addEventListener('input', () => {
        clearTimeout(this._cardT);
        this._cardT = setTimeout(refresh, 220);
      });
    }

    this.hud.bind('[data-a="send"]', async () => {
      this.audio.click();
      const sig = document.getElementById('card-sign')?.value ?? '';
      if (sig.trim()) { this.save.potter = sig.trim(); SaveIO.save(this.save); }
      const name = (p.title || 'celadon').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      const how = await handOver(build(), name || 'celadon', `${p.title || 'A pot'} — made in CELADON`);
      if (how === 'downloaded') this.hud.toast('Saved to your downloads.', 'good');
      else if (how === 'shared') this.hud.toast('Sent.', 'good');
      else if (how === 'failed') this.hud.toast('Could not make the picture.', 'hot');
    });
    this.hud.bind('[data-a="b"]', () => { this.audio.click(); back(); });
  }

  /** Copy the live pot aside before the viewer dresses it in an old one. */
  _stashPot() {
    const u = this.mat.userData.u;
    const rig = this.eng.rig;
    return {
      field: this.field.data.slice(),
      fired: u.uFired.value, wet: u.uWet.value,
      bisque: u.uBisque.value, vitrified: u.uVitrified.value,
      bodyCol: u.uBodyCol.value.clone(), bodyCol2: u.uBodyCol2.value.clone(),
      visible: this.pot.visible, rotY: this.pot.rotation.y,
      cam: { r: rig.goalRadius, phi: rig.goalPhi, theta: rig.goalTheta, target: rig.goalTarget.clone() },
    };
  }

  /** And put it back, exactly as it was. */
  _restorePot(st) {
    if (!st) return;
    this.field.data.set(st.field);
    this.field._push?.();
    if (this.clay) this.pb.build(this.clay);
    const u = this.mat.userData.u;
    u.uFired.value = st.fired; u.uWet.value = st.wet;
    u.uBisque.value = st.bisque; u.uVitrified.value = st.vitrified;
    u.uBodyCol.value.copy(st.bodyCol); u.uBodyCol2.value.copy(st.bodyCol2);
    // the surface comes from the fire result the live state is holding,
    // not from the one the shelf piece was dressed with
    applyFireResult(this.mat, this.fireResult ?? null, this.slots ?? [null, null, null]);
    this.pot.visible = st.visible;
    this.pot.rotation.y = st.rotY;
    this.eng.rig.frame(st.cam.target, st.cam.r, st.cam.phi, st.cam.theta);
  }

  /** Where the pot is on screen, so the card crops around it. */
  _potScreenX() {
    const v = new THREE.Vector3(0, (this.pb.top || 12) * 0.5, 0).project(this.eng.camera);
    return (v.x * 0.5 + 0.5) * this.eng.renderer.domElement.width;
  }

  showCodex(back) {
    const s = this.save;
    this.hud.openOverlay(`
      <div class="ov-kicker">${s.codex.length} fragments</div>
      <div class="ov-title">The codex</div>
      <div class="ov-sub">What the Guild writes down, and what it does not.</div>
      ${s.codex.length ? s.codex.map((c) => `
        <div class="lore-card"><div class="lc-h">${c.h}</div><p>${c.p}</p></div>`).join('')
        : '<div class="ov-body"><p>Nothing yet. Fire something.</p></div>'}
      <div class="ov-actions"><button class="btn primary" data-a="b">Back</button></div>`);
    this.hud.bind('[data-a="b"]', () => { this.audio.click(); back(); });
  }

  /* ---------------- stage advance ---------------- */

  advance() {
    if (this.hud.overlayOpen) return;
    switch (this.state) {
      case ST.THROW:
        if (this.clay.dead) return;
        if (!this.clay.metrics().opened) {
          this.hud.toast('There is no pot yet. Centre it and open the floor first.', 'bad');
          return;
        }
        this.audio.click();
        this.startTrim();
        break;
      case ST.TRIM:
        this.audio.click();
        this.startGlaze();
        break;
      case ST.GLAZE: {
        const gs = this._glazeStats ?? this.field.stats();
        if (gs.totalCoverage < 0.04) {
          this.hud.toast('Nothing on it at all. Fire it bare, or put something on.', '', 3000);
        }
        if (gs.footClean < 0.4) {
          this.hud.toast('The foot is still covered — it will weld to the shelf. Wipe it.', 'bad', 4200);
          return;
        }
        this.audio.click();
        this.startKiln();
        break;
      }
      case ST.KILN:
        this.lightKiln();
        break;
      case ST.REVEAL:
        this.showReport();
        break;
      default: break;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  How much clay the brief actually needs                             */
/* ------------------------------------------------------------------ */

export function suggestedMass(req = {}) {
  const { H, D, wall: w } = targetSize(req);

  const rc = Math.max(0.6, D * 0.5 - w * 0.5);
  const wallV = TAU * rc * w * H * 0.86;      // 0.86: the wall is not a cylinder
  const floorV = Math.PI * (D * 0.5) ** 2 * 0.8;
  const waste = 1.10;                          // trimmings and what stays on the hands
  /* The bounds and the rounding here are the SLIDER's bounds and the
     slider's step, and they were not. This clamps at 250 and rounds to
     25 while the control was min=600 step=50, so three briefs asked for
     a ball the player could not dial: the very first commission wants
     500 g, the bowl at #5 wants 475 and the cup at #21 wants 400. The
     game set this.mass to the suggestion and the slider showed 600,
     and there was no way back to the number the brief was weighed
     against — on a short brief that is not a handicap, it is
     unsatisfiable, because a wall only gets thin by getting tall. */
  return clamp(Math.round((wallV + floorV) * 1.92 * waste / 25) * 25, 250, 3200);
}

/* ------------------------------------------------------------------ */
/*  Gallery thumbnails — a flat silhouette drawn from the snapshot     */
/* ------------------------------------------------------------------ */

function drawPieceThumb(cv, p) {
  if (!p || !p.clay) return;
  const g = cv.getContext('2d');
  const W = cv.width, H = cv.height;
  g.clearRect(0, 0, W, H);
  const ro = p.clay.ro, dy = p.clay.dy;
  const n = ro.length;
  const ys = new Float32Array(n + 1);
  for (let i = 0; i < n; i++) ys[i + 1] = ys[i] + dy[i];
  const hh = ys[n] || 1;
  let rmax = 0.001;
  for (let i = 0; i < n; i++) rmax = Math.max(rmax, ro[i]);
  const pad = 10;
  const sc = Math.min((H - pad * 2) / hh, (W - pad * 2) / (rmax * 2));
  const cx = W / 2, base = H - pad;

  const glaze = p.glazes?.find(Boolean);
  const col = {
    ash: '#9aa07a', celadon: '#7fbfa4', tenmoku: '#3a241a', shino: '#e5d3b6',
    oxblood: '#8e2418', chun: '#8fb4d6', crystal: '#b8c8d8', nuka: '#e8e6dc',
    kaki: '#b8552a', cobalt: '#33529e', salt: '#c9b48e', raku: '#7a6a86',
  }[glaze] ?? '#9a7458';

  g.beginPath();
  g.moveTo(cx, base);
  for (let i = 0; i < n; i++) g.lineTo(cx + ro[i] * sc, base - ys[i] * sc);
  for (let i = n - 1; i >= 0; i--) g.lineTo(cx - ro[i] * sc, base - ys[i] * sc);
  g.closePath();

  const grd = g.createLinearGradient(cx - rmax * sc, 0, cx + rmax * sc, 0);
  grd.addColorStop(0, shade(col, -0.45));
  grd.addColorStop(0.34, col);
  grd.addColorStop(0.52, shade(col, 0.28));
  grd.addColorStop(1, shade(col, -0.55));
  g.fillStyle = grd;
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.14)';
  g.lineWidth = 1;
  g.stroke();
}

function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  const f = (v) => Math.max(0, Math.min(255, Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt))));
  return `rgb(${f((n >> 16) & 255)},${f((n >> 8) & 255)},${f(n & 255)})`;
}
