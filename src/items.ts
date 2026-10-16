// 배치 아이템: 물고기(호수), 상어·배(바다), 양·고양이(땅). 놓은 자리 주변을 돌아다닌다.
import * as THREE from 'three';
import { HALF, surfaceAt } from './terrain';

export type ItemKind = 'fish' | 'shark' | 'boat' | 'sheep' | 'cat';
type Place = 'lake' | 'sea' | 'land';
export const ITEM_INFO: Record<ItemKind, { name: string; icon: string; place: Place }> = {
  fish: { name: '물고기', icon: '🐟', place: 'lake' },
  shark: { name: '상어', icon: '🦈', place: 'sea' },
  boat: { name: '배', icon: '⛵', place: 'sea' },
  sheep: { name: '양', icon: '🐑', place: 'land' },
  cat: { name: '고양이', icon: '🐈', place: 'land' },
};
export const ITEM_KINDS = Object.keys(ITEM_INFO) as ItemKind[];
export const PLACE_NAME: Record<Place, string> = { lake: '호수', sea: '바다', land: '땅' };

// 이 지점에 놓을 수 있나: 물속 생물·배는 충분히 깊은 물, 동물은 물에서 떨어진 완만한 땅
export function canPlace(kind: ItemKind, x: number, z: number) {
  if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) return false;
  const s = surfaceAt(x, z), depth = s.water - s.h;
  switch (ITEM_INFO[kind].place) {
    case 'lake': return s.lake && depth > 0.15;
    case 'sea': return !s.lake && depth > (kind === 'shark' ? 0.5 : 0.3);
    case 'land': return depth < -0.12 && Math.abs(surfaceAt(x + 0.12, z).h - surfaceAt(x - 0.12, z).h) < 0.15
      && Math.abs(surfaceAt(x, z + 0.12).h - surfaceAt(x, z - 0.12).h) < 0.15;
  }
}

// ── 모델 (모두 +x 방향을 바라보게) ──
const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.7, ...extra });
function part(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, sx = 1, sy = sx, sz = sx) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.scale.set(sx, sy, sz);
  o.castShadow = true;
  return o;
}
const sphere = new THREE.SphereGeometry(1, 16, 12);
const cone = new THREE.ConeGeometry(1, 1, 8);
const box = new THREE.BoxGeometry(1, 1, 1);
const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
const fluff = new THREE.IcosahedronGeometry(1, 1);
const tailFin = cone.clone().rotateZ(Math.PI / 2);   // 꼬리지느러미: 뒤(-x)로 넓어지는 원뿔
const finGeo = new THREE.ConeGeometry(1, 1, 3);
const M = {
  fish: mat(0xff8a2a), fishBelly: mat(0xffd2a0), white: mat(0xf5f5f0), dark: mat(0x2b2b2b), shark: mat(0x6f8796),
  sheep: mat(0xf4f1ea, { roughness: 1, flatShading: true }), face: mat(0x3a3330), pink: mat(0xf0a0a8),
  cat: mat(0xe9973f), catLight: mat(0xf7d9b0), hull: mat(0x8a5a33), deck: mat(0xc49a6a), trim: mat(0xf2eee6),
  sail: mat(0xfaf6ea, { side: THREE.DoubleSide }), flag: mat(0xd03a2f, { side: THREE.DoubleSide }),
};
const eyes = (g: THREE.Group, x: number, y: number, z: number, r: number) => {
  for (const s of [1, -1]) g.add(part(sphere, M.dark, x, y, z * s, r));
};

