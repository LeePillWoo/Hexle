// 타일 장식: 같은 종류끼리 이어진 묶음(cluster) 단위로 만든다.
//  숲은 끊김 없이 이어지고 클수록 울창·거대해지며, 밭은 한 방향 이랑의 큰 밭, 집은 길·광장이 있는 마을이 된다.
// 모델은 부품을 정점 색으로 칠해 한 지오메트리로 합쳐 둔다(재질 1개, 그리기 호출 최소).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { fromWorld, key, neighbors, R, SQ3, toWorld, type Hex } from './hex';
import { clusters, farmInside, heightFast, roadDist, villageCenter, type Cell, type Kind } from './terrain';

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

// ── 지오메트리 도우미 ──
function paint(g: THREE.BufferGeometry, color: number) {
  const ng = g.index ? g.toNonIndexed() : g, c = new THREE.Color(color), n = ng.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  ng.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return ng;
}
const merge = (...gs: THREE.BufferGeometry[]) => mergeGeometries(gs)!;
const vc = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
const vcFlat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, flatShading: true });
const prism = (r: number, len: number) => new THREE.CylinderGeometry(r, r, len, 3).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2);
// 울퉁불퉁한 돌: 같은 위치의 정점은 같은 만큼 밀어서 틈이 안 생기게
function lumpy(g: THREE.BufferGeometry, amt: number) {
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i), k = 1 + amt * Math.sin(x * 12.9 + y * 78.2 + z * 37.7);
    p.setXYZ(i, x * k, y * k, z * k);
  }
  g.computeVertexNormals();
  return g;
}

// ── 모델 ──
const GREENS = [0x1e5a2e, 0x24683a, 0x2b7543, 0x33824c, 0x3c8f55];
const pineGeo = merge(
  paint(new THREE.CylinderGeometry(0.03, 0.05, 0.32, 8).translate(0, 0.16, 0), 0x5a3a22),
  ...[0, 1, 2, 3, 4].map(i => paint(new THREE.ConeGeometry(0.32 - i * 0.055, 0.36, 12).translate(0, 0.3 + i * 0.17, 0), GREENS[i])),
);
const broadleafGeo = merge(
  paint(new THREE.CylinderGeometry(0.03, 0.05, 0.4, 8).translate(0, 0.2, 0), 0x5a3a22),
  paint(new THREE.IcosahedronGeometry(0.22, 1).translate(0, 0.55, 0), 0x4f8f3a),
  paint(new THREE.IcosahedronGeometry(0.17, 1).translate(0.12, 0.48, 0.05), 0x5c9c40),
  paint(new THREE.IcosahedronGeometry(0.16, 1).translate(-0.1, 0.5, -0.08), 0x468534),
  paint(new THREE.IcosahedronGeometry(0.13, 1).translate(0.02, 0.72, 0), 0x66a848),
);
const rockGeo = paint(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.12), 0x9a968c);
const bushGeo = merge(
  paint(new THREE.IcosahedronGeometry(0.09, 1), 0x3f7f35),
  paint(new THREE.IcosahedronGeometry(0.07, 1).translate(0.08, -0.01, 0.03), 0x4a8c3c),
  paint(new THREE.IcosahedronGeometry(0.06, 1).translate(-0.06, -0.02, -0.05), 0x36722e),
);
const stemGeo = paint(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 4).translate(0, 0.045, 0), 0x4b8a36);
const petalGeo = paint(new THREE.IcosahedronGeometry(0.03, 1).scale(1, 0.55, 1).translate(0, 0.09, 0), 0xffffff);
const wheatGeo = paint(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), 0xffffff);
const cabbageGeo = merge(
  paint(new THREE.IcosahedronGeometry(0.05, 1).translate(0, 0.04, 0), 0x6fb04a),
  paint(new THREE.IcosahedronGeometry(0.035, 1).translate(0, 0.07, 0), 0x8ccc5e),
);
const haystackGeo = merge(
  paint(new THREE.CylinderGeometry(0.16, 0.18, 0.18, 14).translate(0, 0.09, 0), 0xd9b552),
  paint(new THREE.ConeGeometry(0.17, 0.16, 14).translate(0, 0.26, 0), 0xe3c165),
);
const scarecrowGeo = merge(
  paint(new THREE.CylinderGeometry(0.012, 0.012, 0.4, 6).translate(0, 0.2, 0), 0x6b4a2b),
  paint(new THREE.CylinderGeometry(0.01, 0.01, 0.26, 6).rotateZ(Math.PI / 2).translate(0, 0.3, 0), 0x6b4a2b),
  paint(new THREE.BoxGeometry(0.1, 0.13, 0.05).translate(0, 0.3, 0), 0x3e6fa8),
  paint(new THREE.IcosahedronGeometry(0.04, 1).translate(0, 0.41, 0), 0xe8d6a8),
  paint(new THREE.ConeGeometry(0.07, 0.06, 10).translate(0, 0.46, 0), 0xc9a24a),
);

