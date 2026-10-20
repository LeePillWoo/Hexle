// 육지 타일 장식: 같은 종류끼리 이어진 묶음(cluster) 단위로 만든다.
//  숲은 끊김 없이 이어지고 클수록 울창해지며 공터가 열린다. 밭은 한 방향 이랑의 큰 밭, 집은 길·광장이 있는 마을,
//  산은 바위·기슭 나무, 화산은 용암·연기, 성은 본채·성벽·탑, 과수원은 열 맞춘 과일나무, 설원은 눈 덮인 나무·이글루.
import * as THREE from 'three';
import { centroid, corners, fromWorld, key, mostConnected, neighbors, R, toWorld, type Hex } from '../core/hex';
import { rng, seedOf } from '../core/noise';
import { farmInside, heightFast, LAKE_Y, lakeType, roadDist, surfaceAt, volcanoSize } from '../world/terrain';
import { buildModel } from '../items/models';
import { emit } from '../audio/emitters';
import { barnGeo, eruption, fruitStallGeo, marketStallGeo, palmGeo as PALM } from './extras';
import { batch, inHex, lumpy, merge, paint, placed, prism, puffs, slope, smokeTex, vc, vcFlat, type Ctx } from './models';
import type { Kind } from './kinds';
import { benchGeo, TALL, towns, type Home, type Spot } from './villagers';

