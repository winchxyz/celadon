import { Clay, NS } from './src/sim/clay.js';
import { ProfileBuffer, K, RIM, SIDE } from './src/render/potMesh.js';
import { GlazeField, GW, GH } from './src/sim/glazeField.js';
import { FORMS } from './src/game/lore.js';
const c = new Clay({ mass: 1400, seed: 4242, wobble: 0 });
c.sculpt(FORMS.jar.profile, 21.5, 19.5, 0.36, 0.8);
const pb = new ProfileBuffer();
pb.update(c);
const f = new GlazeField();
f.bindProfile(pb);
// replicate bindProfile's k walk to recover k per j
const K2=pb.count, pr=pb.pr, py=pb.py;
const arc=new Float32Array(K2); let tot=0;
for(let k=1;k<K2;k++){tot+=Math.hypot(pr[k]-pr[k-1],py[k]-py[k-1]);arc[k]=tot;}
let k=0; const kk=[];
for(let j=0;j<GH;j++){const t=j/(GH-1);const target=t*tot;while(k<K2-2&&arc[k+1]<target)k++;kk.push(k);}
console.log('arc of base disc (k=0..2):',arc[2].toFixed(3),' arc[3]',arc[3].toFixed(3),' arc[5]',arc[5].toFixed(3),'tot',tot.toFixed(3));
console.log('r0=pr[2]/0.985 ->', (pr[2]/0.985).toFixed(3), 'py[2]',py[2].toFixed(4));
for(let j=0;j<26;j++) console.log('j='+j,'k='+kk[j],'canonSide='+pb.sideOf(kk[j]),'mSide='+f.mSide[j],'y='+f.mY[j].toFixed(3),'r='+f.mR[j].toFixed(3),'mDown='+f.mDown[j].toFixed(3));
// mismatch count between mSide and canonical
let mism=0; for(let j=0;j<GH;j++) if(f.mSide[j]!==pb.sideOf(kk[j])) mism++;
console.log('rows where mSide != canonical sideOf:', mism);
// how many rows are canonical BASE
let cb=0; for(let j=0;j<GH;j++) if(pb.sideOf(kk[j])===SIDE.BASE) cb++;
console.log('rows canonically BASE:',cb);
