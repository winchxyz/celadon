// ============================================================
//  CELADON — the hand
//
//  One pair of hands. You put it on the pot and move it, and what
//  happens follows from which way you moved.
//
//  This lives on its own, apart from the game loop, for one reason:
//  the headless benches drive THIS, so what is tested is what runs.
//  When the rules lived inside Game._updateThrow the benches had to
//  re-implement them, the two drifted, and the bugs that shipped were
//  precisely the ones that lived in the gap.
// ============================================================

import { clamp, clamp01, damp } from '../core/util.js';
import { NS, DRAG_REF } from './clay.js';

/** centimetres of drag that count as one second of hand-work */
export { DRAG_REF };
/** how far from the wall you can still get a hand on the pot */
export const GRAB = 5.0;

export class Hand {
  constructor() {
    this.velR = 0;
    this.velY = 0;
    this.pressing = false;
    this.held = null;      // the intent this press committed to
    this.carry = null;     // where this press has carried the wall to
    this.accR = 0;         // how much of this press has been sideways
    this.accY = 0;         // ...and how much of it up or down
  }

  /** Called when the button goes down, so a press starts from rest. */
  grab() {
    this.velR = 0;
    this.velY = 0;
    this.pressing = true;
    this.held = null;
    this.carry = null;
    this.accR = 0;
    this.accY = 0;
  }

  release() { this.pressing = false; this.held = null; this.carry = null; }

  /**
   * How firmly the hand is on the clay at (r, y): 1 anywhere over the
   * pot, falling off to nothing a hand's width clear of it.
   */
  static contact(c, r, y, ro) {
    const heightOK = smooth(-1.2, -0.2, y) * smooth(c.height + 3.0, c.height + 0.6, y);
    return clamp01(smooth(ro + GRAB, ro + GRAB * 0.35, r) * heightOK);
  }

  /**
   * What a press would do right now.
   *   centre  the lump is solid and the hand is out on the wall
   *   open    the lump is not hollow yet and the hand is near the axis
   *   shape   there is a pot; lift / widen / narrow follow the drag
   */
  static intent(c, r, y, ro, ri) {
    if (!c.isOpen()) {
      // Until there is a real interior there is nothing to lift, so
      // neither of these can stretch the lump into a tower.
      //
      // You open a pot by pressing DOWN INTO THE MIDDLE of the top —
      // not by touching it anywhere that happens to be inboard of the
      // rim. With the old test at eighty percent of the radius, running
      // a hand up and down the side to centre the lump was quietly
      // boring a hole in it instead; once that hole was deep enough to
      // count the piece was "open", every drag became a lift, and the
      // thing grew into a bent tower under a player who was only trying
      // to centre it.
      // There is no reason to have a hand near the axis except to open
      // the pot, and no reason to have one out on the wall except to
      // centre it. Height does not come into it: pressing down and then
      // pushing out along the floor is all one motion.
      return r < Math.max(1.3, ro * 0.42) ? 'open' : 'centre';
    }
    const f = Math.min(NS - 1, c.floorSection());
    if (y < c.y[f] + 0.4 && r < ri + 0.9) return 'open';
    return 'shape';
  }