// ── 모델 ──
const GREENS = [0x1e5a2e, 0x24683a, 0x2b7543, 0x33824c, 0x3c8f55];
const pineGeo = merge(
  paint(new THREE.CylinderGeometry(0.03, 0.05, 0.32, 8).translate(0, 0.16, 0), 0x5a3a22),
  ...[0, 1, 2, 3, 4].map(i => paint(new THREE.ConeGeometry(0.32 - i * 0.055, 0.36, 12).translate(0, 0.3 + i * 0.17, 0), GREENS[i])),
);
const broadleafGeo = merge(
  paint(new THREE.CylinderGeometry(0.03, 0.05, 0.4, 8).translate(0, 0.2, 0), 0x5a3a22),
  paint(new THREE.IcosahedronGeometry(0.22, 1).translate(0, 0.55, 0), 0x8fbf3a),     // 밝은 연두 활엽수
  paint(new THREE.IcosahedronGeometry(0.17, 1).translate(0.12, 0.48, 0.05), 0xa3c94a),
  paint(new THREE.IcosahedronGeometry(0.16, 1).translate(-0.1, 0.5, -0.08), 0x7fb032),
  paint(new THREE.IcosahedronGeometry(0.13, 1).translate(0.02, 0.72, 0), 0xb5d65a),
);
// 과일나무: 둥근 수관에 빨간 열매
const fruitTreeGeo = merge(
  paint(new THREE.CylinderGeometry(0.025, 0.04, 0.22, 8).translate(0, 0.11, 0), 0x6a4a2a),
  paint(new THREE.IcosahedronGeometry(0.17, 1).translate(0, 0.32, 0), 0x4f9a3a),
  paint(new THREE.IcosahedronGeometry(0.12, 1).translate(0.08, 0.26, 0.06), 0x5aa842),
  ...Array.from({ length: 10 }, (_, i) => { const a = i * 2.4, y = 0.24 + (i % 4) * 0.045; return paint(new THREE.SphereGeometry(0.022, 6, 5).translate(Math.cos(a) * 0.15, y, Math.sin(a) * 0.15), 0xd8302a); }),
);
const basketGeo = merge(
  paint(new THREE.CylinderGeometry(0.07, 0.055, 0.08, 10).translate(0, 0.04, 0), 0xb08a52),
  ...[0, 1, 2, 3].map(i => paint(new THREE.SphereGeometry(0.02, 6, 5).translate(Math.cos(i * 1.6) * 0.03, 0.09, Math.sin(i * 1.6) * 0.03), 0xd8302a)),
);
const ladderGeo = merge(
  ...[-0.05, 0.05].map(z => paint(new THREE.BoxGeometry(0.02, 0.5, 0.02).translate(0, 0.25, z), 0x9a7048)),
  ...[0.08, 0.18, 0.28, 0.38].map(y => paint(new THREE.BoxGeometry(0.015, 0.015, 0.12).translate(0, y, 0), 0x9a7048)),
);
const deadTreeGeo = merge(
  paint(new THREE.CylinderGeometry(0.02, 0.04, 0.4, 6).translate(0, 0.2, 0), 0x3a2e28),
  ...[0, 1, 2].map(i => paint(new THREE.CylinderGeometry(0.008, 0.015, 0.18, 5).translate(0, 0.09, 0).rotateZ(0.7).rotateY(i * 2.1).translate(0, 0.25 + i * 0.05, 0), 0x3a2e28)),
);
const rockGeo = paint(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.12), 0x9a968c);
const bushGeo = merge(
  paint(new THREE.IcosahedronGeometry(0.09, 1), 0x3f7f35),
  paint(new THREE.IcosahedronGeometry(0.07, 1).translate(0.08, -0.01, 0.03), 0x4a8c3c),
  paint(new THREE.IcosahedronGeometry(0.06, 1).translate(-0.06, -0.02, -0.05), 0x36722e),
);
const stemGeo = paint(new THREE.CylinderGeometry(0.006, 0.006, 0.09, 4).translate(0, 0.045, 0), 0x4b8a36);
const petalGeo = paint(new THREE.IcosahedronGeometry(0.03, 1).scale(1, 0.55, 1).translate(0, 0.09, 0), 0xffffff);
// 밀 한 포기: 줄기 다발 + 이삭
const wheatGeo = merge(
  ...[0, 1, 2, 3, 4].map(i => paint(new THREE.CylinderGeometry(0.004, 0.006, 0.13, 3)
    .translate(0, 0.065, 0).rotateZ((i - 2) * 0.12).rotateY(i * 1.3).translate((i - 2) * 0.008, 0, 0), 0xc9a43e)),
  ...[0, 1, 2, 3, 4].map(i => paint(new THREE.ConeGeometry(0.012, 0.05, 5).rotateX(Math.PI)
    .translate((i - 2) * 0.016, 0.15, Math.sin(i * 2.1) * 0.01), 0xe8c55a)),
);
const sproutGeo = merge(
  ...[0, 1, 2].map(i => paint(new THREE.ConeGeometry(0.01, 0.07, 4).translate(0, 0.035, 0).rotateZ((i - 1) * 0.4).rotateY(i * 2.1), 0x7cbc4a)),
);
const baleGeo = merge(
  paint(new THREE.CylinderGeometry(0.11, 0.11, 0.14, 16).rotateZ(Math.PI / 2).translate(0, 0.11, 0), 0xd9b552),
  ...[-0.071, 0.071].map(x => paint(new THREE.CylinderGeometry(0.1, 0.1, 0.002, 16).rotateZ(Math.PI / 2).translate(x, 0.11, 0), 0xc49a3e)),
);
const fenceGeo = merge(
  ...[-0.2, 0, 0.2].map(x => paint(new THREE.BoxGeometry(0.025, 0.12, 0.025).translate(x, 0.06, 0), 0x8a6038)),
  ...[0.05, 0.09].map(y => paint(new THREE.BoxGeometry(0.44, 0.015, 0.012).translate(0, y, 0), 0x9a7048)),
);
const stepGeo = paint(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.08).scale(1, 0.3, 1), 0xa9a49a);
const reedGeo = merge(
  ...[0, 1, 2, 3].map(i => paint(new THREE.CylinderGeometry(0.004, 0.005, 0.2 + i * 0.03, 3).translate(0, 0.1 + i * 0.015, 0).rotateZ((i - 1.5) * 0.15).rotateY(i * 1.7), 0x5f8a3a)),
  ...[0, 2].map(i => paint(new THREE.CylinderGeometry(0.01, 0.01, 0.045, 6).translate(0, 0.21 + i * 0.02, 0).rotateZ((i - 1.5) * 0.15).rotateY(i * 1.7), 0x6b4a2b)),
);
const lilyGeo = paint(new THREE.CircleGeometry(0.05, 10, 0.4, 5.6).rotateX(-Math.PI / 2), 0x3f9a3c);
// 사슴: 몸통·목·머리·다리·꼬리, 수컷은 뿔
const deerGeo = (antlers: boolean) => merge(
  paint(new THREE.SphereGeometry(1, 12, 8).scale(0.09, 0.05, 0.045).translate(0, 0.14, 0), 0xa0683a),
  paint(new THREE.SphereGeometry(1, 10, 6).scale(0.07, 0.03, 0.035).translate(0.01, 0.12, 0), 0xe8d2b0),
  paint(new THREE.CylinderGeometry(0.018, 0.024, 0.09, 8).rotateZ(-0.6).translate(0.09, 0.2, 0), 0xa0683a),
  paint(new THREE.SphereGeometry(1, 10, 8).scale(0.04, 0.025, 0.022).translate(0.13, 0.245, 0), 0xa0683a),
  ...[0.012, -0.012].map(z => paint(new THREE.ConeGeometry(0.008, 0.03, 4).rotateX(z > 0 ? 0.6 : -0.6).translate(0.115, 0.27, z), 0x8a5a33)),
  ...[[0.06, 0.025], [0.06, -0.025], [-0.06, 0.025], [-0.06, -0.025]].map(([x, z]) =>
    paint(new THREE.CylinderGeometry(0.007, 0.006, 0.11, 5).translate(x, 0.055, z), 0x7a5030)),
  paint(new THREE.SphereGeometry(0.012, 6, 4).translate(-0.09, 0.16, 0), 0xf2ead8),
  ...(antlers ? [0.012, -0.012].flatMap(z => [
    paint(new THREE.CylinderGeometry(0.003, 0.004, 0.06, 4).rotateX(z > 0 ? 0.4 : -0.4).translate(0.12, 0.29, z * 1.5), 0x6b5032),
    paint(new THREE.CylinderGeometry(0.003, 0.003, 0.03, 4).rotateZ(0.8).translate(0.135, 0.3, z * 2), 0x6b5032),
  ]) : []),
);
const DEER = [deerGeo(true), deerGeo(false)];
const pondMat = new THREE.MeshStandardMaterial({ color: 0x2aa596, roughness: 0.08, metalness: 0.1, transparent: true, opacity: 0.85 });
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
// 집: 문이 +z. tall 이면 2층(벽이 0.14 높고 위층 창), timber 면 목조 골조(기둥·들보·가새). 창마다 창틀·덧창·창턱, 문엔 문틀·손잡이·디딤돌·차양
function houseGeo(roof: number, wall: number, shutter: number, timber: boolean, tall: boolean) {
  const B = (w: number, h: number, d: number, x: number, y: number, z: number, c: number) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
  const H = tall ? TALL : 0, wh = 0.28 + H, top = 0.06 + wh, beam = 0x5a3a22, dark = new THREE.Color(roof).multiplyScalar(0.72).getHex();
  // 창 하나: 유리 + 흰 창틀 + 창턱 + 양쪽 덧창. axis: 'z' 면 앞뒤 벽(side = ±1), 'x' 면 옆벽
  const win = (x: number, y: number, z: number, side: number, axis: 'x' | 'z' = 'z') => {
    const parts = [B(0.08, 0.08, 0.02, 0, 0, 0, 0x3d5a78), B(0.096, 0.096, 0.012, 0, 0, -0.004 * side, 0xf4f0e6), B(0.104, 0.012, 0.03, 0, -0.05, 0.008 * side, 0xe8e0d0),
      ...[-1, 1].map(s => B(0.03, 0.086, 0.008, s * 0.065, 0, 0.004 * side, shutter))];
    const g = merge(...parts);
    if (axis === 'x') g.rotateY(Math.PI / 2);
    return g.translate(x, y, z);
  };
  const roofY = 0.49 + H, ridge = roofY + 0.31;
  return merge(
    B(0.48, 0.06, 0.4, 0, 0.03, 0, 0x8f8a80),                               // 주춧돌
    B(0.46, 0.02, 0.38, 0, 0.065, 0, 0x7a756c),
    B(0.44, wh, 0.36, 0, 0.06 + wh / 2, 0, wall),                            // 벽
    ...(timber ? [
      ...[[-1, -1], [-1, 1], [1, -1], [1, 1]].map(([sx, sz]) => B(0.026, wh, 0.026, sx * 0.214, 0.06 + wh / 2, sz * 0.174, beam)),   // 모서리 기둥
      ...[0.06 + 0.14, top - 0.01].flatMap(y => [B(0.45, 0.018, 0.01, 0, y, 0.181, beam), B(0.45, 0.018, 0.01, 0, y, -0.181, beam), B(0.01, 0.018, 0.37, 0.221, y, 0, beam), B(0.01, 0.018, 0.37, -0.221, y, 0, beam)]),
      ...[-1, 1].map(s => B(0.012, 0.17, 0.012, 0, 0, 0, beam).rotateX(s * 0.6).translate(-0.222, 0.135, s * 0.08)),   // 옆벽 가새
    ] : []),
    paint(prism(0.31, 0.54).translate(0, roofY, 0), roof),                   // 지붕(처마 포함)
    B(0.56, 0.026, 0.026, 0, ridge, 0, dark),                                // 용마루
    ...[0.3, 0.55, 0.8].flatMap(f => [-1, 1].map(s =>                         // 기와 줄
      B(0.545, 0.008, 0.012, 0, 0, 0, dark).rotateX(s * Math.PI / 3).translate(0, ridge - 0.465 * f + 0.5 * 0.006, s * (0.27 * f + 0.866 * 0.006)))),
    B(0.07, 0.2, 0.07, 0.13, 0.6 + H, -0.07, 0xb8a890),                      // 굴뚝
    B(0.09, 0.02, 0.09, 0.13, 0.71 + H, -0.07, 0x6a625a),
    B(0.13, 0.2, 0.012, 0, 0.16, 0.182, beam),                               // 문틀
    B(0.1, 0.17, 0.02, 0, 0.145, 0.185, 0x7a5432),                           // 문
    B(0.012, 0.012, 0.012, 0.03, 0.14, 0.198, 0xd8b850),                     // 손잡이
    B(0.16, 0.02, 0.06, 0, 0.01, 0.235, 0x9a958a),                           // 디딤돌
    B(0.18, 0.012, 0.08, 0, 0, 0, roof).rotateX(0.35).translate(0, 0.27, 0.215),   // 문 위 차양
    win(-0.14, 0.21, 0.185, 1), win(0.14, 0.21, 0.185, 1),                   // 앞 창
    win(-0.1, 0.21, -0.185, -1), win(0.1, 0.21, -0.185, -1),                 // 뒤 창
    win(0.225, 0.21, 0, 1, 'x'),                                             // 옆 창
    ...(tall ? [win(-0.14, 0.35, 0.185, 1), win(0, 0.35, 0.185, 1), win(0.14, 0.35, 0.185, 1), win(0, 0.35, -0.185, -1)] : []),   // 위층 창
    paint(new THREE.CylinderGeometry(0.03, 0.03, 0.012, 12).rotateZ(Math.PI / 2).translate(0.272, roofY + 0.02, 0), 0x3d5a78),   // 박공 둥근 창
  );
}
// 지붕 4색 × (단층·2층) × (회벽·목조) = 16종. 벽·덧창 색도 섞는다
const WALLS = [0xf2e6c8, 0xf4ecd8, 0xe8dcc0, 0xf0e2d0], SHUTTERS = [0x4f7a4a, 0x3f6fa0, 0x9a4a3a, 0x6b4a2b];
const HOUSES = Array.from({ length: 16 }, (_, i) => ({ tall: i >= 8, geo: houseGeo([0xc0563f, 0x3f6fa0, 0x8a4f9e, 0x4f8a4a][i % 4], WALLS[(i >> 1) % 4], SHUTTERS[(i * 3) % 4], (i >> 2) % 2 === 1, i >= 8) }));
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
const lavaMat = new THREE.MeshStandardMaterial({ color: 0xff7a1a, emissive: 0xff4500, emissiveIntensity: 2.2, roughness: 0.6 });
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
// 성: 둥근 탑(총안·고깔 지붕·깃발), 본채(네 귀퉁이 탑), 성벽 한 변(길이 R, 바닥 0.15 묻힘)
const merlons = (r: number, y: number, n: number) => Array.from({ length: n }, (_, i) =>
  paint(new THREE.BoxGeometry(0.06, 0.06, 0.06).translate(Math.cos(i / n * 6.283) * r, y, Math.sin(i / n * 6.283) * r), 0x8a8680));
