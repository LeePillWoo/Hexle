// 지형: 섬·호수·해저를 한 장의 높이맵 메시로. 칸 목록 → 부호 거리장 → 높이.
// 같은 값을 텍스처(field: 높이·해안거리·호수, field2: 바닥 종류)로도 올려서 수면·호수·후처리 셰이더가 같이 쓴다.
// 바다 수면 y=0, 호수 수면 y=LAKE_Y.
import * as THREE from 'three';
import { adjacent, centroid, clusters, fromWorld, hexLen, hexSdf, key, mostConnected, neighbors, toWorld, type Hex } from '../core/hex';
import { fbm, ridged, segDist, ss, type Pt } from '../core/noise';
import { cellsOf, isSeaKind, type Cell, type SeaKind } from '../tiles/kinds';

export const HALF = 24;                 // 지형 범위 [-HALF, HALF]²
export const LAKE_Y = 0.3;
const N = 321;                          // 격자 정점 수 = 텍스처 크기
const STEP = 2 * HALF / (N - 1);
const H_MIN = -4.5, H_RANGE = 9;        // 높이 인코딩 범위 [-4.5, 4.5]
const S_MIN = -2, S_RANGE = 12;         // 해안 거리 인코딩 범위

let notSea: Pt[] = [], seaRing: Pt[] = [], lakes: Pt[] = [], lakeRing: Pt[] = [];
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

// ── 산: 칸마다 봉우리를 세우지 않고, 묶음 전체를 하나의 산괴(massif)로 ──
//  높이 = (산 묶음 안쪽으로 얼마나 깊이 들어왔나) × (주변 산 칸이 얼마나 많나)
let mtnCells: Pt[] = [], mtnRing: Pt[] = [], mtnSet = new Set<string>();
function mountain(x: number, z: number) {
  let mass = 0;
  for (const c of mtnCells) { const d = Math.hypot(x - c.x, z - c.z); if (d < 3.5) mass += ss(3.5, 0, d); }
  if (mass < 0.02) return 0;
  const dIn = mtnSet.has(key(fromWorld(x, z))) ? minSdf(x, z, mtnRing) : -minSdf(x, z, mtnCells);
  const body = Math.max(0, dIn + 0.45) ** 1.1;                            // 안쪽으로 갈수록 계속 높아지는 원뿔꼴
  const scale = Math.min(1.3, 0.7 + 0.15 * mass ** 0.8);                   // 뭉칠수록 크게
  const wx = x + (fbm(x * 0.6, z * 0.6) - 0.5) * 1.2, wz = z + (fbm(x * 0.6 + 5, z * 0.6) - 0.5) * 1.2;   // 능선이 갈래치게
  return 0.75 * scale * body * (0.45 + 0.75 * ridged(wx * 0.9, wz * 0.9));
}
// ── 화산: 묶음 중심에 원뿔 + 분화구. 뭉칠수록 크고 높게 ──
let volcanoes: (Pt & { n: number })[] = [];
export const volcanoSize = (n: number) => ({ R: 1.1 + 0.45 * Math.sqrt(n), H: 1.0 + 0.3 * Math.min(n, 5), crater: 0.28 + 0.1 * Math.sqrt(n) });
function volcano(x: number, z: number) {
  let h = 0, dark = 0;
  for (const v of volcanoes) {
    const d = Math.hypot(x - v.x, z - v.z), { R, H, crater } = volcanoSize(v.n);
    if (d > R * 1.15) continue;
    const cone = H * ss(R, 0.1, d) ** 1.25 * (0.85 + 0.3 * fbm(x * 1.5, z * 1.5));
    h = Math.max(h, cone - H * 0.55 * ss(crater, 0, d));
    dark = Math.max(dark, ss(R * 1.1, R * 0.5, d));
  }
  return { h, dark };
}
// 해변·새 섬: 낮은 모래땅
let beaches: Pt[] = [];
const beach = (x: number, z: number) => { let b = 0; for (const c of beaches) b = Math.max(b, ss(1.2, 0.4, Math.hypot(x - c.x, z - c.z))); return -0.3 * b; };
// 설원·성 바닥 마스크
let snows: Pt[] = [], castles: Pt[] = [];
const snowAt = (x: number, z: number) => { let s = 0; for (const c of snows) s = Math.max(s, ss(0.3, -0.15, hexSdf(x, z, c.x, c.z))); return s; };
const castleAt = (x: number, z: number) => { let s = 0; for (const c of castles) s = Math.max(s, ss(0.05, -0.2, hexSdf(x, z, c.x, c.z))); return s; };

