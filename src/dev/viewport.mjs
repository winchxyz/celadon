// ============================================================
//  Does the canvas cover the screen it is on?
//
//  Reported from an iPad, twice, and the second report is what solved
//  it: the screen flashed WHITE in the desktop version of the site and
//  BLACK in the mobile one. One fault cannot have two colours, but one
//  fault seen through two different backgrounds can — and that is what
//  it was. A frame where the canvas does not cover its box shows
//  whatever is behind the page in the gap, and the two modes disagree
//  about how wide the page is.
//
//  Two things had to be true and neither was:
//
//    the canvas must be sized from the VISUAL viewport, not the layout
//    viewport, because in desktop mode Safari reports a layout width of
//    around 980 that has nothing to do with the glass; and
//
//    it must notice a change WITHOUT being told, because iOS drops the
//    resize event exactly when it matters — switching site mode,
//    rotating during a gesture, and Safari's own pinch, which the
//    game's two-finger zoom sets off as a side effect.
//
//  Run:  node src/dev/viewport.mjs
// ============================================================

let bad = 0;
const ok = (c, m) => { console.log(`   ${c ? 'ok  ' : 'FAIL'}  ${m}`); if (!c) bad++; };
const NL = String.fromCharCode(10);

/* ---- the little bit of browser these two functions touch ---------- */
globalThis.window = { innerWidth: 1280, innerHeight: 720, addEventListener() {}, removeEventListener() {} };
globalThis.document = {
  querySelector: () => null, getElementById: () => null,
  createElement: () => ({ getContext: () => null, style: {}, classList: { add() {}, remove() {}, toggle() {} } }),
};
const setVisual = (w, h) => { globalThis.visualViewport = { width: w, height: h, addEventListener() {} }; };
const noVisual = () => { delete globalThis.visualViewport; };

const { Engine } = await import('../core/engine.js');

console.log(NL + '  DOES THE CANVAS COVER THE SCREEN?' + NL);

/* ------------------------------------------------------------------ */
console.log('  --- where the size comes from ---');

setVisual(820, 1180);
window.innerWidth = 980; window.innerHeight = 1180;   // desktop mode lies about width
let v = Engine.viewport();
ok(v.w === 820,
  `desktop mode: layout says ${window.innerWidth}, glass says 820, engine takes ${v.w}`);

/* This is the whole bug, stated as a number. At the old reading the
   canvas was built 980 wide and laid into an 820-wide box: 160 px of
   page showed through, and the page was cream. */
ok(v.w !== window.innerWidth,
  `does not use the layout width (would have left ${window.innerWidth - 820}px of bare page)`);

noVisual();
v = Engine.viewport();
ok(v.w === 980 && v.h === 1180,
  `without visualViewport it falls back to innerWidth/innerHeight (${v.w}x${v.h})`);

/* A window can be zero pixels tall — collapsed, minimised, mid-layout.
   w/h then poisons the projection matrix permanently. */
window.innerWidth = 0; window.innerHeight = 0;
v = Engine.viewport();
ok(v.w >= 1 && v.h >= 1 && Number.isFinite(v.w / v.h),
  `a collapsed window still yields a usable aspect (${v.w}x${v.h})`);

setVisual(0, 0);
v = Engine.viewport();
ok(v.w >= 1 && v.h >= 1, `a zero visual viewport does too (${v.w}x${v.h})`);

/* ------------------------------------------------------------------ */
console.log(NL + '  --- noticing without being told ---');

/* resize() and render() are exercised as themselves, against the
   smallest object that has the parts they touch. The alternative is a
   GPU, and then this would not run in CI at all. */
const calls = { setSize: 0, composer: 0, gtao: 0, projection: 0, render: 0 };
const rig = {
  _lost: false, _sizedW: -1, _sizedH: -1, _sizedDpr: -1,
  renderer: { getPixelRatio: () => 2, setSize(w, h) { calls.setSize++; this.w = w; this.h = h; } },
  composer: { setSize(w, h) { calls.composer++; this.w = w; this.h = h; }, render() { calls.render++; } },
  camera: { aspect: 0, updateProjectionMatrix() { calls.projection++; } },
  grade: { uniforms: { uRes: { value: { set() {} } }, uTime: { value: 0 } } },
  gtao: { setSize() { calls.gtao++; } },
  resize: Engine.prototype.resize,
  render: Engine.prototype.render,
};

setVisual(820, 1180);
rig.resize();
ok(rig.renderer.w === 820 && rig.composer.w === 820,
  `first sizing reaches the renderer and the composer (${rig.renderer.w}x${rig.renderer.h})`);
ok(Math.abs(rig.camera.aspect - 820 / 1180) < 1e-9,
  `the camera gets the same aspect the glass has (${rig.camera.aspect.toFixed(4)})`);

const wasSetSize = calls.setSize;
for (let i = 0; i < 500; i++) rig.resize();
ok(calls.setSize === wasSetSize,
  `500 further calls at the same size rebuild nothing (${calls.setSize - wasSetSize} rebuilds)`);

/* The one that matters: the viewport moves and NOBODY tells the game.
   No resize event, no visualViewport event — the case iOS actually
   produces. One frame of the normal loop has to be enough. */
setVisual(820, 1024);                     // the toolbar slid in
ok(rig.renderer.h === 1180, 'before the frame, the canvas is still the old height');
rig.render(0.016);
ok(rig.renderer.h === 1024 && rig.composer.h === 1024,
  `one frame of the render loop corrects it with no event at all (now ${rig.renderer.h})`);
ok(Math.abs(rig.camera.aspect - 820 / 1024) < 1e-9,
  'and the camera follows in the same frame, so the picture is not stretched');
ok(calls.render === 1, 'the frame still drew (the size check does not swallow it)');

/* Rotation, which changes both numbers at once. */
setVisual(1180, 820);
rig.render(0.016);
ok(rig.renderer.w === 1180 && rig.renderer.h === 820,
  `rotating the tablet is picked up the same way (${rig.renderer.w}x${rig.renderer.h})`);

/* Steady state must stay free. */
const beforeSize = calls.setSize;
const beforeDraw = calls.render;
for (let i = 0; i < 600; i++) rig.render(0.016);
ok(calls.setSize === beforeSize,
  `600 steady frames cost zero rebuilds (${calls.setSize - beforeSize})`);
ok(calls.render - beforeDraw === 600,
  `and every one of them drew (${calls.render - beforeDraw} of 600)`);

/* A lost context still draws nothing, size check or not. */
rig._lost = true;
const drew = calls.render;
setVisual(500, 500);
rig.render(0.016);
ok(calls.render === drew, 'a lost context draws nothing');
ok(rig.renderer.w === 1180, 'and is not resized while it is gone');

console.log(NL + (bad ? `  ${bad} FAILED` : '  all good') + NL);
process.exit(bad ? 1 : 0);
