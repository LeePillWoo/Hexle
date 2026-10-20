// 구경(확대) 디테일: 카메라가 어느 장소 가까이 내려앉으면 그 묶음 하나에만 사람·동물·소품·움직임·소리를 만들고, 떠나면 지운다.
//  섬을 다시 만들 때는 장소 목록(sites)과 장식이 남긴 자리 메모(notes: 집·불·헛간·나무 자리 등)만 기록하므로
//  평소 화면과 타일 배치 속도는 그대로다. 사람은 부위별 InstancedMesh 라 몇 명이든 드로우콜이 일정하고,
//  소품은 장소 하나당 한 덩어리로 합친다. 기기에 따라 인원·소품을 나눈다 (PC > 태블릿 > 모바일).
//  새 타일을 추가하면 SCENES 에 그 장소의 생활 장면을 같이 만든다.
import * as THREE from 'three';
import { centroid, fromWorld, key, mostConnected, neighbors, toWorld, type Hex } from '../core/hex';
import { rng, seedOf } from '../core/noise';
import { heightFast, roadDist, surfaceAt, volcanoSize } from '../world/terrain';
import { buildModel, makeSchool } from '../items/models';
import type { ItemKind } from '../items/kinds';
import { bubbleTex, glowMat, inHex, merge, paint, puffs, slope, smokeTex, vc, vcFlat } from './models';
import { isSeaKind, type Kind } from './kinds';

// 카메라가 바라보는 곳·거리·물속 여부 (main 이 매 프레임 채운다)
export const view = { target: new THREE.Vector3(), dist: Infinity, under: false };
const SHOW_DIST = 7;   // 이보다 가까이 확대했을 때만

const mq = (q: string) => typeof matchMedia !== 'undefined' && matchMedia(q).matches;
export const TIER = mq('(max-width: 760px)') ? 'mobile' : mq('(pointer: coarse)') ? 'tablet' : 'pc';
// 기기별: 마을 인원 배수·상한, 다른 장소 인원 비율(share), 소품 비율(1 = 전부), 굴뚝 연기 집 수, 창문 불빛·동물
const LOD = {
  pc: { mult: 4, cap: 56, share: 1, props: 1, smoke: 6, glow: true, animals: true },
  tablet: { mult: 2.5, cap: 36, share: 0.65, props: 1, smoke: 4, glow: true, animals: true },
  mobile: { mult: 1.25, cap: 18, share: 0.35, props: 0.5, smoke: 2, glow: false, animals: false },
}[TIER];
const count = (pc: number) => Math.max(1, Math.round(pc * LOD.share));

// ── 장소 기록 (decorateAll 이 채우고 비운다) ──
type P = { x: number; z: number };
export type Home = { x: number; z: number; face: number; s: number; tall: boolean };
export type SpotKind = 'door' | 'stand' | 'well' | 'stall' | 'bench' | 'stroll';
export type Town = { well?: Hex; homes: Home[]; spots: Spot[]; stalls: { x: number; z: number; face: number }[] };
// 장식이 남기는 자리 메모: 묶음 첫 칸 key → 그 장소 생활에 필요한 자리
export type Note = { town?: Town; trees?: P[]; stand?: P; barn?: P; fire?: P; tent?: P; crate?: P; keep?: P; tower?: P };
export const notes = new Map<string, Note>();
export const note = (comp: Hex[], n: Note) => notes.set(key(comp[0]), { ...notes.get(key(comp[0])), ...n });
export type Site = { kind: Kind; comp: Hex[] };
export const sites: Site[] = [];
export const lifeGroup = new THREE.Group();
// 생활 소리: 장면이 넣고 sound.ts 가 꺼내 재생한다
export type LifeSfx = 'chop' | 'clang' | 'strum' | 'splash' | 'click';
export const lifeSfx: { kind: LifeSfx; x: number; y: number; z: number }[] = [];
const sfx = (kind: LifeSfx, x: number, y: number, z: number) => { if (lifeSfx.length < 6) lifeSfx.push({ kind, x, y, z }); };

// ── 모델 ──
const W = 0xffffff;   // 흰색으로 칠하고 인스턴스 색을 곱한다
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c = W) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
const ball = (r: number, x: number, y: number, z: number, c: number) => paint(new THREE.IcosahedronGeometry(r, 0).translate(x, y, z), c);
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, c: number, seg = 8) => paint(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z), c);
export const benchGeo = merge(
  box(0.2, 0.02, 0.12, 0, 0.07, 0, 0x9a7048),
  ...[-0.08, 0.08].map(x => box(0.02, 0.07, 0.1, x, 0.035, 0, 0x7a5432)),
  ...[-0.11, 0.11].map(z => box(0.2, 0.015, 0.04, 0, 0.045, z, 0x9a7048)),
);
export const TALL = 0.14;   // 2층 집이 단층보다 높은 만큼
// 사람 부위: 몸통·머리·머리카락·모자류·앞치마·등짐은 사람 기준 자리에, 팔다리·손에 든 것은 축(어깨·엉덩이·손)이 원점. 앞이 +z
const BODY = {
  torso: box(0.046, 0.052, 0.03, 0, 0.076, 0),
  head: paint(new THREE.IcosahedronGeometry(0.022, 1).translate(0, 0.122, 0), W),
  hair: paint(new THREE.SphereGeometry(0.024, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.126, -0.003), W),
  straw: merge(paint(new THREE.CylinderGeometry(0.036, 0.036, 0.004, 12).translate(0, 0.139, 0), W), paint(new THREE.CylinderGeometry(0.017, 0.02, 0.02, 12).translate(0, 0.15, 0), W)),
  helmet: merge(paint(new THREE.SphereGeometry(0.027, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.125, 0), W), paint(new THREE.CylinderGeometry(0.03, 0.03, 0.004, 12).translate(0, 0.126, 0), W)),
  beanie: merge(paint(new THREE.SphereGeometry(0.026, 10, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 1.15, 1).translate(0, 0.124, 0), W), paint(new THREE.IcosahedronGeometry(0.009, 0).translate(0, 0.157, 0), W)),
  apron: box(0.04, 0.046, 0.004, 0, 0.066, 0.017),
  pack: merge(box(0.038, 0.045, 0.02, 0, 0.08, -0.025, 0xa0522d), box(0.04, 0.012, 0.022, 0, 0.106, -0.025, 0x6b3a1a)),
  tank: merge(cyl(0.011, 0.011, 0.05, -0.012, 0.082, -0.026, 0xf0c020), cyl(0.011, 0.011, 0.05, 0.012, 0.082, -0.026, 0xf0c020)),
  leg: box(0.018, 0.05, 0.02, 0, -0.025, 0),
  arm: box(0.012, 0.046, 0.014, 0, -0.023, 0),
};
const TOOL = {
  bucket: merge(cyl(0.013, 0.011, 0.02, 0, -0.01, 0, 0x8a8f96), cyl(0.011, 0.011, 0.002, 0, -0.002, 0, 0x3f7fb0)),
  basket: merge(cyl(0.016, 0.012, 0.014, 0, -0.008, 0, 0xb08a4a), ball(0.007, -0.006, 0.001, 0, 0xc0392b), ball(0.007, 0.006, 0.001, 0, 0xe0a020)),
  cane: cyl(0.003, 0.003, 0.07, 0, -0.035, 0, 0x6b4a2b, 5),
  axe: merge(cyl(0.003, 0.003, 0.08, 0, -0.035, 0, 0x8a6038, 5), box(0.004, 0.022, 0.02, 0, -0.07, 0.01, 0x9aa0a8)),
  hoe: merge(cyl(0.003, 0.003, 0.13, 0, -0.04, 0, 0x8a6038, 5), box(0.004, 0.012, 0.03, 0, -0.105, 0.014, 0x7a7f88)),
  rod: merge(cyl(0.0025, 0.0015, 0.24, 0, -0.12, 0, 0x6b4a2b, 4), box(0.002, 0.12, 0.002, 0, -0.24, 0.06, 0xe8e2d4).rotateX(0.5)),
  can: merge(box(0.024, 0.02, 0.016, 0, -0.012, 0, 0x4a8a5a), cyl(0.003, 0.004, 0.03, 0, -0.012, 0.02, 0x4a8a5a, 5).rotateX(1.0)),
  spear: merge(cyl(0.0025, 0.0025, 0.2, 0, 0.05, 0, 0x6b4a2b, 5), paint(new THREE.ConeGeometry(0.006, 0.025, 4).translate(0, 0.162, 0), 0xc8ccd2)),
  sword: merge(box(0.004, 0.07, 0.01, 0, -0.045, 0.006, 0xc8ccd2), box(0.004, 0.006, 0.026, 0, -0.008, 0.006, 0xd8b850)),
  log: cyl(0.012, 0.012, 0.09, 0, -0.01, 0.02, 0x8a5a33, 6).rotateZ(Math.PI / 2),
  stick: merge(cyl(0.0015, 0.0015, 0.11, 0, -0.055, 0, 0x8a6038, 4), ball(0.006, 0, -0.11, 0, 0xf6f0e0)),
  camera: box(0.022, 0.014, 0.012, 0, -0.004, 0.012, 0x2a2a2a),
  snowball: ball(0.008, 0, -0.006, 0.004, 0xf4f7fb),
  flag: merge(cyl(0.002, 0.002, 0.2, 0, 0.06, 0, 0x6b4a2b, 4), box(0.002, 0.03, 0.045, 0, 0.145, 0.023, 0xd03a2f)),
  lamp: merge(cyl(0.006, 0.006, 0.02, 0, -0.012, 0.006, 0x3a3a3a, 6), ball(0.006, 0, -0.012, 0.018, 0xffe08a)),
};
export type Tool = keyof typeof TOOL;
const SKIN = [0xf1c9a5, 0xd9a47a, 0xa8714a, 0xf6d7bd, 0xe0b48c];
const SHIRT = [0xc0563f, 0x3f6fa0, 0x6a9a4a, 0xd9a83a, 0x8a4f9e, 0xe8e2d4, 0x2f8a8a, 0xd97a8a];
const PANTS = [0x4a4038, 0x3a4a6a, 0x5a4a3a, 0x2f3a2f, 0x6a5a4a];
const HAIR = [0x3a2a1e, 0x6b4a2b, 0xc89a4a, 0x1e1a18, 0xa0522d];
const HATS = [0xd9b552, 0x6b4a2b, 0x3f6fa0, 0xc0563f];
// 복장: 모자 0 없음·1 밀짚·2 투구/안전모·3 털모자, 등짐 0 없음·1 배낭·2 산소통, bare 면 맨몸(수영복)
type Look = { shirt: number[]; pants: number[]; hat: 0 | 1 | 2 | 3; hatColor?: number[]; hatChance: number; back?: 0 | 1 | 2; apron?: boolean; bare?: number };
const LOOK: Record<string, Look> = {
  folk: { shirt: SHIRT, pants: PANTS, hat: 1, hatChance: 0.35 },
  farmer: { shirt: [0xd9c8a0, 0xc0563f, 0x6a9a4a, 0xe8e2d4], pants: [0x3a5a8a], hat: 1, hatChance: 0.9 },
  guard: { shirt: [0x3f5f9f, 0xc0322a], pants: [0x5a5a60], hat: 2, hatColor: [0xa8aab0], hatChance: 1 },
  winter: { shirt: [0xc0322a, 0x2f6fc0, 0x3a9a50, 0xf0a020, 0x8a4f9e], pants: [0x2f3a4a, 0x4a4038], hat: 3, hatColor: [0xc0322a, 0xf2f2f2, 0x2f6fc0, 0xf0c040], hatChance: 1 },
  beach: { shirt: [0xff6a6a, 0x4ac0e0, 0xf0d040, 0xff9ad0, 0x6ad06a], pants: [0x2f6fc0, 0xc0322a, 0x2f2f2f, 0xf08a3a], hat: 1, hatChance: 0.3, bare: 0.6 },
  hiker: { shirt: [0xd9622b, 0x2f8a8a, 0xc0322a, 0x3a9a50], pants: [0x4a4038, 0x3a4a5a], hat: 3, hatColor: [0x3a3a3a, 0xc0322a, 0x2f6fc0], hatChance: 0.5, back: 1 },
  diver: { shirt: [0x1e2a3a, 0x203a5a], pants: [0x1e2a3a], hat: 0, hatChance: 0, back: 2 },
  science: { shirt: [0xf2f2f2], pants: [0x3a4a6a], hat: 2, hatColor: [0xf08a1a], hatChance: 1, back: 1 },
  nomad: { shirt: [0xe8dcc0, 0xc8a070, 0x8a4a3a], pants: [0xc8a070, 0xe8dcc0], hat: 3, hatColor: [0xf2f2f2, 0xe8dcc0], hatChance: 1 },
  bee: { shirt: [0xf4f0e6], pants: [0xf4f0e6], hat: 1, hatColor: [0xf4f0e6], hatChance: 1 },
  vendor: { shirt: SHIRT, pants: PANTS, hat: 1, hatChance: 0.3, apron: true },
};

