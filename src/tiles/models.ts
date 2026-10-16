// 장식 공용 도우미: 정점 색 칠하기·합치기, 재질, 인스턴스 묶음, 칸 안 배치, 떠오르는 입자
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { R, SQ3, type Hex } from '../core/hex';
import { heightFast, shared } from '../world/terrain';
import type { Kind } from './kinds';

export type Ctx = { kindAt: (h: Hex) => Kind | undefined; g: THREE.Group; updates: ((t: number) => void)[] };

// ── 지오메트리 ──
export function paint(g: THREE.BufferGeometry, color: number) {
  const ng = g.index ? g.toNonIndexed() : g, c = new THREE.Color(color), n = ng.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return ng;
}
export const merge = (...gs: THREE.BufferGeometry[]) => mergeGeometries(gs)!;
export const prism = (r: number, len: number) => new THREE.CylinderGeometry(r, r, len, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
// 울퉁불퉁한 돌: 같은 위치의 정점은 같은 만큼 밀어서 틈이 안 생기게
export function lumpy(g: THREE.BufferGeometry, amt: number) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + amt * Math.sin(x * 12.9 + y * 78.2 + z * 37.7);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

// ── 재질 ──
export const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
export const vcFlat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
export const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });   // 빛나는 부품: 조명 무시
// 물결에 흔들리는 해초·켈프: 높이(position.y)의 제곱에 비례해 끝이 더 많이 흔들린다
export const swayMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide });
swayMat.onBeforeCompile = s => {
  s.uniforms.time = shared.time;
  s.vertexShader = 'uniform float time;\n' + s.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
    vec4 wp4 = vec4(position, 1.0);
    #ifdef USE_INSTANCING
    wp4 = instanceMatrix * wp4;
    #endif
    vec3 wp = (modelMatrix * wp4).xyz;
    float k = max(0.0, position.y);
    transformed.x += (sin(time * 1.1 + wp.z * 1.3 + wp.x * 0.7) * 0.2 + sin(time * 2.3 + wp.x * 2.0) * 0.05) * k * k;
    transformed.z += cos(time * 0.8 + wp.x * 1.1 - wp.z * 0.5) * 0.14 * k * k;`);
};

// ── 배치 ──
export function placed(g: THREE.BufferGeometry, x: number, y: number, z: number, s = 1, rotY = 0, m: THREE.Material = vc) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.scale.setScalar(s);
  o.rotation.y = rotY;
  o.castShadow = o.receiveShadow = true;
  return o;
}
// 인스턴스 묶음: push 로 쌓고 build 로 InstancedMesh 하나로
export function batch(geo: THREE.BufferGeometry, m: THREE.Material = vc) {
  const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  return {
    push(x: number, y: number, z: number, s: THREE.Vector3 | number, rotY = 0, color?: THREE.Color | number) {
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.clone().setFromAxisAngle(up, rotY),
        typeof s === 'number' ? new THREE.Vector3(s, s, s) : s));
      cols.push(color instanceof THREE.Color ? color : new THREE.Color(color ?? 0xffffff));
    },
    build() {
      const inst = new THREE.InstancedMesh(geo, m, Math.max(1, mats.length));
      mats.forEach((mx, i) => { inst.setMatrixAt(i, mx); inst.setColorAt(i, cols[i]); });
      inst.count = mats.length;
      inst.castShadow = inst.receiveShadow = true;
      return inst;
    },
  };
}
// 칸 중심 기준 임의 위치. margin 이 음수면 칸 밖으로 조금 넘쳐 이웃 칸까지 (같은 종류 이음새를 메울 때)
export function inHex(rnd: () => number, margin: number) {
  for (;;) {
    const x = rnd() * 2 - 1, z = (rnd() * 2 - 1) * R;
    const ax = Math.abs(x), az = Math.abs(z);
    if (Math.max(ax, ax * 0.5 + az * SQ3 / 2) < 1 - margin) return { x, z };
  }
}
export const slope = (x: number, z: number) =>
  Math.max(Math.abs(heightFast(x + 0.1, z) - heightFast(x - 0.1, z)), Math.abs(heightFast(x, z + 0.1) - heightFast(x, z - 0.1))) / 0.2;

// ── 스프라이트 텍스처 ──
function radial(stops: [number, string][]) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d')!, gr = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [k, c] of stops) gr.addColorStop(k, c);
  ctx.fillStyle = gr;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}
export const smokeTex = radial([[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
export const bubbleTex = radial([[0, 'rgba(255,255,255,0.15)'], [0.7, 'rgba(255,255,255,0.25)'], [0.85, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);

// 떠오르는 입자(연기·거품): 스프라이트 n 개가 위로 올라가며 커지고 흐려진다. 갱신 함수를 돌려준다
export function puffs(g: THREE.Group, o: { x: number; y: number; z: number; n: number; color: number; size: [number, number];
  rise: number; drift: number; speed: number; tex: THREE.Texture; opacity: number; spread?: number }) {
  const sps: THREE.Sprite[] = [];
  for (let i = 0; i < o.n; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: o.tex, color: o.color, depthWrite: false, transparent: true }));
    sp.userData.phase = i / o.n;
    sp.userData.ox = (Math.random() - 0.5) * (o.spread ?? 0);
    sp.userData.oz = (Math.random() - 0.5) * (o.spread ?? 0);
    sps.push(sp);
    g.add(sp);
  }
  return (t: number) => {
    for (const sp of sps) {
      const k = (t * o.speed + sp.userData.phase) % 1;
      sp.position.set(o.x + sp.userData.ox + Math.sin(k * 3 + sp.userData.phase * 9) * 0.08 + k * o.drift, o.y + k * o.rise, o.z + sp.userData.oz - k * o.drift * 0.5);
      sp.scale.setScalar(o.size[0] + k * (o.size[1] - o.size[0]));
      (sp.material as THREE.SpriteMaterial).opacity = Math.sin(k * Math.PI) * o.opacity;
    }
  };
}
