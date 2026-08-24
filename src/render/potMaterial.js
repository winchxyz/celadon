// ============================================================
//  CELADON — the vessel material
//
//  A MeshPhysicalMaterial with its vertex stage replaced by a GPU
//  lathe and its surface stage replaced by a procedural ceramic
//  shader. It has to render four quite different objects:
//
//    wet clay      translucent-ish, dark, satin, with slip and rings
//    leather-hard  matt, lighter, dusty
//    raw glaze     chalky pastel powder, no gloss at all
//    fired glaze   glass: crystals, craze nets, oil spots, runs
//
//  and it also has to glow like a body at 1280 Celsius.
// ============================================================

import * as THREE from 'three';
import { NOISE, BUMP } from './glsl.js';
import { K, RSEG } from './potMesh.js';
import { SLOTS } from '../sim/glaze.js';
import { P } from './palette.js';

export function createPotMaterial(opts = {}) {
  const mat = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    roughness: 0.62,
    metalness: 0.0,
    clearcoat: 0.0,
    clearcoatRoughness: 0.55,
    // Sheen is the one built-in control for a soft velvet rim, and it sat
    // at zero through the whole file. envMapIntensity comes down because
    // a matte body that still mirrors the room is a matte body wrapped
    // in cling film — those were the two hard highlights on the pot.
    // MeshPhysicalMaterial defaults specularIntensity to 1.0, and a
    // default is not a decision. Nothing in this room is allowed a
    // highlight except a fired glaze — the gloss has to be EARNED by
    // being the only gloss in the frame, and applyFireResult turns it
    // back up when the piece comes out of the kiln.
    specularIntensity: 0.05,
    sheen: 0.55,
    sheenColor: new THREE.Color(0xffd2a8),
    sheenRoughness: 0.85,
    // The room has nothing worth reflecting, and a matte body that still
    // mirrors it is a matte body wrapped in cling film. This is the last
    // photographic cue left on the hero object.
    envMapIntensity: 0.22,
    side: THREE.DoubleSide,
    transparent: false,
    ...opts.base,
  });

  const U = {
    uProfile: { value: null },
    uGlaze: { value: null },
    uTime: { value: 0 },
    uK: { value: K },

    uRingFreq: { value: 92.0 },
    uRingSpiral: { value: 2.0 },   // whole turns, or the groove will not close
    uWobbleAmp: { value: 1.0 },

    // body
    uClayGlow: { value: 1.0 },
    uBodyCol: { value: new THREE.Color(P.clay) },
    uBodyCol2: { value: new THREE.Color(P.clayDeep) },
    uGrog: { value: 0.55 },
    uWet: { value: 1.0 },          // 0 dry, 1 sopping
    uSlip: { value: 0.0 },         // fresh slip film
    uBisque: { value: 0.0 },       // 1 after bisque firing
    uVitrified: { value: 0.0 },

    // glaze slots
    uSlotColA: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] },
    uSlotColB: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] },
    uSlotRaw: { value: [new THREE.Color(), new THREE.Color(), new THREE.Color()] },
    // (gloss, opacity, breakK, melt)
    uSlotP: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    // (crystal, craze, metal, opal)
    uSlotQ: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    // (oilspot, hare, carbon, peel)
    uSlotR: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
    // (crawl, blister, hematite, dry)
    uSlotS: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },

    uFired: { value: 0.0 },
    uCrystalScale: { value: 9.0 },
    uCrystalSize: { value: 0.5 },
    uCrazeScale: { value: 46.0 },
    uRunSmear: { value: 0.0 },

    // kiln
    uHeat: { value: 0.0 },         // 0..1 glow strength
    uTemp: { value: 1200.0 },      // Celsius
    uSoot: { value: 0.0 },

    // gameplay overlays
    uStressView: { value: 0.0 },
    uGuide: { value: 0.0 },
    uCursor: { value: new THREE.Vector4(-9, -9, 0, 0) }, // localAngle, arcT, radius(cm), strength
    uArcLen: { value: 24 },                              // meridian length, cm
    uCursorBand: { value: 1 },                           // 1 = ring round the pot
    uOpacity: { value: 1.0 },
  };

  mat.userData.u = U;
  mat.defines = { ...(mat.defines || {}), CEL_SLOTS: SLOTS };

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, U);
    mat.userData.shader = shader;

    /* ================= VERTEX ================= */
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', /* glsl */`
#include <common>
${NOISE}
uniform sampler2D uProfile;
uniform float uK, uTime, uRingFreq, uRingSpiral, uWobbleAmp;
attribute float aSide;
varying float vAng, vArc, vSecT, vSide, vCurv, vMoist, vScar, vStress, vRad, vHgt, vRing;
varying vec3 vLocal;
`)
      .replace('#include <beginnormal_vertex>', /* glsl */`
