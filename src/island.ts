// 타일 장식: 침엽수 숲, 바위, 캠프(텐트·모닥불·연기), 등대. 지형 높이(heightAt) 위에 올린다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R, SQ3, toWorld, type Hex } from './hex';
import { heightAt } from './terrain';

export type Kind = 'grass' | 'forest' | 'camp';

// 칸마다 시드 고정 난수 (같은 칸은 항상 같은 배치)
function rng(h: Hex) {
  let s = (h.q * 7919 + h.r * 104729 + 1e6) % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
// 칸 중심 기준 임의 위치 (가장자리 margin 만큼 안쪽)
function inHex(rnd: () => number, margin: number) {
  for (;;) {
    const x = rnd() * 2 - 1, z = (rnd() * 2 - 1) * R;
    const ax = Math.abs(x), az = Math.abs(z);
    if (Math.max(ax, ax * 0.5 + az * SQ3 / 2) < 1 - margin) return { x, z };
  }
}

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
function mesh(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, s = 1) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.scale.setScalar(s);
  o.castShadow = o.receiveShadow = true;
  return o;
}

const pineGeo = mergeGeometries([
  new THREE.ConeGeometry(0.30, 0.50, 7).translate(0, 0.40, 0),
  new THREE.ConeGeometry(0.23, 0.45, 7).translate(0, 0.65, 0),
  new THREE.ConeGeometry(0.14, 0.40, 7).translate(0, 0.90, 0),
]);
const pineMat = mat(0xffffff, { flatShading: true });
const rockGeo = new THREE.DodecahedronGeometry(1, 0);
const rockMat = mat(0x6d6a63, { flatShading: true });
const woodMat = mat(0x6b4a2b);
const tentGeo = new THREE.ConeGeometry(0.42, 0.5, 4).rotateY(Math.PI / 4);
const tentMat = mat(0x8a5a32, { flatShading: true });
const flameGeo = new THREE.ConeGeometry(0.06, 0.16, 6);
const flameMat = mat(0xff7a1a, { emissive: 0xff5a00, emissiveIntensity: 3 });
const logGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8).rotateZ(Math.PI / 2);

const PLATEAU = 0.42;   // 이 높이 아래(절벽·해변)에는 장식을 두지 않는다

function forest(h: Hex) {
  const rnd = rng(h), c = toWorld(h);
  const trees = new THREE.InstancedMesh(pineGeo, pineMat, 20);
  const m = new THREE.Matrix4(), col = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
  let n = 0;
  for (let i = 0; i < 20; i++) {
    const p = inHex(rnd, 0.05), x = c.x + p.x, z = c.z + p.z, s = 0.75 + rnd() * 0.5;
    const y = heightAt(x, z);
    if (y < PLATEAU) continue;
    m.compose(new THREE.Vector3(x, y - 0.03, z), new THREE.Quaternion().setFromAxisAngle(up, rnd() * 6),
      new THREE.Vector3(s, s * (0.9 + rnd() * 0.4), s));
    trees.setMatrixAt(n, m);
    trees.setColorAt(n++, col.setRGB(0.03 + rnd() * 0.03, 0.12 + rnd() * 0.08, 0.05 + rnd() * 0.03));
  }
  trees.count = n;
  trees.castShadow = trees.receiveShadow = true;
  return trees;
}

function rocks(h: Hex, count: number) {
  const rnd = rng(h), c = toWorld(h), g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const p = inHex(rnd, 0.1), x = c.x + p.x, z = c.z + p.z, s = 0.04 + rnd() * 0.06, y = heightAt(x, z);
    if (y >= PLATEAU) g.add(mesh(rockGeo, rockMat, x, y + s * 0.2, z, s).rotateY(rnd() * 6));
  }
  return g;
}

// 연기 스프라이트 텍스처
const smokeTex = (() => {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d')!;
  const gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();

function camp(h: Hex) {
  const c = toWorld(h), g = new THREE.Group();
  const y = (dx: number, dz: number) => heightAt(c.x + dx, c.z + dz);
  g.add(mesh(tentGeo, tentMat, c.x - 0.25, y(-0.25, -0.3) + 0.22, c.z - 0.3));
  const fx = c.x + 0.3, fz = c.z + 0.25, fy = y(0.3, 0.25);
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    g.add(mesh(rockGeo, rockMat, fx + Math.cos(a) * 0.14, fy + 0.02, fz + Math.sin(a) * 0.14, 0.045));
  }
  g.add(mesh(flameGeo, flameMat, fx, fy + 0.08, fz));
  const fire = new THREE.PointLight(0xff8a3a, 1.5, 2.5);
  fire.position.set(fx, fy + 0.3, fz);
  g.add(fire);
  g.add(mesh(logGeo, woodMat, fx + 0.05, fy + 0.05, fz + 0.3));
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), woodMat, c.x - 0.55, y(-0.55, 0.05) + 0.07, c.z + 0.05));

  const puffs: THREE.Sprite[] = [];
  for (let i = 0; i < 14; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xdddddd, depthWrite: false, transparent: true }));
    sp.userData.phase = i / 14;
    puffs.push(sp);
    g.add(sp);
  }
  g.userData.update = (t: number) => {
    for (const sp of puffs) {
      const k = (t * 0.18 + sp.userData.phase) % 1;
      sp.position.set(fx + Math.sin(k * 3 + sp.userData.phase * 9) * 0.08 + k * 0.4, fy + 0.15 + k * 2.4, fz - k * 0.2);
      sp.scale.setScalar(0.15 + k * 0.9);
      (sp.material as THREE.SpriteMaterial).opacity = Math.sin(k * Math.PI) * 0.35;
    }
  };
  return g;
}

export function decorate(h: Hex, kind: Kind): THREE.Object3D {
  if (kind === 'forest') return forest(h);
  if (kind === 'camp') return camp(h);
  return rocks(h, 6);
}

export function lighthouse(x: number, z: number) {
  const g = new THREE.Group(), y = heightAt(x, z);
  const base = mesh(new THREE.IcosahedronGeometry(0.45, 1), mat(0x4a4540, { flatShading: true }), x, y - 0.05, z);
  base.scale.set(1, 0.6, 0.9);
  g.add(base);
  const white = mat(0xeeeae2), red = mat(0xb3261e), b = y + 0.15;
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.28, 1.4, 16), white, x, b + 0.7, z));
  for (const k of [0, 0.5]) g.add(mesh(new THREE.CylinderGeometry(0.255 - k * 0.08, 0.27 - k * 0.08, 0.22, 16), red, x, b + 0.3 + k, z));
  g.add(mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 16), mat(0x2a2a2a), x, b + 1.42, z));
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.2, 12), mat(0xffe08a, { emissive: 0xffc040, emissiveIntensity: 2 }), x, b + 1.55, z));
  g.add(mesh(new THREE.ConeGeometry(0.2, 0.25, 16), red, x, b + 1.77, z));
  return g;
}
