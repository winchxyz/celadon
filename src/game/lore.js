// ============================================================
//  CELADON — the Reach, its people, and what they want made
// ============================================================

export const TITLE = 'CELADON';
export const SUBTITLE = 'THE LONG ASH';

export const OPENING = [
  `Nine winters ago the mountain called <em>Ivorine</em> opened along its whole length and did not stop. ` +
  `What came out was not lava. It was ash, and it is still coming.`,

  `The sun is up there somewhere. Nobody in the Reach has seen it since they were a child. ` +
  `Wheat will not set. Wood burns badly. The only reliable heat left in the world is in the kilns, ` +
  `and the only people permitted to keep one lit are the Ember Guild.`,

  `You have your grandmother's wheel, her kiln, her ash barrel, and her mark. ` +
  `You do not yet have the right to use the mark.`,

  `There is one mercy in it. Sieved and washed, the ash that is killing the Reach is the finest ` +
  `glaze flux anyone has ever fired. <em>The thing that ended the world makes the most beautiful ` +
  `surfaces it has ever seen.</em>`,
];

/* ------------------------------------------------------------------ */
/*  Vessel archetypes                                                  */
/*  profile(t) -> radius as a fraction of the widest point, t=0 foot   */
/* ------------------------------------------------------------------ */

export const FORMS = {
  bowl: {
    id: 'bowl', name: 'Bowl', ratio: 0.48, tol: 0.30,
    hint: 'Wide, open, and it must sit true. All the difficulty is in the curve.',
    profile: (t) => 0.30 + 0.70 * Math.pow(t, 0.62),
  },
  chawan: {
    id: 'chawan', name: 'Tea Bowl', ratio: 0.66, tol: 0.30,
    hint: 'Half a bowl, half a cup. It should feel like it wants to be held.',
    profile: (t) => 0.52 + 0.48 * Math.pow(t, 0.8) - 0.10 * Math.sin(Math.PI * t),
  },
  cup: {
    id: 'cup', name: 'Cup', ratio: 1.05, tol: 0.26,
    hint: 'Straight-sided and thin. Nowhere for a mistake to hide.',
    profile: (t) => 0.80 + 0.20 * t,
  },
  jar: {
    id: 'jar', name: 'Jar', ratio: 1.02, tol: 0.24,
    hint: 'Belly low, shoulder high, and the neck collared in at the last moment.',
    profile: (t) => 0.42 + 0.58 * Math.sin(Math.PI * Math.min(1, 0.18 + t * 0.86)),
  },
  vase: {
    id: 'vase', name: 'Vase', ratio: 1.70, tol: 0.22,
    hint: 'Height is the whole point. Get the wall even or it will not stand.',
    profile: (t) => 0.46 + 0.54 * Math.exp(-((t - 0.32) ** 2) / 0.10) - 0.22 * Math.pow(t, 2.4),
  },
  bottle: {
    id: 'bottle', name: 'Bottle', ratio: 1.95, tol: 0.20,
    hint: 'A full belly, a hard shoulder, and a neck you have to collar down blind.',
    profile: (t) =>
      t < 0.55
        ? 0.55 + 0.45 * Math.sin(Math.PI * (0.22 + t * 0.78))
        : Math.max(0.17, 1.0 - 1.55 * (t - 0.55)),
  },
  urn: {
    id: 'urn', name: 'Urn', ratio: 1.28, tol: 0.22,
    hint: 'Heavy and generous below, and then a lip that flares back out.',
    profile: (t) =>
      0.40 + 0.60 * Math.sin(Math.PI * Math.min(1, 0.14 + t * 0.74)) + 0.26 * Math.pow(Math.max(0, t - 0.86) / 0.14, 2),
  },
  plate: {
    id: 'plate', name: 'Plate', ratio: 0.20, tol: 0.36,
    hint: 'Almost no height at all. The whole test is whether the floor stays flat.',
    profile: (t) => 0.42 + 0.58 * Math.pow(t, 0.35),
  },
};

/**
 * The size the brief is actually asking for, in centimetres. One
 * definition, used by the target ghost in the scene, the silhouette
 * panel and the scales that weigh out the ball — so all three agree.
 */
