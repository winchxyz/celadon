// ============================================================
//  CELADON — interface
// ============================================================

import { clamp01, fmt, pct } from '../core/util.js';
import { GLAZES, GLAZE_BY_ID, COOLING, fuelCost, scheduleHours, kilnCurve, meltPoint } from '../sim/glaze.js';
import { FORMS, BODIES, rankFor, targetSize } from '../game/lore.js';

const $ = (s) => document.querySelector(s);
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

/* ---------------- tool glyphs ---------------- */
const ICONS = {
  centre: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.4"/><path d="M12 1v3M12 20v3M1 12h3M20 12h3"/>',
  open: '<path d="M4 15c0-5 3.6-9 8-9s8 4 8 9"/><path d="M8 15c0-2.6 1.8-4.6 4-4.6s4 2 4 4.6"/><path d="M12 3.4v4.2"/>',
  pull: '<path d="M7 21c0-7 1.4-11 5-11s5 4 5 11"/><path d="M12 8V2"/><path d="M9.2 4.6L12 1.8l2.8 2.8"/>',
  shape: '<path d="M6 20c0-6 2-9 6-9s6 3 6 9"/><path d="M2.5 12h3M18.5 12h3"/><path d="M4.6 10l1.9 2-1.9 2M19.4 10l-1.9 2 1.9 2"/>',
  rib: '<path d="M4.5 19.5L19 5"/><path d="M14.5 3.5h6v6"/><path d="M7 21c0-6 1.6-10 5-10"/>',
  water: '<path d="M12 3s6 6.6 6 10.6A6 6 0 016 13.6C6 9.6 12 3 12 3z"/><path d="M9.2 14.4a2.9 2.9 0 002.8 2.6"/>',
  needle: '<path d="M4 20l7.4-7.4"/><path d="M12.6 11.4L20 4"/><circle cx="12" cy="12" r="1.1"/><path d="M4 20l1.6-4 2.4 2.4z"/>',
  trim: '<path d="M7 21c0-7 1.4-11 5-11s5 4 5 11"/><path d="M17.5 8.5l4-4"/><path d="M19 3.5l2.5 2.5"/><path d="M15.6 10.4l1.4 1.4"/>',
  brush: '<path d="M6 20c2.6 0 4-1.5 4-4"/><path d="M10 16l8.4-8.4a2 2 0 013 2.6L13 19"/><path d="M4 20.5c0-2 1-3.5 2.4-3.5S9 18 9 20a4.5 4.5 0 01-5 .5z"/>',
  dip: '<path d="M4 12h16"/><path d="M7 12c0 5 1 8 5 8s5-3 5-8"/><path d="M8.5 6.5L12 3l3.5 3.5"/><path d="M12 3v6"/>',
  pour: '<path d="M5 4h7v4a5 5 0 01-5 5H5z"/><path d="M12 6l4 1.5"/><path d="M16 8c0 4-2 6-2 9"/>',
  wax: '<path d="M12 3l2.4 5 5.6.8-4 4 .9 5.6L12 15.8 7.1 18.4 8 12.8l-4-4L9.6 8z"/>',
  spray: '<path d="M9 21h5V9H9z"/><path d="M11 9V5h3"/><path d="M17 4.5h.01M19.5 6.5h.01M17 8.5h.01M20 10h.01M17.5 12h.01"/>',
  hands: '<path d="M8.5 13V4.6a1.6 1.6 0 013.2 0V11"/><path d="M11.7 11V3.4a1.6 1.6 0 013.2 0V11"/>'
       + '<path d="M14.9 11.4V6.2a1.6 1.6 0 013.2 0V14a7 7 0 01-7 7h-.6a6 6 0 01-5.2-3l-2.2-3.8a1.7 1.7 0 012.7-2l2 2.2"/>',
  sponge: '<rect x="4" y="9" width="16" height="9" rx="3"/><path d="M7 9c0-2.2 2.2-4 5-4s5 1.8 5 4"/><path d="M8 13h.01M12 12.5h.01M16 13.5h.01"/>',
};