float vk = uv.y;
vec4 P0 = texture2D(uProfile, vec2(vk, 0.125));   // r, y, nr, ny
vec4 P1 = texture2D(uProfile, vec2(vk, 0.375));   // ox, oz, dox, doz
vec4 P2 = texture2D(uProfile, vec2(vk, 0.625));   // ring, arcT, curv, -
vec4 P3 = texture2D(uProfile, vec2(vk, 0.875));   // moist, scar, stress, secT

float ang  = uv.x * 6.283185307179586;
float ca = cos(ang), sa = sin(ang);

float r = P0.x;
float ringAmp = P2.x;
// Throwing rings: a shallow helical groove left by the fingers.
//
// The winding has to be a WHOLE number of turns or the groove does not
// meet itself. At 2.4 turns the surface at uv.x = 1 was four tenths of a
// turn out of phase with the surface at uv.x = 0, and the pot carried a
// dead straight vertical step down its front — in the radius, in the
// normal, and (through the two bands below) in the albedo and the glaze.
// The second harmonic needs its own integer too: no whole number times
// 2.17 is a whole number, so rounding only the fundamental leaves 38% of
// the groove still jumping.
float angT    = uv.x * 6.2831853;
float base    = P3.w * uRingFreq;
float spiralT = floor(uRingSpiral + 0.5);
float spiral2 = floor(spiralT * 2.17 + 0.5);
float rphase  = base + angT * spiralT;
float rphase2 = base * 2.17 + angT * spiral2 + 1.3;
float ringD = ringAmp * (sin(rphase) * 0.62 + 0.38 * sin(rphase2));
r += ringD * step(aSide, 0.5);
// 0.8246 = 0.38 * 2.17, the chain-rule weight the old 0.76 approximated
float ringSlope = ringAmp * uRingFreq * (cos(rphase) * 0.62 + 0.8246 * cos(rphase2));

vec3 gPos = vec3(r * ca + P1.x * uWobbleAmp, P0.y, r * sa + P1.y * uWobbleAmp);

// meridian normal, revolved, plus the skew introduced by the offset
vec3 nMer = vec3(P0.z * ca, P0.w, P0.z * sa);
vec3 skew = vec3(-P1.z, 0.0, -P1.w) * 0.55;
vec3 gNrm = normalize(nMer + skew * abs(P0.z) + vec3(P0.w*ca, -P0.z, P0.w*sa) * ringSlope * 0.010 * step(aSide,0.5));

vec3 objectNormal = gNrm;

vAng = uv.x; vArc = P2.y; vSecT = P3.w; vSide = aSide;
vCurv = P2.z; vMoist = P3.x; vScar = P3.y; vStress = P3.z;
vRad = r; vHgt = P0.y; vRing = ringAmp;
vLocal = gPos;
`)
      .replace('#include <begin_vertex>', 'vec3 transformed = gPos;');

    /* ================= FRAGMENT ================= */
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', /* glsl */`
#include <common>
${NOISE}
${BUMP}
uniform sampler2D uGlaze;
uniform float uTime, uWet, uSlip, uBisque, uVitrified, uGrog, uRingSpiral;
uniform vec3 uBodyCol, uBodyCol2;
uniform vec3 uSlotColA[CEL_SLOTS], uSlotColB[CEL_SLOTS], uSlotRaw[CEL_SLOTS];
uniform vec4 uSlotP[CEL_SLOTS], uSlotQ[CEL_SLOTS], uSlotR[CEL_SLOTS], uSlotS[CEL_SLOTS];
uniform float uFired, uCrystalScale, uCrystalSize, uCrazeScale, uRunSmear;
uniform float uHeat, uTemp, uSoot, uStressView, uGuide, uOpacity, uClayGlow;
uniform vec4 uCursor;
uniform float uArcLen, uCursorBand;
varying float vAng, vArc, vSecT, vSide, vCurv, vMoist, vScar, vStress, vRad, vHgt, vRing;
varying vec3 vLocal;

