// 마을 생활: 카메라가 마을 가까이 내려앉았을 때만 그 마을 하나에 주민·소품·굴뚝 연기·동물을 만들고, 떠나면 지운다.
//  섬을 다시 만들 때는 마을 배치(집·우물·가판대 자리)만 towns 에 기록하므로 평소 화면과 타일 배치 속도는 그대로다.
//  주민은 부위별 InstancedMesh 라 몇 명이든 드로우콜이 일정하고, 소품은 마을 하나당 한 덩어리로 합친다.
//  기기에 따라 인원·소품을 나눈다 (PC > 태블릿 > 모바일).
import * as THREE from 'three';
import { centroid, fromWorld, key, neighbors, toWorld, type Hex } from '../core/hex';
import { rng, seedOf } from '../core/noise';
import { heightFast, roadDist } from '../world/terrain';
import { buildModel } from '../items/models';
import { glowMat, merge, paint, puffs, smokeTex, vc, vcFlat } from './models';

// 카메라가 바라보는 곳과 그곳까지 거리 (main 이 매 프레임 채운다)
export const view = { target: new THREE.Vector3(), dist: Infinity };
const SHOW_DIST = 7;   // 이보다 가까이 확대했을 때만

const mq = (q: string) => typeof matchMedia !== 'undefined' && matchMedia(q).matches;
export const TIER = mq('(max-width: 760px)') ? 'mobile' : mq('(pointer: coarse)') ? 'tablet' : 'pc';
// 기기별: 인원 배수·상한, 소품 비율(1 = 집마다 전부), 굴뚝 연기 나는 집 수, 창문 불빛·동물
const LOD = {
  pc: { mult: 4, cap: 56, props: 1, smoke: 6, glow: true, animals: true },
  tablet: { mult: 2.5, cap: 36, props: 1, smoke: 4, glow: true, animals: true },
  mobile: { mult: 1.25, cap: 18, props: 0.5, smoke: 2, glow: false, animals: false },
}[TIER];

// ── 마을 배치 기록 (village() 가 채우고 decorateAll 이 비운다) ──
export type Home = { x: number; z: number; face: number; s: number };
export type SpotKind = 'door' | 'stand' | 'well' | 'stall' | 'bench' | 'stroll';
export type Spot = { x: number; z: number; hub: Hex; kind: SpotKind; face?: number; busy?: boolean };
export type Town = { comp: Hex[]; well?: Hex; homes: Home[]; spots: Spot[]; stalls: { x: number; z: number; face: number }[] };
export const towns: Town[] = [];
export const lifeGroup = new THREE.Group();

// ── 모델 ──
const W = 0xffffff;   // 흰색으로 칠하고 인스턴스 색을 곱한다
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c = W) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
const ball = (r: number, x: number, y: number, z: number, c: number) => paint(new THREE.IcosahedronGeometry(r, 0).translate(x, y, z), c);
export const benchGeo = merge(
  box(0.2, 0.02, 0.12, 0, 0.07, 0, 0x9a7048),
  ...[-0.08, 0.08].map(x => box(0.02, 0.07, 0.1, x, 0.035, 0, 0x7a5432)),
  ...[-0.11, 0.11].map(z => box(0.2, 0.015, 0.04, 0, 0.045, z, 0x9a7048)),
);
// 사람 부위: 몸통·머리·머리카락·모자·앞치마는 사람 기준 자리에, 팔다리·손에 든 것은 축(어깨·엉덩이·손)이 원점
const PART = {
  torso: box(0.046, 0.052, 0.03, 0, 0.076, 0),
  head: paint(new THREE.IcosahedronGeometry(0.022, 1).translate(0, 0.122, 0), W),
  hair: paint(new THREE.SphereGeometry(0.024, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.126, -0.003), W),
  hat: merge(paint(new THREE.CylinderGeometry(0.036, 0.036, 0.004, 12).translate(0, 0.139, 0), W), paint(new THREE.CylinderGeometry(0.017, 0.02, 0.02, 12).translate(0, 0.15, 0), W)),
  apron: box(0.04, 0.046, 0.004, 0, 0.066, 0.017),
  leg: box(0.018, 0.05, 0.02, 0, -0.025, 0),
  arm: box(0.012, 0.046, 0.014, 0, -0.023, 0),
  bucket: merge(paint(new THREE.CylinderGeometry(0.013, 0.011, 0.02, 8).translate(0, -0.01, 0), 0x8a8f96), paint(new THREE.CylinderGeometry(0.011, 0.011, 0.002, 8).translate(0, -0.002, 0), 0x3f7fb0)),
  basket: merge(paint(new THREE.CylinderGeometry(0.016, 0.012, 0.014, 8).translate(0, -0.008, 0), 0xb08a4a), ball(0.007, -0.006, 0.001, 0, 0xc0392b), ball(0.007, 0.006, 0.001, 0, 0xe0a020)),
  cane: paint(new THREE.CylinderGeometry(0.003, 0.003, 0.07, 5).translate(0, -0.035, 0), 0x6b4a2b),
};
const SKIN = [0xf1c9a5, 0xd9a47a, 0xa8714a, 0xf6d7bd, 0xe0b48c];
const SHIRT = [0xc0563f, 0x3f6fa0, 0x6a9a4a, 0xd9a83a, 0x8a4f9e, 0xe8e2d4, 0x2f8a8a, 0xd97a8a];
const PANTS = [0x4a4038, 0x3a4a6a, 0x5a4a3a, 0x2f3a2f, 0x6a5a4a];
const HAIR = [0x3a2a1e, 0x6b4a2b, 0xc89a4a, 0x1e1a18, 0xa0522d];
const HATS = [0xd9b552, 0x6b4a2b, 0x3f6fa0, 0xc0563f];

