// ============================================================
//  CELADON — the workshop
//
//  One room in the last dry quarter of Vess: a kick wheel under a
//  north window, a wall of drying shelves, and a wood kiln that
//  has not been allowed to go out in nine years.
//
//  Everything here is in centimetres. The wheel head is the origin.
// ============================================================

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import {
  plasterMaps, brickMaps, kilnBrickMaps, woodMaps, stoneFloorMaps, metalMaps, clothMaps,
  radialSprite, noiseTexture,
} from './textures.js';
import { clamp, clamp01, lerp, smoothstep, damp, makeRng, TAU, blackbodyRGB } from '../core/util.js';
import { P, GLAZES } from './palette.js';

/**
 * A box with the corners taken off.
 *
 * Nothing in this workshop was cast in a mould or cut on a saw — it is
 * a room full of things somebody made by hand, and the single loudest
 * signal that a shape was NOT made by hand is a perfectly sharp arris.
 * Every beam, board, post and slab in here went through this instead of
 * BoxGeometry; the radius is small enough to read as a worn edge rather
 * than as a pillow, and clamped so a three-centimetre shelf board does
 * not try to round itself by more than it is thick.
 */
function rbox(w, h, d, r = 1.6, seg = 2) {
  const rr = Math.min(r, Math.min(w, h, d) * 0.42);
  return new RoundedBoxGeometry(w, h, d, seg, rr);
}

export const KILN_POS = new THREE.Vector3(168, 0, -46);

export class Studio {
  constructor(scene, renderer) {
    this.scene = scene;
    this.renderer = renderer;
    this.rng = makeRng(90210);
    this.t = 0;
    this.group = new THREE.Group();
    scene.add(this.group);

    this.kilnHeat = 0;
    this.kilnTemp = 20;
    this.wheelSpin = 0;

    this._buildRoom();
    this._buildWheel();
    this._buildBench();
    this._buildShelves();
    this._buildKiln();
    this._buildLights();
    this._buildAtmosphere();
  }

  /* ---------------------------------------------------------------- */
  /**
   * Every surface in the room, made the same way.
   *
   * Physical rather than Standard for one reason: `specularIntensity`.
   * A clay set has no highlight anywhere — the only object in the frame
   * allowed to shine is a fired glaze, and it earns that by being the
   * only one. Form at grazing angles comes back through sheen instead,
   * tinted toward the material rather than white, because a white sheen
   * reads as dust on a surface and a tinted one reads as the surface
   * itself catching the light.
   *
   * The normal and roughness maps are gone. Varying roughness across a
   * surface is a story about microstructure, and microstructure is the
   * photographic scale by definition.
   */
  _mat(maps, o = {}) {
    // The clay mixes carry structure only; every colour in the game comes
    // from palette.js. A mapped surface with no colour of its own is
    // therefore WHITE, not brown — which is exactly how the floor became a
    // sheet of blown paper without anything appearing to be wrong.
    if (maps.map && o.color === undefined) {
      throw new Error('celadon: a mapped material needs a colour from the palette');
    }
    const base = new THREE.Color(o.color ?? 0xffffff);
    const sheenCol = base.clone().lerp(new THREE.Color(P.ambSky), 0.35);
    const m = new THREE.MeshPhysicalMaterial({
      map: maps.map,
      metalness: 0, roughness: 1,
      specularIntensity: 0,
      envMapIntensity: 0.20,
      sheen: 0.75, sheenRoughness: 0.95, sheenColor: sheenCol,
      ...o,
    });
    return m;
  }

  /**
   * Give a part its own copy of a material, scaled so the grain is the
   * same physical length on it as on everything else.
   *
   * Rounded-box UVs are normalised per face, so one shared repeat means
   * a 5 cm leg and a 120 cm bench top get the same number of grain
   * passes across them — about forty centimetres of grain on the top
   * against under two on the leg, which reads as striped sticks holding
   * up a plank. The kiln already solved this for its bricks; this is the
   * same trick for wood.
   */
  _scaled(mat, acrossCm, upCm, tileCm = 40) {
    const m = mat.clone();
    for (const key of ['map', 'normalMap', 'roughnessMap']) {
      if (!m[key]) continue;
      const t = m[key].clone();
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.repeat.set(Math.max(0.05, acrossCm / tileCm), Math.max(0.05, upCm / tileCm));
      t.needsUpdate = true;
      m[key] = t;
    }
    return m;
  }

  _rep(maps, x, y) {
    for (const t of [maps.map].filter(Boolean)) {
      t.repeat.set(x, y); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true;
    }
  }

  /* ---------------------------------------------------------------- */
  _buildRoom() {
    const FLOOR = -46, W = 480, D = 420, H = 250;

    const stone = stoneFloorMaps(512);
    const floorMat = this._mat({
      map: stone.map.clone(), normalMap: stone.normalMap.clone(), roughnessMap: stone.roughnessMap.clone(),
    }, { color: P.floor, normalScale: new THREE.Vector2(0.8, 0.8) });
    for (const t of [floorMat.map, floorMat.normalMap, floorMat.roughnessMap].filter(Boolean)) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(7, 6); t.needsUpdate = true;
    }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(30, FLOOR, -30);
    floor.receiveShadow = true;
    this.group.add(floor);