const TOOLSETS = {
  // One pair of hands does the shaping. What it does follows from which
  // way you drag, exactly as it would at a real wheel — there is nothing
  // to select and nothing to get wrong before you have even touched it.
  throw: [
    { id: 'hands', key: '1', label: 'HANDS', icon: 'hands', tip: 'Shapes the wall. Drag up to lift and thin it, down to press it back, out to belly it, in to collar it.' },
    { id: 'rib', key: '2', label: 'RIB', icon: 'rib', tip: 'Smooths and trues the wall without moving clay. Takes the throwing rings down and the wobble out.' },
    { id: 'water', key: '3', label: 'WATER', icon: 'water', tip: 'Wets the clay so it moves again. Too wet and it slumps; SPACE does the same thing.' },
    { id: 'needle', key: '4', label: 'LEVEL RIM', icon: 'needle', tip: 'Cuts the rim level in one click. Use it when the top has gone uneven.' },
  ],
  trim: [
    { id: 'trim', key: '1', label: 'TURN', icon: 'trim', tip: 'Cuts away the surplus underneath and leaves a clean ring for the pot to stand on.' },
    { id: 'rib', key: '2', label: 'BURNISH', icon: 'rib', tip: 'Polishes the leather-hard surface. Compacts it and closes the pores.' },
  ],
  glaze: [
    { id: 'dip', key: '1', label: 'DIP', icon: 'dip', tip: 'The evenest coat there is. Set the line with the mouse, click to lower the pot in.' },
    { id: 'pour', key: '2', label: 'POUR', icon: 'pour', tip: 'Runs glaze down from where you hold it. Thick where it starts, thin where it ends.' },
    { id: 'brush', key: '3', label: 'BRUSH', icon: 'brush', tip: 'Paints exactly where you drag. Slow, and the only way to put a mark somewhere on purpose.' },
    { id: 'spray', key: '4', label: 'SPRAY', icon: 'spray', tip: 'A soft, thin, even coat. Good for shading one glaze into another.' },
    { id: 'wax', key: '5', label: 'WAX', icon: 'wax', tip: 'Resist. Glaze will not stick where you paint this, so it stays bare clay.' },
    { id: 'wipe', key: '6', label: 'WIPE FOOT', icon: 'sponge', tip: 'Cleans glaze off the foot. Leave it on and the pot welds itself to the kiln shelf.' },
  ],
};

/* ================================================================== */

export class HUD {
  constructor(game) {
    this.game = game;
    this.root = $('#hud');
    this.overlay = $('#overlay');
    this.ovInner = $('#ov-inner');
    this.toasts = $('#toasts');
    this.toolbar = $('#tools');
    this.context = $('#context');
    this.tool = null;
    this._toolset = null;
    this._toastQ = [];

    $('#advance').addEventListener('click', () => this.game.advance());

    // The wheel gauge doubles as the pedal: scrolling is nice when it
    // works, but a bar you can grab is one nobody has to be told about.
    const rpmRow = this.root.querySelector('.gauge[data-g="rpm"]');
    if (rpmRow) {
      rpmRow.classList.add('pedal');
      const bar = rpmRow.querySelector('.bar');
      const setFromEvent = (e) => {
        const r = bar.getBoundingClientRect();
        const f = clamp01((e.clientX - r.left) / Math.max(1, r.width));
        this.game.setWheelSpeedFrac?.(f);
      };
      let dragging = false;
      bar.addEventListener('pointerdown', (e) => {
        dragging = true; bar.setPointerCapture?.(e.pointerId);
        setFromEvent(e); e.preventDefault();
      });
      bar.addEventListener('pointermove', (e) => { if (dragging) setFromEvent(e); });
      const stop = () => { dragging = false; };
      bar.addEventListener('pointerup', stop);
      bar.addEventListener('pointercancel', stop);
      bar.title = 'Drag to set the wheel speed';
    }
  }