const towerGeo = merge(
  paint(new THREE.CylinderGeometry(0.13, 0.15, 0.6, 14).translate(0, 0.3, 0), 0x9a968e),
  paint(new THREE.CylinderGeometry(0.16, 0.14, 0.06, 14).translate(0, 0.62, 0), 0x8a8680), ...merlons(0.14, 0.68, 8),
  paint(new THREE.ConeGeometry(0.15, 0.22, 14).translate(0, 0.76, 0), 0x3f5f9f),
  paint(new THREE.CylinderGeometry(0.006, 0.006, 0.2, 5).translate(0, 0.95, 0), 0x5a4a3a), paint(new THREE.BoxGeometry(0.08, 0.05, 0.005).translate(0.045, 1.01, 0), 0xd03a2f),
  paint(new THREE.BoxGeometry(0.04, 0.06, 0.02).translate(0, 0.35, 0.145), 0x2a2a30),
);
const keepGeo = merge(
  paint(new THREE.BoxGeometry(0.56, 0.5, 0.5).translate(0, 0.25, 0), 0xa09c94),
  ...[[-0.26, -0.23], [0.26, -0.23], [-0.26, 0.23], [0.26, 0.23]].flatMap(([x, z]) => [
    paint(new THREE.CylinderGeometry(0.08, 0.09, 0.66, 10).translate(x, 0.33, z), 0x9a968e), paint(new THREE.ConeGeometry(0.1, 0.16, 10).translate(x, 0.74, z), 0x3f5f9f)]),
  ...merlons(0.2, 0.53, 12).map(g => g.scale(1.3, 1, 1.15)),
  paint(new THREE.BoxGeometry(0.4, 0.06, 0.34).translate(0, 0.53, 0), 0x7a7670),
  paint(new THREE.BoxGeometry(0.12, 0.18, 0.02).translate(0, 0.09, 0.25), 0x4a3a2a),
  ...[-0.14, 0.14].map(x => paint(new THREE.BoxGeometry(0.05, 0.08, 0.02).translate(x, 0.32, 0.25), 0x2a2a30)),
  paint(new THREE.CylinderGeometry(0.006, 0.006, 0.3, 5).translate(0, 0.7, 0), 0x5a4a3a), paint(new THREE.BoxGeometry(0.1, 0.06, 0.005).translate(0.055, 0.8, 0), 0xd03a2f),
);
const wallGeo = merge(
  paint(new THREE.BoxGeometry(R, 0.57, 0.1).translate(0, 0.135, 0), 0x9a968e),
  ...[-0.45, -0.27, -0.09, 0.09, 0.27, 0.45].map(x => paint(new THREE.BoxGeometry(0.09, 0.08, 0.12).translate(x, 0.46, 0), 0x8a8680)),
);
// ── 배치 도우미 ──
const neighborCount = (ctx: Ctx, h: Hex, kind: Kind) => neighbors(h).filter(n => ctx.kindAt(n) === kind).length;