struct Surf {
  vec3 albedo;
  float rough;
  float clear;
  float clearRough;
  float metal;
  vec3  emis;
  float bump;
  float irid;
};
`)
      .replace('#include <map_fragment>', /* glsl */`
// ================================================================
//  CERAMIC SURFACE
// ================================================================
vec2 guv = vec2(vAng, vArc);
vec4 G = texture2D(uGlaze, guv);
float wax = G.a;
float gt[CEL_SLOTS];
gt[0] = G.r; gt[1] = G.g; gt[2] = G.b;
float gtot = gt[0] + gt[1] + gt[2];

bool outer = vSide < 0.5;
bool innerS = vSide > 1.5 && vSide < 2.5;

// ---------------- clay body ----------------------------------------
// bp is the master scale for every feature on the clay. At 34 by 46 the
// surface is a fine mineral tooth seen from across a room; a thumb in
// plasticine leaves marks three or four times that size and far fewer of
// them, which is the whole difference between a rock and a material.
vec2 bp = vec2(vAng * 11.0, vArc * 15.0);
float grain  = fbm(bp * 2.4, 5);
float coarse = fbm(bp * 0.55, 3);
// Bigger AND fewer, which is one change, not two. Enlarging bp and
// flattening this exponent at the same time made each fleck four times
// the area and four times as common, and the body came out looking
// mouldy rather than marbled.
float speck  = pow(vnoise(bp * 4.2), 10.0);
// The fleck is LIGHTER than the body, not darker. Its direction matters
// more than its amount: dark grit reads as dirt in the clay, pale grit
// reads as pigment that has not been worked all the way in.
vec3 grogA = mix(uBodyCol, vec3(1.0, 0.94, 0.86), 0.16);
vec3 body = mix(uBodyCol2, uBodyCol, coarse * 0.75 + 0.25 * grain);
body = mix(body, grogA, speck * uGrog * 0.40);
body *= 0.90 + 0.20 * grain;

// throwing rings read as a shading band even where geometry is subtle
// same closed winding as the vertex groove, not a stale copy of it
float rphase = vSecT * 92.0 + vAng * floor(uRingSpiral + 0.5) * 6.2831853;
float ringShade = 1.0 - 0.13 * vRing * 26.0 * (0.5 + 0.5 * sin(rphase));
body *= clamp(ringShade, 0.6, 1.2);

// bisque is paler, drier, more open
body = mix(body, mix(body, vec3(0.79, 0.66, 0.56), 0.55), uBisque);
// tears and drag marks
body = mix(body, body * vec3(0.55, 0.5, 0.5), vScar * 0.8);

Surf S;
S.albedo = body;
S.rough  = mix(0.92, 0.55, uWet * (1.0 - uBisque));
S.clear  = 0.0;
S.clearRough = 0.2;
S.metal  = 0.0;
S.emis   = vec3(0.0);
S.bump   = grain * 0.35 + coarse * 0.5 + speck * 0.8;
S.irid   = 0.0;

// wet clay: a film of slip, darker and shinier, pooling low down
float wetness = uWet * (1.0 - uBisque) * (0.55 + 0.45 * vMoist);
float slipFilm = uSlip * sstep(0.0, 0.35, 1.0 - vArc) ;
// Wet clay is DARKER and duller, not lacquered. The clearcoat was the
// toffee: a film at 0.55 over a roughness heading for 0.13 is a hard
// varnish, and it reads as boiled sugar rather than as something with
// water still in it. Moisture is a live mechanic with its own gauge, so
// the wet look stays visible — it just stops being a mirror.
S.albedo *= mix(1.0, 0.72, wetness * 0.9);
S.rough = mix(S.rough, 0.62, wetness * 0.72);
S.clear = 0.0;   // wet clay is darker and duller, never lacquered
S.albedo = mix(S.albedo, vec3(0.55,0.46,0.40), slipFilm * 0.5);

// leather-hard rim of drier clay near the top
float dryTop = sstep(0.25, 0.9, vSecT) * (1.0 - vMoist);
S.albedo = mix(S.albedo, S.albedo * 1.18 + 0.03, dryTop * 0.5 * (1.0 - uBisque));

