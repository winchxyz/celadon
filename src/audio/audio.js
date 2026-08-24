// ============================================================
//  CELADON — sound
//
//  Nothing here is a sample. The wheel is a sawtooth through a
//  lowpass whose cutoff tracks the speed; the clay is filtered
//  noise gated by contact pressure; the kiln is brown noise
//  through a resonant band; the music is three detuned triangles
//  and an FM bell that rings on a pentatonic every so often.
// ============================================================

import { clamp, clamp01, lerp } from '../core/util.js';

const PENT = [0, 2, 5, 7, 9, 12, 14, 17, 19, 21, 24];

export class Audio {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.master = null;
    this._noiseBuf = null;
    this._brownBuf = null;
    this.volumes = { master: 0.62, music: 0.42, sfx: 0.85 };
  }

  init() {
    if (this.ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.volumes.master;

    // a gentle limiter so the kiln does not clip everything else
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 5;
    comp.attack.value = 0.006;
    comp.release.value = 0.24;

    // room: a short algorithmic reverb (noise burst convolution)
    const conv = ctx.createConvolver();
    conv.buffer = this._impulse(2.1, 2.6);
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    const dry = ctx.createGain(); dry.gain.value = 0.92;

    this.bus = ctx.createGain();
    this.bus.connect(dry).connect(comp);
    this.bus.connect(conv).connect(wet).connect(comp);
    comp.connect(this.master).connect(ctx.destination);

    this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.bus);
    this.musBus = ctx.createGain(); this.musBus.gain.value = 0;
    this.musBus.connect(this.bus);

    this._noiseBuf = this._noise(2.0, false);
    this._brownBuf = this._noise(3.0, true);

    this._buildWheel();
    this._buildClay();
    this._buildKiln();
    this._buildRoom();
    this._buildMusic();

    this.ready = true;
    return true;
  }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    // Browsers will not let a page make a sound until someone has
    // touched it, so this is the first moment the recordings are worth
    // fetching. It is fire-and-forget: the synthesised set is already
    // playing, and swaps over quietly if and when the files arrive.
    if (this.ctx && !this.buf && !this._loading) {
      this._loading = true;
      this.loadSamples().catch(() => {});
    }
  }

  /* ---------------- buffers ---------------- */

  _noise(seconds, brown) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.021 * w) / 1.021; d[i] = last * 3.2; }
      else d[i] = w;
    }
    return b;
  }

  _impulse(seconds, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * seconds);
    const b = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
    }
    return b;
  }

  _loop(buf, gain, dest) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf; s.loop = true;
    const g = this.ctx.createGain(); g.gain.value = gain;
    s.connect(g).connect(dest);
    s.start();
    return { src: s, gain: g };
  }

  /* ---------------- recorded sound ---------------- */

  /**
   * Load the recordings, if they are there.
   *
   * Everything below this is still synthesised and still runs: a
   * missing or unplayable file must not take the game down, and the
   * clay under the hand stays synthetic on purpose — it has to answer
   * continuously to how hard you are pressing and how wet the pot is,
   * and a recording cannot do that. What the recordings replace are the
   * things that ARE fixed sounds: a motor, a fire, a room, a click.
   *
   * Sources and licences are listed in public/sfx/CREDITS.md. All CC0.
   */
  async loadSamples(base = 'sfx/') {
    if (!this.ctx || this.buf) return false;
    const want = {
      wheel: 'wheel.ogg', kiln: 'kiln.ogg', room: 'room.ogg', water: 'water.ogg',
      click: 'click.ogg', thud: 'thud.ogg', splash: 'splash.ogg',
      shatter: 'shatter.ogg', chime: 'chime.ogg',
    };
    const buf = {};
    try {
      await Promise.all(Object.entries(want).map(async ([k, f]) => {
        const res = await fetch(base + f);
        if (!res.ok) throw new Error(f);
        buf[k] = await this.ctx.decodeAudioData(await res.arrayBuffer());
      }));
    } catch (e) {
      console.info('celadon: no sound files, using the synthesised set', e?.message ?? e);
      return false;
    }
    this.buf = buf;
    this._buildSampleLoops();
    return true;
  }

  _buildSampleLoops() {
    const ctx = this.ctx;
    const mk = (b, dest) => {
      const src = ctx.createBufferSource();
      src.buffer = b; src.loop = true;
      const g = ctx.createGain(); g.gain.value = 0;
      src.connect(g).connect(dest);
      src.start(ctx.currentTime + Math.random() * 0.05);
      return { src, g };
    };
    this.s = {
      wheel: mk(this.buf.wheel, this.sfxBus),
      kiln: mk(this.buf.kiln, this.sfxBus),
      room: mk(this.buf.room, this.bus),
      water: mk(this.buf.water, this.sfxBus),
    };
    this.s.room.g.gain.setTargetAtTime(0.055, ctx.currentTime, 2.0);
  }

  /** Fire a recording once. Returns false if there is not one. */
  _shot(name, vol = 1, rate = 1) {
    if (!this.buf || !this.buf[name]) return false;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.buf[name];
    src.playbackRate.value = rate;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(g).connect(this.sfxBus);
    src.start();
    return true;
  }

  /* ---------------- continuous voices ---------------- */

  /**
   * The wheel: a motor, a belt, and a heavy bench.
   *
   * It used to be a sawtooth and a square through a filter ringing at
   * Q 3.2, which is a synthesiser making a buzz — a shape of sound that
   * does not occur anywhere in a pottery. A wheel is almost entirely
   * smooth: a hum from the motor with a couple of quiet harmonics, the
   * dry whirr of the belt and bearings, which is NOISE and not a
   * waveform at all, and a low rumble through the bench you are sitting
   * on. Nothing in it has a hard edge, and nothing rings.
   */
  _buildWheel() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;

    // motor hum
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 340; lp.Q.value = 0.5;
    const o1 = ctx.createOscillator(); o1.type = 'sine'; o1.frequency.value = 58;
    const o2 = ctx.createOscillator(); o2.type = 'triangle'; o2.frequency.value = 116;
    const og = ctx.createGain(); og.gain.value = 0.20;
    const og2 = ctx.createGain(); og2.gain.value = 0.05;
    o1.connect(og).connect(lp);
    o2.connect(og2).connect(lp);
    lp.connect(g);

    // belt and bearings
    const whir = ctx.createBiquadFilter(); whir.type = 'bandpass'; whir.frequency.value = 520; whir.Q.value = 0.9;
    this._loop(this._noiseBuf, 0.13, whir);
    whir.connect(g);

    // the bench under it
    const rlp = ctx.createBiquadFilter(); rlp.type = 'lowpass'; rlp.frequency.value = 120; rlp.Q.value = 0.4;
    this._loop(this._brownBuf, 0.34, rlp);
    rlp.connect(g);

    g.connect(this.sfxBus);
    o1.start(); o2.start();
    this.wheel = { g, lp, o1, o2, whir };
  }

  _buildClay() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 900; bp.Q.value = 1.1;
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 260;
    const src = this._loop(this._noiseBuf, 1.0, bp);
    bp.connect(hp).connect(g).connect(this.sfxBus);
    this.clay = { g, bp, hp };
  }

  _buildKiln() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 130; bp.Q.value = 1.1;
    this._loop(this._brownBuf, 1.0, lp);
    this._loop(this._noiseBuf, 0.26, bp);
    lp.connect(g); bp.connect(g);
    g.connect(this.sfxBus);
    this.kiln = { g, lp, bp };
  }

  _buildRoom() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.055;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300;
    const src = this._loop(this._brownBuf, 0.5, lp);
    // wind gusting past the window
    const lfo = ctx.createOscillator(); lfo.type = 'sine'; lfo.frequency.value = 0.043;
    const lg = ctx.createGain(); lg.gain.value = 180;
    lfo.connect(lg).connect(lp.frequency);
    lfo.start();
    lp.connect(g).connect(this.bus);
    this.room = { g, lp };
  }

  _buildMusic() {
    const ctx = this.ctx;
    const g = ctx.createGain(); g.gain.value = 0.5;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700; lp.Q.value = 0.6;

    this.padOscs = [];
    const root = 55; // A1
    for (const [mult, det, gain] of [[1, 0, 0.16], [1.5, 3.5, 0.10], [2, -4.5, 0.085], [3, 6, 0.045]]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = root * mult;
      o.detune.value = det;
      const og = ctx.createGain(); og.gain.value = gain;
      // slow amplitude drift so it breathes
      const lfo = ctx.createOscillator(); lfo.type = 'sine';
      lfo.frequency.value = 0.021 + Math.random() * 0.03;
      const lg = ctx.createGain(); lg.gain.value = gain * 0.55;
      lfo.connect(lg).connect(og.gain);
      lfo.start();
      o.connect(og).connect(lp);
      o.start();
      this.padOscs.push(o);
    }
    const flt = ctx.createOscillator(); flt.type = 'sine'; flt.frequency.value = 0.017;
    const fg = ctx.createGain(); fg.gain.value = 320;
    flt.connect(fg).connect(lp.frequency);
    flt.start();

    lp.connect(g).connect(this.musBus);
    this.music = { g, lp };
    this._nextBell = 0;
  }

  /* ---------------- per-frame drive ---------------- */

  update(dt, s = {}) {
    if (!this.ready || this.muted) return;
    const t = this.ctx.currentTime;
    const k = 1 - Math.exp(-6 * dt);

    // wheel
    const om = clamp01((s.omega ?? 0) / 14);
    // With recordings loaded the synthesised wheel, kiln and room step
    // aside rather than being torn down — one flag, and either set can
    // carry the game on its own.
    if (this.s) {
      this.s.wheel.g.gain.setTargetAtTime(om * 0.34, t, 0.14);
      this.s.wheel.src.playbackRate.setTargetAtTime(0.70 + om * 0.55, t, 0.20);
      this.s.kiln.g.gain.setTargetAtTime(clamp01(s.kilnHeat ?? 0) * 0.42, t, 0.5);
      this.s.water.g.gain.setTargetAtTime(clamp01(s.water ?? 0) * 0.30, t, 0.12);
      this.room.g.gain.setTargetAtTime(0, t, 1.5);
    }

    const wv = (this.s ? 0 : om * 0.17);
    const hum = 38 + om * 52;
    this.wheel.g.gain.setTargetAtTime(wv, t, 0.12);
    this.wheel.o1.frequency.setTargetAtTime(hum, t, 0.16);
    this.wheel.o2.frequency.setTargetAtTime(hum * 2, t, 0.16);
    this.wheel.lp.frequency.setTargetAtTime(190 + om * 240, t, 0.2);
    this.wheel.whir.frequency.setTargetAtTime(300 + om * 880, t, 0.18);

    // clay under the hand
    const press = clamp01(s.contact ?? 0);
    const wet = clamp01(s.moisture ?? 0.5);
    const cv = press * om * (0.14 + 0.24 * wet);
    this.clay.g.gain.setTargetAtTime(cv, t, 0.045);
    this.clay.bp.frequency.setTargetAtTime(360 + (1 - wet) * 2200 + om * 500, t, 0.07);
    this.clay.bp.Q.setTargetAtTime(0.6 + (1 - wet) * 1.3, t, 0.1);

    // kiln
    const heat = clamp01(s.kilnHeat ?? 0);
    this.kiln.g.gain.setTargetAtTime(this.s ? 0 : heat * 0.30, t, 0.4);
    this.kiln.lp.frequency.setTargetAtTime(240 + heat * 900, t, 0.5);
    this.kiln.bp.frequency.setTargetAtTime(90 + heat * 190, t, 0.5);

    // music level
    this.musBus.gain.setTargetAtTime(this.volumes.music * (s.musicOn === false ? 0 : 1), t, 1.2);

    // occasional bell
    if (s.musicOn !== false) {
      this._nextBell -= dt;
      if (this._nextBell <= 0) {
        this._nextBell = 7 + Math.random() * 16;
        this.bell(110 * Math.pow(2, PENT[Math.floor(Math.random() * PENT.length)] / 12), 0.16, 5.5);
      }
    }
  }

  /* ---------------- one-shots ---------------- */

  bell(freq, vol = 0.3, dur = 3.2) {
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const car = ctx.createOscillator(); car.type = 'sine'; car.frequency.value = freq;
    const mod = ctx.createOscillator(); mod.type = 'sine'; mod.frequency.value = freq * 2.76;
    const mg = ctx.createGain(); mg.gain.value = freq * 1.9;
    mg.gain.setTargetAtTime(0.001, t, dur * 0.16);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(g).connect(this.musBus);
    car.start(t); mod.start(t);
    car.stop(t + dur + 0.1); mod.stop(t + dur + 0.1);
  }

  click(pitch = 1, vol = 0.16) {
    if (this._shot('click', vol * 3.4, pitch)) return;
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'square';
    o.frequency.setValueAtTime(760 * pitch, t);
    o.frequency.exponentialRampToValueAtTime(240 * pitch, t + 0.045);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2600;
    o.connect(lp).connect(g).connect(this.sfxBus);
    o.start(t); o.stop(t + 0.09);
  }

  splash(vol = 0.3) {
    if (this._shot('splash', vol * 1.5, 0.9 + Math.random() * 0.25)) return;
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const s = ctx.createBufferSource(); s.buffer = this._noiseBuf;
    s.playbackRate.value = 1.4 + Math.random() * 0.5;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1400, t);
    bp.frequency.exponentialRampToValueAtTime(420, t + 0.32);
    bp.Q.value = 0.8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    s.connect(bp).connect(g).connect(this.sfxBus);
    s.start(t); s.stop(t + 0.45);
  }

  thud(vol = 0.5) {
    if (this._shot('thud', vol * 1.3, 0.85 + Math.random() * 0.3)) return;
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.36);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g).connect(this.sfxBus);
    const n = ctx.createBufferSource(); n.buffer = this._noiseBuf;
    const nf = ctx.createBiquadFilter(); nf.type = 'lowpass'; nf.frequency.value = 520;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(vol * 0.7, t);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    n.connect(nf).connect(ng).connect(this.sfxBus);
    o.start(t); o.stop(t + 0.55); n.start(t); n.stop(t + 0.35);
  }

  shatter(vol = 0.55) {
    if (this._shot('shatter', vol * 1.2, 0.9 + Math.random() * 0.2)) return;
    if (!this.ready || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    for (let i = 0; i < 9; i++) {
      const d = i * (0.012 + Math.random() * 0.05);
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.value = 900 + Math.random() * 2800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t + d);
      g.gain.linearRampToValueAtTime(vol * (0.25 + Math.random() * 0.4), t + d + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.16 + Math.random() * 0.3);
      o.connect(g).connect(this.sfxBus);
      o.start(t + d); o.stop(t + d + 0.5);
    }
    this.thud(vol * 0.8);
  }

  chime(good = true) {
    if (this._shot('chime', good ? 0.5 : 0.30, good ? 1 : 0.72)) return;
    if (!this.ready || this.muted) return;
    const base = good ? 440 : 196;
    const seq = good ? [0, 4, 7, 12] : [0, -1, -5];
    seq.forEach((n, i) => {
      setTimeout(() => this.bell(base * Math.pow(2, n / 12), 0.18, good ? 3.4 : 1.6), i * 105);
    });
  }

  /** A pot rung with a knuckle. Pitch tells you if it is sound. */
  ring(pitch = 1, cracked = false) {
    if (!this.ready || this.muted) return;
    if (cracked) { this.thud(0.3); return; }
    this.bell(520 * pitch, 0.24, 2.6);
    setTimeout(() => this.bell(520 * pitch * 2.41, 0.09, 1.4), 8);
  }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : this.volumes.master, this.ctx.currentTime, 0.1);
  }
}
