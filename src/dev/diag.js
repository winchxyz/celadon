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

export const BUILD = '2026-08-26.7';

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
            `<div class="bad">${f.kind} at ${f.stage} · ${f.gap}ms gap · ${f.sinceResize} since resize</div>`).join('') + '</div>'
          : '')
        + `<button>Close</button>`;
      el.querySelector('button').addEventListener('click', () => api.toggle(false));
    },
  };
  return api;
}