// ---------------- glaze --------------------------------------------
if (gtot > 0.002) {
  vec3 gcol = vec3(0.0);
  vec3 gbrk = vec3(0.0);
  vec3 graw = vec3(0.0);
  float gloss = 0.0, opac = 0.0, brk = 0.0, melt = 0.0;
  float crystal = 0.0, craze = 0.0, metal = 0.0, opal = 0.0;
  float oilspot = 0.0, hare = 0.0, carbon = 0.0, peel = 0.0;
  float crawl = 0.0, blister = 0.0, hematite = 0.0, dryG = 0.0;
  float wsum = 0.0;

  for (int i = 0; i < CEL_SLOTS; i++) {
    float t = gt[i];
    if (t <= 0.0015) continue;
    // upper layers cover lower ones once molten
    float w = t;
    gcol += uSlotColA[i] * w; gbrk += uSlotColB[i] * w; graw += uSlotRaw[i] * w;
    gloss += uSlotP[i].x * w; opac += uSlotP[i].y * w; brk += uSlotP[i].z * w; melt += uSlotP[i].w * w;
    crystal += uSlotQ[i].x * w; craze += uSlotQ[i].y * w; metal += uSlotQ[i].z * w; opal += uSlotQ[i].w * w;
    oilspot += uSlotR[i].x * w; hare += uSlotR[i].y * w; carbon += uSlotR[i].z * w; peel += uSlotR[i].w * w;
    crawl += uSlotS[i].x * w; blister += uSlotS[i].y * w; hematite += uSlotS[i].z * w; dryG += uSlotS[i].w * w;
    wsum += w;
  }
  float iw = 1.0 / max(wsum, 1e-4);
  gcol *= iw; gbrk *= iw; graw *= iw;
  gloss *= iw; opac *= iw; brk *= iw; melt *= iw;
  crystal *= iw; craze *= iw; metal *= iw; opal *= iw;
  oilspot *= iw; hare *= iw; carbon *= iw; peel *= iw;
  crawl *= iw; blister *= iw; hematite *= iw; dryG *= iw;

  float thick = clamp(gtot, 0.0, 0.75);
  float cover = sstep(0.004, 0.045, gtot) * (1.0 - wax * 0.94);

  // Glaze pools where the wall is concave and thins over every ridge and
  // edge. This is most of what makes a fired pot look like a fired pot.
  float pool2 = 1.0 + 0.85 * clamp(-vCurv, 0.0, 1.2) - 0.45 * clamp(vCurv, 0.0, 1.2);
  float ringPhase = vSecT * 92.0 + vAng * floor(uRingSpiral + 0.5) * 6.2831853;
  pool2 *= 1.0 + vRing * 12.0 * sin(ringPhase);
  pool2 *= 0.94 + 0.12 * fbm(vec2(vAng * 9.0, vArc * 6.0), 3);
  thick = clamp(thick * clamp(pool2, 0.35, 2.4), 0.0, 0.9);

  // ---- unfired: chalky, matt, opaque powder ----
  vec3 rawCol = graw * (0.9 + 0.2 * fbm(guv * vec2(52.0, 42.0), 3));
  float rawMask = cover * sstep(0.0, 0.02, gtot);

  // ---- fired: glass ----
  // breaking — the glaze thins over ridges and edges, showing a
  // different colour there; it pools thick in the throwing rings
  // Breaking happens only where the coat is genuinely thin: over a
  // ridge, a rim or a sharp change of direction. A full-thickness coat
  // does not break at all, which is why a tenmoku is black in the belly
  // and the colour of a fox on the lip.
  float edge = clamp(vCurv, 0.0, 4.0);
  float thinF = clamp((1.0 - thick / 0.125) * 0.55 + edge * 0.20, 0.0, 1.0)
              * clamp(brk * 0.45, 0.0, 1.25);
  vec3 col = mix(gcol, gbrk, clamp(thinF, 0.0, 0.92));

  // pooling deepens colour in the hollows
  float pool = clamp((thick - 0.10) * 5.0, 0.0, 1.0);
  col *= mix(1.0, 0.78, pool * 0.45);

  // ---- crystals ----
  if (crystal > 0.02) {
    // Crystals need glass to grow in: they nucleate where the coat is
    // thick and stop dead where it thinned out over an edge.
    float feed = sstep(0.045, 0.13, thick);
    float sc = uCrystalScale / max(0.35, 0.45 + uCrystalSize);
    vec2 cp = vec2(vAng * sc * 3.0, vArc * sc * 2.2);
    vec3 cf = crystalFlower(cp, 2.0);
    float m = cf.x * crystal * feed;
    vec3 ccol = mix(vec3(0.90, 0.94, 0.96), gcol * 1.7 + 0.10, 0.55);
    col = mix(col, ccol, clamp(m * 0.92, 0.0, 0.94));
    col += cf.y * m * 0.07;
    S.bump += m * (0.4 + 0.6 * cf.y) * 1.9;
    gloss = mix(gloss, gloss * 0.68, m * 0.55);
  }

  // ---- hare's fur / streaking from the run ----
  if (hare > 0.02) {
    float streak = fbm(vec2(vAng * 150.0, vArc * 7.0), 4);
    float f = sstep(0.58, 0.86, streak) * hare;
    col = mix(col, gbrk * 1.05, f * 0.55);
    S.bump += f * 0.3;
  }

  // ---- oil spots ----
  if (oilspot > 0.02) {
    vec3 w2 = worley(vec2(vAng * 104.0, vArc * 78.0));
    float spot = sstep(0.20, 0.055, w2.x) * step(0.70, w2.z) * oilspot;
    col = mix(col, vec3(0.60, 0.60, 0.56) * (0.7 + 0.5 * w2.z), spot * 0.85);
    metal = max(metal, spot * 0.75);
  }

  // ---- carbon trapping ----
  if (carbon > 0.02) {
    float sm = fbm(vec2(vAng * 7.0, vArc * 4.0), 4);
    float f = sstep(0.44, 0.68, sm) * carbon;
    col = mix(col, vec3(0.20, 0.19, 0.20), f * 0.85);
  }

  // ---- orange peel from salt vapour ----
  if (peel > 0.02) {
    vec3 w3 = worley(vec2(vAng * 130.0, vArc * 96.0));
    float p = (1.0 - w3.x) * peel;
    S.bump += p * 1.5;
    gloss = mix(gloss, gloss * 0.82, peel * 0.5);
  }

  // ---- crawling: the glaze pulls back off the wall ----
  if (crawl > 0.05) {
    vec3 w4 = worley(vec2(vAng * 26.0, vArc * 20.0));
    float bare = sstep(0.34, 0.16, w4.x) * crawl;
    cover *= 1.0 - bare * 0.95;
  }

  // ---- blistering ----
  if (blister > 0.05) {
    vec3 w5 = worley(vec2(vAng * 84.0, vArc * 64.0));
    float b = sstep(0.26, 0.06, w5.x) * blister;
    S.bump += b * 2.4;
    col = mix(col, col * 0.6, b * 0.6);
    gloss *= 1.0 - b * 0.5;
  }

  // ---- iron hematite crystals on cooling ----
  if (hematite > 0.05) {
    float h = fbm(vec2(vAng * 90.0, vArc * 70.0), 4);
    float f = sstep(0.55, 0.8, h) * hematite;
    col = mix(col, vec3(0.55, 0.20, 0.07), f * 0.7);
    metal = max(metal, f * 0.35);
  }

  // ---- opalescence: short wavelengths scatter out of suspension ----
  float opalF = 0.0;
  if (opal > 0.02) {
    opalF = opal * pow(1.0 - abs(dot(normalize(vViewPosition), vec3(0.0,0.0,1.0))), 1.0);
  }

  // ---- crazing ----
  float crazeLine = 0.0;
  if (craze > 0.02) {
    vec3 w6 = worley(vec2(vAng * uCrazeScale, vArc * uCrazeScale * 0.82));
    float e = 1.0 - sstep(0.0, 0.045, w6.y - w6.x);
    crazeLine = e * sstep(0.06, 0.4, craze);
    vec3 w7 = worley(vec2(vAng * uCrazeScale * 2.6 + 11.0, vArc * uCrazeScale * 2.1));
    crazeLine = max(crazeLine, (1.0 - sstep(0.0, 0.03, w7.y - w7.x)) * sstep(0.45, 0.9, craze));
    col = mix(col, col * 0.42, crazeLine * 0.8);
    S.bump -= crazeLine * 0.9;
  }

  // ---- dry / underfired surfaces are rough and dusty ----
  col = mix(col, col * 0.86 + 0.06, dryG * 0.6);

  vec3 firedCol = col;
  float firedRough = clamp(mix(0.85, 0.055, gloss) + dryG * 0.5, 0.02, 1.0);

  // ---- optical depth -------------------------------------------------
  // A transparent glaze is a sheet of coloured glass sitting on a pale
  // body. Beer-Lambert through it: thin coats stay pale, thick coats go
  // deep, and that single fact is why celadon looks like celadon.
  float od = clamp(thick * 30.0, 0.0, 7.0);
  vec3 absorb = clamp(vec3(1.0) - firedCol, 0.02, 1.0);
  vec3 tint = exp(-absorb * od * 0.62);
  vec3 transCol = S.albedo * tint * 1.25 + firedCol * (1.0 - tint) * 0.30;
  float op = clamp(opac * 1.15 + (1.0 - melt) * 0.45, 0.0, 1.0);
  vec3 through = mix(transCol, firedCol, op);

  vec3 glazeAlbedo = mix(rawCol, through, uFired);
  float glazeRough = mix(0.96, firedRough, uFired);

  // the melt leaves a faint swell across the surface
  S.bump += (fbm(vec2(vAng * 26.0, vArc * 19.0), 3) - 0.5) * melt * 0.9;

  float mixAmt = cover;
  S.albedo = mix(S.albedo, glazeAlbedo, mixAmt);
  S.rough  = mix(S.rough, glazeRough, mixAmt);
  S.clear  = mix(S.clear, uFired * melt * (0.35 + 0.6 * gloss) * (1.0 - dryG), mixAmt);
  S.clearRough = mix(0.06, 0.3, dryG);
  S.metal  = mix(S.metal, metal * uFired, mixAmt);
  S.irid   = metal * uFired * mixAmt;

  // opal glow and craze already folded into colour
  S.albedo += vec3(0.24, 0.36, 0.52) * opalF * mixAmt * uFired * 0.5;
}

