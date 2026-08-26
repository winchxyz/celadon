// ============================================================
//  The REAL Game, with only WebGL stubbed out.
//
//  Shared by every bench that needs the whole thing — the Game, the
//  Hand, the Clay, the coach, the screen-to-clay mapping. Kept in one
//  place on purpose: a bench that re-implements what the game does can
//  pass while the game itself is broken, and one once did.
// ============================================================

import * as THREE from 'three';
import { radiiAt } from '../sim/hand.js';
import { CAMERA } from '../core/engine.js';

/* ---- the little bit of browser the Game touches ------------------- */
const listeners = new Map();
globalThis.window = {
  innerWidth: 1280, innerHeight: 720,
  addEventListener: (k, f) => listeners.set(k, f),
  removeEventListener: () => {},
};
globalThis.document = {
  querySelector: () => null,
  getElementById: () => null,
  createElement: () => ({ getContext: () => null, style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
};
globalThis.localStorage = {
  _d: {},
  getItem(k) { return this._d[k] ?? null; },
  setItem(k, v) { this._d[k] = String(v); },
  removeItem(k) { delete this._d[k]; },
};
globalThis.performance = globalThis.performance ?? { now: () => Date.now() };

const { Game } = await import('../game/game.js');
const { NS } = await import('../sim/clay.js');

/* ---- stubs ------------------------------------------------------- */
const hudLog = { coach: null, hand: null, toasts: [], stage: null, gauges: {} };
const hud = {
  tool: 'hands', overlayOpen: false, ovInner: { querySelector: () => null },
  overlay: { classList: { add() {}, remove() {}, toggle() {} } },
  show() {}, showGauges() {}, showFormView() {}, hideContext() {},
  setStage(a, b) { hudLog.stage = b; }, setLedger() {}, setKeyHints() {}, setAdvance() {},
  setCommission() {}, setGauge(n, v, t) { hudLog.gauges[n] = t; }, setVitals() {},
  setToolset(n, sel) { this.tool = sel ?? this.tool; }, selectTool(id) { this.tool = id; },
  toolKeys: () => ({}), setHand(x, y, verb, power, on) { hudLog.hand = on ? { verb, power } : null; },
  setCoach(step, text) { hudLog.coach = text; }, drawSilhouette() {},
  toast(t) { hudLog.toasts.push(String(t).replace(/<[^>]+>/g, '')); },
  openOverlay() {}, closeOverlay() {}, bind() {}, bindAll() {},
  glazePanel() {}, kilnPanel() {}, updateKilnPanel() {}, updateGlazeSelection() {},
  setToolTip() {}, _measure() {},
};

/* Anything else the interface grows.
   This stub has to answer every call the game makes, and it kept not
   doing so: one new line in startGlaze took out three unrelated benches
   at once, none of which was testing the interface at all. A missing
   method now answers with a no-op rather than a TypeError, so a bench
   fails only for the reason it was written to fail for. Properties are
   left alone, so anything a bench actually reads still has to be real. */
const hudStub = new Proxy(hud, {
  get(t, k) {
    if (k in t) return t[k];
    if (typeof k === 'symbol') return undefined;
    // only invent functions; an unknown property stays undefined so that
    // reading one is still an honest mistake
    return /^(set|show|hide|update|draw|open|close|bind|clear|toggle|select|add|remove)/.test(String(k))
      ? () => {}
      : undefined;
  },
});

// Built from the game's own numbers, never a second copy of them.
const camera = new THREE.PerspectiveCamera(
  CAMERA.fov, 1280 / 720, CAMERA.near, CAMERA.far);
const rig = {
  target: new THREE.Vector3(0, 8, 0), goalTarget: new THREE.Vector3(0, 8, 0),
  radius: 46, goalRadius: 46, phi: 1.25, goalPhi: 1.25, theta: -0.4, goalTheta: -0.4,
  minPhi: CAMERA.minPhi, maxPhi: CAMERA.maxPhi,
  autoSpin: 0, cam: camera,
  frame(t, r, p, th) { this.goalTarget.copy(t); this.goalRadius = r; if (p != null) this.goalPhi = p; if (th != null) this.goalTheta = th; },
  // The real rig's two mouse verbs, with the real scale factors from
  // core/engine.js, so a bench that drags the right button moves the
  // camera by the same amount the game does.
  orbit(dx, dy) {
    this.goalTheta -= dx * 0.0055;
    this.goalPhi = Math.min(1.78, Math.max(0.70, this.goalPhi - dy * 0.0045));
  },
  zoom(dz) {
    this.goalRadius = Math.min(150, Math.max(16, this.goalRadius * (1 + dz * 0.0014)));
  },
  kick() {},
  update() {
    this.target.copy(this.goalTarget); this.radius = this.goalRadius;
    this.phi = this.goalPhi; this.theta = this.goalTheta;
    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    camera.position.set(
      this.target.x + this.radius * sp * Math.sin(this.theta),
      this.target.y + this.radius * cp,
      this.target.z + this.radius * sp * Math.cos(this.theta));
    camera.lookAt(this.target);
    camera.updateMatrixWorld(true);
    camera.updateProjectionMatrix();
  },
};
const eng = {
  camera, rig, scene: { add() {}, remove() {} },
  // A canvas that actually remembers its listeners, so a bench can drive
  // the game's own pointer and wheel handlers rather than reaching past
  // them and calling internals. Throwing the listeners away meant the
  // whole input layer — where the mouse becomes a place on the pot —
  // was the one part of the game no test could touch.
  canvas: {
    _on: new Map(),
    addEventListener(type, fn) {
      if (!this._on.has(type)) this._on.set(type, []);
      this._on.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const l = this._on.get(type);
      if (l) this._on.set(type, l.filter((f) => f !== fn));
    },
    dispatchEvent(e) {
      for (const fn of this._on.get(e.type) ?? []) fn(e);
      return true;
    },
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    setPointerCapture() {},
  },
  grade: { uniforms: { uHaze: { value: 0 } } },
  bloom: { strength: 0.5 }, renderer: { toneMappingExposure: 1 },
};
const studio = { spray: { emit() {} }, update() {}, adapt: () => 1, kilnShelfY: -22 };
const audio = { resume() {}, click() {}, splash() {}, thud() {}, shatter() {}, chime() {}, ring() {}, setMuted() {}, update() {}, init() {} };

/* ---- drive it ----------------------------------------------------- */
const game = new Game(eng, studio, hudStub, audio);
const { COMMISSIONS } = await import('../game/lore.js');
game.commission = COMMISSIONS[0];
game.startThrow();
rig.update(0.016);

const DT = 1 / 60;

/** Point the mouse at a place on the screen, in pixels. */
function point(px, py) {
  game.pointer.nx = (px / 1280) * 2 - 1;
  game.pointer.ny = -((py / 720) * 2 - 1);
}
function step(n = 1) {
  for (let i = 0; i < n; i++) { game.update(DT); rig.update(DT); }
}
/** Drag the mouse across the screen over `secs`, button down. */
function mouseDrag(x0, y0, x1, y1, secs) {
  const n = Math.max(2, Math.round(secs / DT));
  game.pointer.down = true;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    point(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t);
    step(1);
  }
  game.pointer.down = false;
  step(4);
}

// Where does the mouse have to be for the game to read a given point on
// the pot? Solved against the game's own mapping rather than derived,
// because a ray through a point at radius r passes CLOSER to the axis
// than r, so projecting the point and reading it back does not round
// trip. This is what the marker on screen is for: the player moves the
// mouse until the hand is where they want it, and so does this.
function aim(rcm, ycm) {
  // _updateToolPoint rolls pr/py forward on every call, so probing with
  // it would poison the frame-to-frame delta the hand reads its velocity
  // from. Snapshot and put it back.
  const save = { r: game.tool.r, y: game.tool.y, pr: game.tool.pr, py: game.tool.py,
    nx: game.pointer.nx, ny: game.pointer.ny,
    pnx: game.pointer.pnx, pny: game.pointer.pny,
    dR: game.tool.dR, dY: game.tool.dY };
  let sx = 900, sy = 360;
  for (let pass = 0; pass < 3; pass++) {
    let lo = 0, hi = 719;
    for (let i = 0; i < 26; i++) {
      const mid = (lo + hi) / 2;
      point(sx, mid); game._updateToolPoint();
      if (game.tool.y > ycm) lo = mid; else hi = mid;
    }
    sy = (lo + hi) / 2;
    let l = 641, h = 1279;
    for (let i = 0; i < 26; i++) {
      const mid = (l + h) / 2;
      point(mid, sy); game._updateToolPoint();
      if (game.tool.r < rcm) l = mid; else h = mid;
    }
    sx = (l + h) / 2;
  }
  game.tool.r = save.r; game.tool.y = save.y;
  game.tool.pr = save.pr; game.tool.py = save.py;
  game.tool.dR = save.dR; game.tool.dY = save.dY;
  game.pointer.nx = save.nx; game.pointer.ny = save.ny;
  game.pointer.pnx = save.pnx; game.pointer.pny = save.pny;
  return [sx, sy];
}

/** Drag between two points on the pot, given in centimetres. */
function dragCm(r0, y0, r1, y1, secs) {
  const n = Math.max(2, Math.round(secs / DT));
  game.pointer.down = true;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const [x, y] = aim(r0 + (r1 - r0) * t, y0 + (y1 - y0) * t);
    point(x, y);
    step(1);
  }
  game.pointer.down = false;
  step(4);
}