// 숲: 이음새까지 나무로 메우고, 묶음이 클수록 빽빽하고 크게.
// 5칸 이상이면 가장 깊은 칸에 숲속 공터(연못·사슴·들꽃)가 열리고, 공터가 아닌 깊은 칸엔 거목
function forest(ctx: Ctx, comp: Hex[]) {
  const n = Math.min(comp.length, 8), pines = batch(pineGeo, vcFlat), leafy = batch(broadleafGeo, vcFlat);
  const depth = (h: Hex) => neighborCount(ctx, h, 'forest');
  const glades = comp.length >= 5
    ? [...comp].filter(h => depth(h) >= 5).sort((a, b) => depth(b) - depth(a)).slice(0, 1 + Math.floor((comp.length - 5) / 8))
    : [];
  const gladeAt = glades.map(h => ({ ...toWorld(h), seed: seedOf(h) }));
  const gladeEdge = (x: number, z: number) => Math.min(9, ...gladeAt.map(g => {   // 공터 경계까지 거리 (안쪽 음수), 들쭉날쭉하게
    const a = Math.atan2(z - g.z, x - g.x);
    return Math.hypot(x - g.x, z - g.z) - (1.25 + 0.2 * Math.sin(a * 3 + g.seed) + 0.1 * Math.sin(a * 7));
  }));
  for (const h of comp) {
    const rnd = rng(seedOf(h)), c = toWorld(h), inner = depth(h);
    for (let i = 0; i < 22 + n * 3; i++) {
      const p = inHex(rnd, inner ? -0.12 : 0.04), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
      if (ctx.kindAt(fromWorld(x, z)) !== 'forest' || y < 0.4 || slope(x, z) > 0.8 || gladeEdge(x, z) < 0) continue;
      const rim = Math.min(1, 0.55 + gladeEdge(x, z) * 0.6);   // 공터 가장자리 나무는 낮게
      const s = (0.7 + n * 0.05 + rnd() * 0.35) * rim, tint = new THREE.Color().setHSL(0, 0, 0.85 + rnd() * 0.3);
      (rnd() < 0.3 ? leafy : pines).push(x, y - 0.02, z, new THREE.Vector3(s, s * (0.9 + rnd() * 0.3), s), rnd() * 6, tint);
    }
    if (inner >= 4 && !glades.includes(h)) for (let i = 0; i < 3; i++) {   // 거목
      const p = inHex(rnd, 0.3), x = c.x + p.x, z = c.z + p.z;
      if (gladeEdge(x, z) > 1) pines.push(x, heightFast(x, z) - 0.03, z, 1.8 + rnd() * 0.5, rnd() * 6, new THREE.Color(0.85, 0.9, 0.85));
    }
  }
  for (const g of glades) glade(ctx, g);
  ctx.g.add(pines.build(), leafy.build());
}

// 숲속 공터: 가운데 연못(돌·갈대·연잎), 둘레에 들꽃·덤불, 사슴 무리
function glade(ctx: Ctx, h: Hex) {
  const rnd = rng(seedOf(h) + 77), c = toWorld(h), y0 = heightFast(c.x, c.z);
  const pts = Array.from({ length: 24 }, (_, i) => {
    const a = i / 24 * Math.PI * 2, r = 0.4 * (1 + 0.18 * Math.sin(a * 3 + rnd() * 0.5) + 0.08 * Math.sin(a * 5));
    return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
  });
  const pond = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts)).rotateX(-Math.PI / 2), pondMat);
  pond.position.set(c.x, y0 + 0.012, c.z);
  pond.receiveShadow = true;
  ctx.g.add(pond);
  const stones = batch(rockGeo, vcFlat), reeds = batch(reedGeo), lilies = batch(lilyGeo), bushes = batch(bushGeo);
  const stems = batch(stemGeo), petals = batch(petalGeo), deer = [batch(DEER[0]), batch(DEER[1])];
  const around = (r0: number, r1: number) => { const a = rnd() * Math.PI * 2, r = r0 + rnd() * (r1 - r0); return { x: c.x + Math.cos(a) * r, z: c.z + Math.sin(a) * r, a }; };
  for (let i = 0; i < 11; i++) { const p = around(0.44, 0.54); stones.push(p.x, heightFast(p.x, p.z), p.z, 0.03 + rnd() * 0.04, rnd() * 6); }
  for (let i = 0; i < 7; i++) { const p = around(0.4, 0.47); reeds.push(p.x, heightFast(p.x, p.z), p.z, 0.8 + rnd() * 0.5, rnd() * 6); }
  for (let i = 0; i < 5; i++) { const p = around(0, 0.28); lilies.push(p.x, y0 + 0.016, p.z, 0.7 + rnd() * 0.6, rnd() * 6); }
  const COLORS = [0xffffff, 0xffd84d, 0xff9ec4, 0xc9a2ff].map(k => new THREE.Color(k));
  for (let i = 0; i < 60; i++) {
    const p = around(0.56, 1.11), s = 0.7 + rnd() * 0.5;
    stems.push(p.x, heightFast(p.x, p.z), p.z, s, p.a);
    petals.push(p.x, heightFast(p.x, p.z), p.z, s, p.a, COLORS[Math.floor(rnd() * COLORS.length)]);
  }
  for (let i = 0; i < 5; i++) { const p = around(0.75, 1.1); bushes.push(p.x, heightFast(p.x, p.z), p.z, 0.9 + rnd() * 0.6, rnd() * 6); }
  const herd = rnd() * Math.PI * 2;
  for (let i = 0; i < 3; i++) {
    const a = herd + (i - 1) * 0.5, r = 0.68 + rnd() * 0.15, x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r;
    deer[i === 0 ? 0 : 1].push(x, heightFast(x, z), z, 1, Math.PI - a + (rnd() - 0.5) * 0.8);   // 연못 쪽을 보고 (+x 가 앞)
  }
  ctx.g.add(stones.build(), reeds.build(), lilies.build(), bushes.build(), stems.build(), petals.build(), deer[0].build(), deer[1].build());
}

