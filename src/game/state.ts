// 섬 상태: 칸(육지·바닷속 타일)과 아이템. 칸이 바뀌면 지형·장식·오버레이를 다시 만든다
import * as THREE from 'three';
import { key, neighbors, toWorld, type Hex } from '../core/hex';
import { HALF, setLand, surfaceAt } from '../world/terrain';
import { decorateAll, disposeDecor } from '../tiles/index';
import { isSeaKind, TILE_INFO, type Cell, type Kind } from '../tiles/kinds';
import { canPlace, createItem, fitRadius, updateItem, type Item } from '../items/index';
import type { ItemKind } from '../items/kinds';

export const LIGHTHOUSE = { x: 9, z: -6, r: 0.3 };
export const cells: Cell[] = [
  { hex: { q: 0, r: 0 }, kind: 'camp' },
  { hex: { q: 0, r: -1 }, kind: 'forest' },
  { hex: { q: 1, r: 0 }, kind: 'grass' },
];
export const items: Item[] = [];
export let lakeSet = new Set<string>();
const decor = new THREE.Group(), itemGroup = new THREE.Group();
export const group = new THREE.Group().add(decor, itemGroup);
let onRebuilt: (cells: Cell[]) => void = () => {};

export function init(cb: (cells: Cell[]) => void) { onRebuilt = cb; refresh(); }

export function refresh() {
  const lakes = setLand(cells, [LIGHTHOUSE]), newLakes = new Set(lakes.map(key));
  // 호수가 된 바닷속 타일은 사라진다
  for (let i = cells.length - 1; i >= 0; i--) if (isSeaKind(cells[i].kind) && newLakes.has(key(cells[i].hex))) cells.splice(i, 1);
  for (const o of decor.children) disposeDecor(o);
  decor.clear();
  decor.add(decorateAll(cells, lakes));
  // 놓을 수 없는 자리가 된 아이템(예: 메워진 호수의 물고기)은 사라진다
  for (const it of [...items]) {
    if (canPlace(it.kind, it.x, it.z)) fitRadius(it);
    else { itemGroup.remove(it.obj); items.splice(items.indexOf(it), 1); }
  }
  // 새로 생긴 호수(기존 호수와 닿지 않는 새 호수 칸 묶음)에는 예시 잉어 한 마리
  const fresh = lakes.filter(h => !lakeSet.has(key(h)));
  if (fresh.length && !fresh.some(h => neighbors(h).some(n => lakeSet.has(key(n))))) {
    const c = toWorld(fresh[0]);
    if (canPlace('fish', c.x, c.z)) addItem('fish', c.x, c.z);
  }
  lakeSet = newLakes;
  onRebuilt(cells);
}

export function addItem(kind: ItemKind, x: number, z: number) {
  const it = createItem(kind, x, z);
  items.push(it);
  itemGroup.add(it.obj);
  return it;
}
export function placeTile(hex: Hex, kind: Kind) { cells.push({ hex, kind }); refresh(); }

// 타일 배치 규칙: 붙이기(육지 옆) / 새 섬(육지와 떨어진 바다) / 바닷속(호수 아닌 바다 칸)
export function canPlaceTile(kind: Kind, hex: Hex) {
  const w = toWorld(hex), k = key(hex);
  if (Math.abs(w.x) > HALF - 2.5 || Math.abs(w.z) > HALF - 2.5 || cells.some(c => key(c.hex) === k)) return false;
  const landNear = neighbors(hex).some(n => cells.some(c => key(c.hex) === key(n) && !isSeaKind(c.kind)));
  switch (TILE_INFO[kind].rule) {
    case 'attach': return landNear;
    case 'island': return !landNear && !lakeSet.has(k) && surfaceAt(w.x, w.z).h < -0.2;
    case 'sea': return !lakeSet.has(k) && surfaceAt(w.x, w.z).h < -0.25;
  }
}

export function update(t: number) {
  for (const o of decor.children) o.userData.update?.(t);
  for (const it of items) updateItem(it, t);
}