export function targetSize(req = {}) {
  const form = FORMS[req.form] ?? FORMS.jar;
  const lo = req.minH ?? (form.ratio > 1 ? 18 : 9);
  const hi = req.maxH ?? lo * 1.55;
  const H = (lo + hi) * 0.5;
  const D = Math.max(req.minD ?? 0, req.maxD ? Math.min(req.maxD, H / form.ratio) : H / form.ratio);
  return { form, H, D, wall: req.maxWall ? req.maxWall * 0.62 : 0.5 };
}

/* ------------------------------------------------------------------ */
/*  Clay bodies                                                        */
/* ------------------------------------------------------------------ */

export const BODIES = [
  {
    id: 'ashstone', name: 'Ashstone', unlock: 0,
    desc: 'The common body. Half river silt, half sieved fall. Forgiving, coarse, and grey-brown when fired.',
    color: 0xc07f56, color2: 0x9a5a3c, grog: 0.55,
    plastic: 1.0, strength: 1.0, coe: 6.4, price: 4,
  },
  {
    id: 'blackhill', name: 'Blackhill', unlock: 1,
    desc: 'Iron-black and toothy. Strong enough to throw tall, but it fights the hand and dries fast.',
    color: 0x7a5548, color2: 0x5f4136, grog: 0.80,
    plastic: 0.78, strength: 1.32, coe: 6.0, price: 9,
  },
  {
    id: 'porcelain', name: 'Reach Porcelain', unlock: 4,
    desc: 'White, translucent, and utterly without mercy. It slumps if you look away.',
    color: 0xf7ead6, color2: 0xe6d4ba, grog: 0.06,
    plastic: 1.22, strength: 0.62, coe: 6.9, price: 26,
  },
  {
    id: 'saltflat', name: 'Saltflat Marl', unlock: 6,
    desc: 'Dug from the dry sea bed. Full of soluble salts that flash orange in reduction.',
    color: 0xd9a86c, color2: 0xb8834f, grog: 0.40,
    plastic: 0.9, strength: 0.94, coe: 6.6, price: 15,
  },
];

/* ------------------------------------------------------------------ */
/*  Standing                                                           */
/* ------------------------------------------------------------------ */

export const RANKS = [
  { at: 0, name: 'Unproven' },
  { at: 120, name: 'Barrel Hand' },
  { at: 320, name: 'Wheelwright' },
  { at: 620, name: 'Ash-Sworn' },
  { at: 1050, name: 'Guild Hand' },
  { at: 1650, name: 'Kilnmaster' },
  { at: 2500, name: 'Of the Ninth Ash' },
];

export function rankFor(rep) {
  let r = RANKS[0];
  for (const k of RANKS) if (rep >= k.at) r = k;
  return r;
}

/* ------------------------------------------------------------------ */
/*  Commissions — the campaign                                         */
/* ------------------------------------------------------------------ */
/*
   require: any of
     form        archetype id
     minH, maxH  cm
     minD, maxD  cm
     maxWall     cm  (thinness test)
     glaze       glaze id that must be the dominant coat
     effect      one of: crystal, oilspot, hare, copperRed, carbon, craze,
                 peel, opal, metal, matureOnly
     atmos       'reduction' | 'oxidation'
     noDefects   true
*/