// 집 소품 (집 기준 좌표: 문이 +z, 지붕 크기 1 기준)
const flowerBox = merge(...[-0.14, 0.14].flatMap(x => [box(0.1, 0.025, 0.03, x, 0.148, 0.215, 0x8a6038),   // 앞 창 둘 아래
  ...[0xe05a7a, 0xf0c040, 0xd04040].map((c, i) => ball(0.013, x - 0.03 + i * 0.03, 0.168, 0.215, c))]));
const mailbox = merge(box(0.01, 0.09, 0.01, 0.21, 0.045, 0.3, 0x6b4a2b), box(0.03, 0.026, 0.045, 0.21, 0.1, 0.3, 0xb03a2e));
const woodpile = merge(...[[-0.03, 0.012], [0, 0.012], [0.03, 0.012], [-0.015, 0.035], [0.015, 0.035], [0, 0.058]].map(([x, y]) =>
  paint(new THREE.CylinderGeometry(0.013, 0.013, 0.13, 6).rotateX(Math.PI / 2).translate(0.32 + x, y, -0.05), 0x8a5a33)));
const lineGeo = merge(...[-0.16, 0.16].map(z => box(0.008, 0.13, 0.008, -0.34, 0.065, z, 0x7a5432)), box(0.003, 0.003, 0.32, -0.34, 0.125, 0, 0xe8e2d4));
const clothGeo = box(0.003, 0.05, 0.045, 0, -0.025, 0);
const garden = merge(box(0.26, 0.014, 0.16, 0, 0.007, -0.43, 0x6b4a2b),
  ...[0, 1, 2, 3, 4, 5].map(i => ball(0.022, -0.09 + (i % 3) * 0.09, 0.025, -0.47 + Math.floor(i / 3) * 0.08, i % 2 ? 0x6fb04a : 0x8ccc5e)));
const upperGlow = merge(...[-0.14, 0, 0.14].map(x => box(0.07, 0.07, 0.004, x, 0.35, 0.19, 0xffcf70)), box(0.07, 0.07, 0.004, 0, 0.35, -0.19, 0xffcf70));   // 2층 창
const windowsGlow = merge(...[-0.14, 0.14].map(x => box(0.07, 0.07, 0.004, x, 0.21, 0.19, 0xffcf70)),
  ...[-0.1, 0.1].map(x => box(0.07, 0.07, 0.004, x, 0.21, -0.19, 0xffcf70)), box(0.004, 0.07, 0.07, 0.229, 0.21, 0, 0xffcf70));
const lampPost = merge(box(0.012, 0.17, 0.012, 0, 0.085, 0, 0x3a3a3a), paint(new THREE.ConeGeometry(0.026, 0.02, 4).rotateY(Math.PI / 4).translate(0, 0.205, 0), 0x3a3a3a));
const lampGlow = box(0.028, 0.03, 0.028, 0, 0.18, 0, 0xffd27a);
// 장소 소품
const blanketGeo = merge(box(0.16, 0.004, 0.12, 0, 0.002, 0, 0xd8402f), ...[-0.05, 0, 0.05].map(x => box(0.012, 0.005, 0.12, x, 0.003, 0, 0xf4f0e6)));
const picnicBasket = merge(box(0.035, 0.022, 0.025, 0, 0.011, 0, 0xb08a4a), box(0.003, 0.02, 0.003, 0, 0.03, 0, 0x8a6038));
const stumpGeo = merge(cyl(0.035, 0.04, 0.04, 0, 0.02, 0, 0x7a5432, 8), cyl(0.033, 0.033, 0.002, 0, 0.041, 0, 0xd8b88a, 8));
const logPile = merge(...[[-0.03, 0.013], [0, 0.013], [0.03, 0.013], [-0.015, 0.037], [0.015, 0.037]].map(([x, y]) => cyl(0.013, 0.013, 0.1, x, y, 0, 0x8a5a33, 6).rotateX(Math.PI / 2)));
const tripodGeo = merge(...[0, 2.1, 4.2].map(a => cyl(0.002, 0.002, 0.09, 0, 0.045, 0, 0x3a3a3a, 4).rotateZ(0.25).rotateY(a)), box(0.02, 0.014, 0.024, 0, 0.09, 0, 0xe8e8e8));
const signGeo = merge(cyl(0.004, 0.004, 0.1, 0, 0.05, 0, 0x6b4a2b, 4), paint(new THREE.ConeGeometry(0.03, 0.026, 3).rotateX(Math.PI / 2).rotateZ(Math.PI).translate(0, 0.1, 0.004), 0xf0c020));
const umbrellaGeo = [0xd83a3a, 0x2f8ad8, 0xf0b020].map(c => merge(cyl(0.003, 0.003, 0.16, 0, 0.08, 0, 0xe8e2d4, 4), paint(new THREE.ConeGeometry(0.09, 0.035, 8).translate(0, 0.165, 0), c)));
const towelGeo = [0xff7eb3, 0x4ac0e0, 0xf0d040, 0x6ad06a].map(c => box(0.06, 0.003, 0.14, 0, 0.002, 0, c));
const sandcastleGeo = merge(cyl(0.035, 0.04, 0.03, 0, 0.015, 0, 0xe0c890, 8), ...[0, 1, 2, 3].map(i => cyl(0.009, 0.01, 0.035, Math.cos(i * 1.57) * 0.03, 0.03, Math.sin(i * 1.57) * 0.03, 0xd8bc80, 6)),
  cyl(0.015, 0.018, 0.035, 0, 0.045, 0, 0xe0c890, 8), cyl(0.012, 0.012, 0.012, 0.06, 0.006, 0.02, 0xd84a3a, 6));
const snowmanGeo = merge(ball(0.035, 0, 0.03, 0, 0xf4f7fb), ball(0.026, 0, 0.078, 0, 0xf4f7fb), ball(0.018, 0, 0.115, 0, 0xf4f7fb),
  paint(new THREE.ConeGeometry(0.004, 0.02, 4).rotateX(Math.PI / 2).translate(0, 0.115, 0.026), 0xf08a1a), box(0.03, 0.006, 0.006, 0, 0.1, 0.01, 0xc0322a));
const nomadTent = merge(paint(new THREE.ConeGeometry(0.16, 0.13, 4).rotateY(Math.PI / 4).scale(1, 1, 0.7).translate(0, 0.065, 0), 0xe8d8b0), box(0.2, 0.004, 0.12, 0, 0.002, 0.12, 0x8a3a2a));
const hiveGeo = merge(box(0.05, 0.02, 0.05, 0, 0.01, 0, 0x8a6038), box(0.055, 0.03, 0.055, 0, 0.035, 0, 0xf0d070), box(0.055, 0.03, 0.055, 0, 0.065, 0, 0xf0c040), box(0.06, 0.008, 0.06, 0, 0.084, 0, 0x8a6038));
const kiteGeo = paint(new THREE.CircleGeometry(0.05, 4).scale(0.8, 1.2, 1), 0xd83a3a);
const lineMat = new THREE.MeshBasicMaterial({ color: 0xf4f0e6 });
const kiteMat = new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide });
const lineGeoUnit = new THREE.CylinderGeometry(0.0015, 0.0015, 1, 3).translate(0, 0.5, 0);
const snowballGeo = new THREE.IcosahedronGeometry(0.01, 0), snowballMat = new THREE.MeshStandardMaterial({ color: 0xf4f7fb });
const bubbleMat = new THREE.SpriteMaterial({ map: bubbleTex, color: 0xdff6ff, depthWrite: false, transparent: true, opacity: 0.8 });
const VILLAGE_ANIMAL = 0.45;   // 생활 동물은 들판 동물보다 작게
const BENCH = 0.6;             // 길가 벤치: 주민 키에 맞춘 크기 (앉는 판 높이 0.07 × 0.6)
const faceX = (dx: number, dz: number) => Math.atan2(-dz, dx);   // 동물 모델은 +x 가 앞

