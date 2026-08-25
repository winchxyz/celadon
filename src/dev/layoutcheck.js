// ============================================================
//  Does anything sit on top of anything else?
//
//  This was reported twice before it was found, because the check that
//  should have caught it was blind three ways. It took a hardcoded list
//  of panel ids, so #hand, #tool-tip and the glaze swatches were never
//  looked at. It compared getBoundingClientRect boxes, so a row scrolled
//  out of sight inside a panel counted as a collision and a transparent
//  container counted as a wall. And it ran with a mouse's stylesheet,
//  while the damage only happens under @media (pointer:coarse), where
//  the tool belt is 66px tall instead of 48 and grows into its
//  neighbours.
//
//  So: walk everything under #hud that actually puts ink on the screen,
//  clip each rectangle by every scrolling ancestor and by the viewport,
//  and compare what is left.
//
//    CELADON.layout()            what overlaps right now
//    CELADON.layout({coarse:1})  the same, with the tablet stylesheet on
//
//  It reports; it does not assert. The judgement of whether 4px of
//  overlap matters belongs to whoever is looking.
// ============================================================

const VP = () => ({ left: 0, top: 0, right: innerWidth, bottom: innerHeight });

const meet = (a, b) => {
  const left = Math.max(a.left, b.left), top = Math.max(a.top, b.top);
  const right = Math.min(a.right, b.right), bottom = Math.min(a.bottom, b.bottom);
  return (right <= left || bottom <= top) ? null : { left, top, right, bottom };
};

/**
 * The parts of an element that are actually on screen: its line boxes,
 * each cut down by every ancestor that clips, and by the window.
 *
 * Line BOXES, plural, and that matters. getBoundingClientRect on an
 * inline that has wrapped returns one rectangle spanning all of its
 * lines, from the left edge of the first to the right edge of the last
 * — a box covering ground the text never touches. The kiln readout is
 * `<span class=k>GLAZE</span> <span class=hot>…two lines…</span>`, and
 * that union box swallows the GLAZE label sitting beside it, which
 * reads as a 31x12 collision that nobody can see. getClientRects gives
 * one rectangle per line instead, which is where the ink is.
 */
function onScreen(el) {
  const list = el.getClientRects();
  const raw = list.length ? [...list] : [el.getBoundingClientRect()];
  const clips = [];
  for (let p = el.parentElement; p && p !== document.documentElement; p = p.parentElement) {
    const s = getComputedStyle(p);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') clips.push(p.getBoundingClientRect());
  }
  const out = [];
  for (const b of raw) {
    let box = { left: b.left, top: b.top, right: b.right, bottom: b.bottom };
    for (const c of clips) { box = meet(box, c); if (!box) break; }
    if (box) box = meet(box, VP());
    if (box) out.push(box);
  }
  return out;
}

/** Does this element paint, or is it only holding others? */
function paints(el, s) {
  const bg = s.backgroundColor;
  if (bg && bg !== 'rgba(0, 0, 0, 0)' && !/,\s*0\)$/.test(bg)) return true;
  if (parseFloat(s.borderTopWidth) > 0 || parseFloat(s.borderLeftWidth) > 0) return true;
  if (s.boxShadow && s.boxShadow !== 'none') return true;
  return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
}

/* The coarse-pointer rules, for a machine that has not got a touchscreen.
   Appended last, which is where they sit in the stylesheet, so the
   cascade here resolves the way it does on the tablet. */
const COARSE = `
  .tool{width:60px;height:66px}
  .btn{padding:1.15em 1.7em}
  input[type=range]{height:34px}
  .glaze{padding:.44em .45em}
  #context{width:min(420px,50vw)}
  #context.kiln{width:min(410px,48vw)}`;

function pretendCoarse(on) {
  let s = document.getElementById('celadon-coarse');
  if (!on) { s?.remove(); return; }
  if (!s) { s = document.createElement('style'); s.id = 'celadon-coarse'; document.head.appendChild(s); }
  s.textContent = COARSE;
}

export function layoutCheck({ coarse = false } = {}) {
  if (coarse) {
    pretendCoarse(true);
    // The belt is taller under a thumb, and the panel above it is placed
    // from the belt's measured height. Swapping the stylesheet without
    // re-measuring compares a coarse belt against a fine measurement and
    // invents a five-pixel overlap that is not there on the device.
    window.CELADON?.hud?._measure?.();
  }

  const inked = [];
  const walk = (el) => {
    for (const c of el.children) {
      const s = getComputedStyle(c);
      // display:none and a zero-size box take an element out of the
      // layout, and its own opacity says whether it is drawn. visibility
      // is deliberately NOT consulted: it is inherited, and #hud carries
      // it for the .6s fade, so every panel in the game reads as hidden
      // for as long as that fade is running or has not been given a
      // frame to start. Asking "where will this be" is not the same
      // question as "is it on screen this instant".
      if (s.display === 'none' || +s.opacity < 0.05) continue;
      const boxes = onScreen(c).filter((v) => v.right - v.left > 2 && v.bottom - v.top > 2);
      if (boxes.length && paints(c, s)) {
        inked.push({ el: c, boxes, name: c.id || c.className || c.tagName });
      }
      walk(c);
    }
  };
  const hud = document.getElementById('hud');
  if (hud) walk(hud);

  const related = (a, b) => a.contains(b) || b.contains(a);
  const seen = new Set(), hits = [];
  for (let i = 0; i < inked.length; i++) {
    for (let j = i + 1; j < inked.length; j++) {
      const A = inked[i], B = inked[j];
      if (related(A.el, B.el)) continue;
      let worst = null;
      for (const a of A.boxes) for (const b of B.boxes) {
        const o = meet(a, b);
        if (!o || o.right - o.left <= 4 || o.bottom - o.top <= 4) continue;
        const area = (o.right - o.left) * (o.bottom - o.top);
        if (!worst || area > worst.area) worst = { o, area };
      }
      if (!worst) continue;
      const { o } = worst;
      const line = `${A.name} × ${B.name}  ${Math.round(o.right - o.left)}×${Math.round(o.bottom - o.top)}px`;
      if (!seen.has(line)) { seen.add(line); hits.push(line); }
    }
  }

  const scrolls = [];
  for (const id of ['context', 'commission', 'gauges']) {
    const e = document.getElementById(id);
    if (!e) continue;
    const over = e.scrollHeight - e.clientHeight;
    if (over > 2) scrolls.push(`#${id} hides ${over}px`);
  }
  const list = document.querySelector('.glaze-list');
  if (list && list.scrollHeight - list.clientHeight > 2) {
    scrolls.push(`.glaze-list hides ${list.scrollHeight - list.clientHeight}px`);
  }

  if (coarse) { pretendCoarse(false); window.CELADON?.hud?._measure?.(); }
  return {
    viewport: [innerWidth, innerHeight],
    pointer: coarse ? 'coarse (forced)' : (matchMedia('(pointer:coarse)').matches ? 'coarse' : 'fine'),
    painted: inked.length,
    overlaps: hits,
    scrolling: scrolls,
  };
}
