// 지형: 섬·호수·해저를 한 장의 높이맵 메시로. 칸 목록 → 부호 거리장 → 높이.
// 같은 값을 텍스처(field)로도 올려서 수면·호수 셰이더가 깊이·해안 거리로 쓴다. 바다 수면 y=0, 호수 수면 y=LAKE_Y.
import * as THREE from 'three';
import { hexSdf, key, neighbors, toWorld, type Hex } from './hex';

export type Kind = 'camp' | 'grass' | 'forest' | 'mountain' | 'beach' | 'farm' | 'flower' | 'house';
export type Cell = { hex: Hex; kind: Kind };

export const HALF = 24;                 // 지형 범위 [-HALF, HALF]²
export const LAKE_Y = 0.3;
const N = 321;                          // 격자 정점 수 = 텍스처 크기
const STEP = 2 * HALF / (N - 1);
const H_MIN = -4.5, H_RANGE = 7;        // 높이 인코딩 범위 [-4.5, 2.5]
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

type Pt = { x: number; z: number };
let notSea: Pt[] = [], seaRing: Pt[] = [], lakes: Pt[] = [], lakeRing: Pt[] = [];
let shapers: (Pt & { kind: Kind })[] = [];
let rocks: (Pt & { r: number })[] = [];

const minSdf = (x: number, z: number, cells: Pt[]) => { let d = 10; for (const c of cells) d = Math.min(d, hexSdf(x, z, c.x, c.z)); return d; };
// 바다 해안 거리(바다 쪽 양수). 안쪽은 "가장 가까운 바다 칸까지" — 육지 칸끼리 맞닿은 변이 해안으로 잡히지 않게
function seaS(x: number, z: number) {
  const out = minSdf(x, z, notSea);
  let d = out > 0 ? out : -minSdf(x, z, seaRing);
  for (const r of rocks) d = Math.min(d, Math.hypot(x - r.x, z - r.z) - r.r);
  return d;
}
// 호수 해안 거리(호수 쪽 양수)
function lakeS(x: number, z: number) {
  if (!lakes.length) return -10;
  const inside = minSdf(x, z, lakes);
  return inside > 0 ? -inside : minSdf(x, z, lakeRing);
}
// 단면. 바다: 평지 → 절벽 → 모래사장 → 넓고 얕은 대륙붕(코스틱 구간) → 깊은 바다
const LAND = (x: number, z: number) => 0.6 + (fbm(x * 0.4 + 9, z * 0.4) - 0.5) * 0.1;
const seaH = (s: number, x: number, z: number) =>
  LAND(x, z) - 0.52 * ss(-0.35, 0.05, s) - 0.38 * ss(0.05, 0.4, s) - 0.7 * ss(0.4, 3, s) - 2.9 * ss(3, 8, s);
// 호수: 평지 → 낮은 둔덕 → 얕은 분지
const lakeH = (s: number, x: number, z: number) =>
  LAND(x, z) - 0.22 * ss(-0.3, 0.1, s) - 0.75 * ss(0.1, 1.2, s);
// 타일 종류별 지형 변형 (칸 중심에서 부드럽게 퍼진다)
function shape(x: number, z: number) {
  let h = 0;
  for (const c of shapers) {
    const d = Math.hypot(x - c.x, z - c.z);
    if (d > 1.3) continue;
    if (c.kind === 'mountain') h += 1.3 * ss(1.3, 0.1, d) ** 1.6 * (0.75 + 0.5 * fbm(x * 1.3, z * 1.3));
    if (c.kind === 'beach') h -= 0.3 * ss(1.2, 0.4, d);
  }
  return h;
}
// 해안선을 육각형이 아니라 자연스러운 곡선으로 흔드는 저주파 노이즈
const wobble = (x: number, z: number) => (fbm(x * 0.5, z * 0.5) - 0.5) * 1.1;

function sample(x: number, z: number) {
  const n = wobble(x, z), s = seaS(x, z) + n, sea = seaH(s, x, z), lake = lakeH(lakeS(x, z) + n, x, z);
  return { h: Math.min(sea, lake) + shape(x, z), s, inLake: lake < sea };
}

// ── GPU 공유: 높이(R)·바다 해안거리(G)·호수 마스크(B) 텍스처 + 시간 ──
const fieldData = new Uint8Array(N * N * 4);
const fieldTex = new THREE.DataTexture(fieldData, N, N);
fieldTex.magFilter = fieldTex.minFilter = THREE.LinearFilter;
export const shared = { time: { value: 0 }, field: { value: fieldTex } };

