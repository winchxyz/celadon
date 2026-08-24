// ============================================================
//  Does the pot close on itself?
//
//  The clay is revolved in the vertex shader from uv.x, so uv.x = 0 and
//  uv.x = 1 are the SAME place on the pot. Every term that uses uv.x (or
//  its varying, vAng) as an angle has to come back to where it started,
//  or the piece carries a dead straight vertical line down its front.
//
//  It shipped with one. uRingSpiral was 2.4, so the throwing groove
//  arrived four tenths of a turn out of phase with itself; and the
//  fragment shader had the same 2.4 turns baked in twice as the literal
//  15.08, so the seam existed independently in the radius, in the normal,
//  in the clay albedo and in the glaze thickness.
//
//  Read as text on purpose: this is a claim about what the shader SOURCE
//  says, it needs no GL context, and it is the sort of thing that comes
//  back the next time somebody nudges a number for the look of it.
// ============================================================
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../render/potMaterial.js', import.meta.url), 'utf8');
let bad = 0;
const ok = (cond, msg) => { console.log(`   ${cond ? 'ok  ' : 'FAIL'}  ${msg}`); if (!cond) bad++; };

console.log('\n  DOES THE POT CLOSE ON ITSELF?\n');

const spiral = Number((src.match(/uRingSpiral:\s*\{\s*value:\s*([\d.]+)/) ?? [])[1]);
ok(Number.isInteger(spiral), `uRingSpiral is a whole number of turns (${spiral})`);

ok(!src.includes('15.08'),
   'no hardcoded 15.08 winding survives (that literal was 2.4 turns, written twice)');

// Every SINUSOIDAL band driven by the angle has to wind on the rounded
// uniform. A bare number there is a copy of it that will drift.
//
// Only sinusoids: `fbm(vec2(vAng * 11.0, ...))` is a noise DOMAIN, not a
// winding, and an integer there guarantees nothing — closing that would
// take a periodic noise, not a rounder number. Measured on the shipped
// build, those leave a worst column-to-column step of 2.3 luminance units
// out of 255 against a typical 0.13, i.e. under one percent and invisible;
// the ring groove, before it was quantised, modulated albedo by up to 34%.
// That is the difference between the seam that showed and the ones that
// do not.
const phases = [...src.matchAll(/float\s+(\w*[Pp]hase\w*)\s*=\s*([^;]+);/g)];
const angular = phases.filter(([, , body]) => body.includes('vAng'));
const drifting = angular.filter(([, name, body]) => !/floor\(\s*uRingSpiral/.test(body));
ok(angular.length > 0, `found ${angular.length} angular sinusoid phase(s) to check`);
ok(drifting.length === 0,
   'every angular sinusoid phase winds on floor(uRingSpiral+0.5)' +
   (drifting.length ? ` — drifting: ${drifting.map((d) => d[1]).join(', ')}` : ''));

// The harmonic needs its OWN integer: no whole number times 2.17 is whole,
// so rounding only the fundamental leaves 38% of the groove still jumping.
ok(/spiral2\s*=\s*floor\(/.test(src),
   'the 2.17 harmonic is quantised separately, not left riding the fundamental');

console.log(bad ? `\n  ${bad} FAILED — the pot has a seam again\n` : '\n  the seam is closed\n');
process.exit(bad ? 1 : 0);
