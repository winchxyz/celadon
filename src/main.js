// ============================================================
//  CELADON — The Long Ash
//  entry point
// ============================================================

import { Engine } from './core/engine.js';
import { Studio } from './render/studio.js';
import { Game } from './game/game.js';
import { HUD } from './ui/hud.js';
import { Audio } from './audio/audio.js';
import { layoutCheck } from './dev/layoutcheck.js';
import { makeBlankFrameWatch } from './dev/blackframes.js';
import { makeDiag, BUILD, watchForNewBuild } from './dev/diag.js';

const boot = document.getElementById('boot');
const bootBar = document.querySelector('#boot-bar i');
const bootStatus = document.getElementById('boot-status');

function step(p, msg) {
  if (bootBar) bootBar.style.width = `${Math.round(p * 100)}%`;
  if (bootStatus && msg) bootStatus.textContent = msg;
  // deliberately not requestAnimationFrame: if the tab is backgrounded
  // mid-load, rAF stops entirely and the game would never finish booting.
  return new Promise((r) => setTimeout(r, 18));
}

function fail(title, msg) {
  boot.innerHTML = `
    <div style="max-width:46ch;text-align:center">
      <div style="font:400 26px/1.3 var(--serif);letter-spacing:.06em;margin-bottom:1em">${title}</div>
      <div style="font:400 13px/1.75 var(--sans);color:var(--ink-dim)">${msg}</div>
    </div>`;
}