// ── 바닷속 타일: 종류별로 바닥 높이를 당긴다 (산호초는 얕게, 해구는 깊게, 용궁·유적은 평평하게) ──
let seaCells: (Pt & { kind: SeaKind })[] = [];
const SEA_TARGET: Record<SeaKind, number> = { reef: -0.5, kelp: -1.2, palace: -1.5, wreck: -1.7, ruins: -1.4, trench: -3.8, shells: -0.95 };
function seaFloor(h: number, x: number, z: number, s: number) {
  let reef = 0, paved = 0, dark = 0;
  for (const c of seaCells) {
    const w = ss(0.35, -0.2, hexSdf(x, z, c.x, c.z)) * ss(0.25, 0.9, s);   // 해안 절벽은 깎지 않는다
    if (w <= 0) continue;
    let t = SEA_TARGET[c.kind];
    if (c.kind === 'reef') t += (fbm(x * 2.2, z * 2.2) - 0.5) * 0.35 + ridged(x * 1.5, z * 1.5) * 0.15;
    else if (c.kind === 'trench') t += (fbm(x * 1.3, z * 1.3) - 0.5) * 0.6 - ridged(x * 2, z * 2) * 0.3;
    else t += (fbm(x * 3, z * 3) - 0.5) * 0.06;
    h += (Math.min(t, -0.3) - h) * w;
    if (c.kind === 'reef') reef = Math.max(reef, w);
    if (c.kind === 'palace' || c.kind === 'ruins') paved = Math.max(paved, w);
    if (c.kind === 'trench') dark = Math.max(dark, w);
  }
  return { h, reef, paved, dark };
}

// 흙(밭 바닥·마을 길) 마스크
let farmSet = new Set<string>(), farmRing: Pt[] = [], roads: [Pt, Pt][] = [], plazas: Pt[] = [];
function dirt(x: number, z: number) {
  let d = 0;
  if (farmSet.has(key(fromWorld(x, z)))) d = ss(0.06, 0.2, minSdf(x, z, farmRing));
  for (const [a, b] of roads) d = Math.max(d, ss(0.13, 0.07, segDist(x, z, a, b)));
  for (const p of plazas) d = Math.max(d, ss(0.42, 0.34, Math.hypot(x - p.x, z - p.z)));
  return d;
}
// 밭 묶음 안쪽으로 들어간 거리 (밭 밖이면 음수) — 이랑을 밭 테두리 안에만 심을 때 쓴다
export const farmInside = (x: number, z: number) => farmSet.has(key(fromWorld(x, z))) ? minSdf(x, z, farmRing) : -1;
// 흙길까지 거리 (집 배치가 길을 피하도록)
export const roadDist = (x: number, z: number) =>
  Math.min(10, ...roads.map(([a, b]) => segDist(x, z, a, b)), ...plazas.map(p => Math.hypot(x - p.x, z - p.z) - 0.3));

// 해안선을 육각형이 아니라 자연스러운 곡선으로 흔드는 저주파 노이즈
const wobble = (x: number, z: number) => (fbm(x * 0.5, z * 0.5) - 0.5) * 1.1;

function sample(x: number, z: number) {
  const n = wobble(x, z), s = seaS(x, z) + n, sea = seaH(s, x, z), lake = lakeH(lakeS(x, z) + n, x, z);
  const inland = ss(0.1, -0.7, s), onLand = ss(-0.15, -0.45, s);   // 해안 가까이에선 산·흙 효과를 줄인다
  const v = volcano(x, z);
  const h = Math.min(sea, lake) + (mountain(x, z) + v.h) * inland + beach(x, z);
  const sf = seaFloor(h, x, z, s);
  return {
    h: sf.h, s, inLake: lake < sea, dirt: dirt(x, z) * onLand,
    reef: sf.reef, paved: Math.max(sf.paved, castleAt(x, z) * onLand), dark: Math.max(sf.dark, v.dark * inland), snow: snowAt(x, z) * onLand,
  };
}