export const COMMISSIONS = [
  {
    id: 'c1',
    title: 'Something To Drink From',
    from: 'Hesta Vaunt, your grandmother\'s neighbour',
    pay: 95, rep: 40,
    text:
      '"I am not going to pretend this is an honour. Mine cracked. You are the only wheel on this street ' +
      'and I am eighty-one. Make me a cup. I do not care what colour."',
    require: { form: 'cup', minH: 8, maxH: 14, maxWall: 0.95 },
    lore: {
      h: 'From the Ember Guild charter, clause one',
      p: '"A kiln once lit is Guild property, wherever it stands and whoever built it. ' +
        'A kiln allowed to go out is a crime against the Reach and shall be answered as such."',
    },
  },
  {
    id: 'c2',
    title: 'Ninety Bowls, One At A Time',
    from: 'The Almoner of the Dry Quarter',
    pay: 130, rep: 55,
    text:
      '"The queue at the ash-kitchen is four hundred long and we are serving into cupped hands. ' +
      'Bring me one bowl. If it is good I will order eighty-nine more and you will hate me."',
    require: { form: 'bowl', minD: 13, maxWall: 0.8 },
    unlocks: { glaze: 'tenmoku', body: 'blackhill' },
    lore: {
      h: 'The Almoner, later that week',
      p: '"You would not think a shape could keep someone alive. It cannot. But a person who is handed ' +
        'a made thing eats differently from a person who is handed a handful, and I will not be argued out of it."',
    },
  },
  {
    id: 'c3',
    title: 'A Black Bowl For The Tea Master',
    from: 'Oren Sulk, tea master, insufferable',
    pay: 110, rep: 80,
    text:
      '"Tenmoku. Iron black, rust on the lip where it thins, and the foot left raw so I can see what body you used. ' +
      'If it is even and boring I will pay you and never speak to you again."',
    require: { form: 'chawan', glaze: 'tenmoku', minD: 11, maxWall: 0.68, noDefects: true },
    unlocks: { glaze: 'shino' },
    lore: {
      h: 'Oren Sulk, on being asked why black',
      p: '"Because green tea in a black bowl is the last green thing anyone in this city will see today. ' +
        'Do not make me explain it again."',
    },
  },
  {
    id: 'c4',
    title: 'The Smoke Jar',
    from: 'Wick, who sells things that are not strictly legal',
    pay: 130, rep: 85,
    text:
      '"Shino. Carbon trapped, properly — grey ghost-marks where the flame went and cream where it did not. ' +
      'Reduce it early and hold it. Do not give me a clean pot, I can buy clean pots."',
    require: { form: 'jar', glaze: 'shino', effect: 'carbon', atmos: 'reduction' },
    unlocks: { glaze: 'oxblood', body: 'porcelain' },
    lore: {
      h: 'Scratched inside a Guild kiln door',
      p: '"Reduction is not a setting. It is an argument with the fire about who gets the air, ' +
        'and the fire takes it out of the pots."',
    },
  },
  {
    id: 'c5',
    title: 'Oxblood, Or Nothing',
    from: 'Marda Kell, Guild assessor',
    pay: 210, rep: 140,
    text:
      '"Copper red. Half a percent copper, the kiln shut down hard from nine-eighty, and the nerve to hold it there. ' +
      'Every apprentice in the Reach has tried this. Two have managed it. Bring me a bottle."',
    require: { form: 'bottle', glaze: 'oxblood', effect: 'copperRed', atmos: 'reduction', minH: 20 },
    unlocks: { glaze: 'chun' },
    lore: {
      h: 'Marda Kell, Guild assessor, private notes',
      p: '"The colour is not in the glaze. It is a suspension of copper metal so fine that it stops being ' +
        'a metal and becomes a colour. Let one breath of air in and it goes green and you have a leaf, ' +
        'not a wound. Nobody sensible attempts this."',
    },
  },
  {
    id: 'c6',
    title: 'The Sky, Reproduced',
    from: 'Ivo Ferrant, cartographer of a world that no longer looks like his maps',
    pay: 240, rep: 155,
    text:
      '"Chun. The opal blue. I want to put it on my desk and remember what was up there. ' +
      'Cool it slowly. I am aware there is no blue pigment in it. That is the part I like."',
    require: { form: 'vase', glaze: 'chun', effect: 'opal', minH: 22 },
    unlocks: { glaze: 'crystal' },
    lore: {
      h: 'Ivo Ferrant, at the door, not going in',
      p: '"My last commission was a globe. I had to leave the top third grey. A patron asked whether that was ' +
        'artistic licence. I told him it was a survey."',
    },
  },
  {
    id: 'c7',
    title: 'Flowers That Will Not Wilt',
    from: 'The Widow Sarn',
    pay: 320, rep: 200,
    text:
      '"Zinc crystal. Actual flowers in the glass, not a suggestion of them. My husband is nine years dead ' +
      'and there has not been a flower in this city since. Hold the kiln at eleven hundred and be patient."',
    require: { form: 'vase', glaze: 'crystal', effect: 'crystal', minH: 20 },
    unlocks: { glaze: 'nuka' },
    lore: {
      h: 'On growing crystals',
      p: '"Zinc silicate is a bad glass and a magnificent crystal. Hold it just below melting and it stops ' +
        'pretending. Every flower starts as one speck of dust that would not dissolve."',
    },
  },
  {
    id: 'c8',
    title: 'Oil On Black Water',
    from: 'Oren Sulk, again, insufferably',
    pay: 360, rep: 210,
    text:
      '"Silver spots on tenmoku. Iron boiling out and freezing on the surface. Take it to thirteen hundred ' +
      'and do not flinch. You will probably ruin it. Do it anyway."',
    require: { form: 'chawan', glaze: 'tenmoku', effect: 'oilspot', minPeak: 1290 },
    unlocks: { glaze: 'kaki', body: 'saltflat' },
    lore: {
      h: 'Oren Sulk, paying up',
      p: '"That is a bowl that happened, not a bowl that was made. I want you to understand the difference ' +
        'because it is the only compliment I have ever given."',
    },
  },
  {
    id: 'c9',
    title: 'The Guild Mark',
    from: 'Marda Kell, formally this time',
    pay: 450, rep: 300,
    text:
      '"An urn, tall, in Guild Blue, and it must be flawless. No craze, no crawl, no run onto the shelf. ' +
      'If it survives you may paint your grandmother\'s mark on the foot and mean it."',
    require: { form: 'urn', glaze: 'cobalt', minH: 26, maxWall: 0.62, noDefects: true },
    unlocks: { glaze: 'cobalt', title: 'Guild Hand' },
    lore: {
      h: 'The mark itself',
      p: '"Two strokes and a dot: the wheel, the flame, and the speck of ash that started all of it. ' +
        'Painted in cobalt because cobalt is the one colour the fire cannot argue with."',
    },
  },
  {
    id: 'c10',
    title: 'Orange Peel',
    from: 'The saltmen of the dry sea',
    pay: 400, rep: 240,
    text:
      '"We throw salt into the firebox and let it find the pot itself. No brush touches it. ' +
      'Bring a bottle to the shore firing and we will show you what vapour does to a shoulder."',
    require: { form: 'bottle', glaze: 'salt', effect: 'peel', minH: 24 },
    unlocks: { glaze: 'salt' },
    lore: {
      h: 'What salt does',
      p: '"Sodium chloride comes apart above a thousand and the sodium goes looking for silica. ' +
        'It finds it in the clay. The glaze is not applied — it is grown, out of the pot, by the fire."',
    },
  },
  {
    id: 'c11',
    title: 'Taken Out Alive',
    from: 'Nobody. This one is not a commission.',
    pay: 300, rep: 260,
    text:
      'The raku firing is not a Guild technique and it is not permitted. You open the kiln at nine hundred ' +
      'and take the pot out while it is still moving, and bury it in straw, and it either survives or it does not.',
    require: { form: 'chawan', glaze: 'raku', effect: 'metal', maxPeak: 1010 },
    unlocks: { glaze: 'raku' },
    lore: {
      h: 'Why it is forbidden',
      p: '"Not because it is dangerous. Because it cannot be repeated. The Guild exists to make the fire ' +
        'predictable, and a raku pot is a confession that it never was."',
    },
  },
  {
    id: 'c12',
    title: 'A Vessel For The Ash Itself',
    from: 'The Ember Guild, in full assembly',
    pay: 900, rep: 600,
    text:
      '"One jar. Ninth Ash glaze and nothing else — the fall, sieved and washed and put back on a pot. ' +
      'It must be the best thing you have ever made. It goes into the mountain, and it stays there."',
    require: { form: 'jar', glaze: 'ash', minH: 24, maxWall: 0.5, noDefects: true, minScore: 78 },
    unlocks: { title: 'Of the Ninth Ash' },
    lore: {
      h: 'The last page of the charter, added in a different hand',
      p: '"We could not stop it and we could not leave. So we did the only thing left: we learned to fire it. ' +
        'Nine winters of sky, ground fine, melted at twelve-eighty, and it comes back as a green ' +
        'that nobody living has a name for. Put that in the mountain and let it argue with the mountain."',
    },
  },
];

