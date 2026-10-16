// 타일 장식: 종류별 소품을 지형 높이 위에 올린다. 지오메트리·재질은 공유해서 재생성 비용을 줄인다.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R, SQ3, toWorld, type Hex } from './hex';
import { heightFast, type Kind } from './terrain';

export const TILE_INFO: Record<Kind, { name: string; icon: string }> = {
  camp: { name: '캠프', icon: '⛺' },
  grass: { name: '초원', icon: '🌿' },
  forest: { name: '숲', icon: '🌲' },
  mountain: { name: '산', icon: '⛰️' },
  beach: { name: '모래사장', icon: '🏖️' },
  farm: { name: '밭', icon: '🌾' },
  flower: { name: '꽃밭', icon: '🌷' },
  house: { name: '집', icon: '🏠' },
};
export const TILE_KINDS = (Object.keys(TILE_INFO) as Kind[]).filter(k => k !== 'camp');

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
  new THREE.MeshStandardMaterial({ color, roughness: 0.85, ...extra });
function mesh(g: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, s = 1) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.scale.setScalar(s);
  o.castShadow = o.receiveShadow = true;
  return o;
}
// 흩뿌리기: 칸 안 임의 위치 중 평지(물 위, 경사 완만)만 골라 InstancedMesh 로
const up = new THREE.Vector3(0, 1, 0);
function scatter(h: Hex, geo: THREE.BufferGeometry, m: THREE.Material, count: number, margin: number,
                 size: (r: () => number) => number, color?: (r: () => number) => THREE.Color) {
  const rnd = rng(h), c = toWorld(h), inst = new THREE.InstancedMesh(geo, m, count), mx = new THREE.Matrix4();
  let n = 0;
  for (let i = 0; i < count; i++) {
    const p = inHex(rnd, margin), x = c.x + p.x, z = c.z + p.z, s = size(rnd), y = heightFast(x, z);
    if (y < 0.4 || Math.abs(heightFast(x + 0.1, z) - heightFast(x - 0.1, z)) > 0.12) continue;
    mx.compose(new THREE.Vector3(x, y - 0.02, z), new THREE.Quaternion().setFromAxisAngle(up, rnd() * 6), new THREE.Vector3(s, s, s));
    inst.setMatrixAt(n, mx);
    if (color) inst.setColorAt(n, color(rnd));
    n++;
  }
  inst.count = n;
  inst.castShadow = inst.receiveShadow = true;
  return inst;
}

const pineGeo = mergeGeometries([
  new THREE.ConeGeometry(0.30, 0.50, 7).translate(0, 0.40, 0),
  new THREE.ConeGeometry(0.23, 0.45, 7).translate(0, 0.65, 0),
  new THREE.ConeGeometry(0.14, 0.40, 7).translate(0, 0.90, 0),
]);
const pineMat = mat(0xffffff, { flatShading: true });
const rockGeo = new THREE.DodecahedronGeometry(1, 0);
const rockMat = mat(0x9a968c, { flatShading: true });
const woodMat = mat(0x7a5432);
const tentGeo = new THREE.ConeGeometry(0.42, 0.5, 4).rotateY(Math.PI / 4);
const tentMat = mat(0xc07a3e, { flatShading: true });
const flameGeo = new THREE.ConeGeometry(0.06, 0.16, 6);
const flameMat = mat(0xff7a1a, { emissive: 0xff5a00, emissiveIntensity: 3 });
const logGeo = new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8).rotateZ(Math.PI / 2);
const crateGeo = new THREE.BoxGeometry(0.16, 0.14, 0.16);
// 밭
const soilGeo = new THREE.BoxGeometry(1.25, 0.04, 1.05);
const soilMat = mat(0x8a5f3a);
const cropGeo = new THREE.BoxGeometry(1.1, 0.09, 0.12);
const cropMats = [mat(0x7cbc4a), mat(0xe2bf55)];
// 꽃
const flowerGeo = new THREE.IcosahedronGeometry(0.035, 0);
const flowerMat = mat(0xffffff, { flatShading: true });
const FLOWER_COLORS = [0xff7eb3, 0xffd84d, 0xffffff, 0xb784ff, 0xff5a5a].map(c => new THREE.Color(c));
// 집
const wallGeo = new THREE.BoxGeometry(0.44, 0.3, 0.36);
const wallMat = mat(0xf2e6c8);
// 삼각기둥: 축을 x 로 눕힌 뒤 꼭짓점 하나가 위(+y)를 향하게
const roofGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.52, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
const roofMat = mat(0xc0563f, { flatShading: true });
const chimneyGeo = new THREE.BoxGeometry(0.07, 0.18, 0.07);
const doorGeo = new THREE.BoxGeometry(0.1, 0.16, 0.01);
// 야자수
const trunkGeo = new THREE.CylinderGeometry(0.025, 0.04, 0.7, 6).translate(0, 0.35, 0);
const leafGeo = new THREE.ConeGeometry(0.07, 0.42, 4).rotateZ(-Math.PI / 2).translate(0.2, 0, 0).scale(1, 0.25, 1);
const leafMat = mat(0x3f9a3a, { flatShading: true, side: THREE.DoubleSide });