// ── 사람 ──
export type Act = 'walk' | 'idle' | 'sit' | 'bench' | 'work' | 'pick' | 'kneel' | 'lie' | 'swim' | 'wave' | 'photo' | 'water' | 'fish' | 'throw' | 'strum' | 'spar' | 'roast';
// 갈 곳: 도착하면 act 를 dur 초 동안 한다. tool 이 null 이면 들고 있던 것을 내려놓는다. y 가 있으면 그 높이(물속)
export type Spot = { x: number; z: number; y?: number; hub?: Hex; kind?: SpotKind; face?: number; act?: Act; tool?: Tool | null; dur?: [number, number]; busy?: boolean };
const SEAT: Act[] = ['sit', 'bench', 'lie', 'fish', 'strum', 'roast'];
type Folk = {
  role: 'adult' | 'child' | 'elder' | 'vendor'; x: number; y: number; z: number; ry: number; size: number; speed: number; step: number;
  at: Spot; path: P[]; wait: number; act: Act; inside: boolean; talk: boolean; chat: number; tool: Tool | null;
  hat: 0 | 1 | 2 | 3; back: 0 | 1 | 2; apron: boolean; leader?: Folk; pool: Spot[]; loop?: boolean; legs: number; armL: number; armR: number; phase: number;
};
type FolkInit = { at: Spot; pool?: Spot[]; role?: Folk['role']; look?: Look; tool?: Tool; speed?: number; loop?: boolean; leader?: number };
// 장면이 바꿀 수 있는 걸음 규칙 (마을은 길을 따라 걷고 집에 들어간다)
type Rules = { route?: (f: Folk, to: Spot) => P[]; choose?: (f: Folk) => Spot | undefined; arrive?: (f: Folk) => void; chat?: boolean };

// ── 장면 도구 상자 ──
type Kit = ReturnType<typeof kitFor>;
function kitFor(site: Site, g: THREE.Group) {
  const rnd = rng(seedOf(site.comp[0]) + 131), comp = site.comp, inComp = new Set(comp.map(key));
  const solid: THREE.BufferGeometry[] = [], glow: THREE.BufferGeometry[] = [], updates: ((t: number, dt: number) => void)[] = [];
  const folk: FolkInit[] = [], rules: Rules = {};
  const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
  const matAt = (x: number, z: number, rotY = 0, s = 1, y = heightFast(x, z)) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(s, s, s));
  const k = {
    site, g, rnd, comp, inComp, solid, glow, updates, folk, rules, pick,
    dog: false, crowd: undefined as Folk[] | undefined, after: [] as ((folk: Folk[]) => void)[],
    c: centroid(comp), center: toWorld(mostConnected(comp)), note: notes.get(key(comp[0])) ?? {},
    in: (x: number, z: number) => inComp.has(key(fromWorld(x, z))),
    // 소품 하나를 합칠 목록에 (glow 면 빛나는 재질로)
    put(geo: THREE.BufferGeometry, x: number, z: number, rotY = 0, s = 1, list = solid, y?: number) { list.push(geo.clone().applyMatrix4(matAt(x, z, rotY, s, y))); },
    // 묶음 안 임의 지점: ok 를 만족하는 곳을 40번까지 찾는다. 처음 20번은 카메라가 내려앉는 곳(center) 둘레에서 (보이는 곳에 사람이 있게)
    point(ok: (x: number, z: number, h: number) => boolean = (_x, _z, h) => h > 0.35, margin = 0.15): P | null {
      for (let t = 0; t < 40; t++) {
        let x: number, z: number;
        if (t < 20) { const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 1.3; x = k.center.x + Math.cos(a) * r; z = k.center.z + Math.sin(a) * r; }
        else { const c = toWorld(pick(comp)), p = inHex(rnd, margin); x = c.x + p.x; z = c.z + p.z; }
        const h = heightFast(x, z);
        if (k.in(x, z) && slope(x, z) < 0.8 && ok(x, z, h)) return { x, z };
      }
      return null;
    },
    spots(n: number, act: Act, dur: [number, number], ok?: (x: number, z: number, h: number) => boolean, extra: Partial<Spot> = {}): Spot[] {
      const out: Spot[] = [];
      for (let i = 0; i < n; i++) { const p = k.point(ok); if (p) out.push({ ...p, act, dur, ...extra }); }
      return out;
    },
    person(init: FolkInit) { folk.push(init); return folk.length - 1; },
    animal(kind: ItemKind, s = VILLAGE_ANIMAL) { const o = buildModel(kind); o.scale.setScalar(s); g.add(o); return o; },
    // 동물이 (x, z) 둘레를 천천히 돌며 이따금 멈춘다
    wander(o: THREE.Object3D, x: number, z: number, r: number, speed: number, opts: { hop?: number; y?: (x: number, z: number) => number; peck?: boolean; side?: boolean } = {}) {
      const ph = rnd() * 6;
      updates.push(t => {
        const pace = t * speed + Math.sin(t * 0.3 + ph) * 1.2 + ph, a = pace / Math.max(r, 0.05);
        const px = x + Math.cos(a) * r + Math.sin(a * 2.3) * r * 0.25, pz = z + Math.sin(a) * r;
        const y = opts.y ? opts.y(px, pz) : heightFast(px, pz);
        o.position.set(px, y + (opts.hop ? Math.abs(Math.sin(t * 7 + ph)) * opts.hop : 0), pz);
        o.rotation.y = faceX(-Math.sin(a), Math.cos(a)) + (opts.side ? Math.PI / 2 : 0);
        o.rotation.z = opts.peck && Math.sin(t * 1.7 + ph) > 0.6 ? -0.5 : 0;
      });
    },
  };
  return k;
}

