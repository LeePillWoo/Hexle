// 섬·해저 장식 전체를 새로 만든다 (칸이 바뀔 때마다 통째로)
import * as THREE from 'three';
import { key, type Hex } from '../core/hex';
import { cellsOf, type Cell, type Kind } from './kinds';
import type { Ctx } from './models';
import { LAND_CLUSTER, LAND_SINGLE, lakeDecor } from './land';
import { SEA_CLUSTER } from './sea';
import { EXTRA_CLUSTER } from './extras';
import { emitters } from '../audio/emitters';
import { towns } from './villagers';

export { lighthouse } from './land';

export function decorateAll(cells: Cell[], lakes: Hex[]) {
  const byKey = new Map(cells.map(c => [key(c.hex), c.kind]));
  const ctx: Ctx = { kindAt: h => byKey.get(key(h)), g: new THREE.Group(), updates: [] };
  emitters.length = towns.length = 0;   // 소리 나는 장식·마을 배치 기록은 장식과 함께 다시 등록
  for (const map of [LAND_CLUSTER, SEA_CLUSTER, EXTRA_CLUSTER]) for (const [kind, fn] of Object.entries(map)) for (const comp of cellsOf(cells, kind as Kind)) fn!(ctx, comp);
  for (const c of cells) LAND_SINGLE[c.kind]?.(ctx, c.hex);
  lakeDecor(ctx, lakes);
  ctx.g.userData.update = (t: number) => { for (const u of ctx.updates) u(t); };
  return ctx.g;
}

// 장식을 갈아끼울 때 개별 자원 해제 (공유 지오메트리·재질은 그대로)
export function disposeDecor(o: THREE.Object3D) {
  o.traverse(c => {
    if (c instanceof THREE.Sprite) c.material.dispose();
    if (c instanceof THREE.InstancedMesh) c.dispose();
  });
}
