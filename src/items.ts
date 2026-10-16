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
const tailFin = cone.clone().rotateZ(Math.PI / 2);   // 꼬리지느러미: 뒤(-x)로 넓어지는 원뿔
const M = {
  fish: mat(0xff8a2a), white: mat(0xf5f5f0), dark: mat(0x2b2b2b), shark: mat(0x6f8796), sheep: mat(0xf4f1ea, { roughness: 1 }),
  cat: mat(0xe9973f), hull: mat(0x8a5a33), sail: mat(0xfaf6ea, { side: THREE.DoubleSide }),
};

function model(kind: ItemKind) {
  const g = new THREE.Group();
  if (kind === 'fish') {
    g.add(part(sphere, M.fish, 0, 0, 0, 0.09, 0.045, 0.035));
    g.add(part(tailFin, M.fish, -0.11, 0, 0, 0.05, 0.05, 0.015));
  } else if (kind === 'shark') {
    g.add(part(sphere, M.shark, 0, 0, 0, 0.32, 0.08, 0.09));
    g.add(part(cone, M.shark, 0, 0.12, 0, 0.06, 0.18, 0.015));                     // 등지느러미 (수면 위로 나온다)
    g.add(part(tailFin, M.shark, -0.36, 0.02, 0, 0.1, 0.1, 0.02));
  } else if (kind === 'boat') {
    g.add(part(box, M.hull, 0, 0.04, 0, 0.5, 0.1, 0.2));
    g.add(part(cone, M.hull, 0.3, 0.04, 0, 0.1, 0.12, 0.1).rotateZ(-Math.PI / 2));  // 뱃머리
    g.add(part(cyl, M.hull, 0, 0.35, 0, 0.012, 0.6, 0.012));
    const sail = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0, 0.5), new THREE.Vector2(0.3, 0)]);
    g.add(part(new THREE.ShapeGeometry(sail), M.sail, 0.02, 0.12, 0));
  } else if (kind === 'sheep') {
    g.add(part(sphere, M.sheep, 0, 0.14, 0, 0.13, 0.09, 0.09));
    g.add(part(sphere, M.dark, 0.13, 0.17, 0, 0.045, 0.04, 0.035));
    for (const [x, z] of [[0.07, 0.04], [0.07, -0.04], [-0.07, 0.04], [-0.07, -0.04]]) g.add(part(cyl, M.dark, x, 0.04, z, 0.012, 0.08, 0.012));
  } else {
    g.add(part(sphere, M.cat, 0, 0.07, 0, 0.09, 0.05, 0.045));
    g.add(part(sphere, M.cat, 0.1, 0.12, 0, 0.045));
    for (const z of [0.022, -0.022]) g.add(part(cone, M.cat, 0.11, 0.17, z, 0.015, 0.03, 0.015));
    g.add(part(cyl, M.cat, -0.12, 0.13, 0, 0.008, 0.12, 0.008).rotateZ(0.6));    // 꼬리
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