    const plaster = plasterMaps(512);
    const wallMat = this._mat({
      map: plaster.map.clone(), normalMap: plaster.normalMap.clone(), roughnessMap: plaster.roughnessMap.clone(),
    }, { color: P.wall, normalScale: new THREE.Vector2(1.1, 1.1) });
    for (const t of [wallMat.map, wallMat.normalMap, wallMat.roughnessMap].filter(Boolean)) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(4.5, 2.4); t.needsUpdate = true;
    }

    // back wall with a window cut into it
    const back = new THREE.Group();
    const winW = 96, winH = 104, winX = -74, winY = 62;
    const pieces = [
      [W, FLOOR + H - (winY + winH / 2), 0, (winY + winH / 2) + (H - (winY + winH / 2 - FLOOR)) / 2 - 0],
    ];
    // build wall as four slabs around the opening
    const mk = (w, h, x, y) => {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), wallMat);
      m.position.set(x, y, -D / 2 - 30 + 0.1);
      m.receiveShadow = true;
      back.add(m);
      return m;
    };
    const wallTop = H - (winY + winH / 2);
    mk(W, wallTop, 30, winY + winH / 2 + wallTop / 2);
    const wallBot = (winY - winH / 2) - FLOOR;
    mk(W, wallBot, 30, FLOOR + wallBot / 2);
    const leftW = (winX - winW / 2) - (30 - W / 2);
    mk(leftW, winH, (30 - W / 2) + leftW / 2, winY);
    const rightW = (30 + W / 2) - (winX + winW / 2);
    mk(rightW, winH, (winX + winW / 2) + rightW / 2, winY);
    this.group.add(back);

    // side walls
    const sideL = new THREE.Mesh(new THREE.PlaneGeometry(D, H), wallMat);
    sideL.rotation.y = Math.PI / 2;
    sideL.position.set(30 - W / 2, FLOOR + H / 2, -30);
    sideL.receiveShadow = true;
    this.group.add(sideL);

    const sideR = sideL.clone();
    sideR.rotation.y = -Math.PI / 2;
    sideR.position.x = 30 + W / 2;
    this.group.add(sideR);

    // The fourth wall.
    //
    // There was never one. The camera orbits the wheel through a full
    // circle, so for a third of that circle it was looking straight out
    // of the room at the clear colour — a flat dark slab with a hard
    // horizontal edge where the floor ended, which reads as the world
    // having run out. It faces inward, so standing outside the room and
    // looking back in still sees through it.
    const front = new THREE.Mesh(new THREE.PlaneGeometry(W, H), wallMat);
    front.rotation.y = Math.PI;
    front.position.set(30, FLOOR + H / 2, -30 + D / 2);
    front.receiveShadow = true;
    this.group.add(front);

    // ceiling + beams
    const ceil = new THREE.Mesh(
      new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ color: P.ceiling, roughness: 1 })
    );
    ceil.rotation.x = Math.PI / 2;
    ceil.position.set(30, FLOOR + H, -30);
    this.group.add(ceil);

    const wood = woodMaps(512);
    const beamMat = this._mat({
      map: wood.map.clone(), normalMap: wood.normalMap.clone(), roughnessMap: wood.roughnessMap.clone(),
    }, { color: P.wood });
    for (const t of [beamMat.map, beamMat.normalMap, beamMat.roughnessMap].filter(Boolean)) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(6, 1); t.needsUpdate = true;
    }
    for (let i = 0; i < 5; i++) {
      const b = new THREE.Mesh(rbox(W, 16, 20, 2.6), beamMat);
      b.position.set(30, FLOOR + H - 10, -30 - D / 2 + 50 + i * 88);
      b.castShadow = true;
      this.group.add(b);
    }

    // window frame and the ash light coming through it
    const frameMat = new THREE.MeshStandardMaterial({ color: P.iron, roughness: 0.85 });
    const fr = new THREE.Group();
    const bar = (w, h, x, y) => {
      const m = new THREE.Mesh(rbox(w, h, 8, 1.6), frameMat);
      m.position.set(x, y, -D / 2 - 30 + 4);
      m.castShadow = true;
      fr.add(m);
    };
    bar(winW + 12, 7, winX, winY + winH / 2);
    bar(winW + 12, 7, winX, winY - winH / 2);
    bar(7, winH, winX - winW / 2, winY);
    bar(7, winH, winX + winW / 2, winY);
    bar(5, winH, winX, winY);
    bar(winW, 5, winX, winY);
    this.group.add(fr);

    // the pane: bright, slightly dirty, ash drifting past
    this.windowPane = new THREE.Mesh(
      new THREE.PlaneGeometry(winW, winH),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 },
          uNoise: { value: noiseTexture(256, 5) },
          uCol: { value: new THREE.Color(P.ambSky) },
          // A window is the brightest thing in a room, not a hole cut in
          // it. At 2.3 the pane clipped to flat white, took the glazing
          // bars with it, and bloomed over anything standing in front —
          // so the one piece of the room with a view in it read as
          // missing geometry.
          uI: { value: 1.22 },
        },
        vertexShader: `varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} `,
        fragmentShader: `
          uniform float uTime, uI; uniform vec3 uCol; uniform sampler2D uNoise; varying vec2 vUv;
          void main(){
            float grime = texture2D(uNoise, vUv*3.0).r*0.25 + texture2D(uNoise, vUv*11.0).g*0.12;
            float fall = 0.0;
            for(int i=0;i<3;i++){
              float fi = float(i);
              vec2 p = vUv*vec2(6.0+fi*3.0, 3.0+fi) + vec2(sin(uTime*0.13+fi)*0.2, -uTime*(0.035+fi*0.02));
              float n = texture2D(uNoise, p).b;
              fall += smoothstep(0.86,0.99,n)*(0.5-fi*0.12);
            }
            float v = 1.0 - grime;
            vec3 c = uCol*uI*v;
            c = mix(c, vec3(0.55,0.53,0.5)*uI*0.6, clamp(fall,0.0,0.7));
            gl_FragColor = vec4(c, 1.0);
          }`,
      })
    );
    this.windowPane.position.set(winX, winY, -D / 2 - 30 + 1);
    this.group.add(this.windowPane);

    this.winPos = new THREE.Vector3(winX, winY, -D / 2 - 30);
    // Same again: adapt() drives this every frame, so the number that
    // decides how bright the window is has to be read from here rather
    // than written a second time inside the loop.
    this._dayI = this.windowPane.material.uniforms.uI.value;
  }

  /* ---------------------------------------------------------------- */
  _buildWheel() {
    const g = new THREE.Group();
    this.wheelGroup = g;

    const metal = metalMaps(256);
    const headMat = this._mat({
      map: metal.map.clone(), normalMap: metal.normalMap.clone(), roughnessMap: metal.roughnessMap.clone(),
    // A wheel head at metalness 0.72 takes almost all its light from the
    // environment rather than from the lamps, so it stayed the darkest
    // and largest thing in the frame however the room was lit. Pulled
    // most of the way off metal and warmed — it is a worn cast disc in a
    // workshop, not a mirror.
    }, { metalness: 0, roughness: 1, color: P.wheel, envMapIntensity: 0.2,
         normalScale: new THREE.Vector2(0.45, 0.45) });

    // wheel head — this is what spins
    const head = new THREE.Mesh(new THREE.CylinderGeometry(15.5, 15.5, 2.4, 96, 1), headMat);
    head.position.y = -1.2;
    head.castShadow = true; head.receiveShadow = true;
    g.add(head);
    this.wheelHead = head;

    // Concentric centring rings scribed into the head.
    //
    // These were at local y = 0.02 — the centre of a 2.4-tall disc whose
    // top face is at +1.2, so all four sat 1.12 cm inside solid opaque
    // metal and had never once rendered. The wheel head is the surface
    // the player looks at for the whole game and its only detail was
    // buried in it. Sitting on the face, half sunk, they read as turned
    // grooves.
    const ringMat = new THREE.MeshPhysicalMaterial({ color: P.iron, roughness: 1, metalness: 0, specularIntensity: 0 });
    for (let i = 1; i <= 4; i++) {
      const r = i * 3.2;
      const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.07, 6, 84), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 1.2;      // the head's top face, in head-local space
      head.add(ring);
    }

    // ---- the contact shadow ----
    //
    // Nothing in the frame was touching anything. A pot with no shadow
    // under it does not stand on the wheel, it hovers a centimetre above
    // it, and no amount of good colour fixes that — contact is the single
    // cue that says an object has weight and is in the room.
    //
    // A real shadow will not do the job here: the only caster is the
    // window, which is behind and to the left, so its shadow falls away
    // from the viewer and never appears under the foot. This is the
    // ambient occlusion of the join, drawn directly: darkest where the
    // clay meets the head and gone within a couple of centimetres.
    const contact = new THREE.Mesh(
      new THREE.CircleGeometry(1, 64),
      // Straight alpha, not multiply: MultiplyBlending ignores the sprite's
      // alpha channel and darkens the whole quad evenly, which is a grey
      // square, not a shadow.
      new THREE.MeshBasicMaterial({
        map: radialSprite(128, 2.8),
        transparent: true, depthWrite: false,
        color: P.contact,
        opacity: 0.0,
      })
    );
    contact.rotation.x = -Math.PI / 2;
    contact.position.y = 0.06;
    contact.renderOrder = 1;
    g.add(contact);
    this.contact = contact;

    // splash pan
    // The splash pan is a wide ring right across the middle of the frame,
    // and it was the one cold blue-grey object in a room being lit warm.
    const panMat = new THREE.MeshPhysicalMaterial({ color: P.woodWarm, roughness: 1, metalness: 0, specularIntensity: 0, sheen: 0.30, sheenColor: new THREE.Color(P.ambSky) });
    const pan = new THREE.Mesh(
      new THREE.LatheGeometry(
        [
          new THREE.Vector2(16.5, -3.0), new THREE.Vector2(17.5, -3.4),
          new THREE.Vector2(27.0, -3.9), new THREE.Vector2(28.5, -2.4),
          new THREE.Vector2(29.0, 2.6), new THREE.Vector2(28.2, 2.9),
          new THREE.Vector2(27.4, 1.2), new THREE.Vector2(26.6, -2.6),
          new THREE.Vector2(17.2, -2.2), new THREE.Vector2(16.5, -1.9),
        ], 72
      ), panMat
    );
    pan.castShadow = true; pan.receiveShadow = true;
    g.add(pan);
    // Kept so it can be faded: crouch to look at the foot of a pot and
    // the near wall of the pan is the only thing you can see.
    this.splashPan = pan;
    panMat.transparent = true;

    // slip and water sitting in the pan
    const slip = new THREE.Mesh(
      new THREE.RingGeometry(17.6, 26.4, 72),
      new THREE.MeshPhysicalMaterial({
        // Wet, not mirrored. envMapIntensity was 1.6 against 0.2
        // everywhere else in the room — eight times the environment
        // response, so a matte disc of slip picked up the window and the
        // kiln and read as a pool of lacquer. The sheen belongs in a
        // specular coat at the room's own ambient level.
        color: P.slip, roughness: 0.45, metalness: 0, clearcoat: 1.0,
        clearcoatRoughness: 0.08, envMapIntensity: 0.35,
      })
    );
    slip.rotation.x = -Math.PI / 2;
    slip.position.y = -2.9;
    g.add(slip);

    // frame and pedal
    const wood = woodMaps(512);
    const frameMat = this._mat({
      map: wood.map.clone(), normalMap: wood.normalMap.clone(), roughnessMap: wood.roughnessMap.clone(),
    }, { color: P.woodDark });
    for (const t of [frameMat.map, frameMat.normalMap, frameMat.roughnessMap].filter(Boolean)) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 3); t.needsUpdate = true;
    }
    // The legs stood at radius 19, so their inner faces were at 16 and
    // the 24-radius flywheel spinning between y -42.5 and -37.5 passed
    // straight through all four of them.
    //
    // Fixed from both ends. The legs move out to 27, where they still sit
    // under the splash pan's 29 rim and read as holding it up, and the
    // flywheel comes in to 21. A centimetre of nominal clearance is not
    // enough here: each leg is also raked by rotation.z, which walks its
    // foot another 0.75 cm inward at exactly the height the flywheel
    // turns.
    const LEG_R = 27;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * TAU + 0.78;
      const leg = new THREE.Mesh(rbox(6, 44, 6, 1.5), frameMat);
      leg.position.set(Math.cos(a) * LEG_R, -25, Math.sin(a) * LEG_R);
      leg.rotation.y = a;
      leg.rotation.z = Math.cos(a) * 0.05;
      leg.castShadow = true;
      g.add(leg);
    }
    // A stretcher ring, so four sticks and a disc read as one frame.
    const stretcher = new THREE.Mesh(
      new THREE.TorusGeometry(LEG_R - 1.5, 1.1, 8, 40), frameMat);
    stretcher.rotation.x = Math.PI / 2;
    stretcher.position.y = -43;
    stretcher.castShadow = true;
    g.add(stretcher);
    // The shaft. A kick wheel is legible because you can see the thing
    // the foot is driving; there was a head, and a disc forty centimetres
    // below it, and nothing between them.
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(2.6, 3.6, 40, 16), frameMat);
    shaft.position.y = -21;
    shaft.castShadow = true;
    g.add(shaft);

    // The one large mesh in the room still built from a raw Standard
    // material: no map, no sheen, and specularIntensity left at its
    // default, so it was the only object left that could throw the white
    // highlight this room forbids everywhere else.
    const metalFly = metalMaps(256);
    const flyMat = this._mat({
      map: metalFly.map.clone(), normalMap: metalFly.normalMap.clone(),
      roughnessMap: metalFly.roughnessMap.clone(),
    }, { color: P.iron, roughness: 1, metalness: 0, envMapIntensity: 0.2 });
    for (const t of [flyMat.map, flyMat.normalMap, flyMat.roughnessMap].filter(Boolean)) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1); t.needsUpdate = true;
    }
    const flywheel = new THREE.Mesh(new THREE.CylinderGeometry(21, 21, 5, 48), flyMat);
    flywheel.position.y = -40;
    flywheel.castShadow = true;
    g.add(flywheel);
    this.flywheel = flywheel;

    // Spokes, so the wheel turning is something you can SEE turning. A
    // smooth disc of one colour spinning at any speed is a still image.
    //
    // Three bars, not six: a bar crossing the centre IS two spokes, and
    // six of them drew every bar twice. They run the full 42 diameter —
    // at 18 they covered the inner two fifths and read as a small cross
    // stuck on the middle of a plate.
    for (let i = 0; i < 3; i++) {
      const spoke = new THREE.Mesh(rbox(41, 1.6, 3.4, 0.7), flyMat);
      spoke.position.set(0, 2.9, 0);
      spoke.rotation.y = (i / 3) * Math.PI;
      flywheel.add(spoke);
    }
    // and a hub where the shaft goes through
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(4.4, 4.4, 4.2, 20), flyMat);
    hub.position.y = 2.4;
    flywheel.add(hub);

    this.group.add(g);
  }

  /**
   * Ground whatever is standing on the wheel.
   * @param {number} r  radius of the foot, in centimetres; 0 to hide
   */
  setContact(r) {
    const on = r > 0.2;
    this.contact.visible = on;
    if (!on) return;
    // The pool spreads a little past the foot and fades; a shadow exactly
    // the size of the object reads as a sticker.
    this.contact.scale.setScalar(r * 1.9 + 1.0);
    this.contact.material.opacity = 0.62;
  }

  /* ---------------------------------------------------------------- */
  _buildBench() {
    const wood = woodMaps(512);
    const benchMat = this._mat({
      map: wood.map.clone(), normalMap: wood.normalMap.clone(), roughnessMap: wood.roughnessMap.clone(),
    }, { color: P.wood });
    for (const t of [benchMat.map, benchMat.normalMap, benchMat.roughnessMap].filter(Boolean)) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(3, 1.2); t.needsUpdate = true;
    }
    // the legs are 5 cm across and 34 tall; the top is 120 by 46
    const benchLegMat = this._scaled(benchMat, 5, 34);

    const bench = new THREE.Group();
    const top = new THREE.Mesh(rbox(120, 5, 46, 1.8), benchMat);
    top.position.set(-72, -12, 34);
    top.castShadow = true; top.receiveShadow = true;
    bench.add(top);
    for (const dx of [-52, 52]) {
      for (const dz of [-17, 17]) {
        const l = new THREE.Mesh(rbox(5, 34, 5, 1.3), benchLegMat);
        l.position.set(-72 + dx, -31, 34 + dz);
        l.castShadow = true;
        bench.add(l);
      }
    }

    // tools laid out on the bench
    // Painted tin, not steel. Metal is defined by what it reflects, and a
    // handmade set has nothing worth reflecting.
    const steel = new THREE.MeshPhysicalMaterial({ color: P.steel, metalness: 0, roughness: 1, specularIntensity: 0, sheen: 0.9, sheenColor: new THREE.Color(P.ash) });
    const handle = new THREE.MeshStandardMaterial({ color: P.woodDark, roughness: 0.8 });

    const rib = new THREE.Mesh(rbox(9, 0.7, 5.5, 0.3), handle);
    rib.position.set(-104, -9.2, 28); rib.rotation.y = 0.4; rib.castShadow = true;
    bench.add(rib);

    const needle = new THREE.Group();
    const nh = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 8, 12), handle);
    nh.rotation.z = Math.PI / 2;
    const nn = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.05, 7, 6), steel);
    nn.rotation.z = Math.PI / 2; nn.position.x = 7;
    needle.add(nh, nn);
    needle.position.set(-86, -8.8, 42); needle.rotation.y = -0.25;
    needle.castShadow = true;
    bench.add(needle);

    const wire = new THREE.Mesh(new THREE.TorusGeometry(4.5, 0.14, 5, 40, Math.PI * 1.4), steel);
    wire.position.set(-56, -9.0, 40); wire.rotation.x = Math.PI / 2;
    bench.add(wire);

    // sponge
    // A sponge is entirely its surface: a smooth ellipsoid of flat
    // colour is a pebble. The cloth maps give it a tooth, and the
    // vertices are pushed about so the silhouette is lumpy too.
    const spongeGeo = new THREE.SphereGeometry(3.4, 20, 14);
    {
      const pos = spongeGeo.attributes.position;
      const srng = makeRng(4242);
      for (let i = 0; i < pos.count; i++) {
        const k = 1 + (srng() - 0.5) * 0.22;
        pos.setXYZ(i, pos.getX(i) * k, pos.getY(i) * k, pos.getZ(i) * k);
      }
      spongeGeo.computeVertexNormals();
    }
    const cloth = clothMaps(256);
    const sponge = new THREE.Mesh(spongeGeo, this._mat({
      map: cloth.map.clone(), normalMap: cloth.normalMap.clone(),
      roughnessMap: cloth.roughnessMap.clone(),
    }, { color: P.slip, roughness: 1, normalScale: new THREE.Vector2(2.2, 2.2) }));
    sponge.scale.set(1, 0.6, 0.9);
    sponge.position.set(-40, -7.6, 26);
    sponge.castShadow = true;
    bench.add(sponge);

    // The water bucket.
    //
    // It was an open cylinder with no thickness and a flat disc for a
    // floor: the rim was a razor edge you could see the wall's zero
    // thickness at, and the whole thing was one untextured grey next to
    // a bench that gets a wood map. A lathe gives it a real wall, a
    // rolled-over lip, and a foot to stand on — and the profile goes up
    // the outside, over the rim, down the inside and across the floor
    // in one closed loop, so there is no seam anywhere to see through.
    const bucket = new THREE.Group();
    const clothB = clothMaps(256);
    const bm = this._mat({
      map: clothB.map.clone(), normalMap: clothB.normalMap.clone(),
      roughnessMap: clothB.roughnessMap.clone(),
    }, { color: P.steel, roughness: 1, normalScale: new THREE.Vector2(0.7, 0.7) });
    for (const t of [bm.map, bm.normalMap, bm.roughnessMap].filter(Boolean)) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 1); t.needsUpdate = true;
    }
    const W = 0.55;                       // wall thickness
    const bs = new THREE.Mesh(new THREE.LatheGeometry([
      new THREE.Vector2(0.01, -8.4),      // under the foot
      new THREE.Vector2(7.2, -8.4),
      new THREE.Vector2(7.6, -8.0),       // the foot it stands on
      new THREE.Vector2(9.0, 7.2),        // up the outside, tapering out
      new THREE.Vector2(9.25, 7.9),       // the lip, rolled over
      new THREE.Vector2(9.0, 8.3),
      new THREE.Vector2(9.0 - W, 7.9),
      new THREE.Vector2(7.6 - W, -7.4),   // and back down the inside
      new THREE.Vector2(0.01, -7.4),      // across the floor to the axis
    ], 40), bm);
    const water = new THREE.Mesh(
      new THREE.CircleGeometry(8.35, 32),
      new THREE.MeshPhysicalMaterial({
        color: P.slip, roughness: 0.42, metalness: 0,
        clearcoat: 1.0, clearcoatRoughness: 0.10, envMapIntensity: 0.35,
      })
    );
    water.rotation.x = -Math.PI / 2; water.position.y = 3.2;
    // a bail, so it is a thing somebody carries
    const bailMat = new THREE.MeshPhysicalMaterial({ color: P.iron, roughness: 1, metalness: 0, specularIntensity: 0 });
    const bail = new THREE.Mesh(new THREE.TorusGeometry(9.1, 0.32, 6, 28, Math.PI), bailMat);
    bail.position.y = 7.4; bail.rotation.y = 0.5;
    for (const sx of [-1, 1]) {
      const lug = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.7, 0.6, 10), bailMat);
      lug.rotation.z = Math.PI / 2;
      lug.position.set(Math.cos(0.5) * 9.0 * sx, 7.4, -Math.sin(0.5) * 9.0 * sx);
      bucket.add(lug);
    }
    bucket.add(bs, water, bail);
    bucket.position.set(34, -38, 26);
    bucket.castShadow = true;
    this.group.add(bucket);
    this.bucketWater = water;

    this.group.add(bench);
    this.bench = bench;
  }

  /* ---------------------------------------------------------------- */
  _buildShelves() {
    const wood = woodMaps(512);
    const sm = this._mat({
      map: wood.map.clone(), normalMap: wood.normalMap.clone(), roughnessMap: wood.roughnessMap.clone(),
    }, { color: P.wood });
    for (const t of [sm.map, sm.normalMap, sm.roughnessMap].filter(Boolean)) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 1); t.needsUpdate = true;
    }
    // an upright is 5 cm across and 190 tall; a board is 180 by 34
    const postMat = this._scaled(sm, 5, 190);

    const rack = new THREE.Group();
    rack.position.set(30 - 480 / 2 + 26, 0, -60);
    rack.rotation.y = Math.PI / 2;

    const shelves = [];
    for (let i = 0; i < 4; i++) {
      const y = -32 + i * 44;
      const board = new THREE.Mesh(rbox(180, 3.4, 34, 1.3), sm);
      board.position.set(0, y, 0);
      board.castShadow = true; board.receiveShadow = true;
      rack.add(board);
      shelves.push(y);
    }
    for (const x of [-86, -28, 30, 86]) {
      const post = new THREE.Mesh(rbox(5, 190, 5, 1.3), postMat);
      post.position.set(x, 50, -13);
      post.castShadow = true;
      rack.add(post);
      const post2 = post.clone(); post2.position.z = 13;
      rack.add(post2);
    }

    // Pots drying on the shelves.
    //
    // These were diamonds. The old profile was a half sine multiplied by
    // a gaussian, which pinches to a point at BOTH ends — so every piece
    // on every shelf came to a sharp tip top and bottom and the room read
    // as a display of cut gems. They are also the only other pottery the
    // player ever sees, so they carry the whole claim that this is a
    // workshop.
    //
    // A thrown pot has four events and they happen in this order: a
    // narrow foot, a belly that is the widest thing on the piece, a neck
    // that comes back in, and a lip that opens out again. The profile
    // then rolls over the rim and goes back down the inside, which both
    // closes the form and gives the rim a visible thickness — a lathe
    // that stops at the top leaves a hole you can see straight through.
    const rng = this.rng;
    const glazeCols = GLAZES;
    this.shelfPots = [];
    for (const y of shelves) {
      const n = rng.int(3, 6);
      for (let i = 0; i < n; i++) {
        const h = rng.range(10, 26);
        let R = rng.range(4.5, 9.0);
        const foot  = rng.range(0.34, 0.54);   // radius at the foot
        const belly = rng.range(0.26, 0.46);   // height of the widest point
        const neck  = rng.range(0.44, 0.86);   // radius at the neck
        const flare = rng.range(1.00, 1.34);   // how far the lip opens back out

        const wall = (t) => {
          let f;
          if (t < belly) {
            f = foot + (1 - foot) * Math.sin((t / belly) * Math.PI * 0.5);
          } else {
            const u = (t - belly) / (1 - belly);
            f = 1 - (1 - neck) * Math.pow(Math.sin(u * Math.PI * 0.5), 1.4);
            f *= 1 + (flare - 1) * Math.pow(u, 6);
          }
          return Math.max(0.5, R * f);
        };

        // R is the nominal radius, not the widest point: the lip flares
        // by up to a third, so a pot sampled at R = 9 really reaches 10.4.
        // And the shelf uprights stand 21 cm apart, so some of these
        // simply do not FIT between them — no amount of moving them
        // along the board helps, they have to be thrown smaller. wall()
        // is linear in R, so measuring the profile once at R and scaling
        // it is exact.
        const GAP = 10.0;             // inner face of an upright, less clearance
        let wide = 0;
        for (let k = 0; k <= 22; k++) wide = Math.max(wide, wall(k / 22));
        if (wide > GAP) { R *= GAP / wide; wide = GAP; }

        const pts = [new THREE.Vector2(0.01, 0)];
        for (let k = 0; k <= 22; k++) {
          const t = k / 22;
          pts.push(new THREE.Vector2(wall(t), t * h));
        }
        // over the rim and back down the inside
        const rTop = wall(1);
        pts.push(new THREE.Vector2(rTop * 0.86, h));
        pts.push(new THREE.Vector2(rTop * 0.80, h * 0.93));
        pts.push(new THREE.Vector2(0.01, h * 0.86));

        const geo = new THREE.LatheGeometry(pts, 40);
        const fired = rng.chance(0.65);
        const mat = new THREE.MeshPhysicalMaterial({
          color: fired ? glazeCols[rng.int(0, glazeCols.length - 1)] : P.clayPale,
          // A glaze across the room has a sheen, not a glint. At
          // clearcoat 1 and roughness 0.08 every one of these threw a
          // white specular star and the shelf twinkled.
          roughness: fired ? rng.range(0.28, 0.5) : 0.92,
          metalness: 0,
          clearcoat: fired ? 0.4 : 0,
          clearcoatRoughness: 0.25,
          envMapIntensity: 0.5,
          side: THREE.DoubleSide,
        });
        // Slots, not free scatter.
        //
        // A free rng.range(-84, 84) with no separation test put three
        // pairs of these through each other — worst case two bellies
        // overlapping by 11.7 cm — and the material is DoubleSide, so an
        // overlap shows one pot's inner wall growing out of another's
        // side. The bounds also ignored the radius, so pots grew through
        // the rack uprights at |z| = 13 and hung off the front of a board
        // only 34 deep. A drying shelf is the one place a potter is tidy.
        const slot = 168 / n;
        const jitter = Math.max(0, slot / 2 - wide - 1.5);
        const x = -84 + slot * (i + 0.5) + rng.range(-jitter, jitter);
        // the uprights stand at |z| = 13 and are 5 wide, so their inner
        // faces are at 10.5
        const zRoom = Math.max(0, 10.5 - wide);
        const m = new THREE.Mesh(geo, mat);
        m.position.set(x, y + 1.8, rng.range(-zRoom, zRoom));
        m.rotation.y = rng() * TAU;
        m.castShadow = true; m.receiveShadow = true;
        rack.add(m);
        this.shelfPots.push(m);
      }
    }
    this.group.add(rack);
    this.rack = rack;
  }

  /* ---------------------------------------------------------------- */
  _buildKiln() {
    const g = new THREE.Group();
    g.position.copy(KILN_POS);
    this.kilnGroup = g;

    // Courses. Without them the kiln was a single unbroken brown slab
    // three metres across, which reads as a crate — and the player spends
    // a whole phase of the game looking at it.
    const brick = kilnBrickMaps(512);
    const bm = this._mat({
      map: brick.map.clone(), normalMap: brick.normalMap.clone(), roughnessMap: brick.roughnessMap.clone(),
    }, { color: P.kiln, normalScale: new THREE.Vector2(1.15, 1.15) });
    for (const t of [bm.map, bm.normalMap, bm.roughnessMap].filter(Boolean)) {
      // The kiln is 96 cm across and a brick is about 24, so four to a
      // tile across the front is one repeat. Box faces all carry 0..1
      // UVs whatever their size, so this is set for the face that matters.
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 1.35); t.needsUpdate = true;
    }
    this.brickMat = bm;

    const W = 96, H = 118, D = 92, TH = 12;

    // A brick is a brick whatever it is part of.
    //
    // Box geometry gives every face the same 0..1 UVs regardless of how
    // big the face is, so one shared repeat made the bricks 24 cm across
    // the 96 cm front and 5 cm across a 21 cm door jamb — the same wall
    // built out of two different sizes of brick. Each slab gets its own
    // texture scale instead, worked out from the face the player can
    // actually see, so a course is 24 by 12 everywhere.
    const BRICK = 96;   // one tile = 4 bricks across, 8 courses down
    const kilnMats = [];
    const box = (w, h, d, x, y, z) => {
      const mat = bm.clone();
      const across = Math.max(w, d);       // the broad face, not the edge
      for (const key of ['map', 'normalMap', 'roughnessMap']) {
        if (!mat[key]) continue;
        const t = mat[key].clone();
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(across / BRICK, h / BRICK);
        t.needsUpdate = true;
        mat[key] = t;
      }
      kilnMats.push(mat);
      const m = new THREE.Mesh(rbox(w, h, d, 2.2), mat);
      m.position.set(x, y, z);
      m.castShadow = true; m.receiveShadow = true;
      g.add(m);
      return m;
    };
    this.kilnMats = kilnMats;

    /* The bricks flickered, and it was not the texture.
       Every slab was cut to the kiln's FULL depth and full height and
       then pushed into place, so the side walls ran down through the
       floor and out through the back. Wherever two of them shared a
       volume they also presented the same face at the same depth --
       sixteen such pairs, the worst a 12 x 118 strip down each back
       corner and a 12 x 62 one on each door jamb, which is the face
       you stare at for the whole firing. Two coplanar surfaces at
       identical depth give the depth test nothing to choose between,
       so it chooses differently from pixel to pixel and frame to
       frame. That is the flicker.
       A real kiln is not built that way either: courses butt against
       one another. So each slab is cut to the gap it actually fills.
       Floor and crown keep the full footprint; the walls stand
       BETWEEN them; the back and front sit BETWEEN the walls. Nothing
       intersects anything, and the chamber is unchanged. */
    const y0 = -46;
    const inH = H - TH * 2;              // clear height between floor and crown
    const inW = W - TH * 2;              // clear width between the side walls
    const midY = y0 + TH + inH / 2;      // centre of that clear height

    box(W, TH, D, 0, y0 + TH / 2, 0);                    // floor
    box(W, TH, D, 0, y0 + H - TH / 2, 0);                // crown
    box(TH, inH, D, -W / 2 + TH / 2, midY, 0);           // left, between them
    box(TH, inH, D, W / 2 - TH / 2, midY, 0);            // right
    box(inW, inH, TH, 0, midY, -D / 2 + TH / 2);         // back, between the walls

    // front wall with the door opening, cut to the same clear span
    // the door must sit above the kiln floor, or you can see under the shelf
    const doorW = 54, doorH = 62, doorY = y0 + TH + 34;
    const fz = D / 2 - TH / 2;
    const inTop = y0 + H - TH;           // underside of the crown
    const inBot = y0 + TH;               // top of the floor
    const lintel = inTop - (doorY + doorH / 2);
    const sill = (doorY - doorH / 2) - inBot;
    const jamb = (inW - doorW) / 2;
    box(inW, lintel, TH, 0, inTop - lintel / 2, fz);                    // over the door
    box(inW, sill, TH, 0, inBot + sill / 2, fz);                        // under it
    box(jamb, doorH, TH, -(doorW + jamb) / 2, doorY, fz);               // left jamb
    box(jamb, doorH, TH, (doorW + jamb) / 2, doorY, fz);                // right jamb

    // the mouth: an emissive plane that becomes the brightest thing in the room
    this.kilnMouth = new THREE.Mesh(
      new THREE.PlaneGeometry(doorW - 2, doorH - 2),
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: {
          uTime: { value: 0 }, uHeat: { value: 0 },
          uCol: { value: new THREE.Color(1, 0.42, 0.12) },
          uNoise: { value: noiseTexture(256, 9) },
        },
        vertexShader: `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
        fragmentShader: `
          uniform float uTime,uHeat; uniform vec3 uCol; uniform sampler2D uNoise; varying vec2 vUv;
          void main(){
            vec2 p = vUv;
            float f = texture2D(uNoise, p*2.0 + vec2(0.0,-uTime*0.35)).r;
            float f2= texture2D(uNoise, p*5.0 + vec2(uTime*0.11,-uTime*0.6)).g;
            float flame = f*0.6 + f2*0.4;
            // Glow around the inside of the door frame, and stay clear in
            // the middle: this is a hole you look THROUGH, not a lamp.
            //
            // Rounded, and wide. min(x,1-x,y,1-y) is the distance field of
            // a SQUARE, so the glow came to a hard point in each corner and
            // the door read as a lightbox with mitred edges. A rounded-box
            // field over a longer falloff is heat coming off brick.
            vec2 q = abs(p - 0.5) - vec2(0.5 - 0.16);
            float d = 0.16 - (length(max(q, 0.0)) + min(max(q.x, q.y), 0.0));
            float ring = smoothstep(0.30, 0.02, d);
            float v = uHeat*(0.35+0.75*flame)*ring;
            vec3 c = uCol*v*1.25 + vec3(1.0,0.86,0.6)*pow(v,3.0)*0.5;
            gl_FragColor = vec4(c, clamp(v*1.1,0.0,1.0));
          }`,
        blending: THREE.AdditiveBlending,
      })
    );
    this.kilnMouth.position.set(0, doorY, fz + TH / 2 + 0.4);
    g.add(this.kilnMouth);

    // chimney
    const ch = new THREE.Mesh(rbox(26, 130, 26, 3.0), bm);
    ch.position.set(0, -46 + H + 65, -D / 2 - 6);
    ch.castShadow = true;
    g.add(ch);

    // stacked firewood
    const wood = woodMaps(512);
    const logMat = this._mat({
      map: wood.map.clone(), normalMap: wood.normalMap.clone(), roughnessMap: wood.roughnessMap.clone(),
    }, { color: P.wood });
    const rng = this.rng;
    for (let i = 0; i < 14; i++) {
      const l = new THREE.Mesh(new THREE.CylinderGeometry(3.2, 3.0, rng.range(30, 44), 8), logMat);
      l.rotation.z = Math.PI / 2;
      l.rotation.y = rng.range(-0.15, 0.15);
      l.position.set(rng.range(-14, 14), -44 + Math.floor(i / 4) * 6.6, D / 2 + 34 + (i % 4) * 7.2);
      l.castShadow = true;
      g.add(l);
    }

    // shelf inside the kiln for the piece being fired
    // A kiln shelf at 1265 C is the same colour as everything else in
    // there. This stayed cool sage grey through an entire firing while
    // the pot standing on it went white hot, which is the single thing
    // that gave away that the fire was a picture of a fire.
    this.kilnShelf = new THREE.Mesh(
      rbox(64, 3, 60, 1.2),
      new THREE.MeshStandardMaterial({
        // A kiln shelf is a dark refractory slab under a coat of wash,
        // not pale stone. At P.stone it took the two chamber lights and
        // its own incandescence and came out BRIGHTER than the pot
        // standing on it, which puts the eye on the furniture.
        color: P.refractory, roughness: 0.95,
        emissive: new THREE.Color(0x000000), emissiveIntensity: 1,
      })
    );
    this.kilnShelf.position.set(0, -46 + TH + 12, 0);
    this.kilnShelf.receiveShadow = true;
    g.add(this.kilnShelf);
    this.kilnProps = [];
    for (const dx of [-24, 24]) for (const dz of [-22, 22]) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(3, 3, 12, 10),
        new THREE.MeshStandardMaterial({
          color: P.iron, roughness: 1,
          emissive: new THREE.Color(0x000000), emissiveIntensity: 1,
        }));
      p.position.set(dx, -46 + TH + 6, dz);
      g.add(p);
      this.kilnProps.push(p);
    }

    // The air inside a kiln glows. BackSide, so it is only ever visible
    // from within the chamber and the brickwork occludes it from the
    // room — which is why it can be driven hard without turning the
    // outside of the kiln into a lamp.
    this.kilnGlow = new THREE.Mesh(
      rbox(W - TH * 2 - 2, H - TH * 2 - 2, D - TH * 2 - 2, 2.5),
      new THREE.MeshBasicMaterial({
        color: P.fire, transparent: true, opacity: 0, side: THREE.BackSide,
        blending: THREE.AdditiveBlending, depthWrite: false,
      })
    );
    this.kilnGlow.position.set(0, -46 + H / 2, 0);
    g.add(this.kilnGlow);

    this.kilnPos = KILN_POS.clone();
    this.kilnShelfY = -46 + TH + 13.5;
    this.group.add(g);
  }

  /* ---------------------------------------------------------------- */
  _buildLights() {
    // Warm sky over a warm floor. The colour is what matters here, not the
    // amount: a cold slate sky over an almost-black ground is the definition
    // of a cave however brightly the key is driven, because it is the wrap
    // term that decides what the underside of a round thing looks like.
    // Enough to keep a shadow from going black and no more. Ambient this
    // strong lights every surface equally, which is exactly how a room
    // ends up with no structure in it — the mistake that made the frame
    // one beige smear. The modelling is done by the lamp below.
    const amb = new THREE.HemisphereLight(P.ambSky, P.ambGround, 0.86);
    this.scene.add(amb);

    // the window: the key light
    // Daylight from the window: a cool, quiet counter to the lamp, and the
    // only shadow caster in the room.
    const key = new THREE.DirectionalLight(P.day, 0.70);
    key.position.set(-114, 90, -172);
    key.target.position.set(0, 6, 0);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 40;
    key.shadow.camera.far = 460;
    const S = 130;
    key.shadow.camera.left = -S; key.shadow.camera.right = S;
    key.shadow.camera.top = S; key.shadow.camera.bottom = -S;
    key.shadow.bias = -0.0009;
    key.shadow.normalBias = 0.5;
    this.scene.add(key, key.target);
    this.keyLight = key;

    // bounce off the plaster
    // The key comes from the window, which is BEHIND the room — so every
    // wall the player is looking at is backlit and every one of them went
    // black. This is the light that comes back off the plaster and shows
    // them, and at 0.42 it was doing nothing.
    const fill = new THREE.DirectionalLight(P.bounce, 0.95);
    fill.position.set(120, 60, 150);
    this.scene.add(fill);

    // The opposite bounce.
    //
    // With a single fill from one corner, every plane facing the other
    // way received nothing but the sky term and dropped to a flat slab
    // of cold green — so walking round the wheel swung the far wall
    // between warm plaster and a dark teal panel with a hard diagonal
    // edge, which reads as a hole in the room rather than as a wall.
    // A real room bounces light off all four sides.
    const fill2 = new THREE.DirectionalLight(P.bounceFar, 0.42);
    fill2.position.set(-140, 50, -130);
    this.scene.add(fill2);

    // a small warm practical over the wheel
    // THE light of the game. A pot on a wheel under a lamp: the falloff
    // is what makes the room recede and the pot the brightest thing in
    // it, and inverse-square over a short distance is what makes a pool
    // of light rather than a flood.
    const lamp = new THREE.PointLight(P.lamp, 4700, 210, 2);
    lamp.position.set(4, 62, 22);
    lamp.castShadow = false;   // one caster in the room, and it is the window
    lamp.shadow.mapSize.set(1024, 1024);
    lamp.shadow.bias = -0.002;
    this.scene.add(lamp);
    this.lamp = lamp;
    // Remembered, because update() rewrites this every frame. Without a
    // base to multiply, whatever is set here survives exactly one frame
    // and an edit to the constructor looks like it did nothing at all.
    this._lampI = lamp.intensity;

    // A soft light that rides with the camera.
    //
    // The window is the key, and it is behind the pot from half the
    // angles you can stand at. Walk round to that side and the piece
    // goes to silhouette against a wall of daylight — which is truthful
    // and completely useless when the job in hand is deciding where the
    // glaze has gone. This is the potter tipping the pot toward
    // themselves to see it: it never becomes the key light, it only
    // keeps the near face readable.
    const look = new THREE.DirectionalLight(P.look, 0.0);
    this.scene.add(look);
    this.scene.add(look.target);
    this.lookLight = look;

    const shade = new THREE.Mesh(
      new THREE.ConeGeometry(13, 12, 24, 1, true),
      new THREE.MeshPhysicalMaterial({ color: P.iron, roughness: 1, metalness: 0, specularIntensity: 0, side: THREE.DoubleSide })
    );
    shade.position.set(6, 84, 30);
    this.group.add(shade);
    const bulb = new THREE.Mesh(
      new THREE.SphereGeometry(2.0, 12, 10),
      new THREE.MeshBasicMaterial({ color: P.bulb })
    );
    bulb.position.set(6, 77, 30);
    this.group.add(bulb);
    this.bulb = bulb;

    // kiln light
    const kl = new THREE.PointLight(P.fire, 0, 420, 2);
    kl.position.copy(KILN_POS).add(new THREE.Vector3(0, 4, 44));
    this.scene.add(kl);
    this.kilnLight = kl;

    const kl2 = new THREE.PointLight(P.ember, 0, 300, 2);
    kl2.position.copy(KILN_POS).add(new THREE.Vector3(0, 18, 0));
    this.scene.add(kl2);
    this.kilnLight2 = kl2;
  }

  /* ---------------------------------------------------------------- */
  _buildAtmosphere() {
    // ---- light shaft from the window ----
    const shaft = new THREE.Mesh(
      new THREE.CylinderGeometry(46, 88, 340, 28, 1, true),
      new THREE.ShaderMaterial({
        transparent: true, depthWrite: false, side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
        uniforms: {
          uTime: { value: 0 },
          uI: { value: 0.10 },
          uNoise: { value: noiseTexture(256, 17) },
          uCol: { value: new THREE.Color(P.day) },
        },
        vertexShader: `
          varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){
            vUv=uv; vN = normalize(normalMatrix*normal);
            vec4 mv = modelViewMatrix*vec4(position,1.0);
            vV = normalize(-mv.xyz);
            gl_Position = projectionMatrix*mv;
          }`,
        fragmentShader: `
          uniform float uTime,uI; uniform vec3 uCol; uniform sampler2D uNoise;
          varying vec2 vUv; varying vec3 vN; varying vec3 vV;
          void main(){
            float rim = 1.0 - abs(dot(normalize(vN), normalize(vV)));
            float dust = texture2D(uNoise, vUv*vec2(3.0,1.4)+vec2(uTime*0.012,-uTime*0.02)).r;
            float dust2= texture2D(uNoise, vUv*vec2(7.0,3.0)-vec2(uTime*0.02,uTime*0.01)).g;
            float fade = smoothstep(0.0,0.35,vUv.y)*smoothstep(1.0,0.45,vUv.y);
            float v = uI*fade*(0.35+0.9*dust*dust2)*pow(rim,1.6);
            gl_FragColor = vec4(uCol*v, v);
          }`,
      })
    );
    shaft.position.set(-52, 30, -120);
    shaft.rotation.set(-0.95, 0.42, 0.28);
    shaft.renderOrder = 3;
    this.group.add(shaft);
    this.shaft = shaft;
    this._shaftI = shaft.material.uniforms.uI.value;

    // ---- dust motes ----
    const N = 900;
    const pos = new Float32Array(N * 3);
    const seed = new Float32Array(N);
    const rng = this.rng;
    for (let i = 0; i < N; i++) {
      pos[i * 3] = rng.range(-150, 160);
      pos[i * 3 + 1] = rng.range(-40, 150);
      pos[i * 3 + 2] = rng.range(-190, 110);
      seed[i] = rng();
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    dg.setAttribute('aSeed', new THREE.BufferAttribute(seed, 1));
    this.dust = new THREE.Points(dg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: {
        uTime: { value: 0 }, uSprite: { value: radialSprite(64, 2.4) },
        uI: { value: 1.0 },
      },
      vertexShader: `
        attribute float aSeed; uniform float uTime; varying float vA;
        void main(){
          vec3 p = position;
          float s = aSeed*100.0;
          p.x += sin(uTime*0.21+s)*7.0;
          p.y += sin(uTime*0.13+s*1.7)*5.0 + mod(uTime*1.4*(0.3+aSeed), 190.0) - 95.0;
          p.z += cos(uTime*0.17+s*0.7)*7.0;
          vec4 mv = modelViewMatrix*vec4(p,1.0);
          gl_PointSize = (0.9+aSeed*2.6) * (240.0/-mv.z);
          vA = 0.10 + 0.5*aSeed;
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: `
        uniform sampler2D uSprite; uniform float uI; varying float vA;
        void main(){
          float a = texture2D(uSprite, gl_PointCoord).a;
          gl_FragColor = vec4(vec3(0.86,0.88,0.84)*vA*uI, a*vA*uI);
        }`,
    }));
    this.dust.frustumCulled = false;
    this.group.add(this.dust);

    // ---- embers around the kiln ----
    const EN = 260;
    const ep = new Float32Array(EN * 3);
    const es = new Float32Array(EN);
    for (let i = 0; i < EN; i++) {
      ep[i * 3] = KILN_POS.x + rng.range(-40, 40);
      ep[i * 3 + 1] = rng.range(-40, 40);
      ep[i * 3 + 2] = KILN_POS.z + rng.range(-10, 60);
      es[i] = rng();
    }
    const eg = new THREE.BufferGeometry();
    eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    eg.setAttribute('aSeed', new THREE.BufferAttribute(es, 1));
    this.embers = new THREE.Points(eg, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uHeat: { value: 0 }, uSprite: { value: radialSprite(64, 2.0) } },
      vertexShader: `
        attribute float aSeed; uniform float uTime, uHeat; varying float vA; varying float vS;
        void main(){
          vec3 p = position;
          float s = aSeed*90.0;
          float life = fract(uTime*(0.10+aSeed*0.16)+aSeed);
          p.y += life*150.0;
          p.x += sin(uTime*0.8+s)*(6.0+life*22.0);
          p.z += cos(uTime*0.6+s*1.3)*(5.0+life*16.0);
          vA = uHeat*(1.0-life)*(1.0-life)*(0.4+0.6*aSeed);
          vS = aSeed;
          vec4 mv = modelViewMatrix*vec4(p,1.0);
          gl_PointSize = (1.4+aSeed*3.4)*(1.0-life*0.6)*(300.0/-mv.z);
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: `
        uniform sampler2D uSprite; varying float vA; varying float vS;
        void main(){
          float a = texture2D(uSprite, gl_PointCoord).a;
          vec3 c = mix(vec3(1.0,0.35,0.06), vec3(1.0,0.86,0.5), vS*0.7);
          gl_FragColor = vec4(c*vA*3.2, a*vA);
        }`,
    }));
    this.embers.frustumCulled = false;
    this.group.add(this.embers);

    // ---- slip spray thrown off the wheel ----
    this.spray = new SprayField(this.group, 320);
  }

  /* ---------------------------------------------------------------- */

  update(dt, state = {}) {
    this.t += dt;
    const omega = state.omega ?? 0;

    if (this.wheelHead) this.wheelHead.rotation.y += omega * dt;
    if (this.flywheel) this.flywheel.rotation.y += omega * dt * 0.42;

    this.windowPane.material.uniforms.uTime.value = this.t;
    this.shaft.material.uniforms.uTime.value = this.t;
    this.dust.material.uniforms.uTime.value = this.t;
    this.embers.material.uniforms.uTime.value = this.t;

    // kiln
    const heat = clamp01(state.kilnHeat ?? 0);
    this.kilnHeat = heat;
    this.kilnTemp = state.kilnTemp ?? 20;
    const flick = 0.86 + 0.14 * Math.sin(this.t * 7.3) * Math.sin(this.t * 3.1 + 1.2);
    this.kilnMouth.material.uniforms.uHeat.value = heat * flick;
    this.kilnMouth.material.uniforms.uTime.value = this.t;
    const bb = blackbodyRGB(this.kilnTemp + 273 + 320);
    this.kilnMouth.material.uniforms.uCol.value.setRGB(bb[0], bb[1], bb[2]);
    this.kilnLight.intensity = heat * 2400 * flick;
    this.kilnLight.color.setRGB(bb[0], bb[1] * 0.86, bb[2] * 0.7);
    this.kilnLight2.intensity = heat * 1300 * flick;
    this.kilnLight2.color.copy(this.kilnLight.color);

    // Incandescence, ramped on TEMPERATURE rather than on the heat
    // envelope: nothing glows at 300 C, dull red arrives around 600 and
    // it is white by the top of the firing. Everything in the chamber
    // takes the same colour, because in a kiln everything does.
    const inc = clamp01((this.kilnTemp - 540) / 620);
    const gl = inc * inc * flick;
    this.kilnGlow.material.color.setRGB(bb[0], bb[1], bb[2]);
    this.kilnGlow.material.opacity = 0.04 * heat + 0.26 * gl;
    if (this.kilnShelf) {
      this.kilnShelf.material.emissive.setRGB(bb[0], bb[1] * 0.92, bb[2] * 0.82);
      this.kilnShelf.material.emissiveIntensity = gl * 0.40;
      for (const p of this.kilnProps ?? []) {
        p.material.emissive.setRGB(bb[0], bb[1] * 0.92, bb[2] * 0.82);
        p.material.emissiveIntensity = gl * 0.34;
      }
    }
    this.embers.material.uniforms.uHeat.value = heat;

    // the lamp swings a little
    if (this.lamp) {
      this.lamp.position.x = 6 + Math.sin(this.t * 0.5) * 0.8;
      this.lamp.intensity = this._lampI * (0.95 + 0.05 * Math.sin(this.t * 11.0) * Math.sin(this.t * 4.3));
    }

    this.spray.update(dt);
  }

  /**
   * Let the eye adjust when the window is in shot.
   *
   * A pane three times over white is the brightest thing in the room by
   * a wide margin, and it feeds the bloom, so turning to face it washed
   * the whole frame out. A real eye stops down; this does the same,
   * smoothly, by how squarely the window is being looked at and how
   * much of the frame it fills. Nothing else in the room changes — the
   * light still comes from the same place, you just are not blinded by
   * it.
   */
  adapt(camera, dt, fill = 0) {
    if (!this._fwd) { this._fwd = new THREE.Vector3(); this._toWin = new THREE.Vector3(); }
    camera.getWorldDirection(this._fwd);
    this._toWin.copy(this.winPos).sub(camera.position);
    const dist = Math.max(1, this._toWin.length());
    this._toWin.multiplyScalar(1 / dist);
    // Looking at the pot means looking a little to one side of the
    // window behind it, so this must not demand a dead-on stare before
    // it does anything — that is exactly the angle the glare is worst at.
    const facing = Math.max(0, this._fwd.dot(this._toWin));       // 1 = straight at it
    const near = clamp01(1 - (dist - 90) / 320);                  // and how big it looms
    const glare = clamp01(Math.pow(facing, 1.8) * (0.55 + 0.45 * near));

    this._glare = damp(this._glare ?? 0, glare, 3.2, dt);
    const g = this._glare;

    const dayI = this._dayI, shaftI = this._shaftI;
    this.windowPane.material.uniforms.uI.value = dayI * (1 - 0.80 * g);
    this.shaft.material.uniforms.uI.value = shaftI * (1 - 0.70 * g);

    if (this.lookLight) {
      // A light that rides the camera flattens the pot as you orbit and
      // breaks its fixed relationship to the room. Kept only as a faint
      // lift so a piece is never unreadable, never as modelling light.
      this.lookLight.intensity = fill * 0.22;
      this.lookLight.position.copy(camera.position);
      this.lookLight.target.position.copy(camera.position).add(this._fwd);
      this.lookLight.target.updateMatrixWorld();
    }
    // Stopping down by 40% was sized for a window pane driven at 2.3,
    // which clipped to white and bloomed over everything in front of it.
    // The pane is at 1.22 now and no longer glares, so the old depth
    // just dimmed the whole room whenever the player happened to face
    // north — and under a Neutral tone curve a big exposure cut drags
    // dark surfaces into the toe, where the minimum channel is crushed
    // and the shadows come back MORE saturated, not less.
    return 1 - 0.16 * g;      // exposure the renderer should use
  }

  /**
   * Get the pan out of the way when the player crouches.
   *
   * A splash pan is a bowl the wheel head sits in, so from anywhere
   * near its own height it hides exactly the part of the pot you most
   * need to look at — the foot, the curve where it leaves the wheel,
   * the line the trimming tool has to follow. Real potters lean over
   * and turn the piece; here the near side of the pan simply gets out
   * of the way, and comes back the moment you stand up again.
   */
  setCrouch(k) {
    if (!this.splashPan) return;
    const a = 1 - 0.88 * clamp01(k);
    this.splashPan.material.opacity = a;
    this.splashPan.castShadow = a > 0.5;
  }

  /**
   * Nothing calls this today. It is kept because a day-length control is
   * a reasonable thing to want, and rewritten because as it stood it
   * hardcoded the three numbers it was scaling — so the first time
   * anyone wired it up it would have silently thrown away every value
   * set when the room was built.
   */
  setDayLight(k) {
    this._dayI = (this._dayI0 ??= this._dayI) * k;
    this._shaftI = (this._shaftI0 ??= this._shaftI) * k;
    this.keyLight.intensity = (this._keyI0 ??= this.keyLight.intensity) * k;
    this.windowPane.material.uniforms.uI.value = this._dayI;
    this.shaft.material.uniforms.uI.value = this._shaftI;
  }

  dispose() {
    this.scene.remove(this.group);
  }
}

/* ------------------------------------------------------------------ */
/*  Slip spray — clay and water flung off a spinning pot               */
/* ------------------------------------------------------------------ */

export class SprayField {
  constructor(parent, n = 320) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    this.size = new Float32Array(n);
    this.head = 0;

    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    g.setAttribute('aLife', new THREE.BufferAttribute(this.life, 1));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1));
    this.geo = g;

    this.mesh = new THREE.Points(g, new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uSprite: { value: radialSprite(64, 1.6) } },
      vertexShader: `
        attribute float aLife; attribute float aSize; varying float vL;
        void main(){
          vL = aLife;
          vec4 mv = modelViewMatrix*vec4(position,1.0);
          gl_PointSize = aSize*(300.0/-mv.z)*(0.4+0.6*aLife);
          gl_Position = projectionMatrix*mv;
        }`,
      fragmentShader: `
        uniform sampler2D uSprite; varying float vL;
        void main(){
          if(vL<=0.0) discard;
          float a = texture2D(uSprite, gl_PointCoord).a;
          gl_FragColor = vec4(vec3(0.62,0.55,0.47), a*vL*0.85);
        }`,
    }));
    this.mesh.frustumCulled = false;
    parent.add(this.mesh);
    this.rng = makeRng(4242);
  }

  emit(x, y, z, vx, vy, vz, count = 1, spread = 18) {
    const r = this.rng;
    for (let i = 0; i < count; i++) {
      const h = this.head = (this.head + 1) % this.n;
      this.pos[h * 3] = x; this.pos[h * 3 + 1] = y; this.pos[h * 3 + 2] = z;
      this.vel[h * 3] = vx + r.gauss() * spread;
      this.vel[h * 3 + 1] = vy + r.gauss() * spread * 0.5 + 12;
      this.vel[h * 3 + 2] = vz + r.gauss() * spread;
      this.life[h] = 1;
      this.size[h] = 0.6 + r() * 2.0;
    }
  }

  update(dt) {
    const p = this.pos, v = this.vel, l = this.life;
    let any = false;
    for (let i = 0; i < this.n; i++) {
      if (l[i] <= 0) continue;
      any = true;
      v[i * 3 + 1] -= 260 * dt;
      p[i * 3] += v[i * 3] * dt;
      p[i * 3 + 1] += v[i * 3 + 1] * dt;
      p[i * 3 + 2] += v[i * 3 + 2] * dt;
      l[i] -= dt * 1.25;
      if (p[i * 3 + 1] < -4) { l[i] = 0; }
    }
    if (any) {
      this.geo.attributes.position.needsUpdate = true;
      this.geo.attributes.aLife.needsUpdate = true;
      this.geo.attributes.aSize.needsUpdate = true;
    }
  }
}