function houseGeo(roof: number) {
  return merge(
    paint(new THREE.BoxGeometry(0.48, 0.06, 0.4).translate(0, 0.03, 0), 0x8f8a80),          // 주춧돌
    paint(new THREE.BoxGeometry(0.44, 0.28, 0.36).translate(0, 0.2, 0), 0xf2e6c8),          // 벽
    paint(prism(0.31, 0.54).translate(0, 0.49, 0), roof),                                   // 지붕(처마 포함)
    paint(new THREE.BoxGeometry(0.07, 0.2, 0.07).translate(0.13, 0.6, -0.07), 0xb8a890),    // 굴뚝
    paint(new THREE.BoxGeometry(0.1, 0.17, 0.02).translate(0, 0.145, 0.185), 0x7a5432),    // 문
    ...[-0.14, 0.14].map(x => paint(new THREE.BoxGeometry(0.08, 0.08, 0.02).translate(x, 0.21, 0.185), 0x3d5a78)),  // 앞 창
    ...[-0.1, 0.1].map(x => paint(new THREE.BoxGeometry(0.08, 0.08, 0.02).translate(x, 0.21, -0.185), 0x3d5a78)),   // 뒤 창
    paint(new THREE.BoxGeometry(0.02, 0.08, 0.08).translate(0.225, 0.21, 0), 0x3d5a78),      // 옆 창
  );
}
const ROOFS = [0xc0563f, 0x3f6fa0, 0x8a4f9e, 0x4f8a4a].map(houseGeo);
const churchGeo = merge(
  paint(new THREE.BoxGeometry(0.62, 0.06, 0.42).translate(0, 0.03, 0), 0x8f8a80),
  paint(new THREE.BoxGeometry(0.58, 0.36, 0.38).translate(0, 0.24, 0), 0xf4ede0),
  paint(prism(0.32, 0.64).translate(0, 0.56, 0), 0x6e4a3a),
  paint(new THREE.BoxGeometry(0.2, 0.62, 0.2).translate(-0.34, 0.37, 0), 0xf4ede0),      // 종탑
  paint(new THREE.ConeGeometry(0.16, 0.36, 4).rotateY(Math.PI / 4).translate(-0.34, 0.86, 0), 0x6e4a3a),
  paint(new THREE.BoxGeometry(0.012, 0.12, 0.012).translate(-0.34, 1.1, 0), 0xe0c060),
  paint(new THREE.BoxGeometry(0.06, 0.012, 0.012).translate(-0.34, 1.12, 0), 0xe0c060),
  paint(new THREE.BoxGeometry(0.12, 0.2, 0.02).translate(0.05, 0.16, 0.2), 0x7a5432),
  ...[-0.15, 0.22].map(x => paint(new THREE.BoxGeometry(0.07, 0.14, 0.02).translate(x, 0.26, 0.2), 0x6d8fc0)),
  paint(new THREE.CylinderGeometry(0.05, 0.05, 0.02, 12).rotateX(Math.PI / 2).translate(-0.34, 0.5, 0.105), 0x6d8fc0),
);
const wellGeo = merge(
  paint(new THREE.CylinderGeometry(0.14, 0.15, 0.14, 16, 1, true).translate(0, 0.07, 0), 0x9a958a),
  paint(new THREE.CylinderGeometry(0.12, 0.12, 0.02, 16).translate(0, 0.1, 0), 0x2f5a7a),
  ...[-0.12, 0.12].map(x => paint(new THREE.BoxGeometry(0.025, 0.3, 0.025).translate(x, 0.22, 0), 0x6b4a2b)),
  paint(prism(0.15, 0.34).translate(0, 0.4, 0), 0xa04a35),
  paint(new THREE.CylinderGeometry(0.015, 0.015, 0.26, 6).rotateZ(Math.PI / 2).translate(0, 0.3, 0), 0x6b4a2b),
);
const tentGeo = merge(
  paint(new THREE.ConeGeometry(0.42, 0.5, 4).rotateY(Math.PI / 4).translate(0, 0.25, 0), 0xc07a3e),
  paint(new THREE.BoxGeometry(0.16, 0.24, 0.01).translate(0, 0.12, 0.3).rotateX(-0.45), 0x7a4a24),  // 입구
  paint(new THREE.CylinderGeometry(0.012, 0.012, 0.62, 6).translate(0, 0.31, 0), 0x6b4a2b),
);
const campGeo = merge(
  ...[0, 1, 2, 3, 4, 5, 6].map(i => paint(new THREE.DodecahedronGeometry(0.045, 0).translate(Math.cos(i / 7 * 6.283) * 0.14, 0.02, Math.sin(i / 7 * 6.283) * 0.14), 0x8a867c)),
  ...[0, 1, 2].map(i => paint(new THREE.CylinderGeometry(0.018, 0.018, 0.2, 6).rotateZ(1.1).rotateY(i * 2.1).translate(0, 0.05, 0), 0x5a3a22)),
  paint(new THREE.CylinderGeometry(0.05, 0.05, 0.4, 10).rotateZ(Math.PI / 2).translate(0.05, 0.05, 0.32), 0x7a5432),
  paint(new THREE.CylinderGeometry(0.05, 0.05, 0.36, 10).rotateZ(Math.PI / 2).rotateY(1.2).translate(-0.3, 0.05, 0.05), 0x7a5432),
);
const flameMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff5a00, emissiveIntensity: 3 });
const flameGeo = new THREE.ConeGeometry(0.06, 0.18, 8);
const crateGeo = merge(
  paint(new THREE.BoxGeometry(0.16, 0.14, 0.16).translate(0, 0.07, 0), 0x8a6038),
  paint(new THREE.BoxGeometry(0.17, 0.02, 0.17).translate(0, 0.07, 0), 0x6b4a2b),
);
const barrelGeo = merge(
  paint(new THREE.CylinderGeometry(0.07, 0.07, 0.17, 14).translate(0, 0.085, 0), 0x8a5a33),
  ...[0.03, 0.14].map(y => paint(new THREE.CylinderGeometry(0.073, 0.073, 0.015, 14).translate(0, y, 0), 0x4a4a4a)),
);
// 야자수: 휜 줄기 + 늘어진 잎 + 열매
const palmGeo = (() => {
  const parts: THREE.BufferGeometry[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < 6; i++) {
    const r = 0.045 - i * 0.004;
    parts.push(paint(new THREE.CylinderGeometry(r * 0.92, r, 0.13, 8).rotateZ(-0.05 - i * 0.04).translate(x, y + 0.065, 0), i % 2 ? 0x8a6a45 : 0x7a5c3a));
    x += 0.013 + i * 0.006; y += 0.125;
  }
  for (let k = 0; k < 9; k++) {
    const a = k / 9 * Math.PI * 2;
    for (let s = 0; s < 2; s++) {
      parts.push(paint(new THREE.ConeGeometry(0.06 - s * 0.02, 0.24, 4).rotateZ(-Math.PI / 2).scale(1, 0.18, 1)
        .translate(0.12 + s * 0.22, 0, 0).rotateZ(-0.15 - s * 0.45).rotateY(a).translate(x, y, 0), s ? 0x3e9a3c : 0x2f8a34));
    }
  }
  for (let k = 0; k < 3; k++) parts.push(paint(new THREE.IcosahedronGeometry(0.03, 1).translate(x + Math.cos(k * 2.1) * 0.04, y - 0.04, Math.sin(k * 2.1) * 0.04), 0x5a4020));
  return merge(...parts);
})();

