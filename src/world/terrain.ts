// 지형: 섬·호수·해저를 한 장의 높이맵 메시로. 칸 목록 → 부호 거리장 → 높이.
// 같은 값을 텍스처(field: 높이·해안거리·호수, field2: 바닥 종류)로도 올려서 수면·호수·후처리 셰이더가 같이 쓴다.
// 바다 수면 y=0, 호수 수면 y=LAKE_Y.
import * as THREE from 'three';
import { adjacent, centroid, clusters, fromWorld, hexLen, hexSdf, key, mostConnected, neighbors, toWorld, type Hex } from '../core/hex';
import { fbm, ridged, segDist, ss, type Pt } from '../core/noise';
import { cellsOf, isSeaKind, type Cell, type Kind, type SeaKind } from '../tiles/kinds';

export const HALF = 48;                 // 지형 범위 [-HALF, HALF]²
export const LAKE_Y = 0.3;
// 격자 정점 수 = 텍스처 크기. 터치 기기는 조금 성기게 (간격 0.2 / 0.27)
const N = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 361 : 481;
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
// 묶음 안쪽 거리(안쪽 양수): 같은 종류 칸 안이면 "다른 육지 칸까지", 밖이면 "가장 가까운 그 종류 칸까지"(음수).
// 바다·호수 쪽 변은 경계로 치지 않는다 → 해안 쪽에 턱이 생기지 않는다
type Region = { set: Set<string>; cells: Pt[]; ring: Pt[] };
const emptyRegion = (): Region => ({ set: new Set(), cells: [], ring: [] });
function regionS(r: Region, x: number, z: number) {
  if (!r.cells.length) return -10;
  return r.set.has(key(fromWorld(x, z))) ? (r.ring.length ? minSdf(x, z, r.ring) : 10) : -minSdf(x, z, r.cells);
}
// 모래사장·새 섬: 묶음 전체가 이어진 낮은 모래땅. 높이를 깎는 게 아니라 0.28 로 눌러서,
// 바다 쪽은 원래 해안 단면을 따라 완만하게 물속으로 들어간다 (깎으면 해변이 물에 잠겨 거품에 덮인다)
let beachR = emptyRegion();
function beach(x: number, z: number) {
  const b = regionS(beachR, x, z);
  return { cap: 0.28 + (fbm(x * 1.2, z * 1.2) - 0.5) * 0.06, k: ss(-0.15, 0.35, b), mask: ss(-0.12, 0.15, b) };
}
// 사막: 이어질수록 높아지는 모래 언덕
let desertR = emptyRegion();
function desert(x: number, z: number) {
  const d = regionS(desertR, x, z);
  if (d < -0.5) return { h: 0, mask: 0 };
  let mass = 0;
  for (const c of desertR.cells) { const k = Math.hypot(x - c.x, z - c.z); if (k < 3) mass += ss(3, 0, k); }
  const wx = x + fbm(x * 0.4, z * 0.4) * 2.5;
  const dune = Math.pow(0.5 + 0.5 * Math.sin(wx * 1.6 + z * 0.7), 2.2) * (0.6 + 0.4 * fbm(x * 0.9, z * 0.9));
  return { h: ss(0, 0.6, d) * dune * 0.06 * Math.min(4, 1 + mass), mask: ss(-0.12, 0.2, d) };
}
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
  const b = beach(x, z), ds = desert(x, z);
  const h0 = Math.min(sea, lake) + (mountain(x, z) + v.h + ds.h) * inland;
  const h = h0 + (Math.min(h0, b.cap) - h0) * b.k;
  const sf = seaFloor(h, x, z, s);
  return {
    h: sf.h, s, inLake: lake < sea, dirt: dirt(x, z) * onLand, sand: b.mask, desert: ds.mask,
    reef: sf.reef, paved: Math.max(sf.paved, castleAt(x, z) * onLand), dark: Math.max(sf.dark, v.dark * inland), snow: snowAt(x, z) * onLand,
  };
}

