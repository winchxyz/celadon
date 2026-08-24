// ============================================================
//  Is the pot the same temperature as the kiln it is in?
//
//  Incandescence is computed twice in this project and it has to be
//  computed the same way both times: studio.js lights the kiln with
//  blackbodyRGB() from core/util.js, and the pot glows inside it with
//  blackbody() in render/glsl.js. Nothing connects them, so they drifted
//  — the GLSL fit clamped green to zero for every temperature below
//  about 1150 C, so the kiln glowed orange while the pot inside it
//  glowed pure red, which the tone curve's desaturation shoulder then
//  turned salmon pink.
//
//  This reads the real coefficients back out of the shader source and
//  evaluates the real curve, so editing one and not the other fails
//  here rather than in a screenshot nobody takes.
// ============================================================
import { readFileSync } from 'node:fs';
import { blackbodyRGB } from '../core/util.js';

const src = readFileSync(new URL('../render/glsl.js', import.meta.url), 'utf8');
const fn = src.slice(src.indexOf('vec3 blackbody('));
const body = fn.slice(0, fn.indexOf('\n}') + 2);

let bad = 0;
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };

console.log('\n  IS THE POT THE SAME TEMPERATURE AS THE KILN?\n');

// pull the constants the shader actually uses
const nums = (body.match(/-?\d+\.\d+/g) ?? []).map(Number);
const want = [
  1000.0, 12000.0, 100.0, 66.0, 255.0, 329.698727446, 60.0, -0.1332047592,
  66.0, 99.4708025861, 161.1195681661, 288.1221695283, 60.0, -0.0755148492,
  66.0, 255.0, 19.0, 138.5177312231, 10.0, 305.0447927307, 255.0,
];
ok(want.every((w) => nums.includes(w)),
   `the shader carries the same coefficients as blackbodyRGB (${nums.length} constants)`);

// evaluate the shader's curve for real, by translating the handful of
// GLSL constructs it uses — the maths is identical in JS
const glsl = new Function('T', `
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const log = Math.log, pow = Math.pow;
  ${body
    .replace('vec3 blackbody(float T){', '')
    .replace(/\bfloat\b/g, 'let')
    .replace(/return clamp\(vec3\(r, g, b\) \/ 255\.0, 0\.0, 1\.0\);\s*}\s*$/,
             'return [r, g, b].map((v) => clamp(v / 255, 0, 1));')}
`);

let worst = 0, worstAt = null;
for (let C = 400; C <= 1400; C += 5) {
  const K = C + 273;
  const a = blackbodyRGB(K), b = glsl(K);
  for (let i = 0; i < 3; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > worst) { worst = d; worstAt = C; }
  }
}
ok(worst < 0.002,
   `the two curves agree across 400-1400 C — worst channel gap ${worst.toFixed(4)}` +
   (worstAt !== null && worst >= 0.002 ? ` at ${worstAt} C` : ''));

// and the thing that actually went wrong: orange, not red
const hot = glsl(1069 + 273);
ok(hot[1] > 0.30,
   `a pot at 1069 C glows orange, not red — green channel ${hot[1].toFixed(3)}` +
   (hot[1] <= 0.30 ? ' (clamped: it will read as red, then pink through the tone curve)' : ''));

console.log(bad ? `\n  ${bad} FAILED\n` : '\n  one fire, one colour\n');
process.exit(bad ? 1 : 0);
