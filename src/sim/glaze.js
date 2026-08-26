// ============================================================
//  CELADON — glaze chemistry and kiln physics
//
//  A glaze is a glass that has not been melted yet. Which glass it
//  becomes depends on four things the player controls:
//
//    1. the recipe        (flux / silica / alumina / colourants)
//    2. how thickly it went on
//    3. how hot the kiln got and for how long it stayed there
//    4. whether the kiln had enough air  (oxidation vs reduction)
//
//  Everything visible on a fired pot in this game is derived from
//  those four numbers by the functions below. Copper is green in
//  air and blood-red when starved of it. Iron is amber in air and
//  the colour of shallow sea water in reduction — that colour is
//  called celadon, and it is what the game is named for.
// ============================================================

import { clamp, clamp01, lerp, smoothstep, hexToRgb, blendRgb } from '../core/util.js';

export const SLOTS = 3;            // glaze layers a single pot can carry
export const BODY_COE = 6.4;       // expansion coefficient of the stoneware body

/* ------------------------------------------------------------------ */
/*  Recipes                                                            */
/* ------------------------------------------------------------------ */
/*
   chem
     flux     alkali + calcia; melts the glass, lowers the melting point
     silica   the glass former; raises melt point, raises gloss
     alumina  the stiffener; raises viscosity so the glaze stays put
     iron / copper / cobalt / manganese / rutile / titania / zinc /
     tin / phosphate / ash — colourants and opacifiers
   coe        thermal expansion; more than the body's 6.4 and it crazes
   crystal    tendency to grow zinc-silicate flowers on a slow cool
   opac       opacity when molten
   breakK     how strongly it thins to a different colour over edges
*/