  /**
   * The HUD now fades. `hidden` is display:none, and an element cannot
   * transition out of display:none — toggling both classes in the same
   * statement meant the .6s fade authored in the stylesheet never ran a
   * single time. Visibility carries it instead, so this only has to
   * flip one class.
   */
  show(on) { this.root.classList.toggle('on', !!on); }

  /* ---------------- header ---------------- */

  setStage(name, hint) {
    $('#stage-name').textContent = name;
    $('#stage-hint').innerHTML = hint ?? '';
  }

  setLedger(s) {
    $('#led-day').textContent = s.day;
    $('#led-coin').textContent = s.coin;
    $('#led-rep').textContent = rankFor(s.rep).name;
  }

  setKeyHints(pairs) {
    // On a tablet, half of these name hardware that is not there. The
    // gestures do the same jobs, so the same line says them in the words
    // that apply: nobody with an iPad needs to be told about SHIFT.
    const touch = matchMedia('(pointer:coarse)').matches;
    const TOUCH = {
      'RMB': ['TWO FINGERS', 'orbit'],
      'RMB drag': ['TWO FINGERS', 'turn the pot'],
      'SCROLL': ['PINCH', 'zoom'],
      'SHIFT+SCROLL': null,
      'LMB': ['TAP', 'apply'],
      'DRAG': ['DRAG', null],
      'CTRL+Z': null,
      'TAB': null,
      'SPACE': null,
      '1-4': ['TAP', 'a tool'],
      '1-6': ['TAP', 'a tool'],
      'ENTER': null,
    };
    const shown = touch
      ? pairs.map(([k, v]) => {
        if (!(k in TOUCH)) return [k, v];
        const t = TOUCH[k];
        return t === null ? null : [t[0], t[1] ?? v];
      }).filter(Boolean)
      : pairs;
    // the same verb twice in a row reads as a stutter
    const seen = new Set();
    const uniq = shown.filter(([k, v]) => {
      const key = k + '|' + v;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });
    $('#keyhints').innerHTML = uniq.map(([k, v]) => `<b>${k}</b> ${v}`).join('   ·   ');
  }

  setAdvance(label, enabled = true) {
    const b = $('#advance');
    b.innerHTML = `${label} <kbd>↵</kbd>`;
    b.disabled = !enabled;
  }

  /* ---------------- commission ---------------- */

  setCommission(c, met) {
    if (!c) { $('#commission').classList.add('hidden'); return; }
    $('#commission').classList.remove('hidden');
    $('#com-title').textContent = c.title;
    $('#com-from').textContent = c.from;
    $('#com-text').innerHTML = c.text;
    const ul = $('#com-reqs');
    ul.innerHTML = '';
    const reqs = describeRequirements(c.require);
    for (const r of reqs) {
      const ok = met?.[r.key]?.ok;
      const li = el('li', ok ? 'met' : '', r.label);
      ul.appendChild(li);
    }
  }

  /* ---------------- gauges ---------------- */

  setGauge(name, v, text, level) {
    const g = this.root.querySelector(`.gauge[data-g="${name}"]`);
    if (!g) return;
    g.querySelector('.bar i').style.width = `${clamp01(v) * 100}%`;
    g.querySelector('.gv').textContent = text;
    g.classList.toggle('warn', level === 'warn');
    g.classList.toggle('bad', level === 'bad');
  }

  setVitals(h, d, mass) {
    $('#v-h').textContent = fmt(h, 1);
    $('#v-d').textContent = fmt(d, 1);
    $('#v-m').textContent = Math.round(mass);
  }

  showGauges(on) {
    $('#gauges').classList.toggle('hidden', !on);
    // The context panel below sits 250px down to clear the gauges. When
    // the gauges are not there - the glaze room and the kiln - that is
    // 250px of reserved emptiness, and it was pushing the kiln schedule
    // off the bottom of the screen and making it scroll.
    $('#hud').classList.toggle('no-gauges', !on);
  }

  /* ---------------- toolbar ---------------- */