function holdCm(rcm, ycm, secs) {
  game.pointer.down = true;
  const n = Math.max(1, Math.round(secs / DT));
  for (let i = 0; i < n; i++) { const [x, y] = aim(rcm, ycm); point(x, y); step(1); }
  game.pointer.down = false; step(4);
}


/**
 * Drag in SCREEN PIXELS — what a hand on a mouse actually does.
 *
 * `aim` solves for a point in centimetres of clay, which is useful for
 * setting up a known situation but is not a thing a player can do, and
 * its bisection assumes a camera looking at the pot from the side. Tilt
 * down the throat of a tall pot and it walks off the edge of the
 * screen. A drag measured in pixels works from any angle, because it is
 * the same information the player has.
 */
export function dragPx(x0, y0, dx, dy, secs) {
  const n = Math.max(2, Math.round(secs / DT));
  point(x0, y0); step(1);                 // settle with the button up
  game.pointer.down = true;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    point(x0 + dx * t, y0 + dy * t);
    step(1);
  }
  game.pointer.down = false; step(4);
}

/**
 * The pixel a point on the pot is DRAWN at, on the meridian facing the
 * camera. Exact at any camera angle, because it is the same projection
 * the game inverts to find the hand — where `aim` has to hunt for the
 * answer by bisection and walks off the screen when the view is steep.
 */
