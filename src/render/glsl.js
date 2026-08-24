// ============================================================
//  CELADON — shared GLSL
// ============================================================

export const NOISE = /* glsl */`
#ifndef CEL_NOISE
#define CEL_NOISE

float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx)*0.1031); p3 += dot(p3, p3.yzx+33.33); return fract((p3.x+p3.y)*p3.z); }
vec2  hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));
  p3 += dot(p3, p3.yzx+33.33);
  return fract((p3.xx+p3.yz)*p3.zy);
}
vec3  hash32(vec2 p){
  vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));
  p3 += dot(p3, p3.yxz+33.33);
  return fract((p3.xxy+p3.yzz)*p3.zyx);
}

// value noise
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f*f*(3.0-2.0*f);
  float a = hash12(i), b = hash12(i+vec2(1,0));
  float c = hash12(i+vec2(0,1)), d = hash12(i+vec2(1,1));
  return mix(mix(a,b,u.x), mix(c,d,u.x), u.y);
}

// cylinder-safe fbm: x wraps over [0,1)
float fbm(vec2 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for(int i=0;i<8;i++){
    if(i>=oct) break;
    s += a*vnoise(p); n += a; a *= 0.5; p *= 2.03; p += 17.1;
  }
  return s/max(n,1e-4);
}
float fbm4(vec2 p){ return fbm(p,4); }
float fbm6(vec2 p){ return fbm(p,6); }

float ridged(vec2 p, int oct){
  float a = 0.5, s = 0.0, n = 0.0;
  for(int i=0;i<8;i++){
    if(i>=oct) break;
    s += a*(1.0 - abs(vnoise(p)*2.0-1.0)); n += a; a *= 0.5; p *= 2.11; p += 5.3;
  }
  return s/max(n,1e-4);
}

// worley: returns (F1, F2, cellRandom)
vec3 worley(vec2 p){
  vec2 n = floor(p), f = fract(p);
  float f1 = 8.0, f2 = 8.0, id = 0.0;
  for(int j=-1;j<=1;j++)
  for(int i=-1;i<=1;i++){
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(n+g);
    vec2 r = g + o - f;
    float d = dot(r,r);
    if(d < f1){ f2 = f1; f1 = d; id = hash12(n+g); }
    else if(d < f2){ f2 = d; }
  }
  return vec3(sqrt(f1), sqrt(f2), id);
}

// crystalline flower: radial needle bursts from scattered nuclei
// returns x = body mask, y = needle detail, z = distance from nucleus
vec3 crystalFlower(vec2 p, float needles){
  vec2 n = floor(p), f = fract(p);
  float best = 8.0; vec2 bo = vec2(0.0); float bid = 0.0;
  for(int j=-1;j<=1;j++)
  for(int i=-1;i<=1;i++){
    vec2 g = vec2(float(i), float(j));
    vec2 o = hash22(n+g+7.3);
    vec2 r = g + o - f;
    float d = dot(r,r);
    if(d < best){ best = d; bo = r; bid = hash12(n+g+7.3); }
  }
  float d = sqrt(best);
  float ang = atan(bo.y, bo.x);
  float spokes = needles * (3.0 + floor(bid*5.0));
  float lobe = 0.55 + 0.45*abs(sin(ang*spokes*0.5 + bid*9.0));
  float R = 0.30 + 0.34*bid;
  float body = smoothstep(R*lobe, R*lobe*0.55, d);
  float rings = 0.5 + 0.5*sin(d*46.0 - bid*20.0);
  return vec3(body, rings, d);
}

/* Incandescence, Kelvin in.
 *
 * This MUST be the same curve as blackbodyRGB() in core/util.js, because
 * the kiln lights itself with the JS one and the pot standing inside it
 * glows with this one. It was not: the old hand-rolled fit clamped its
 * green channel to zero below about 1150 C, so across the whole firing
 * range the kiln glowed orange and the pot inside it glowed pure
 * saturated red — which the Neutral tone curve then desaturated at the
 * shoulder into salmon pink. A pot at 1069 C came out the colour of a
 * prawn. Same coefficients as the JS now; src/dev/heat.mjs checks they
 * have not drifted apart again. */
vec3 blackbody(float T){
  float t = clamp(T, 1000.0, 12000.0) / 100.0;
  float r = t <= 66.0 ? 255.0
          : 329.698727446 * pow(t - 60.0, -0.1332047592);
  float g = t <= 66.0 ? 99.4708025861 * log(t) - 161.1195681661
          : 288.1221695283 * pow(t - 60.0, -0.0755148492);
  float b = t >= 66.0 ? 255.0
          : (t <= 19.0 ? 0.0 : 138.5177312231 * log(t - 10.0) - 305.0447927307);
  return clamp(vec3(r, g, b) / 255.0, 0.0, 1.0);
}

vec3 spectral(float t){
  // thin-film / iridescence ramp
  t = fract(t);
  return 0.5 + 0.5*cos(6.28318*(vec3(0.0,0.33,0.67) + t));
}

float sstep(float a, float b, float x){ return smoothstep(a,b,x); }

#endif
`;

// Derivative-based bump mapping. FRAGMENT STAGE ONLY — dFdx/dFdy do not
// exist in a vertex shader, and injecting them there silently kills the
// whole program.
export const BUMP = /* glsl */`
#ifndef CEL_BUMP
#define CEL_BUMP
// Mikkelsen screen-space bump
vec3 bumpNormal(vec3 N, vec3 vpos, float h, float scale){
  vec3 dpx = dFdx(vpos);
  vec3 dpy = dFdy(vpos);
  float dhx = dFdx(h);
  float dhy = dFdy(h);
  vec3 r1 = cross(dpy, N);
  vec3 r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 g = sign(det) * (r1*dhx + r2*dhy);
  return normalize(abs(det) * N - scale * g);
}
#endif
`;

export const TAU_GLSL = 'const float CEL_TAU = 6.283185307179586;\n';
