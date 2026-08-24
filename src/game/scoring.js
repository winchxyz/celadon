// ============================================================
//  CELADON — appraisal
//
//  Five marks out of a hundred. Form is the silhouette against the
//  archetype; Craft is what the hand did; Surface is the glazing;
//  Fire is what the kiln gave back; Brief is whether you made the
//  thing that was actually asked for.
// ============================================================

import { clamp, clamp01, lerp, smoothstep, roman } from '../core/util.js';
import { NS } from '../sim/clay.js';
import { proportions } from '../render/potMesh.js';
import { FORMS } from './lore.js';

const GRADES = [
  { at: 96, g: 'I', name: 'Kiln-Blessed' },
  { at: 89, g: 'II', name: 'Exceptional' },
  { at: 80, g: 'III', name: 'Fine' },
  { at: 70, g: 'IV', name: 'Sound' },
  { at: 59, g: 'V', name: 'Serviceable' },
  { at: 46, g: 'VI', name: 'Passable' },
  { at: 32, g: 'VII', name: 'Poor' },
  { at: 16, g: 'VIII', name: 'Seconds' },
  { at: 0, g: 'IX', name: 'Shard' },
];

export function gradeFor(score) {
  for (const g of GRADES) if (score >= g.at) return g;
  return GRADES[GRADES.length - 1];
}

/** Sample the outer silhouette, normalised, for comparison with an archetype. */
export function silhouetteProfile(clay, n = 28) {
  const f = clay.floorSection();
  const out = new Float32Array(n);
  let maxR = 0;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const s = Math.min(NS - 1, Math.max(f, Math.floor(f + t * (NS - 1 - f))));
    out[i] = clay.ro[s];
    if (out[i] > maxR) maxR = out[i];
  }
  if (maxR > 1e-4) for (let i = 0; i < n; i++) out[i] /= maxR;
  return { p: out, maxR };
}

/* ------------------------------------------------------------------ */

/**
 * What a commission actually pays, as a multiple of its fee.
 *
 * Exported so the economy bench can weigh the books with the same
 * arithmetic the game pays out with, rather than a copy of it that can
 * drift.
 */
export function payMultiplier(total, briefOk) {
  return clamp(0.25 + (total / 100) ** 1.5 * 1.5, 0, 1.75) * (briefOk ? 1.15 : 0.7);
}

