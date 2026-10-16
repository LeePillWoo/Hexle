// 지형: 섬·호수·해저를 한 장의 높이맵 메시로. 칸 목록 → 부호 거리장 → 높이.
// 같은 값을 텍스처(field)로도 올려서 수면·호수 셰이더가 깊이·해안 거리로 쓴다. 바다 수면 y=0, 호수 수면 y=LAKE_Y.
import * as THREE from 'three';
import { fromWorld, hexSdf, key, neighbors, toWorld, type Hex } from './hex';

export type Kind = 'camp' | 'grass' | 'forest' | 'mountain' | 'beach' | 'farm' | 'flower' | 'house';
export type Cell = { hex: Hex; kind: Kind };

export const HALF = 24;                 // 지형 범위 [-HALF, HALF]²
export const LAKE_Y = 0.3;
const N = 321;                          // 격자 정점 수 = 텍스처 크기
const STEP = 2 * HALF / (N - 1);
const H_MIN = -4.5, H_RANGE = 9;        // 높이 인코딩 범위 [-4.5, 4.5]
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
// 같은 종류끼리 이어진 칸 묶음
export function clusters(cells: Cell[], kind: Kind): Hex[][] {
  const left = new Map(cells.filter(c => c.kind === kind).map(c => [key(c.hex), c.hex]));
  const out: Hex[][] = [];
  for (const start of [...left.values()]) {
    if (!left.delete(key(start))) continue;
    const comp = [start], stack = [start];
    while (stack.length) for (const n of neighbors(stack.pop()!)) if (left.delete(key(n))) { comp.push(n); stack.push(n); }
    out.push(comp);
  }
  return out;
}
const adjacent = (a: Hex, b: Hex) => neighbors(a).some(n => n.q === b.q && n.r === b.r);