export const GLAZES = [
  {
    id: 'ash',
    mature: 1284,
    name: 'Ninth Ash',
    family: 'Wood ash',
    unlock: 0,
    swatch: '#9aa07a',
    desc: 'The sky, ground and washed. Runs like water when it goes.',
    lore:
      'Every household keeps an ash barrel by the door. Nine winters of fallen sky, sieved through cloth, ' +
      'is the cheapest flux in the Reach and the only one that never runs out.',
    chem: { flux: 0.72, silica: 0.46, alumina: 0.18, iron: 0.016, ash: 0.9 },
    coe: 7.4, crystal: 0.08, opac: 0.15, breakK: 0.9,
    ox: '#b9a468', red: '#8fae86', breakCol: '#5a4a2c',
    gloss: 0.86, viscK: 0.42,
  },
  {
    id: 'celadon',
    mature: 1272,
    name: 'Kingfisher Celadon',
    family: 'Iron, reduced',
    unlock: 0,
    swatch: '#7fbfa4',
    desc: 'Two parts iron in a hundred. Air makes it honey; hunger makes it green.',
    lore:
      'The Reach had a sea once. Nobody alive has seen it. The Guild keeps the colour instead, ' +
      'and charges accordingly.',
    chem: { flux: 0.52, silica: 0.66, alumina: 0.31, iron: 0.019 },
    coe: 6.2, crystal: 0.04, opac: 0.05, breakK: 1.5,
    ox: '#d8c08a', red: '#79b7a4', breakCol: '#cf9a5a',
    gloss: 0.95, viscK: 0.78,
  },
  {
    id: 'tenmoku',
    mature: 1266,
    name: 'Tenmoku',
    family: 'Iron saturate',
    unlock: 1,
    swatch: '#3a241a',
    desc: 'Iron past what the glass can hold. Black in the belly, rust on every edge.',
    lore:
      'Fire enough iron into a glaze and it stops being a colour and becomes a depth. ' +
      'Hold a tenmoku bowl to a lamp and the rim goes the colour of a fox.',
    chem: { flux: 0.55, silica: 0.62, alumina: 0.26, iron: 0.095 },
    coe: 6.6, crystal: 0.22, opac: 0.4, breakK: 2.6,
    ox: '#2a1a12', red: '#231610', breakCol: '#b3612a',
    gloss: 0.93, viscK: 0.6, oilspot: 0.55, hare: 0.7,
  },
  {
    id: 'shino',
    mature: 1248,
    name: 'Carbon-Trap Shino',
    family: 'Feldspathic',
    unlock: 2,
    swatch: '#e5d3b6',
    desc: 'Thick, stiff and full of pinholes. Traps smoke in its skin and keeps it.',
    lore:
      'A shino remembers the shape of the fire. Where the flame licked it, it went the grey of ' +
      'a thumbprint on old paper; where it did not, it stayed the colour of milk.',
    chem: { flux: 0.42, silica: 0.55, alumina: 0.40, iron: 0.008, soda: 0.5 },
    coe: 5.4, crystal: 0.02, opac: 0.72, breakK: 1.1,
    ox: '#ecdcc0', red: '#d8b892', breakCol: '#7b6a55',
    gloss: 0.52, viscK: 1.35, crawl: 0.7, carbon: 0.9,
  },
  {
    id: 'oxblood',
    mature: 1258,
    name: 'Oxblood',
    family: 'Copper red',
    unlock: 3,
    swatch: '#8e2418',
    desc: 'Half a part copper. Give it air and it is a leaf; starve it and it is a wound.',
    lore:
      'The Guild lost the recipe twice. It is not really a recipe — it is a way of holding ' +
      'the kiln closed while it screams, and knowing exactly when to stop.',
    chem: { flux: 0.60, silica: 0.63, alumina: 0.24, copper: 0.006, tin: 0.012 },
    coe: 6.9, crystal: 0.03, opac: 0.22, breakK: 2.0,
    ox: '#6f8f52', red: '#8e2418', breakCol: '#e8d9c0',
    gloss: 0.97, viscK: 0.55, needRed: 0.65,
  },
  {
    id: 'chun',
    mature: 1274,
    name: 'Chun Blue',
    family: 'Opalescent phosphate',
    unlock: 4,
    swatch: '#8fb4d6',
    desc: 'No blue in it at all. The blue is the light getting lost on its way out.',
    lore:
      'Bone ash makes tiny droplets suspended in the glass. Light of a short wavelength ' +
      'scatters off them. It is the same reason the sky was blue, before.',
    chem: { flux: 0.58, silica: 0.68, alumina: 0.27, phosphate: 0.09, iron: 0.006 },
    coe: 6.1, crystal: 0.05, opac: 0.35, breakK: 1.8,
    ox: '#c8d6d2', red: '#8fb4d6', breakCol: '#d9c9a4',
    gloss: 0.96, viscK: 0.7, opal: 0.9,
  },
  {
    id: 'crystal',
    mature: 1238,
    name: 'Zinc Flower',
    family: 'Macro-crystalline',
    unlock: 5,
    swatch: '#b8c8d8',
    desc: 'Runs off the pot unless you catch it. Grows flowers if you cool it slowly enough.',
    lore:
      'Zinc silicate does not want to be glass. Held between eleven and ten-fifty for long enough ' +
      'it remembers it is a crystal, and opens.',
    chem: { flux: 0.74, silica: 0.70, alumina: 0.045, zinc: 0.22, titania: 0.05, cobalt: 0.004 },
    coe: 7.8, crystal: 1.0, opac: 0.2, breakK: 0.7,
    ox: '#9fb6c8', red: '#87a8bd', breakCol: '#e6eef2',
    gloss: 0.99, viscK: 0.16, runaway: 1.0,
  },
  {
    id: 'nuka',
    mature: 1278,
    name: 'Nuka',
    family: 'Rice-straw ash',
    unlock: 6,
    swatch: '#e8e6dc',
    desc: 'A white that is not a pigment. Silica clouding out of solution.',
    lore: 'Straw ash is almost pure silica. Cooled slowly it goes milky, like breath on cold glass.',
    chem: { flux: 0.64, silica: 0.78, alumina: 0.22, ash: 0.7, iron: 0.004 },
    coe: 6.8, crystal: 0.34, opac: 0.8, breakK: 1.6,
    ox: '#eeece2', red: '#e2e3d8', breakCol: '#9e8f6c',
    gloss: 0.9, viscK: 0.5,
  },
  {
    id: 'kaki',
    mature: 1254,
    name: 'Persimmon Kaki',
    family: 'Iron crystal',
    unlock: 7,
    swatch: '#b8552a',
    desc: 'Iron so saturated it grows back out of the glass as it cools.',
    lore: 'Hold it up and it is the colour of the one fruit that still ripens under ash light.',
    chem: { flux: 0.58, silica: 0.58, alumina: 0.20, iron: 0.135 },
    coe: 6.5, crystal: 0.6, opac: 0.55, breakK: 2.2,
    ox: '#c0602c', red: '#8a3a20', breakCol: '#2a1a12',
    gloss: 0.72, viscK: 0.5, hematite: 1.0,
  },
  {
    id: 'cobalt',
    mature: 1246,
    name: 'Guild Blue',
    family: 'Tin-cobalt',
    unlock: 8,
    swatch: '#33529e',
    desc: 'Opaque, obedient, and worth a month of ash-marks per ounce.',
    lore: 'The Guild mark is painted in this and nothing else. Using it without licence is a hand offence.',
    chem: { flux: 0.56, silica: 0.64, alumina: 0.30, cobalt: 0.015, tin: 0.07 },
    coe: 6.3, crystal: 0.02, opac: 0.9, breakK: 1.2,
    ox: '#33529e', red: '#2b4488', breakCol: '#8fa8d8',
    gloss: 0.94, viscK: 0.85,
  },
  {
    id: 'salt',
    mature: 1268,
    name: 'Salt Vapour',
    family: 'Vapour glaze',
    unlock: 9,
    swatch: '#c9b48e',
    desc: 'Not painted on. Thrown into the firebox and allowed to find the pot itself.',
    lore:
      'Salt in a hot kiln comes apart and goes looking for silica. It finds it in the pot. ' +
      'The surface it leaves is called orange peel, and no two are the same.',
    chem: { flux: 0.8, silica: 0.5, alumina: 0.16, soda: 1.0, iron: 0.02 },
    coe: 7.0, crystal: 0.05, opac: 0.1, breakK: 1.4,
    ox: '#c9b48e', red: '#a89070', breakCol: '#6d5a3c',
    gloss: 0.7, viscK: 0.9, peel: 1.0, vapour: true,
  },
  {
    id: 'raku',
    mature: 952,
    name: 'Raku Copper Matte',
    family: 'Low fire, post-reduced',
    unlock: 10,
    swatch: '#7a6a86',
    desc: 'Pulled glowing from the kiln and buried in straw. Metal, crackle and smoke.',
    lore:
      'Not a Guild technique. The kiln is opened at nine hundred and the pot is taken out alive, ' +
      'still moving, and smothered. Half of them come apart in the hand.',
    chem: { flux: 0.92, silica: 0.42, alumina: 0.08, copper: 0.06, iron: 0.01 },
    coe: 9.6, crystal: 0.0, opac: 0.3, breakK: 1.0,
    ox: '#4f7f6a', red: '#7a6a86', breakCol: '#1b1a1c',
    gloss: 0.55, viscK: 0.35, lowFire: 1, metal: 0.9, craze: 1.0,
  },
];