// ---------------- vitrified bare body ------------------------------
S.rough = mix(S.rough, S.rough * 0.72, uVitrified * 0.5);

// ---------------- soot from the firebox ----------------------------
if (uSoot > 0.01) {
  float s = fbm(vec2(vAng * 5.0, vArc * 3.0), 3);
  S.albedo = mix(S.albedo, vec3(0.13,0.12,0.12), uSoot * sstep(0.4, 0.75, s) * 0.7);
}

// ---------------- incandescence ------------------------------------
if (uHeat > 0.001) {
  vec3 bb = blackbody(uTemp + 273.0);
  // 4.0 was tuned against the old broken curve, which returned pure red
  // and so had to be driven hard to read as heat at all. With a correct
  // curve that much emissive lands far up the tone curve's shoulder,
  // where it desaturates to white: the pot became a featureless bright
  // blob with a bloom halo and you could not see its shape at the one
  // moment you most want to.
  float e = pow(uHeat, 2.1) * 2.5;
  // the interior traps radiation and glows brighter
  e *= innerS ? 1.7 : 1.0;
  S.emis += bb * e;
  S.albedo = mix(S.albedo, S.albedo * 0.55 + 0.12, uHeat * 0.5);
  S.rough = mix(S.rough, 0.3, uHeat * 0.4);
}

