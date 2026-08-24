// ============================================================
//  Can a coached player actually satisfy the briefs?
//
//  Plays each commission by following exactly the advice the in-game
//  coach gives, with deliberately imprecise hand movements, and reports
//  whether the geometric requirements come out met.
//
//  Run:  node src/dev/winnable.mjs
// ============================================================

import { Clay, NS } from '../sim/clay.js';
import { clamp, clamp01 } from '../core/util.js';
import { COMMISSIONS, FORMS, targetSize } from '../game/lore.js';
import { appraise } from '../game/scoring.js';

const DT = 1 / 60;
const REF = 22.0;
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a || 1e-9)); return t * t * (3 - 2 * t); };
const radiiAt = (c, y) => {
  const i = c.sectionAt(clamp(y, 0, Math.max(0.01, c.height - 1e-4)));
  return { ro: c.ro[i], ri: c.ri[i] };
};

/** A hand dragged from one place to another, sloppily. */
function drag(c, r0, y0, r1, y1, secs, omega = 8.4, jitter = 0.25) {
  const frames = Math.max(2, Math.round(secs / DT));
  let pr = r0, py = y0, grab = null, press = 0, velR = 0, velY = 0;
  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1);
    const j = Math.sin(t * 11.3) * jitter;
    const r = r0 + (r1 - r0) * t + j;
    const y = y0 + (y1 - y0) * t;
    press += (1 - press) * (1 - Math.exp(-12 * DT));
    const { ro, ri } = radiiAt(c, y);
    const mid = (ro + ri) * 0.5;
    const opened = c.floorSection() < NS;
    if (grab === null) grab = r < mid;
    const contact = clamp01(smooth(ro + 5, ro + 1.75, r) *
      smooth(-1.2, -0.2, y) * smooth(c.height + 3, c.height + 0.6, y));
    const p = press * contact;
    velR = velR + ((r - pr) / DT - velR) * (1 - Math.exp(-13 * DT));
    velY = velY + ((y - py) / DT - velY) * (1 - Math.exp(-13 * DT));
    const dR = velR * DT, dY = velY * DT, dwell = DT * 0.3;
    if (p > 0.02 && !c.dead) {
      let intent;
      if (!opened) intent = (r < Math.max(1.8, ro * 0.62) && y > c.height * 0.42) ? 'open' : 'centre';
      else { const fl = Math.min(NS - 1, c.floorSection()); intent = (y < c.y[fl] + 0.4 && r < ri + 0.9) ? 'open' : 'shape'; }
      if (intent === 'centre') c.center(clamp(r, 0.8, ro + 1.5), y, p, dwell + Math.hypot(dR, dY) / REF, omega);
      else if (intent === 'open') c.open(clamp(r, 0, Math.max(0.4, ro - 0.45)), Math.max(0.45, y), p,
        dwell + (Math.max(0, -dY) + Math.max(0, dR)) / REF, omega);
      else {
        const wUp = Math.max(0, dY) / REF, wOut = Math.max(0, dR) / REF, wIn = Math.max(0, -dR) / REF;
        if (wUp > 1e-5) c.pull(clamp(r, mid - 1.3, mid + 1.3), y, p, wUp + dwell * 0.4, omega, 1);
        const shapeR = clamp(r, mid - 1.2, mid + 1.2);
        if (wOut > 1e-5) c.shape(shapeR, y, p, wOut, omega, true);
        if (wIn > 1e-5) c.shape(shapeR, y, p, wIn, omega, false);
      }
    }
    c.step(DT, omega, { dryRate: 0.34, forgiving: true });
    pr = r; py = y;
    if (c.dead) break;
  }
}

function suggestedMass(req = {}) {
  const { H, D, wall: w } = targetSize(req);
  const rc = Math.max(0.6, D * 0.5 - w * 0.5);
  const v = 6.283185 * rc * w * H * 0.86 + Math.PI * (D * 0.5) ** 2 * 0.8;
  return clamp(Math.round(v * 1.92 * 1.10 / 25) * 25, 250, 3200);
}

