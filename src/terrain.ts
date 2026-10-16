// 지형: 섬과 해저를 한 장의 높이맵 메시로. 육지 칸 집합 → 부호 거리장 → 높이.
// 같은 높이·거리 값을 텍스처(field)로도 올려서 수면 셰이더가 깊이·해안 거리로 쓴다. 수면은 y=0.
import * as THREE from 'three';
import { hexSdf, key, neighbors, toWorld, type Hex } from './hex';

export const HALF = 24;                 // 지형 범위 [-HALF, HALF]²
const N = 257;                          // 격자 정점 수 = 텍스처 크기
const STEP = 2 * HALF / (N - 1);
const H_MIN = -4.5, H_RANGE = 5.5;      // 높이 인코딩 범위
const S_MIN = -2, S_RANGE = 12;         // 해안 거리 인코딩 범위

// ── CPU 노이즈 ──
const hash = (x: number, z: number) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
function vnoise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
const fbm = (x: number, z: number) => { let s = 0, a = 0.5; for (let i = 0; i < 4; i++) { s += a * vnoise(x, z); x *= 2.03; z *= 2.03; a *= 0.5; } return s; };
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

let hexes: { x: number; z: number }[] = [];
let ring: { x: number; z: number }[] = [];   // 육지에 붙은 바다 칸
let rocks: { x: number; z: number; r: number }[] = [];

// 해안까지 부호 거리(안쪽 음수).
// 바깥: 가장 가까운 육지 칸까지. 안쪽: 가장 가까운 바다 칸까지 — 그래야 육지 칸끼리 맞닿은 변이
// 해안(0)으로 잡히지 않고 하나의 땅으로 합쳐진다. 노이즈로 해안선을 육각형이 아닌 자연스러운 모양으로 흔든다.
function coast(x: number, z: number) {
  let out = 10;
  for (const c of hexes) out = Math.min(out, hexSdf(x, z, c.x, c.z));
  let d = out;
  if (out < 0) {
    let inn = 10;
    for (const c of ring) inn = Math.min(inn, hexSdf(x, z, c.x, c.z));
    d = -inn;
  }
  for (const r of rocks) d = Math.min(d, Math.hypot(x - r.x, z - r.z) - r.r);
  return d + (fbm(x * 0.5, z * 0.5) - 0.5) * 1.1 + (vnoise(x * 2.2, z * 2.2) - 0.5) * 0.25;
}
// 단면: 평지 0.6 → 절벽 → 모래사장(수면 근처) → 넓고 얕은 대륙붕(코스틱 구간) → 깊은 바다
function heightOf(s: number, x: number, z: number) {
  return 0.6 + (fbm(x * 0.5 + 9, z * 0.5) - 0.5) * 0.12
    - 0.52 * ss(-0.35, 0.05, s) - 0.38 * ss(0.05, 0.4, s) - 0.7 * ss(0.6, 3, s) - 2.9 * ss(3, 8, s);
}
export const heightAt = (x: number, z: number) => heightOf(coast(x, z), x, z);

// ── GPU 공유: 높이(R)·해안거리(G) 텍스처 + 시간 ──
const fieldData = new Uint8Array(N * N * 4);
const fieldTex = new THREE.DataTexture(fieldData, N, N);
fieldTex.magFilter = fieldTex.minFilter = THREE.LinearFilter;
export const shared = { time: { value: 0 }, field: { value: fieldTex } };

// time 은 재질마다 선언 여부가 달라서 여기 넣지 않는다
export const FIELD_GLSL = /* glsl */`
uniform sampler2D field;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
vec4 fieldAt(vec2 xz) { return texture2D(field, ((xz + ${HALF.toFixed(1)}) / ${(2 * HALF).toFixed(1)} * ${(N - 1).toFixed(1)} + 0.5) / ${N.toFixed(1)}); }
float landH(vec2 xz) { return fieldAt(xz).r * ${H_RANGE.toFixed(2)} + (${H_MIN.toFixed(2)}); }
float landS(vec2 xz) { return fieldAt(xz).g * ${S_RANGE.toFixed(2)} + (${S_MIN.toFixed(2)}); }
// 코스틱: 움직이는 보로노이 셀 경계 두 겹 → 수영장 바닥 그물무늬
float vEdge(vec2 p, float t) {
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(i, j);
    vec2 o = 0.5 + 0.4 * sin(t + 6.2831 * vec2(hash(n + g), hash(n + g + 19.7)));
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}
float caustics(vec2 p, float t) {
  return exp(-vEdge(p * 1.1, t * 0.8) * 14.0) * 0.7 + exp(-vEdge(p * 1.6 + 5.0, t * 1.05) * 16.0) * 0.6;
}
// 물속 색: 빨강부터 흡수되고 청록빛이 산란돼 들어온다
vec3 absorb(vec3 c, float y) {
  vec3 T = exp(-max(0.0, -y) * vec3(2.2, 0.45, 0.3));
  return c * T + vec3(0.0, 0.2, 0.28) * (1.0 - T.g);
}
vec3 underwaterLight(vec3 w, float t) {
  return caustics(w.xz, t) * smoothstep(0.0, -0.1, w.y) * exp(w.y * 0.35) * vec3(0.85, 1.0, 0.95);
}
`;