  setToolset(name, selected, disabledFn) {
    if (this._toolset === name && !disabledFn) return;
    this._toolset = name;
    this.toolbar.innerHTML = '';
    const set = TOOLSETS[name] ?? [];
    if (!set.length) { this.toolbar.classList.add('hidden'); return; }
    this.toolbar.classList.remove('hidden');
    for (const t of set) {
      const b = el('button', 'tool');
      b.innerHTML =
        `<span class="tk">${t.key}</span>` +
        `<svg viewBox="0 0 24 24">${ICONS[t.icon] ?? ''}</svg>` +
        `<span class="tl">${t.label}</span>`;
      b.dataset.tool = t.id;
      b.dataset.tip = t.tip ?? '';
      if (t.tip) b.title = t.tip;
      if (disabledFn && disabledFn(t.id)) b.disabled = true;
      b.addEventListener('click', () => this.game.selectTool(t.id));
      this.toolbar.appendChild(b);
    }
    this.selectTool(selected ?? set[0].id);
  }

  selectTool(id) {
    this.tool = id;
    let tip = '';
    for (const b of this.toolbar.children) {
      const on = b.dataset.tool === id;
      b.classList.toggle('sel', on);
      if (on) tip = b.dataset.tip || '';
    }
    // Say what the thing in your hand does. A row of icons with one-word
    // labels tells you a rib exists; it does not tell you that a rib
    // trues a wall without moving any clay, and there was nowhere in the
    // game that did.
    this.setToolTip(tip);
  }

  /** The line under the stage title that names what the current tool does. */
  setToolTip(text) {
    const e = $('#tool-tip');
    if (!e) return;
    e.innerHTML = text || '';
    e.classList.toggle('on', !!text);
  }

  toolKeys() {
    const set = TOOLSETS[this._toolset] ?? [];
    return Object.fromEntries(set.map((t) => [t.key, t.id]));
  }

  /* ---------------- the hand ---------------- */

  /**
   * The floating label by the cursor. `verb` is what a press will do right
   * now; `power` is how much of it is landing. Naming the action as it
   * happens is what teaches the controls — not the help screen.
   */
  setHand(x, y, verb, power, on) {
    const h = this._hand || (this._hand = $('#hand'));
    h.classList.toggle('on', !!on);
    if (!on) return;
    h.style.left = `${x}px`;
    h.style.top = `${y}px`;
    h.classList.toggle('idle', !verb || power < 0.02);
    if (verb !== this._handVerb) {
      this._handVerb = verb;
      $('#hand-verb').textContent = verb || 'REACH';
    }
    (this._handBar || (this._handBar = h.querySelector('i b')))
      .style.width = `${clamp01(power) * 100}%`;
  }

  /* ---------------- coach ---------------- */

  /** One instruction at a time, and nothing else. */
  setCoach(step, text, done) {
    const c = this._coach || (this._coach = $('#coach'));
    if (!text) {
      c.classList.remove('on');
      this.root.classList.remove('coaching');
      this._coachText = null;
      return;
    }
    c.classList.add('on');
    // the stage hint says the same thing; only one of them at a time
    this.root.classList.add('coaching');
    c.classList.toggle('done', !!done);
    if (text !== this._coachText) {
      this._coachText = text;
      $('#coach-text').innerHTML = text;
      $('#coach-step').textContent = done ? '✓' : String(step);
    }
  }

  /* ---------------- silhouette against the brief ---------------- */

  showFormView(on) { $('#formview').classList.toggle('hidden', !on); }

  /**
   * Draw the shape being asked for and the shape on the wheel at the same
   * scale, so "too tall" and "not a bowl" are things you can see rather
   * than things you read afterwards in the appraisal.
   */
  drawSilhouette(clay, commission) {
    const cv = this._silho || (this._silho = $('#silho'));
    if (!cv) return;
    const g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);

    const req = commission?.require ?? {};
    const form = FORMS[req.form];
    const t = form ? targetSize(req) : null;
    const tH = t ? t.H : 0;
    const tD = t ? t.D : 0;

    const cH = clay ? clay.height : 0;
    const cD = clay ? clay.maxR * 2 : 0;