export function appraise(ctx) {
  const { clay, commission, glazeStats, fireResult, telemetry, schedule } = ctx;
  const req = commission?.require ?? {};
  const notes = [];
  const met = {};

  const m = clay.metrics();
  const prop = proportions(clay);
  const form = FORMS[req.form] ?? FORMS.jar;

  /* ---------------- FORM ---------------- */
  const { p: sil } = silhouetteProfile(clay, 28);
  let err = 0;
  for (let i = 0; i < 28; i++) {
    const t = i / 27;
    const target = clamp(form.profile(t), 0.05, 1.25);
    err += (sil[i] - target) ** 2;
  }
  err = Math.sqrt(err / 28);
  const shapeScore = clamp01(1 - err / (form.tol ?? 0.26));

  const ratio = m.height / Math.max(0.6, m.diameter);
  const ratioErr = Math.abs(ratio - form.ratio) / Math.max(0.25, form.ratio * 0.55);
  const ratioScore = clamp01(1 - ratioErr);

  const formScore = 100 * (0.52 * shapeScore + 0.28 * ratioScore + 0.20 * prop.grace);

  if (shapeScore > 0.82) notes.push({ good: 1, t: `The silhouette reads unmistakably as a ${form.name.toLowerCase()}.` });
  else if (shapeScore < 0.4) notes.push({ bad: 1, t: `It is not really a ${form.name.toLowerCase()}. The curve goes somewhere else.` });
  if (prop.grace < 0.35) notes.push({ bad: 1, t: 'The profile has kinks in it — the hand moved in steps, not in one pass.' });
  else if (prop.grace > 0.85) notes.push({ good: 1, t: 'One continuous curve from foot to lip. No hesitation anywhere in it.' });
  if (ratioScore < 0.35) {
    notes.push({ bad: 1, t: ratio > form.ratio ? 'Too tall for what it is.' : 'Too squat for what it is.' });
  }

  /* ---------------- CRAFT ---------------- */
  const thin = clamp01(smoothstep(0.85, 0.24, m.meanWall));
  const even = m.wallEven;
  const trueN = m.trueness;
  let scarSum = 0;
  for (let i = 0; i < NS; i++) scarSum += clay.scar[i];
  const scars = clamp01(1 - (scarSum / NS) * 2.6);
  const craftScore = 100 * clamp01(0.30 * thin + 0.30 * even + 0.24 * trueN + 0.16 * scars);

  if (m.meanWall < 0.34 && even > 0.6) notes.push({ good: 1, t: `A mean wall of ${m.meanWall.toFixed(2)} cm, held even. That is real throwing.` });
  if (m.meanWall > 0.75) notes.push({ bad: 1, t: 'Heavy. There is a lot of clay in there doing no work.' });
  if (even < 0.35) notes.push({ bad: 1, t: 'The wall is thick at the bottom and thin at the top. The lift never got under it.' });
  if (trueN < 0.55) notes.push({ bad: 1, t: 'It runs out of true. You can see the rim move when you turn it.' });
  else if (trueN > 0.93) notes.push({ good: 1, t: 'Dead true. Set it spinning and the rim does not move at all.' });
  if (scars < 0.5) notes.push({ bad: 1, t: 'Torn and dragged in places — the clay went dry under the hand.' });

  /* ---------------- SURFACE ---------------- */
  const gs = glazeStats ?? { totalCoverage: 0, evenness: 0, footClean: 1, meanThick: [0, 0, 0] };
  const cover = clamp01(gs.totalCoverage / 0.86);
  const evenGl = gs.evenness ?? 0;
  const foot = gs.footClean ?? 1;
  const thickOk = clamp01(1 - Math.abs(Math.max(...(gs.meanThick || [0])) - 0.13) / 0.16);
  const surfaceScore = 100 * clamp01(0.34 * cover + 0.28 * evenGl + 0.22 * thickOk + 0.16 * foot);

  if (cover < 0.4) notes.push({ bad: 1, t: 'Large areas went into the kiln bare.' });
  if (foot < 0.45) notes.push({ bad: 1, t: 'The foot was not wiped clean. That is how shelves get destroyed.' });
  else if (foot > 0.92 && cover > 0.6) notes.push({ good: 1, t: 'Glaze right down to a cleanly wiped foot ring.' });
  if (evenGl > 0.8 && cover > 0.6) notes.push({ good: 1, t: 'An even coat all the way round. Dipped in one motion, by the look of it.' });

  /* ---------------- FIRE ---------------- */
  const fr = fireResult ?? { maturity: 0, defects: [], destroyed: false, notes: [] };
  let fireScore;
  if (fr.destroyed) {
    fireScore = 0;
  } else {
    const defectPenalty = clamp01((fr.defects?.length ?? 0) * 0.19);
    const effects =
      clamp01(fr.crystal) * 0.9 + clamp01(fr.oilspot) * 0.85 + clamp01(fr.hare) * 0.6 +
      clamp01(fr.opal) * 0.7 + clamp01(fr.metal) * 0.6 + clamp01(fr.peel) * 0.6 +
      clamp01(fr.carbon) * 0.6;
    fireScore = 100 * clamp01(0.58 * (fr.maturity ?? 0) + 0.30 * clamp01(effects) + 0.12 - defectPenalty);
  }
  for (const n of fr.notes ?? []) notes.push({ good: n.good ? 1 : 0, bad: n.bad ? 1 : 0, t: n.t });

  /* ---------------- BRIEF ---------------- */
  let reqTotal = 0, reqMet = 0;
  const check = (key, ok, label) => {
    reqTotal++; if (ok) reqMet++;
    met[key] = { ok, label };
  };

  if (req.form) check('form', shapeScore > 0.46 && ratioScore > 0.34, `A ${form.name.toLowerCase()}`);
  if (req.minH) check('minH', m.height >= req.minH, `At least ${req.minH} cm tall`);
  if (req.maxH) check('maxH', m.height <= req.maxH, `No taller than ${req.maxH} cm`);
  if (req.minD) check('minD', m.diameter >= req.minD, `At least ${req.minD} cm across`);
  if (req.maxD) check('maxD', m.diameter <= req.maxD, `No wider than ${req.maxD} cm`);
  if (req.maxWall) check('maxWall', m.meanWall <= req.maxWall, `Wall under ${req.maxWall} cm`);
  if (req.glaze) {
    const dom = dominantGlaze(gs);
    check('glaze', dom === req.glaze, `Glazed in ${glazeName(req.glaze)}`);
  }
  if (req.effect) {
    const has = hasEffect(fr, req.effect);
    check('effect', has, `Show ${effectName(req.effect)}`);
  }
  if (req.atmos) {
    const red = schedule?.reduction ?? 0;
    check('atmos', req.atmos === 'reduction' ? red > 0.5 : red < 0.25,
      req.atmos === 'reduction' ? 'Fired in reduction' : 'Fired in oxidation');
  }
  if (req.minPeak) check('minPeak', (schedule?.peak ?? 0) >= req.minPeak, `Peak at least ${req.minPeak}°C`);
  if (req.maxPeak) check('maxPeak', (schedule?.peak ?? 9999) <= req.maxPeak, `Peak no more than ${req.maxPeak}°C`);
  if (req.noDefects) check('noDefects', (fr.defects?.length ?? 0) === 0 && !fr.destroyed, 'No faults at all');

  const briefScore = reqTotal === 0 ? 85 : 100 * (reqMet / reqTotal);

  /* ---------------- TOTAL ---------------- */
  let total = fr.destroyed
    ? Math.round(0.30 * formScore + 0.28 * craftScore + 0.12 * surfaceScore) * 0.28
    : Math.round(
      0.24 * formScore + 0.26 * craftScore + 0.16 * surfaceScore +
      0.20 * fireScore + 0.14 * briefScore
    );
  total = clamp(Math.round(total), 0, 100);

  if (req.minScore && total < req.minScore) {
    notes.push({ bad: 1, t: `The brief asked for at least ${req.minScore}. This is ${total}.` });
  }

  const grade = gradeFor(total);
  const briefOk = reqTotal === 0 || reqMet === reqTotal;
  const accepted = !fr.destroyed && total >= 40 && (!req.minScore || total >= req.minScore);

  const payMult = fr.destroyed ? 0 : payMultiplier(total, briefOk);
  const pay = Math.round((commission?.pay ?? 60) * payMult);
  const rep = Math.round((commission?.rep ?? 50) * (fr.destroyed ? 0.06 : payMult * 0.9));

  return {
    rows: [
      { k: 'Form', v: Math.round(formScore) },
      { k: 'Craft', v: Math.round(craftScore) },
      { k: 'Surface', v: Math.round(surfaceScore) },
      { k: 'Fire', v: Math.round(fireScore) },
      { k: 'Brief', v: Math.round(briefScore) },
    ],
    total, grade, notes, met, accepted, pay, rep,
    destroyed: !!fr.destroyed,
    destroyReason: fr.destroyReason,
    title: fr.title,
    metrics: m,
  };
}