// 사람 무리: 부위별 InstancedMesh. 걸음·행동·자세를 매 프레임 갱신
function crowd(k: Kit) {
  const n = k.folk.length;
  if (!n) return;
  const { rnd, pick, rules, g } = k;
  const folk: Folk[] = k.folk.map(fi => {
    const look = fi.look ?? LOOK.folk, role = fi.role ?? 'adult', s0 = fi.at;
    return {
      role, x: s0.x, y: s0.y ?? heightFast(s0.x, s0.z), z: s0.z, ry: s0.face ?? rnd() * 6, size: role === 'child' ? 0.75 : 1.1,
      speed: fi.speed ?? (role === 'child' ? 0.32 : role === 'elder' ? 0.12 : 0.18 + rnd() * 0.05), step: rnd() * 6,
      at: s0, path: [], wait: rnd() * 2, act: s0.act ?? 'idle', inside: false, talk: false, chat: rnd() * 10, tool: fi.tool ?? s0.tool ?? (role === 'elder' ? 'cane' : null),
      hat: rnd() < look.hatChance && role !== 'child' ? look.hat : (look.hat === 3 ? 3 : 0), back: look.back ?? 0, apron: !!look.apron || (role === 'adult' && rnd() < 0.1),
      pool: fi.pool ?? [s0], loop: fi.loop, legs: 0, armL: 0, armR: 0, phase: rnd() * 6,
    };
  });
  k.folk.forEach((fi, i) => { if (fi.leader !== undefined) folk[i].leader = folk[fi.leader]; });
  for (const f of folk) if (SEAT.includes(f.act)) f.at.busy = true;

  const mk = (geo: THREE.BufferGeometry, used: boolean, shadow = false) => {
    const m = new THREE.InstancedMesh(geo, vc, n);
    m.frustumCulled = false;
    m.castShadow = shadow;
    m.visible = used;   // 아무도 안 쓰는 부위는 그리지 않는다
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    g.add(m);
    return m;
  };
  const any = (fn: (f: Folk) => boolean) => folk.some(fn);
  const M = {
    torso: mk(BODY.torso, true, true), head: mk(BODY.head, true, true), hair: mk(BODY.hair, true),
    straw: mk(BODY.straw, any(f => f.hat === 1)), helmet: mk(BODY.helmet, any(f => f.hat === 2)), beanie: mk(BODY.beanie, any(f => f.hat === 3)),
    apron: mk(BODY.apron, any(f => f.apron)), pack: mk(BODY.pack, any(f => f.back === 1)), tank: mk(BODY.tank, any(f => f.back === 2)),
    legL: mk(BODY.leg, true), legR: mk(BODY.leg, true), armL: mk(BODY.arm, true), armR: mk(BODY.arm, true),
  };
  const toolNames = Object.keys(TOOL) as Tool[];
  const usesTool = (t: Tool) => any(f => f.tool === t || f.pool.some(s => s.tool === t)) || (t === 'bucket' || t === 'basket') && !!k.note.town;
  const T = {} as Record<Tool, THREE.InstancedMesh>;
  for (const t of toolNames) T[t] = mk(TOOL[t], usesTool(t));
  k.folk.forEach((fi, i) => {
    const look = fi.look ?? LOOK.folk, f = folk[i], skin = new THREE.Color(pick(SKIN));
    const bare = look.bare && rnd() < look.bare, shirt = bare ? skin : new THREE.Color(pick(look.shirt)), pants = new THREE.Color(pick(look.pants));
    M.torso.setColorAt(i, shirt); M.armL.setColorAt(i, shirt); M.armR.setColorAt(i, shirt);
    M.legL.setColorAt(i, pants); M.legR.setColorAt(i, pants);
    M.head.setColorAt(i, skin);
    M.hair.setColorAt(i, new THREE.Color(f.role === 'elder' ? 0xc8c8c4 : pick(HAIR)));
    const hatC = new THREE.Color(pick(look.hatColor ?? HATS));
    M.straw.setColorAt(i, hatC); M.helmet.setColorAt(i, hatC); M.beanie.setColorAt(i, hatC);
    M.apron.setColorAt(i, new THREE.Color(f.role === 'vendor' ? 0xf2ead8 : 0xe8d6b0));
  });

  const choose = rules.choose ?? ((f: Folk) => {
    if (f.loop) return f.pool[(f.pool.indexOf(f.at) + 1) % f.pool.length];
    const opts = f.pool.filter(s => s !== f.at && !s.busy);
    return opts.length ? pick(opts) : undefined;
  });
  const route = rules.route ?? ((_f: Folk, to: Spot) => [to]);
  const arrive = rules.arrive ?? ((f: Folk) => {
    const s = f.at;
    f.act = s.act && !(SEAT.includes(s.act) && s.busy) ? s.act : 'idle';
    if (SEAT.includes(f.act)) s.busy = true;
    if (s.tool !== undefined) f.tool = s.tool;
    if (s.face !== undefined) f.ry = s.face;
    const [a, b] = s.dur ?? [1.5, 4];
    f.wait = a + rnd() * (b - a);
  });

  const base = new THREE.Matrix4(), part = new THREE.Matrix4(), out = new THREE.Matrix4(), hand = new THREE.Matrix4(), offHand = new THREE.Matrix4().makeTranslation(0, -0.046, 0);
  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0), pos = new THREE.Vector3(), q = new THREE.Quaternion(), qp = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), ax = new THREE.Vector3(1, 0, 0), scl = new THREE.Vector3();
  const meshes = [...Object.values(M), ...Object.values(T)];
  function pose(i: number, f: Folk) {
    if (f.inside) { for (const m of meshes) m.setMatrixAt(i, ZERO); return; }
    const pitch = f.act === 'lie' ? -Math.PI / 2 : f.act === 'swim' ? Math.PI / 2 : 0;
    pos.set(f.x, f.y, f.z); q.setFromAxisAngle(up, f.ry).multiply(qp.setFromAxisAngle(ax, pitch)); scl.setScalar(f.size);
    base.compose(pos, q, scl);
    for (const m of [M.torso, M.head, M.hair]) m.setMatrixAt(i, base);
    M.straw.setMatrixAt(i, f.hat === 1 ? base : ZERO); M.helmet.setMatrixAt(i, f.hat === 2 ? base : ZERO); M.beanie.setMatrixAt(i, f.hat === 3 ? base : ZERO);
    M.apron.setMatrixAt(i, f.apron ? base : ZERO); M.pack.setMatrixAt(i, f.back === 1 ? base : ZERO); M.tank.setMatrixAt(i, f.back === 2 ? base : ZERO);
    const limb = (m: THREE.InstancedMesh, x: number, y: number, rx: number) => { part.makeRotationX(rx).setPosition(x, y, 0); m.setMatrixAt(i, out.multiplyMatrices(base, part)); return out; };
    const seated = f.act === 'sit' || f.act === 'bench' || f.act === 'fish' || f.act === 'strum' || f.act === 'roast';
    limb(M.legL, -0.011, 0.05, f.legs);
    limb(M.legR, 0.011, 0.05, seated || f.act === 'kneel' ? f.legs : -f.legs);
    limb(M.armL, -0.03, 0.098, f.armL);
    hand.multiplyMatrices(limb(M.armR, 0.03, 0.098, f.armR), offHand);
    for (const t of toolNames) T[t].setMatrixAt(i, f.tool === t && !(t === 'cane' && seated) ? hand : ZERO);
  }
  // 행동별 자세 (머무는 동안). y 는 발 기준 높이 보정
  function act(f: Folk, t: number, ground: number) {
    const s = Math.sin(t * 4 + f.phase);
    f.y = ground;
    switch (f.act) {
      case 'sit': case 'roast': case 'strum': case 'fish':
        f.legs = -1.5; f.y = ground - 0.05 * f.size + 0.012;
        f.armL = -0.4;
        f.armR = f.act === 'roast' ? -1.1 + s * 0.05 : f.act === 'strum' ? -0.6 + Math.sin(t * 12 + f.phase) * 0.15 : f.act === 'fish' ? -1.2 + Math.sin(t * 0.8 + f.phase) * 0.08 : f.talk ? -0.5 + s * 0.3 : -0.4;
        if (f.act === 'strum') f.armL = -0.9;
        break;
      case 'bench': f.legs = -1.4; f.armL = f.armR = -0.3; f.y = ground + 0.07 * BENCH - 0.05 * f.size; break;
      case 'work': f.legs = 0.15; f.armR = -1.5 + s * 1.0; f.armL = f.armR * 0.7; break;
      case 'pick': f.legs = 0; f.armR = -2.6 + s * 0.3; f.armL = -2.4 - s * 0.3; break;
      case 'kneel': f.legs = -1.2; f.y = ground - 0.02 * f.size; f.armR = -0.9 + s * 0.3; f.armL = -0.9 - s * 0.3; break;
      case 'lie': f.legs = 0; f.armL = f.armR = 0; f.y = ground + 0.012; break;
      case 'swim': f.legs = Math.sin(t * 10 + f.phase) * 0.4; f.armL = f.armR = -2.9; f.y = f.at.y ?? ground; break;
      case 'wave': f.legs = 0; f.armL = 0; f.armR = -2.7 + Math.sin(t * 8 + f.phase) * 0.3; break;
      case 'photo': f.legs = 0; f.armR = f.armL = -1.6; break;
      case 'water': f.legs = 0; f.armR = -0.9 + s * 0.05; f.armL = -0.1; break;
      case 'spar': f.legs = 0.2; f.armR = -2.0 + Math.sin(t * 5 + f.phase) * 1.0; f.armL = -0.5; break;
      case 'throw': { const k2 = (t * 0.4 + f.phase) % 1; f.legs = 0.2; f.armR = k2 < 0.7 ? -2.8 * (k2 / 0.7) : -2.8 + (k2 - 0.7) / 0.3 * 2.6; f.armL = -0.4; break; }
      default:
        f.legs *= 0.8; f.armL *= 0.8;
        f.armR = f.talk ? -0.5 + s * 0.3 : f.armR * 0.8;   // 수다: 손짓
    }
  }
  let lastBeat = 0;
  k.updates.push((t, dt) => {
    const beat = Math.floor(t * 4 / Math.PI) !== Math.floor(lastBeat * 4 / Math.PI);   // 일하는 손이 내려칠 때마다
    lastBeat = t;
    for (const f of folk) {
      f.chat -= dt;
      const ground = heightFast(f.x, f.z);
      if (f.role === 'vendor') { f.y = ground; f.armR = -0.4 + Math.sin(t * 3 + f.step) * 0.25 * (Math.sin(t * 0.5 + f.step) > 0.3 ? 1 : 0); continue; }
      if (f.wait > 0) {
        f.wait -= dt;
        act(f, t, ground);
        if (beat && Math.sin(t * 4 + f.phase) < -0.7) {
          if (f.act === 'work' && f.tool === 'axe') sfx('chop', f.x, f.y, f.z);
          if (f.act === 'spar') sfx('clang', f.x, f.y, f.z);
        }
        if (f.act === 'strum' && Math.random() < dt * 0.4) sfx('strum', f.x, f.y, f.z);
        if (f.act === 'photo' && Math.random() < dt * 0.2) sfx('click', f.x, f.y, f.z);
        if (f.act === 'swim' && Math.random() < dt * 0.1) sfx('splash', f.x, f.y, f.z);
        if (f.wait <= 0) {
          if (SEAT.includes(f.act)) f.at.busy = false;
          f.inside = f.talk = false; f.act = 'idle'; f.legs = 0;
        }
        continue;
      }
      if (!f.path.length) {
        const to = f.leader ? (f.leader.at !== f.at ? f.leader.at : undefined) : choose(f);
        if (!to) { f.wait = 0.5 + rnd(); continue; }   // 갈 곳이 없으면 그 자리에서 다시
        f.path = route(f, to);
        f.at = to;
      }
      const goal = f.path[0], dx = goal.x - f.x, dz = goal.z - f.z, d = Math.hypot(dx, dz);
      if (d < 0.01) { f.path.shift(); if (!f.path.length) arrive(f); continue; }
      const st = Math.min(d, f.speed * dt);
      f.x += dx / d * st; f.z += dz / d * st;
      f.step += dt * f.speed * 80;
      f.act = f.at.act === 'swim' ? 'swim' : 'walk';
      f.y = f.act === 'swim' ? f.at.y ?? ground : heightFast(f.x, f.z) + Math.abs(Math.sin(f.step)) * 0.005;
      const turn = Math.atan2(dx, dz) - f.ry;
      f.ry += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 10);
      if (f.act === 'swim') { f.legs = Math.sin(t * 10 + f.phase) * 0.4; f.armL = f.armR = -2.9; continue; }
      const swing = Math.sin(f.step) * (f.role === 'child' ? 0.8 : f.role === 'elder' ? 0.35 : 0.6);
      f.legs = swing; f.armL = -swing * 0.8; f.armR = f.tool ? -0.1 : swing * 0.8;
    }
    if (rules.chat) for (let i = 0; i < folk.length; i++) for (let j = i + 1; j < folk.length; j++) {   // 길에서 마주친 어른 둘은 잠시 멈춰 수다
      const a = folk[i], b = folk[j];
      if (a.role === 'child' || b.role === 'child' || a.role === 'vendor' || b.role === 'vendor' || a.chat > 0 || b.chat > 0 || a.wait > 0 || b.wait > 0
        || !a.path.length || !b.path.length || Math.hypot(a.x - b.x, a.z - b.z) > 0.09) continue;
      a.wait = b.wait = 3 + rnd() * 3; a.talk = b.talk = true; a.chat = b.chat = 20; a.act = b.act = 'idle';
      a.ry = Math.atan2(b.x - a.x, b.z - a.z); b.ry = a.ry + Math.PI;
    }
    folk.forEach((f, i) => pose(i, f));
    for (const m of meshes) m.instanceMatrix.needsUpdate = true;
  });
  return folk;
}

