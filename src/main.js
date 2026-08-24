// ============================================================
//  CELADON — The Long Ash
//  entry point
// ============================================================

import { Engine } from './core/engine.js';
import { Studio } from './render/studio.js';
import { Game } from './game/game.js';
import { HUD } from './ui/hud.js';
import { Audio } from './audio/audio.js';

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
  let last = performance.now();
  let acc = 0, frames = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    try {
      game.update(dt);
      eng.rig.update(dt);
      eng.render(dt);
    } catch (e) {
      console.error('celadon: frame error', e);
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

  // expose for debugging and for automated smoke runs
  window.CELADON = {
    eng, studio, game, hud, audio,
    /** Advance the simulation by hand, for tests and headless captures. */
    pump(n = 1, dt = 1 / 60) {
      for (let i = 0; i < n; i++) { game.update(dt); eng.rig.update(dt); }
      eng.render(dt);
    },
  };
}

function pickQuality() {
  const mem = navigator.deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  const small = Math.min(window.innerWidth, window.innerHeight) < 720;
  if (mem <= 4 || cores <= 4 || small) return 'medium';
  return 'high';
}

main().catch((e) => {
  console.error(e);
  fail('Something went wrong before the first pot.', String(e && e.message ? e.message : e));
});