export const GLAZE_BY_ID = Object.fromEntries(GLAZES.map((g) => [g.id, g]));
export const NO_GLAZE = {
  id: 'none', name: 'Bare Clay', swatch: '#8a6a52',
  chem: {}, coe: BODY_COE, crystal: 0, opac: 0, breakK: 0,
  ox: '#9a7458', red: '#8a6248', breakCol: '#6a4a34', gloss: 0.18, viscK: 3,
};

/* ------------------------------------------------------------------ */
/*  Derived chemistry                                                  */
/* ------------------------------------------------------------------ */

/** Temperature at which the glass begins to move, in Celsius. */
export function meltPoint(g) {
  if (g.mature != null) return g.mature - (g.meltGap ?? 78);
  const c = g.chem || {};
  const flux = c.flux ?? 0.5, si = c.silica ?? 0.6, al = c.alumina ?? 0.25;
  const T = 1245 - 430 * flux + 190 * si + 240 * al - 90 * (c.soda ?? 0) - 40 * (c.zinc ?? 0);
  return clamp(g.lowFire ? T - 320 : T, 720, 1340);
}

/** Temperature at which it is properly a glass rather than a scab. */
export function maturePoint(g) {
  if (g.mature != null) return g.mature;
  return meltPoint(g) + 55 + 140 * (g.chem?.alumina ?? 0.25);
}