// 위로 올라가는 거품 줄기 (잠수부·난파선): from() 이 매 프레임 출발점을 준다
function bubbles(k: Kit, from: () => THREE.Vector3 | null, n = 4) {
  const sps = Array.from({ length: n }, (_, i) => { const s = new THREE.Sprite(bubbleMat); s.userData.ph = i / n; k.g.add(s); return s; });
  k.updates.push(t => {
    const p = from();
    for (const s of sps) {
      if (!p) { s.visible = false; continue; }
      const u = (t * 0.6 + s.userData.ph) % 1;
      s.visible = true;
      s.position.set(p.x + Math.sin(u * 9 + s.userData.ph * 7) * 0.02, p.y + u * 0.5, p.z);
      s.scale.setScalar(0.015 + u * 0.02);
    }
  });
}

// ════════ 장소별 생활 장면 ════════
type Scene = (k: Kit) => void;

// 마을: 집 문·우물가·가판대·길가를 오가는 주민, 상인, 집 소품·가로등·벤치·빨래·굴뚝 연기, 닭·고양이·개
function villageScene(k: Kit) {
  const town = k.note.town;
  if (!town) return;
  const { rnd, comp, inComp, g } = k;
  const wellKey = town.well && key(town.well), wellPos = town.well && toWorld(town.well);
  const spots = town.spots.map(s => ({ ...s }));
  const free = (x: number, z: number, r: number) => town.homes.every(h => Math.hypot(h.x - x, h.z - z) > r)
    && (!wellPos || Math.hypot(wellPos.x - x, wellPos.z - z) > 0.3) && k.in(x, z);
  const homeMat = (h: Home) => new THREE.Matrix4().compose(new THREE.Vector3(h.x, heightFast(h.x, h.z) - 0.01, h.z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), h.face), new THREE.Vector3(h.s, h.s, h.s));
  const toLocal = (h: Home, lx: number, lz: number) => ({ x: h.x + (Math.cos(h.face) * lx + Math.sin(h.face) * lz) * h.s, z: h.z + (-Math.sin(h.face) * lx + Math.cos(h.face) * lz) * h.s });
  const at = (geo: THREE.BufferGeometry, m: THREE.Matrix4, list = k.solid) => list.push(geo.clone().applyMatrix4(m));

  // 길가: 산책 자리·벤치·가로등
  let road = 0;
  for (const a of comp) for (const b of neighbors(a)) {
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
        k.put(benchGeo, p.x, p.z, -Math.atan2(pb.z - pa.z, pb.x - pa.x), BENCH);
        spots.push({ ...p, hub: a, kind: 'bench', face: Math.atan2(-px * side, -pz * side) });
      }
    }
    const l = on(0.6, -0.17 * side);   // 가로등: 맞은편
    if (free(l.x, l.z, 0.24)) { k.put(lampPost, l.x, l.z); k.put(lampGlow, l.x, l.z, 0, 1, k.glow); }
    road++;
  }

  // 집 소품: 창가 화분·우체통·장작더미·빨래줄·텃밭·창문 불빛·굴뚝 연기
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
      for (let j = 0; j < 4; j++) { cloths.push(m.clone().multiply(new THREE.Matrix4().makeTranslation(-0.34, 0.125, -0.11 + j * 0.073))); clothCols.push(new THREE.Color(k.pick(SHIRT))); }
    }
    const gp = toLocal(h, 0, -0.43);
    if (i % 4 === 2 && free(gp.x, gp.z, 0.2) && roadDist(gp.x, gp.z) > 0.25) at(garden, m);
    if (LOD.glow && i % 5 < 2) { at(windowsGlow, m, k.glow); if (h.tall) at(upperGlow, m, k.glow); }
    if (smoke < LOD.smoke && i % 2 === 0) {
      const c = toLocal(h, 0.13, -0.07);
      k.updates.push(puffs(g, { x: c.x, y: heightFast(h.x, h.z) + (0.72 + (h.tall ? TALL : 0)) * h.s, z: c.z, n: 5, color: 0xdedad2, size: [0.05, 0.17], rise: 0.8, drift: 0.12, speed: 0.1, tex: smokeTex, opacity: 0.4, spread: 0.02 }));
      smoke++;
    }
  });
  if (cloths.length) {   // 빨래: 바람에 흔들린다
    const cm = new THREE.InstancedMesh(clothGeo, vc, cloths.length), sw = new THREE.Matrix4(), out = new THREE.Matrix4();
    clothCols.forEach((c, i) => cm.setColorAt(i, c));
    g.add(cm);
    k.updates.push(t => { cloths.forEach((m, i) => cm.setMatrixAt(i, out.multiplyMatrices(m, sw.makeRotationZ(Math.sin(t * 2.2 + i * 1.3) * 0.3 + 0.1)))); cm.instanceMatrix.needsUpdate = true; });
  }

  // 주민: 어른·아이(둘씩 술래잡기)·노인(지팡이, 벤치)·상인(가판대 안쪽)
  const n = Math.min(LOD.cap, Math.round((comp.length === 1 ? 2 : Math.min(3 + comp.length * 2, 14)) * LOD.mult));
  const nVendor = Math.min(town.stalls.length, Math.floor(n / 6));
  const walkable = spots.filter(s => s.kind !== 'bench');
  let leader = -1;
  for (let i = 0; i < n; i++) {
    const role = i < nVendor ? 'vendor' : i % 4 === 1 ? 'child' : i % 7 === 3 ? 'elder' : 'adult';
    const st = role === 'vendor' ? town.stalls[i] : undefined;
    const at0: Spot = st ? { x: st.x, z: st.z, face: st.face } : k.pick(walkable);
    const idx = k.person({ at: at0, pool: spots, role, look: role === 'vendor' ? LOOK.vendor : LOOK.folk });
    if (role === 'child') { if (leader >= 0) { k.folk[idx].leader = leader; leader = -1; } else leader = idx; }   // 뒤 아이는 앞 아이를 따라간다
  }
  const ALLOWED: Record<string, SpotKind[]> = {
    adult: ['door', 'stand', 'well', 'stall', 'bench', 'stroll'],
    elder: ['door', 'bench', 'bench', 'bench', 'stroll', 'well'],   // 벤치를 자주 고른다
    child: ['stroll', 'stroll', 'well', 'stand', 'stall'],
  };
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
  k.rules.chat = true;
  k.rules.route = (f, to) => {
    if (comp.length === 1 || !f.at.hub || !to.hub) return [to];   // 집 한 채뿐인 마을: 앞마당에서 바로
    const hs = hubs(f.at.hub, to.hub), pts: P[] = [];
    hs.forEach((h, i) => {
      const w = toWorld(h);
      if (key(h) !== wellKey) { pts.push(w); return; }
      const p = pts.at(-1) ?? f, nx = i + 1 < hs.length ? toWorld(hs[i + 1]) : to;
      const a0 = Math.atan2(p.z - w.z, p.x - w.x), a1 = Math.atan2(nx.z - w.z, nx.x - w.x);
      const d = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)), steps = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 4)));
      for (let j = 0; j <= steps; j++) { const a = a0 + d * j / steps; pts.push({ x: w.x + Math.cos(a) * 0.3, z: w.z + Math.sin(a) * 0.3 }); }
    });
    pts.push(to);
    return pts;
  };
  k.rules.choose = f => {
    const kinds = ALLOWED[f.role], kind = k.pick(kinds);
    const opts = spots.filter(s => s !== f.at && !s.busy && s.kind === kind);
    return opts.length ? k.pick(opts) : k.pick(spots.filter(s => s !== f.at && !s.busy && kinds.includes(s.kind!)));
  };
  k.rules.arrive = f => {
    const s = f.at, kid = f.role === 'child';
    if (s.kind === 'door' && !kid && rnd() < 0.6) { f.inside = true; if (f.tool !== 'cane') f.tool = null; f.wait = 4 + rnd() * 6; return; }
    if (s.kind === 'bench' && !s.busy) { s.busy = true; f.act = 'bench'; f.ry = s.face!; f.wait = 6 + rnd() * 8; return; }
    if (s.kind === 'well' && !kid && f.tool !== 'cane' && rnd() < 0.7) f.tool = 'bucket';     // 물 긷기
    if (s.kind === 'stall' && !kid && f.tool !== 'cane' && rnd() < 0.6) f.tool = 'basket';    // 장보기
    if (s.face !== undefined) f.ry = s.face;
    f.act = 'idle';
    f.wait = kid ? 0.3 + rnd() : 1.5 + rnd() * 3;
  };

  // 동물: 마당의 닭, 문가에서 조는 고양이, 주인을 따라다니는 개
  if (LOD.animals && town.homes.length) {
    const yard = toLocal(town.homes[0], 0.3, 0.35);
    for (let j = 0; j < 3; j++) k.wander(k.animal('chicken'), yard.x, yard.z, 0.06 + j * 0.03, 0.04, { hop: 0.01, peck: true });
    const ch = town.homes[town.homes.length - 1], cp = toLocal(ch, 0.12, 0.3), cat = k.animal('cat');
    cat.position.set(cp.x, heightFast(cp.x, cp.z), cp.z); cat.rotation.y = ch.face + 0.6;
    k.dog = true;
  }
}
// 개: 첫 어른을 한 걸음 뒤에서 따라다니고, 주인이 집에 들어가면 문 앞에서 기다린다
function followDog(k: Kit, owner: Folk) {
  const dog = k.animal('dog'), behind = new THREE.Vector3();
  dog.position.set(owner.x, owner.y, owner.z);
  k.updates.push((t, dt) => {
    behind.set(owner.x - Math.sin(owner.ry) * 0.12, 0, owner.z - Math.cos(owner.ry) * 0.12);
    const dx = behind.x - dog.position.x, dz = behind.z - dog.position.z, d = Math.hypot(dx, dz), go = d > 0.02 && !owner.inside;
    if (go) {
      const s = Math.min(d, (owner.speed + 0.1) * dt * (d > 0.3 ? 2 : 1));
      dog.position.x += dx / d * s; dog.position.z += dz / d * s;
      dog.rotation.y = faceX(dx, dz);
    }
    dog.position.y = heightFast(dog.position.x, dog.position.z) + (go ? Math.abs(Math.sin(t * 12)) * 0.008 : 0);
  });
}

