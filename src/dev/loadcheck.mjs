// Import every module that does not need a live WebGL context, so a
// typo or a bad import shows up without a browser.
const mods = [
  '../core/util.js', '../sim/clay.js', '../sim/glaze.js', '../sim/glazeField.js',
  '../render/glsl.js', '../render/potMesh.js', '../render/potMaterial.js',
  '../render/textures.js', '../game/lore.js', '../game/scoring.js',
  '../game/save.js', '../ui/hud.js', '../game/game.js',
];
let bad = 0;
for (const m of mods) {
  try { await import(m); console.log('  ok    ' + m); }
  catch (e) { bad++; console.log('  FAIL  ' + m + '  ->  ' + e.message); }
}
// and a few things that must exist
const { targetSize, COMMISSIONS } = await import('../game/lore.js');
const { suggestedMass } = await import('../game/game.js');
const t = targetSize(COMMISSIONS[0].require);
console.log(`\n  targetSize(cup) = ${t.H.toFixed(1)} x ${t.D.toFixed(1)} cm, wall ${t.wall.toFixed(2)}`);
console.log(`  suggestedMass(cup) = ${suggestedMass(COMMISSIONS[0].require)} g`);
console.log(bad ? `\n  ${bad} module(s) failed\n` : '\n  all modules load\n');
