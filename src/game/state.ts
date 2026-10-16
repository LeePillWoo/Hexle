// 섬 상태: 칸(육지·바닷속 타일)과 아이템. 칸이 바뀌면 지형·장식·오버레이를 다시 만든다
import * as THREE from 'three';
import { key, neighbors, toWorld, type Hex } from '../core/hex';
import { HALF, setLand, surfaceAt } from '../world/terrain';
import { decorateAll, disposeDecor } from '../tiles/index';
import { isSeaKind, TILE_INFO, type Cell, type Kind } from '../tiles/kinds';
import { canPlace, createItem, fitRadius, updateItem, type Item } from '../items/index';
import type { ItemKind } from '../items/kinds';

export const LIGHTHOUSE = { x: 9, z: -6, r: 0.3 };
const INITIAL: Cell[] = [
  { hex: { q: 0, r: 0 }, kind: 'camp' },
  { hex: { q: 0, r: -1 }, kind: 'forest' },
  { hex: { q: 1, r: 0 }, kind: 'grass' },
];
export const cells: Cell[] = INITIAL.map(c => ({ ...c }));
export const items: Item[] = [];
export let lakeSet = new Set<string>();
const decor = new THREE.Group(), itemGroup = new THREE.Group();
export const group = new THREE.Group().add(decor, itemGroup);
// 다시 만들 때 자리를 잃은 카드(호수가 된 바닷속 타일, 놓을 수 없게 된 아이템)는 주인에게 돌려준다
export type Lost = { tiles: Kind[]; items: ItemKind[] };
let onRebuilt: (cells: Cell[], lost: Lost) => void = () => {};
export function onRebuild(cb: typeof onRebuilt) { onRebuilt = cb; }

export function refresh(gift = true) {
  const lakes = setLand(cells, [LIGHTHOUSE]), newLakes = new Set(lakes.map(key)), lost: Lost = { tiles: [], items: [] };
  for (let i = cells.length - 1; i >= 0; i--) if (isSeaKind(cells[i].kind) && newLakes.has(key(cells[i].hex))) lost.tiles.push(cells.splice(i, 1)[0].kind);
  for (const o of decor.children) disposeDecor(o);
  decor.clear();
  decor.add(decorateAll(cells, lakes));
  for (const it of [...items]) {
    if (canPlace(it.kind, it.x, it.z)) fitRadius(it);
    else { removeItem(it); lost.items.push(it.kind); }
  }
  // 새로 생긴 호수(기존 호수와 닿지 않는 새 호수 칸 묶음)에는 예시 잉어 한 마리
  const fresh = lakes.filter(h => !lakeSet.has(key(h)));
  if (gift && fresh.length && !fresh.some(h => neighbors(h).some(n => lakeSet.has(key(n))))) {
    const c = toWorld(fresh[0]);
    if (canPlace('fish', c.x, c.z)) addItem('fish', c.x, c.z);
  }
  lakeSet = newLakes;
  onRebuilt(cells, lost);
}

export function addItem(kind: ItemKind, x: number, z: number) {
  const it = createItem(kind, x, z);
  items.push(it);
  itemGroup.add(it.obj);
  return it;
}
export function removeItem(it: Item) {
  itemGroup.remove(it.obj);
  const i = items.indexOf(it);
  if (i >= 0) items.splice(i, 1);
}
// 지금 서 있는 자리 기준으로 가장 가까운 아이템 (지우기용)
export function nearestItem(x: number, z: number, within: number) {
  let best: Item | undefined, bd = within;
  for (const it of items) { const d = Math.hypot(it.obj.position.x - x, it.obj.position.z - z); if (d < bd) { bd = d; best = it; } }
  return best;
}
export const cellAt = (hex: Hex) => cells.find(c => key(c.hex) === key(hex));
export function placeTile(hex: Hex, kind: Kind) { cells.push({ hex, kind }); refresh(); }
export function removeTile(hex: Hex) {
  const i = cells.findIndex(c => key(c.hex) === key(hex));
  if (i < 0) return undefined;
  const kind = cells.splice(i, 1)[0].kind;
  refresh();
  return kind;
}

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

// 처음 상태로 / 저장본에서 복원
export function reset() { restore(INITIAL.map(c => ({ ...c })), []); }
export function restore(newCells: Cell[], newItems: { kind: ItemKind; x: number; z: number }[]) {
  for (const it of [...items]) removeItem(it);
  cells.length = 0;
  cells.push(...newCells);
  lakeSet = new Set();
  for (const it of newItems) addItem(it.kind, it.x, it.z);
  refresh(false);
}

export function update(t: number) {
  for (const o of decor.children) o.userData.update?.(t);
  for (const it of items) updateItem(it, t);
}
