// ============================================================
//  CELADON — the Reach, its people, and what they want made
// ============================================================

// Which glaze can be asked to show which effect. A generated brief may
// only ask for one the glaze it names can actually produce.
import { EFFECTS_FOR } from '../sim/glaze.js';

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

/**
 * The ladder, rescaled when the campaign doubled.
 *
 * These numbers were set against twelve commissions worth 2365 of base
 * standing. There are twenty-four now, worth 4993, and appraise pays
 * standing as base * payMultiplier * 0.9 — about 1.81 for perfect work.
 * Left alone, the top rung was crossed at the fourteenth commission on
 * good work and by a player scraping through every job in the game, so
 * 'Of the Ninth Ash' sat in the corner of the screen for the last ten
 * jobs and was then solemnly awarded by c12, which is the commission
 * that is supposed to confer it.
 *
 * Scaled by 2.2, which keeps the shape of the old ladder exactly and
 * puts the last rung back where it was: reachable by finishing the
 * campaign well, and not by finishing it badly. campaign.mjs holds
 * both ends of that down.
 */
export const RANKS = [
  { at: 0, name: 'Unproven' },
  { at: 260, name: 'Barrel Hand' },
  { at: 700, name: 'Wheelwright' },
  { at: 1350, name: 'Ash-Sworn' },
  { at: 2300, name: 'Guild Hand' },
  { at: 3600, name: 'Kilnmaster' },
  { at: 5500, name: 'Of the Ninth Ash' },
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
                 peel, opal, metal.  NOT matureOnly: it was listed here
                 for a long time and has never been implemented in
                 hasEffect, so a brief asking for it can never be met.
     atmos       'reduction' | 'oxidation'
     body        clay body id: ashstone, blackhill, porcelain, saltflat
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
    id: 'c1a',
    title: 'A Plate Is Not A Shallow Bowl',
    from: 'Dorn Kessick, assayer at the sieve-house, owns a straight edge',
    pay: 90, rep: 35,
    text:
      '"I weigh sieved ash on these and read the colour off the floor, so the floor has to ' +
      'be flat — flat, not nearly flat. Every plate I have been sold in nine years humped ' +
      'up in the middle before it was dry. Compress the base until you are sick of it, and ' +
      'then compress it again."',
    require: { form: 'plate', minH: 3, maxH: 7, minD: 20 },
    lore: {
      h: 'Pencilled on the shed wall beside the wheel, in your grandmother\'s hand',
      p:
        '"A plate cracks in an S and the S is yours, not the fire\'s. Every part of that floor ' +
        'was dragged outward under your fingers and lies in the direction it went — except ' +
        'the pinhead at the centre, which never moved at all. Dry it, and the two of them ' +
        'pull apart along the seam between them."',
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
    id: 'c2a',
    title: 'Heavy Enough Empty',
    from: 'Corrin Slate, who pickles what the ash still lets grow',
    pay: 105, rep: 45,
    text:
      '"Everything I put down has to come back out, and it comes out with my hand, so do ' +
      'not choke the neck — the last one I was sold I cannot get past the shoulder to ' +
      'scrub. Keep the wall honest as well. I lift these full, off a high shelf, ' +
      'one-handed."',
    require: { form: 'jar', minH: 12, maxH: 18, maxWall: 0.9 },
    lore: {
      h: 'On what a wall lets through',
      p:
        '"A body taken forty degrees short of vitrification is not a container, it is a slow ' +
        'sieve. It will hold brine for a week and sweat it for a year, and the salt comes ' +
        'back out through the glaze in white whiskers that tell everyone exactly what you ' +
        'did."',
    },
  },
  {
    id: 'c2b',
    title: 'Proof Of The Sea',
    from: 'Anke Ost, who teaches letters at the ash-kitchen and is paying for this herself',
    pay: 125, rep: 60,
    text:
      '"There is a page in the book about the sea and fourteen children who think I ' +
      'invented it. Kingfisher, then, and starve the kiln — I have seen what that iron does ' +
      'with air in it, and amber proves nothing. Thick in the well and thin over the rim, ' +
      'so they can watch one glaze do two things and stop arguing with me."',
    require: { form: 'bowl', minH: 5, maxH: 8, minD: 13, glaze: 'celadon', atmos: 'reduction' },
    lore: {
      h: 'On losing it in the cooling',
      p:
        '"Iron changes its mind on the way down as readily as on the way up. Let a kiln ' +
        'breathe while it cools and it hands the oxygen straight back — the green you starved ' +
        'four hours for will be amber by morning, with nothing on the pot to say what ' +
        'happened. Brick the ports and let it come down hungry."',
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
    id: 'c4b',
    title: 'Nothing In It But White',
    from: 'Tessit Wray, who keeps what is left of the dry stores',
    pay: 165, rep: 105,
    text:
      '"Shino, and leave the damper alone — I have seen what Wick has done with his and I ' +
      'do not want ghosts on mine. Plain white, thick, pinholed, the way it comes when the ' +
      'fire is fed. An urn, and tall: it stands on a stone floor in a hall with a broken ' +
      'window, and I want the lip out where a hand can get under it."',
    require: { form: 'urn', glaze: 'shino', atmos: 'oxidation', minH: 20, maxWall: 0.8 },
    lore: {
      h: 'On why a shino is not a smooth glaze',
      p:
        '"It goes on thick because it barely melts, and it barely melts because it is mostly ' +
        'the clay it is standing on. What comes out is a glass that never finished becoming ' +
        'one — pinholed where the gas left it, crawled where it pulled away from itself, and ' +
        'lit from underneath. A shino that has come out flat and even has been overfired, and ' +
        'the potter has thrown away the only thing it had."',
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
    id: 'c6b',
    title: 'What Comes Out Of My Kiln',
    from: 'Hark Merrow, who packs the Guild kiln and sweeps out what runs',
    pay: 260, rep: 165,
    text:
      '"I set four hundred pots a week and I am the one who chisels the failures off my own ' +
      'shelves. Give me a bowl I can stack — foot true, wall even top to bottom, and ' +
      'nothing on it that is going to move. I do not care what colour it is. I care that ' +
      'the next one sits on it."',
    require: { form: 'bowl', minD: 18, maxWall: 0.62, noDefects: true },
    lore: {
      h: 'On setting a kiln',
      p:
        '"Pots are not stacked, they are wadded — three pellets of alumina and rice husk ' +
        'under every foot, because a glazed foot and a shelf become one object at temperature ' +
        'and stay that way. The wadding burns out and leaves three grey scars, and every old ' +
        'pot worth having carries them underneath. A foot with no marks on it was fired ' +
        'alone, by somebody who could afford to."',
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
    unlocks: { glaze: 'cobalt' },
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
    unlocks: { glaze: 'salt', body: 'saltflat' },
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
    unlocks: { glaze: 'raku', title: 'Guild Hand' },
    lore: {
      h: 'The mark itself',
      p: '"Two strokes and a dot: the wheel, the flame, and the speck of ash that started all of it. ' +
        'Painted in cobalt because cobalt is the one colour the fire cannot argue with."',
    },
  },
  {
    id: 'm2',
    title: 'Blue That Stays Where It Is Put',
    from: 'Bettony Rask, who dyes what wool still comes down off the high pasture',
    pay: 430, rep: 270,
    text:
      '"Guild Blue, and I want it flat — no pooling in the throwing rings, no thin patch on ' +
      'the shoulder where it has run off. I match dye lots for a living and I can see a ' +
      'quarter of a shade at ten paces. Tall enough to stand a hank in without bending it, ' +
      'and light enough that I can lift it wet."',
    require: { form: 'vase', glaze: 'cobalt', minH: 26, maxWall: 0.55 },
    lore: {
      h: 'On cobalt, and how little of it is wanted',
      p:
        '"Half a part in a hundred is a sky. Two parts is a night. Four is a black that has ' +
        'forgotten it was ever blue, and there is no way back down the scale — it is the one ' +
        'oxide that will not be thinned by anything except more glass. Weigh it on the ' +
        'smallest balance in the shed, and weigh it twice."',
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
    unlocks: { glaze: 'nuka' },
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
    unlocks: { glaze: 'kaki' },
    lore: {
      h: 'Why it is forbidden',
      p: '"Not because it is dangerous. Because it cannot be repeated. The Guild exists to make the fire ' +
        'predictable, and a raku pot is a confession that it never was."',
    },
  },
  {
    id: 'c7b',
    title: 'Grey Throws No Light',
    from: 'Perrin Rill, lampwright, who begrudges every wick',
    pay: 330, rep: 250,
    text:
      '"A jar in the straw-ash white, tall enough to stand a lamp inside it. Leave the ' +
      'damper open — I am selling light, and I want every part of that surface handing it ' +
      'back. Straw ash on its own, with nothing laid over it. A shade that eats a wick is a ' +
      'shade I do not sell twice."',
    require: { form: 'jar', glaze: 'nuka', atmos: 'oxidation', minH: 18, maxWall: 0.7 },
    lore: {
      h: 'On the white in straw ash',
      p:
        '"Grasses take silica up out of the ground and lay it down inside their own stalks in ' +
        'order to stand upright. Burn a field and what is left is very nearly silica and ' +
        'almost nothing else, which is why the ash of a field makes a white glaze and the ash ' +
        'of a forest makes a green one. There is no white in it anywhere. There is only ' +
        'silica that never finished dissolving."',
    },
  },
  {
    id: 'm1',
    title: 'Twenty-Six Across, And Flat',
    from: 'Ganner Sill, cook to the Ember Guild and no admirer of them',
    pay: 380, rep: 290,
    text:
      '"Everything I put on a table is grey. Give me a plate the colour of a persimmon — ' +
      'twenty-six across, and flat enough that a sauce does not all run to one side. Do not ' +
      'starve the kiln: hungry iron goes the colour of liver, and I will send it back."',
    require: { form: 'plate', minH: 4, maxH: 7, minD: 26, glaze: 'kaki', noDefects: true },
    lore: {
      h: 'On iron, coming back',
      p:
        '"An iron saturate carries more iron than the glass can dissolve, and on the way down ' +
        'it hands the surplus back. Below about a thousand degrees it surfaces as hematite, ' +
        'in plates too small to see, and that is the persimmon. Cool the same glaze fast and ' +
        'it never gets the chance — it stays black, it is a tenmoku, and nobody looking at ' +
        'the two would believe the recipe was the same."',
    },
  },
  {
    id: 'c13',
    title: 'Forty Pounds Of Seed',
    from: 'Halvard Onn, seedsman, who has no field',
    pay: 520, rep: 310,
    text:
      '"Forty pounds of hard wheat, nine winters old, and the only lot left in the Reach ' +
      'that still sprouts. Nuka on it — straw ash, which is the one part of a harvest I ' +
      'still have in any quantity. Vitrified, not merely glazed; if it takes up damp at the ' +
      'foot the whole lot is compost, and I do not have a second forty pounds."',
    require: { form: 'jar', glaze: 'nuka', minH: 22, maxWall: 0.62, noDefects: true },
    lore: {
      h: 'On lids, and why they are fired in place',
      p:
        '"Nothing leaves a kiln the shape it went in. A lid ground to fit a cold jar will not ' +
        'fit that same jar once both have been through the fire, because the two will not ' +
        'move the same way. So it is fired sitting in its own seat, with a smear of alumina ' +
        'between them so they cannot weld, and the pair go out of true together."',
    },
  },
  {
    id: 'm3',
    title: 'Match It',
    from: 'Sibbe Anrath, pledge-broker at Lower Fen, who has never returned a deposit',
    pay: 540, rep: 340,
    text:
      '"There is a cup in my window, pledged against four marks before the mountain ever ' +
      'opened, and nobody is coming back for it. Sea-green, rings all the way up, and a ' +
      'wall no heavier than the one it is standing next to. Make me its pair — shut the ' +
      'damper and keep it shut, and do not smooth the rings out, because the green has ' +
      'nowhere to sit but in them."',
    require: { form: 'cup', glaze: 'celadon', atmos: 'reduction', minH: 10, maxWall: 0.4, noDefects: true },
    lore: {
      h: 'On the half of a celadon that is not glaze',
      p:
        '"A celadon is a window with a little iron in it, and what you are looking at is the ' +
        'clay underneath. The same bucket over a grey body and over a white one gives two ' +
        'pots that will not sit on a shelf together. The Guild will sell you the recipe for ' +
        'almost nothing. It charges properly for the clay."',
    },
  },
  {
    id: 'c14',
    title: 'What She Can Carry',
    from: 'Ilma Vetch, who has sold the house',
    pay: 620, rep: 350,
    text:
      '"A plate, in porcelain — I am walking out and I will not carry stoneware a thousand ' +
      'miles. Celadon over it, and shut the damper. Thin enough that the lamp gets through ' +
      'the rim, or it is not porcelain, only expensive. It is not a keepsake; I intend to ' +
      'eat off it."',
    require: { form: 'plate', body: 'porcelain', glaze: 'celadon', atmos: 'reduction', minH: 4, maxH: 7, minD: 22, maxWall: 0.55 },
    lore: {
      h: 'Why the plate is the last thing they teach you',
      p:
        '"A cylinder carries its own weight down a wall. A plate carries it out across a ' +
        'floor a finger thick, and that floor is still moving after the hand has stopped. ' +
        'Compress it in the first minute or it will open along a long S three days later, in ' +
        'the drying, in the dark, when there is nothing whatever to be done about it."',
    },
  },
  {
    id: 'c15',
    title: 'Let It Run',
    from: 'Bern Gedd, clearing his mother\'s shed',
    pay: 740, rep: 400,
    text:
      '"Mother is dead and there is a barrel of tenmoku slip in her shed, mixed and dated ' +
      'and never used. A bottle, twenty-six at the least, thrown in Blackhill — she held ' +
      'that a smooth body gives you a stripe and a toothy one gives you fur. Thick coat, ' +
      'hot kiln, let it run. Not an urn; she was a potter, not an occasion."',
    require: { form: 'bottle', body: 'blackhill', glaze: 'tenmoku', effect: 'hare', minH: 26 },
    lore: {
      h: 'From Mirrin Gedd\'s firing book, two pages from the end',
      p:
        '"Tenmoku is more iron than the glass can hold. When it moves it comes apart into two ' +
        'liquids, one thin and one heavy, and the heavy one runs down the wall in threads and ' +
        'takes the iron with it. That is the fur. You cannot paint it and you cannot stop it. ' +
        'All you get to decide is how far it gets."',
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

/**
 * The work that comes after the campaign, for as long as you want it.
 *
 * Two things were wrong with it.
 *
 * The fee started at ninety marks. The commission immediately before it
 * pays nine hundred, so finishing the whole campaign was rewarded with a
 * ninety per cent pay cut and a return to the kind of job the game opens
 * with — the endless mode read as a demotion. It is anchored to where
 * the campaign actually leaves off now, and climbs from there.
 *
 * And a standing order asked for a form, a glaze, a height and a wall,
 * and never for anything else: no atmosphere, no clay, no effect, so
 * every job after the campaign was the same job with the nouns swapped.
 * It can ask for the rest of what the game simulates now — but only for
 * things that can actually happen. An effect is drawn from what the
 * chosen glaze can genuinely produce (EFFECTS_FOR), never from the whole
 * list, because a generated brief nobody can complete is worse than a
 * dull one.
 */
export function proceduralCommission(rng, n, unlockedGlazes, unlockedBodies) {
  const form = FORMS[rng.pick(Object.keys(FORMS))];
  const glaze = rng.pick(unlockedGlazes);
  const last = COMMISSIONS[COMMISSIONS.length - 1];

  const minH = Math.round((form.ratio > 1 ? 18 : 9) * (0.9 + rng() * 0.4));
  const require = {
    form: form.id,
    glaze,
    minH,
    maxWall: 0.95 - Math.min(0.3, n * 0.014),
  };

  // an effect, when the glaze in hand has one to give
  const canShow = EFFECTS_FOR[glaze] ?? [];
  if (canShow.length && rng() < 0.45) require.effect = rng.pick(canShow);

  // an atmosphere, sometimes, and never one that fights the effect
  if (!require.effect && rng() < 0.3) require.atmos = rng() < 0.5 ? 'reduction' : 'oxidation';

  // and occasionally a clay, out of the ones actually in the shed
  const bodies = (unlockedBodies ?? []).filter((b) => BODIES.some((x) => x.id === b));
  if (bodies.length > 1 && rng() < 0.25) require.body = rng.pick(bodies);

  return {
    id: `p${n}`,
    procedural: true,
    title: `${form.name} — ${['Standing Order', 'Repeat', 'Commission', 'Private Order'][n % 4]} ${n}`,
    from: rng.pick(PATRONS),
    pay: Math.round(last.pay * 0.52 + n * 24),
    rep: Math.round(last.rep * 0.42 + n * 14),
    text: `"${rng.pick(ASKS)}"`,
    require,
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