/* ------------------------------------------------------------------ */
/*  Endless commissions after the campaign                             */
/* ------------------------------------------------------------------ */

const PATRONS = [
  'The Almoner of the Dry Quarter', 'Oren Sulk, tea master', 'Wick, of the low market',
  'Marda Kell, Guild assessor', 'The Widow Sarn', 'Ivo Ferrant, cartographer',
  'The saltmen of the dry sea', 'Hesta Vaunt', 'The ash-kitchen at Lower Fen',
  'A collector who will not give a name',
];
const ASKS = [
  'It should look like it has always been there.',
  'Even. Quiet. Nothing clever.',
  'Make it thin enough that I can see the lamp through the rim.',
  'I want to be able to put both hands round it in winter.',
  'Do not sign it. I want to be able to say I do not know who made it.',
  'The last one you sent me was too careful.',
  'Something my daughter will fight her brother over.',
  'It has to hold four pints and not look like it does.',
];

export function proceduralCommission(rng, n, unlockedGlazes) {
  const formIds = Object.keys(FORMS);
  const form = FORMS[rng.pick(formIds)];
  const glaze = rng.pick(unlockedGlazes);
  const scale = 1 + n * 0.04;
  const minH = Math.round((form.ratio > 1 ? 18 : 9) * (0.9 + rng() * 0.4));
  return {
    id: `p${n}`,
    procedural: true,
    title: `${form.name} — ${['Standing Order','Repeat','Commission','Private Order'][n % 4]} ${n}`,
    from: rng.pick(PATRONS),
    pay: Math.round((90 + n * 26) * scale),
    rep: Math.round((60 + n * 12) * scale),
    text: `"${rng.pick(ASKS)}"`,
    require: {
      form: form.id,
      glaze,
      minH,
      maxWall: 0.95 - Math.min(0.3, n * 0.014),
    },
  };
}

