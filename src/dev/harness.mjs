// ============================================================
//  Shared bench harness.
//
//  Drives the real Hand — the same object Game._updateThrow uses —
//  so a bench can never pass while the game misbehaves.
// ============================================================

import { Clay, NS } from '../sim/clay.js';
import { Hand, radiiAt } from '../sim/hand.js';

export const DT = 1 / 60;
export { radiiAt, NS, Clay };

/**
 * Move the hand from (r0,y0) to (r1,y1) over `secs`, pressing the whole
 * way. `jitter` shakes it sideways, because nobody's hand is steady.
 */
export function drag(c, r0, y0, r1, y1, secs, opts = {}) {
  const omega = opts.omega ?? 8.4;
  const jitter = opts.jitter ?? 0;
  const frames = Math.max(2, Math.round(secs / DT));
  const hand = opts.hand ?? new Hand();
  if (!opts.hand) hand.grab();

  let pr = r0, py = y0;
  let press = opts.press ?? 0;
  let last = null;

  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1);
    const r = r0 + (r1 - r0) * t + (jitter ? Math.sin(t * 11.3) * jitter : 0);
    const y = y0 + (y1 - y0) * t;
    press += (1 - press) * (1 - Math.exp(-12 * DT));

    const { ro } = radiiAt(c, y);
    const contact = Hand.contact(c, r, y, ro);
    last = hand.apply(c, { r, y, pr, py, press, contact, omega }, DT);

    c.step(DT, omega, { dryRate: opts.dryRate ?? 0.34, forgiving: opts.forgiving !== false });
    pr = r; py = y;
    if (c.dead) break;
  }
  return last;
}

/** Hold the hand still at one place. */
export function hold(c, r, y, secs, opts = {}) {
  return drag(c, r, y, r, y, secs, opts);
}

/** Let the wheel turn with nobody touching it. */
export function spin(c, secs, omega = 8.4) {
  for (let f = 0; f < Math.round(secs / DT); f++) {
    c.step(DT, omega, { dryRate: 0.34, forgiving: true });
  }
}

/** Interior capacity in millilitres — what "bigger" actually means. */
export function capacity(c) {
  let v = 0;
  for (let i = 0; i < NS; i++) v += Math.PI * c.ri[i] * c.ri[i] * c.dy[i];
  return v;
}

/** Centre a fresh lump and open it properly, the way the coach says. */
export function openedPot(opts = {}) {
  const c = new Clay({ mass: opts.mass ?? 500, seed: opts.seed ?? 3, wobble: opts.wobble ?? 0.5 });
  for (let i = 0; i < 5; i++) {
    drag(c, c.maxR * 1.0, 0.9, c.maxR * 0.78, c.height * 0.8, 0.5, opts);
    drag(c, c.maxR * 0.78, c.height * 0.8, c.maxR * 1.0, 0.9, 0.5, opts);
  }
  drag(c, 0.5, c.height * 0.85, 0.7, 1.1, 0.5, opts);
  // open it out until the bore is most of the pot, not just enough to
  // clear the "is this hollow yet" threshold
  let guard = 0;
  while (guard++ < 20) {
    const { ro, ri } = radiiAt(c, 1.4);
    if (c.isOpen() && ri > ro * 0.62) break;
    drag(c, 0.7, 1.3, Math.max(1.2, ro * 0.80), 1.4, 0.6, opts);
  }
  return c;
}

export const fmt = (c) => {
  const m = c.metrics();
  return `H=${m.height.toFixed(1).padStart(5)}cm D=${m.diameter.toFixed(1).padStart(5)}cm ` +
    `wall=${m.meanWall.toFixed(2)} true=${m.trueness.toFixed(2)} ` +
    `wet=${(m.moisture * 100).toFixed(0)} open=${m.opened ? 'y' : 'n'}` +
    (c.dead ? `  DEAD: ${c.deadReason}` : '');
};