// time 은 재질마다 선언 여부가 달라서 여기 넣지 않는다
export const FIELD_GLSL = /* glsl */`
uniform sampler2D field;
#define LAKE_Y ${LAKE_Y.toFixed(2)}
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
float waterLevel(vec2 xz) { return fieldAt(xz).b * LAKE_Y; }   // 바다 0, 호수 LAKE_Y
// 코스틱: 보로노이 셀 경계를 시간에 따라 휘게(도메인 왜곡) 해서 부드러운 곡선 그물로
float vEdge(vec2 p, float t) {
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(i, j);
    vec2 o = 0.5 + 0.35 * sin(t + 6.2831 * vec2(hash(n + g), hash(n + g + 19.7)));
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}
vec2 warp(vec2 p, float t) {
  return p + 0.28 * vec2(sin(p.y * 1.7 + t * 0.9) + sin(p.y * 0.63 - t * 0.5),
                         cos(p.x * 1.5 - t * 0.7) + cos(p.x * 0.71 + t * 0.4));
}
float caustics(vec2 p, float t) {
  p *= 1.15;
  float a = vEdge(warp(p, t), t * 0.5);
  float b = vEdge(warp(p * 1.41 + 3.1, t * 1.2), t * 0.7);
  return exp(-a * a * 45.0) * 0.65 + exp(-b * b * 60.0) * 0.45;   // 가우시안 → 부드러운 선
}
// 물속 색: 빨강부터 흡수되고 청록빛이 산란돼 들어온다. y 는 수면 기준 높이
vec3 absorb(vec3 c, float y) {
  vec3 T = exp(-max(0.0, -y) * vec3(2.2, 0.45, 0.3));
  return c * T + vec3(0.0, 0.2, 0.28) * (1.0 - T.g);
}
vec3 underwaterLight(vec2 xz, float y, float t) {
  return caustics(xz, t) * smoothstep(0.0, -0.08, y) * exp(y * 0.35) * vec3(0.85, 1.0, 0.95);
}
`;

// ── 지형 메시 ──
const geo = new THREE.PlaneGeometry(2 * HALF, 2 * HALF, N - 1, N - 1).rotateX(-Math.PI / 2);
const mat = new THREE.MeshStandardMaterial({ roughness: 0.9 });
mat.onBeforeCompile = s => {
  Object.assign(s.uniforms, shared);
  const head = 'uniform float time;\n' + FIELD_GLSL + 'varying vec3 vW;\nvarying vec3 vN;\n';
  s.vertexShader = head + s.vertexShader.replace('#include <begin_vertex>',
    '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xyz;\nvN = normalize(mat3(modelMatrix) * normal);');
  s.fragmentShader = head + s.fragmentShader
    .replace('#include <color_fragment>', `
      float lvl = waterLevel(vW.xz);
      vec3 grass = mix(vec3(0.09, 0.24, 0.035), vec3(0.16, 0.34, 0.05), smoothstep(0.3, 0.7, fbm(vW.xz * 0.35)));
      vec3 cliff = mix(vec3(0.2, 0.12, 0.065), vec3(0.26, 0.16, 0.085),
                       smoothstep(-0.4, 0.4, sin(vW.y * 16.0 + fbm(vW.xz * 0.6) * 4.0)));   // 은은한 지층 띠
      cliff *= mix(0.65, 1.0, smoothstep(lvl, lvl + 0.35, vW.y));
      vec3 stone = mix(vec3(0.26, 0.25, 0.23), vec3(0.36, 0.35, 0.32), fbm(vW.xz * 1.5));
      vec3 sand = vec3(0.5, 0.39, 0.22);
      sand = mix(sand, vec3(0.16, 0.15, 0.08), fieldAt(vW.xz).b * smoothstep(lvl - 0.05, lvl - 0.25, vW.y));  // 호수 바닥은 진흙
      vec3 c = mix(sand, grass, smoothstep(0.34, 0.42, vW.y));
      c = mix(c, stone, smoothstep(1.05, 1.35, vW.y));                                  // 산꼭대기는 돌
      float steep = smoothstep(0.8, 0.55, vN.y) * smoothstep(lvl - 0.15, lvl + 0.05, vW.y);
      c = mix(c, mix(cliff, stone, smoothstep(0.65, 0.85, vW.y)), steep);              // 해안 절벽은 흙 지층, 산비탈은 돌
      diffuseColor.rgb = absorb(c, vW.y - lvl);`)
    .replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += underwaterLight(vW.xz, vW.y - lvl, time) * (diffuseColor.rgb + 0.1);');
};
export const terrain = new THREE.Mesh(geo, mat);
terrain.castShadow = terrain.receiveShadow = true;

