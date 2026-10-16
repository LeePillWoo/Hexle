// 마우스 배치: 선택한 카드(타일/아이템)를 지형 위에 미리 보여 주고 클릭하면 놓는다
import * as THREE from 'three';
import { fromWorld, type Hex } from '../core/hex';
import { pick } from '../world/terrain';
import type { createOverlay } from '../world/overlay';
import { canPlace } from '../items/index';
import type { ItemKind } from '../items/kinds';
import type { Kind } from '../tiles/kinds';
import * as state from '../game/state';

export type Selection = { type: 'tile'; kind: Kind } | { type: 'item'; kind: ItemKind };

export function setupPlacement(o: {
  canvas: HTMLElement; camera: THREE.Camera; overlay: ReturnType<typeof createOverlay>;
  getSelection: () => Selection | null; onPlaced: (sel: Selection) => void; onRejected: (sel: Selection) => void;
}) {
  // 아이템 배치 미리보기 고리: 놓을 수 있으면 초록, 없으면 빨강
  const ghost = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 32).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthTest: false }));
  ghost.renderOrder = 11;
  ghost.visible = false;
  o.overlay.group.add(ghost);

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pointAt(e: PointerEvent) {
    ndc.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
    ray.setFromCamera(ndc, o.camera);
    return pick(ray.ray);
  }
  function hover(e: PointerEvent): { hex?: Hex; p?: THREE.Vector3; ok: boolean } {
    const sel = o.getSelection(), p = pointAt(e);
    if (!sel || !p) { clear(); return { ok: false }; }
    if (sel.type === 'tile') {
      const hex = fromWorld(p.x, p.z), ok = state.canPlaceTile(sel.kind, hex);
      o.overlay.hover(hex, ok);
      return { hex, ok };
    }
    const ok = canPlace(sel.kind, p.x, p.z);
    ghost.visible = true;
    ghost.position.set(p.x, p.y + 0.02, p.z);
    (ghost.material as THREE.MeshBasicMaterial).color.set(ok ? 0x5cff7a : 0xff5050);
    return { p, ok };
  }
  function clear() { ghost.visible = false; o.overlay.hover(undefined); }

  let down = { x: 0, y: 0 };
  o.canvas.addEventListener('pointermove', e => { if (o.getSelection()) hover(e); });
  o.canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  o.canvas.addEventListener('pointerup', e => {
    const sel = o.getSelection();
    if (!sel || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return;   // 드래그는 카메라 조작
    const h = hover(e);
    if (!h.ok) { o.onRejected(sel); return; }
    if (sel.type === 'tile') state.placeTile(h.hex!, sel.kind);
    else state.addItem(sel.kind, h.p!.x, h.p!.z);
    o.onPlaced(sel);
  });
  return { clear };
}