export function screenOf(r, y) {
  const cam = eng.camera;
  // A quarter turn from the camera's own bearing: the SILHOUETTE, where
  // the wall is drawn against the background and radius reads across
  // the screen. The meridian facing the camera projects onto the middle
  // column, and "outward" there points at the viewer — which is where a
  // player would never put their hand to open a pot out.
  let a = Math.atan2(cam.position.z - game.pot.position.z,
                     cam.position.x - game.pot.position.x) / (Math.PI * 2) + 0.25;
  a -= Math.floor(a);
  const b = game._basisAt(r, y, a);
  return [(b.sx * 0.5 + 0.5) * window.innerWidth,
          (-b.sy * 0.5 + 0.5) * window.innerHeight];
}

/** Unit screen direction of "outward along the wall", in pixels. */
export function outwardPx() {
  const b = game.tool.basis;
  if (!b) return [1, 0];
  const px = b.oX * 0.5 * window.innerWidth;
  const py = -b.oY * 0.5 * window.innerHeight;
  const l = Math.hypot(px, py) || 1;
  return [px / l, py / l];
}

export const M = () => game.clay.metrics();
export {
  THREE, radiiAt, NS, Game,
  game, eng, rig, camera, hud, hudLog, studio, audio,
  DT, point, step, mouseDrag, aim, dragCm, holdCm, CAMERA,
};