// ── 빠른 조회: 마지막으로 계산한 격자에서 쌍선형 보간 ──
const heights = new Float32Array(N * N).fill(H_MIN);
const lakeMask = new Float32Array(N * N);
function grid(arr: Float32Array, x: number, z: number, outside: number) {
  const fi = (x + HALF) / STEP, fj = (z + HALF) / STEP;
  if (fi < 0 || fj < 0 || fi >= N - 1 || fj >= N - 1) return outside;
  const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * N + i;
  return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + N] * (1 - u) + arr[k + N + 1] * u) * v;
}
export const heightFast = (x: number, z: number) => grid(heights, x, z, H_MIN);
// 그 지점의 표면: 지형 높이, 수면 높이, 호수 여부
export function surfaceAt(x: number, z: number) {
  const h = heightFast(x, z), lake = grid(lakeMask, x, z, 0) > 0.5;
  return { h, lake, water: lake ? LAKE_Y : 0 };
}
// 마우스 레이가 처음 닿는 표면(지형 또는 수면). 높이 격자를 따라 레이 마칭
export function pick(ray: THREE.Ray) {
  const p = new THREE.Vector3();
  if (ray.direction.y >= 0) return undefined;
  const t0 = Math.max(0, (ray.origin.y - 2.5) / -ray.direction.y);   // 지형 최고 높이 위는 건너뜀
  for (let t = t0; t < t0 + 200; t += 0.04) {
    ray.at(t, p);
    const s = surfaceAt(p.x, p.z);
    if (p.y <= Math.max(s.h, s.water)) return p;
  }
  return undefined;
}

// 바다에서 닿지 않는 물 칸 = 호수. 육지 바깥 한 겹을 테두리로 잡고 거기서 flood fill
const hexLen = (h: Hex) => (Math.abs(h.q) + Math.abs(h.r) + Math.abs(h.q + h.r)) / 2;
function findLakes(cells: Hex[]): Hex[] {
  const owned = new Set(cells.map(key)), R = Math.max(0, ...cells.map(hexLen)) + 1;
  const sea = new Set<string>(), stack: Hex[] = [];
  for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) {
    const h = { q, r };
    if (hexLen(h) === R) { sea.add(key(h)); stack.push(h); }
  }
  while (stack.length) for (const n of neighbors(stack.pop()!)) {
    const k = key(n);
    if (hexLen(n) < R && !owned.has(k) && !sea.has(k)) { sea.add(k); stack.push(n); }
  }
  const out: Hex[] = [];
  for (let q = -R; q <= R; q++) for (let r = -R; r <= R; r++) {
    const h = { q, r }, k = key(h);
    if (hexLen(h) < R && !owned.has(k) && !sea.has(k)) out.push(h);
  }
  return out;
}

// 육지가 바뀔 때마다 높이맵 전체를 다시 계산한다. 호수 칸 목록을 돌려준다
// ponytail: 격자점 × 칸 전수 계산 (칸 수십 개까지 수백 ms 이하). 수백 칸이면 바뀐 칸 주변만 갱신
export function setLand(cells: Cell[], extraRocks: typeof rocks = []) {
  const hexes = cells.map(c => c.hex), lakeHexes = findLakes(hexes);
  const ownedOrLake = new Set([...hexes, ...lakeHexes].map(key)), lakeSet = new Set(lakeHexes.map(key));
  const ringOf = (src: Hex[], skip: Set<string>) =>
    [...new Map(src.flatMap(neighbors).filter(n => !skip.has(key(n))).map(n => [key(n), toWorld(n)])).values()];
  notSea = [...hexes, ...lakeHexes].map(toWorld);
  seaRing = ringOf(hexes, ownedOrLake);
  lakes = lakeHexes.map(toWorld);
  lakeRing = ringOf(lakeHexes, lakeSet);
  shapers = cells.filter(c => c.kind === 'mountain' || c.kind === 'beach').map(c => ({ ...toWorld(c.hex), kind: c.kind }));
  rocks = extraRocks;

  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + i * STEP, z = -HALF + j * STEP, k = j * N + i;
    const { h, s, inLake } = sample(x, z);
    heights[k] = h;
    lakeMask[k] = inLake ? 1 : 0;
    fieldData[k * 4] =Math.min(1, Math.max(0, (h - H_MIN) / H_RANGE)) * 255;
    fieldData[k * 4 + 1] = Math.min(1, Math.max(0, (s - S_MIN) / S_RANGE)) * 255;
    fieldData[k * 4 + 2] = inLake ? 255 : 0;
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
  return lakeHexes;
}