// 캠프: 모닥불 둘레 통나무에 앉아 기타 치고 마시멜로 굽는 사람들, 장작을 나르는 사람, 불가에 엎드린 개
function campScene(k: Kit) {
  const c = toWorld(k.comp[0]), fire = k.note.fire ?? { x: c.x + 0.3, z: c.z + 0.25 }, tent = k.note.tent ?? { x: c.x - 0.25, z: c.z - 0.05 }, crate = k.note.crate ?? { x: c.x - 0.6, z: c.z + 0.1 };
  const seat = (a: number, act: Act, tool?: Tool): Spot => ({ x: fire.x + Math.cos(a) * 0.24, z: fire.z + Math.sin(a) * 0.24, face: Math.atan2(-Math.cos(a), -Math.sin(a)), act, tool, dur: [20, 40] });
  const seats = [seat(0.6, 'strum'), seat(2.4, 'roast', 'stick'), seat(4.1, 'sit')];
  seats.slice(0, count(3)).forEach(s => k.person({ at: s, pool: [s] }));
  if (LOD.share >= 0.6) {
    const toCrate: Spot = { x: crate.x + 0.12, z: crate.z, act: 'idle', tool: 'log', dur: [1, 2] }, toTent: Spot = { x: tent.x + 0.05, z: tent.z + 0.25, act: 'idle', tool: null, dur: [2, 4] };
    const toFire: Spot = { x: fire.x - 0.2, z: fire.z - 0.18, act: 'kneel', tool: null, dur: [1.5, 2.5] };
    k.person({ at: toTent, pool: [toCrate, toFire, toTent], loop: true });
    const pile = { x: crate.x + 0.05, z: crate.z - 0.18 };
    k.put(logPile, pile.x, pile.z, 0.4);
  }
  if (LOD.animals) { const dog = k.animal('dog'); dog.position.set(fire.x + 0.05, heightFast(fire.x + 0.05, fire.z - 0.3), fire.z - 0.3); dog.rotation.set(0, faceX(0, 1), 0); dog.scale.y *= 0.6; }
}

// 초원: 양 떼와 지팡이 든 목동, 연 날리는 아이, 담요 위 소풍, 산책하는 사람들
function grassScene(k: Kit) {
  const flock = k.point() ?? k.center;
  if (LOD.animals) for (let i = 0; i < 2 + count(3); i++) k.wander(k.animal('sheep'), flock.x + (k.rnd() - 0.5) * 0.3, flock.z + (k.rnd() - 0.5) * 0.3, 0.08 + k.rnd() * 0.1, 0.02, { peck: true });
  const ring = [0, 1, 2, 3].map(i => ({ x: flock.x + Math.cos(i * 1.57) * 0.4, z: flock.z + Math.sin(i * 1.57) * 0.4, act: 'idle' as Act, dur: [2, 4] as [number, number] })).filter(s => k.in(s.x, s.z));
  if (ring.length) k.person({ at: ring[0], pool: ring, role: 'elder', look: LOOK.farmer, loop: true });
  // 연: 아이 손에서 줄이 이어지고 바람에 흔들린다
  const kidAt = k.point();
  if (kidAt) {
    k.person({ at: { ...kidAt, act: 'wave', dur: [60, 90] }, role: 'child' });
    const kite = new THREE.Mesh(kiteGeo, kiteMat), line = new THREE.Mesh(lineGeoUnit, lineMat), a = new THREE.Vector3(), b = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3();
    k.g.add(kite, line);
    k.updates.push(t => {
      a.set(kidAt.x, heightFast(kidAt.x, kidAt.z) + 0.14, kidAt.z);
      b.set(kidAt.x + 0.5 + Math.sin(t * 0.7) * 0.12, a.y + 0.75 + Math.sin(t * 1.3) * 0.08, kidAt.z - 0.3 + Math.cos(t * 0.5) * 0.1);
      kite.position.copy(b); kite.rotation.set(0, -0.5, Math.sin(t * 2) * 0.3);
      line.position.copy(a); line.scale.set(1, a.distanceTo(b), 1); line.quaternion.setFromUnitVectors(up, dir.subVectors(b, a).normalize());
    });
  }
  const pic = k.point();
  if (pic) {
    k.put(blanketGeo, pic.x, pic.z, 0.3); k.put(picnicBasket, pic.x + 0.04, pic.z - 0.03);
    [0.07, -0.07].forEach((o, i) => k.person({ at: { x: pic.x + Math.cos(0.3) * o, z: pic.z - Math.sin(0.3) * o, act: 'sit', face: 0.3 + (i ? 0 : Math.PI) - Math.PI / 2, dur: [30, 60] } }));
  }
  const walks = k.spots(5, 'idle', [1, 3]);
  for (let i = 0; i < count(2) && walks.length; i++) k.person({ at: walks[i % walks.length], pool: walks });
}

// 숲: 도끼질하는 나무꾼과 장작더미, 배낭 멘 등산객, 버섯 따는 사람, 여우·토끼
function forestScene(k: Kit) {
  const cut = k.point();
  if (cut) {
    k.put(stumpGeo, cut.x, cut.z); k.put(logPile, cut.x + 0.12, cut.z + 0.06, 0.8);
    k.person({ at: { x: cut.x, z: cut.z + 0.08, act: 'work', tool: 'axe', face: Math.PI, dur: [40, 80] }, look: LOOK.farmer });
  }
  const trail = k.spots(6, 'idle', [1, 2.5]);
  for (let i = 0; i < count(3) && trail.length; i++) k.person({ at: trail[i % trail.length], pool: trail, look: LOOK.hiker });
  const shrooms = k.spots(4, 'kneel', [3, 6], undefined, { tool: 'basket' });
  if (shrooms.length) k.person({ at: shrooms[0], pool: shrooms, tool: 'basket' });
  if (LOD.animals) {
    const f = k.point(); if (f) k.wander(k.animal('fox'), f.x, f.z, 0.3, 0.06);
    for (let i = 0; i < 2; i++) { const r = k.point(); if (r) k.wander(k.animal('rabbit'), r.x, r.z, 0.12, 0.05, { hop: 0.02 }); }
  }
}

// 산: 배낭·스틱 든 등산객이 기슭과 정상 사이를 오르내리고, 정상엔 깃발 흔드는 사람, 비탈엔 산양, 하늘엔 독수리
function mountainScene(k: Kit) {
  let peak = k.center, ph = -Infinity;
  for (let i = 0; i < 40; i++) { const p = k.point(() => true, 0.1); if (p && heightFast(p.x, p.z) > ph) { ph = heightFast(p.x, p.z); peak = p; } }
  const summit: Spot = { x: peak.x, z: peak.z, act: 'wave', tool: 'flag', dur: [30, 60] };
  k.person({ at: summit, look: LOOK.hiker });
  const low = k.spots(4, 'idle', [1.5, 3], (_x, _z, h) => h < ph - 0.6 && h > 0.4), high = k.spots(3, 'photo', [3, 5], (_x, _z, h) => h > ph - 0.5, { tool: 'camera' });
  const path = [...low, ...high];
  for (let i = 0; i < count(3) && path.length; i++) k.person({ at: path[i % path.length], pool: path, look: LOOK.hiker, tool: 'cane', speed: 0.12 });
  if (LOD.animals) {
    for (let i = 0; i < 2; i++) { const p = k.point((_x, _z, h) => h > 0.6); if (p) k.wander(k.animal('goat'), p.x, p.z, 0.15, 0.025, { peck: true }); }
    const eagle = k.animal('bird', 0.8);
    k.updates.push(t => { const a = t * 0.35; eagle.position.set(peak.x + Math.cos(a) * 0.9, ph + 1.1 + Math.sin(t * 0.7) * 0.1, peak.z + Math.sin(a) * 0.9); eagle.rotation.set(-0.35, faceX(-Math.sin(a), Math.cos(a)), 0); });
  }
}

// 화산: 안전모 쓴 연구원이 삼각대로 관측하고, 관광객은 사진을 찍는다. 둘레엔 경고 표지
function volcanoScene(k: Kit) {
  const { R } = volcanoSize(k.comp.length), c = k.c;
  const view = (a: number, r: number) => ({ x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, face: Math.atan2(-Math.cos(a), -Math.sin(a)) });
  const a0 = k.rnd() * 6;
  for (let i = 0; i < 2; i++) {
    const p = view(a0 + i * 0.5, R * 0.95);
    k.put(tripodGeo, p.x + Math.cos(a0 + i * 0.5) * -0.08, p.z + Math.sin(a0 + i * 0.5) * -0.08, p.face);
    k.person({ at: { ...p, act: 'water', dur: [20, 40] }, look: LOOK.science });
  }
  const tour = [0, 1, 2, 3].map(i => ({ ...view(a0 + 1.4 + i * 0.35, R * 1.05), act: 'photo' as Act, tool: 'camera' as Tool, dur: [3, 6] as [number, number] }));
  for (let i = 0; i < count(3); i++) k.person({ at: tour[i], pool: tour });
  for (let i = 0; i < 5; i++) { const p = view(a0 + i * 1.25, R * 0.9); k.put(signGeo, p.x, p.z, p.face + Math.PI); }
}