function model(kind: ItemKind) {
  const g = new THREE.Group();
  if (kind === 'fish') {
    g.add(part(sphere, M.fish, 0, 0, 0, 0.09, 0.045, 0.035));
    g.add(part(sphere, M.fishBelly, 0.01, -0.012, 0, 0.075, 0.03, 0.03));
    g.add(part(tailFin, M.fish, -0.115, 0.015, 0, 0.045, 0.035, 0.012).rotateZ(-0.35));   // 꼬리 위·아래 갈래
    g.add(part(tailFin, M.fish, -0.115, -0.015, 0, 0.045, 0.035, 0.012).rotateZ(0.35));
    g.add(part(finGeo, M.fish, -0.01, 0.05, 0, 0.03, 0.035, 0.006));                     // 등지느러미
    for (const s of [1, -1]) g.add(part(finGeo, M.fish, 0.03, -0.015, 0.03 * s, 0.015, 0.03, 0.004).rotateX(s * 1.1));
    eyes(g, 0.065, 0.012, 0.024, 0.008);
  } else if (kind === 'shark') {
    g.add(part(sphere, M.shark, 0, 0, 0, 0.32, 0.08, 0.09));
    g.add(part(sphere, M.white, 0.02, -0.03, 0, 0.28, 0.05, 0.075));                   // 흰 배
    g.add(part(cone, M.shark, 0.34, 0, 0, 0.06, 0.1, 0.07).rotateZ(-Math.PI / 2));     // 주둥이
    g.add(part(finGeo, M.shark, 0, 0.13, 0, 0.07, 0.2, 0.012));                         // 등지느러미 (수면 위로 나온다)
    for (const s of [1, -1]) g.add(part(finGeo, M.shark, 0.08, -0.05, 0.1 * s, 0.05, 0.14, 0.01).rotateX(s * 1.3).rotateZ(0.5));
    g.add(part(tailFin, M.shark, -0.38, 0.05, 0, 0.1, 0.09, 0.015).rotateZ(-0.6));
    g.add(part(tailFin, M.shark, -0.36, -0.03, 0, 0.07, 0.06, 0.015).rotateZ(0.5));
    eyes(g, 0.25, 0.02, 0.06, 0.012);
  } else if (kind === 'boat') {
    g.add(part(box, M.hull, 0, 0.05, 0, 0.5, 0.12, 0.22));
    g.add(part(cone, M.hull, 0.31, 0.05, 0, 0.11, 0.13, 0.12).rotateZ(-Math.PI / 2));  // 뱃머리
    g.add(part(box, M.trim, 0, 0.115, 0, 0.52, 0.015, 0.23));                          // 뱃전 띠
    g.add(part(box, M.deck, 0, 0.11, 0, 0.46, 0.01, 0.18));                            // 갑판
    g.add(part(box, M.hull, -0.17, 0.16, 0, 0.12, 0.09, 0.14));                        // 선실
    g.add(part(cyl, M.hull, 0.02, 0.42, 0, 0.012, 0.62, 0.012));                       // 돛대
    g.add(part(cyl, M.hull, -0.08, 0.18, 0, 0.008, 0.22, 0.008).rotateZ(Math.PI / 2)); // 활대
    const main = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 0.52), new THREE.Vector2(-0.2, 0.02)]);
    const jib = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 0.42), new THREE.Vector2(0.26, 0)]);
    g.add(part(new THREE.ShapeGeometry(main), M.sail, 0.01, 0.19, 0));
    g.add(part(new THREE.ShapeGeometry(jib), M.sail, 0.04, 0.19, 0.005));
    g.add(part(new THREE.PlaneGeometry(0.08, 0.05), M.flag, 0.06, 0.7, 0));
  } else if (kind === 'sheep') {
    for (const [x, y, z, r] of [[0, 0.15, 0, 0.09], [0.06, 0.16, 0.03, 0.07], [-0.06, 0.15, -0.03, 0.075], [0.05, 0.15, -0.04, 0.065],
      [-0.05, 0.17, 0.04, 0.065], [0, 0.21, 0, 0.065], [-0.11, 0.16, 0, 0.04]]) g.add(part(fluff, M.sheep, x, y, z, r));   // 복슬 털
    g.add(part(sphere, M.face, 0.14, 0.18, 0, 0.045, 0.042, 0.036));
    g.add(part(fluff, M.sheep, 0.13, 0.225, 0, 0.03));                                   // 앞머리 털
    for (const s of [1, -1]) g.add(part(sphere, M.face, 0.13, 0.19, 0.045 * s, 0.022, 0.01, 0.012));   // 귀
    eyes(g, 0.172, 0.195, 0.018, 0.006);
    for (const [x, z] of [[0.07, 0.04], [0.07, -0.04], [-0.07, 0.04], [-0.07, -0.04]]) g.add(part(cyl, M.face, x, 0.045, z, 0.013, 0.09, 0.013));
  } else {
    g.add(part(sphere, M.cat, 0, 0.075, 0, 0.09, 0.05, 0.045));
    g.add(part(sphere, M.catLight, 0.02, 0.06, 0, 0.07, 0.035, 0.038));                  // 배
    g.add(part(sphere, M.cat, 0.1, 0.125, 0, 0.045, 0.042, 0.045));
    g.add(part(sphere, M.catLight, 0.135, 0.11, 0, 0.02, 0.016, 0.022));                 // 주둥이
    g.add(part(sphere, M.pink, 0.155, 0.118, 0, 0.006));                                  // 코
    for (const s of [1, -1]) {
      g.add(part(cone, M.cat, 0.1, 0.175, 0.024 * s, 0.017, 0.035, 0.012));
      g.add(part(cone, M.pink, 0.104, 0.172, 0.024 * s, 0.009, 0.022, 0.006));          // 귀 안쪽
    }
    eyes(g, 0.138, 0.135, 0.018, 0.007);
    for (const [x, z] of [[0.06, 0.025], [0.06, -0.025], [-0.06, 0.025], [-0.06, -0.025]]) g.add(part(cyl, M.cat, x, 0.03, z, 0.011, 0.06, 0.011));
    g.add(part(cyl, M.cat, -0.11, 0.1, 0, 0.009, 0.08, 0.009).rotateZ(0.9));             // 꼬리 (두 마디로 휘게)
    g.add(part(cyl, M.cat, -0.15, 0.16, 0, 0.008, 0.07, 0.008).rotateZ(0.2));
  }
  return g;
}