// 집 소품 (집 기준 좌표: 문이 +z, 지붕 크기 1 기준)
const flowerBox = merge(box(0.22, 0.025, 0.03, 0, 0.155, 0.205, 0x8a6038),
  ...[0xe05a7a, 0xf0c040, 0xd04040, 0xb070e0, 0xf08a40].map((c, i) => ball(0.013, -0.08 + i * 0.04, 0.176, 0.205, c)));
const mailbox = merge(box(0.01, 0.09, 0.01, 0.21, 0.045, 0.3, 0x6b4a2b), box(0.03, 0.026, 0.045, 0.21, 0.1, 0.3, 0xb03a2e));
const woodpile = merge(...[[-0.03, 0.012], [0, 0.012], [0.03, 0.012], [-0.015, 0.035], [0.015, 0.035], [0, 0.058]].map(([x, y]) =>
  paint(new THREE.CylinderGeometry(0.013, 0.013, 0.13, 6).rotateX(Math.PI / 2).translate(0.32 + x, y, -0.05), 0x8a5a33)));
const lineGeo = merge(...[-0.16, 0.16].map(z => box(0.008, 0.13, 0.008, -0.34, 0.065, z, 0x7a5432)), box(0.003, 0.003, 0.32, -0.34, 0.125, 0, 0xe8e2d4));
const clothGeo = box(0.003, 0.05, 0.045, 0, -0.025, 0);
const garden = merge(box(0.26, 0.014, 0.16, 0, 0.007, -0.43, 0x6b4a2b),
  ...[0, 1, 2, 3, 4, 5].map(i => ball(0.022, -0.09 + (i % 3) * 0.09, 0.025, -0.47 + Math.floor(i / 3) * 0.08, i % 2 ? 0x6fb04a : 0x8ccc5e)));
const windowsGlow = merge(...[-0.14, 0.14].map(x => box(0.07, 0.07, 0.004, x, 0.21, 0.19, 0xffcf70)),
  ...[-0.1, 0.1].map(x => box(0.07, 0.07, 0.004, x, 0.21, -0.19, 0xffcf70)), box(0.004, 0.07, 0.07, 0.229, 0.21, 0, 0xffcf70));
const lampPost = merge(box(0.012, 0.17, 0.012, 0, 0.085, 0, 0x3a3a3a), paint(new THREE.ConeGeometry(0.026, 0.02, 4).rotateY(Math.PI / 4).translate(0, 0.205, 0), 0x3a3a3a));
const lampGlow = box(0.028, 0.03, 0.028, 0, 0.18, 0, 0xffd27a);
const VILLAGE_ANIMAL = 0.45;   // 마을 동물은 들판 동물보다 작게