// 산: 묶음 모양에 따라 봉우리·능선을 만든다
//  1칸 작은 산 / 2~3칸이 서로 붙은 덩어리면 가운데 큰 산 하나 / 길게 이어지거나 4칸 이상이면 봉우리+능선 산맥
type Peak = Pt & { h: number; r: number };
type Ridge = { a: Pt; b: Pt; h: number; w: number };
let peaks: Peak[] = [], ridges: Ridge[] = [], beaches: Pt[] = [];
function buildMountains(cells: Cell[]) {
  peaks = []; ridges = [];
  for (const comp of clusters(cells, 'mountain')) {
    const pts = comp.map(toWorld), n = comp.length;
    const compact = n <= 3 && comp.every(a => comp.every(b => a === b || adjacent(a, b)));
    if (compact) {
      const c = { x: pts.reduce((s, p) => s + p.x, 0) / n, z: pts.reduce((s, p) => s + p.z, 0) / n };
      peaks.push({ ...c, h: [0, 0.8, 1.55, 1.95][n], r: [0, 1.25, 1.85, 2.15][n] });
    } else {
      pts.forEach(p => peaks.push({ ...p, h: 1.5 + hash(p.x, p.z) * 0.8, r: 1.25 }));    // 봉우리마다 높이 다르게
      comp.forEach((a, i) => comp.slice(i + 1).forEach(b => {
        if (adjacent(a, b)) ridges.push({ a: toWorld(a), b: toWorld(b), h: 0.95, w: 0.9 });  // 능선은 봉우리보다 낮게
      }));
    }
  }
}
function segDist(x: number, z: number, a: Pt, b: Pt) {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
function mountain(x: number, z: number) {
  let m = 0;
  for (const p of peaks) { const d = Math.hypot(x - p.x, z - p.z); if (d < p.r) m = Math.max(m, p.h * ss(p.r, 0.1, d) ** 1.6); }
  for (const r of ridges) { const d = segDist(x, z, r.a, r.b); if (d < r.w) m = Math.max(m, r.h * ss(r.w, 0, d) ** 1.3); }
  if (!m) return 0;
  const ridged = 1 - Math.abs(2 * vnoise(x * 2.6, z * 2.6) - 1);       // 날카로운 주름
  return m * (0.8 + 0.35 * fbm(x * 1.2, z * 1.2)) + m * 0.3 * ridged;
}
const beach = (x: number, z: number) => {
  let b = 0;
  for (const c of beaches) b = Math.max(b, ss(1.2, 0.4, Math.hypot(x - c.x, z - c.z)));
  return -0.3 * b;
};

// 흙(밭 바닥·마을 길) 마스크
let farmSet = new Set<string>(), farmRing: Pt[] = [], roads: [Pt, Pt][] = [], plazas: Pt[] = [];
function dirt(x: number, z: number) {
  let d = 0;
  if (farmSet.has(key(fromWorld(x, z)))) d = ss(0.06, 0.2, minSdf(x, z, farmRing));
  for (const [a, b] of roads) d = Math.max(d, ss(0.13, 0.07, segDist(x, z, a, b)));
  for (const p of plazas) d = Math.max(d, ss(0.42, 0.34, Math.hypot(x - p.x, z - p.z)));
  return d;
}

// 마을 중심 = 묶음 안에서 이웃 집이 가장 많은 칸
export const villageCenter = (comp: Hex[]) =>
  comp.reduce((best, h) => {
    const n = (x: Hex) => comp.filter(o => adjacent(o, x)).length;
    return n(h) > n(best) ? h : best;
  });
// 밭 묶음 안쪽으로 들어간 거리 (밭 밖이면 음수) — 이랑을 밭 테두리 안에만 심을 때 쓴다
export const farmInside = (x: number, z: number) => farmSet.has(key(fromWorld(x, z))) ? minSdf(x, z, farmRing) : -1;
// 흙길까지 거리 (집 배치가 길을 피하도록)
export const roadDist = (x: number, z: number) =>
  Math.min(10, ...roads.map(([a, b]) => segDist(x, z, a, b)), ...plazas.map(p => Math.hypot(x - p.x, z - p.z) - 0.3));

// 해안선을 육각형이 아니라 자연스러운 곡선으로 흔드는 저주파 노이즈
const wobble = (x: number, z: number) => (fbm(x * 0.5, z * 0.5) - 0.5) * 1.1;

function sample(x: number, z: number) {
  const n = wobble(x, z), s = seaS(x, z) + n, sea = seaH(s, x, z), lake = lakeH(lakeS(x, z) + n, x, z);
  const inland = ss(0.1, -0.7, s);   // 해안 가까이에선 산·흙 효과를 줄인다
  return { h: Math.min(sea, lake) + mountain(x, z) * inland + beach(x, z), s, inLake: lake < sea, dirt: dirt(x, z) * ss(-0.15, -0.45, s) };
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
// 물속 색: 빨강부터 흡수되고 물빛이 산란돼 들어온다. y 는 수면 기준 높이, lake 0~1
// 바다는 푸른 청록, 호수는 에메랄드
vec3 absorb(vec3 c, float y, float lake) {
  // 호수는 얕아서 흡수를 몇 배로 줘야 물빛이 산다
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
  s.vertexShader = head + s.vertexShader.replace('#include <begin_vertex>',
    '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xyz;\nvN = normalize(mat3(modelMatrix) * normal);');
  s.fragmentShader = head + s.fragmentShader
    .replace('#include <color_fragment>', `
      vec4 fld = fieldAt(vW.xz);
      float lvl = waterLevel(vW.xz);
      vec3 grass = mix(vec3(0.09, 0.24, 0.035), vec3(0.16, 0.34, 0.05), smoothstep(0.3, 0.7, fbm(vW.xz * 0.35)));
      vec3 cliff = mix(vec3(0.2, 0.12, 0.065), vec3(0.26, 0.16, 0.085),
                       smoothstep(-0.4, 0.4, sin(vW.y * 16.0 + fbm(vW.xz * 0.6) * 4.0)));   // 은은한 지층 띠
      cliff *= mix(0.65, 1.0, smoothstep(lvl, lvl + 0.35, vW.y));
      vec3 stone = mix(vec3(0.11, 0.1, 0.09), vec3(0.2, 0.18, 0.16), fbm(vW.xz * 2.5 + vW.y));
      vec3 sand = vec3(0.5, 0.39, 0.22);
      sand = mix(sand, vec3(0.62, 0.6, 0.5), fld.b * smoothstep(lvl - 0.02, lvl - 0.15, vW.y));  // 호수 바닥은 밝은 석회 모래 → 에메랄드빛
      // 모래 띠: 바다는 수면 위 0.34~0.42 까지, 호수는 물가에 얇게만
      vec3 c = mix(sand, grass, smoothstep(lvl + mix(0.34, 0.02, fld.b), lvl + mix(0.42, 0.06, fld.b), vW.y));
      c = mix(c, mix(vec3(0.3, 0.19, 0.1), vec3(0.4, 0.27, 0.14), fbm(vW.xz * 6.0)), fld.a);   // 밭 흙·마을 길
      c = mix(c, stone, smoothstep(1.3, 1.6, vW.y + fbm(vW.xz * 2.0) * 0.3));           // 높은 곳은 바위 (낮은 산자락은 풀)
      float steep = smoothstep(0.8, 0.55, vN.y) * smoothstep(lvl - 0.15, lvl + 0.05, vW.y);
      c = mix(c, mix(cliff, stone, smoothstep(0.65, 0.85, vW.y)), steep);              // 해안 절벽은 흙 지층, 산비탈은 바위
      c = mix(c, vec3(0.8, 0.83, 0.88), smoothstep(2.15, 2.35, vW.y + fbm(vW.xz * 3.0) * 0.3) * smoothstep(0.35, 0.6, vN.y)); // 봉우리 만년설
      diffuseColor.rgb = absorb(c, vW.y - lvl, fld.b);`)
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
  const t0 = Math.max(0, (ray.origin.y - 4.5) / -ray.direction.y);   // 지형 최고 높이 위는 건너뜀
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
  rocks = extraRocks;
  buildMountains(cells);
  beaches = cells.filter(c => c.kind === 'beach').map(c => toWorld(c.hex));
  const farms = cells.filter(c => c.kind === 'farm').map(c => c.hex);
  farmSet = new Set(farms.map(key));
  farmRing = ringOf(farms, farmSet);
  // 마을: 이어진 집 칸 중심끼리 흙길, 3칸 이상이면 가장 많이 이웃한 칸에 광장
  roads = []; plazas = [];
  for (const comp of clusters(cells, 'house')) {
    comp.forEach((a, i) => comp.slice(i + 1).forEach(b => { if (adjacent(a, b)) roads.push([toWorld(a), toWorld(b)]); }));
    if (comp.length >= 3) plazas.push(toWorld(villageCenter(comp)));
  }

  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + i * STEP, z = -HALF + j * STEP, k = j * N + i;
    const { h, s, inLake, dirt } = sample(x, z);
    fieldData[k * 4 + 3] = dirt * 255;
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