// ---------------- stress overlay (throwing HUD) ---------------------
if (uStressView > 0.01) {
  float s = clamp(vStress * 1.55, 0.0, 1.0);
  vec3 warn = mix(vec3(0.15,0.7,0.55), vec3(1.0,0.25,0.16), sstep(0.35,0.95,s));
  float band = sstep(0.30, 0.95, s);
  S.albedo = mix(S.albedo, warn, band * uStressView * 0.62);
  S.emis += warn * band * uStressView * 0.35;
}

// ---------------- tool cursor ring ---------------------------------
{
  // Measured in centimetres ON THE CLAY, so it keeps its size wherever
  // it lands rather than swelling near the rim and shrinking at the foot.
  //
  // While throwing it is a BAND right round the pot, not a spot. The
  // wheel is turning: a hand held against it touches every part of that
  // ring, so a mark on one side of the pot was telling the player
  // something that was not true — and worse, it had to pick a side, so
  // it jumped across the pot as the cursor crossed the middle. A band
  // has no side to pick. Glazing keeps the spot, because there the pot
  // is standing still and you really are painting one patch of it.
  float dbCm = abs(vArc - uCursor.y) * uArcLen;
  float daCm = abs(fract(vAng - uCursor.x + 0.5) - 0.5) * 6.2831853 * max(vRad, 0.25);
  float d = (uCursorBand > 0.5 ? dbCm : length(vec2(daCm, dbCm))) / max(uCursor.z, 1e-3);
  float ring = sstep(1.02, 0.90, d) * sstep(0.60, 0.80, d);
  // Quietly. It marks where your hand is; it is not meant to be the
  // brightest thing in the room, and anything emissive here also feeds
  // the bloom, which is what made it glare over the clay it was
  // supposed to be pointing at.
  S.emis += vec3(0.30, 0.78, 0.72) * ring * 0.34 * uCursor.w;
}