/** Melt viscosity at temperature T. Lower means it runs. */
export function viscosity(g, T) {
  const mp = meltPoint(g);
  const over = Math.max(0, T - mp);
  const stiff = (g.viscK ?? 0.7) * (0.5 + 2.4 * (g.chem?.alumina ?? 0.25));
  return stiff / (0.12 + over / 120);
}

/* ------------------------------------------------------------------ */
/*  Firing schedule                                                    */
/* ------------------------------------------------------------------ */

export const COOLING = {
  crash: { id: 'crash', name: 'Crash', hrs: 1.2, note: 'Doors open. Fast, violent, and it will craze.' },
  normal: { id: 'normal', name: 'Natural', hrs: 9, note: 'Bricked up and left. What most potters do.' },
  slow: { id: 'slow', name: 'Held', hrs: 22, note: 'Reheated and held. The only way to grow crystals.' },
};

export function defaultSchedule() {
  return {
    ramp: 110,        // C per hour
    peak: 1265,       // C
    soak: 0.6,        // hours at peak
    reduction: 0.0,   // 0 = oxidation, 1 = heavy reduction
    reduceFrom: 980,  // C at which the damper closes
    cooling: 'normal',
    holdT: 1080,      // C, crystal growth window
    holdHrs: 0,
  };
}

/**
 * The firing a Guild kiln master would set for this pot, and the one
 * the game sets for you unless you ask to do it yourself.
 *
 * Six controls decide a firing, and five of them can ruin it in ways
 * that are not visible until the kiln is opened a day later. Worse, the
 * one that matters most — peak — has to land within about 25°C of a
 * number that is a property of a glaze you chose an hour ago and were
 * never told. That is not difficulty, it is a memory test with a very
 * long feedback loop, so it is no longer the default.
 *
 * Nothing here is a cheat. It is the schedule the physics wants:
 *   peak   the maturing temperature of the hottest glaze actually on
 *          the pot, so every layer becomes a glass and none is pushed
 *          past into blisters
 *   ramp   three quarters of the thermal-shock limit for the wall this
 *          particular pot was thrown with — the same limit fire() uses
 *   soak   long enough for the melt to finish and level
 *   air    whatever the brief asked for, since a commission that wants
 *          reduction is asking for a firing, not a glaze
 * Fire this and the pot comes out of the kiln properly fired. What it
 * looks like is still down to how it was thrown and how it was glazed.
 */
export function guildSchedule(glazes, body, req) {
  const s = defaultSchedule();
  const on = (glazes || []).filter(Boolean);

  s.peak = on.length
    ? Math.round(Math.max(...on.map(maturePoint)))
    : s.peak;

  // The same limit fire() measures the ramp against, with a quarter in
  // hand. The floor is 30 rather than the slider's 40: the sliders are
  // not on screen in this mode, and a thick pot genuinely does need a
  // slower climb than the panel would let you dial. It costs more hours
  // and more fuel, which is what a heavy pot costs to fire.
  const wall = Math.max(0.18, body?.meanWall ?? 0.4);
  const shockLimit = 230 / wall * 0.55;
  s.ramp = Math.round(clamp(shockLimit * 0.75, 30, 320));

  /* Soak is how long the glaze is given to move, and not every glaze
     should be given the same amount. Held for the full 0.8 hr, Zinc
     Flower — a macro-crystalline at a sixth the stiffness of anything
     else in the shed — ran off the foot and welded the pot to the
     shelf, destroying both. Measured, that happens above a run of about
     3.2; the hold below keeps the runniest glaze in the game at 2.8
     with the foot NOT wiped, and still gives a stiff one the full time
     it needs to level itself out. */
  const stiff = Math.min(...on.map((g) => g.viscK ?? 0.7), 0.7);
  s.soak = +clamp(0.25 + 1.6 * stiff, 0.25, 0.8).toFixed(2);

  s.reduction = req?.atmos === 'reduction' ? 0.75 : 0;
  s.reduceFrom = 980;
  s.cooling = 'normal';
  s.holdHrs = 0;

  /* And it fires for what it has been asked to produce.
     Pinning the schedule to the maturing point makes a glaze into a
     glass, which is what most briefs want and is why this exists. It is
     also exactly wrong for the three that want something a straight
     firing does not give: crystals need to be held on the way down,
     oil spots need to be driven past maturity and then dropped, and a
     raku lustre comes out of a kiln opened hot and starved. Left to the
     plain schedule those three briefs could not be met at all in the
     mode the game fires in by default — 0.09 against a gate of 0.40 for
     the crystals — so a kiln master who could not do them would not be
     much of a kiln master. */
  const air = req?.atmos === 'oxidation';
  const starve = (v) => { if (!air) s.reduction = Math.max(s.reduction, v); };

  switch (req?.effect) {
    case 'crystal':
      // grown, not fired: reheated and held in the window where zinc
      // silicate will nucleate, which is the whole of what 'Held' is for
      s.cooling = 'slow'; s.holdHrs = 5; s.holdT = 1050;
      break;
    case 'oilspot':
      // iron boiled out of the melt above maturity and frozen where it
      // surfaced, so the kiln has to be taken over and then shut down
      s.peak = Math.round(Math.max(s.peak, req.minPeak ?? s.peak + 45));
      s.cooling = 'crash'; starve(0.85);
      break;
    case 'metal':
      s.cooling = 'crash'; starve(0.85);
      break;
    case 'carbon':
      // there is no carbon to trap in a kiln that is being fed: the
      // smoke has to be there before the glaze closes over it
      starve(0.8);
      break;
    case 'craze':
      s.cooling = 'crash';
      break;
    default:
      break;
  }
  return s;
}