/* ------------------------------------------------------------------ */

function dominantGlaze(gs) {
  if (!gs?.slotIds) return null;
  let best = null, bv = 0;
  for (let i = 0; i < gs.slotIds.length; i++) {
    const v = (gs.coverage?.[i] ?? 0) * (gs.meanThick?.[i] ?? 0);
    if (v > bv) { bv = v; best = gs.slotIds[i]; }
  }
  return bv > 0.0004 ? best : null;
}

function glazeName(id) {
  return {
    ash: 'Ninth Ash', celadon: 'Kingfisher Celadon', tenmoku: 'Tenmoku',
    shino: 'Carbon-Trap Shino', oxblood: 'Oxblood', chun: 'Chun Blue',
    crystal: 'Zinc Flower', nuka: 'Nuka', kaki: 'Persimmon Kaki',
    cobalt: 'Guild Blue', salt: 'Salt Vapour', raku: 'Raku Copper Matte',
  }[id] ?? id;
}

function effectName(e) {
  return {
    crystal: 'crystal growth', oilspot: 'oil spots', hare: "hare's fur",
    copperRed: 'a true copper red', carbon: 'carbon trapping', craze: 'a craze net',
    peel: 'orange-peel vapour', opal: 'opalescence', metal: 'a metallic lustre',
  }[e] ?? e;
}

