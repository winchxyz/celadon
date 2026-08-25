// ============================================================
//  CELADON — renderer, camera rig and post chain
// ============================================================

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { clamp, clamp01, damp, lerp, TAU } from './util.js';
import { P } from '../render/palette.js';

/**
 * The camera, in one place.
 *
 * These numbers used to exist twice: here, and hardcoded again inside the
 * headless bench. They agreed, but only by luck — change the field of
 * view or the tilt limits on this side and the benches would carry on
 * testing a camera the game no longer had, printing green the entire
 * time. That is the same failure that once let the whole simulation
 * suite pass on a game nobody could play, so both sides now read from
 * here and a drift is not expressible.
 */
/**
 * The exposure the whole game is graded around.
 *
 * Neutral tone mapping, not ACES. ACES has a shoulder that desaturates
 * hard and a toe that crushes the shadows, which is why warm clay under
 * it goes chalky grey the moment it is bright.
 *
 * The number is not a free choice and it is not the obvious one. three's
 * ACES pre-multiplies by `toneMappingExposure / 0.6`, so the two curves
 * do not sit where they look like they sit: linear 0.18 lands at sRGB
 * 131 under ACES at 1.05, and at 84 under Neutral at 0.72. Matching
 * ACES's own mid-tone takes about 1.5 — anything near 0.72 makes the
 * studio a third darker while claiming to brighten it.
 */
export const EXPOSURE0 = 1.5;

export const CAMERA = {
  fov: 38, near: 0.4, far: 600,
  // The wheel is the subject, but the room is what makes it worth
  // looking at. At the old azimuth the player faced the one blank
  // stretch of plaster in the whole studio and never saw the drying
  // shelves, the bench or the window; every frame was pot, disc, wall.
  // Swung round so the rack of finished work sits behind the wheel,
  // which is also where the daylight is, so the piece is backlit.
  radius: 58, theta: 1.05, phi: 1.18,
  minPhi: 0.70, maxPhi: 1.78,
};

/* ------------------------------------------------------------------ */
/*  Colour grade / grain / vignette / heat haze                        */
/* ------------------------------------------------------------------ */

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 0.50 },
    uGrain: { value: 0.006 },
    uAberr: { value: 0.0 },
    uHaze: { value: 0.0 },
    uHazeY: { value: 0.35 },
    uLift: { value: new THREE.Vector3(0.022, 0.014, 0.010) },
    uGain: { value: new THREE.Vector3(1.018, 1.000, 0.982) },
    uSat: { value: 1.12 },
    uVigCol: { value: new THREE.Vector3(0.055, 0.036, 0.026) },
    uFade: { value: 0.0 },
    uFadeCol: { value: new THREE.Color(0, 0, 0) },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }
`,
  fragmentShader: /* glsl */`
uniform sampler2D tDiffuse;
uniform float uTime, uVignette, uGrain, uAberr, uHaze, uHazeY, uSat, uFade;
uniform vec3 uVigCol;
uniform vec3 uLift, uGain, uFadeCol;
uniform vec2 uRes;
varying vec2 vUv;

float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }

void main(){
  vec2 uv = vUv;
  vec2 c = uv - 0.5;
  float r2 = dot(c,c);

  // rising air over the kiln bends what is behind it
  if (uHaze > 0.001) {
    float band = smoothstep(0.55, 0.0, abs(uv.y - uHazeY)) * smoothstep(1.0, 0.35, abs(uv.x-0.5)*2.0);
    float w = sin(uv.y*9.0 - uTime*3.1) * 0.5 + sin(uv.y*17.0 + uTime*2.2)*0.5;
    uv.x += w * 0.0066 * uHaze * band;
    uv.y += cos(uv.x*13.0 + uTime*2.6) * 0.0033 * uHaze * band;
  }

  /* No lens.
     Chromatic aberration is dispersion through glass elements. Nothing
     in a clay workshop has glass elements. */
  vec3 col = texture2D(tDiffuse, uv).rgb;

  /* No grade either.
     Colour grading is something done to a photograph. Once the pigments
     themselves are keyed the pass has nothing left to correct, and any
     tint it applies is a tint the clay does not have. Kept as identity
     so the uniforms stay wired for the fade. */
  float l = dot(col, vec3(0.2126,0.7152,0.0722));

  /* No vignette and no grain.
     A vignette is a lens falling off at its edges and grain is the
     silver in a film emulsion. Warming the vignette instead of deleting
     it was the right instinct aimed at the wrong feature: it is not the
     colour that gives it away, it is that frames have corners and clay
     sets do not. If the edges of the picture need to go down, the room
     is lit wrong. */

  col = mix(col, uFadeCol, uFade);
  gl_FragColor = vec4(col, 1.0);
}
`,
};

/* ------------------------------------------------------------------ */
/*  Camera rig                                                         */
/* ------------------------------------------------------------------ */

export class CameraRig {
  constructor(camera, dom) {
    this.cam = camera;
    this.dom = dom;
    this.target = new THREE.Vector3(0, 12, 0);
    this.goalTarget = this.target.clone();
    this.radius = CAMERA.radius;
    this.goalRadius = CAMERA.radius;
    this.theta = CAMERA.theta;   // azimuth
    this.goalTheta = CAMERA.theta;
    this.phi = CAMERA.phi;       // polar
    this.goalPhi = CAMERA.phi;
    // How far the camera may tilt, either way.
    //
    // Crouching to see the foot was shut off for no reason and is now
    // open, with the splash pan fading out of the way as you get low.
    //
    // Looking straight DOWN is a different matter and is still limited.
    // The hand is placed by asking where the cursor's ray runs closest
    // to the wheel axis, and the steeper the view the worse that
    // question behaves — measured, a sideways drag moves the wall
    // +1.18 cm at 0.80, +0.30 cm at 0.62 and nothing at all by 0.50.
    // The honest limit is therefore the last angle where the controls
    // still do what they say, not the last angle that looks nice. This
    // wants fixing at the root, by finding the hand on the pot's own
    // drawn grid rather than against its axis; until then the camera
    // does not go somewhere the hand cannot follow.
    this.minPhi = CAMERA.minPhi;
    this.maxPhi = CAMERA.maxPhi;
    this.minR = 16;
    this.maxR = 150;
    this.enabled = true;
    this.autoSpin = 0;
    this.shake = 0;
    this._shakeT = 0;
    this.lock = false;
  }

  orbit(dx, dy) {
    if (this.lock) return;
    this.goalTheta -= dx * 0.0055;
    this.goalPhi = clamp(this.goalPhi - dy * 0.0045, this.minPhi, this.maxPhi);
  }

  zoom(dz) {
    if (this.lock) return;
    this.goalRadius = clamp(this.goalRadius * (1 + dz * 0.0014), this.minR, this.maxR);
  }

  frame(target, radius, phi = null, theta = null, snap = false) {
    this.goalTarget.copy(target);
    this.goalRadius = clamp(radius, this.minR, this.maxR);
    if (phi !== null) this.goalPhi = clamp(phi, this.minPhi, this.maxPhi);
    if (theta !== null) this.goalTheta = theta;
    if (snap) {
      this.target.copy(this.goalTarget);
      this.radius = this.goalRadius;
      this.phi = this.goalPhi;
      this.theta = this.goalTheta;
    }
  }

  kick(amount) { this.shake = Math.min(1.4, this.shake + amount); }

  update(dt) {
    const k = 5.2;
    this.target.lerp(this.goalTarget, 1 - Math.exp(-k * dt));
    this.radius = damp(this.radius, this.goalRadius, k, dt);
    this.phi = damp(this.phi, this.goalPhi, k * 1.1, dt);
    this.goalTheta += this.autoSpin * dt;
    this.theta = damp(this.theta, this.goalTheta, k * 1.1, dt);

    const sp = Math.sin(this.phi), cp = Math.cos(this.phi);
    const x = this.target.x + this.radius * sp * Math.sin(this.theta);
    const y = this.target.y + this.radius * cp;
    const z = this.target.z + this.radius * sp * Math.cos(this.theta);
    this.cam.position.set(x, y, z);

    if (this.shake > 0.001) {
      this._shakeT += dt * 34;
      const s = this.shake * this.shake * 0.55;
      this.cam.position.x += Math.sin(this._shakeT * 1.7) * s;
      this.cam.position.y += Math.sin(this._shakeT * 2.3 + 1.1) * s;
      this.shake = Math.max(0, this.shake - dt * 1.9);
    }
    this.cam.lookAt(this.target);
  }

}

/* ------------------------------------------------------------------ */
/*  Environment (IBL) built from a tiny procedural scene               */
/* ------------------------------------------------------------------ */

export function buildEnvironment(renderer, cfg = {}) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const s = new THREE.Scene();

  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(60, 32, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        uTop: { value: new THREE.Color(cfg.top ?? 0x2c3237) },
        uHorizon: { value: new THREE.Color(cfg.horizon ?? 0x4a4238) },
        uBottom: { value: new THREE.Color(cfg.bottom ?? 0x2a211c) },
      },
      vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
      fragmentShader: `
        uniform vec3 uTop,uHorizon,uBottom; varying vec3 vD;
        void main(){
          float t = vD.y;
          vec3 c = mix(uHorizon, uTop, smoothstep(0.0,0.85,t));
          c = mix(c, uBottom, smoothstep(0.0,-0.55,t));
          gl_FragColor = vec4(c,1.0);
        }`,
    })
  );
  s.add(sky);

  const addPanel = (col, intensity, pos, scale, rot) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(intensity), side: THREE.DoubleSide })
    );
    m.position.set(...pos);
    m.scale.set(scale[0], scale[1], 1);
    if (rot) m.rotation.set(...rot);
    m.lookAt(0, m.position.y * 0.3, 0);
    s.add(m);
    return m;
  };

  // the window: cold ash daylight, the only clean light in the Reach
  addPanel(0xb9cdd6, cfg.windowI ?? 5.0, [-16, 15, -14], [17, 20]);
  addPanel(0xd6e2e8, 1.2, [-22, 6, 4], [14, 14]);
  // kiln mouth
  addPanel(0xff7a2a, cfg.kilnI ?? 3.4, [16, 6, -10], [9, 8]);
  // warm bounce off the brick
  // The bounce off the brick, which is what fills the shadow side of
  // a round thing. At 0.55 against a window at 5.0 the room was lit
  // nine to one from one cold side, so every downward-facing curve
  // wrapped into blue-black instead of into warm floor.
  addPanel(0xc08a5e, 1.45, [10, 3, 12], [22, 12]);
  // overhead lamp
  addPanel(0xffd9a8, 1.5, [0, 26, 2], [10, 10], [Math.PI / 2, 0, 0]);

  const rt = pmrem.fromScene(s, 0.035, 0.1, 120);
  sky.geometry.dispose(); sky.material.dispose();
  s.traverse((o) => { if (o.isMesh && o !== sky) { o.geometry.dispose(); o.material.dispose(); } });
  pmrem.dispose();
  return rt.texture;
}

/* ------------------------------------------------------------------ */
/*  Engine                                                             */
/* ------------------------------------------------------------------ */

export class Engine {
  constructor(canvas, quality = 'high') {
    this.canvas = canvas;
    this.quality = quality;

    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      powerPreference: 'high-performance',
      stencil: false,
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.35));
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NeutralToneMapping;
    renderer.toneMappingExposure = EXPOSURE0;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer = renderer;
    this.caps = renderer.capabilities;

    this.scene = new THREE.Scene();
    // Near-black fog over a six-metre far plane is the single strongest
    // "dim photographed room" cue there is, and a near-black background
    // behind it doubles the effect. A clay set is a small warm box; it
    // has a wall, not a void, and no haze between you and it.
    // Deep and warm, and a long way below everything in front of it.
    // Guessing a mid salmon here is what let the walls dissolve into the
    // background and took the depth out of the picture.
    this.scene.background = new THREE.Color(P.void);
    this.scene.fog = null;

    this.camera = new THREE.PerspectiveCamera(
      CAMERA.fov, window.innerWidth / window.innerHeight, CAMERA.near, CAMERA.far);
    this.camera.position.set(0, 24, 60);

    this.rig = new CameraRig(this.camera, canvas);

    this.env = buildEnvironment(renderer);
    this.scene.environment = this.env;
    this.scene.environmentIntensity = 1.0;

    this._buildComposer();
    // The chain was just built at exactly this size, so record it: without
    // a baseline the first resize event of the session rebuilds it again
    // for nothing, and on iOS that event arrives as soon as the toolbar
    // moves.
    this._sizedW = Math.max(1, window.innerWidth || 1);
    this._sizedH = Math.max(1, window.innerHeight || 1);
    this._sizedDpr = renderer.getPixelRatio();

    this.clock = new THREE.Clock();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);

    /* A lost context is not a crash, and it should not look like one.
       When a tablet runs short of GPU memory it takes the context away
       rather than swapping, and the canvas goes black until the browser
       hands it back. Left to itself the page keeps calling render() into
       nothing, which is how a black frame becomes a black frame every
       few seconds. Say so, stop drawing, and pick up where we left off. */
    this._lost = false;
    canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();          // without this the context never returns
      this._lost = true;
      console.warn('celadon: the graphics context was taken away; waiting for it back');
    });
    canvas.addEventListener('webglcontextrestored', () => {
      this._lost = false;
      this._sizedW = this._sizedH = this._sizedDpr = -1;   // force a real resize
      this.resize();
      console.info('celadon: graphics context restored');
    });
  }

  _buildComposer() {
    const { renderer, scene, camera } = this;
    const w = window.innerWidth, h = window.innerHeight;
    const dpr = renderer.getPixelRatio();

    const rt = new THREE.WebGLRenderTarget(w * dpr, h * dpr, {
      type: THREE.HalfFloatType,
      samples: this.quality === 'high' ? 4 : 0,
      colorSpace: THREE.LinearSRGBColorSpace,
    });
    const composer = new EffectComposer(renderer, rt);
    composer.setSize(w, h);
    composer.setPixelRatio(dpr);

    composer.addPass(new RenderPass(scene, camera));

    if (this.quality === 'high') {
      // Ambient occlusion at radius 1.9 and blend 0.85 packs a dark
      // ring into every crease and contact point. That is a rendering
      // of how light is blocked, and it is the look of a photograph of
      // a dim room. Clay sets are lit so flatly that contact shadow is
      // almost the only shadow they have, and the wrap term now carries
      // that. Deleted rather than lowered: residue reads.
      this.gtao = null;
    }

    // Bloom is light spilling inside a lens. Kept only for the kiln,
    // which is genuinely incandescent, and at a threshold high enough
    // that nothing else in the room can reach it.
    const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.30, 0.55, 1.02);
    this.bloom = bloom;
    composer.addPass(bloom);

    const grade = new ShaderPass(GradeShader);
    grade.uniforms.uRes.value.set(w, h);
    this.grade = grade;
    composer.addPass(grade);

    composer.addPass(new OutputPass());

    if (this.quality !== 'low') {
      // Kept on the engine so the frame-rate watchdog in main.js can
      // switch it off; a pass nothing holds a reference to cannot be
      // the thing you shed when the machine is struggling.
      this.smaa = new SMAAPass();
      composer.addPass(this.smaa);
    }

    this.composer = composer;
  }

  resize() {
    // A window can be zero pixels tall — collapsed, minimised, or a
    // preview pane mid-layout — and w/h is then Infinity or NaN. That
    // poisons the projection matrix, and because nothing ever divides
    // by zero again the camera stays broken after the window comes
    // back: every ray from the cursor unprojects to NaN, so the pot
    // renders but cannot be touched.
    const w = Math.max(1, window.innerWidth || 1);
    const h = Math.max(1, window.innerHeight || 1);

    /* Do nothing if nothing changed.
       iOS fires resize for things that are not a resize: the toolbar
       sliding away, the keyboard, and Safari's own pinch zoom, which
       cannot be switched off and which the game's two-finger zoom
       triggers as a side effect. Every one of those used to tear down
       and rebuild the whole composer chain — several full-screen render
       targets — for a window that was the same size as before. */
    const dpr = this.renderer.getPixelRatio();
    if (w === this._sizedW && h === this._sizedH && dpr === this._sizedDpr) return;
    this._sizedW = w; this._sizedH = h; this._sizedDpr = dpr;

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
    this.composer.setSize(w, h);
    this.grade.uniforms.uRes.value.set(w, h);
    if (this.gtao) this.gtao.setSize(w, h);
  }

  render(dt) {
    if (this._lost) return;   // there is nothing to draw into
    this.grade.uniforms.uTime.value += dt;
    this.composer.render(dt);
  }

  dispose() {
    window.removeEventListener('resize', this._onResize);
    this.composer.dispose?.();
    this.renderer.dispose();
  }
}