/**
 * What each glaze can actually be asked to show.
 *
 * Not every effect is available on every glaze — hare's fur only happens
 * in an iron saturate, a lustre only on a raku — and a brief that asks
 * for one that cannot happen is a brief nobody can complete. This is the
 * list of pairings that were measured coming out of the kiln on the
 * Guild's own schedule, and the `campaign` bench fires every one of them
 * again to make sure the list has not drifted away from the chemistry.
 *
 * Anything not named here has no effect a brief may ask for.
 */
export const EFFECTS_FOR = {
  tenmoku: ['hare', 'oilspot'],
  shino: ['carbon'],
  chun: ['opal'],
  crystal: ['crystal', 'craze'],
  salt: ['peel'],
  raku: ['metal', 'craze'],
  oxblood: ['copperRed'],
};

export function scheduleHours(s) {
  const ramp = Math.max(1, s.peak - 20) / Math.max(30, s.ramp);
  return ramp + s.soak + (COOLING[s.cooling]?.hrs ?? 9) + (s.cooling === 'slow' ? s.holdHrs : 0);
}

/** Fuel cost of a firing in ash-marks. */
/**
 * Fuel cost of a firing in ash-marks.
 *
 * These numbers used to make the game unplayable from the first
 * morning. The two starting glazes mature at 1272 and 1284 C, and
 * reaching 1284 cost 75 marks against a purse of 55 — so the one firing
 * a new player could actually want was never affordable, every firing
 * they COULD afford lost money, and by the third commission they were
 * stuck on 34 marks unable to light the kiln at all. Nothing in the game
 * lets you earn without firing, so that was the end of the run.
 *
 * Rebalanced so a full-heat firing is about 46 marks against a first fee
 * near 100: the cheapest sighting shot is 13, a proper glaze firing is
 * in the forties, and every extravagance — a long soak, reduction, a
 * held cooling — is still worth thinking about at around 110.
 */
export function fuelCost(s) {
  const h = scheduleHours(s);
  const heat = Math.pow(Math.max(0, s.peak - 600) / 700, 2.1);
  return Math.round(4 + h * 0.9 + heat * 30 + s.reduction * 9 + (s.cooling === 'slow' ? 11 : 0));
}

/* ------------------------------------------------------------------ */
/*  The firing itself                                                  */
/* ------------------------------------------------------------------ */

/**
 * @param {Array} layers  [{glaze, coverage 0..1, meanThick cm}]
 * @param {object} sched
 * @param {object} body   { meanWall, minWall, moisture, scar, height, maxR }
 * @returns {object} appearance + defects + notes
 */