function hasEffect(fr, e) {
  if (!fr || fr.destroyed) return false;
  switch (e) {
    case 'crystal': return (fr.crystal ?? 0) > 0.4;
    case 'oilspot': return (fr.oilspot ?? 0) > 0.3;
    case 'hare': return (fr.hare ?? 0) > 0.4;
    case 'carbon': return (fr.carbon ?? 0) > 0.4;
    case 'craze': return (fr.craze ?? 0) > 0.45;
    case 'peel': return (fr.peel ?? 0) > 0.4;
    case 'opal': return (fr.opal ?? 0) > 0.45;
    case 'metal': return (fr.metal ?? 0) > 0.4;
    case 'copperRed':
      return (fr.slots ?? []).some((s) => s.glaze?.needRed && s.colA[0] > 0.32 && s.colA[1] < 0.30 && s.melt > 0.5);
    default: return false;
  }
}

export { dominantGlaze, glazeName, effectName };

/* ------------------------------------------------------------------ */
/*  Live checks shown on the commission card while you are working     */
/* ------------------------------------------------------------------ */

export function liveRequirements(clay, commission, glazeStats, schedule, fireResult) {
  const req = commission?.require ?? {};
  const m = clay.metrics();
  const form = FORMS[req.form] ?? FORMS.jar;
  const { p: sil } = silhouetteProfile(clay, 28);
  let err = 0;
  for (let i = 0; i < 28; i++) {
    const t = i / 27;
    err += (sil[i] - clamp(form.profile(t), 0.05, 1.25)) ** 2;
  }
  err = Math.sqrt(err / 28);
  const shapeScore = clamp01(1 - err / (form.tol ?? 0.26));
  const ratio = m.height / Math.max(0.6, m.diameter);
  const ratioScore = clamp01(1 - Math.abs(ratio - form.ratio) / Math.max(0.25, form.ratio * 0.55));

  const out = {};
  const put = (k, ok) => { out[k] = { ok }; };
  if (req.form) put('form', shapeScore > 0.46 && ratioScore > 0.34);
  if (req.minH) put('minH', m.height >= req.minH);
  if (req.maxH) put('maxH', m.height <= req.maxH);
  if (req.minD) put('minD', m.diameter >= req.minD);
  if (req.maxD) put('maxD', m.diameter <= req.maxD);
  if (req.maxWall) put('maxWall', m.meanWall <= req.maxWall);
  if (req.glaze && glazeStats) put('glaze', dominantGlaze(glazeStats) === req.glaze);
  if (req.atmos && schedule) {
    put('atmos', req.atmos === 'reduction' ? schedule.reduction > 0.5 : schedule.reduction < 0.25);
  }
  if (req.minPeak && schedule) put('minPeak', schedule.peak >= req.minPeak);
  if (req.maxPeak && schedule) put('maxPeak', schedule.peak <= req.maxPeak);
  if (req.effect && fireResult) put('effect', hasEffect(fireResult, req.effect));
  return out;
}