type P = { x: number; z: number };
type Role = 'adult' | 'child' | 'elder' | 'vendor';
type Folk = {
  role: Role; x: number; y: number; z: number; ry: number; size: number; speed: number; step: number;
  at: Spot; path: P[]; wait: number; inside: boolean; sit: boolean; talk: boolean; chat: number;
  carry: 0 | 1 | 2; cane: boolean; hat: boolean; apron: boolean; leader?: Folk;
  legs: number; armL: number; armR: number;
};
const ALLOWED: Record<Role, SpotKind[]> = {
  adult: ['door', 'stand', 'well', 'stall', 'bench', 'stroll'],
  elder: ['door', 'bench', 'bench', 'bench', 'stroll', 'well'],   // 벤치를 자주 고른다
  child: ['stroll', 'stroll', 'well', 'stand', 'stall'],
  vendor: [],
};

// 마을 하나의 생활을 만든다. update 와 dispose 를 돌려준다
function build(town: Town) {
  const g = new THREE.Group(), rnd = rng(seedOf(town.comp[0]) + 131), updates: ((t: number, dt: number) => void)[] = [];
  const inComp = new Set(town.comp.map(key)), wellKey = town.well && key(town.well), wellPos = town.well && toWorld(town.well);
  const spots = town.spots.map(s => ({ ...s }));
  const free = (x: number, z: number, r: number) => town.homes.every(h => Math.hypot(h.x - x, h.z - z) > r)
    && (!wellPos || Math.hypot(wellPos.x - x, wellPos.z - z) > 0.3) && inComp.has(key(fromWorld(x, z)));
  const homeMat = (h: Home) => new THREE.Matrix4().compose(new THREE.Vector3(h.x, heightFast(h.x, h.z) - 0.01, h.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.face), new THREE.Vector3(h.s, h.s, h.s));
  const toLocal = (h: Home, lx: number, lz: number) => ({ x: h.x + (Math.cos(h.face) * lx + Math.sin(h.face) * lz) * h.s, z: h.z + (-Math.sin(h.face) * lx + Math.cos(h.face) * lz) * h.s });

  // ── 길가: 산책 자리·벤치·가로등 ──
  const solid: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [];
  const at = (geo: THREE.BufferGeometry, m: THREE.Matrix4, list = solid) => list.push(geo.clone().applyMatrix4(m));
  const place = (x: number, z: number, rotY = 0) => new THREE.Matrix4().makeRotationY(rotY).setPosition(x, heightFast(x, z), z);
  let road = 0;
  for (const a of town.comp) for (const b of neighbors(a)) {
    if (!inComp.has(key(b)) || key(a) > key(b)) continue;
    const pa = toWorld(a), pb = toWorld(b), len = Math.hypot(pb.x - pa.x, pb.z - pa.z), px = -(pb.z - pa.z) / len, pz = (pb.x - pa.x) / len;
    const on = (t: number, side: number) => ({ x: pa.x + (pb.x - pa.x) * t + px * side, z: pa.z + (pb.z - pa.z) * t + pz * side });
    for (const t of [0.3, 0.7]) for (const side of [-0.1, 0.1]) {
      const p = on(t, side);
      if (free(p.x, p.z, 0.24)) spots.push({ ...p, hub: t < 0.5 ? a : b, kind: 'stroll' });
    }
    const side = road % 2 ? 1 : -1;
    if (road % (LOD.props < 1 ? 2 : 1) === 0) {   // 벤치: 길을 향해 앉는다
      const p = on(0.42, 0.2 * side);
      if (free(p.x, p.z, 0.3)) {
        at(benchGeo, place(p.x, p.z, -Math.atan2(pb.z - pa.z, pb.x - pa.x)));
        spots.push({ ...p, hub: a, kind: 'bench', face: Math.atan2(-px * side, -pz * side) });
      }
    }
    const l = on(0.6, -0.17 * side);   // 가로등: 맞은편
    if (free(l.x, l.z, 0.24)) { at(lampPost, place(l.x, l.z)); at(lampGlow, place(l.x, l.z), glow); }
    road++;
  }

  // ── 집 소품: 창가 화분·우체통·장작더미·빨래줄·텃밭·창문 불빛·굴뚝 연기 ──
  const cloths: THREE.Matrix4[] = [], clothCols: THREE.Color[] = [];
  let smoke = 0;
  town.homes.forEach((h, i) => {
    if (LOD.props < 1 && i % 2) return;
    const m = homeMat(h);
    at(flowerBox, m);
    if (i % 3 === 0) at(mailbox, m);
    if (i % 2 === 0) at(woodpile, m);
    if (i % 3 === 1) {
      at(lineGeo, m);
      for (let k = 0; k < 4; k++) { cloths.push(m.clone().multiply(new THREE.Matrix4().makeTranslation(-0.34, 0.125, -0.11 + k * 0.073))); clothCols.push(new THREE.Color(SHIRT[Math.floor(rnd() * SHIRT.length)])); }
    }
    const gp = toLocal(h, 0, -0.43);
    if (i % 4 === 2 && free(gp.x, gp.z, 0.2) && roadDist(gp.x, gp.z) > 0.25) at(garden, m);
    if (LOD.glow && i % 5 < 2) at(windowsGlow, m, glow);
    if (smoke < LOD.smoke && i % 2 === 0) {
      const c = toLocal(h, 0.13, -0.07);
      updates.push(puffs(g, { x: c.x, y: heightFast(h.x, h.z) + 0.72 * h.s, z: c.z, n: 5, color: 0xdedad2, size: [0.05, 0.17], rise: 0.8, drift: 0.12, speed: 0.1, tex: smokeTex, opacity: 0.4, spread: 0.02 }));
      smoke++;
    }
  });
  if (solid.length) { const m = new THREE.Mesh(merge(...solid), vcFlat); m.receiveShadow = true; g.add(m); }
  if (glow.length) g.add(new THREE.Mesh(merge(...glow), glowMat));
  if (cloths.length) {   // 빨래: 바람에 흔들린다
    const cm = new THREE.InstancedMesh(clothGeo, vc, cloths.length), sw = new THREE.Matrix4(), out = new THREE.Matrix4();
    clothCols.forEach((c, i) => cm.setColorAt(i, c));
    g.add(cm);
    updates.push(t => { cloths.forEach((m, i) => cm.setMatrixAt(i, out.multiplyMatrices(m, sw.makeRotationZ(Math.sin(t * 2.2 + i * 1.3) * 0.3 + 0.1)))); cm.instanceMatrix.needsUpdate = true; });
  }

  // ── 주민 ──
  const base = town.comp.length === 1 ? 2 : Math.min(3 + town.comp.length * 2, 14);
  const n = Math.min(LOD.cap, Math.round(base * LOD.mult));
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
  const folk: Folk[] = [];
  const nVendor = Math.min(town.stalls.length, Math.floor(n / 6));
  for (let i = 0; i < n; i++) {
    const role: Role = i < nVendor ? 'vendor' : i % 4 === 1 ? 'child' : i % 7 === 3 ? 'elder' : 'adult';
    const st = role === 'vendor' ? town.stalls[i] : undefined;
    const s0 = st ? { x: st.x, z: st.z, hub: town.comp[0], kind: 'stand' as const, face: st.face } : pick(spots.filter(s => s.kind !== 'bench'));
    folk.push({
      role, x: s0.x, y: heightFast(s0.x, s0.z), z: s0.z, ry: s0.face ?? rnd() * 6, size: role === 'child' ? 0.75 : 1.1,
      speed: role === 'child' ? 0.32 : role === 'elder' ? 0.12 : 0.18 + rnd() * 0.05, step: rnd() * 6,
      at: s0, path: [], wait: rnd() * 3, inside: false, sit: false, talk: false, chat: rnd() * 10, carry: 0,
      cane: role === 'elder', hat: role !== 'child' && rnd() < 0.35, apron: role === 'vendor' || (role === 'adult' && rnd() < 0.2),
      legs: 0, armL: 0, armR: 0,
    });
  }
  // 아이 둘씩 술래잡기: 뒤 아이는 앞 아이가 가는 곳을 따라간다
  const kids = folk.filter(f => f.role === 'child');
  for (let i = 1; i < kids.length; i += 2) kids[i].leader = kids[i - 1];

  const mk = (geo: THREE.BufferGeometry, shadow = false) => {
    const m = new THREE.InstancedMesh(geo, vc, Math.max(1, n));
    m.frustumCulled = false;
    m.castShadow = shadow;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    g.add(m);
    return m;
  };
  const M = {
    torso: mk(PART.torso, true), head: mk(PART.head, true), hair: mk(PART.hair), hat: mk(PART.hat), apron: mk(PART.apron),
    legL: mk(PART.leg), legR: mk(PART.leg), armL: mk(PART.arm), armR: mk(PART.arm), bucket: mk(PART.bucket), basket: mk(PART.basket), cane: mk(PART.cane),
  };
  folk.forEach((f, i) => {
    const shirt = new THREE.Color(pick(SHIRT)), pants = new THREE.Color(pick(PANTS));
    M.torso.setColorAt(i, shirt); M.armL.setColorAt(i, shirt); M.armR.setColorAt(i, shirt);
    M.legL.setColorAt(i, pants); M.legR.setColorAt(i, pants);
    M.head.setColorAt(i, new THREE.Color(pick(SKIN)));
    M.hair.setColorAt(i, new THREE.Color(f.role === 'elder' ? 0xc8c8c4 : pick(HAIR)));
    M.hat.setColorAt(i, new THREE.Color(pick(HATS)));
    M.apron.setColorAt(i, new THREE.Color(f.role === 'vendor' ? 0xf2ead8 : 0xe8d6b0));
  });

  // 칸 사이 최단 경로 (같은 마을 칸만 밟는다). 우물 칸은 가운데를 지나지 않고 둘레로 돈다
  function hubs(a: Hex, b: Hex) {
    const prev = new Map<string, Hex | null>([[key(a), null]]), queue = [a];
    while (queue.length) {
      const h = queue.shift()!;
      if (key(h) === key(b)) break;
      for (const nb of neighbors(h)) if (inComp.has(key(nb)) && !prev.has(key(nb))) { prev.set(key(nb), h); queue.push(nb); }
    }
    const out: Hex[] = [];
    for (let h: Hex | null | undefined = b; h; h = prev.get(key(h))) out.unshift(h);
    return out;
  }
  function route(from: P, to: Spot, fromHub: Hex): P[] {
    if (town.comp.length === 1) return [to];   // 집 한 채뿐인 마을: 앞마당에서 바로
    const hs = hubs(fromHub, to.hub), pts: P[] = [];
    hs.forEach((h, i) => {
      const w = toWorld(h);
      if (key(h) !== wellKey) { pts.push(w); return; }
      const p = pts.at(-1) ?? from, nx = i + 1 < hs.length ? toWorld(hs[i + 1]) : to;
      const a0 = Math.atan2(p.z - w.z, p.x - w.x), a1 = Math.atan2(nx.z - w.z, nx.x - w.x);
      const d = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)), steps = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 4)));
      for (let k = 0; k <= steps; k++) { const a = a0 + d * k / steps; pts.push({ x: w.x + Math.cos(a) * 0.3, z: w.z + Math.sin(a) * 0.3 }); }
    });
    pts.push(to);
    return pts;
  }
  function choose(f: Folk) {
    const kinds = ALLOWED[f.role], kind = pick(kinds);
    const opts = spots.filter(s => s !== f.at && !s.busy && s.kind === kind);
    return opts.length ? pick(opts) : pick(spots.filter(s => s !== f.at && !s.busy && kinds.includes(s.kind)));
  }
  function arrive(f: Folk) {
    const s = f.at, kid = f.role === 'child';
    if (s.kind === 'door' && !kid && rnd() < 0.6) { f.inside = true; f.carry = 0; f.wait = 4 + rnd() * 6; return; }
    if (s.kind === 'bench' && !s.busy) { s.busy = true; f.sit = true; f.ry = s.face!; f.wait = 6 + rnd() * 8; return; }
    if (s.kind === 'well' && !kid && rnd() < 0.7) f.carry = 1;     // 물 긷기
    if (s.kind === 'stall' && !kid && rnd() < 0.6) f.carry = 2;    // 장보기
    if (s.face !== undefined) f.ry = s.face;
    f.wait = kid ? 0.3 + rnd() : 1.5 + rnd() * 3;
  }

  const base4 = new THREE.Matrix4(), part = new THREE.Matrix4(), out = new THREE.Matrix4(), hand = new THREE.Matrix4(), offHand = new THREE.Matrix4().makeTranslation(0, -0.046, 0);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), pos = new THREE.Vector3(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), scl = new THREE.Vector3();
  const meshes = Object.values(M);
  function pose(i: number, f: Folk) {
    if (f.inside) { for (const m of meshes) m.setMatrixAt(i, ZERO); return; }
    pos.set(f.x, f.y, f.z); q.setFromAxisAngle(up, f.ry); scl.setScalar(f.size);
    base4.compose(pos, q, scl);
    M.torso.setMatrixAt(i, base4); M.head.setMatrixAt(i, base4); M.hair.setMatrixAt(i, base4);
    M.hat.setMatrixAt(i, f.hat ? base4 : ZERO);
    M.apron.setMatrixAt(i, f.apron ? base4 : ZERO);
    const limb = (m: THREE.InstancedMesh, x: number, y: number, rx: number) => { part.makeRotationX(rx).setPosition(x, y, 0); m.setMatrixAt(i, out.multiplyMatrices(base4, part)); return out; };
    limb(M.legL, -0.011, 0.05, f.legs);
    limb(M.legR, 0.011, 0.05, f.sit ? f.legs : -f.legs);
    limb(M.armL, -0.03, 0.098, f.armL);
    hand.multiplyMatrices(limb(M.armR, 0.03, 0.098, f.armR), offHand);
    M.bucket.setMatrixAt(i, f.carry === 1 ? hand : ZERO);
    M.basket.setMatrixAt(i, f.carry === 2 ? hand : ZERO);
    M.cane.setMatrixAt(i, f.cane && !f.sit ? hand : ZERO);
  }

  updates.push((t, dt) => {
    for (const f of folk) {
      f.chat -= dt;
      if (f.role === 'vendor') {   // 상인: 가판대 안쪽에서 손짓
        f.armR = -0.4 + Math.sin(t * 3 + f.step) * 0.25 * (Math.sin(t * 0.5 + f.step) > 0.3 ? 1 : 0);
        continue;
      }
      if (f.wait > 0) {
        f.wait -= dt;
        if (f.sit) { f.legs = -1.4; f.armL = f.armR = -0.3; f.y = heightFast(f.x, f.z) + 0.025; }
        else {
          f.legs *= 0.8; f.armL *= 0.8;
          f.armR = f.talk ? -0.5 + Math.sin(t * 5 + f.step) * 0.3 : f.armR * 0.8;   // 수다: 손짓
        }
        if (f.wait <= 0) {
          f.inside = f.talk = false;
          if (f.sit) { f.sit = false; f.at.busy = false; f.legs = 0; }
        }
        continue;
      }
      if (!f.path.length) {
        const to = f.leader ? (f.leader.at !== f.at ? f.leader.at : null) : choose(f);
        if (!to) { f.wait = 0.3; continue; }
        f.path = route({ x: f.x, z: f.z }, to, f.at.hub);
        f.at = to;
      }
      const goal = f.path[0], dx = goal.x - f.x, dz = goal.z - f.z, d = Math.hypot(dx, dz);
      if (d < 0.01) { f.path.shift(); if (!f.path.length) arrive(f); continue; }
      const s = Math.min(d, f.speed * dt);
      f.x += dx / d * s; f.z += dz / d * s;
      f.step += dt * f.speed * 80;
      f.y = heightFast(f.x, f.z) + Math.abs(Math.sin(f.step)) * 0.005;
      const turn = Math.atan2(dx, dz) - f.ry;
      f.ry += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 10);
      const swing = Math.sin(f.step) * (f.role === 'child' ? 0.8 : f.role === 'elder' ? 0.35 : 0.6);
      f.legs = swing; f.armL = -swing * 0.8; f.armR = f.carry || f.cane ? -0.1 : swing * 0.8;
    }
    // 길에서 마주친 어른 둘은 잠시 멈춰 수다
    for (let i = 0; i < folk.length; i++) for (let j = i + 1; j < folk.length; j++) {
      const a = folk[i], b = folk[j];
      if (a.role === 'child' || b.role === 'child' || a.role === 'vendor' || b.role === 'vendor' || a.chat > 0 || b.chat > 0 || a.wait > 0 || b.wait > 0
        || !a.path.length || !b.path.length || Math.hypot(a.x - b.x, a.z - b.z) > 0.09) continue;
      a.wait = b.wait = 3 + rnd() * 3; a.talk = b.talk = true; a.chat = b.chat = 20;
      a.ry = Math.atan2(b.x - a.x, b.z - a.z); b.ry = a.ry + Math.PI;
    }
    folk.forEach((f, i) => pose(i, f));
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  });

  // ── 동물: 마당의 닭, 문가에서 조는 고양이, 주인을 따라다니는 개 ──
  if (LOD.animals && town.homes.length) {
    const yard = toLocal(town.homes[0], 0.3, 0.35);
    for (let k = 0; k < 3; k++) {
      const o = buildModel('chicken'), ph = k * 2.1, r = 0.06 + k * 0.03;
      o.scale.setScalar(VILLAGE_ANIMAL); g.add(o);
      updates.push(t => {
        const a = t * 0.35 + ph, x = yard.x + Math.cos(a) * r, z = yard.z + Math.sin(a) * r, peck = Math.sin(t * 1.7 + ph) > 0.6;
        o.position.set(x, heightFast(x, z) + (peck ? 0 : Math.abs(Math.sin(t * 6 + ph)) * 0.01), z);
        o.rotation.set(peck ? 0.5 : 0, Math.atan2(-Math.sin(a), Math.cos(a)), 0);
      });
    }
    const cat = buildModel('cat'), ch = town.homes[town.homes.length - 1], cp = toLocal(ch, 0.12, 0.3);
    cat.scale.setScalar(VILLAGE_ANIMAL); cat.position.set(cp.x, heightFast(cp.x, cp.z), cp.z); cat.rotation.y = ch.face + 0.6; g.add(cat);
    const owner = folk.find(f => f.role === 'adult');
    if (owner) {
      const dog = buildModel('dog'), behind = new THREE.Vector3();
      dog.scale.setScalar(VILLAGE_ANIMAL); dog.position.set(owner.x, owner.y, owner.z); g.add(dog);
      updates.push((t, dt) => {   // 주인 뒤 한 걸음을 따라가고, 주인이 집에 들어가면 문 앞에서 기다린다
        behind.set(owner.x - Math.sin(owner.ry) * 0.12, 0, owner.z - Math.cos(owner.ry) * 0.12);
        const dx = behind.x - dog.position.x, dz = behind.z - dog.position.z, d = Math.hypot(dx, dz);
        if (d > 0.02 && !owner.inside) {
          const s = Math.min(d, (owner.speed + 0.1) * dt * (d > 0.3 ? 2 : 1));
          dog.position.x += dx / d * s; dog.position.z += dz / d * s;
          dog.rotation.y = Math.atan2(dx, dz);
        }
        dog.position.y = heightFast(dog.position.x, dog.position.z) + (d > 0.02 && !owner.inside ? Math.abs(Math.sin(t * 12)) * 0.008 : 0);
      });
    }
  }

  lifeGroup.add(g);
  let last = -1;
  return {
    town, folk: n,
    update(t: number) { const dt = last < 0 ? 0 : Math.min(0.1, t - last); last = t; for (const u of updates) u(t, dt); },
    dispose() {
      lifeGroup.remove(g);
      g.traverse(o => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
        else if (o instanceof THREE.Sprite) o.material.dispose();
        else if (o instanceof THREE.Mesh && (o.material === vcFlat || o.material === glowMat) && o.parent === g) o.geometry.dispose();   // 합친 소품
      });
    },
  };
}

// 매 프레임: 가까이 본 마을 하나만 살아 움직인다. 마을이 바뀌거나(섬을 다시 만들면 기록도 새로) 멀어지면 갈아끼운다
let active: ReturnType<typeof build> | null = null;
export function updateLife(t: number) {
  const town = view.dist < SHOW_DIST ? towns.find(tw => {
    const c = centroid(tw.comp);
    return Math.hypot(view.target.x - c.x, view.target.z - c.z) < 3 + Math.sqrt(tw.comp.length) * 2;
  }) : undefined;
  if (town !== active?.town) { active?.dispose(); active = town ? build(town) : null; }
  active?.update(t);
  return active?.folk ?? 0;
}