export function fire(layers, sched, body) {
  const notes = [];
  const defects = [];
  const s = sched;
  const red = clamp01(s.reduction);
  const cool = COOLING[s.cooling] ?? COOLING.normal;

  const out = {
    slots: [],
    destroyed: false,
    destroyReason: '',
    craze: 0, crystal: 0, crystalSize: 0, run: 0,
    carbon: 0, peel: 0, metal: 0, opal: 0, oilspot: 0, hare: 0,
    glossAvg: 0.5, maturity: 0,
    notes, defects,
    peak: s.peak, reduction: red, cooling: s.cooling,
    hours: scheduleHours(s),
  };

  /* ---- thermal shock on the way up -------------------------------- */
  const thickness = body.meanWall ?? 0.4;
  const shockLimit = 230 / Math.max(0.18, thickness) * 0.55;
  if (s.ramp > shockLimit) {
    const sev = (s.ramp - shockLimit) / shockLimit;
    if (sev > 0.55) {
      out.destroyed = true;
      out.destroyReason =
        'It came apart on the way up. Water still in the body turned to steam faster than the wall could let it out.';
      defects.push('thermal shock');
      out.title = 'Lost in the firing';
      return out;
    }
    defects.push('dunting cracks');
    notes.push({ bad: true, t: `The ramp of ${Math.round(s.ramp)}°C/hr was steep for a wall that thick. Hairline cracks in the foot.` });
  }

  /* ---- each glaze layer -------------------------------------------- */
  let totalRun = 0, glossSum = 0, wsum = 0, matSum = 0;

  for (const L of layers) {
    const g = L.glaze;
    if (!g || g.id === 'none') continue;
    const mp = meltPoint(g);
    const mat = maturePoint(g);
    const melt = smoothstep(mp - 25, mp + 85, s.peak) * (0.72 + 0.28 * smoothstep(0, 1.6, s.soak));
    const maturity = clamp01(1 - Math.abs(s.peak - mat) / 165);
    const eta = viscosity(g, s.peak);

    // running: Poiseuille-ish, thickness cubed over viscosity, times dwell
    const dwell = s.soak + 0.35;
    // 0.13 cm is a normal dipped coat; the exponent is why a heavy
    // application runs and a light one does not.
    const run = clamp(
      (0.75 * Math.pow(L.meanThick / 0.13, 2.2) * melt * dwell * (g.runaway ? 2.4 : 1)) /
      Math.max(0.30, eta),
      0, 6
    );

    // colour: the atmosphere decides
    let colA = blendRgb(hexToRgb(g.ox), hexToRgb(g.red), g.needRed ? smoothstep(g.needRed - 0.25, g.needRed + 0.15, red) : red);
    const colB = hexToRgb(g.breakCol);

    // copper volatilises away in a long hot oxidising firing
    if (g.chem?.copper && red < 0.2 && s.peak > 1230 && s.soak > 1.2) {
      colA = blendRgb(colA, [0.86, 0.84, 0.78], 0.5);
      notes.push({ t: 'The copper burned out in the long soak. What is left is mostly the tin.' });
    }

    const crystal = clamp01(
      (g.crystal ?? 0) * melt *
      (s.cooling === 'slow' ? smoothstep(0.4, 4.5, s.holdHrs) : s.cooling === 'normal' ? 0.12 : 0.0) *
      smoothstep(120, 40, Math.abs(s.holdT - 1075))
    );

    /* Crazing is the difference between how much the glaze contracts on
       the way down and how much the clay under it does. A glaze that
       shrinks more than its body ends up in tension and lets go in a
       net of cracks; one that shrinks less is squeezed and holds.
       So the body's own expansion belongs in this line, and until now
       it was not in it: every pot was fired against a flat 6.4 whatever
       it had been thrown from. Reach Porcelain at 6.9 puts a celadon
       into compression, which is exactly why the two have been fired
       together for a thousand years, and Blackhill at 6.0 crazes things
       that Ashstone leaves alone. */
    const bodyCoe = body?.coe ?? BODY_COE;
    const craze = clamp01(
      ((g.coe - bodyCoe) / 2.2) * melt *
      (s.cooling === 'crash' ? 1.7 : s.cooling === 'slow' ? 0.35 : 1.0) *
      (g.craze ? 1.6 : 1)
    );

    const dry = clamp01(1 - melt * 1.35);
    const slot = {
      id: g.id,
      glaze: g,
      colA, colB,
      melt, maturity, run, crystal, craze, dry,
      thick: L.meanThick,
      coverage: L.coverage,
      gloss: lerp(0.06, g.gloss ?? 0.9, melt) * (1 - 0.55 * dry),
      opac: g.opac ?? 0.3,
      breakK: g.breakK ?? 1,
      metal: (g.metal ?? 0) * (0.3 + 0.7 * red),
      opal: (g.opal ?? 0) * melt * (s.cooling === 'slow' ? 1 : 0.7),
      oilspot: clamp01((g.oilspot ?? 0) * smoothstep(1250, 1305, s.peak) * (0.4 + 0.6 * red)),
      hare: clamp01((g.hare ?? 0) * melt * clamp01(run * 1.4)),
      peel: (g.peel ?? 0),
      carbon: clamp01((g.carbon ?? 0) * red * smoothstep(0.1, 0.7, red)),
      crawl: clamp01((g.crawl ?? 0) * smoothstep(0.16, 0.30, L.meanThick)),
      hematite: clamp01((g.hematite ?? 0) * melt * (s.cooling === 'slow' ? 1 : 0.55)),
    };

    out.slots.push(slot);
    totalRun = Math.max(totalRun, run);
    out.crystal = Math.max(out.crystal, crystal);
    out.crystalSize = Math.max(out.crystalSize, crystal * (0.4 + 0.6 * smoothstep(0.5, 5, s.holdHrs)));
    out.craze = Math.max(out.craze, craze);
    out.carbon = Math.max(out.carbon, slot.carbon);
    out.peel = Math.max(out.peel, slot.peel);
    out.metal = Math.max(out.metal, slot.metal);
    out.opal = Math.max(out.opal, slot.opal);
    out.oilspot = Math.max(out.oilspot, slot.oilspot);
    out.hare = Math.max(out.hare, slot.hare);

    glossSum += slot.gloss * L.coverage; wsum += L.coverage;
    matSum += maturity * L.coverage;

    /* ---- per-glaze commentary ------------------------------------- */
    if (melt < 0.28) {
      defects.push(`${g.name} underfired`);
      notes.push({ bad: true, t: `${g.name} never melted. At ${Math.round(s.peak)}°C it wanted ${Math.round(mp + 60)}.` });
    } else if (s.peak > mat + 105) {
      defects.push(`${g.name} overfired`);
      notes.push({ bad: true, t: `${g.name} was taken well past maturity and blistered.` });
      slot.blister = clamp01((s.peak - mat - 105) / 90);
    } else if (maturity > 0.82) {
      notes.push({ good: true, t: `${g.name} came out at full maturity — a proper glass, not a scab.` });
    }
    if (g.needRed && red < g.needRed - 0.2 && melt > 0.4) {
      notes.push({ bad: true, t: `${g.name} needed the kiln starved. In air the copper stayed green.` });
    }
    if (g.needRed && red >= g.needRed && melt > 0.5) {
      notes.push({ good: true, t: 'The copper turned. There is a red in there that no pigment can make.' });
    }
    if (crystal > 0.45) {
      notes.push({ good: true, t: `Zinc silicate opened across the shoulder. ${crystal > 0.8 ? 'Large, well-formed flowers.' : 'Small but true.'}` });
    }
    if (slot.crawl > 0.4) {
      defects.push('crawling');
      notes.push({ bad: true, t: `${g.name} went on too thick and crawled back off the wall in patches.` });
    }
    if (slot.oilspot > 0.35) {
      notes.push({ good: true, t: 'Iron boiled through and froze as silver spots. Oil-spot. Rare, and you did not ask for it.' });
    }
  }

  out.glossAvg = wsum > 0 ? glossSum / wsum : 0.2;
  out.maturity = wsum > 0 ? matSum / wsum : 0;
  out.run = totalRun;

  /* ---- did it stick to the shelf? ----------------------------------
     This is the analytic backstop for a truly catastrophic run. The
     authority on whether the glaze actually reached the foot is the
     flow simulation in GlazeField, checked when the kiln is opened. */
  if (totalRun > 3.4) {
    out.destroyed = true;
    out.destroyReason =
      'The glaze ran off the foot and welded the pot to the kiln shelf. It came off in pieces, and so did the shelf.';
    defects.push('welded to shelf');
    out.title = 'Lost in the firing';
    return out;
  }
  if (totalRun > 1.6) {
    notes.push({ bad: true, t: 'It ran hard. There is a bead of glass sitting on the foot ring.' });
  } else if (totalRun > 0.35 && totalRun < 1.5) {
    notes.push({ good: true, t: 'It moved just enough. The glaze pooled in the throwing rings and thinned over the edges.' });
  }

  /* ---- crazing and dunting ----------------------------------------- */
  if (out.craze > 0.75) {
    defects.push('heavy crazing');
    notes.push({ bad: true, t: 'A dense craze net all over. It will not hold water for a year.' });
  } else if (out.craze > 0.25) {
    notes.push({ t: 'A fine craze, the kind collectors pretend to want.' });
  }
  if (s.cooling === 'crash' && thickness > 0.52) {
    defects.push('dunting');
    notes.push({ bad: true, t: 'Crash-cooled a heavy wall. It rang once and then it was two pieces.' });
    if (Math.random() < 0.5) {
      out.destroyed = true;
      out.destroyReason = 'It dunted in the cooling. A wall that thick cannot lose heat that fast.';
      out.title = 'Lost in the firing';
      return out;
    }
  }

  /* ---- reduction damage --------------------------------------------- */
  if (red > 0.55 && s.reduceFrom < 900) {
    defects.push('early reduction');
    notes.push({ bad: true, t: 'Reduction started before the body had burned clean. The clay bloated.' });
    out.bloat = clamp01((900 - s.reduceFrom) / 220);
  }
  if (red > 0.8 && s.peak > 1290) {
    defects.push('over-reduced');
    notes.push({ bad: true, t: 'Held too hard and too hot. The surface went dull and grey.' });
  }

  if (out.slots.length === 0) {
    notes.push({ t: 'Fired bare. The body itself is the surface — nothing to hide behind.' });
    out.glossAvg = 0.16;
    out.maturity = clamp01(smoothstep(1150, 1250, s.peak));
  }

  out.title = describe(out);
  return out;
}

