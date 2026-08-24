import { game, rig, point, step, aim, dragCm, dragPx, outwardPx, screenOf, radiiAt, M } from './realgame.mjs';
const c = () => game.clay;
for (let i=0;i<5;i++){ const R=c().maxR;
  dragCm(R*0.95,1.2,R*0.80,c().height*0.85,0.5); dragCm(R*0.80,c().height*0.85,R*0.95,1.2,0.5); }
for (let i=0;i<10 && !c().isOpen();i++){ dragCm(0.25,c().height*0.92,0.35,1.1,0.5); dragCm(0.35,1.1,c().maxR*0.62,1.2,0.6); }
console.log('\n  DOES A SIDEWAYS DRAG STILL WIDEN, AS THE CAMERA TILTS DOWN?\n');
console.log('   phi    wall moved   height    verdict');
for (const phi of [1.26, 1.00, 0.80, 0.62, 0.50, 0.40, 0.30]) {
  rig.goalPhi = phi; rig.update(0.016); step(2);
  const y = Math.max(1.5, c().height * 0.5);
  const ring = c().sectionAt(y);
  const wallOf = i => (c().ri[i] + c().ro[i]) * 0.5;
  const w0 = wallOf(ring), h0 = c().height;
  const [x0, y0] = screenOf(w0, y);
  point(x0, y0); game._updateToolPoint();
  const [ux, uy] = outwardPx();
  dragPx(x0, y0, ux * 70, uy * 70, 0.7);
  const moved = wallOf(ring) - w0, grew = c().height - h0;
  console.log(`   ${phi.toFixed(2)}   ${(moved>=0?'+':'')+moved.toFixed(2)} cm      ${(grew>=0?'+':'')+grew.toFixed(2)}    ` +
    (moved > 0.25 && grew < 0.4 ? 'widens' : moved > 0.25 ? 'widens but grows' : 'DEAD'));
}
console.log('');