// ---------------- light that goes IN and comes back out ------------
//
// The one optical fact that separates plasticine from stone: light
// enters a millimetre or two, picks up pigment, and leaves again. Faked
// by feeding the clay's OWN albedo back as emission, so it always
// carries whatever body is loaded and never needs a second palette.
//
// Kept deliberately weak and deliberately blunt. A sharp exponent puts
// a bright line around the silhouette, which is a rim light, not
// translucency — the thing being described happens across the whole
// form, most visibly where it turns away. Off once the piece is fired,
// because glass is not wax.
{
  float wrap = 1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition)));
  S.emis += S.albedo * uClayGlow * (0.030 + 0.055 * pow(wrap, 1.5))
          * (1.0 - uHeat) * (1.0 - uFired * 0.85);
}


// ---------------- the rim ------------------------------------------
//
// The one thing that turns an object in a room into the subject of a
// picture. The pot stands against a wall two values away from it and
// the silhouette simply dissolved; this puts a warm edge exactly where
// the form turns away, and only on the side the light is on, so it
// reads as light wrapping round a solid and not as an outline drawn
// on top.
//
// It is deliberately not the translucency above. That is soft and
// everywhere; this is sharp and one-sided, and the frame needs both.
{
  vec3 rN = normalize(vNormal);
  vec3 rV = normalize(vViewPosition);
  float fres = pow(1.0 - clamp(dot(rN, rV), 0.0, 1.0), 3.4);
  // view space: up, and a little behind the shoulder
  float side = clamp(dot(rN, normalize(vec3(-0.40, 0.80, -0.45))), 0.0, 1.0);
  S.emis += vec3(1.00, 0.80, 0.56) * fres * side * 0.42 * (1.0 - uHeat);
}

diffuseColor.rgb = S.albedo;
diffuseColor.a *= uOpacity;
float celRough = S.rough;
float celMetal = S.metal;
float celClear = S.clear;
float celClearR = S.clearRough;
vec3  celEmis = S.emis;
float celBump = S.bump;
float celIrid = S.irid;
`)
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = clamp(celRough, 0.015, 1.0);')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = clamp(celMetal, 0.0, 1.0);')
      .replace('#include <normal_fragment_maps>', /* glsl */`
