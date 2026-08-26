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

      const blank = level < DARK ? 'BLACK' : level > BLOWN ? 'WHITE' : null;
      if (!blank) return;

      caught.push({
        kind: blank,
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