// ── GPU 공유: field(높이·바다 해안거리·호수 마스크·흙), field2(산호 모래·돌바닥·현무암·눈) + 시간 ──
// field3(모래사장·사막·빙판·오아시스)
const fieldData = new Uint8Array(N * N * 4), field2Data = new Uint8Array(N * N * 4), field3Data = new Uint8Array(N * N * 4);
const fieldTex = new THREE.DataTexture(fieldData, N, N), field2Tex = new THREE.DataTexture(field2Data, N, N), field3Tex = new THREE.DataTexture(field3Data, N, N);
for (const t of [fieldTex, field2Tex, field3Tex]) t.magFilter = t.minFilter = THREE.LinearFilter;
export const shared = { time: { value: 0 }, field: { value: fieldTex }, field2: { value: field2Tex }, field3: { value: field3Tex } };

// time 은 재질마다 선언 여부가 달라서 여기 넣지 않는다
export const FIELD_GLSL = /* glsl */`
uniform sampler2D field;
uniform sampler2D field2;
uniform sampler2D field3;
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
vec4 field3At(vec2 xz) { return texture2D(field3, fieldUv(xz)); }
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
  vec3 T = exp(-max(0.0, -y) * mix(vec3(1.5, 0.3, 0.2), vec3(7.0, 0.9, 1.6), lake));
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
      vec4 fld = fieldAt(vW.xz), f2 = field2At(vW.xz), f3 = field3At(vW.xz);
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
      // 모래사장: 높이와 상관없이 묶음 전체를 모래로 (물가는 젖은 모래)
      vec3 beachSand = mix(vec3(0.38, 0.28, 0.15), vec3(0.62, 0.48, 0.28), smoothstep(lvl - 0.02, lvl + 0.08, vW.y)) * (0.93 + 0.14 * fbm(vW.xz * 5.0));
      c = mix(c, beachSand, f3.r);
      // 사막: 따뜻한 모래 + 바람 물결무늬
      vec3 dSand = mix(vec3(0.52, 0.32, 0.14), vec3(0.66, 0.44, 0.2), fbm(vW.xz * 0.7));
      dSand *= 0.92 + 0.08 * sin(dot(vW.xz, vec2(0.8, 0.6)) * 26.0 + fbm(vW.xz * 2.0) * 9.0);
      c = mix(c, dSand, f3.g);
      float high = smoothstep(1.1, 1.4, vW.y + fbm(vW.xz * 2.0) * 0.3);
      c = mix(c, stone, high);                                                           // 높은 곳은 바위 (낮은 산자락은 풀)
      float steep = smoothstep(0.8, 0.55, vN.y) * smoothstep(lvl - 0.15, lvl + 0.05, vW.y);
      c = mix(c, mix(cliff, stone, smoothstep(0.65, 0.85, vW.y)), steep);              // 해안 절벽은 흙 지층, 산비탈은 바위
      rockMask = max(steep, high);
      // 만년설: 높을수록, 평평할수록. 노이즈로 능선을 따라 흘러내린 자국
      float snow = smoothstep(2.35, 2.6, vW.y + (fbm(vW.xz * 3.0) - 0.5) * 0.7 + vN.y * 0.4);
      snow = max(snow, f2.a * smoothstep(lvl + 0.2, lvl + 0.38, vW.y));                // 설원 타일
      snow = max(snow, f3.b * smoothstep(lvl - 0.01, lvl + 0.03, vW.y));               // 빙판 호숫가
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
terrain.receiveShadow = true;   // 그림자는 받기만: 수십만 삼각형을 그림자 맵에 또 그리면 태블릿이 버벅인다

// ── 빠른 조회: 마지막으로 계산한 격자에서 쌍선형 보간 ──
const heights = new Float32Array(N * N).fill(H_MIN);
const lakeMask = new Float32Array(N * N), iceMask = new Float32Array(N * N);
function grid(arr: Float32Array, x: number, z: number, outside: number) {
  const fi = (x + HALF) / STEP, fj = (z + HALF) / STEP;
  if (fi < 0 || fj < 0 || fi >= N - 1 || fj >= N - 1) return outside;
  const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * N + i;
  return (arr[k] * (1 - u) + arr[k + 1] * u) * (1 - v) + (arr[k + N] * (1 - u) + arr[k + N + 1] * u) * v;
}
export const heightFast = (x: number, z: number) => grid(heights, x, z, H_MIN);
// 그 지점의 표면: 지형 높이, 수면 높이, 호수 여부
export function surfaceAt(x: number, z: number) {
  const h = heightFast(x, z), lake = grid(lakeMask, x, z, 0) > 0.5, ice = lake && grid(iceMask, x, z, 0) > 0.5;
  return { h, lake, ice, water: lake ? LAKE_Y : 0 };
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

export type LakeType = 'water' | 'ice' | 'oasis';
export const lakeType = new Map<string, LakeType>();
let lakePts: (Pt & { type: LakeType })[] = [];
function nearestLakeType(x: number, z: number): LakeType {
  let best: LakeType = 'water', bd = Infinity;
  for (const l of lakePts) { const d = (x - l.x) ** 2 + (z - l.z) ** 2; if (d < bd) { bd = d; best = l.type; } }
  return best;
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
// ── 다시 계산: 바뀐 칸 근처만, 구역(블록) 단위로 ──
// 한 점의 높이는 반경 약 10 안의 칸에만 영향을 받는다(해안 단면 8, 산 질량 3.5 …). 그래서
//  1) 이전 상태와 비교해 바뀐 칸(+ 중심이 움직이는 화산·마을 묶음 전체, 종류가 바뀐 호수)을 모으고
//  2) 그 주변 사각형만, 24×24 점 블록마다 반경 안의 칸만 추려서 계산한다.
const MARGIN = 10.5, BLOCK = 24;
type Full = {
  notSea: Pt[]; seaRing: Pt[]; lakes: Pt[]; lakeRing: Pt[]; rocks: typeof rocks; mtnCells: Pt[]; mtnRing: Pt[]; volcanoes: typeof volcanoes;
  beachR: Region; desertR: Region; snows: Pt[]; castles: Pt[]; seaCells: typeof seaCells; farmRing: Pt[]; roads: typeof roads; plazas: Pt[]; lakePts: typeof lakePts;
};
let full: Full | null = null, prevKinds = new Map<string, string>(), prevLakes = new Map<string, LakeType>();
const hexOfKey = (k: string): Hex => { const [q, r] = k.split(','); return { q: +q, r: +r }; };
// 블록 사각형 + 여유 안의 것만 작업용 배열로
function focus(f: Full, x0: number, z0: number, x1: number, z1: number) {
  const inBox = (c: Pt, m = MARGIN) => c.x > x0 - m && c.x < x1 + m && c.z > z0 - m && c.z < z1 + m;
  const near = <T extends Pt>(arr: T[], m = MARGIN) => arr.filter(c => inBox(c, m));
  notSea = near(f.notSea); seaRing = near(f.seaRing); lakes = near(f.lakes); lakeRing = near(f.lakeRing); rocks = near(f.rocks);
  mtnCells = near(f.mtnCells); mtnRing = near(f.mtnRing); volcanoes = near(f.volcanoes, MARGIN + 3);
  beachR = { ...f.beachR, cells: near(f.beachR.cells), ring: near(f.beachR.ring) };
  desertR = { ...f.desertR, cells: near(f.desertR.cells), ring: near(f.desertR.ring) };
  snows = near(f.snows); castles = near(f.castles); seaCells = near(f.seaCells); farmRing = near(f.farmRing);
  roads = f.roads.filter(([a, b]) => inBox(a) || inBox(b)); plazas = near(f.plazas); lakePts = near(f.lakePts);
}
// 그리드 점 → 정점 번호 대응 (한 번만)
const pos = geo.attributes.position, vertK = new Int32Array(pos.count);
for (let v = 0; v < pos.count; v++) vertK[v] = Math.round((pos.getZ(v) + HALF) / STEP) * N + Math.round((pos.getX(v) + HALF) / STEP);

export function setLand(cells: Cell[], extraRocks: typeof rocks = []) {
  const landCells = cells.filter(c => !isSeaKind(c.kind)), hexes = landCells.map(c => c.hex), lakeHexes = findLakes(hexes);
  const ownedOrLake = new Set([...hexes, ...lakeHexes].map(key)), lakeSet = new Set(lakeHexes.map(key));
  const ringOf = (src: Hex[], skip: Set<string>) =>
    [...new Map(src.flatMap(neighbors).filter(n => !skip.has(key(n))).map(n => [key(n), toWorld(n)])).values()];
  const of = (k: string) => landCells.filter(c => c.kind === k).map(c => c.hex);
  const mtns = of('mountain');
  mtnSet = new Set(mtns.map(key));
  const landKeys = new Set(hexes.map(key));
  const region = (kinds: string[]): Region => {
    const hs = landCells.filter(c => kinds.includes(c.kind)).map(c => c.hex), set = new Set(hs.map(key));
    const ring = [...new Map(hs.flatMap(neighbors).filter(n => !set.has(key(n)) && landKeys.has(key(n))).map(n => [key(n), toWorld(n)])).values()];
    return { set, cells: hs.map(toWorld), ring };
  };
  // 호수 묶음마다 둘레 육지의 기후를 세어 종류를 정한다: 설원이 많으면 빙판, 사막이 많으면 오아시스
  lakeType.clear();
  const kindAt = new Map(landCells.map(c => [key(c.hex), c.kind]));
  for (const comp of clusters(lakeHexes)) {
    const inComp = new Set(comp.map(key)), around = [...new Set(comp.flatMap(neighbors).map(key).filter(k => !inComp.has(k)))].map(k => kindAt.get(k));
    const cold = around.filter(k => k === 'snow').length, hot = around.filter(k => k === 'desert').length;
    const type: LakeType = cold * 3 >= around.length && cold >= hot ? 'ice' : hot * 3 >= around.length ? 'oasis' : 'water';
    for (const h of comp) lakeType.set(key(h), type);
  }
  const farms = of('farm');
  farmSet = new Set(farms.map(key));
  // 마을: 이어진 집 칸 중심끼리 흙길, 3칸 이상이면 가장 많이 이웃한 칸에 광장
  const rds: typeof roads = [], plz: Pt[] = [];
  for (const comp of clusters(of('house'))) {
    comp.forEach((a, i) => comp.slice(i + 1).forEach(b => { if (adjacent(a, b)) rds.push([toWorld(a), toWorld(b)]); }));
    if (comp.length >= 3) plz.push(toWorld(mostConnected(comp)));
  }
  const f: Full = {
    notSea: [...hexes, ...lakeHexes].map(toWorld), seaRing: ringOf(hexes, ownedOrLake), lakes: lakeHexes.map(toWorld), lakeRing: ringOf(lakeHexes, lakeSet),
    rocks: extraRocks, mtnCells: mtns.map(toWorld), mtnRing: ringOf(mtns, mtnSet),
    volcanoes: cellsOf(cells, 'volcano').map(comp => ({ ...centroid(comp), n: comp.length })),
    beachR: region(['beach', 'islet']), desertR: region(['desert']), snows: of('snow').map(toWorld), castles: of('castle').map(toWorld),
    seaCells: cells.filter(c => isSeaKind(c.kind) && !lakeSet.has(key(c.hex))).map(c => ({ ...toWorld(c.hex), kind: c.kind as SeaKind })),
    farmRing: ringOf(farms, farmSet), roads: rds, plazas: plz, lakePts: lakeHexes.map(h => ({ ...toWorld(h), type: lakeType.get(key(h))! })),
  };

  // 바뀐 칸 모으기
  const kinds = new Map(cells.map(c => [key(c.hex), c.kind as string]));
  const dirty = new Set<string>();
  for (const [k, v] of kinds) if (prevKinds.get(k) !== v) dirty.add(k);
  for (const k of prevKinds.keys()) if (!kinds.has(k)) dirty.add(k);
  for (const [k, v] of lakeType) if (prevLakes.get(k) !== v) dirty.add(k);
  for (const k of prevLakes.keys()) if (!lakeType.has(k)) dirty.add(k);
  const prevCells: Cell[] = [...prevKinds].map(([k, v]) => ({ hex: hexOfKey(k), kind: v as Kind }));
  for (const kind of ['volcano', 'house'] as Kind[]) for (const comp of [...cellsOf(cells, kind), ...cellsOf(prevCells, kind)])
    if (comp.some(h => dirty.has(key(h)))) for (const h of comp) dirty.add(key(h));
  const first = !full;
  full = f; prevKinds = kinds; prevLakes = new Map(lakeType);
  if (!first && !dirty.size) { focus(f, -HALF, -HALF, HALF, HALF); return lakeHexes; }
  // 다시 계산할 격자 범위
  let i0 = 0, i1 = N - 1, j0 = 0, j1 = N - 1;
  if (!first) {
    const pts = [...dirty].map(k => toWorld(hexOfKey(k)));
    const clampI = (v: number) => Math.min(N - 1, Math.max(0, v));
    i0 = clampI(Math.floor((Math.min(...pts.map(p => p.x)) - MARGIN + HALF) / STEP)); i1 = clampI(Math.ceil((Math.max(...pts.map(p => p.x)) + MARGIN + HALF) / STEP));
    j0 = clampI(Math.floor((Math.min(...pts.map(p => p.z)) - MARGIN + HALF) / STEP)); j1 = clampI(Math.ceil((Math.max(...pts.map(p => p.z)) + MARGIN + HALF) / STEP));
  }
  const u8 = (v: number) => Math.min(255, Math.max(0, v * 255));
  for (let bj = j0; bj <= j1; bj += BLOCK) for (let bi = i0; bi <= i1; bi += BLOCK) {
    const ei = Math.min(i1, bi + BLOCK - 1), ej = Math.min(j1, bj + BLOCK - 1);
    focus(f, -HALF + bi * STEP, -HALF + bj * STEP, -HALF + ei * STEP, -HALF + ej * STEP);
    for (let j = bj; j <= ej; j++) for (let i = bi; i <= ei; i++) {
      const x = -HALF + i * STEP, z = -HALF + j * STEP, k = j * N + i;
      const v = sample(x, z);
      heights[k] = v.h;
      lakeMask[k] = v.inLake ? 1 : 0;
      const lt = v.inLake ? nearestLakeType(x, z) : 'water';
      iceMask[k] = lt === 'ice' ? 1 : 0;
      field3Data.set([u8(v.sand), u8(v.desert), lt === 'ice' ? 255 : 0, lt === 'oasis' ? 255 : 0], k * 4);
      fieldData.set([u8((v.h - H_MIN) / H_RANGE), u8((v.s - S_MIN) / S_RANGE), v.inLake ? 255 : 0, u8(v.dirt)], k * 4);
      field2Data.set([u8(v.reef), u8(v.paved), u8(v.dark), u8(v.snow)], k * 4);
    }
  }
  // 장식 배치(farmInside·roadDist 등)는 섬 전체 기준으로 쓴다
  focus(f, -HALF, -HALF, HALF, HALF);
  fieldTex.needsUpdate = field2Tex.needsUpdate = field3Tex.needsUpdate = true;
  for (let v = 0; v < pos.count; v++) pos.setY(v, heights[vertK[v]]);
  pos.needsUpdate = true;
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return lakeHexes;
}