// 해변: 파라솔 아래 수건 위에 누운 사람, 모래성 쌓는 아이들, 얕은 물에서 헤엄치는 사람, 물가 산책, 게
function beachScene(k: Kit) {
  const sand = (x: number, z: number, h: number) => h > 0.06 && h < 0.4 && surfaceAt(x, z).water < h;
  for (let i = 0; i < count(3); i++) {
    const p = k.point(sand);
    if (!p) continue;
    const rot = k.rnd() * 6;
    k.put(towelGeo[i % towelGeo.length], p.x, p.z, rot); k.put(umbrellaGeo[i % umbrellaGeo.length], p.x + 0.07, p.z + 0.05);
    k.person({ at: { x: p.x + Math.sin(rot) * 0.07, z: p.z + Math.cos(rot) * 0.07, act: 'lie', face: rot, dur: [40, 80] }, look: LOOK.beach });
  }
  const castle = k.point(sand);
  if (castle) {
    k.put(sandcastleGeo, castle.x, castle.z);
    [0, 2.4].forEach(a => k.person({ at: { x: castle.x + Math.cos(a) * 0.09, z: castle.z + Math.sin(a) * 0.09, act: 'kneel', face: Math.atan2(-Math.cos(a), -Math.sin(a)), dur: [40, 80] }, role: 'child', look: LOOK.beach }));
  }
  // 얕은 바다: 묶음 둘레 바깥, 물 깊이 0.08~0.6
  const swim: Spot[] = [];
  for (let t = 0; t < 60 && swim.length < 6; t++) {
    const c = toWorld(k.pick(k.comp)), a = k.rnd() * 6, r = 0.9 + k.rnd() * 0.7, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r, s = surfaceAt(x, z), d = s.water - s.h;
    if (!s.lake && d > 0.08 && d < 0.6) swim.push({ x, z, y: s.water - 0.02, act: 'swim', dur: [1, 3] });
  }
  for (let i = 0; i < count(3) && swim.length; i++) k.person({ at: swim[i % swim.length], pool: swim, look: LOOK.beach, speed: 0.07 });
  const shore = k.spots(4, 'idle', [1, 3], sand);
  for (let i = 0; i < count(2) && shore.length; i++) k.person({ at: shore[i % shore.length], pool: shore, look: LOOK.beach });
  if (LOD.animals) for (let i = 0; i < 2; i++) { const p = k.point(sand); if (p) k.wander(k.animal('crab', 0.6), p.x, p.z, 0.08, 0.03, { side: true }); }
}

// 밭: 괭이질하는 농부, 바구니 나르는 사람, 헛간 둘레의 닭·돼지·소
function farmScene(k: Kit) {
  const rows = k.spots(8, 'work', [3, 6], (x, z, h) => h > 0.35 && (!k.note.barn || Math.hypot(x - k.note.barn.x, z - k.note.barn.z) > 0.6), { tool: 'hoe' });
  for (let i = 0; i < count(2 + Math.min(k.comp.length, 3)) && rows.length; i++) k.person({ at: rows[i % rows.length], pool: rows, look: LOOK.farmer, tool: 'hoe' });
  const yard = k.note.barn ? { x: k.note.barn.x + 0.45, z: k.note.barn.z + 0.2 } : k.center;
  const carry: Spot[] = [{ ...yard, act: 'idle', tool: null, dur: [1, 2] }, ...k.spots(3, 'idle', [1, 2], undefined, { tool: 'basket' })];
  k.person({ at: carry[0], pool: carry, look: LOOK.farmer, loop: true });
  if (LOD.animals) {
    for (let i = 0; i < 3; i++) k.wander(k.animal('chicken'), yard.x, yard.z, 0.08 + i * 0.04, 0.04, { hop: 0.01, peck: true });
    k.wander(k.animal('pig'), yard.x + 0.2, yard.z - 0.15, 0.1, 0.02, { peck: true });
    if (k.comp.length >= 3) k.wander(k.animal('cow', 0.5), yard.x - 0.25, yard.z + 0.2, 0.12, 0.015, { peck: true });
  }
}

// 꽃밭: 물뿌리개로 물 주는 정원사, 꽃 냄새 맡는 사람, 벌통 옆 양봉가, 나비
function flowerScene(k: Kit) {
  const beds = k.spots(6, 'water', [3, 5], undefined, { tool: 'can' });
  for (let i = 0; i < count(2) && beds.length; i++) k.person({ at: beds[i], pool: beds, tool: 'can' });
  const sniff = k.spots(5, 'kneel', [2, 4]);
  for (let i = 0; i < count(3) && sniff.length; i++) k.person({ at: sniff[i % sniff.length], pool: sniff, role: i === 2 ? 'child' : 'adult' });
  const hive = k.point();
  if (hive) {
    [0, 0.12, 0.24].forEach(o => k.put(hiveGeo, hive.x + o, hive.z));
    k.person({ at: { x: hive.x + 0.12, z: hive.z + 0.1, act: 'work', face: Math.PI, dur: [30, 60] }, look: LOOK.bee });
  }
  if (LOD.animals) for (let i = 0; i < 5; i++) {
    const p = k.point(); if (!p) continue;
    const b = k.animal('butterfly', 0.7), ph = k.rnd() * 6;
    k.updates.push(t => { const a = t * 0.6 + ph; b.position.set(p.x + Math.cos(a) * 0.15, heightFast(p.x, p.z) + 0.12 + Math.sin(t * 3 + ph) * 0.04, p.z + Math.sin(a * 1.3) * 0.15); b.rotation.y = faceX(-Math.sin(a), Math.cos(a)); });
  }
}

// 과수원: 나무 아래에서 팔을 뻗어 과일 따는 사람(바구니), 노점으로 나르는 사람, 과일 노점 상인
function orchardScene(k: Kit) {
  const trees = (k.note.trees ?? []).filter(() => k.rnd() < 0.5).slice(0, 10);
  const picks: Spot[] = trees.map(t => { const a = k.rnd() * 6; return { x: t.x + Math.cos(a) * 0.13, z: t.z + Math.sin(a) * 0.13, act: 'pick', tool: 'basket', face: Math.atan2(-Math.cos(a), -Math.sin(a)), dur: [3, 6] }; });
  for (let i = 0; i < count(4) && picks.length; i++) k.person({ at: picks[i % picks.length], pool: picks, look: LOOK.farmer, tool: 'basket' });
  const stand = k.note.stand;
  if (stand) {
    k.person({ at: { x: stand.x, z: stand.z - 0.2, face: 0 }, role: 'vendor', look: LOOK.vendor });
    const loop: Spot[] = [{ x: stand.x + 0.2, z: stand.z + 0.15, act: 'idle', tool: null, dur: [1, 2] }, ...picks.slice(0, 2).map(p => ({ ...p, act: 'pick' as Act, tool: 'basket' as Tool }))];
    if (loop.length > 1) k.person({ at: loop[0], pool: loop, loop: true });
  }
}

// 성: 창 든 경비병이 본채를 돌며 순찰하고, 마당에선 기사 둘이 칼싸움 연습, 말
function castleScene(k: Kit) {
  const keep = k.note.keep ?? k.note.tower ?? k.center, single = !k.note.keep;
  const ring = Array.from({ length: 8 }, (_, i) => { const a = i * Math.PI / 4; return { x: keep.x + Math.cos(a) * (single ? 0.32 : 0.62), z: keep.z + Math.sin(a) * (single ? 0.32 : 0.62), act: 'idle' as Act, tool: 'spear' as Tool, dur: [0.5, 1.5] as [number, number] }; }).filter(s => k.in(s.x, s.z));
  for (let i = 0; i < (single ? 1 : count(4)) && ring.length; i++) k.person({ at: ring[(i * 2) % ring.length], pool: ring, look: LOOK.guard, tool: 'spear', loop: true, speed: 0.12 });
  if (single) return;
  const yard = k.point((x, z) => Math.hypot(x - keep.x, z - keep.z) > 0.8, 0.35);
  if (yard) [0, Math.PI].forEach(a => k.person({ at: { x: yard.x + Math.cos(a) * 0.06, z: yard.z, act: 'spar', tool: 'sword', face: a === 0 ? -Math.PI / 2 : Math.PI / 2, dur: [40, 80] }, look: LOOK.guard }));
  if (LOD.animals) { const h = k.point((x, z) => Math.hypot(x - keep.x, z - keep.z) > 0.8, 0.35); if (h) k.wander(k.animal('horse', 0.5), h.x, h.z, 0.05, 0.01, { peck: true }); }
}

// 설원: 눈사람 만드는 아이들, 눈싸움(눈덩이가 날아간다), 털모자 쓴 산책객
function snowScene(k: Kit) {
  const man = k.point();
  if (man) {
    k.put(snowmanGeo, man.x, man.z, k.rnd() * 6);
    [0.8, 3.0].forEach(a => k.person({ at: { x: man.x + Math.cos(a) * 0.08, z: man.z + Math.sin(a) * 0.08, act: 'kneel', face: Math.atan2(-Math.cos(a), -Math.sin(a)), dur: [40, 80] }, role: 'child', look: LOOK.winter }));
  }
  const fight = k.point();
  if (fight) {
    const a = k.rnd() * 6, ends = [-1, 1].map(s => ({ x: fight.x + Math.cos(a) * 0.22 * s, z: fight.z + Math.sin(a) * 0.22 * s }));
    ends.forEach((e, i) => k.person({ at: { ...e, act: 'throw', tool: 'snowball', face: Math.atan2(ends[1 - i].x - e.x, ends[1 - i].z - e.z), dur: [60, 90] }, role: 'child', look: LOOK.winter }));
    const ballMesh = new THREE.Mesh(snowballGeo, snowballMat);
    k.g.add(ballMesh);
    k.updates.push(t => {   // 던지는 순간부터 상대 쪽으로 포물선
      const u = ((t * 0.4) % 1 - 0.7) / 0.3, from = ends[Math.floor(t * 0.4) % 2], to = ends[1 - Math.floor(t * 0.4) % 2];
      ballMesh.visible = u > 0 && u < 1;
      if (!ballMesh.visible) return;
      const x = from.x + (to.x - from.x) * u, z = from.z + (to.z - from.z) * u;
      ballMesh.position.set(x, heightFast(x, z) + 0.1 + Math.sin(u * Math.PI) * 0.1, z);
    });
  }
  const walks = k.spots(5, 'idle', [1, 3]);
  for (let i = 0; i < count(2) && walks.length; i++) k.person({ at: walks[i % walks.length], pool: walks, look: LOOK.winter });
}

