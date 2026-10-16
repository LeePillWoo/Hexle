// 시스템 오버레이: 육각 그리드(라인), 영역 경계선, 배치 가능한 칸. 지형과 별개로 켜고 끈다.
import * as THREE from 'three';
import { corners, fromWorld, key, neighbors, toWorld, type Hex } from './hex';
import { heightAt } from './terrain';

const lineMat = (color: number, opacity: number) =>
  new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: false });
const candMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3, depthTest: false });
const hoverMat = new THREE.MeshBasicMaterial({ color: 0xfff1a8, transparent: true, opacity: 0.55, depthTest: false });
const hexFill = new THREE.CircleGeometry(0.94 * 2 / Math.sqrt(3), 6).rotateX(-Math.PI / 2).rotateY(Math.PI / 2);

// 지형 표면 살짝 위 (물 위면 수면)
const surf = (x: number, z: number) => new THREE.Vector3(x, Math.max(0, heightAt(x, z)) + 0.03, z);

export function createOverlay() {
  const grid = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(0xffffff, 0.45));
  const edge = new THREE.LineSegments(new THREE.BufferGeometry(), lineMat(0xffa630, 0.95));
  const cands = new THREE.Group();
  for (const o of [grid, edge, cands]) o.renderOrder = 10;
  const group = new THREE.Group().add(grid, edge, cands);
  cands.visible = false;
  let hovered: THREE.Mesh | undefined;

  function rebuild(land: Hex[]) {
    const owned = new Set(land.map(key));
    // 그리드: 육지에서 2칸 이내
    const near = new Map<string, Hex>();
    for (const h of land) for (const a of [h, ...neighbors(h)]) for (const b of [a, ...neighbors(a)]) near.set(key(b), b);
    const gp: THREE.Vector3[] = [], ep: THREE.Vector3[] = [];
    for (const h of near.values()) {
      const c = toWorld(h), cs = corners(c.x, c.z);
      for (let i = 0; i < 6; i++) {
        const a = cs[i], b = cs[(i + 1) % 6];
        gp.push(surf(a.x, a.z), surf(b.x, b.z));
        // 경계선: 육지 칸의 변 중 건너편이 바다인 변
        const across = fromWorld(2 * (a.x + b.x) / 2 - c.x, 2 * (a.z + b.z) / 2 - c.z);
        if (owned.has(key(h)) && !owned.has(key(across))) ep.push(surf(a.x, a.z), surf(b.x, b.z));
      }
    }
    grid.geometry.dispose();
    grid.geometry = new THREE.BufferGeometry().setFromPoints(gp);
    edge.geometry.dispose();
    edge.geometry = new THREE.BufferGeometry().setFromPoints(ep);

    // 배치 가능한 칸 = 육지에 붙은 빈 칸
    cands.clear();
    hovered = undefined;
    const seen = new Set<string>();
    for (const h of land) for (const n of neighbors(h)) {
      const k = key(n);
      if (owned.has(k) || seen.has(k)) continue;
      seen.add(k);
      const c = toWorld(n), m = new THREE.Mesh(hexFill, candMat);
      m.position.set(c.x, 0.03, c.z);
      m.userData.hex = n;
      m.renderOrder = 10;
      cands.add(m);
    }
  }

  // 마우스 아래 후보 칸을 강조하고 그 칸을 돌려준다 (후보가 아니면 undefined)
  function hover(h: Hex | undefined): Hex | undefined {
    if (hovered) hovered.material = candMat;
    hovered = h && (cands.children as THREE.Mesh[]).find(m => key(m.userData.hex) === key(h));
    if (hovered) hovered.material = hoverMat;
    return hovered?.userData.hex;
  }

  return { group, grid, edge, cands, rebuild, hover };
}