// ── GPU 공유: field(높이·바다 해안거리·호수 마스크·흙), field2(산호 모래·돌바닥·현무암·눈) + 시간 ──
const fieldData = new Uint8Array(N * N * 4), field2Data = new Uint8Array(N * N * 4);
const fieldTex = new THREE.DataTexture(fieldData, N, N), field2Tex = new THREE.DataTexture(field2Data, N, N);
fieldTex.magFilter = fieldTex.minFilter = field2Tex.magFilter = field2Tex.minFilter = THREE.LinearFilter;
export const shared = { time: { value: 0 }, field: { value: fieldTex }, field2: { value: field2Tex } };

// time 은 재질마다 선언 여부가 달라서 여기 넣지 않는다
export const FIELD_GLSL = /* glsl */`
uniform sampler2D field;
uniform sampler2D field2;
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
vec2 fieldUv(vec2 xz) { return ((xz + ${HALF.toFixed(1)}) / ${(2 * HALF).toFixed(1)} * ${(N - 1).toFixed(1)} + 0.5) / ${N.toFixed(1)}; }
vec4 fieldAt(vec2 xz) { return texture2D(field, fieldUv(xz)); }
vec4 field2At(vec2 xz) { return texture2D(field2, fieldUv(xz)); }
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
// 물속 색: 빨강부터 흡수되고 물빛이 산란돼 들어온다. y 는 수면 기준 높이, lake 0~1 (바다는 푸른 청록, 호수는 에메랄드)
vec3 absorb(vec3 c, float y, float lake) {
  vec3 T = exp(-max(0.0, -y) * mix(vec3(2.2, 0.45, 0.3), vec3(7.0, 0.9, 1.6), lake));
  return c * T + mix(vec3(0.0, 0.17, 0.3), vec3(0.0, 0.4, 0.26), lake) * (1.0 - T.g);
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
  // 바위 굴곡: 높이값 h 의 화면 미분으로 노멀을 기울이는 범프 매핑 (텍스처 없이 메시보다 잘게)
  const bump = /* glsl */`
    float rockMask = 0.0;
    vec3 bumpN(vec3 n, vec3 p, float h) {
      vec3 dpdx = dFdx(p), dpdy = dFdy(p);
      vec3 r1 = cross(dpdy, n), r2 = cross(n, dpdx);
      float det = dot(dpdx, r1);
      vec3 grad = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
      return normalize(abs(det) * n - grad);
    }
  `;
  s.vertexShader = head + s.vertexShader.replace('#include <begin_vertex>',
    '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xyz;\nvN = normalize(mat3(modelMatrix) * normal);');
  s.fragmentShader = head + bump + s.fragmentShader
    .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      // 바위: 비탈을 따라 흘러내린 결 + 잔 굴곡
      float hb = fbm(vec2(vW.x + vW.z, vW.y * 2.0) * vec2(2.2, 3.0)) * 0.08 + fbm(vW.xz * 4.0 + vW.y * 2.0) * 0.03;
      normal = bumpN(normal, -vViewPosition, hb * rockMask);`)
    .replace('#include <color_fragment>', `
      vec4 fld = fieldAt(vW.xz), f2 = field2At(vW.xz);
      float lvl = waterLevel(vW.xz);
      vec3 grass = mix(vec3(0.14, 0.34, 0.04), vec3(0.24, 0.45, 0.06), smoothstep(0.3, 0.7, fbm(vW.xz * 0.35)));
      vec3 cliff = mix(vec3(0.2, 0.12, 0.065), vec3(0.26, 0.16, 0.085),
                       smoothstep(-0.4, 0.4, sin(vW.y * 16.0 + fbm(vW.xz * 0.6) * 4.0)));   // 은은한 지층 띠
      cliff *= mix(0.65, 1.0, smoothstep(lvl, lvl + 0.35, vW.y));
      vec3 stone = mix(vec3(0.11, 0.1, 0.09), vec3(0.2, 0.18, 0.16), fbm(vW.xz * 2.5 + vW.y));
      vec3 sand = mix(vec3(0.4, 0.31, 0.18), vec3(0.6, 0.48, 0.29), smoothstep(lvl - 0.02, lvl + 0.06, vW.y));  // 젖은 모래 → 마른 모래
      sand = mix(sand, vec3(0.62, 0.6, 0.5), fld.b * smoothstep(lvl - 0.02, lvl - 0.15, vW.y));  // 호수 바닥은 밝은 석회 모래 → 에메랄드빛
      // 모래 띠: 바다는 수면 위 0.34~0.42 까지, 호수는 물가에 얇게만
      vec3 c = mix(sand, grass, smoothstep(lvl + mix(0.34, 0.02, fld.b), lvl + mix(0.42, 0.06, fld.b), vW.y));
      c = mix(c, mix(vec3(0.3, 0.19, 0.1), vec3(0.4, 0.27, 0.14), fbm(vW.xz * 6.0)), fld.a);   // 밭 흙·마을 길
      float high = smoothstep(1.1, 1.4, vW.y + fbm(vW.xz * 2.0) * 0.3);
      c = mix(c, stone, high);                                                           // 높은 곳은 바위 (낮은 산자락은 풀)
      float steep = smoothstep(0.8, 0.55, vN.y) * smoothstep(lvl - 0.15, lvl + 0.05, vW.y);
      c = mix(c, mix(cliff, stone, smoothstep(0.65, 0.85, vW.y)), steep);              // 해안 절벽은 흙 지층, 산비탈은 바위
      rockMask = max(steep, high);
      // 만년설: 높을수록, 평평할수록. 노이즈로 능선을 따라 흘러내린 자국
      float snow = smoothstep(2.35, 2.6, vW.y + (fbm(vW.xz * 3.0) - 0.5) * 0.7 + vN.y * 0.4);
      snow = max(snow, f2.a * smoothstep(lvl + 0.2, lvl + 0.38, vW.y));                // 설원 타일
      c = mix(c, vec3(0.86, 0.89, 0.94), snow);
      rockMask *= 1.0 - snow * 0.7;
      // 바닥 종류: 산호초 모래(밝은 분홍빛 + 산호 얼룩) / 돌바닥(용궁·유적·성) / 검은 현무암(해구·화산)
      vec3 reefSand = vec3(0.8, 0.72, 0.66) * (0.85 + 0.3 * fbm(vW.xz * 5.0));
      reefSand = mix(reefSand, mix(vec3(0.95, 0.35, 0.45), vec3(0.98, 0.65, 0.25), fbm(vW.xz * 9.0)), smoothstep(0.6, 0.68, fbm(vW.xz * 7.0 + 3.0)) * 0.7);
      c = mix(c, reefSand, f2.r);
      vec2 gc = abs(fract(vW.xz * 2.5) - 0.5);
      vec3 paved = mix(vec3(0.46, 0.48, 0.52), vec3(0.3, 0.32, 0.36), smoothstep(0.4, 0.47, max(gc.x, gc.y))) * (0.9 + 0.2 * fbm(vW.xz * 6.0));
      c = mix(c, paved, f2.g);
      c = mix(c, vec3(0.07, 0.065, 0.07) * (0.7 + 0.6 * fbm(vW.xz * 4.0)), f2.b);
      rockMask = max(rockMask, f2.b * 0.6);
      diffuseColor.rgb = absorb(c, vW.y - lvl, fld.b);`)
    .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += underwaterLight(vW.xz, vW.y - lvl, time) * (diffuseColor.rgb + 0.1);
      // 해구 바닥의 발광 생물
      float cellId = hash(floor(vW.xz * 24.0));
      float spark = step(0.975, cellId) * f2.b * smoothstep(-1.5, -2.5, vW.y);
      totalEmissiveRadiance += vec3(0.2, 0.7, 1.0) * spark * (0.6 + 0.4 * sin(time * 2.0 + cellId * 40.0));`);
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
// 마우스 레이가 처음 닿는 표면. 물 위에서는 수면도 맞고, 물속에서는 지형만 맞는다. 높이 격자를 따라 레이 마칭
export function pick(ray: THREE.Ray) {
  const p = new THREE.Vector3(), o = ray.origin;
  const under = o.y < surfaceAt(o.x, o.z).water;
  if (!under && ray.direction.y >= 0) return undefined;
  const t0 = ray.direction.y < 0 ? Math.max(0, (o.y - 4.5) / -ray.direction.y) : 0;   // 지형 최고 높이 위는 건너뜀
  for (let t = t0; t < t0 + 200; t += 0.04) {
    ray.at(t, p);
    if (Math.abs(p.x) > HALF + 1 || Math.abs(p.z) > HALF + 1) { if (t > t0 + 60) break; continue; }
    const s = surfaceAt(p.x, p.z);
    if (p.y <= (under ? s.h : Math.max(s.h, s.water))) return p;
  }
  return undefined;
}

// 바다에서 닿지 않는 물 칸 = 호수. 육지 바깥 한 겹을 테두리로 잡고 거기서 flood fill
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

// 칸이 바뀔 때마다 높이맵 전체를 다시 계산한다. 호수 칸 목록을 돌려준다
// ponytail: 격자점 × 칸 전수 계산 (칸 수십 개까지 수백 ms 이하). 수백 칸이면 바뀐 칸 주변만 갱신
export function setLand(cells: Cell[], extraRocks: typeof rocks = []) {
  const landCells = cells.filter(c => !isSeaKind(c.kind)), hexes = landCells.map(c => c.hex), lakeHexes = findLakes(hexes);
  const ownedOrLake = new Set([...hexes, ...lakeHexes].map(key)), lakeSet = new Set(lakeHexes.map(key));
  const ringOf = (src: Hex[], skip: Set<string>) =>
    [...new Map(src.flatMap(neighbors).filter(n => !skip.has(key(n))).map(n => [key(n), toWorld(n)])).values()];
  const of = (k: string) => landCells.filter(c => c.kind === k).map(c => c.hex);
  notSea = [...hexes, ...lakeHexes].map(toWorld);
  seaRing = ringOf(hexes, ownedOrLake);
  lakes = lakeHexes.map(toWorld);
  lakeRing = ringOf(lakeHexes, lakeSet);
  rocks = extraRocks;
  const mtns = of('mountain');
  mtnSet = new Set(mtns.map(key));
  mtnCells = mtns.map(toWorld);
  mtnRing = ringOf(mtns, mtnSet);
  volcanoes = cellsOf(cells, 'volcano').map(comp => ({ ...centroid(comp), n: comp.length }));
  beaches = [...of('beach'), ...of('islet')].map(toWorld);
  snows = of('snow').map(toWorld);
  castles = of('castle').map(toWorld);
  seaCells = cells.filter(c => isSeaKind(c.kind) && !lakeSet.has(key(c.hex))).map(c => ({ ...toWorld(c.hex), kind: c.kind as SeaKind }));
  const farms = of('farm');
  farmSet = new Set(farms.map(key));
  farmRing = ringOf(farms, farmSet);
  // 마을: 이어진 집 칸 중심끼리 흙길, 3칸 이상이면 가장 많이 이웃한 칸에 광장
  roads = []; plazas = [];
  for (const comp of clusters(of('house'))) {
    comp.forEach((a, i) => comp.slice(i + 1).forEach(b => { if (adjacent(a, b)) roads.push([toWorld(a), toWorld(b)]); }));
    if (comp.length >= 3) plazas.push(toWorld(mostConnected(comp)));
  }

  const u8 = (v: number) => Math.min(255, Math.max(0, v * 255));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + i * STEP, z = -HALF + j * STEP, k = j * N + i;
    const v = sample(x, z);
    heights[k] = v.h;
    lakeMask[k] = v.inLake ? 1 : 0;
    fieldData.set([u8((v.h - H_MIN) / H_RANGE), u8((v.s - S_MIN) / S_RANGE), v.inLake ? 255 : 0, u8(v.dirt)], k * 4);
    field2Data.set([u8(v.reef), u8(v.paved), u8(v.dark), u8(v.snow)], k * 4);
  }
  fieldTex.needsUpdate = field2Tex.needsUpdate = true;
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