// 사막: 상인이 낙타 대상을 이끌고 돌고, 천막 그늘에 앉은 유목민, 도마뱀
function desertScene(k: Kit) {
  const c = k.c, r = 0.5 + Math.sqrt(k.comp.length) * 0.35;
  const loop = Array.from({ length: 8 }, (_, i) => ({ x: c.x + Math.cos(i * Math.PI / 4) * r, z: c.z + Math.sin(i * Math.PI / 4) * r, act: 'idle' as Act, dur: [0.1, 0.3] as [number, number] })).filter(s => k.in(s.x, s.z));
  if (loop.length > 2) {
    const lead = k.person({ at: loop[0], pool: loop, look: LOOK.nomad, loop: true, speed: 0.1, tool: 'cane' });
    if (LOD.animals) {   // 낙타는 상인이 지나온 길을 따라간다
      const trail: P[] = [], camels = [0, 1, 2].slice(0, count(3)).map(() => k.animal('camel', 0.55));
      let leader: Folk | undefined;
      k.updates.push(() => {
        leader ??= k.crowd?.[lead];
        if (!leader) return;
        const last = trail.at(-1);
        if (!last || Math.hypot(last.x - leader.x, last.z - leader.z) > 0.02) trail.push({ x: leader.x, z: leader.z });
        if (trail.length > 120) trail.shift();
        camels.forEach((o, i) => {
          const p = trail[Math.max(0, trail.length - 1 - (i + 1) * 12)], q = trail[Math.max(0, trail.length - 1 - (i + 1) * 12 + 2)];
          if (!p || !q) return;
          o.position.set(p.x, heightFast(p.x, p.z), p.z);
          if (q !== p) o.rotation.y = faceX(q.x - p.x, q.z - p.z);
        });
      });
    }
  }
  const camp = k.point();
  if (camp) {
    k.put(nomadTent, camp.x, camp.z, k.rnd() * 6);
    [-0.07, 0.07].forEach((o, i) => k.person({ at: { x: camp.x + o, z: camp.z + 0.14, act: 'sit', face: i ? -0.8 : 0.8, dur: [30, 60] }, look: LOOK.nomad }));
  }
  if (LOD.animals) for (let i = 0; i < 2; i++) { const p = k.point(); if (p) k.wander(k.animal('lizard', 0.6), p.x, p.z, 0.1, 0.08); }
}

// 새 섬: 물가에 앉아 낚시하는 사람, 갈매기, 떠 있는 뗏목
function isletScene(k: Kit) {
  const c = toWorld(k.comp[0]);
  for (let t = 0; t < 20; t++) {
    const a = k.rnd() * 6, x = c.x + Math.cos(a) * 0.55, z = c.z + Math.sin(a) * 0.55, h = heightFast(x, z);
    if (h < 0.05 || h > 0.4) continue;
    k.person({ at: { x, z, act: 'fish', tool: 'rod', face: Math.atan2(Math.cos(a), Math.sin(a)), dur: [60, 120] }, look: LOOK.beach });
    if (LOD.animals) {
      const raft = k.animal('raft', 0.8), rx = c.x + Math.cos(a + 0.6) * 1.2, rz = c.z + Math.sin(a + 0.6) * 1.2;
      k.updates.push(tt => { raft.position.set(rx, Math.sin(tt * 1.2) * 0.01, rz); raft.rotation.z = Math.sin(tt * 1.4) * 0.05; });
    }
    break;
  }
  if (LOD.animals) { const gull = k.animal('seagull', 0.7); k.updates.push(t => { const a = t * 0.5; gull.position.set(c.x + Math.cos(a) * 0.8, 1.0 + Math.sin(t) * 0.08, c.z + Math.sin(a) * 0.8); gull.rotation.set(-0.35, faceX(-Math.sin(a), Math.cos(a)), 0); }); }
}

// ── 바닷속: 물속에서 가까이 볼 때만. 잠수부(산소통·거품), 물고기 떼, 거북·물범·문어·가오리·아귀 ──
const floorAt = (x: number, z: number) => heightFast(x, z);
function divers(k: Kit, n: number, act: Act = 'swim', tool?: Tool, lift = 0.3) {
  const sw: Spot[] = [];
  for (let i = 0; i < 6; i++) {
    const p = k.point(() => true, 0.1);
    if (!p) continue;
    const fl = floorAt(p.x, p.z);
    sw.push(act === 'swim' ? { ...p, y: Math.min(-0.15, fl + lift + k.rnd() * 0.3), act: 'swim', tool, dur: [1, 3] } : { ...p, act, tool, dur: [4, 8] });
  }
  if (!sw.length) return;
  for (let i = 0; i < n; i++) k.person({ at: sw[i % sw.length], pool: sw, look: LOOK.diver, speed: 0.07, tool });
  k.after.push(folk => folk.forEach(f => { if (f.back === 2) bubbles(k, () => new THREE.Vector3(f.x, f.y + 0.13 * f.size, f.z), 3); }));
}
function swimmer(k: Kit, kind: ItemKind, s: number, r: number, depth: number) {
  const p = k.point(() => true, 0.1);
  if (!p) return;
  const o = k.animal(kind, s), ph = k.rnd() * 6, y = Math.min(-0.2, floorAt(p.x, p.z) + depth);
  k.updates.push(t => { const a = t * 0.25 + ph; o.position.set(p.x + Math.cos(a) * r, y + Math.sin(t + ph) * 0.03, p.z + Math.sin(a) * r); o.rotation.y = faceX(-Math.sin(a), Math.cos(a)); });
}
function school(k: Kit, n: number) {
  const p = k.point(() => true, 0.2);
  if (!p) return;
  const s = makeSchool(n, 0.35);
  s.mesh.position.set(p.x, Math.min(-0.25, floorAt(p.x, p.z) + 0.4), p.z);
  k.g.add(s.mesh);
  k.updates.push(t => s.update(t));
}
const reefScene: Scene = k => { divers(k, count(2)); school(k, 20); school(k, 14); if (LOD.animals) swimmer(k, 'turtle', 0.6, 0.6, 0.4); };
const kelpScene: Scene = k => { divers(k, count(1)); if (LOD.animals) { swimmer(k, 'seal', 0.6, 0.5, 0.5); swimmer(k, 'seal', 0.6, 0.35, 0.3); } school(k, 12); };
const palaceScene: Scene = k => { if (LOD.animals) { swimmer(k, 'turtle', 0.6, 0.7, 0.6); swimmer(k, 'turtle', 0.5, 0.45, 0.4); for (let i = 0; i < 2; i++) { const p = k.point(() => true); if (p) k.wander(k.animal('crab', 0.6), p.x, p.z, 0.1, 0.03, { side: true }); } } divers(k, count(1)); school(k, 16); };
const wreckScene: Scene = k => { divers(k, count(2), 'swim', 'lamp', 0.8); /* 선체 위로 */ if (LOD.animals) { const p = k.point(() => true); if (p) k.wander(k.animal('octopus', 0.6), p.x, p.z, 0.05, 0.01); } };
const ruinsScene: Scene = k => { divers(k, count(2), 'kneel', 'hoe'); if (LOD.animals) swimmer(k, 'ray', 0.6, 0.6, 0.35); school(k, 12); };
const trenchScene: Scene = k => { if (LOD.animals) { swimmer(k, 'anglerfish', 0.7, 0.4, 0.3); swimmer(k, 'jellyfish', 0.7, 0.2, 0.7); swimmer(k, 'jellyfish', 0.6, 0.3, 0.5); } divers(k, count(1), 'swim', 'lamp'); };
const shellsScene: Scene = k => { divers(k, count(1), 'kneel', 'basket'); if (LOD.animals) for (let i = 0; i < 3; i++) { const p = k.point(() => true); if (p) k.wander(k.animal('crab', 0.6), p.x, p.z, 0.08, 0.03, { side: true }); } };

const SCENES: Partial<Record<Kind, Scene>> = {
  house: villageScene, camp: campScene, grass: grassScene, forest: forestScene, mountain: mountainScene, volcano: volcanoScene,
  beach: beachScene, farm: farmScene, flower: flowerScene, orchard: orchardScene, castle: castleScene, snow: snowScene, desert: desertScene, islet: isletScene,
  reef: reefScene, kelp: kelpScene, palace: palaceScene, wreck: wreckScene, ruins: ruinsScene, trench: trenchScene, shells: shellsScene,
};

// 장소 하나의 생활을 만든다
function build(site: Site) {
  const g = new THREE.Group(), k = kitFor(site, g);
  SCENES[site.kind]?.(k);
  if (k.solid.length) { const m = new THREE.Mesh(merge(...k.solid), vcFlat); m.receiveShadow = true; m.castShadow = true; g.add(m); }
  if (k.glow.length) g.add(new THREE.Mesh(merge(...k.glow), glowMat));
  k.crowd = crowd(k);
  if (k.crowd) { for (const a of k.after) a(k.crowd); if (k.dog) { const owner = k.crowd.find(f => f.role === 'adult'); if (owner) followDog(k, owner); } }
  lifeGroup.add(g);
  let last = -1;
  return {
    site, folk: k.folk.length,
    update(t: number) { const dt = last < 0 ? 0 : Math.min(0.1, t - last); last = t; for (const u of k.updates) u(t, dt); },
    dispose() {
      lifeGroup.remove(g);
      g.traverse(o => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
        else if (o instanceof THREE.Sprite && o.material !== bubbleMat) o.material.dispose();
        else if (o instanceof THREE.Mesh && o.parent === g && (o.material === vcFlat || o.material === glowMat)) o.geometry.dispose();   // 합친 소품
      });
    },
  };
}

// 매 프레임: 가까이 본 장소 하나만 살아 움직인다 (물 위에선 육지, 물속에선 바닷속 장소).
// 장소가 바뀌거나(섬을 다시 만들면 기록도 새로) 멀어지면 갈아끼운다
let active: ReturnType<typeof build> | null = null;
export function nearestSite(x: number, z: number, under: boolean, within = 1.8) {
  let best: Site | undefined, bd = within;
  for (const s of sites) {
    if (isSeaKind(s.kind) !== under) continue;
    for (const h of s.comp) { const w = toWorld(h), d = Math.hypot(w.x - x, w.z - z); if (d < bd) { bd = d; best = s; } }
  }
  return best;
}
export function updateLife(t: number) {
  const site = view.dist < SHOW_DIST ? nearestSite(view.target.x, view.target.z, view.under) : undefined;
  if (site !== active?.site) { active?.dispose(); active = site ? build(site) : null; }
  active?.update(t);
  return active?.folk ?? 0;
}