// 움직임: 놓은 자리를 중심으로 원을 돈다. 반지름은 원 위 전 구간이 놓을 수 있는 곳인 가장 큰 값
const MOVE: Record<ItemKind, { radii: number[]; speed: number }> = {
  fish: { radii: [0.6, 0.4, 0.2], speed: 0.8 },
  shark: { radii: [1.5, 1, 0.5], speed: 0.35 },
  boat: { radii: [1.2, 0.7, 0.3], speed: 0.08 },
  sheep: { radii: [0.35, 0.2], speed: 0.12 },
  cat: { radii: [0.4, 0.2], speed: 0.2 },
};
export type Item = { kind: ItemKind; x: number; z: number; obj: THREE.Object3D; r: number; phase: number };

const fits = (kind: ItemKind, x: number, z: number, r: number) =>
  Array.from({ length: 12 }, (_, i) => i / 12 * Math.PI * 2).every(a => canPlace(kind, x + Math.cos(a) * r, z + Math.sin(a) * r));
export function fitRadius(it: Item) { it.r = MOVE[it.kind].radii.find(r => fits(it.kind, it.x, it.z, r)) ?? 0; }

export function createItem(kind: ItemKind, x: number, z: number): Item {
  const it = { kind, x, z, obj: model(kind), r: 0, phase: Math.random() * Math.PI * 2 };
  fitRadius(it);
  return it;
}

// ponytail: 매 프레임 아이템마다 높이 조회, 수백 마리면 경로 높이를 미리 구워 둘 것
export function updateItem(it: Item, t: number) {
  const { speed } = MOVE[it.kind], a = t * speed / Math.max(it.r, 0.2) * 0.3 + it.phase;
  const x = it.x + Math.cos(a) * it.r, z = it.z + Math.sin(a) * it.r, s = surfaceAt(x, z), o = it.obj;
  o.position.set(x, 0, z);
  if (it.r > 0) o.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a));   // 진행 방향(원의 접선)
  if (it.kind === 'fish') o.position.y = s.water - 0.1 + Math.sin(t * 3 + it.phase) * 0.02;
  if (it.kind === 'shark') o.position.y = s.water - 0.08;
  if (it.kind === 'boat') { o.position.y = s.water + Math.sin(t * 1.5 + it.phase) * 0.02; o.rotation.x = Math.sin(t * 1.2 + it.phase) * 0.06; }
  if (it.kind === 'sheep' || it.kind === 'cat') o.position.y = s.h;
}