/* ------------------------------------------------------------------ */
/*  Codex fragments unlocked by play, not by commissions               */
/* ------------------------------------------------------------------ */

export const CODEX = [
  {
    id: 'centring', when: (s) => s.stats.centred > 0,
    h: 'On centring',
    p: 'A mound that is out of true by a millimetre at the wheel head is out by a centimetre at the rim, ' +
      'and by the whole pot by the third pull. Nothing you do afterwards fixes it. Everything you do afterwards ' +
      'makes it worse.',
  },
  {
    id: 'collapse', when: (s) => s.stats.collapses > 0,
    h: 'On the collapse',
    p: 'Wet clay carries weight in compression and almost nothing in tension. A wall that is thin, tall and wet ' +
      'is holding itself up by friction and optimism. When it goes it goes in a spiral, because the wheel is still turning.',
  },
  {
    id: 'water', when: (s) => s.stats.drowned > 0,
    h: 'On too much water',
    p: 'Water is what lets the clay move under your hand and it is also what stops it standing up. ' +
      'The good potters use less than you think and the great ones use less than that.',
  },
  {
    id: 'ash', when: (s) => s.firings > 2,
    h: 'On wood ash',
    p: 'Plant ash is roughly a fifth potash, a fifth lime, a third silica and a scatter of iron and phosphorus. ' +
      'It is, by accident, almost exactly a glaze. Every ash glaze in the world is a rediscovery of ' +
      'something a bonfire did to a pot four thousand years ago.',
  },
  {
    id: 'shrink', when: (s) => s.firings > 0,
    h: 'On shrinkage',
    p: 'A pot leaves the wheel and then spends the rest of its life getting smaller. Five parts in a hundred ' +
      'as it dries, four more in the bisque, five again in the glaze fire. Throw it bigger than you want it. ' +
      'Everyone forgets, once.',
  },
  {
    id: 'craze', when: (s) => s.crazed > 0,
    h: 'On crazing',
    p: 'The glass and the body cool at different rates and the glass, being the weaker of the two, ' +
      'gives up first. It is a flaw. It has also been sold as a feature for eight hundred years, ' +
      'and there is a word for it in every language that fires clay.',
  },
  {
    id: 'master', when: (s) => s.best >= 90,
    h: 'On the good one',
    p: 'Every potter has perhaps four pots in a lifetime that came out the way the fire wanted rather than ' +
      'the way they wanted. You do not get to choose which. You only get to keep making pots until one happens.',
  },
];