// ── 배치 도우미 ──
function rng(seed: number) {
  let s = Math.abs(Math.floor(seed)) % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
const seedOf = (h: Hex) => h.q * 7919 + h.r * 104729 + 1e6;
// 칸 중심 기준 임의 위치. margin 이 음수면 칸 밖으로 조금 넘쳐 이웃 칸까지 (같은 종류 이음새를 메울 때)
function inHex(rnd: () => number, margin: number) {
  for (;;) {
    const x = rnd() * 2 - 1, z = (rnd() * 2 - 1) * R;
    const ax = Math.abs(x), az = Math.abs(z);
    if (Math.max(ax, ax * 0.5 + az * SQ3 / 2) < 1 - margin) return { x, z };
  }
}
const slope = (x: number, z: number) =>
  Math.max(Math.abs(heightFast(x + 0.1, z) - heightFast(x - 0.1, z)), Math.abs(heightFast(x, z + 0.1) - heightFast(x, z - 0.1))) / 0.2;
function placed(g: THREE.BufferGeometry, x: number, y: number, z: number, s = 1, rotY = 0, m: THREE.Material = vc) {
  const o = new THREE.Mesh(g, m);
  o.position.set(x, y, z);
  o.scale.setScalar(s);
  o.rotation.y = rotY;
  o.castShadow = o.receiveShadow = true;
  return o;
}
// 인스턴스 묶음: push 로 쌓고 build 로 InstancedMesh 하나로
function batch(geo: THREE.BufferGeometry, m: THREE.Material = vc) {
  const mats: THREE.Matrix4[] = [], cols: THREE.Color[] = [];
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  return {
    push(x: number, y: number, z: number, s: THREE.Vector3 | number, rotY = 0, color?: THREE.Color) {
      mats.push(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.clone().setFromAxisAngle(up, rotY),
        typeof s === 'number' ? new THREE.Vector3(s, s, s) : s));
      cols.push(color ?? new THREE.Color(1, 1, 1));
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

// ── 종류별 ──
type Ctx = { kindAt: (h: Hex) => Kind | undefined; g: THREE.Group };
const neighborCount = (ctx: Ctx, h: Hex, kind: Kind) => neighbors(h).filter(n => ctx.kindAt(n) === kind).length;

// 숲: 이음새까지 나무로 메우고, 묶음이 클수록 빽빽하고 크게, 숲 한가운데는 거목
function forest(ctx: Ctx, comp: Hex[]) {
  const n = Math.min(comp.length, 8), pines = batch(pineGeo, vcFlat), leafy = batch(broadleafGeo, vcFlat);
  for (const h of comp) {
    const rnd = rng(seedOf(h)), c = toWorld(h), inner = neighborCount(ctx, h, 'forest');
    const count = 22 + n * 3;
    for (let i = 0; i < count; i++) {
      const p = inHex(rnd, inner ? -0.12 : 0.04), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
      if (ctx.kindAt(fromWorld(x, z)) !== 'forest' || y < 0.4 || slope(x, z) > 0.8) continue;
      const s = 0.7 + n * 0.05 + rnd() * 0.35, tint = new THREE.Color().setHSL(0, 0, 0.85 + rnd() * 0.3);
      (rnd() < 0.2 ? leafy : pines).push(x, y - 0.02, z, new THREE.Vector3(s, s * (0.9 + rnd() * 0.3), s), rnd() * 6, tint);
    }
    if (inner >= 4) for (let i = 0; i < 3; i++) {   // 거목
      const p = inHex(rnd, 0.3), x = c.x + p.x, z = c.z + p.z;
      pines.push(x, heightFast(x, z) - 0.03, z, 1.8 + rnd() * 0.5, rnd() * 6, new THREE.Color(0.85, 0.9, 0.85));
    }
  }
  ctx.g.add(pines.build(), leafy.build());
}

// 꽃밭: 묶음이 클수록 촘촘하게, 덤불 섞기
function meadow(ctx: Ctx, comp: Hex[]) {
  const COLORS = [0xff7eb3, 0xffd84d, 0xffffff, 0xb784ff, 0xff5a5a, 0xff9e3d].map(c => new THREE.Color(c));
  const stems = batch(stemGeo), petals = batch(petalGeo), bushes = batch(bushGeo);
  const n = Math.min(comp.length, 6);
  for (const h of comp) {
    const rnd = rng(seedOf(h) + 5), c = toWorld(h), inner = neighborCount(ctx, h, 'flower');
    // 꽃은 무리지어 핀다: 칸마다 색 무리 몇 개
    const patches = Array.from({ length: 4 }, () => ({ ...inHex(rnd, 0.2), col: COLORS[Math.floor(rnd() * COLORS.length)] }));
    for (let i = 0; i < 100 + n * 20; i++) {
      const p = inHex(rnd, inner ? -0.1 : 0.06), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
      if (ctx.kindAt(fromWorld(x, z)) !== 'flower' || y < 0.4 || slope(x, z) > 0.8) continue;
      const near = patches.reduce((a, b) => Math.hypot(a.x - p.x, a.z - p.z) < Math.hypot(b.x - p.x, b.z - p.z) ? a : b);
      const s = 0.8 + rnd() * 0.6, rot = rnd() * 6;
      stems.push(x, y, z, s, rot);
      petals.push(x, y, z, s, rot, rnd() < 0.85 ? near.col : COLORS[Math.floor(rnd() * COLORS.length)]);
    }
    for (let i = 0; i < 4; i++) {
      const p = inHex(rnd, 0.15), x = c.x + p.x, z = c.z + p.z;
      bushes.push(x, heightFast(x, z), z, 0.8 + rnd() * 0.6, rnd() * 6);
    }
  }
  ctx.g.add(stems.build(), petals.build(), bushes.build());
}

// 밭: 묶음 전체에 한 방향 이랑. 띠마다 밀/양배추를 번갈아, 묶음 테두리 안쪽만
function farm(ctx: Ctx, comp: Hex[]) {
  const rnd = rng(seedOf(comp[0]) + 11), ang = Math.floor(rnd() * 3) * Math.PI / 3;
  const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux;      // u: 이랑 방향, v: 이랑 사이
  const pts = comp.map(toWorld), cx = pts.reduce((s, p) => s + p.x, 0) / pts.length, cz = pts.reduce((s, p) => s + p.z, 0) / pts.length;
  const ext = 1.3 + Math.sqrt(comp.length) * 1.4;
  const wheat = batch(wheatGeo), cabbage = batch(cabbageGeo), WHEAT = new THREE.Color(0xe2bf55), GREEN = new THREE.Color(0x7cbc4a);
  const inside = (x: number, z: number) => farmInside(x, z) > 0.16 && slope(x, z) < 0.6;
  for (let v = -ext, row = 0; v <= ext; v += 0.17, row++) {
    const band = Math.floor((v + ext) / 0.68) % 3;                       // 0 밀, 1 양배추, 2 어린 싹
    let start: number | null = null;
    for (let u = -ext; u <= ext + 0.06; u += 0.06) {
      const x = cx + ux * u + vx * v, z = cz + uz * u + vz * v, ok = u <= ext && inside(x, z);
      if (ok && start === null) start = u;
      if (!ok && start !== null) {
        const len = u - 0.06 - start;
        if (len > 0.1) {
          const mu = (start + u - 0.06) / 2, mx = cx + ux * mu + vx * v, mz = cz + uz * mu + vz * v;
          if (band === 1) for (let w = start; w <= u - 0.06; w += 0.11) {
            const px = cx + ux * w + vx * v, pz = cz + uz * w + vz * v;
            cabbage.push(px, heightFast(px, pz), pz, 0.9 + rnd() * 0.3, rnd() * 6);
          } else {
            const hgt = band === 0 ? 0.13 : 0.06;
            wheat.push(mx, heightFast(mx, mz) - 0.01, mz, new THREE.Vector3(len, hgt, 0.08), -ang, band === 0 ? WHEAT : GREEN);
          }
        }
        start = null;
      }
    }
  }
  ctx.g.add(wheat.build(), cabbage.build());
  // 큰 밭엔 짚더미, 더 크면 허수아비
  comp.slice(0, Math.max(0, comp.length - 1)).forEach(h => {
    const c = toWorld(h), x = c.x + 0.55, z = c.z - 0.3;
    if (heightFast(x, z) > 0.4) ctx.g.add(placed(haystackGeo, x, heightFast(x, z), z));
  });
  if (comp.length >= 3) ctx.g.add(placed(scarecrowGeo, cx, heightFast(cx, cz), cz, 1.2, ang));
}

// 마을: 1칸이면 집 한 채, 이어지면 칸마다 여러 채가 길을 향해. 3칸 이상 우물 광장, 5칸 이상 교회
function village(ctx: Ctx, comp: Hex[]) {
  const center = comp.length >= 3 ? villageCenter(comp) : undefined;
  for (const h of comp) {
    const rnd = rng(seedOf(h) + 23), c = toWorld(h);
    if (comp.length === 1) {
      ctx.g.add(placed(ROOFS[0], c.x, heightFast(c.x, c.z), c.z, 1.25, rnd() * 0.6 - 0.3));
      ctx.g.add(placed(crateGeo, c.x + 0.45, heightFast(c.x + 0.45, c.z + 0.2), c.z + 0.2, 1, rnd() * 6));
      ctx.g.add(placed(barrelGeo, c.x - 0.45, heightFast(c.x - 0.45, c.z + 0.25), c.z + 0.25));
      continue;
    }
    if (center && h === center) {
      const big = comp.length >= 5;
      ctx.g.add(placed(wellGeo, c.x, heightFast(c.x, c.z), c.z, 1.1));
      if (big) { const x = c.x - 0.15, z = c.z - 0.62; ctx.g.add(placed(churchGeo, x, heightFast(x, z), z, 1.1, 0)); }
      continue;
    }
    const a0 = rnd() * Math.PI * 2;
    for (let k = 0; k < 3; k++) {
      // 길을 피해서 놓을 자리 찾기
      for (let t = 0; t < 6; t++) {
        const a = a0 + k * 2.094 + t * 0.35, rr = 0.48 + (t % 2) * 0.1, x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
        if (roadDist(x, z) < 0.3 || slope(x, z) > 0.5 || ctx.kindAt(fromWorld(x, z)) !== 'house') continue;
        // 문이 가장 가까운 길(없으면 칸 중심) 쪽을 보게
        const face = Math.atan2(c.x - x, c.z - z);
        ctx.g.add(placed(ROOFS[Math.floor(rnd() * ROOFS.length)], x, heightFast(x, z) - 0.01, z, 0.85 + rnd() * 0.2, face));
        break;
      }
    }
    const bx = c.x + (rnd() - 0.5) * 0.4, bz = c.z + (rnd() - 0.5) * 0.4;
    if (roadDist(bx, bz) > 0.15) ctx.g.add(placed(rnd() < 0.5 ? barrelGeo : crateGeo, bx, heightFast(bx, bz), bz, 1, rnd() * 6));
  }
}

function mountainDecor(ctx: Ctx, comp: Hex[]) {
  const rocks = batch(rockGeo, vcFlat), pines = batch(pineGeo, vcFlat);
  for (const h of comp) {
    const rnd = rng(seedOf(h) + 31), c = toWorld(h);
    for (let i = 0; i < 10; i++) {
      const p = inHex(rnd, 0.05), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
      if (y > 0.5) rocks.push(x, y, z, 0.05 + rnd() * 0.1, rnd() * 6);
    }
    if (comp.length >= 3) for (let i = 0; i < 8; i++) {      // 산맥 기슭엔 침엽수
      const p = inHex(rnd, 0.0), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
      if (y > 0.5 && y < 1.1 && slope(x, z) < 1.2) pines.push(x, y - 0.03, z, 0.6 + rnd() * 0.3, rnd() * 6);
    }
  }
  ctx.g.add(rocks.build(), pines.build());
}

function grassDecor(ctx: Ctx, h: Hex) {
  const rnd = rng(seedOf(h) + 41), c = toWorld(h), rocks = batch(rockGeo, vcFlat), bushes = batch(bushGeo);
  for (let i = 0; i < 6; i++) {
    const p = inHex(rnd, 0.1), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
    if (y > 0.4) (i < 3 ? rocks : bushes).push(x, y, z, i < 3 ? 0.04 + rnd() * 0.05 : 0.7 + rnd() * 0.6, rnd() * 6);
  }
  ctx.g.add(rocks.build(), bushes.build());
}

function beachDecor(ctx: Ctx, h: Hex) {
  const rnd = rng(seedOf(h) + 51), c = toWorld(h);
  for (let i = 0; i < 3; i++) {
    const p = inHex(rnd, 0.25), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
    if (y > 0.08) ctx.g.add(placed(palmGeo, x, y, z, 0.85 + rnd() * 0.4, rnd() * 6));
  }
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

function camp(ctx: Ctx, h: Hex) {
  const c = toWorld(h), g = ctx.g;
  const y = (dx: number, dz: number) => heightFast(c.x + dx, c.z + dz);
  g.add(placed(tentGeo, c.x - 0.25, y(-0.25, -0.3), c.z - 0.3, 1, 0.3));
  const fx = c.x + 0.3, fz = c.z + 0.25, fy = y(0.3, 0.25);
  g.add(placed(campGeo, fx, fy, fz));
  g.add(placed(flameGeo, fx, fy + 0.1, fz, 1, 0, flameMat));
  g.add(placed(crateGeo, c.x - 0.6, y(-0.6, 0.1), c.z + 0.1, 1, 0.4));
  g.add(placed(barrelGeo, c.x - 0.5, y(-0.5, 0.3), c.z + 0.3));
  const fire = new THREE.PointLight(0xff8a3a, 1.5, 2.5);
  fire.position.set(fx, fy + 0.3, fz);
  g.add(fire);
  const puffs: THREE.Sprite[] = [];
  for (let i = 0; i < 14; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xdddddd, depthWrite: false, transparent: true }));
    sp.userData.phase = i / 14;
    puffs.push(sp);
    g.add(sp);
  }
  return (t: number) => {
    for (const sp of puffs) {
      const k = (t * 0.18 + sp.userData.phase) % 1;
      sp.position.set(fx + Math.sin(k * 3 + sp.userData.phase * 9) * 0.08 + k * 0.4, fy + 0.15 + k * 2.4, fz - k * 0.2);
      sp.scale.setScalar(0.15 + k * 0.9);
      (sp.material as THREE.SpriteMaterial).opacity = Math.sin(k * Math.PI) * 0.35;
    }
  };
}

// 섬 전체 장식을 새로 만든다 (지형이 바뀔 때마다 통째로)
export function decorateAll(cells: Cell[]) {
  const byKey = new Map(cells.map(c => [key(c.hex), c.kind]));
  const ctx: Ctx = { kindAt: h => byKey.get(key(h)), g: new THREE.Group() };
  const updates: ((t: number) => void)[] = [];
  for (const comp of clusters(cells, 'forest')) forest(ctx, comp);
  for (const comp of clusters(cells, 'flower')) meadow(ctx, comp);
  for (const comp of clusters(cells, 'farm')) farm(ctx, comp);
  for (const comp of clusters(cells, 'house')) village(ctx, comp);
  for (const comp of clusters(cells, 'mountain')) mountainDecor(ctx, comp);
  for (const c of cells) {
    if (c.kind === 'grass') grassDecor(ctx, c.hex);
    if (c.kind === 'beach') beachDecor(ctx, c.hex);
    if (c.kind === 'camp') updates.push(camp(ctx, c.hex));
  }
  ctx.g.userData.update = (t: number) => updates.forEach(u => u(t));
  return ctx.g;
}

// 장식을 갈아끼울 때 개별 자원 해제 (공유 지오메트리·재질은 그대로)
export function disposeDecor(o: THREE.Object3D) {
  o.traverse(c => {
    if (c instanceof THREE.Sprite) c.material.dispose();
    if (c instanceof THREE.InstancedMesh) c.dispose();
  });
}

export function lighthouse(x: number, z: number) {
  const y = heightFast(x, z), b = y + 0.15;
  const geo = merge(
    paint(lumpy(new THREE.IcosahedronGeometry(0.45, 2), 0.1).scale(1, 0.6, 0.9).translate(0, -0.2, 0), 0x6a655e),
    paint(new THREE.CylinderGeometry(0.2, 0.28, 1.4, 24).translate(0, 0.7, 0), 0xf2eee6),
    ...[0, 0.5].map(k => paint(new THREE.CylinderGeometry(0.255 - k * 0.08, 0.27 - k * 0.08, 0.22, 24).translate(0, 0.3 + k, 0), 0xc0322a)),
    paint(new THREE.CylinderGeometry(0.3, 0.3, 0.05, 24).translate(0, 1.42, 0), 0x2a2a2a),
    paint(new THREE.TorusGeometry(0.29, 0.008, 6, 32).rotateX(Math.PI / 2).translate(0, 1.52, 0), 0x2a2a2a),   // 난간
    ...[0, 1, 2, 3, 4, 5, 6, 7].map(i => paint(new THREE.BoxGeometry(0.01, 0.1, 0.01).translate(Math.cos(i * 0.785) * 0.29, 1.47, Math.sin(i * 0.785) * 0.29), 0x2a2a2a)),
    ...[0.55, 0.95].map(yy => paint(new THREE.BoxGeometry(0.06, 0.1, 0.02).translate(0, yy, 0.25 - (yy - 0.55) * 0.08), 0x3d5a78)),
    paint(new THREE.ConeGeometry(0.2, 0.25, 24).translate(0, 1.77, 0), 0xc0322a),
  );
  const g = new THREE.Group();
  g.add(placed(geo, x, b, z));
  g.add(placed(new THREE.CylinderGeometry(0.13, 0.13, 0.2, 16), x, b + 1.55, z, 1, 0,
    new THREE.MeshStandardMaterial({ color: 0xffe08a, emissive: 0xffc040, emissiveIntensity: 2 })));
  return g;
}
