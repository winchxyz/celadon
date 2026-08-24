// ============================================================
//  Small numeric helpers shared across the whole game.
// ============================================================

export const TAU = Math.PI * 2;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const mix = lerp;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return t * t * (3 - 2 * t);
};
export const smootherstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0 || 1e-9));
  return t * t * t * (t * (t * 6 - 15) + 10);
};
export const remap = (v, a, b, c, d) => c + ((v - a) / (b - a || 1e-9)) * (d - c);

/** Frame-rate independent exponential approach. */
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));

export const deg = (r) => (r * 180) / Math.PI;
export const rad = (d) => (d * Math.PI) / 180;

/* ---------------- deterministic RNG (mulberry32) ---------------- */
export function makeRng(seed = 1) {
  let a = seed >>> 0;
  const f = () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  f.range = (lo, hi) => lo + f() * (hi - lo);
  f.int = (lo, hi) => Math.floor(lo + f() * (hi - lo + 1));
  f.pick = (arr) => arr[Math.floor(f() * arr.length) % arr.length];
  f.gauss = () => {
    // Box-Muller, one sample
    let u = 0, v = 0;
    while (u === 0) u = f();
    while (v === 0) v = f();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  f.chance = (p) => f() < p;
  return f;
}

export const hashStr = (s) => {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/* ---------------- value noise (1D / 2D, tileable in x) ---------------- */
function fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }

export function makeNoise2(seed = 7) {
  const P = new Uint8Array(512);
  const r = makeRng(seed);
  const perm = new Uint8Array(256);
  for (let i = 0; i < 256; i++) perm[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = r.int(0, i);
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  for (let i = 0; i < 512; i++) P[i] = perm[i & 255];

  const grad = (h, x, y) => {
    switch (h & 7) {
      case 0: return x + y; case 1: return -x + y; case 2: return x - y; case 3: return -x - y;
      case 4: return x * 1.414; case 5: return -x * 1.414; case 6: return y * 1.414; default: return -y * 1.414;
    }
  };

  // Optional period, in lattice cells. Zero means "don't wrap".
  //
  // Every surface in the workshop is a small tile repeated across a big
  // plane, and this noise did not wrap — so each repeat met its
  // neighbour at a hard discontinuity and the floor came out ruled into
  // a grid. Wrapping the lattice index costs nothing and makes the tile
  // genuinely seamless; the alternative (blending four shifted copies)
  // costs four times the generation and a second of boot.
  let PX = 0, PY = 0;
  const wrap = (i, p) => (p > 0 ? ((i % p) + p) % p : i);

  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const X = wrap(xi, PX) & 255, Y = wrap(yi, PY) & 255;
    const X1 = wrap(xi + 1, PX) & 255, Y1 = wrap(yi + 1, PY) & 255;
    const xf = x - xi, yf = y - yi;
    const u = fade(xf), v = fade(yf);
    const aa = P[P[X] + Y], ab = P[P[X] + Y1];
    const ba = P[P[X1] + Y], bb = P[P[X1] + Y1];
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 0.7;
  };

  /**
   * Make the next samples wrap every `p` lattice cells (0 to stop).
   * The caller is sampling over [0,1), so `p` is also the number of
   * features across the tile, and it has to be a whole number or the
   * tile does not close.
   */
  noise.tile = (p) => { PX = PY = Math.max(0, Math.round(p)); };

  noise.fbm = (x, y, oct = 4, lac = 2.0, gain = 0.5) => {
    const p0 = PX;
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) {
      // each octave is a finer lattice, so its period scales with it
      if (p0 > 0) noise.tile(p0 * f);
      s += a * noise(x * f, y * f); n += a; a *= gain; f *= lac;
    }
    if (p0 > 0) noise.tile(p0);
    return s / n;
  };
  noise.ridged = (x, y, oct = 4) => {
    let a = 0.5, f = 1, s = 0, n = 0;
    for (let i = 0; i < oct; i++) { s += a * (1 - Math.abs(noise(x * f, y * f))) * 2 - a; n += a; a *= 0.5; f *= 2; }
    return s / n;
  };
  return noise;
}

/* ---------------- array helpers ---------------- */

/** In-place separable blur of a Float32Array with reflecting edges. */
export function blur1(arr, radius = 1, passes = 1, tmp = null) {
  const n = arr.length;
  const t = tmp || new Float32Array(n);
  for (let p = 0; p < passes; p++) {
    for (let i = 0; i < n; i++) {
      let s = 0, c = 0;
      for (let k = -radius; k <= radius; k++) {
        let j = i + k;
        if (j < 0) j = -j;
        if (j >= n) j = 2 * n - 2 - j;
        if (j < 0) j = 0;
        s += arr[j]; c++;
      }
      t[i] = s / c;
    }
    arr.set(t);
  }
  return arr;
}

/** Gaussian weight for tool falloff. */
export const gauss = (d, sigma) => Math.exp((-d * d) / (2 * sigma * sigma));

/* ---------------- colour ---------------- */

/** Planckian locus approximation -> linear RGB, for kiln glow. T in Kelvin. */
export function blackbodyRGB(T) {
  T = clamp(T, 1000, 12000);
  const t = T / 100;
  let r, g, b;
  if (t <= 66) r = 255;
  else r = 329.698727446 * Math.pow(t - 60, -0.1332047592);
  if (t <= 66) g = 99.4708025861 * Math.log(t) - 161.1195681661;
  else g = 288.1221695283 * Math.pow(t - 60, -0.0755148492);
  if (t >= 66) b = 255;
  else if (t <= 19) b = 0;
  else b = 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  return [clamp(r, 0, 255) / 255, clamp(g, 0, 255) / 255, clamp(b, 0, 255) / 255];
}

export function hexToRgb(h) {
  const n = parseInt(h.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
export function rgbToHex(r, g, b) {
  const c = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}
/** Perceptual-ish blend in sRGB with gamma awareness. */
export function blendRgb(a, b, t) {
  return [
    Math.sqrt(lerp(a[0] * a[0], b[0] * b[0], t)),
    Math.sqrt(lerp(a[1] * a[1], b[1] * b[1], t)),
    Math.sqrt(lerp(a[2] * a[2], b[2] * b[2], t)),
  ];
}

/* ---------------- formatting ---------------- */
export const fmt = (v, d = 1) => (Math.round(v * 10 ** d) / 10 ** d).toFixed(d);
export const pct = (v) => `${Math.round(clamp01(v) * 100)}`;
export const roman = (n) => {
  const m = [[1000,'M'],[900,'CM'],[500,'D'],[400,'CD'],[100,'C'],[90,'XC'],[50,'L'],[40,'XL'],[10,'X'],[9,'IX'],[5,'V'],[4,'IV'],[1,'I']];
  let s = '';
  for (const [v, sym] of m) while (n >= v) { s += sym; n -= v; }
  return s || 'O';
};