/** Name the surface that came out of the kiln. */
export function describe(r) {
  if (r.destroyed) return 'Lost in the firing';
  if (r.crystal > 0.7) return 'Crystalline';
  if (r.oilspot > 0.4) return 'Oil-spot';
  if (r.hare > 0.55) return "Hare's fur";
  if (r.metal > 0.5) return 'Metallic lustre';
  if (r.opal > 0.6) return 'Opalescent';
  if (r.slots.some((s) => s.glaze.needRed && s.colA[0] > 0.4 && s.colA[1] < 0.28)) return 'Copper red';
  if (r.carbon > 0.5) return 'Carbon trapped';
  if (r.peel > 0.5) return 'Orange peel';
  if (r.craze > 0.6) return 'Crackled';
  if (r.maturity > 0.85) return 'Fully matured';
  if (r.maturity < 0.35) return 'Underfired';
  return 'Even and quiet';
}

/* ------------------------------------------------------------------ */
/*  Live kiln curve, for the animated firing scene                     */
/* ------------------------------------------------------------------ */

/** Temperature at normalised progress t in [0,1] of the whole firing. */
export function kilnCurve(s, t) {
  const rampH = Math.max(1, s.peak - 20) / Math.max(30, s.ramp);
  const coolH = COOLING[s.cooling]?.hrs ?? 9;
  const holdH = s.cooling === 'slow' ? s.holdHrs : 0;
  const total = rampH + s.soak + holdH + coolH;
  const h = t * total;

  if (h < rampH) return 20 + (s.peak - 20) * (h / rampH);
  if (h < rampH + s.soak) return s.peak;
  const ch = h - rampH - s.soak;
  if (s.cooling === 'slow' && holdH > 0) {
    const toHold = 1.4;
    if (ch < toHold) return lerp(s.peak, s.holdT, ch / toHold);
    if (ch < toHold + holdH) return s.holdT - 12 * ((ch - toHold) / Math.max(0.01, holdH));
    const rest = (ch - toHold - holdH) / Math.max(0.01, coolH);
    return lerp(s.holdT - 12, 40, Math.pow(clamp01(rest), 0.62));
  }
  return lerp(s.peak, 40, Math.pow(clamp01(ch / coolH), 0.62));
}

export function atmosphereAt(s, T, rising) {
  if (!rising) return clamp01(s.reduction * 0.35);
  return T >= s.reduceFrom ? clamp01(s.reduction) : 0;
}
