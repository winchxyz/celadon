// ============================================================
//  CELADON — persistence
// ============================================================

import { COMMISSIONS } from './lore.js';

const KEY = 'celadon.save.v1';
const MAX_GALLERY = 24;

/**
 * The order the campaign used to be in.
 *
 * A save records how far through the campaign it has got, and it records
 * that as a POSITION in the list. That was fine while the list never
 * changed. The list has since grown from twelve to twenty-four, mostly
 * in the middle, and a position means something different than it did —
 * a player who had finished five commissions would be handed whichever
 * job now happens to sit sixth, which is not the one they were about to
 * do; a player who had finished the whole campaign would be thrown back
 * into the middle of it.
 *
 * So this is what the positions used to mean. An old save is read
 * through it: the position becomes the commission it actually referred
 * to, and that commission is found again wherever it lives now.
 * Anything inserted before that point is not retro-fitted into a game
 * already past it; a new game gets the whole campaign.
 *
 * Both v1 and v2 stored positions against these same twelve — v2 changed
 * nothing about the campaign, only the save shape — so one list serves
 * both. The next version to move a commission will need its own.
 */
const LEGACY_ORDER = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8', 'c9', 'c10', 'c11', 'c12'];
const CURRENT_V = 3;

export function blankSave() {
  return {
    v: CURRENT_V,
    day: 1,
    // Enough to light a firing that actually matures the glazes you
    // are given (about 46) and still have a second attempt in hand.
    // At 55 the first proper firing was simply unaffordable.
    coin: 120,
    rep: 0,
    commission: 0,          // index into the campaign
    proceduralN: 0,
    glazes: ['ash', 'celadon'],
    bodies: ['ashstone'],
    titles: [],
    codex: [],
    gallery: [],
    best: 0,
    firings: 0,
    crazed: 0,
    stats: { thrown: 0, collapses: 0, centred: 0, drowned: 0, destroyed: 0, sold: 0 },
    // firing: 'guild' — the kiln master sets the schedule and the pot
    // comes out fired. 'hand' — six controls and every way to lose it.
    settings: { quality: 'high', music: true, sound: true, hints: true, assist: true, firing: 'guild' },
  };
}

/**
 * Read an old position as the commission it meant, and find that
 * commission where it lives now. Mutates in place and stamps the
 * current version.
 */
function migrateLegacy(s) {
  const done = Number(s.commission) || 0;
  if (done > 0) {
    const lastId = LEGACY_ORDER[Math.min(done, LEGACY_ORDER.length) - 1];
    const at = COMMISSIONS.findIndex((c) => c.id === lastId);
    // If that commission has been taken out of the campaign entirely,
    // leave the count alone rather than sending anyone back to day one.
    if (at >= 0) s.commission = at + 1;
  }
  s.v = CURRENT_V;
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blankSave();
    const s = JSON.parse(raw);
    if (!s || !(s.v >= 1 && s.v <= CURRENT_V)) return blankSave();
    if (s.v < CURRENT_V) migrateLegacy(s);
    const b = blankSave();
    return { ...b, ...s, stats: { ...b.stats, ...(s.stats || {}) }, settings: { ...b.settings, ...(s.settings || {}) } };
  } catch (e) {
    console.warn('celadon: save unreadable, starting fresh', e);
    return blankSave();
  }
}

export function save(s) {
  try {
    if (s.gallery.length > MAX_GALLERY) s.gallery = s.gallery.slice(-MAX_GALLERY);
    localStorage.setItem(KEY, JSON.stringify(s));
    return true;
  } catch (e) {
    // quota: drop the oldest pieces and try once more
    try {
      s.gallery = s.gallery.slice(-8);
      localStorage.setItem(KEY, JSON.stringify(s));
      return true;
    } catch (e2) {
      console.warn('celadon: could not save', e2);
      return false;
    }
  }
}

export function wipe() {
  try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ }
}

export function unlock(s, kind, id) {
  if (!id) return false;
  const list = kind === 'glaze' ? s.glazes : kind === 'body' ? s.bodies : s.titles;
  if (list.includes(id)) return false;
  list.push(id);
  return true;
}