normal = bumpNormal(normal, -vViewPosition, celBump * 0.012, 1.0);
`)
      .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance += celEmis;')
      // ---- how light lands on something soft ----------------------
      //
      // Lambert puts a hard terminator on a curve: light on one side of
      // it, nothing on the other. That edge is the single biggest cue
      // that a surface is hard. Light entering clay travels a millimetre
      // or two and comes back out, so the falloff is long and the far
      // side of it glows warm rather than going black.
      //
      // w = 0.55 is the clay range. 0.3 is barely visible; 1.0 is full
      // half-lambert and goes plasticky.
      .replace(
        'float dotNL = saturate( dot( geometryNormal, directLight.direction ) );',
        [
          'float rawNL = dot( geometryNormal, directLight.direction );',
          'const float clayWrap = 0.55;',
          'float dotNL = saturate((rawNL + clayWrap) / ((1.0 + clayWrap) * (1.0 + clayWrap)));',
        ].join(String.fromCharCode(10))
      )
      .replace(
        'vec3 irradiance = dotNL * directLight.color;',
        [
          'vec3 irradiance = dotNL * directLight.color;',
          '// the energy living past the true terminator is light that went',
          '// through the clay, so it arrives carrying the pigment with it',
          'irradiance *= mix(vec3(1.0), vec3(1.0, 0.62, 0.42), smoothstep(0.25, -0.35, rawNL));',
        ].join(String.fromCharCode(10))
      );

    // clearcoat is only compiled in when the material has it enabled;
    // patch it defensively.
    if (shader.fragmentShader.includes('material.clearcoat =')) {
      shader.fragmentShader = shader.fragmentShader.replace(
        /material\.clearcoat = clearcoat;/,
        'material.clearcoat = clamp(celClear, 0.0, 1.0);'
      ).replace(
        /material\.clearcoatRoughness = clearcoatRoughness;/,
        'material.clearcoatRoughness = clamp(celClearR, 0.02, 1.0);'
      );
    }
  };

  // force clearcoat + iridescence code paths to compile
  mat.clearcoat = 1.0;
  mat.clearcoatRoughness = 0.1;

  return mat;
}

/* ------------------------------------------------------------------ */
/*  Pushing a fired result into the uniforms                           */
/* ------------------------------------------------------------------ */

export function applyFireResult(mat, result, glazes) {
  const U = mat.userData.u;
  // The one object in the game allowed to shine, and only once it has
  // been through the fire. Everything else in the room was stripped of
  // its highlight so that this one means something.
  const glazed = !!result && (result.slots ?? []).some((s) => s.melt > 0.35);
  mat.specularIntensity = glazed ? 1.0 : 0.05;
  mat.clearcoat = glazed ? 0.85 : 0.0;
  mat.envMapIntensity = glazed ? 1.1 : 0.22;
  mat.sheen = glazed ? 0.15 : 0.55;
  mat.needsUpdate = true;
  U.uCrystalSize.value = result?.crystalSize ?? 0.5;
  for (let i = 0; i < SLOTS; i++) {
    const g = glazes[i];
    const slot = result?.slots?.find((s) => s.id === g?.id);
    const cA = U.uSlotColA.value[i], cB = U.uSlotColB.value[i], cR = U.uSlotRaw.value[i];
    if (!g) {
      cA.setRGB(0.5, 0.5, 0.5); cB.setRGB(0.5, 0.5, 0.5); cR.setRGB(0.5, 0.5, 0.5);
      U.uSlotP.value[i].set(0, 0, 0, 0);
      U.uSlotQ.value[i].set(0, 0, 0, 0);
      U.uSlotR.value[i].set(0, 0, 0, 0);
      U.uSlotS.value[i].set(0, 0, 0, 0);
      continue;
    }
    // raw (unfired) colour: chalky, desaturated, pale
    const raw = new THREE.Color(g.swatch);
    const hsl = { h: 0, s: 0, l: 0 };
    raw.getHSL(hsl);
    cR.setHSL(hsl.h, hsl.s * 0.42, Math.min(0.92, hsl.l * 0.55 + 0.46));

    if (slot) {
      cA.setRGB(slot.colA[0], slot.colA[1], slot.colA[2]).convertSRGBToLinear();
      cB.setRGB(slot.colB[0], slot.colB[1], slot.colB[2]).convertSRGBToLinear();
      U.uSlotP.value[i].set(slot.gloss, slot.opac, slot.breakK, slot.melt);
      U.uSlotQ.value[i].set(slot.crystal, slot.craze, slot.metal, slot.opal);
      U.uSlotR.value[i].set(slot.oilspot, slot.hare, slot.carbon, slot.peel);
      U.uSlotS.value[i].set(slot.crawl || 0, slot.blister || 0, slot.hematite || 0, slot.dry || 0);
    } else {
      cA.set(g.ox).convertSRGBToLinear();
      cB.set(g.breakCol).convertSRGBToLinear();
      U.uSlotP.value[i].set(g.gloss ?? 0.9, g.opac ?? 0.3, g.breakK ?? 1, 0);
      U.uSlotQ.value[i].set(0, 0, 0, 0);
      U.uSlotR.value[i].set(0, 0, 0, 0);
      U.uSlotS.value[i].set(0, 0, 0, 0);
    }
  }
}
