// ============================================================
//  CELADON — the palette
//
//  Every colour in the game is here, and nowhere else.
//
//  The room used to be built out of eighteen separate browns. Not
//  a scheme — the same swatch dragged up and down a value slider,
//  which is why the frame read as mud however it was lit. A warm
//  light falling on warm walls in a warm room is not warmth; it is
//  a sepia photograph. Warmth is a *relationship*, and it needs
//  something cool to be warm against.
//
//  So the room is cool and the light is warm:
//
//    - the architecture — walls, floor, ceiling, stone — is a
//      desaturated slate with green in it. It is the ground the
//      pot sits against, and it is never the subject.
//    - the clay is the most saturated thing in the frame, always.
//      Nothing else is allowed to compete with it.
//    - the woodwork sits between them, pushed toward plum so it is
//      a different HUE from the clay and not merely a darker one.
//    - celadon — the glaze the game is named after — is the accent.
//      It appears on finished work and in the interface and almost
//      nowhere else, which is what makes it read as special.
//
//  And the whole thing is keyed HIGH. The first pass at this pulled
//  the room down into a dark box on the theory that a dark ground
//  makes the hero pop — which is true of a thriller and wrong here.
//  Every game this one wants to stand next to is bright and airy;
//  dimming the studio just traded a brown cave for a green one. The
//  hero reads because it is the most SATURATED thing in the frame,
//  not because everything else is in shadow.
// ============================================================

/** Surface albedo. What a thing IS, before any light touches it. */
export const P = {
  /* -- the architecture: cool slate-green, and deliberately dim ---- */
  wall:       0xb3c2bb,   // plaster, mid — the pot has to lift off this
  wallWarm:   0xc0c9be,   // the sunlit strip under the window
  floor:      0x93887a,   // warm, and quieter than the wheel standing on it
  ceiling:    0x63736f,   // darkest plane in the room
  stone:      0x87958f,
  wheel:      0x66807e,   // the cast head: the dark disc the pot stands on

  /* -- woodwork: plum-brown, a different hue from the clay --------- */
  woodDark:   0x5c3f36,   // wheel frame, shelf uprights
  wood:       0x7a5344,   // beams, bench legs
  woodWarm:   0x9a6c53,   // the bench top and splash pan, worn pale by use

  /* -- clay: the hero. The most saturated thing in the game -------- */
  clay:       0xc4693c,   // raw body, wet
  clayPale:   0xd99a6b,   // dried, or a slab dusted with grog
  clayDeep:   0x8f4526,   // in shadow, and the trimmings
  kiln:       0xb0714a,   // the kiln's brick: fired clay, warmer than the body

  /* -- celadon: the accent, and the reason for the title ----------- */
  celadon:    0x6fbda4,
  celadonPale:0x9fd6c4,
  celadonDeep:0x3f7d6c,

  /* -- everything else -------------------------------------------- */
  refractory: 0x4b463f,   // a kiln shelf under its coat of wash
  contact:    0x121d1c,   // the ambient occlusion where a foot meets a wheel
  steel:      0x8fa3a0,   // tools: cool, so they read as not-clay
  iron:       0x36403f,
  slip:       0x8a7561,
  ash:        0x9aa5a2,

  /* -- light: warm, and the only warmth in the room ---------------- */
  bounce:     0xa9c2c4,   // the plaster throwing the window back at the room
  bounceFar:  0xc6cfc2,   // and the opposite wall doing the same
  look:       0xf0ece4,   // the potter tipping a piece toward the light
  lamp:       0xffb862,   // the practical over the wheel — THE light
  bulb:       0xffd9a0,
  day:        0xb6d2e2,   // north window: cool, quiet, and the shadow caster
  fire:       0xff6a1e,
  ember:      0xff8a3a,

  /* -- ambient: cool sky, warm bounce off the floor ---------------- */
  ambSky:     0xdfeeee,
  ambGround:  0x9b7f68,

  /* -- the void behind everything --------------------------------- */
  void:       0x2b3a3a,
};

/**
 * The seven glazes on the shelf, and in the glazing room.
 *
 * Muted on purpose. These sat at full saturation and the finished work
 * on the rack shouted down the wet pot on the wheel — which is exactly
 * backwards, because the piece under your hands is the subject of every
 * frame in the game. Nothing here is allowed to be more saturated than
 * the clay.
 */
export const GLAZES = [
  0x7ab5a0,  // celadon
  0x3a4550,  // tenmoku, near black-blue
  0xd9cdb4,  // shino, a warm white
  0x9b4a3c,  // copper red
  0x93a07a,  // ash green
  0x7d97b8,  // cobalt
  0xa9704e,  // iron saturate
];