const PLATEAU = 0.4;

function camp(h: Hex) {
  const c = toWorld(h), g = new THREE.Group();
  const y = (dx: number, dz: number) => heightFast(c.x + dx, c.z + dz);
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
  g.add(mesh(crateGeo, woodMat, c.x - 0.55, y(-0.55, 0.05) + 0.07, c.z + 0.05));

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

function farm(h: Hex) {
  const c = toWorld(h), y = heightFast(c.x, c.z), g = new THREE.Group();
  if (y < PLATEAU) return g;
  g.add(mesh(soilGeo, soilMat, c.x, y, c.z));
  for (let i = 0; i < 5; i++) g.add(mesh(cropGeo, cropMats[i % 2], c.x, y + 0.06, c.z - 0.4 + i * 0.2));
  return g;
}

function house(h: Hex) {
  const c = toWorld(h), y = heightFast(c.x, c.z), g = new THREE.Group();
  g.add(mesh(wallGeo, wallMat, c.x, y + 0.15, c.z));
  g.add(mesh(roofGeo, roofMat, c.x, y + 0.45, c.z));   // 지붕 밑변(중심 -0.15)이 벽 위(0.3)에 닿게
  g.add(mesh(chimneyGeo, wallMat, c.x + 0.12, y + 0.5, c.z - 0.06));
  g.add(mesh(doorGeo, woodMat, c.x, y + 0.08, c.z + 0.181));
  g.add(scatter(h, crateGeo, woodMat, 3, 0.25, r => 0.6 + r() * 0.4));
  return g;
}

function palms(h: Hex) {
  const rnd = rng(h), c = toWorld(h), g = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const p = inHex(rnd, 0.25), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
    if (y < 0.08) continue;
    const palm = new THREE.Group();
    palm.add(mesh(trunkGeo, woodMat, 0, 0, 0).rotateZ(0.15));
    for (let k = 0; k < 6; k++) palm.add(mesh(leafGeo, leafMat, 0.1, 0.68, 0).rotateY(k * Math.PI / 3 + rnd()).rotateZ(-0.35));
    palm.position.set(x, y, z);
    palm.rotation.y = rnd() * 6;
    palm.scale.setScalar(0.8 + rnd() * 0.4);
    g.add(palm);
  }
  return g;
}

export function decorate(h: Hex, kind: Kind): THREE.Object3D {
  switch (kind) {
    case 'camp': return camp(h);
    case 'forest': return scatter(h, pineGeo, pineMat, 20, 0.05, r => 0.75 + r() * 0.5,
      r => new THREE.Color(0.04 + r() * 0.03, 0.2 + r() * 0.08, 0.07 + r() * 0.03));
    case 'mountain': return scatter(h, rockGeo, rockMat, 8, 0.1, r => 0.05 + r() * 0.08);
    case 'beach': return palms(h);
    case 'farm': return farm(h);
    case 'flower': return scatter(h, flowerGeo, flowerMat, 70, 0.08, r => 0.8 + r() * 0.6,
      r => FLOWER_COLORS[Math.floor(r() * FLOWER_COLORS.length)]);
    case 'house': return house(h);
    default: return scatter(h, rockGeo, rockMat, 5, 0.1, r => 0.04 + r() * 0.05);
  }
}

// 장식을 갈아끼울 때 개별 자원 해제 (공유 지오메트리·재질은 그대로)
export function disposeDecor(o: THREE.Object3D) {
  o.traverse(c => {
    if (c instanceof THREE.Sprite) c.material.dispose();
    if (c instanceof THREE.InstancedMesh) c.dispose();
  });
}

export function lighthouse(x: number, z: number) {
  const g = new THREE.Group(), y = heightFast(x, z);
  const base = mesh(new THREE.IcosahedronGeometry(0.45, 1), mat(0x6a655e, { flatShading: true }), x, y - 0.05, z);
  base.scale.set(1, 0.6, 0.9);
  g.add(base);
  const white = mat(0xf2eee6), red = mat(0xc0322a), b = y + 0.15;
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.28, 1.4, 16), white, x, b + 0.7, z));
  for (const k of [0, 0.5]) g.add(mesh(new THREE.CylinderGeometry(0.255 - k * 0.08, 0.27 - k * 0.08, 0.22, 16), red, x, b + 0.3 + k, z));
  g.add(mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 16), mat(0x2a2a2a), x, b + 1.42, z));
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.2, 12), mat(0xffe08a, { emissive: 0xffc040, emissiveIntensity: 2 }), x, b + 1.55, z));
  g.add(mesh(new THREE.ConeGeometry(0.2, 0.25, 16), red, x, b + 1.77, z));
  return g;
}
