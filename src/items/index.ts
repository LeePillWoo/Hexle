// 아이템 배치 규칙·생성·움직임. 놓은 자리 주변을 원을 그리며 돌거나(생물), 제자리에서 흔들린다(장식)
import * as THREE from 'three';
import { HALF, surfaceAt } from '../world/terrain';
import { ITEM_INFO, type ItemKind } from './kinds';
import { buildModel, makeSchool } from './models';

export type Item = { kind: ItemKind; x: number; z: number; obj: THREE.Object3D; r: number; phase: number };

// 이 지점에 놓을 수 있나
export function canPlace(kind: ItemKind, x: number, z: number) {
  if (Math.abs(x) > HALF - 1 || Math.abs(z) > HALF - 1) return false;
  const info = ITEM_INFO[kind], s = surfaceAt(x, z), depth = s.water - s.h;
  const flat = () => Math.abs(surfaceAt(x + 0.12, z).h - surfaceAt(x - 0.12, z).h) < 0.15 && Math.abs(surfaceAt(x, z + 0.12).h - surfaceAt(x, z - 0.12).h) < 0.15;
  switch (info.medium) {
    case 'land': case 'air-land': return depth < -0.12 && flat();
    case 'lake': return s.lake && depth > 0.15;
    case 'sea': case 'air-sea': return !s.lake && depth > (info.minDepth ?? 0.3);
    case 'seafloor': return !s.lake && depth > (info.minDepth ?? 0.45) && flat();
    case 'midwater': return !s.lake && depth > (info.minDepth ?? 0.7);
  }
}

// 원 위 전 구간이 놓을 수 있는 곳인 가장 큰 반지름
const fits = (kind: ItemKind, x: number, z: number, r: number) =>
  Array.from({ length: 12 }, (_, i) => i / 12 * Math.PI * 2).every(a => canPlace(kind, x + Math.cos(a) * r, z + Math.sin(a) * r));
export function fitRadius(it: Item) { it.r = ITEM_INFO[it.kind].radii.find(r => r === 0 || fits(it.kind, it.x, it.z, r)) ?? 0; }

const LIGHT_AT: Partial<Record<ItemKind, [number, number, number]>> = { anglerfish: [0.11, 0.13, 0], lantern: [0, 0.2, 0], buoy: [0, 0.3, 0] };
export function createItem(kind: ItemKind, x: number, z: number): Item {
  const info = ITEM_INFO[kind];
  let obj: THREE.Object3D;
  if (kind === 'school') { const s = makeSchool(24, 0.45); obj = new THREE.Group().add(s.mesh); obj.userData.update = s.update; }
  else obj = buildModel(kind);
  obj.rotation.order = 'YZX';                                     // 진행 방향(y) → 앞뒤 기울기(z) → 좌우 기울기(x)
  if (info.radii[0] === 0) obj.rotation.y = Math.random() * Math.PI * 2;
  if (info.light) { const l = new THREE.PointLight(info.light, 0.8, 1.8); l.position.set(...(LIGHT_AT[kind] ?? [0, 0.2, 0])); obj.add(l); }
  const it = { kind, x, z, obj, r: 0, phase: Math.random() * Math.PI * 2 };
  fitRadius(it);
  return it;
}

// ponytail: 매 프레임 아이템마다 높이 조회, 수백 마리면 경로 높이를 미리 구워 둘 것
export function updateItem(it: Item, t: number) {
  const info = ITEM_INFO[it.kind], o = it.obj;
  const a = it.r > 0 ? t * info.speed / Math.max(it.r, 0.2) * 0.3 + it.phase : it.phase;
  const x = it.x + Math.cos(a) * it.r, z = it.z + Math.sin(a) * it.r, s = surfaceAt(x, z), depth = s.water - s.h;
  let y = info.y === 'surface' ? s.water + info.off
    : info.y === 'floor' ? s.h + info.off
    : info.y === 'mid' ? s.water - depth * info.off
    : Math.max(s.h, s.water) + info.off;
  if (info.bob) y += Math.sin(t * info.bob[0] + it.phase) * info.bob[1];
  if (info.hop) y += Math.abs(Math.sin(t * 5 + it.phase)) * 0.04;
  o.rotation.z = 0;
  if (info.jump) {   // 돌고래: 주기적으로 수면 위로 뛰어오른다
    const j = Math.sin(t * 0.9 + it.phase);
    if (j > 0.3) { y += (j - 0.3) * 0.9; o.rotation.z = Math.cos(t * 0.9 + it.phase) * 0.9; }
  }
  o.position.set(x, y, z);
  if (it.r > 0) o.rotation.y = Math.atan2(-Math.cos(a), -Math.sin(a)) + (info.side ? Math.PI / 2 : 0);   // 진행 방향(원의 접선)
  if (info.pulse) { const p = 1 + Math.sin(t * 2 + it.phase) * 0.12; o.scale.set(p, 2 - p, p); }
  if (info.sway) { o.rotation.z = Math.sin(t * 0.8 + it.phase) * 0.07; o.rotation.x = Math.cos(t * 0.6 + it.phase) * 0.05; }
  if (info.bank) o.rotation.x = -0.35;   // 원을 돌며 안쪽으로 기울기
  o.userData.update?.(t);
}
