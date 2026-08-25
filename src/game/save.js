// ============================================================
//  CELADON — persistence
// ============================================================

const KEY = 'celadon.save.v1';
const MAX_GALLERY = 24;

export function blankSave() {
  return {
    v: 1,
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

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return blankSave();
    const s = JSON.parse(raw);
    if (!s || s.v !== 1) return blankSave();
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
