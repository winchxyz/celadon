// ============================================================
//  What the device can tell you, on the device.
//
//  A web inspector on an iPad needs a Mac and a cable. Asking a player
//  to open a console they cannot open is not a diagnostic; it is a way
//  of not having one. So this is in the game: four taps on the day
//  counter and it says what build is running, what the screen actually
//  measures, what the last two-finger gesture was taken to be, and
//  every blank frame it has caught — black or white.
//
//  It can be photographed and sent, which is the only channel that
//  actually exists between a tablet and whoever is fixing it.
// ============================================================

export const BUILD = '2026-08-27.18';

/**
 * Notice when the server has a newer build than this tab is running.
 *
 * Asked, reasonably, whether anything had been fixed at all — and the
 * honest answer was that the tablet was almost certainly still running a
 * build from before the fixes. Safari keeps a tab alive for days and
 * GitHub Pages caches index.html; between them a page opened once can go
 * on being the old page indefinitely, with nothing on screen to say so.
 * Every fix after that point is invisible, and the person testing it is
 * left to conclude that nothing was done.
 *
 * So the game checks, and says.
 */
export function watchForNewBuild(hud) {
  const url = new URL('version.txt', location.href).href;
  let told = false;
  const check = async () => {
    if (told) return;
    try {
      const r = await fetch(`${url}?t=${Date.now()}`, { cache: 'no-store' });
      if (!r.ok) return;
      const there = (await r.text()).trim();
      if (there && there !== BUILD) {
        told = true;
        hud?.toast(
          `A newer build is out (<b>${there}</b>, you have ${BUILD}). `
          + 'Reload to pick it up.', 'hot', 20000);
      }
    } catch { /* offline is not an error worth mentioning */ }
  };
  setTimeout(check, 4000);
  setInterval(check, 180000);
}

const row = (k, v, bad = false) =>
  `<div${bad ? ' class="bad"' : ''}>${k} <b>${v}</b></div>`;

export function makeDiag(eng, game, hud) {
  const el = document.createElement('div');
  el.id = 'diag';
  document.getElementById('hud')?.appendChild(el);

  let taps = 0, lastTap = 0;
  const ledger = document.getElementById('led-day')?.closest('.led') || document.getElementById('ledger');
  if (ledger) {
    ledger.style.pointerEvents = 'auto';
    ledger.style.cursor = 'pointer';
    ledger.addEventListener('pointerdown', () => {
      const now = performance.now();
      taps = (now - lastTap < 700) ? taps + 1 : 1;
      lastTap = now;
      if (taps >= 4) { taps = 0; api.toggle(); }
    });
  }

  const api = {
    open: false,
    toggle(v = !api.open) {
      api.open = v;
      el.classList.toggle('on', v);
      if (v) api.render();
    },
    render() {
      const w = game._blankFrames || [];
      const gl = eng.renderer.getContext();
      const dpr = eng.renderer.getPixelRatio();
      el.innerHTML =
        '<h4>◍ What this device is doing</h4>'
        + row('build', BUILD)
        /* The boot time, on the device, where the only honest
           measurement of it can be taken. It cannot be probed from
           outside the page — anything injected after load has already
           missed it — and a browser pane that is not compositing is not
           a tablet. So the game times itself and shows the number, and
           it can be photographed like everything else here. */
        + row('opened in', window.CELADON_BOOT_MS != null
          ? `${(window.CELADON_BOOT_MS / 1000).toFixed(1)}s` : 'unknown',
          (window.CELADON_BOOT_MS ?? 0) > 8000)
        + (window.CELADON_BOOT_MARKS
          ? row('slowest part', (() => {
            const m = window.CELADON_BOOT_MARKS;
            let worst = ['', 0];
            for (let i = 1; i < m.length; i++) {
              const took = m[i][1] - m[i - 1][1];
              if (took > worst[1]) worst = [m[i - 1][0], took];
            }
            return `${worst[0]} ${(worst[1] / 1000).toFixed(1)}s`;
          })())
          : '')
        + row('screen', `${innerWidth} x ${innerHeight}  dpr ${dpr}`)
        + row('100vh says', `${Math.round(document.documentElement.clientHeight)}px`,
          Math.abs(document.documentElement.clientHeight - innerHeight) > 4)
        + row('canvas', `${eng.renderer.domElement.width} x ${eng.renderer.domElement.height}`)
        + row('quality', eng.quality + (eng.smaa ? (eng.smaa.enabled ? ' +aa' : ' -aa') : ''))
        + row('pointer', matchMedia('(pointer:coarse)').matches ? 'coarse (touch)' : 'fine')
        + row('fingers down', game._touches ? game._touches.size : 0)
        + row('last gesture', game._gesture || 'none')
        + row('context lost', eng._lost ? 'YES' : 'no', !!eng._lost)
        + row('blank frames', w.length, w.length > 0)
        + (w.length
          ? '<div style="margin-top:.6em">' + w.slice(-6).map((f) =>
            `<div class="bad">${f.kind} at ${f.stage} · ${f.gap}ms gap · ${f.sinceResize} since resize`
            + (f.covering ? `<br>covered by ${f.covering}` : '') + '</div>').join('') + '</div>'
          : '')
        + `<button>Close</button>`;
      el.querySelector('button').addEventListener('click', () => api.toggle(false));
    },
  };
  return api;
}
