// 섬: 코드로 만드는 hex 타일(풀 윗면 + 바위 절벽)과 장식(침엽수, 캠프, 부두, 등대)
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { sea, SEA_GLSL } from './ocean';

const R = 2 / Math.sqrt(3);            // pointy-top 외접원 반지름 (폭 2)
export const TOP = 0.8, BOTTOM = -0.8;
export const hexPos = (q: number, r: number) => new THREE.Vector2(2 * (q + r / 2), Math.sqrt(3) * r);

// 시드 고정 난수 (새로고침해도 같은 섬)
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;

// 절벽 울퉁불퉁: 월드 좌표 기준이라 이웃 타일과 이음새가 맞는다
const bump = (x: number, y: number, z: number) =>
  0.07 * Math.sin(x * 5.1 + y * 3.7) * Math.sin(z * 4.3 - y * 6.1) + 0.035 * Math.sin(x * 11 + z * 13 + y * 9);

function tileGeometry(c: THREE.Vector2) {
  const C = 6, V = 8, pos: number[] = [], idx: number[] = [];
  const corner = (i: number) => new THREE.Vector2(R * Math.sin(i * Math.PI / 3), R * Math.cos(i * Math.PI / 3));
  const rim: number[] = [];
  for (let f = 0; f < 6; f++) {
    const a = corner(f), b = corner(f + 1), start = pos.length / 3;
    for (let v = 0; v <= V; v++) for (let u = 0; u <= C; u++) {
      const p = a.clone().lerp(b, u / C), y = TOP + (BOTTOM - TOP) * v / V;
      const k = bump(p.x + c.x, y, p.y + c.y) * (v === 0 ? 0 : 1);   // 윗줄은 곧게: 이웃 타일과 틈이 안 생기게
      const dir = p.clone().normalize();
      pos.push(c.x + p.x + dir.x * k, y, c.y + p.y + dir.y * k);
      if (v === 0 && u < C) rim.push(...pos.slice(-3));
    }
    for (let v = 0; v < V; v++) for (let u = 0; u < C; u++) {
      const a0 = start + v * (C + 1) + u, b0 = a0 + 1, c0 = a0 + C + 1, d0 = c0 + 1;
      idx.push(a0, c0, b0, b0, c0, d0);
    }
  }
  // 윗면: 중심에서 테두리로 부채꼴 (테두리 정점은 절벽 윗줄과 같은 위치)
  const center = pos.length / 3, n = rim.length / 3;
  pos.push(c.x, TOP, c.y, ...rim);
  for (let k = 0; k < n; k++) idx.push(center, center + 1 + k, center + 1 + (k + 1) % n);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// 타일 재질: 윗면은 풀, 옆면은 바위. 무늬는 월드 좌표 노이즈, 물에 잠긴 곳엔 코스틱
const tileMat = new THREE.MeshStandardMaterial({ roughness: 0.95 });
tileMat.onBeforeCompile = s => {
  Object.assign(s.uniforms, sea);
  const head = 'uniform float time;\n' + SEA_GLSL + 'varying vec3 vW;\nvarying vec3 vN;\n';
  s.vertexShader = head + s.vertexShader.replace('#include <begin_vertex>',
    '#include <begin_vertex>\nvW = (modelMatrix * vec4(position, 1.0)).xyz;\nvN = normalize(mat3(modelMatrix) * normal);');
  s.fragmentShader = head + s.fragmentShader
    .replace('#include <color_fragment>', `
      vec3 grass = mix(vec3(0.025, 0.09, 0.01), vec3(0.13, 0.27, 0.04), fbm(vW.xz * 3.0));
      grass = mix(grass, vec3(0.2, 0.3, 0.07), smoothstep(0.68, 0.78, fbm(vW.xz * 7.0)) * 0.6);
      grass *= 0.75 + 0.5 * vnoise(vW.xz * 40.0);   // 잔디결
      vec3 rock = mix(vec3(0.09, 0.06, 0.035), vec3(0.28, 0.2, 0.13), fbm(vec2(vW.x + vW.z, vW.y) * vec2(3.0, 6.0)));
      rock *= mix(0.45, 1.0, smoothstep(-0.2, 0.5, vW.y));   // 물가는 젖어서 어둡게
      diffuseColor.rgb = absorb(mix(rock, grass, smoothstep(0.55, 0.75, vN.y)), vW.y);`)
    .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += underwaterLight(vW, time) * diffuseColor.rgb * 2.0;');
};

const mat = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) =>
  new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
function mesh(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0, s = 1) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.scale.setScalar(s);
  o.castShadow = o.receiveShadow = true;
  return o;
}
// 타일 안쪽 임의 위치 (중심 기준, 가장자리 margin 만큼 띄움)
function inHex(margin: number) {
  for (;;) {
    const x = (rnd() * 2 - 1), z = (rnd() * 2 - 1) * R;
    const ax = Math.abs(x), az = Math.abs(z);
    if (Math.max(ax, ax * 0.5 + az * 0.866) < 1 - margin) return new THREE.Vector2(x, z);
  }
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

function forest(c: THREE.Vector2) {
  const trees = new THREE.InstancedMesh(pineGeo, pineMat, 18);
  const m = new THREE.Matrix4(), col = new THREE.Color();
  for (let i = 0; i < 18; i++) {
    const p = inHex(0.12), s = 0.75 + rnd() * 0.5;
    m.compose(new THREE.Vector3(c.x + p.x, TOP, c.y + p.y),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * 6), new THREE.Vector3(s, s * (0.9 + rnd() * 0.4), s));
    trees.setMatrixAt(i, m);
    trees.setColorAt(i, col.setRGB(0.03 + rnd() * 0.03, 0.12 + rnd() * 0.08, 0.05 + rnd() * 0.03));
  }
  trees.castShadow = trees.receiveShadow = true;
  return trees;
}

