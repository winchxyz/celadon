// ============================================================
//  Catching a frame that came out black.
//
//  Reported from an iPad and not reproducible anywhere else: a black
//  frame flashing repeatedly during play. Four plausible causes have
//  been fixed and the symptom survived all four, which means the next
//  step is not another guess — it is to make the device say what
//  happened.
//
//  This samples the framebuffer a few times a second and, when a frame
//  comes back essentially black, writes down everything that was true
//  around it: what the game was doing, whether the context had been
//  lost, whether a resize had just run, how long the frame took, and
//  what the last few frames looked like. Then it can be read off.
//
//      CELADON.watchBlackFrames()      start watching
//      CELADON.blackFrames()           what it has caught
//      CELADON.watchBlackFrames(false) stop
//
//  It is off unless asked for: readPixels stalls the pipeline, and a
//  diagnostic that costs frames would be measuring itself.
// ============================================================

const N = 8;                 // sample an NxN patch, not the whole screen
const EVERY = 10;            // frames between samples
const DARK = 6;              // 0-255: below this the patch is "black"

export function makeBlackFrameWatch(eng, game) {
  const gl = eng.renderer.getContext();
  const px = new Uint8Array(N * N * 4);
  const recent = [];
  const caught = [];
  let on = false, n = 0, lastT = 0, sinceResize = 1e9, sinceStage = 1e9, lastStage = null;

  // note when the things that could plausibly blank a frame happen
  const realResize = eng.resize.bind(eng);
  eng.resize = function () { sinceResize = 0; return realResize(); };

  const sample = () => {
    const w = eng.renderer.domElement.width, h = eng.renderer.domElement.height;
    gl.readPixels(Math.max(0, (w >> 1) - (N >> 1)), Math.max(0, (h >> 1) - (N >> 1)),
      N, N, gl.RGBA, gl.UNSIGNED_BYTE, px);
    let sum = 0;
    for (let i = 0; i < px.length; i += 4) sum += px[i] + px[i + 1] + px[i + 2];
    return sum / (px.length / 4 * 3);
  };

  return {
    /** Call once per rendered frame, after render(). */
    tick(dt) {
      if (!on) return;
      n++;
      const now = performance.now();
      const gap = lastT ? now - lastT : 16.7;
      lastT = now;
      sinceResize += 1; sinceStage += 1;
      if (game.state !== lastStage) { lastStage = game.state; sinceStage = 0; }

      if (n % EVERY) return;
      const level = sample();
      recent.push(Math.round(level));
      if (recent.length > 12) recent.shift();

      if (level < DARK) {
        caught.push({
          at: Math.round(now),
          frame: n,
          brightness: +level.toFixed(1),
          stage: game.state,
          framesSinceResize: sinceResize > 1e6 ? null : sinceResize,
          framesSinceStageChange: sinceStage > 1e6 ? null : sinceStage,
          frameGapMs: Math.round(gap),
          contextLost: !!eng._lost || gl.isContextLost(),
          smaaOn: eng.smaa ? eng.smaa.enabled : null,
          pixelRatio: eng.renderer.getPixelRatio(),
          drawCalls: eng.renderer.info?.render?.calls ?? null,
          recentBrightness: [...recent],
        });
        if (caught.length > 40) caught.shift();
      }
    },
    start(v = true) {
      on = !!v; n = 0; lastT = 0;
      if (on) console.info('celadon: watching for black frames — read them with CELADON.blackFrames()');
      return on;
    },
    report() {
      return {
        watching: on,
        framesSeen: n,
        sampledEvery: EVERY + ' frames',
        lastBrightness: recent.length ? recent[recent.length - 1] : null,
        caught: caught.length,
        frames: caught,
        hint: caught.length === 0
          ? 'nothing caught yet — play for a while with it on, then read this again'
          : 'framesSinceResize / framesSinceStageChange near 0 point at the cause',
      };
    },
  };
}
