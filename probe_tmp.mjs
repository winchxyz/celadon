import { Clay, NS } from './src/sim/clay.js';
import { ProfileBuffer, K, RIM } from './src/render/potMesh.js';
import { GlazeField, GW, GH } from './src/sim/glazeField.js';
import { FORMS } from './src/game/lore.js';

const c = new Clay({ mass: 1400, seed: 4242, wobble: 0 });
c.sculpt(FORMS.jar.profile, 21.5, 19.5, 0.36, 0.8);
const pb = new ProfileBuffer();
pb.update(c);
const f = new GlazeField();
f.bindProfile(pb);

console.log('NS', NS, 'RIM', RIM, 'K', K, 'pb.count', pb.count, 'arcTotal', f.arcTotal.toFixed(3), 'topY', f.topY.toFixed(3));
const counts = {0:0,1:0,2:0,3:0};
for (let j=0;j<GH;j++) counts[f.mSide[j]]++;
console.log('mSide counts (0 outer,1 rim,2 inner,3 base):', JSON.stringify(counts));
let prev=-1;
for (let j=0;j<GH;j++){ if (f.mSide[j]!==prev){ console.log('  first j='+j+' side='+f.mSide[j]+' y='+f.mY[j].toFixed(3)+' r='+f.mR[j].toFixed(3)); prev=f.mSide[j]; } }
console.log('j=159 side',f.mSide[159],'y',f.mY[159].toFixed(3),'r',f.mR[159].toFixed(3));