  /**
   * Apply one frame of hand.
   *
   * @param {Clay}   c
   * @param {object} t   { r, y, pr, py, press, contact, omega }
   * @param {number} dt
   * @returns {{verb:string, power:number, intent:string, lifted:number}}
   */
  apply(c, t, dt) {
    const { ro, ri } = radiiAt(c, t.y);
    const mid = (ro + ri) * 0.5;
    const p = t.press * t.contact;

    // Smoothed, not raw. A hand that is not perfectly steady reverses
    // direction every few frames, and on a raw per-frame delta half the
    // work widens while the other half collars, so small corrections
    // cancel out and the pot refuses to move.
    const invDt = 1 / Math.max(dt, 1e-4);
    // The game hands over what the stroke MEANT, measured on the screen
    // where the player made it. Falling back to the change in (r, y) is
    // for benches that drive the clay directly and have no camera.
    const rawR = t.dR !== undefined ? t.dR : (t.r - t.pr);
    const rawY = t.dY !== undefined ? t.dY : (t.y - t.py);
    this.velR = damp(this.velR, rawR * invDt, 13, dt);
    this.velY = damp(this.velY, rawY * invDt, 13, dt);
    const dR = this.velR * dt;
    const dY = this.velY * dt;

    const live = Hand.intent(c, t.r, t.y, ro, ri);
    if (p <= 0.02 || c.dead) return { verb: '', power: 0, intent: live, lifted: 0 };

    // A press commits to one thing. Opening a pot means pressing down
    // the middle and then pushing outward along the floor; if the intent
    // is re-read every frame that second half turns into coning, and the
    // piece grows upward instead of hollowing out.
    if (this.held === null) this.held = live;
    const intent = this.held === 'shape' && live !== 'shape' ? live : this.held;

    const spin = clamp01(t.omega / 6);
    const dwell = dt * 0.30;              // a resting hand still does something

    if (intent === 'centre') {
      // Coning is work: only movement narrows the lump. A hand that is
      // simply resting steadies it instead.
      const move = Math.hypot(dR, dY) / DRAG_REF;
      c.trueUp(t.y, p, dt, t.omega);
      if (move > 1e-5) c.center(clamp(t.r, 0.8, ro + 1.5), t.y, p, move, t.omega);
      return { verb: 'CENTRE', power: (move * invDt) * 0.5, intent, lifted: 0 };
    }

    if (intent === 'open') {
      const work = dwell * 0.5 + (Math.max(0, -dY) + Math.max(0, dR)) / DRAG_REF;
      c.open(clamp(t.r, 0, Math.max(0.4, ro - 0.45)), Math.max(0.45, t.y), p, work, t.omega);
      return { verb: 'OPEN', power: (work * invDt) * 0.5, intent, lifted: 0 };
    }

    // Four directions, and each one has an opposite. Up draws the wall
    // out thinner and the pot grows; down gathers it and the pot comes
    // back. Outward bellies it wider and therefore shorter; inward
    // collars it narrower and therefore taller. Every stroke a player
    // can make has an undo that is itself a stroke.
    // A stroke does the thing it is mostly doing.
    //
    // Lifting is a far stronger lever than bellying out, so a widening
    // drag that wandered a few degrees off horizontal — and with a
    // mouse in a hand, every one of them does — would gain more height
    // from the stray part than it lost from the part that was working.
    // That is the whole of "no matter how I open it out, at some point
    // it just starts growing upward again". Judged over the press
    // rather than the frame, so a shaky hand still reads as one
    // intention rather than flickering between two.
    this.accR += Math.abs(dR);
    this.accY += Math.abs(dY);
    const share = (this.accR + 0.15) / (this.accR + this.accY + 0.30);
    const sideGain = smooth(0.30, 0.64, share);
    const vertGain = smooth(0.30, 0.64, 1 - share);

    const wUp = vertGain * Math.max(0, dY) / DRAG_REF;
    const wDown = vertGain * Math.max(0, -dY) / DRAG_REF;
    const wOut = sideGain * Math.max(0, dR) / DRAG_REF;
    const wIn = sideGain * Math.max(0, -dR) / DRAG_REF;

    // No dwell term on the lift. Resting a hand on the pot used to raise
    // it for as long as you held the button, which is why every touch
    // grew the piece upward whatever the player was trying to do.
    if (wUp > 1e-5) {
      const pullR = clamp(t.r, mid - 1.3, mid + 1.3);
      c.pull(pullR, t.y, p, wUp, t.omega, 1);
    }
    if (wDown > 1e-5) {
      const pressR = clamp(t.r, mid - 1.3, mid + 1.3);
      c.compress(pressR, t.y, p, wDown, t.omega);
    }

    // You take hold of the wall and CARRY it. The press remembers how
    // the hand was resting against the clay when it closed, and asks
    // the wall to keep that relationship as the hand travels.
    //
    // Chasing the hand's bare position instead made where you grabbed
    // matter more than how far you dragged: a hand that closed out in
    // mid air held a full lead from the first frame and moved far more
    // clay, while one that closed on the outside face and pulled inward
    // spent most of the stroke asking the wall to stay exactly where it
    // already was, and did nothing at all.
    if (this.carry === null) this.carry = mid;
    const shapeR = this.carry = clamp(this.carry + dR * sideGain, mid - 1.6, mid + 1.6);
    if (wOut > 1e-5) c.shape(shapeR, t.y, p, wOut, t.omega, true);
    if (wIn > 1e-5) c.shape(shapeR, t.y, p, wIn, t.omega, false);

    // However the hand moved, the clay under it relaxes for as long as
    // it is there. This is what keeps a stroke from cutting a step into
    // one ring, and what lets a player work a bad shape back out.
    c.settle(t.y, p, dt);

    // A hand held still against a turning pot takes the wobble out of
    // it, and is the only way back from one that has run out of true.
    if (wUp + wDown + wOut + wIn < 2e-4) {
      c.rib(t.r, t.y, p, dt, t.omega);
      return { verb: 'STEADY', power: p * 0.35, intent, lifted: 0 };
    }

    const vert = Math.max(wUp, wDown);
    const side = Math.max(wOut, wIn);
    const best = Math.max(vert, side);
    const verb = vert >= side
      ? (wUp >= wDown ? 'LIFT' : 'PRESS')
      : (wOut >= wIn ? 'WIDEN' : 'NARROW');
    return { verb, power: (best * invDt) * 0.9 * spin, intent, lifted: wUp };
  }
}

/* ------------------------------------------------------------------ */

function smooth(e0, e1, x) {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
}

/** Wall radii at a height, straight off the section arrays. */
export function radiiAt(c, y) {
  const i = c.sectionAt(clamp(y, 0, Math.max(0.01, c.height - 1e-4)));
  return { ro: c.ro[i], ri: c.ri[i] };
}