// 꽃밭: 묶음이 클수록 촘촘하게, 덤불 섞기. 꽃은 무리지어 핀다
function meadow(ctx: Ctx, comp: Hex[]) {
  const COLORS = [0xff7eb3, 0xffd84d, 0xffffff, 0xb784ff, 0xff5a5a, 0xff9e3d].map(c => new THREE.Color(c));
  const stems = batch(stemGeo), petals = batch(petalGeo), bushes = batch(bushGeo);
  const n = Math.min(comp.length, 6);
  for (const h of comp) {
    const rnd = rng(seedOf(h) + 5), c = toWorld(h), inner = neighborCount(ctx, h, 'flower');
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

// 묶음 전체에 한 방향으로 격자를 깐다: (u, v) 좌표 → 월드. 밭 이랑·과수원 열에 쓴다
function gridOf(comp: Hex[], seed: number) {
  const rnd = rng(seed), ang = Math.floor(rnd() * 3) * Math.PI / 3;
  const ux = Math.cos(ang), uz = Math.sin(ang), vx = -uz, vz = ux, c = centroid(comp);
  return { rnd, ang, ext: 1.3 + Math.sqrt(comp.length) * 1.4, c, at: (u: number, v: number) => ({ x: c.x + ux * u + vx * v, z: c.z + uz * u + vz * v }) };
}

// 밭: 묶음 전체에 한 방향 이랑. 띠마다 밀/양배추/싹을 번갈아, 묶음 테두리 안쪽만
function farm(ctx: Ctx, comp: Hex[]) {
  const { rnd, ang, ext, c, at } = gridOf(comp, seedOf(comp[0]) + 11);
  const wheat = batch(wheatGeo), sprouts = batch(sproutGeo), cabbage = batch(cabbageGeo);
  const barn = comp.length >= 4 ? toWorld(mostConnected(comp)) : null;
  if (barn) ctx.g.add(placed(barnGeo, barn.x - 0.1, heightFast(barn.x - 0.1, barn.z), barn.z, 1.15, ang + Math.PI / 2));
  const inside = (x: number, z: number) => farmInside(x, z) > 0.16 && slope(x, z) < 0.6 && (!barn || Math.hypot(x - barn.x, z - barn.z) > 0.75);
  for (let v = -ext; v <= ext; v += 0.17) {
    const band = Math.floor((v + ext) / 0.68) % 3;                       // 0 밀, 1 양배추, 2 어린 싹
    const [target, gap] = band === 0 ? [wheat, 0.045] : band === 1 ? [cabbage, 0.11] : [sprouts, 0.06];
    let start: number | null = null;
    for (let u = -ext; u <= ext + 0.06; u += 0.06) {
      const p = at(u, v), ok = u <= ext && inside(p.x, p.z);
      if (ok && start === null) start = u;
      if (!ok && start !== null) {
        if (u - 0.06 - start > 0.1) for (let w = start; w <= u - 0.06; w += gap) {
          const q = at(w, v), px = q.x + (rnd() - 0.5) * 0.02, pz = q.z + (rnd() - 0.5) * 0.02;
          target.push(px, heightFast(px, pz), pz, 0.85 + rnd() * 0.35, rnd() * 6);
        }
        start = null;
      }
    }
  }
  ctx.g.add(wheat.build(), sprouts.build(), cabbage.build());
  comp.slice(0, Math.max(0, comp.length - 1)).forEach((h, i) => {   // 큰 밭엔 곤포와 짚더미, 더 크면 허수아비
    const w = toWorld(h), x = w.x + 0.55, z = w.z - 0.3;
    if (heightFast(x, z) > 0.4) ctx.g.add(placed(i % 2 ? haystackGeo : baleGeo, x, heightFast(x, z), z, 1, rnd() * 6));
  });
  if (comp.length >= 3 && (!barn || Math.hypot(c.x - barn.x, c.z - barn.z) > 0.8)) ctx.g.add(placed(scarecrowGeo, c.x, heightFast(c.x, c.z), c.z, 1.2, ang));
}

// 과수원: 열 맞춘 과일나무, 바구니, 큰 과수원엔 사다리
function orchard(ctx: Ctx, comp: Hex[]) {
  const { rnd, ext, at } = gridOf(comp, seedOf(comp[0]) + 71), trees = batch(fruitTreeGeo, vcFlat);
  const stand = comp.length >= 3 ? toWorld(mostConnected(comp)) : null;
  if (stand) ctx.g.add(placed(fruitStallGeo, stand.x, heightFast(stand.x, stand.z), stand.z, 1.2, rnd() * 6));
  for (let v = -ext; v <= ext; v += 0.42) for (let u = -ext; u <= ext; u += 0.42) {
    const p = at(u, v), x = p.x + (rnd() - 0.5) * 0.06, z = p.z + (rnd() - 0.5) * 0.06, y = heightFast(x, z);
    if (ctx.kindAt(fromWorld(x, z)) !== 'orchard' || y < 0.4 || slope(x, z) > 0.6 || (stand && Math.hypot(x - stand.x, z - stand.z) < 0.4)) continue;
    trees.push(x, y - 0.01, z, 0.85 + rnd() * 0.3, rnd() * 6, [0xffffff, 0xeef8e4, 0xe4ffdc][Math.floor(rnd() * 3)]);
  }
  ctx.g.add(trees.build());
  comp.forEach((h, i) => {
    const w = toWorld(h), x = w.x + 0.25, z = w.z + 0.6;
    if (heightFast(x, z) > 0.4) ctx.g.add(placed(i % 2 ? basketGeo : ladderGeo, x, heightFast(x, z), z, 1, rnd() * 6));
  });
}

// 마을: 1칸이면 집 한 채, 이어지면 칸마다 네 채가 길을 향해. 3칸 이상 우물 광장, 5칸 이상 교회
//  집·문·우물·가판대 자리는 towns 에 기록해 두고, 주민과 생활 소품은 가까이 구경할 때 villagers.ts 가 만든다
function village(ctx: Ctx, comp: Hex[]) {
  const center = comp.length >= 3 ? mostConnected(comp) : undefined, spots: Spot[] = [], allHomes: Home[] = [], stalls: { x: number; z: number; face: number }[] = [];
  for (const h of comp) {
    const rnd = rng(seedOf(h) + 23), c = toWorld(h);
    if (comp.length === 1) {
      const rot = rnd() * 0.6 - 0.3;
      const house = HOUSES[5];   // 외딴 집은 목조 단층
      ctx.g.add(placed(house.geo, c.x, heightFast(c.x, c.z), c.z, 1.25, rot));
      ctx.g.add(placed(crateGeo, c.x + 0.45, heightFast(c.x + 0.45, c.z + 0.2), c.z + 0.2, 1, rnd() * 6));
      ctx.g.add(placed(barrelGeo, c.x - 0.45, heightFast(c.x - 0.45, c.z + 0.25), c.z + 0.25));
      allHomes.push({ x: c.x, z: c.z, face: rot, s: 1.25, tall: house.tall });
      spots.push({ x: c.x + Math.sin(rot) * 0.32, z: c.z + Math.cos(rot) * 0.32, hub: h, kind: 'door' },
        { x: c.x + 0.42, z: c.z + 0.4, hub: h, kind: 'stand', face: Math.PI }, { x: c.x - 0.42, z: c.z + 0.45, hub: h, kind: 'stand', face: Math.PI });
      continue;
    }
    if (center && h === center) {
      ctx.g.add(placed(wellGeo, c.x, heightFast(c.x, c.z), c.z, 1.1));
      for (let i = 0; i < 3; i++) { const a = i * 2.1 + 0.4; spots.push({ x: c.x + Math.cos(a) * 0.27, z: c.z + Math.sin(a) * 0.27, hub: h, kind: 'well', face: Math.atan2(-Math.cos(a), -Math.sin(a)) }); }   // 우물가
      if (comp.length >= 4) for (let i = 0; i < 4; i++) {
        const a = i * Math.PI / 2 + Math.PI / 4, x = c.x + Math.cos(a) * 0.55, z = c.z + Math.sin(a) * 0.55;
        if (comp.length >= 5 && z < c.z - 0.2) continue;   // 교회 자리
        ctx.g.add(placed(marketStallGeo[i], x, heightFast(x, z), z, 1, Math.atan2(c.x - x, c.z - z)));
        spots.push({ x: c.x + Math.cos(a) * 0.36, z: c.z + Math.sin(a) * 0.36, hub: h, kind: 'stall', face: Math.atan2(Math.cos(a), Math.sin(a)) });   // 가판대 손님
        const vx = c.x + Math.cos(a) * 0.72, vz = c.z + Math.sin(a) * 0.72;
        stalls.push({ x: vx, z: vz, face: Math.atan2(c.x - vx, c.z - vz) });   // 상인: 가판대 안쪽
      }
      if (comp.length >= 5) { const x = c.x - 0.15, z = c.z - 0.62; ctx.g.add(placed(churchGeo, x, heightFast(x, z), z, 1.1, 0)); emit({ x, y: heightFast(x, z) + 1, z, kind: 'bell' }); }
      continue;
    }
    const a0 = rnd() * Math.PI * 2, homes: { x: number; z: number }[] = [];
    for (let k = 0; k < 4; k++) {
      for (let t = 0; t < 8; t++) {   // 길을 피해 자리 잡고 문은 칸 중심(길) 쪽으로
        const a = a0 + k * Math.PI / 2 + t * 0.3, rr = 0.5 + (t % 3) * 0.1, x = c.x + Math.cos(a) * rr, z = c.z + Math.sin(a) * rr;
        if (roadDist(x, z) < 0.28 || slope(x, z) > 0.5 || ctx.kindAt(fromWorld(x, z)) !== 'house'
          || homes.some(o => Math.hypot(o.x - x, o.z - z) < 0.48)) continue;
        homes.push({ x, z });
        const face = Math.atan2(c.x - x, c.z - z), y = heightFast(x, z), s = 0.75 + rnd() * 0.15;
        const house = HOUSES[Math.floor(rnd() * HOUSES.length)];
        ctx.g.add(placed(house.geo, x, y - 0.01, z, s, face));
        allHomes.push({ x, z, face, s, tall: house.tall });
        spots.push({ x: x + Math.sin(face) * (0.19 * s + 0.04), z: z + Math.cos(face) * (0.19 * s + 0.04), hub: h, kind: 'door' });
        if (rnd() < 0.6) {   // 집 뒤쪽 옆으로 울타리 한 칸
          const fx = x - Math.sin(face) * 0.26 + Math.cos(face) * 0.12, fz = z - Math.cos(face) * 0.26 - Math.sin(face) * 0.12;
          ctx.g.add(placed(fenceGeo, fx, heightFast(fx, fz), fz, 0.9, face + Math.PI / 2));
        }
        break;
      }
    }
    const trees = batch(broadleafGeo, vcFlat), shrubs = batch(bushGeo);   // 집 사이 빈 곳엔 나무·덤불·벤치·통
    for (let i = 0; i < 6; i++) {
      const p = inHex(rnd, 0.08), x = c.x + p.x, z = c.z + p.z;
      if (roadDist(x, z) < 0.18 || homes.some(o => Math.hypot(o.x - x, o.z - z) < 0.28) || ctx.kindAt(fromWorld(x, z)) !== 'house') continue;
      if (i < 2) trees.push(x, heightFast(x, z), z, 0.55 + rnd() * 0.2, rnd() * 6);
      else if (i < 4) shrubs.push(x, heightFast(x, z), z, 0.8 + rnd() * 0.5, rnd() * 6);
      else ctx.g.add(placed([benchGeo, barrelGeo, crateGeo][i % 3], x, heightFast(x, z), z, 1, rnd() * 6));
    }
    ctx.g.add(trees.build(), shrubs.build());
  }
  const steps = batch(stepGeo, vcFlat);   // 흙길 위 디딤돌
  for (const a of comp) for (const b of neighbors(a)) {
    if (!comp.some(o => key(o) === key(b)) || key(a) > key(b)) continue;
    const pa = toWorld(a), pb = toWorld(b), rnd = rng(seedOf(a) + seedOf(b));
    for (let t = 0.08; t < 0.95; t += 0.09) {
      const x = pa.x + (pb.x - pa.x) * t + (rnd() - 0.5) * 0.08, z = pa.z + (pb.z - pa.z) * t + (rnd() - 0.5) * 0.08;
      steps.push(x, heightFast(x, z) + 0.005, z, 0.035 + rnd() * 0.015, rnd() * 6);
    }
  }
  ctx.g.add(steps.build());
  towns.push({ comp, well: center, homes: allHomes, spots, stalls });
}

// 성: 1칸은 탑 하나. 이어지면 가운데 본채, 바깥 변마다 성벽, 모서리마다 탑, 한 변은 성문으로 비운다
function castle(ctx: Ctx, comp: Hex[]) {
  const center = mostConnected(comp), c = toWorld(center), rnd = rng(seedOf(center) + 61);
  if (comp.length === 1) {
    ctx.g.add(placed(towerGeo, c.x, heightFast(c.x, c.z), c.z, 1.3, rnd() * 6));
    ctx.g.add(placed(crateGeo, c.x + 0.4, heightFast(c.x + 0.4, c.z + 0.2), c.z + 0.2, 1, rnd() * 6));
    return;
  }
  ctx.g.add(placed(keepGeo, c.x, heightFast(c.x, c.z), c.z, 1.15, 0));
  const inComp = (h: Hex) => comp.some(o => key(o) === key(h)), towers = new Map<string, { x: number; z: number }>();
  let gate = false;
  for (const h of comp) {
    const w = toWorld(h), cs = corners(w.x, w.z);
    for (let i = 0; i < 6; i++) {
      const a = cs[i], b = cs[(i + 1) % 6];
      if (inComp(fromWorld(a.x + b.x - w.x, a.z + b.z - w.z))) continue;
      for (const p of [a, b]) towers.set(`${p.x.toFixed(2)},${p.z.toFixed(2)}`, p);
      if (!gate && h !== center) { gate = true; continue; }
      const y = Math.min(heightFast(a.x, a.z), heightFast(b.x, b.z)) - 0.05;
      ctx.g.add(placed(wallGeo, (a.x + b.x) / 2, y, (a.z + b.z) / 2, 1, -Math.atan2(b.z - a.z, b.x - a.x)));
    }
    if (h !== center) ctx.g.add(placed(rnd() < 0.5 ? barrelGeo : crateGeo, w.x + 0.3, heightFast(w.x + 0.3, w.z - 0.2), w.z - 0.2, 1, rnd() * 6));
  }
  for (const p of towers.values()) ctx.g.add(placed(towerGeo, p.x, heightFast(p.x, p.z) - 0.08, p.z, 0.8));
}

// 화산: 분화구에 용암 호수·빛·연기, 비탈엔 검은 바위와 고사목
function volcanoDecor(ctx: Ctx, comp: Hex[]) {
  const { x: cx, z: cz } = centroid(comp), { crater, R: vr } = volcanoSize(comp.length), y = heightFast(cx, cz);
  const lava = new THREE.Mesh(new THREE.CircleGeometry(crater * 0.9, 24).rotateX(-Math.PI / 2), lavaMat);
  lava.position.set(cx, y + 0.04, cz);
  ctx.g.add(lava);
  const light = new THREE.PointLight(0xff5a1a, 2.5, 4);
  light.position.set(cx, y + 0.5, cz);
  ctx.g.add(light);
  ctx.updates.push(puffs(ctx.g, { x: cx, y: y + 0.15, z: cz, n: 16, color: 0x6a6a6a, size: [0.35, 1.8], rise: 3.5, drift: 0.6, speed: 0.1, tex: smokeTex, opacity: 0.5, spread: crater }));
  ctx.updates.push(t => { lavaMat.emissiveIntensity = 2.2 + Math.sin(t * 2.1) * 0.5; });
  eruption(ctx, cx, cz, crater, seedOf(comp[0]) + 901, light);
  const rocks = batch(rockGeo, vcFlat), dead = batch(deadTreeGeo, vcFlat);
  for (const h of comp) {
    const rnd = rng(seedOf(h) + 31), c = toWorld(h);
    for (let i = 0; i < 10; i++) {
      const p = inHex(rnd, 0), x = c.x + p.x, z = c.z + p.z, y2 = heightFast(x, z), d = Math.hypot(x - cx, z - cz);
      if (y2 < 0.45 || d < crater + 0.15) continue;
      if (i < 8) rocks.push(x, y2, z, 0.04 + rnd() * 0.08, rnd() * 6, 0x3a3634);
      else if (d > vr * 0.75) dead.push(x, y2, z, 0.8 + rnd() * 0.5, rnd() * 6);
    }
  }
  ctx.g.add(rocks.build(), dead.build());
}

function mountainDecor(ctx: Ctx, comp: Hex[]) {
  const rocks = batch(rockGeo, vcFlat), pines = batch(pineGeo, vcFlat);
  for (const h of comp) {
    const rnd = rng(seedOf(h) + 31), c = toWorld(h);
    for (let i = 0; i < 7; i++) {
      const p = inHex(rnd, 0.05), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
      if (y > 0.5 && y < 2.1) rocks.push(x, y, z, 0.03 + rnd() * 0.05, rnd() * 6);   // 눈 덮인 곳엔 두지 않음
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

function beachDecor(ctx: Ctx, h: Hex, palms = 3) {
  const rnd = rng(seedOf(h) + 51), c = toWorld(h);
  for (let i = 0; i < palms; i++) {
    const p = inHex(rnd, 0.25), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
    if (y > 0.08) ctx.g.add(placed(palmGeo, x, y, z, 0.85 + rnd() * 0.4, rnd() * 6));
  }
}
// 새 섬: 모래섬에 야자수 둘과 바위 몇 개
function islet(ctx: Ctx, h: Hex) {
  beachDecor(ctx, h, 2);
  const rnd = rng(seedOf(h) + 53), c = toWorld(h), rocks = batch(rockGeo, vcFlat);
  for (let i = 0; i < 4; i++) { const p = inHex(rnd, 0.2), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z); if (y > 0.05) rocks.push(x, y, z, 0.04 + rnd() * 0.06, rnd() * 6); }
  ctx.g.add(rocks.build());
}

function camp(ctx: Ctx, h: Hex) {
  const c = toWorld(h), g = ctx.g, y = (dx: number, dz: number) => heightFast(c.x + dx, c.z + dz);
  g.add(placed(tentGeo, c.x - 0.25, y(-0.25, -0.3), c.z - 0.3, 1, 0.3));
  const fx = c.x + 0.3, fz = c.z + 0.25, fy = y(0.3, 0.25);
  g.add(placed(campGeo, fx, fy, fz));
  g.add(placed(flameGeo, fx, fy + 0.1, fz, 1, 0, flameMat));
  g.add(placed(crateGeo, c.x - 0.6, y(-0.6, 0.1), c.z + 0.1, 1, 0.4));
  g.add(placed(barrelGeo, c.x - 0.5, y(-0.5, 0.3), c.z + 0.3));
  const fire = new THREE.PointLight(0xff8a3a, 1.5, 2.5);
  fire.position.set(fx, fy + 0.3, fz);
  g.add(fire);
  emit({ x: fx, y: fy, z: fz, kind: 'fire' });
  ctx.updates.push(puffs(g, { x: fx, y: fy + 0.15, z: fz, n: 14, color: 0xdddddd, size: [0.15, 1.05], rise: 2.4, drift: 0.4, speed: 0.18, tex: smokeTex, opacity: 0.35 }));
}

// 호숫가: 물가를 따라 돌·갈대, 물 위엔 연잎
export function lakeDecor(ctx: Ctx, lakes: Hex[]) {
  if (!lakes.length) return;
  // 일반 호수: 갈대·돌·연잎 / 빙판: 눈 쌓인 돌만 / 오아시스: 둘레에 야자수, 갈대·연잎
  const stones = batch(rockGeo, vcFlat), reeds = batch(reedGeo), lilies = batch(lilyGeo), palms = batch(PALM, vcFlat);
  for (const h of lakes) {
    const rnd = rng(seedOf(h) + 91), c = toWorld(h), type = lakeType.get(key(h)) ?? 'water';
    for (let i = 0; i < 40; i++) {
      const p = inHex(rnd, -0.4), x = c.x + p.x, z = c.z + p.z, s = surfaceAt(x, z), d = s.h - LAKE_Y;
      if (!s.lake && d > 0.2) continue;
      if (d > -0.02 && d < 0.12) {
        if (type === 'ice') { if (rnd() < 0.4) stones.push(x, s.h, z, 0.04 + rnd() * 0.06, rnd() * 6, 0xe8eef4); }
        else if (type === 'oasis' && rnd() < 0.25) palms.push(x, s.h, z, 0.75 + rnd() * 0.35, rnd() * 6);
        else if (rnd() < 0.55) reeds.push(x, s.h, z, 0.8 + rnd() * 0.5, rnd() * 6);
        else stones.push(x, s.h, z, 0.04 + rnd() * 0.06, rnd() * 6, type === 'oasis' ? 0xc08a5a : 0x9a968c);
      } else if (type !== 'ice' && s.lake && d < -0.12 && rnd() < 0.25) lilies.push(x, LAKE_Y + 0.004, z, 0.6 + rnd() * 0.7, rnd() * 6);
    }
  }
  ctx.g.add(stones.build(), reeds.build(), lilies.build(), palms.build());
  // 빙판: 칸마다 배로 미끄러지며 왔다 갔다 하는 펭귄 하나, 구경하는 펭귄 하나
  for (const h of lakes) {
    if (lakeType.get(key(h)) !== 'ice') continue;
    const rnd = rng(seedOf(h) + 93), c = toWorld(h), a = rnd() * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a), ph = rnd() * 6;
    const slider = new THREE.Group(), body = buildModel('penguin');
    body.rotation.z = -1.35;                  // 배를 깔고 엎드린 자세 (머리가 진행 방향)
    body.position.y = 0.035;
    slider.add(body);
    const watcher = buildModel('penguin');
    const wx = c.x - dz * 0.45, wz = c.z + dx * 0.45;
    watcher.position.set(wx, LAKE_Y, wz);
    watcher.rotation.y = Math.atan2(dz, -dx) + Math.PI / 2;
    ctx.g.add(slider, watcher);
    ctx.updates.push(t => {
      const k = Math.sin(t * 0.8 + ph), v = Math.cos(t * 0.8 + ph), dir = v >= 0 ? 1 : -1;
      slider.position.set(c.x + dx * 0.55 * k, LAKE_Y, c.z + dz * 0.55 * k);
      slider.rotation.y = Math.atan2(-dz * dir, dx * dir);
      watcher.rotation.z = Math.sin(t * 3 + ph) * 0.08;   // 뒤뚱뒤뚱
    });
  }
}

export const LAND_CLUSTER: Partial<Record<Kind, (ctx: Ctx, comp: Hex[]) => void>> = {
  forest, flower: meadow, farm, orchard, house: village, castle, mountain: mountainDecor, volcano: volcanoDecor,
};
export const LAND_SINGLE: Partial<Record<Kind, (ctx: Ctx, h: Hex) => void>> = { grass: grassDecor, camp, islet };

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
