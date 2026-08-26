// ============================================================
//  Catching a frame that came out blank.
//
//  Reported from an iPad and not reproducible anywhere else: frames
//  flashing black — and now white as well, which is the same fault
//  landing on a different rounding of a non-finite number.
//
//  This used to be opt-in, started from a console. That was useless
//  advice: a web inspector on an iPad needs a Mac and a cable, so the
//  one person who can see the bug had no way to turn the instrument on.
//  It runs by itself now, and what it catches is shown in the game, on
//  the device, where it can be photographed.
//
//  The cost is one small readPixels three times a second. That is a
//  pipeline stall, so it is kept to a 4x4 patch and a wide interval —
//  a diagnostic that cost frames would be measuring itself.
// ============================================================

const N = 4;                 // sample an NxN patch, not the whole screen
const EVERY = 20;            // frames between samples
const DARK = 6;              // 0-255: below this the frame is black
const BLOWN = 250;           // above this it is white

/**
 * What is on top of the canvas.
 *
 * readPixels returns the canvas's own backing store, and the browser
 * composites the DOM on top of that afterwards. So an instrument built
 * only on readPixels is structurally incapable of seeing a white page
 * element covering the game — it reports a perfectly good frame while
 * the player looks at a blank screen, and the four-tap readout says
 * "blank frames 0", which is worse than having no readout at all
 * because it sends the search in the wrong direction.
 *
 * That was not hypothetical. The loading screen was a full-screen plate
 * of #FBF0DF held at z-index 40 and dismissed only by a CSS transition,
 * and a CSS transition does not advance while iOS is not rendering the
 * tab. The one instrument that was supposed to catch it could not see
 * it by construction.
 *
 * So the watcher now also looks at what is stacked over the canvas, and
 * reports it as its own kind of blank frame.
 */
function coveringElement() {
  const vw = innerWidth, vh = innerHeight;
  if (!vw || !vh) return null;
  // hit-test the middle of the screen: the topmost painted thing there
  const canvas = document.getElementById('gl');
  const el = document.elementFromPoint(vw >> 1, vh >> 1);
  for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
    if (e === canvas) return null;                        // the canvas is on top
    /* An ancestor of the canvas is BEHIND it, not over it — its
       background paints under its own children. Walking the parent
       chain without this test reported #app, the canvas's own
       container, as the thing covering the canvas. */
    if (canvas && e.contains(canvas)) return null;
    const r = e.getBoundingClientRect();
    if (r.width * r.height < vw * vh * 0.75) continue;     // not full-screen
    const st = getComputedStyle(e);
    if (st.visibility === 'hidden' || st.display === 'none') continue;
    if (+st.opacity < 0.5) continue;
    const bg = st.backgroundColor, bi = st.backgroundImage;
    const m = bg.match(/[\d.]+/g);
    const alpha = m && m[3] !== undefined ? +m[3] : (m ? 1 : 0);
    if (alpha < 0.5 && (!bi || bi === 'none')) continue;   // paints nothing solid
    const lum = m ? (+m[0] * 0.2126 + +m[1] * 0.7152 + +m[2] * 0.0722) : null;
    return { tag: e.tagName + (e.id ? '#' + e.id : ''),
             cls: typeof e.className === 'string' ? e.className : '',
             lum: lum === null ? '?' : Math.round(lum), opacity: st.opacity, z: st.zIndex };
  }
  return null;
}

export function makeBlankFrameWatch(eng, game) {
  const gl = eng.renderer.getContext();
  const px = new Uint8Array(N * N * 4);
  const recent = [];
  const caught = game._blankFrames = [];
  let n = 0, lastT = 0, sinceResize = 999, sinceStage = 999, lastStage = null;

  const realResize = eng.resize.bind(eng);
  eng.resize = function () { sinceResize = 0; return realResize(); };

  const sample = () => {
    const w = eng.renderer.domElement.width, h = eng.renderer.domElement.height;
    if (!w || !h) return -1;
    gl.readPixels(Math.max(0, (w >> 1) - (N >> 1)), Math.max(0, (h >> 1) - (N >> 1)),
      N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
    return sum / (px.length / 4 * 3);
  };

  return {
    /** Call once per rendered frame, after render(). */
    tick() {
      n++;
      const now = performance.now();
      const gap = lastT ? now - lastT : 16.7;
      lastT = now;
      sinceResize++; sinceStage++;
      if (game.state !== lastStage) { lastStage = game.state; sinceStage = 0; }
      if (n % EVERY) return;

      const level = sample();
      if (level < 0) return;
      recent.push(Math.round(level));
      if (recent.length > 10) recent.shift();

      /* Two independent questions, because there are two ways for the
         screen to go blank and only one of them is in the framebuffer. */
      const over = coveringElement();
      const blank = over ? 'COVERED'
        : level < DARK ? 'BLACK'
          : level > BLOWN ? 'WHITE' : null;
      if (!blank) return;

      caught.push({
        kind: blank,
        covering: over ? `${over.tag}${over.cls ? '.' + over.cls.trim().split(/\s+/).join('.') : ''} lum ${over.lum} z ${over.z}` : undefined,
        frame: n,
        brightness: Math.round(level),
        stage: game.state,
        sinceResize: sinceResize > 900 ? '-' : sinceResize,
        sinceStage: sinceStage > 900 ? '-' : sinceStage,
        gap: Math.round(gap),
        lost: !!eng._lost || gl.isContextLost(),
        run: [...recent],
      });
      if (caught.length > 30) caught.shift();
    },
    report() {
      return { framesSeen: n, lastBrightness: recent[recent.length - 1] ?? null, caught };
    },
  };
}