// ── 지형 메시 ──
const geo = new THREE.PlaneGeometry(2 * HALF, 2 * HALF, N - 1, N - 1).rotateX(-Math.PI / 2);
const mat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
mat.onBeforeCompile = s => {
  Object.assign(s.uniforms, shared);
  const head = 'uniform float time;\n' + FIELD_GLSL + 'varying vec3 vW;\nvarying vec3 vN;\n';
  s.vertexShader = head + s.vertexShader.replace('#include <begin_vertex>',
    '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xyz;\nvN = normalize(mat3(modelMatrix) * normal);');
  s.fragmentShader = head + s.fragmentShader
    .replace('#include <color_fragment>', `
      vec3 grass = mix(vec3(0.025, 0.09, 0.01), vec3(0.13, 0.27, 0.04), fbm(vW.xz * 3.0));
      grass = mix(grass, vec3(0.2, 0.3, 0.07), smoothstep(0.68, 0.78, fbm(vW.xz * 7.0)) * 0.6);
      grass *= 0.75 + 0.5 * vnoise(vW.xz * 40.0);   // 잔디결
      vec3 rock = mix(vec3(0.09, 0.06, 0.035), vec3(0.28, 0.2, 0.13), fbm(vec2(vW.x + vW.z, vW.y) * vec2(3.0, 6.0)));
      vec3 sand = vec3(0.55, 0.43, 0.25) * (0.85 + 0.3 * fbm(vW.xz * 4.0));
      vec3 c = mix(sand, grass, smoothstep(0.2, 0.3, vW.y));
      c = mix(c, rock * mix(0.5, 1.0, smoothstep(0.0, 0.4, vW.y)), smoothstep(0.85, 0.6, vN.y) * smoothstep(-0.2, 0.05, vW.y));
      c = mix(c, vec3(0.05, 0.08, 0.04), smoothstep(0.62, 0.7, fbm(vW.xz * 0.9 + 3.0)) * smoothstep(-0.3, -0.9, vW.y)); // 해초·바위 얼룩
      diffuseColor.rgb = absorb(c, vW.y);`)
    .replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += underwaterLight(vW, time) * (diffuseColor.rgb + 0.1);');
};
export const terrain = new THREE.Mesh(geo, mat);
terrain.castShadow = terrain.receiveShadow = true;

// 육지가 바뀔 때마다 높이맵 전체를 다시 계산한다
// ponytail: 격자점 × 육지 칸 전수 계산 (칸 수십 개까지 수십 ms). 수백 칸이면 바뀐 칸 주변만 갱신
export function setLand(cells: Hex[], extraRocks: typeof rocks = []) {
  hexes = cells.map(toWorld);
  const owned = new Set(cells.map(key));
  ring = [...new Map(cells.flatMap(neighbors).filter(n => !owned.has(key(n))).map(n => [key(n), toWorld(n)])).values()];
  rocks = extraRocks;
  const heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + i * STEP, z = -HALF + j * STEP, k = j * N + i;
    const s = coast(x, z), h = heightOf(s, x, z);
    heights[k] = h;
    fieldData[k * 4] = (h - H_MIN) / H_RANGE * 255;
    fieldData[k * 4 + 1] = Math.min(1, Math.max(0, (s - S_MIN) / S_RANGE)) * 255;
  }
  fieldTex.needsUpdate = true;
  const pos = geo.attributes.position;
  for (let v = 0; v < pos.count; v++) {
    const i = Math.round((pos.getX(v) + HALF) / STEP), j = Math.round((pos.getZ(v) + HALF) / STEP);
    pos.setY(v, heights[j * N + i]);
  }
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
}
