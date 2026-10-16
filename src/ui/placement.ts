// 마우스·터치 배치: 선택한 카드(타일/아이템)를 지형 위에 미리 보여 주고 클릭(탭)하면 놓는다. 지우기 모드면 클릭한 타일·생물을 지운다
import * as THREE from 'three';
import { fromWorld, type Hex } from '../core/hex';
import { pick } from '../world/terrain';
import type { createOverlay } from '../world/overlay';
import { canPlace, type Item } from '../items/index';
import type { ItemKind } from '../items/kinds';
import type { Kind } from '../tiles/kinds';
import * as state from '../game/state';

export type Selection = { type: 'tile'; kind: Kind } | { type: 'item'; kind: ItemKind };

export function setupPlacement(o: {
  canvas: HTMLElement; camera: THREE.Camera; overlay: ReturnType<typeof createOverlay>;
  getSelection: () => Selection | null; getErase: () => boolean;
  onPlaced: (sel: Selection) => void; onRejected: (sel: Selection) => void; onErased: (type: 'tile' | 'item', kind: string) => void;
}) {
  // 미리보기 고리: 놓을 수 있으면 초록, 없으면 빨강. 지우기 모드에선 지울 생물 위에 빨강
  const ghost = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthTest: false }));
  ghost.renderOrder = 11;
  ghost.visible = false;
  o.overlay.group.add(ghost);
  const showGhost = (p: THREE.Vector3, ok: boolean) => {
    ghost.visible = true;
    ghost.position.set(p.x, p.y + 0.02, p.z);
    (ghost.material as THREE.MeshBasicMaterial).color.set(ok ? 0x5cff7a : 0xff5050);
  };

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pointAt(e: PointerEvent) {
    ndc.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
    ray.setFromCamera(ndc, o.camera);
    return pick(ray.ray);
  }
  // 커서 아래 생물: 모델에 직접 맞으면 그것, 아니면 바닥 지점 근처(터치용)
  function itemUnder(p: THREE.Vector3): Item | undefined {
    const hit = ray.intersectObjects(state.items.map(i => i.obj), true)[0];
    if (hit) { let obj: THREE.Object3D | null = hit.object; while (obj && !state.items.some(i => i.obj === obj)) obj = obj.parent; if (obj) return state.items.find(i => i.obj === obj); }
    return state.nearestItem(p.x, p.z, 0.45);
  }
  type Hover = { hex?: Hex; p?: THREE.Vector3; item?: Item; ok: boolean };
  function hover(e: PointerEvent): Hover {
    const p = pointAt(e);
    if (!p) { clear(); return { ok: false }; }
    if (o.getErase()) {
      const item = itemUnder(p), hex = fromWorld(p.x, p.z), cell = !item && state.cellAt(hex);
      if (item) showGhost(item.obj.position, false); else ghost.visible = false;
      o.overlay.hover(cell ? hex : undefined, false);
      return { hex, p, item, ok: !!(item || cell) };
    }
    const sel = o.getSelection();
    if (!sel) { clear(); return { ok: false }; }
    if (sel.type === 'tile') {
      const hex = fromWorld(p.x, p.z), ok = state.canPlaceTile(sel.kind, hex);
      o.overlay.hover(hex, ok);
      return { hex, ok };
    }
    const ok = canPlace(sel.kind, p.x, p.z);
    showGhost(p, ok);
    return { p, ok };
  }
  function clear() { ghost.visible = false; o.overlay.hover(undefined); }

  let down = { x: 0, y: 0 };
  o.canvas.addEventListener('pointermove', e => { if (o.getSelection() || o.getErase()) hover(e); });
  o.canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  o.canvas.addEventListener('pointerup', e => {
    if (e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 8) return;   // 드래그는 카메라 조작
    if (o.getErase()) {
      const h = hover(e);
      if (!h.ok) return;
      if (h.item) { state.removeItem(h.item); o.onErased('item', h.item.kind); }
      else { const kind = state.removeTile(h.hex!); if (kind) o.onErased('tile', kind); }
      clear();
      return;
    }
    const sel = o.getSelection();
    if (!sel) return;
    const h = hover(e);
    if (!h.ok) { o.onRejected(sel); return; }
    if (sel.type === 'tile') state.placeTile(h.hex!, sel.kind);
    else state.addItem(sel.kind, h.p!.x, h.p!.z);
    o.onPlaced(sel);
  });
  // 진단용: 화면 좌표에서 무엇이 잡히는지 (부작용 없음)
  function probe(clientX: number, clientY: number) {
    ndc.set(clientX / innerWidth * 2 - 1, -clientY / innerHeight * 2 + 1);
    ray.setFromCamera(ndc, o.camera);
    const p = pick(ray.ray);
    if (!p) return { p: null };
    const hit = ray.intersectObjects(state.items.map(i => i.obj), true)[0];
    return { p: [p.x, p.y, p.z], hit: hit ? [hit.point.x, hit.point.y, hit.point.z] : null, near: state.nearestItem(p.x, p.z, 0.45)?.kind, hex: fromWorld(p.x, p.z), cell: state.cellAt(fromWorld(p.x, p.z))?.kind };
  }
  return { clear, probe };
}