    const padX = 26, padY = 20;
    const spanH = Math.max(tH, cH, 8) * 1.12;
    const spanW = Math.max(tD, cD, 8) * 1.15;
    const sc = Math.min((H - padY * 2) / spanH, (W - padX * 2) / spanW);
    const cx = W / 2, base = H - padY;

    // wheel head
    g.strokeStyle = 'rgba(74,53,36,0.16)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(padX * 0.5, base + 0.5); g.lineTo(W - padX * 0.5, base + 0.5); g.stroke();

    const outline = (pts, stroke, fill, width) => {
      if (pts.length < 2) return;
      g.beginPath();
      g.moveTo(cx + pts[0][0] * sc, base - pts[0][1] * sc);
      for (const [r, y] of pts) g.lineTo(cx + r * sc, base - y * sc);
      for (let i = pts.length - 1; i >= 0; i--) g.lineTo(cx - pts[i][0] * sc, base - pts[i][1] * sc);
      g.closePath();
      if (fill) { g.fillStyle = fill; g.fill(); }
      g.strokeStyle = stroke; g.lineWidth = width; g.stroke();
    };

    // the pot underneath...
    if (clay && cH > 0.3) {
      const n = clay.ro.length;
      const pts = [];
      for (let i = 0; i < n; i += 3) {
        pts.push([clay.ro[i], (clay.y[i] + clay.y[i + 1]) * 0.5]);
      }
      outline(pts, '#3F9C81', 'rgba(63,156,129,0.22)', 2.6);
    }

    // ...and the shape asked for drawn over it, so it never gets buried
    if (form) {
      const tp = [];
      for (let i = 0; i <= 40; i++) {
        const u = i / 40;
        tp.push([Math.max(0.05, form.profile(u) * tD * 0.5), u * tH]);
      }
      g.setLineDash([5, 4]);
      outline(tp, 'rgba(122,90,62,0.85)', null, 2.0);
      g.setLineDash([]);
    }