/** Play one brief, following what the coach would say at each moment. */
function play(com, seed) {
  const req = com.require;
  const form = FORMS[req.form];
  const mass = suggestedMass(req);
  const c = new Clay({ mass, seed, wobble: 0.55 });

  const loH = req.minH ?? 0;
  const hiH = req.maxH ?? 1e9;
  const targetH = req.minH ?? (form.ratio > 1 ? 22 : 11);
  const targetD = Math.max(req.minD ?? 0, targetH / form.ratio);

  // 1. centre — loose up-and-down strokes
  for (let i = 0; i < 4; i++) {
    const top = c.height * 0.85;
    drag(c, c.maxR * 1.05, 0.8, c.maxR * 0.72, top, 0.5);
    drag(c, c.maxR * 0.72, top, c.maxR * 1.05, 0.8, 0.5);
  }

  // 2. open — down the middle, then out toward the target bore
  drag(c, 0.5, c.height * 0.9, 0.8, 1.1, 0.5);
  for (let i = 0; i < 3; i++) drag(c, 0.8, 1.2, targetD * 0.40, 1.4, 0.7);

  let guard = 0;
  const log = [];
  while (guard++ < 60 && !c.dead) {
    const m = c.metrics();
    const wallOK = !req.maxWall || m.meanWall <= req.maxWall;
    const tallOK = m.height >= loH && m.height <= hiH;
    const wideOK = (!req.minD || m.diameter >= req.minD) && (!req.maxD || m.diameter <= req.maxD);
    if (wallOK && tallOK && wideOK) break;

    // Follow the coach's order — width, then height, then wall — and
    // ease off as the pot approaches the target, which is what anyone
    // watching the silhouette panel actually does. Fixed-size steps
    // oscillate and never settle.
    const tooNarrow = req.minD && m.diameter < req.minD;
    const tooWide = req.maxD && m.diameter > req.maxD;
    const step = (err, k) => clamp(Math.abs(err) * k, 0.7, 2.0);

    if (tooNarrow || m.height > hiH || (c.tooTall && !wallOK)) {
      const err = tooNarrow ? (req.minD - m.diameter) * 0.5 : (m.height - hiH);
      const out = step(err, 0.28);
      for (const hf of [0.30, 0.55, 0.80]) {
        const y = Math.max(1.4, c.height * hf);
        const rr = radiiAt(c, y);
        drag(c, rr.ri - 0.1, y, rr.ri - 0.1 + out, y, 0.6);
      }
      log.push('widen');
    } else if (tooWide) {
      const inn = step(m.diameter - req.maxD, 0.4);
      const y = c.height * 0.85;
      const rr = radiiAt(c, y);
      drag(c, rr.ro + 0.3, y, rr.ro + 0.3 - inn, y, 0.6);
      log.push('collar');
    } else if (m.height < loH || !wallOK) {
      // lift, finishing at the rim you can see
      const rr = radiiAt(c, 2);
      const mid = (rr.ro + rr.ri) * 0.5;
      const top = Math.max(3.5, c.height - 0.3);
      drag(c, mid, 1.1, mid, top, 1.2);
      log.push('lift');
    } else break;
  }

  const m = c.metrics();
  const met = {
    height: m.height >= loH && m.height <= hiH,
    width: (!req.minD || m.diameter >= req.minD) && (!req.maxD || m.diameter <= req.maxD),
    wall: !req.maxWall || m.meanWall <= req.maxWall,
  };
  const rep = appraise({
    clay: c, commission: com,
    glazeStats: { totalCoverage: 0.88, evenness: 0.82, footClean: 1, meanThick: [0.13, 0, 0], slotIds: [req.glaze ?? 'ash', null, null] },
    fireResult: {
      maturity: 0.86, defects: [], notes: [], destroyed: false,
      crystal: 0, oilspot: 0, hare: 0, opal: 0, metal: 0, peel: 0, carbon: 0, craze: 0.2,
    },
    schedule: { peak: 1275, reduction: req.atmos === 'reduction' ? 0.85 : 0.1, cooling: 'normal' },
  });
  if (c.dead) {
    globalThis.__deaths = globalThis.__deaths || [];
    globalThis.__deaths.push(`${com.title.slice(0, 26)} -> ${c.deadReason}  (H=${m.height.toFixed(1)} D=${m.diameter.toFixed(1)} wall=${m.meanWall.toFixed(2)} true=${m.trueness.toFixed(2)} stress=${m.stress.toFixed(2)})`);
  }
  return { c, m, met, rep, mass, moves: log.length, dead: c.dead };
}

/* ================================================================== */

console.log('\n  Playing each brief with sloppy hands, following the coach.\n');
console.log('  brief                          ball    result                      H    ok   grade');
console.log('  -----------------------------  ------  --------------------------  ---  ---  -----');

let wins = 0;
for (let i = 0; i < Math.min(8, COMMISSIONS.length); i++) {
  const com = COMMISSIONS[i];
  const r = play(com, 100 + i * 7);
  const allMet = r.met.height && r.met.width && r.met.wall && !r.dead;
  if (allMet) wins++;
  const flags =
    (r.met.height ? 'H' : '·') + (r.met.width ? 'D' : '·') + (r.met.wall ? 'W' : '·');
  console.log(
    '  ' + com.title.slice(0, 29).padEnd(29) +
    '  ' + String(r.mass).padStart(4) + 'g ' +
    '  ' + (r.dead ? 'collapsed'.padEnd(26)
      : `${r.m.height.toFixed(1)}cm x ${r.m.diameter.toFixed(1)}cm w${r.m.meanWall.toFixed(2)}`.padEnd(26)) +
    '  ' + String(r.moves).padStart(3) +
    '  ' + flags +
    '  ' + String(r.rep.total).padStart(3) + ' ' + r.rep.grade.g
  );
}
console.log(`\n  geometric requirements met on ${wins} of 8 briefs\n`);

if (globalThis.__deaths && globalThis.__deaths.length) {
  console.log('  deaths:');
  for (const d of globalThis.__deaths) console.log('    ' + d);
  console.log('');
}