async function main() {
  // ---- capability check -------------------------------------------
  const probe = document.createElement('canvas');
  const gl = probe.getContext('webgl2', { failIfMajorPerformanceCaveat: false });
  if (!gl) {
    fail('This one needs a graphics card.',
      'CELADON runs entirely on the GPU and needs WebGL2 with hardware acceleration. ' +
      'Try Chrome, Edge or Firefox with hardware acceleration switched on.');
    return;
  }
  probe.width = probe.height = 1;

  const canvas = document.getElementById('gl');
  let eng;
  try {
    await step(0.08, 'lighting the shed');
    eng = new Engine(canvas, pickQuality());
  } catch (e) {
    console.error(e);
    fail('The renderer would not start.', String(e && e.message ? e.message : e));
    return;
  }

  await step(0.30, 'mixing plaster and brick');
  const studio = new Studio(eng.scene, eng.renderer);

  await step(0.62, 'sieving nine winters of ash');
  const audio = new Audio();

  await step(0.76, 'wedging the clay');
  const hud = new HUD({ advance: () => { }, selectTool: () => { } });
  const game = new Game(eng, studio, hud, audio);
  hud.game = game;

  await step(0.90, 'warming the kiln');
  // Precompile so the first frame does not hitch. This is an optimisation,
  // never a requirement: if a driver chokes on it, carry on regardless.
  try {
    const t0 = performance.now();
    eng.renderer.compile(eng.scene, eng.camera);
    if (performance.now() - t0 > 2000) console.info('celadon: slow shader precompile');
  } catch (e) {
    console.warn('celadon: shader precompile skipped', e);
  }

  await step(0.95, 'lighting the lamps');

  game.begin();

  // renderer.compile() reaches the materials in the scene and stops
  // there. The post chain does not exist yet at that point: ambient
  // occlusion, bloom, the grade and the antialias are each their own
  // full-screen program, and none of them is built until something has
  // actually been drawn through them. That first pass through costs the
  // better part of a second, and without this it was spent on the
  // player's first frame of the game rather than here, behind the
  // loading screen, where a wait is what they are already looking at.
  try {
    // The things that only ever appear once you sit down at the wheel
    // have to be on screen for their programs to be built, so they are
    // shown for these two frames and put back. Two frames behind a
    // loading screen nobody will ever see.
    const hidden = [game.ghost, game.marker].filter(Boolean);
    const was = hidden.map((o) => o.visible);
    hidden.forEach((o) => { o.visible = true; });
    for (let i = 0; i < 2; i++) { eng.render(0.016); await step(0.97 + i * 0.015, 'lighting the lamps'); }
    hidden.forEach((o, i) => { o.visible = was[i]; });
  } catch (e) {
    console.warn('celadon: post-chain warmup skipped', e);
  }

  await step(1.0, 'ready');

  // one gesture is enough to start the audio context
  const kick = () => { audio.init(); audio.resume(); audio.setMuted(!game.save.settings.sound); };
  window.addEventListener('pointerdown', kick, { once: true });
  window.addEventListener('keydown', kick, { once: true });

  setTimeout(() => boot.classList.add('gone'), 260);

  // ---- loop -------------------------------------------------------
  const blankWatch = makeBlankFrameWatch(eng, game);
  // the readout the player can actually reach: four taps on the day
  // counter, because an iPad has no console and no cable
  const diag = makeDiag(eng, game, hud);
  // and say so if the server has moved on while this tab stayed open
  watchForNewBuild(hud);
  let last = performance.now();
  let acc = 0, frames = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    /* Simulating and drawing are separate failures.
       These three shared one try, so anything thrown while the world was
       being updated took the DRAW with it and the canvas presented an
       empty buffer — a black frame, for exactly as long as the throw
       kept happening. An intermittent one reads as a flicker. The screen
       has no business going dark because the clay had a bad tick, so the
       frame is still drawn from whatever state the world reached. */
    try {
      game.update(dt);
      eng.rig.update(dt);
    } catch (e) {
      console.error('celadon: update error', e);
    }
    try {
      eng.render(dt);
      blankWatch.tick();
      if (diag.open && (frames & 15) === 0) diag.render();
    } catch (e) {
      console.error('celadon: draw error', e);
    }
    // Adaptive quality: if we are consistently slow, shed something.
    //
    // The first rung used to switch off ambient occlusion, but the GTAO
    // pass was taken out of the chain when the renderer stopped trying
    // to look photographic — so the branch tested a property that no
    // longer exists, never fired, and a slow machine fell straight to
    // halving the pixel ratio. Antialiasing is the expensive pass now.
    acc += dt; frames++;
    if (acc > 3) {
      const fps = frames / acc;
      if (fps < 34 && eng.smaa && eng.smaa.enabled) {
        eng.smaa.enabled = false;
        console.info('celadon: antialiasing dropped to keep the frame rate up');
      } else if (fps < 26 && eng.renderer.getPixelRatio() > 1) {
        eng.renderer.setPixelRatio(1);
        eng.composer.setPixelRatio(1);
        eng.resize();
      }
      acc = 0; frames = 0;
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  /* Safari's own pinch, which the game's pinch sets off.
     iOS has ignored user-scalable=no since version 10, so two fingers on
     the pot zoom the camera AND zoom the page. The page zoom changes the
     visual viewport, which fires resize, which used to rebuild every
     render target in the chain — while the player was still pinching.
     These three are WebKit-only and do nothing anywhere else. */
  for (const g of ['gesturestart', 'gesturechange', 'gestureend']) {
    document.addEventListener(g, (e) => e.preventDefault(), { passive: false });
  }
  // and a double-tap is a zoom too, on the one surface that must not move
  eng.renderer.domElement.addEventListener('dblclick', (e) => e.preventDefault());

  // expose for debugging and for automated smoke runs
  window.CELADON = {
    eng, studio, game, hud, audio,
    /** Advance the simulation by hand, for tests and headless captures. */
    pump(n = 1, dt = 1 / 60) {
      for (let i = 0; i < n; i++) { game.update(dt); eng.rig.update(dt); }
      eng.render(dt);
      // so the watch can be exercised without a compositor:
      // requestAnimationFrame does not fire in a pane that is not being
      // displayed, which is where most of this game gets tested
      blankWatch.tick();
    },
    /** What is sitting on top of what, and what is being cut off.
     *  CELADON.layout({coarse:1}) asks the same with the tablet
     *  stylesheet applied, which is the only place it ever went wrong. */
    layout: layoutCheck,
    /** Every blank frame caught, black or white, and what was true
     *  around it. Always running; also shown in the game itself, since
     *  the device where this happens has no console. */
    blankFrames: () => blankWatch.report(),
    /** The readout, for anyone who does have a console. */
    diag: (v) => diag.toggle(v),
    build: BUILD,
  };
}

function pickQuality() {
  const mem = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  const small = Math.min(window.innerWidth, window.innerHeight) < 720;

  /* A touchscreen is a shared memory bus and a battery, whatever it
     claims about cores.
     Safari reports no deviceMemory at all, so the fallback of 8 sent
     every iPad down the high chain: a half-float target at twice the
     pixel ratio with 4x multisampling, a bloom pyramid and SMAA on top
     of it. On an 11-inch iPad that is a 2388x1668 buffer and something
     like a quarter of a gigabyte of GPU memory. A tablet under that
     kind of pressure does not slow down, it drops the WebGL context —
     and a dropped context is a black frame, appearing at no particular
     moment, which is exactly what was reported. */
  /* `pointer: coarse` and not `any-pointer: fine` is the precise
     question: is a finger the ONLY thing steering this. A laptop with a
     touchscreen answers no — its primary pointer is the trackpad — and
     keeps the high chain it can afford. An iPad answers yes. Counting
     maxTouchPoints instead would have quietly demoted every touchscreen
     laptop in the world. */
  const touchOnly = matchMedia('(pointer:coarse)').matches
    && !matchMedia('(any-pointer:fine)').matches;

  /* ...and an iPad asked to show the desktop version of a site says it
     is a Mac. It reports a fine pointer, a desktop-width layout and a
     Mac platform, so every test above is answered the way a laptop
     would answer it and the tablet quietly took the heavy chain — full
     device pixel ratio, more post passes — on a GPU chosen for battery
     life. Same hardware, twice the load, purely because of a menu
     setting the player flipped for unrelated reasons.

     That is not what made the flash white in one mode and black in the
     other; the page background was. It is its own fault, found while
     chasing that one, and worth closing on its own terms.

     A Mac has no touchscreen. maxTouchPoints is 0 on every real one and
     5 on an iPad, and it keeps saying 5 in desktop mode — the one part
     of the disguise the platform string cannot cover. */
  const nav = navigator;
  const pretendingToBeAMac = (nav.maxTouchPoints ?? 0) > 1
    && /Mac/.test(nav.platform || '');

  if (touchOnly || pretendingToBeAMac) return 'medium';

  if (mem <= 4 || cores <= 4 || small) return 'medium';
  return 'high';
}

main().catch((e) => {
  console.error(e);
  fail('Something went wrong before the first pot.', String(e && e.message ? e.message : e));
});