    // dimensions
    g.font = '700 11px ui-rounded, Nunito, Candara, "Segoe UI", sans-serif';
    g.fillStyle = 'rgba(74,53,36,0.92)';
    g.textAlign = 'left';
    g.fillText(`${cH.toFixed(1)} cm`, 6, 14);
    g.textAlign = 'right';
    g.fillText(`⌀ ${cD.toFixed(1)}`, W - 6, 14);
    if (form) {
      g.fillStyle = 'rgba(125,98,73,0.85)';
      g.textAlign = 'left';
      g.fillText(`${tH.toFixed(0)}`, 6, 27);
      g.textAlign = 'right';
      g.fillText(`⌀ ${tD.toFixed(0)}`, W - 6, 27);
    }
  }

  /* ---------------- context panels ---------------- */

  hideContext() { this.context.classList.add('hidden'); }

  glazePanel(state, onPick, onThick) {
    const c = this.context;
    c.classList.remove('hidden');
    c.classList.remove('kiln');   // the wide schedule layout is the kiln's alone
    c.innerHTML = '';
    c.appendChild(el('div', 'panel-h', '<span class="glyph">◍</span> GLAZE BUCKETS'));

    const list = el('div', 'glaze-list');
    for (const g of GLAZES) {
      const owned = state.glazes.includes(g.id);
      const row = el('div', 'glaze' + (owned ? '' : ' locked') + (state.slot === g.id ? ' sel' : ''));
      row.innerHTML =
        `<span class="sw" style="background:${g.swatch}"></span>` +
        `<span><span class="gn">${g.name}</span><br><span class="gt">${g.family}</span></span>` +
        (owned ? `<span class="lock">${Math.round(meltPoint(g))}°</span>` : '<span class="lock">✕</span>');
      row.title = owned ? `${g.desc}` : 'Not yet in your shed.';
      if (owned) row.addEventListener('click', () => onPick(g.id));
      list.appendChild(row);
    }
    c.appendChild(list);

    const t = el('div', 'slider-row');
    t.innerHTML = `<label>COAT THICKNESS <span id="gth">${fmt(state.thickness * 10, 2)} mm</span></label>`;
    const inp = el('input');
    inp.type = 'range'; inp.min = '0.04'; inp.max = '0.30'; inp.step = '0.005';
    inp.value = String(state.thickness);
    inp.addEventListener('input', () => {
      $('#gth').textContent = `${fmt(parseFloat(inp.value) * 10, 2)} mm`;
      onThick(parseFloat(inp.value));
    });
    t.appendChild(inp);
    c.appendChild(t);

    c.appendChild(el('div', 'readout',
      'Thin coats break over edges.<br>Thick coats run, and crawl.'));
  }

  updateGlazeSelection(id) {
    for (const row of this.context.querySelectorAll('.glaze')) {
      row.classList.toggle('sel', row.querySelector('.gn')?.textContent === GLAZE_BY_ID[id]?.name);
    }
  }

  kilnPanel(sched, onChange, fireNow) {
    this.context.classList.add('kiln');
    const c = this.context;
    c.classList.remove('hidden');
    c.innerHTML = '';
    c.appendChild(el('div', 'panel-h', '<span class="glyph">◍</span> FIRING SCHEDULE'));

    const canvas = el('canvas');
    canvas.id = 'curve';
    canvas.width = 480; canvas.height = 192;
    c.appendChild(canvas);
    this.curveCanvas = canvas;

    const slider = (key, label, min, max, step, fmtFn, why) => {
      const row = el('div', 'slider-row');
      row.innerHTML = `<label>${label} <span data-v="${key}">${fmtFn(sched[key])}</span></label>`;
      const inp = el('input');
      inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
      inp.value = String(sched[key]);
      inp.addEventListener('input', () => {
        sched[key] = parseFloat(inp.value);
        row.querySelector(`[data-v="${key}"]`).textContent = fmtFn(sched[key]);
        onChange();
      });
      // Hover and focus alone are not enough. A tablet has no hover, and
      // a tap on a range input does not reliably focus it — so the one
      // explanation a touch player could reach would never open. Touching
      // the row is the signal that always arrives.
      const reveal = () => {
        for (const r of c.querySelectorAll('.slider-row.showing')) r.classList.remove('showing');
        row.classList.add('showing');
      };
      row.addEventListener('pointerdown', reveal);
      inp.addEventListener('input', reveal);
      row.appendChild(inp);
      // Every one of these is a decision with a consequence, and the
      // panel used to be five bare numbers with no explanation anywhere
      // in the game of what any of them would do to the pot.
      if (why) { const h = el('div', 'slider-why', why); row.appendChild(h); row.title = why; }
      c.appendChild(row);
      return inp;
    };

    slider('peak', 'Peak', 900, 1330, 5, (v) => `${Math.round(v)}°C`,
      'How hot it gets. This is the one that decides everything: a glaze below its own maturing temperature comes out a dry scab.');
    slider('ramp', 'Ramp', 40, 320, 5, (v) => `${Math.round(v)}°/hr`,
      'How fast it climbs. Too fast for the thickness of the wall and the piece comes apart on the way up.');
    slider('soak', 'Soak', 0, 3, 0.1, (v) => `${fmt(v, 1)} hr`,
      'How long it sits at the top. This is how far the glaze gets to move and level itself out.');
    slider('reduction', 'Reduction', 0, 1, 0.02, (v) => `${pct(v)}%`,
      'How far the air is starved. This is what turns copper red and iron green: no reduction, no celadon.');
    slider('reduceFrom', 'Damper at', 820, 1150, 10, (v) => `${Math.round(v)}°C`,
      'When the damper shuts. Too early and the body has not finished burning out; too late and the colour never comes.');
    const seg = el('div', 'seg');
    for (const k of ['crash', 'normal', 'slow']) {
      const b = el('button', sched.cooling === k ? 'sel' : '', COOLING[k].name);
      b.title = COOLING[k].note;
      b.addEventListener('click', () => {
        sched.cooling = k;
        for (const bb of seg.children) bb.classList.remove('sel');
        b.classList.add('sel');
        this._holdRow.style.display = k === 'slow' ? '' : 'none';
        onChange();
      });
      seg.appendChild(b);
    }
    const cl = el('div', 'slider-row');
    cl.innerHTML = '<label>COOLING</label>';
    cl.appendChild(seg);
    c.appendChild(cl);

    const holdWrap = el('div');
    this._holdRow = holdWrap;
    holdWrap.style.display = sched.cooling === 'slow' ? '' : 'none';
    c.appendChild(holdWrap);
    const mk = (key, label, min, max, step, fmtFn) => {
      const row = el('div', 'slider-row');
      row.innerHTML = `<label>${label} <span data-v="${key}">${fmtFn(sched[key])}</span></label>`;
      const inp = el('input');
      inp.type = 'range'; inp.min = min; inp.max = max; inp.step = step;
      inp.value = String(sched[key]);
      inp.addEventListener('input', () => {
        sched[key] = parseFloat(inp.value);
        row.querySelector(`[data-v="${key}"]`).textContent = fmtFn(sched[key]);
        onChange();
      });
      row.appendChild(inp);
      holdWrap.appendChild(row);
    };
    mk('holdT', 'Crystal hold', 1000, 1160, 5, (v) => `${Math.round(v)}°C`);
    mk('holdHrs', 'Hold length', 0, 6, 0.25, (v) => `${fmt(v, 2)} hr`);

    this.kilnReadout = el('div', 'readout');
    c.appendChild(this.kilnReadout);
    this.updateKilnPanel(sched);
  }

  updateKilnPanel(sched, coin, needs) {
    if (!this.curveCanvas) return;
    const cost = fuelCost(sched);
    const hrs = scheduleHours(sched);
    if (needs !== undefined) this._kilnNeeds = needs;
    const need = this._kilnNeeds;
    if (this.kilnReadout) {
      // The most useful sentence in the room, and it was nowhere: the
      // temperature the glaze on THIS pot needs. Taking a 1272 °C celadon
      // to 1100 is the commonest way to waste a firing, and nothing said
      // so before, during or after it.
      const verdict = !need ? ''
        : sched.peak < need.temp
          ? `<span class="k">GLAZE</span> <span class="hot">${need.name} needs ` +
            `${Math.round(need.temp)}°C — this stops ${Math.round(need.temp - sched.peak)}° short</span><br>`
          : `<span class="k">GLAZE</span> ${need.name} melts at ` +
            `${Math.round(need.temp)}°C — hot enough<br>`;
      this.kilnReadout.innerHTML =
        verdict +
        `<span class="k">FIRING</span> ${fmt(hrs, 1)} hr<br>` +
        `<span class="k">FUEL</span> <span class="${coin != null && cost > coin ? 'hot' : ''}">${cost} ash-marks</span><br>` +
        `<span class="k">ATMOSPHERE</span> ${sched.reduction < 0.2 ? 'oxidising' : sched.reduction < 0.55 ? 'neutral' : 'reducing'}`;
    }

    const cv = this.curveCanvas, g = cv.getContext('2d');
    const W = cv.width, H = cv.height;
    g.clearRect(0, 0, W, H);
    // grid
    g.strokeStyle = 'rgba(74,53,36,0.10)';
    g.lineWidth = 1;
    for (let T = 200; T <= 1400; T += 200) {
      const y = H - (T / 1400) * (H - 12) - 6;
      g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke();
    }
    // crystal window
    const yA = H - (1120 / 1400) * (H - 12) - 6;
    const yB = H - (1030 / 1400) * (H - 12) - 6;
    g.fillStyle = 'rgba(63,156,129,0.10)';
    g.fillRect(0, yA, W, yB - yA);

    // curve
    g.beginPath();
    for (let i = 0; i <= 240; i++) {
      const t = i / 240;
      const T = kilnCurve(sched, t);
      const x = t * W;
      const y = H - (T / 1400) * (H - 12) - 6;
      if (i === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    const grd = g.createLinearGradient(0, H, 0, 0);
    grd.addColorStop(0, '#5273B8');
    grd.addColorStop(0.55, '#C98A2E');
    grd.addColorStop(1, '#E5701F');
    g.strokeStyle = grd;
    g.lineWidth = 2;
    g.stroke();

    // reduction shading
    if (sched.reduction > 0.03) {
      g.fillStyle = `rgba(229,112,31,${0.06 + sched.reduction * 0.16})`;
      const yR = H - (sched.reduceFrom / 1400) * (H - 12) - 6;
      g.fillRect(0, 0, W, yR);
    }
  }

  drawKilnProgress(t) {
    if (!this.curveCanvas) return;
    // handled by updateKilnPanel redraw plus a marker
  }

  /* ---------------- toasts ---------------- */

  toast(text, kind = '', ms = 3400) {
    const t = el('div', `toast ${kind}`, text);
    this.toasts.appendChild(t);
    setTimeout(() => {
      t.classList.add('out');
      setTimeout(() => t.remove(), 520);
    }, ms);
    while (this.toasts.children.length > 4) this.toasts.firstChild.remove();
  }

  /* ---------------- overlay ---------------- */

  openOverlay(html, soft = false) {
    this.ovInner.innerHTML = html;
    this.overlay.classList.toggle('soft', !!soft);
    this.overlay.classList.add('on');
    this.overlay.classList.remove('hidden');
  }

  closeOverlay() {
    this.overlay.classList.remove('on');
    this.ovInner.innerHTML = '';
  }

  get overlayOpen() { return this.overlay.classList.contains('on'); }

  bind(sel, fn) {
    const e = this.ovInner.querySelector(sel);
    if (e) e.addEventListener('click', fn);
    return e;
  }
  bindAll(sel, fn) {
    for (const e of this.ovInner.querySelectorAll(sel)) {
      e.addEventListener('click', () => fn(e));
    }
  }
}

/* ------------------------------------------------------------------ */

export function describeRequirements(req = {}) {
  const out = [];
  if (req.form) out.push({ key: 'form', label: `A <b>${FORMS[req.form]?.name ?? req.form}</b>` });
  if (req.minH) out.push({ key: 'minH', label: `At least <b>${req.minH} cm</b> tall` });
  if (req.maxH) out.push({ key: 'maxH', label: `No taller than <b>${req.maxH} cm</b>` });
  if (req.minD) out.push({ key: 'minD', label: `At least <b>${req.minD} cm</b> across` });
  if (req.maxD) out.push({ key: 'maxD', label: `No wider than <b>${req.maxD} cm</b>` });
  if (req.maxWall) out.push({ key: 'maxWall', label: `Mean wall under <b>${req.maxWall} cm</b>` });
  if (req.glaze) out.push({ key: 'glaze', label: `Glazed in <b>${GLAZE_BY_ID[req.glaze]?.name ?? req.glaze}</b>` });
  if (req.effect) out.push({ key: 'effect', label: `Showing <b>${EFFECTS[req.effect] ?? req.effect}</b>` });
  if (req.atmos) out.push({ key: 'atmos', label: `Fired in <b>${req.atmos}</b>` });
  if (req.minPeak) out.push({ key: 'minPeak', label: `Peak of at least <b>${req.minPeak}°C</b>` });
  if (req.maxPeak) out.push({ key: 'maxPeak', label: `Peak no more than <b>${req.maxPeak}°C</b>` });
  if (req.noDefects) out.push({ key: 'noDefects', label: 'No faults of any kind' });
  if (req.minScore) out.push({ key: 'minScore', label: `Graded at least <b>${req.minScore}</b>` });
  return out;
}

const EFFECTS = {
  crystal: 'crystal growth', oilspot: 'oil spots', hare: "hare's fur",
  copperRed: 'a true copper red', carbon: 'carbon trapping', craze: 'a craze net',
  peel: 'orange peel', opal: 'opalescence', metal: 'metallic lustre',
};
