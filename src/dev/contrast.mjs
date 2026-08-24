// ============================================================
//  Can you read it?
//
//  The interface was built for a dark cockpit and then repainted
//  cream. Colours chosen to GLOW on black do not READ on paper, and
//  the failure is silent: nothing errors, the text is simply not
//  there. --ember at #FF9E4A measured 1.82:1 on the cream plate, and
//  it was the one warning that tells you the firing costs more than
//  you have.
//
//  The invariant checked here is deliberately blunt: any token used
//  anywhere as a text `color` has to be readable on the two colours
//  a panel is ever made of. Tokens that only ever fill a bar, or that
//  are inks for text floating over the 3D room, are listed out — and
//  the list is checked too, so a token cannot be quietly excused by
//  adding it here without also being used that way.
// ============================================================
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../ui/style.css', import.meta.url), 'utf8');

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (hex) => {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c) : h.match(/../g);
  const [r, g, b] = n.map((x) => parseInt(x, 16));
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};
const ratio = (a, b) => {
  const l1 = lum(a), l2 = lum(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};
/** plate with an ink wash over it, as a hex */
const tinted = (plate, ink, a) => {
  const mix = (p, q) => Math.round(q * a + p * (1 - a));
  const h = (x) => x.replace('#', '').match(/../g).map((v) => parseInt(v, 16));
  const [pr, pg, pb] = h(plate), [ir, ig, ib] = h(ink);
  return '#' + [mix(pr, ir), mix(pg, ig), mix(pb, ib)]
    .map((v) => v.toString(16).padStart(2, '0')).join('');
};

// the tokens, straight out of :root
const tokens = {};
for (const [, name, val] of css.matchAll(/--([\w-]+)\s*:\s*(#[0-9a-fA-F]{3,8})\s*;/g)) tokens[name] = val;

// What a panel is made of — and what a panel with something ON it is
// made of. A segmented track, a selected row and a selected tool all lay
// an ink tint over the plate, and type measured against the plate passed
// at 5.0 while the same type over the tint sat at 4.2. The composite is
// a surface too.
const PLATES = ['ash-1', 'ash-2'];
const TINT_ON_PLATE = 0.05;   // the ink wash those sub-surfaces carry

// Tokens that never colour type on a plate at all: the plates
// themselves, their edges, and the inks meant for text floating over
// the 3D room, where the ground is the workshop and not cream.
const NOT_INK = new Set([
  'ash-0', 'ash-1', 'ash-2', 'ash-3', 'ash-4', 'line',
  'on-scene', 'on-scene-dim', 'scrim',
  // --celadon is deliberately NOT excused: it is bright enough to fill a
  // bar and, at 2.97:1 on cream, not quite enough even for a bullet.
  'ember', 'ember-hot',
  'tenmoku', 'oxblood', 'cobalt', 'ok', 'warn',
]);

// Marks, not prose. WCAG asks 3:1 of a graphical object and 4.5:1 of
// text, and on a cream plate you cannot have three distinct ink levels
// that all clear 4.5 and still look like three levels. So the lower bar
// is granted BY SELECTOR, not by token: a ::before glyph is a mark; a
// class that paints words is not. Excusing a whole token instead was
// the bug in the first version of this file — it would have let
// .toast.bad go back to 3.8:1 without a word.
const isMark = (selector) => /::(before|after)/.test(selector);

// WCAG's large-text allowance: 24px, or 18.66px at weight 700+.
const sizeOf = (body) => {
  const shorthand = body.match(/font\s*:\s*(?:(\d+)\s+)?(?:clamp\(([^,]+),[^,]+,[^)]+\)|([\d.]+)px)/);
  if (shorthand) {
    const px = shorthand[3] ? parseFloat(shorthand[3]) : parseFloat(shorthand[2]);
    return { px, weight: shorthand[1] ? parseInt(shorthand[1]) : 400 };
  }
  const fs = body.match(/font-size\s*:\s*(?:clamp\(([^,]+),|([\d.]+)px)/);
  const fw = body.match(/font-weight\s*:\s*(\d+)/);
  return { px: fs ? parseFloat(fs[2] ?? fs[1]) : null, weight: fw ? parseInt(fw[1]) : 400 };
};
const isLarge = ({ px, weight }) => px != null && (px >= 24 || (px >= 18.66 && weight >= 700));

let bad = 0;
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };

console.log('\n  CAN YOU READ IT?\n');

// Every RULE that paints type, with the selector it paints it under.
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)];
const painted = [];
for (const [, selector, body] of rules) {
  for (const [, name] of body.matchAll(/(?:^|[;\s])color\s*:\s*var\(--([\w-]+)\)/g)) {
    painted.push({ selector: selector.trim().replace(/\s+/g, ' '), token: name, font: sizeOf(body) });
  }
}

const seen = new Set();
for (const { selector, token, font } of painted) {
  if (NOT_INK.has(token) || !tokens[token]) continue;
  const need = (isMark(selector) || isLarge(font)) ? 3 : 4.5;
  const grounds = PLATES.flatMap((p) => [
    { name: p, hex: tokens[p] },
    { name: p + '+tint', hex: tinted(tokens[p], tokens.ink, TINT_ON_PLATE) },
  ]);
  for (const g of grounds) {
    const plate = g.name;
    const key = `${token}|${plate}|${need}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const r = ratio(tokens[token], g.hex);
    ok(r >= need, `--${token} ${tokens[token]} on --${plate}: ${r.toFixed(2)}:1` +
                  (need === 3 ? (isMark(selector) ? ' (glyph)' : ' (large)') : '') +
                  `  [${selector.slice(0, 34)}]`);
  }
}

const inked = new Set(painted.map((p) => p.token));

// The excuse list has to be honest, both ways.
const suspicious = [...NOT_INK].filter((n) => tokens[n] && inked.has(n));
ok(suspicious.length === 0,
   `nothing is excused into NOT_INK while still colouring type${suspicious.length ? ': ' + suspicious.join(', ') : ''}`);

// A mark ink is only allowed its lower bar because it marks. `.readout .k`
// is the label ink, and it was wrapping whole sentences — 'More clay means
// you can go bigger, and it costs more to be wrong.' at 4.1:1. A label is
// short and has no full stop in it.
const sources = ['../game/game.js', '../ui/hud.js']
  .map((f) => readFileSync(new URL(f, import.meta.url), 'utf8')).join(String.fromCharCode(10));
const wrapped = [...sources.matchAll(/<span class="k">([\s\S]*?)<\/span>/g)].map((m) => m[1]);
const prose = wrapped.filter((t) => t.length > 26 || /[.!?]/.test(t));
ok(prose.length === 0,
   `the label ink wraps labels, not prose${prose.length ? ': ' + prose.map((p) => JSON.stringify(p.slice(0, 40))).join(', ') : ''}` +
   ` (${wrapped.length} labels checked)`);

// Inline styles bypass the stylesheet entirely, which is exactly where
// the last one of these was hiding: a single <p style="color:var(--celadon)">
// in the how-to-throw screen, at 2.97:1.
const inlineInk = [...sources.matchAll(/style="[^"]*?color:\s*var\(--([\w-]+)\)/g)].map((m) => m[1]);
const inlineBad = inlineInk.filter((n) => tokens[n] && ratio(tokens[n], tokens['ash-1']) < 4.5);
ok(inlineBad.length === 0,
   `inline colours read on a plate${inlineBad.length ? ': ' + inlineBad.map((n) => '--' + n).join(', ') : ''}` +
   ` (${inlineInk.length} inline colour(s) checked)`);


console.log(bad ? `\n  ${bad} FAILED\n` : '\n  every ink reads on a plate\n');
process.exit(bad ? 1 : 0);
