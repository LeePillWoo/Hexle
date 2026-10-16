// 시스템 오버레이: 육각 그리드(라인), 영역 경계선(육지 주황·바닷속 하늘색), 붙일 수 있는 칸, 마우스 아래 칸. 지형과 별개로 켜고 끈다.
import * as THREE from 'three';
import { corners, fromWorld, key, neighbors, toWorld, type Hex } from '../core/hex';
import { isSeaKind, type Cell } from '../tiles/kinds';
import { surfaceAt } from './terrain';

const lineMat = (color: number, opacity: number) =>
  new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
const candMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthTest: false });
const okMat = new THREE.MeshBasicMaterial({ color: 0xb8ff9a, transparent: true, opacity: 0.55, depthTest: false });
const badMat = new THREE.MeshBasicMaterial({ color: 0xff6a6a, transparent: true, opacity: 0.45, depthTest: false });
const hexFill = new THREE.CircleGeometry(0.94 * 2 / Math.sqrt(3), 6).rotateX(-Math.PI / 2).rotateY(Math.PI / 2);

// 표면 살짝 위 (물 위면 수면)
const surf = (x: number, z: number) => { const s = surfaceAt(x, z); return new THREE.Vector3(x, Math.max(s.water, s.h) + 0.03, z); };

export function createOverlay() {
  const grid = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(0xffffff, 0.45));
  const edge = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(0xffa630, 0.95));
  const seaEdge = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(0x6ae8ff, 0.9));
  const cands = new THREE.Group();
  const hoverMesh = new THREE.Mesh(hexFill, okMat);
  for (const o of [grid, edge, seaEdge, cands, hoverMesh]) o.renderOrder = 10;
  const group = new THREE.Group().add(grid, edge, seaEdge, cands, hoverMesh);
  cands.visible = hoverMesh.visible = false;

  function rebuild(cells: Cell[]) {
    const owned = new Map(cells.map(c => [key(c.hex), c.kind]));
    // 그리드: 영역에서 2칸 이내
    const near = new Map<string, Hex>();
    for (const c of cells) for (const a of [c.hex, ...neighbors(c.hex)]) for (const b of [a, ...neighbors(a)]) near.set(key(b), b);
    const gp: THREE.Vector3[] = [], ep: THREE.Vector3[] = [], sp: THREE.Vector3[] = [];
    for (const h of near.values()) {
      const c = toWorld(h), cs = corners(c.x, c.z), mine = owned.get(key(h));
      for (let i = 0; i < 6; i++) {
        const a = cs[i], b = cs[(i + 1) % 6];
        gp.push(surf(a.x, a.z), surf(b.x, b.z));
        if (!mine) continue;
        // 경계선: 영역 칸의 변 중 건너편이 다른 영역(육지↔바다↔빈 칸)인 변
        const across = owned.get(key(fromWorld(a.x + b.x - c.x, a.z + b.z - c.z)));
        const sea = isSeaKind(mine);
        if (across === undefined || isSeaKind(across) !== sea) (sea ? sp : ep).push(surf(a.x, a.z), surf(b.x, b.z));
      }
    }
    for (const [l, pts] of [[grid, gp], [edge, ep], [seaEdge, sp]] as const) { l.geometry.dispose(); l.geometry = new THREE.BufferGeometry().setFromPoints(pts); }

    // 붙일 수 있는 칸 = 육지에 붙은 빈 칸
    cands.clear();
    const seen = new Set<string>();
    for (const c of cells) {
      if (isSeaKind(c.kind)) continue;
      for (const n of neighbors(c.hex)) {
        const k = key(n);
        if (owned.has(k) || seen.has(k)) continue;
        seen.add(k);
        const w = toWorld(n), m = new THREE.Mesh(hexFill, candMat);
        m.position.set(w.x, Math.max(0, surfaceAt(w.x, w.z).water) + 0.03, w.z);
        m.renderOrder = 10;
        cands.add(m);
      }
    }
  }

  // 마우스 아래 칸을 초록(놓을 수 있음)/빨강(없음)으로 표시
  function hover(h: Hex | undefined, ok = false) {
    hoverMesh.visible = !!h;
    if (!h) return;
    const w = toWorld(h), s = surfaceAt(w.x, w.z);
    hoverMesh.position.set(w.x, Math.max(s.water, s.h) + 0.035, w.z);
    hoverMesh.material = ok ? okMat : badMat;
  }

  return { group, grid, edge, seaEdge, cands, rebuild, hover };
}