function rocks(c: THREE.Vector2, count: number) {
  const g = new THREE.Group();
  for (let i = 0; i < count; i++) {
    const p = inHex(0.1), s = 0.04 + rnd() * 0.06;
    g.add(mesh(rockGeo, rockMat, c.x + p.x, TOP + s * 0.3, c.y + p.y, s).rotateY(rnd() * 6));
  }
  return g;
}

// 연기: 스프라이트가 올라가며 커지고 흐려진다
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

function camp(c: THREE.Vector2) {
  const g = new THREE.Group();
  const dirt = new THREE.Mesh(new THREE.CircleGeometry(0.62, 24).rotateX(-Math.PI / 2), mat(0x5a4128, { polygonOffset: true, polygonOffsetFactor: -1 }));
  dirt.position.set(c.x + 0.1, TOP + 0.002, c.y + 0.05);
  dirt.receiveShadow = true;
  g.add(dirt);
  g.add(mesh(new THREE.ConeGeometry(0.42, 0.5, 4).rotateY(Math.PI / 4), mat(0x8a5a32, { flatShading: true }), c.x - 0.25, TOP + 0.25, c.y - 0.3));
  // 모닥불
  const fx = c.x + 0.3, fz = c.y + 0.25;
  for (let i = 0; i < 7; i++) {
    const a = i / 7 * Math.PI * 2;
    g.add(mesh(rockGeo, rockMat, fx + Math.cos(a) * 0.14, TOP + 0.02, fz + Math.sin(a) * 0.14, 0.045));
  }
  g.add(mesh(new THREE.ConeGeometry(0.06, 0.16, 6), mat(0xff7a1a, { emissive: 0xff5a00, emissiveIntensity: 3 }), fx, TOP + 0.08, fz));
  const fire = new THREE.PointLight(0xff8a3a, 1.5, 2.5);
  fire.position.set(fx, TOP + 0.3, fz);
  g.add(fire);
  // 통나무 의자, 상자
  g.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8).rotateZ(Math.PI / 2), woodMat, fx + 0.05, TOP + 0.05, fz + 0.3));
  g.add(mesh(new THREE.BoxGeometry(0.16, 0.14, 0.16), woodMat, c.x - 0.55, TOP + 0.07, c.y + 0.05));

  const puffs: THREE.Sprite[] = [];
  for (let i = 0; i < 14; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xdddddd, depthWrite: false, transparent: true }));
    sp.userData.phase = i / 14;
    puffs.push(sp);
    g.add(sp);
  }
  const update = (t: number) => {
    for (const sp of puffs) {
      const k = (t * 0.18 + sp.userData.phase) % 1;
      sp.position.set(fx + Math.sin(k * 3 + sp.userData.phase * 9) * 0.08 + k * 0.4, TOP + 0.15 + k * 2.4, fz - k * 0.2);
      sp.scale.setScalar(0.15 + k * 0.9);
      (sp.material as THREE.SpriteMaterial).opacity = Math.sin(k * Math.PI) * 0.35;
    }
  };
  return { group: g, update };
}

function dock(x: number, z: number) {
  const g = new THREE.Group();
  for (let i = 0; i < 6; i++) g.add(mesh(new THREE.BoxGeometry(0.15, 0.05, 1.0), woodMat, x - 0.4 + i * 0.16, 0.2, z));
  for (const [dx, dz] of [[-0.42, -0.45], [0.42, -0.45], [-0.42, 0.45], [0.42, 0.45]])
    g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 1.2, 6), woodMat, x + dx, -0.35, z + dz));
  return g;
}

function lighthouse(x: number, z: number) {
  const g = new THREE.Group();
  const base = mesh(new THREE.IcosahedronGeometry(0.8, 1), mat(0x4a4540, { flatShading: true }), x, -0.1, z);
  base.scale.set(1, 0.55, 0.9);
  g.add(base);
  const white = mat(0xeeeae2), red = mat(0xb3261e);
  g.add(mesh(new THREE.CylinderGeometry(0.2, 0.28, 1.4, 16), white, x, 0.95, z));
  for (const y of [0.55, 1.05]) g.add(mesh(new THREE.CylinderGeometry(0.255 - (y - 0.55) * 0.08, 0.27 - (y - 0.55) * 0.08, 0.22, 16), red, x, y, z));
  g.add(mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.05, 16), mat(0x2a2a2a), x, 1.67, z));
  g.add(mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.2, 12), mat(0xffe08a, { emissive: 0xffc040, emissiveIntensity: 2 }), x, 1.8, z));
  g.add(mesh(new THREE.ConeGeometry(0.2, 0.25, 16), red, x, 2.02, z));
  return g;
}

export type Tile = { q: number; r: number; kind: 'grass' | 'forest' | 'camp' };

export function buildIsland(tiles: Tile[]) {
  const group = new THREE.Group();
  const centers = tiles.map(t => hexPos(t.q, t.r));
  const updates: ((t: number) => void)[] = [];
  tiles.forEach((t, i) => {
    const c = centers[i];
    group.add(mesh(tileGeometry(c), tileMat));
    if (t.kind === 'forest') group.add(forest(c));
    if (t.kind === 'grass') group.add(rocks(c, 6));
    if (t.kind === 'camp') { const cp = camp(c); group.add(cp.group); updates.push(cp.update); }
  });
  return { group, centers, update: (t: number) => updates.forEach(u => u(t)) };
}

export { dock, lighthouse };
