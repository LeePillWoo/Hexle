// 묶음 규모에 따라 열리는 볼거리: 해변(파라솔·비치발리볼·감시탑·비치바), 설원(이글루·산타마을), 사막(낙타·피라미드·스핑크스·오벨리스크),
// 초원(소풍·풍차), 꽃밭(벌통·정자), 산(정상 깃발·산장), 숲(버섯·통나무·나무집), 화산 분화, 밭(헛간·사일로)·과수원(과일 노점)·마을(장터) 모델
import * as THREE from 'three';
import { centroid, mostConnected, toWorld, type Hex } from '../core/hex';
import { rng, seedOf } from '../core/noise';
import { heightFast } from '../world/terrain';
import { emit } from '../audio/emitters';
import type { Kind } from './kinds';
import { batch, glowMat, inHex, lumpy, merge, paint, placed, prism, puffs, slope, smokeTex, vcFlat, type Ctx } from './models';

const W = 0xffffff, WOOD = 0x8a6038, DARKWOOD = 0x6b4a2b, SNOW = 0xf4f7fb, GOLD = 0xe8c050;
const box = (w: number, h: number, d: number, x: number, y: number, z: number, c: number) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), c);
const cyl = (r0: number, r1: number, h: number, x: number, y: number, z: number, c: number, seg = 8) => paint(new THREE.CylinderGeometry(r0, r1, h, seg).translate(x, y, z), c);
const sph = (r: number, x: number, y: number, z: number, c: number, seg = 8) => paint(new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2)).translate(x, y, z), c);
// 네모 피라미드: 변이 축에 맞게 45° 돌린 4각 원뿔
const pyr = (w: number, h: number, c: number) => paint(new THREE.ConeGeometry(w / Math.SQRT2, h, 4).rotateY(Math.PI / 4).translate(0, h / 2, 0), c);
const rockGeo = paint(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.12), 0xffffff);

// 묶음 안 자리 관리: 큰 건물이 차지한 자리에 작은 소품이 겹치지 않게
function spots() {
  const taken: { x: number; z: number; r: number }[] = [];
  return { take(x: number, z: number, r: number) { taken.push({ x, z, r }); }, free: (x: number, z: number, r = 0) => taken.every(t => Math.hypot(t.x - x, t.z - z) > t.r + r) };
}
// 묶음 안 임의 지점 (해당 종류 칸 위, 평평한 곳)
function pointIn(ctx: Ctx, comp: Hex[], rnd: () => number, kind: Kind, margin = 0.15, maxSlope = 0.6) {
  for (let t = 0; t < 30; t++) {
    const h = comp[Math.floor(rnd() * comp.length)], c = toWorld(h), p = inHex(rnd, margin), x = c.x + p.x, z = c.z + p.z;
    if (ctx.kindAt(h) === kind && slope(x, z) < maxSlope) return { x, z, y: heightFast(x, z) };
  }
  return null;
}

// ═════════ 해변 ═════════
const STRIPES = [0xd8352a, 0x2f6fc0, 0xf0b020, 0x3a9a50];
const umbrellaGeo = STRIPES.map(c => merge(
  cyl(0.008, 0.008, 0.42, 0, 0.21, 0, 0xe8e8e8, 5),
  ...Array.from({ length: 8 }, (_, i) => paint(new THREE.ConeGeometry(0.21, 0.09, 2, 1, false, i * Math.PI / 4, Math.PI / 4).translate(0, 0.42, 0), i % 2 ? W : c)),
  sph(0.012, 0, 0.47, 0, W),
));
const loungerGeo = STRIPES.map(c => merge(
  box(0.12, 0.012, 0.26, 0, 0.05, 0, W), box(0.12, 0.012, 0.11, 0, 0.09, -0.15, W).rotateX(0), box(0.1, 0.008, 0.22, 0, 0.06, 0.015, c),
  ...[[-0.05, 0.11], [0.05, 0.11], [-0.05, -0.11], [0.05, -0.11]].map(([x, z]) => cyl(0.006, 0.006, 0.05, x, 0.025, z, W, 4)),
));
const towelGeo = STRIPES.map(c => merge(box(0.13, 0.004, 0.28, 0, 0.003, 0, c), box(0.13, 0.005, 0.03, 0, 0.004, 0.08, W), box(0.13, 0.005, 0.03, 0, 0.004, -0.08, W)));
const courtGeo = merge(
  box(1.3, 0.004, 0.02, 0, 0.004, 0.35, W), box(1.3, 0.004, 0.02, 0, 0.004, -0.35, W), box(0.02, 0.004, 0.72, 0.65, 0.004, 0, W), box(0.02, 0.004, 0.72, -0.65, 0.004, 0, W),
  cyl(0.012, 0.012, 0.38, 0, 0.19, 0.4, 0xd8d8d8, 6), cyl(0.012, 0.012, 0.38, 0, 0.19, -0.4, 0xd8d8d8, 6),
  box(0.006, 0.12, 0.8, 0, 0.29, 0, 0x2a2a2a), box(0.008, 0.02, 0.8, 0, 0.36, 0, W),
);
const ballGeo = merge(sph(0.035, 0, 0.035, 0, W, 10), paint(new THREE.TorusGeometry(0.035, 0.006, 4, 12).translate(0, 0.035, 0), 0xf0c020), paint(new THREE.TorusGeometry(0.035, 0.006, 4, 12).rotateY(Math.PI / 2).translate(0, 0.035, 0), 0x2f6fc0));
const lifeguardGeo = merge(
  ...[[-0.1, -0.1], [0.1, -0.1], [-0.1, 0.1], [0.1, 0.1]].map(([x, z]) => cyl(0.012, 0.012, 0.4, x, 0.2, z, W, 5)),
  box(0.28, 0.03, 0.28, 0, 0.41, 0, W), box(0.22, 0.16, 0.2, 0, 0.51, -0.02, 0xd8352a), box(0.16, 0.08, 0.01, 0, 0.53, 0.085, 0x4a6a8a),
  paint(prism(0.18, 0.3).translate(0, 0.64, -0.02), W),
  ...[0.1, 0.2, 0.3].map(y => box(0.12, 0.012, 0.012, 0, y, 0.22 - y * 0.3, W)), box(0.012, 0.42, 0.012, -0.06, 0.2, 0.17, W), box(0.012, 0.42, 0.012, 0.06, 0.2, 0.17, W),
  cyl(0.005, 0.005, 0.25, 0.12, 0.75, 0, 0x8a8a8a, 4), paint(new THREE.ConeGeometry(0.05, 0.1, 3).rotateZ(-Math.PI / 2).translate(0.17, 0.83, 0), 0xd8352a),
);
const barGeo = merge(
  box(0.5, 0.18, 0.12, 0, 0.09, 0.16, WOOD), box(0.54, 0.02, 0.16, 0, 0.19, 0.16, 0xc49a6a),
  ...[[-0.24, -0.18], [0.24, -0.18], [-0.24, 0.2], [0.24, 0.2]].map(([x, z]) => cyl(0.015, 0.015, 0.42, x, 0.21, z, DARKWOOD, 5)),
  paint(new THREE.ConeGeometry(0.42, 0.22, 4).rotateY(Math.PI / 4).scale(1.1, 1, 0.9).translate(0, 0.5, 0), 0xd8b860),
  box(0.4, 0.14, 0.04, 0, 0.12, -0.18, WOOD),
  ...[-0.15, 0, 0.15].flatMap(x => [cyl(0.03, 0.03, 0.01, x, 0.12, 0.32, 0xd8352a, 8), cyl(0.006, 0.006, 0.12, x, 0.06, 0.32, 0xb0b0b0, 4)]),
  ...[-0.12, 0.02, 0.15].map((x, i) => cyl(0.012, 0.012, 0.05, x, 0.225, 0.14, [0x6ad0e0, 0xf0a030, 0xe060a0][i], 6)),
);
const PALM = (() => {   // 해변용 야자수 (land.ts 와 같은 모양, 가볍게)
  const parts: THREE.BufferGeometry[] = [];
  let x = 0, y = 0;
  for (let i = 0; i < 6; i++) { const r = 0.045 - i * 0.004; parts.push(paint(new THREE.CylinderGeometry(r * 0.92, r, 0.13, 7).rotateZ(-0.05 - i * 0.04).translate(x, y + 0.065, 0), i % 2 ? 0x8a6a45 : 0x7a5c3a)); x += 0.013 + i * 0.006; y += 0.125; }
  for (let k = 0; k < 9; k++) for (let s = 0; s < 2; s++)
    parts.push(paint(new THREE.ConeGeometry(0.06 - s * 0.02, 0.24, 4).rotateZ(-Math.PI / 2).scale(1, 0.18, 1).translate(0.12 + s * 0.22, 0, 0).rotateZ(-0.15 - s * 0.45).rotateY(k / 9 * Math.PI * 2).translate(x, y, 0), s ? 0x3e9a3c : 0x2f8a34));
  for (let k = 0; k < 3; k++) parts.push(sph(0.03, x + Math.cos(k * 2.1) * 0.04, y - 0.04, Math.sin(k * 2.1) * 0.04, 0x5a4020, 6));
  return merge(...parts);
})();
export { PALM as palmGeo };

// 해변: 칸마다 야자수. 2칸↑ 파라솔·선베드·수건(썬텐) / 3칸↑ 비치발리볼장 / 4칸↑ 감시탑 / 6칸↑ 비치바
function beach(ctx: Ctx, comp: Hex[]) {
  const n = comp.length, rnd = rng(seedOf(comp[0]) + 201), sp = spots(), center = mostConnected(comp), cc = toWorld(center);
  const at = (p: { x: number; z: number }, r: number) => { sp.take(p.x, p.z, r); return p; };
  if (n >= 3) {
    const y = heightFast(cc.x, cc.z), rot = Math.floor(rnd() * 3) * Math.PI / 3;
    ctx.g.add(placed(courtGeo, cc.x, y, cc.z, 1, rot), placed(ballGeo, cc.x + 0.3, heightFast(cc.x + 0.3, cc.z + 0.15), cc.z + 0.15));
    at(cc, 0.8);
  }
  if (n >= 4) {
    const p = pointIn(ctx, comp, rnd, 'beach', 0.25);
    if (p && sp.free(p.x, p.z, 0.25)) { ctx.g.add(placed(lifeguardGeo, p.x, p.y, p.z, 1, rnd() * 6)); at(p, 0.3); }
  }
  if (n >= 6) {
    const p = pointIn(ctx, comp, rnd, 'beach', 0.3);
    if (p && sp.free(p.x, p.z, 0.35)) { ctx.g.add(placed(barGeo, p.x, p.y, p.z, 1, rnd() * 6)); at(p, 0.45); }
  }
  if (n >= 2) for (let i = 0; i < n * 2; i++) {   // 파라솔 하나에 선베드 둘, 가끔 수건
    const p = pointIn(ctx, comp, rnd, 'beach', 0.2);
    if (!p || !sp.free(p.x, p.z, 0.25)) continue;
    const c = Math.floor(rnd() * 4), rot = rnd() * 6;
    ctx.g.add(placed(umbrellaGeo[c], p.x, p.y, p.z, 1, rot));
    for (const s of [-1, 1]) {
      const lx = p.x + Math.cos(rot) * 0.12 * s, lz = p.z - Math.sin(rot) * 0.12 * s;
      ctx.g.add(placed(rnd() < 0.7 ? loungerGeo[(c + 1) % 4] : towelGeo[(c + 2) % 4], lx, heightFast(lx, lz), lz, 1, rot));
    }
    at(p, 0.25);
  }
  const palms = batch(PALM, vcFlat);
  for (const h of comp) {
    const r2 = rng(seedOf(h) + 51), c = toWorld(h);
    for (let i = 0; i < 3; i++) {
      const p = inHex(r2, 0.12), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
      if (y > 0.08 && sp.free(x, z, 0.15)) palms.push(x, y, z, 0.85 + r2() * 0.4, r2() * 6);
    }
  }
  ctx.g.add(palms.build());
}

// ═════════ 설원 ═════════
const snowPineGeo = merge(
  cyl(0.03, 0.05, 0.32, 0, 0.16, 0, 0x5a3a22),
  ...[0, 1, 2, 3, 4].flatMap(i => [paint(new THREE.ConeGeometry(0.32 - i * 0.055, 0.36, 12).translate(0, 0.3 + i * 0.17, 0), [0x1e5a2e, 0x24683a, 0x2b7543, 0x33824c, 0x3c8f55][i]),
    paint(new THREE.ConeGeometry(0.33 - i * 0.055, 0.1, 12).translate(0, 0.44 + i * 0.17, 0), SNOW)]),
);
const iceGeo = paint(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.15), 0xcfe8f8);
const snowmanGeo = merge(
  sph(0.11, 0, 0.1, 0, SNOW, 12), sph(0.08, 0, 0.25, 0, SNOW, 12), sph(0.06, 0, 0.36, 0, SNOW, 12),
  paint(new THREE.ConeGeometry(0.012, 0.06, 6).rotateZ(-Math.PI / 2).translate(0.08, 0.36, 0), 0xf08a2a),
  sph(0.008, 0.05, 0.38, 0.02, 0x2a2a2a, 5), sph(0.008, 0.05, 0.38, -0.02, 0x2a2a2a, 5), sph(0.008, 0.075, 0.22, 0, 0x2a2a2a, 5), sph(0.008, 0.075, 0.27, 0, 0x2a2a2a, 5),
  cyl(0.045, 0.045, 0.07, 0, 0.43, 0, 0x2a2a2a, 10), cyl(0.075, 0.075, 0.01, 0, 0.4, 0, 0x2a2a2a, 10),
  paint(new THREE.TorusGeometry(0.06, 0.012, 5, 12).rotateX(Math.PI / 2).translate(0, 0.31, 0), 0xd03a2f),
);
const iglooGeo = merge(
  paint(new THREE.SphereGeometry(0.34, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0xeef3f8),
  paint(new THREE.SphereGeometry(0.14, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.9, 1.3).translate(0, 0, 0.32), 0xe4eaf0),
  box(0.1, 0.1, 0.02, 0, 0.05, 0.5, 0x2a2e36),
  ...[0.08, 0.16, 0.24].map(y => paint(new THREE.TorusGeometry(Math.sqrt(0.34 ** 2 - y ** 2), 0.004, 3, 24).rotateX(Math.PI / 2).translate(0, y, 0), 0xc8d4e0)),
);
const santaHouse = (roof: number, wall: number) => ({
  solid: merge(
    box(0.56, 0.06, 0.46, 0, 0.03, 0, 0x8a8a80), box(0.5, 0.32, 0.4, 0, 0.22, 0, wall),
    ...[-0.25, 0.25].flatMap(x => [box(0.03, 0.32, 0.03, x, 0.22, 0.2, 0x5a3022), box(0.03, 0.32, 0.03, x, 0.22, -0.2, 0x5a3022)]),
    paint(prism(0.33, 0.6).translate(0, 0.54, 0), roof), paint(prism(0.345, 0.62).scale(1, 0.35, 1).translate(0, 0.66, 0), SNOW),
    box(0.08, 0.22, 0.08, 0.15, 0.7, -0.08, 0x9a5040), box(0.1, 0.03, 0.1, 0.15, 0.82, -0.08, SNOW),
    box(0.11, 0.18, 0.02, 0, 0.15, 0.205, 0x2f6a3a), paint(new THREE.TorusGeometry(0.035, 0.012, 5, 12).translate(0, 0.27, 0.215), 0x2f7a3a),
  ),
  glow: merge(...[-0.16, 0.16].map(x => box(0.08, 0.08, 0.02, x, 0.24, 0.205, 0xffd070)), box(0.02, 0.08, 0.08, 0.255, 0.24, 0, 0xffd070)),
});
const SANTA = santaHouse(0xc0302a, 0x8a4a32), WORKSHOP = santaHouse(0x2f7a3a, 0x9a5a3a);
const reindeerGeo = (rudolph: boolean) => ({
  solid: merge(
    paint(new THREE.SphereGeometry(1, 10, 8).scale(0.09, 0.05, 0.045).translate(0, 0.14, 0), 0x8a5a3a),
    paint(new THREE.SphereGeometry(1, 8, 6).scale(0.06, 0.03, 0.035).translate(0.01, 0.12, 0), 0xe8d8c0),
    paint(new THREE.CylinderGeometry(0.018, 0.024, 0.09, 7).rotateZ(-0.6).translate(0.09, 0.2, 0), 0x8a5a3a),
    paint(new THREE.SphereGeometry(1, 8, 6).scale(0.04, 0.025, 0.024).translate(0.13, 0.245, 0), 0x8a5a3a),
    ...[[0.06, 0.025], [0.06, -0.025], [-0.06, 0.025], [-0.06, -0.025]].map(([x, z]) => cyl(0.007, 0.006, 0.11, x, 0.055, z, 0x6a4028, 5)),
    ...[0.014, -0.014].flatMap(z => [
      paint(new THREE.CylinderGeometry(0.004, 0.005, 0.09, 4).rotateX(z > 0 ? 0.5 : -0.5).translate(0.115, 0.31, z * 2), 0xd8c8a0),
      paint(new THREE.CylinderGeometry(0.003, 0.004, 0.04, 4).rotateZ(0.9).translate(0.135, 0.33, z * 2.6), 0xd8c8a0),
      paint(new THREE.CylinderGeometry(0.003, 0.004, 0.035, 4).rotateZ(-0.7).translate(0.1, 0.34, z * 3), 0xd8c8a0)]),
    paint(new THREE.TorusGeometry(0.03, 0.008, 4, 10).rotateY(Math.PI / 2).rotateZ(0.6).translate(0.08, 0.2, 0), 0xc0302a),
    sph(0.01, 0.1, 0.17, 0, GOLD, 5),
    sph(0.005, 0.15, 0.255, 0.018, 0x1a1a1a, 4), sph(0.005, 0.15, 0.255, -0.018, 0x1a1a1a, 4),
    ...(rudolph ? [] : [sph(0.011, 0.172, 0.24, 0, 0x2a1a10, 5)]),
  ),
  glow: rudolph ? sph(0.016, 0.172, 0.24, 0, 0xff2a1a, 8) : null,
});
const RUDOLPH = reindeerGeo(true), REINDEER = reindeerGeo(false);
const sleighGeo = merge(
  box(0.32, 0.1, 0.2, 0, 0.12, 0, 0xc0302a), box(0.08, 0.16, 0.2, -0.14, 0.17, 0, 0xc0302a), box(0.34, 0.02, 0.21, 0, 0.175, 0, GOLD),
  ...[0.09, -0.09].flatMap(z => [box(0.42, 0.012, 0.015, 0, 0.03, z, GOLD), paint(new THREE.TorusGeometry(0.04, 0.008, 4, 10, Math.PI).rotateZ(-Math.PI / 2).translate(0.21, 0.07, z), GOLD),
    cyl(0.006, 0.006, 0.06, 0.08, 0.06, z, GOLD, 4), cyl(0.006, 0.006, 0.06, -0.1, 0.06, z, GOLD, 4)]),
  sph(0.09, -0.04, 0.24, 0, 0x8a6a40, 8), box(0.06, 0.06, 0.06, 0.06, 0.21, 0.04, 0x3a8adc), box(0.05, 0.05, 0.05, 0.08, 0.2, -0.05, 0xe0b020),
);
const xmasTree = {
  solid: merge(snowPineGeo.clone().scale(1.6, 1.6, 1.6), box(0.12, 0.08, 0.12, 0, 0.04, 0, 0x8a3a2a)),
  glow: merge(
    paint(new THREE.OctahedronGeometry(0.07).translate(0, 1.55, 0), 0xffe060),
    ...Array.from({ length: 26 }, (_, i) => { const y = 0.45 + (i / 26) * 0.95, r = 0.48 * (1 - (y - 0.4) / 1.2) + 0.03, a = i * 2.39; return sph(0.022, Math.cos(a) * r, y, Math.sin(a) * r, [0xff3a3a, 0xffd040, 0x40a0ff, 0x60ff80, 0xff80ff][i % 5], 5); }),
  ),
};
const giftGeo = merge(box(0.08, 0.07, 0.08, 0, 0.035, 0, W), box(0.082, 0.072, 0.014, 0, 0.035, 0, GOLD), box(0.014, 0.072, 0.082, 0, 0.035, 0, GOLD), sph(0.014, 0, 0.075, 0, GOLD, 5));
const lampGeo = { solid: merge(cyl(0.008, 0.012, 0.42, 0, 0.21, 0, 0x2a2a2a, 5), box(0.05, 0.012, 0.05, 0, 0.47, 0, 0x2a2a2a)), glow: box(0.04, 0.05, 0.04, 0, 0.44, 0, 0xffe0a0) };
const candyGeo = merge(cyl(0.012, 0.012, 0.3, 0, 0.15, 0, W, 6), paint(new THREE.TorusGeometry(0.04, 0.012, 5, 10, Math.PI).translate(-0.04, 0.3, 0), W),
  ...[0.05, 0.12, 0.19, 0.26].map(y => paint(new THREE.TorusGeometry(0.0125, 0.004, 3, 8).rotateX(Math.PI / 2).translate(0, y, 0), 0xd8302a)));
const placeGlow = (ctx: Ctx, g: { solid: THREE.BufferGeometry; glow: THREE.BufferGeometry | null }, x: number, y: number, z: number, s = 1, rot = 0) => {
  ctx.g.add(placed(g.solid, x, y, z, s, rot));
  if (g.glow) ctx.g.add(placed(g.glow, x, y, z, s, rot, glowMat));
};

// 설원: 눈 덮인 침엽수·얼음·눈사람. 2칸↑ 이글루 / 3칸↑ 산타마을(산타의 집·트리·썰매·루돌프와 순록·선물) / 5칸↑ 장난감 공방·가로등 / 7칸↑ 큰 트리 광장
function snow(ctx: Ctx, comp: Hex[]) {
  const n = comp.length, rnd = rng(seedOf(comp[0]) + 301), sp = spots(), center = mostConnected(comp), cc = toWorld(center);
  if (n >= 3) {
    const y = heightFast(cc.x, cc.z);
    placeGlow(ctx, SANTA, cc.x, y, cc.z - 0.15, 1.1, 0);
    placeGlow(ctx, xmasTree, cc.x + 0.55, heightFast(cc.x + 0.55, cc.z + 0.35), cc.z + 0.35, 0.6);
    const gifts = batch(giftGeo, vcFlat);
    for (let i = 0; i < 6; i++) { const a = rnd() * 6, x = cc.x + 0.55 + Math.cos(a) * 0.2, z = cc.z + 0.35 + Math.sin(a) * 0.2; gifts.push(x, heightFast(x, z), z, 0.7 + rnd() * 0.5, rnd() * 6, [0xd8302a, 0x3a8adc, 0x3aa050, 0xa050d0, 0xf0a020][i % 5]); }
    ctx.g.add(gifts.build());
    // 썰매와 순록 행렬: 루돌프가 맨 앞
    const sx = cc.x - 0.45, sz = cc.z + 0.55, rot = 0.3;
    ctx.g.add(placed(sleighGeo, sx, heightFast(sx, sz), sz, 1, rot));
    const team = Math.min(4, n - 1);
    for (let i = 0; i < team; i++) {
      const d = 0.32 + Math.floor(i / 2) * 0.2, side = i % 2 ? -0.06 : 0.06, x = sx + Math.cos(rot) * d - Math.sin(rot) * side, z = sz - Math.sin(rot) * d - Math.cos(rot) * side;
      placeGlow(ctx, i === team - 1 ? RUDOLPH : REINDEER, x, heightFast(x, z), z, 1, rot);
    }
    if (team % 2 === 0 && team) { const d = 0.32 + Math.floor(team / 2) * 0.2, x = sx + Math.cos(rot) * d, z = sz - Math.sin(rot) * d; placeGlow(ctx, RUDOLPH, x, heightFast(x, z), z, 1, rot); }
    ctx.g.add(placed(candyGeo, cc.x - 0.15, heightFast(cc.x - 0.15, cc.z + 0.25), cc.z + 0.25), placed(candyGeo, cc.x + 0.2, heightFast(cc.x + 0.2, cc.z + 0.25), cc.z + 0.25));
    sp.take(cc.x, cc.z, 0.95);
  }
  if (n >= 5) {
    const others = comp.filter(h => h !== center);
    const w = toWorld(others[Math.floor(rnd() * others.length)]);
    placeGlow(ctx, WORKSHOP, w.x, heightFast(w.x, w.z), w.z, 0.95, Math.atan2(cc.x - w.x, cc.z - w.z));
    sp.take(w.x, w.z, 0.5);
    for (let i = 0; i < 4; i++) { const p = pointIn(ctx, comp, rnd, 'snow', 0.2); if (p && sp.free(p.x, p.z, 0.1)) { placeGlow(ctx, lampGeo, p.x, p.y, p.z); sp.take(p.x, p.z, 0.1); } }
  }
  if (n >= 7) {
    const others = comp.filter(h => h !== center && sp.free(toWorld(h).x, toWorld(h).z, 0.3));
    if (others.length) { const w = toWorld(others[0]); placeGlow(ctx, xmasTree, w.x, heightFast(w.x, w.z), w.z, 1.1); sp.take(w.x, w.z, 0.5); }
  }
  if (n >= 2) {
    const others = comp.filter(h => sp.free(toWorld(h).x, toWorld(h).z, 0.35));
    const h = others[others.length - 1] ?? center, w = toWorld(h);
    if (sp.free(w.x, w.z, 0.35)) { ctx.g.add(placed(iglooGeo, w.x, heightFast(w.x, w.z), w.z, 1, rnd() * 6)); sp.take(w.x, w.z, 0.45); }
  }
  const pines = batch(snowPineGeo, vcFlat), ice = batch(iceGeo, vcFlat);
  comp.forEach((h, idx) => {
    const r2 = rng(seedOf(h) + 81), c = toWorld(h);
    for (let i = 0; i < 11; i++) {
      const p = inHex(r2, 0.06), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
      if (y < 0.4 || slope(x, z) > 0.8 || !sp.free(x, z, 0.12)) continue;
      if (i < 8) pines.push(x, y - 0.02, z, 0.7 + r2() * 0.4, r2() * 6); else ice.push(x, y, z, 0.05 + r2() * 0.08, r2() * 6);
    }
    if (idx % 2 === 0) { const x = c.x + 0.35, z = c.z + 0.2; if (heightFast(x, z) > 0.4 && sp.free(x, z, 0.12)) ctx.g.add(placed(snowmanGeo, x, heightFast(x, z), z, 1, r2() * 6)); }
  });
  ctx.g.add(pines.build(), ice.build());
}

// ═════════ 사막 ═════════
const CACTUS = 0x4f8a3e, STONE = 0xd8b878;
const cactusGeo = merge(
  cyl(0.035, 0.04, 0.42, 0, 0.21, 0, CACTUS, 8), sph(0.035, 0, 0.42, 0, CACTUS, 8),
  paint(new THREE.CylinderGeometry(0.022, 0.022, 0.08, 6).rotateZ(Math.PI / 2).translate(0.06, 0.2, 0), CACTUS), cyl(0.022, 0.022, 0.14, 0.1, 0.27, 0, CACTUS, 6), sph(0.022, 0.1, 0.34, 0, CACTUS, 6),
  paint(new THREE.CylinderGeometry(0.02, 0.02, 0.07, 6).rotateZ(Math.PI / 2).translate(-0.055, 0.27, 0), CACTUS), cyl(0.02, 0.02, 0.1, -0.09, 0.32, 0, CACTUS, 6), sph(0.02, -0.09, 0.37, 0, CACTUS, 6),
  sph(0.012, 0, 0.465, 0, 0xff80a0, 5),
);
const barrelCactusGeo = merge(paint(new THREE.SphereGeometry(0.06, 10, 8).scale(1, 0.85, 1).translate(0, 0.05, 0), 0x5a9a48), ...[0, 1, 2].map(i => sph(0.012, Math.cos(i * 2.1) * 0.015, 0.1, Math.sin(i * 2.1) * 0.015, 0xf0d040, 5)));
const dryBushGeo = merge(...Array.from({ length: 6 }, (_, i) => paint(new THREE.CylinderGeometry(0.003, 0.005, 0.12, 3).translate(0, 0.06, 0).rotateZ(0.5).rotateY(i * 1.05), 0x8a6a40)));
const camelGeo = merge(
  paint(new THREE.SphereGeometry(1, 10, 8).scale(0.12, 0.07, 0.06).translate(0, 0.2, 0), 0xc8955a), paint(new THREE.SphereGeometry(0.06, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(-0.01, 0.24, 0), 0xc8955a),
  paint(new THREE.CylinderGeometry(0.022, 0.03, 0.16, 7).rotateZ(-0.8).translate(0.14, 0.27, 0), 0xc8955a), paint(new THREE.BoxGeometry(0.08, 0.04, 0.045).translate(0.21, 0.32, 0), 0xc8955a),
  ...[[0.07, 0.03], [0.07, -0.03], [-0.07, 0.03], [-0.07, -0.03]].map(([x, z]) => cyl(0.01, 0.008, 0.17, x, 0.085, z, 0xb8854a, 5)),
  box(0.12, 0.012, 0.13, -0.01, 0.27, 0, 0xc0302a), cyl(0.005, 0.005, 0.06, -0.12, 0.19, 0, 0xb8854a, 4), sph(0.005, 0.22, 0.335, 0.016, 0x1a1a1a, 4), sph(0.005, 0.22, 0.335, -0.016, 0x1a1a1a, 4),
);
const pyramidGeo = merge(
  pyr(1.1, 0.75, STONE),
  ...[0.18, 0.36, 0.54].map(y => paint(new THREE.CylinderGeometry((1.1 / Math.SQRT2) * (1 - y / 0.75) + 0.006, (1.1 / Math.SQRT2) * (1 - y / 0.75) + 0.006, 0.012, 4, 1, true).rotateY(Math.PI / 4).translate(0, y, 0), 0xc4a060)),
  pyr(0.16, 0.11, GOLD).translate(0, 0.65, 0), box(0.12, 0.14, 0.02, 0, 0.07, 0.48, 0x5a4428),
);
const sphinxGeo = merge(
  box(1.0, 0.06, 0.5, 0, 0.03, 0, 0xc8a868),
  box(0.6, 0.18, 0.24, -0.08, 0.15, 0, STONE), box(0.2, 0.2, 0.26, -0.3, 0.16, 0, STONE),
  box(0.3, 0.06, 0.07, 0.3, 0.09, 0.07, STONE), box(0.3, 0.06, 0.07, 0.3, 0.09, -0.07, STONE),
  box(0.14, 0.22, 0.2, 0.18, 0.25, 0, STONE), box(0.12, 0.12, 0.11, 0.22, 0.4, 0, 0xd0b070),
  paint(new THREE.ConeGeometry(0.11, 0.18, 4).rotateY(Math.PI / 4).scale(0.9, 1, 1.25).translate(0.19, 0.42, 0), 0x3a6aa8),
  ...[-0.035, 0, 0.035].map(y => box(0.122, 0.012, 0.18, 0.2, 0.39 + y, 0, GOLD)),
  box(0.02, 0.03, 0.02, 0.285, 0.39, 0, 0xc09860), box(0.04, 0.012, 0.03, 0.285, 0.34, 0, 0x8a6a40),
  paint(new THREE.CylinderGeometry(0.01, 0.01, 0.2, 5).rotateX(Math.PI / 2).translate(-0.4, 0.06, 0.13), STONE),
);
const obeliskGeo = merge(box(0.18, 0.06, 0.18, 0, 0.03, 0, 0xc4a060), paint(new THREE.CylinderGeometry(0.045, 0.07, 0.72, 4).rotateY(Math.PI / 4).translate(0, 0.42, 0), 0xd8c08a), pyr(0.065, 0.08, GOLD).translate(0, 0.78, 0),
  ...[0.3, 0.45, 0.6].map(y => box(0.03, 0.03, 0.01, 0, y, 0.048 - y * 0.02, 0x8a6a40)));
const tentDesertGeo = merge(pyr(0.36, 0.3, 0xe8d8b0).scale(1, 1, 1.3), box(0.08, 0.12, 0.01, 0, 0.06, 0.235, 0x7a3a2a), cyl(0.006, 0.006, 0.36, 0, 0.18, 0, DARKWOOD, 4));

// 사막: 선인장·바위·덤불. 2칸↑ 낙타와 천막 / 3칸↑ 피라미드(뭉칠수록 크게) / 4칸↑ 스핑크스 / 5칸↑ 오벨리스크 / 7칸↑ 피라미드 세 개
function desert(ctx: Ctx, comp: Hex[]) {
  const n = comp.length, rnd = rng(seedOf(comp[0]) + 401), sp = spots(), c0 = centroid(comp), center = mostConnected(comp), cc = toWorld(center);
  if (n >= 3) {
    const s = 0.75 + 0.12 * Math.min(n, 7), x = n >= 4 ? cc.x : c0.x, z = n >= 4 ? cc.z - 0.2 : c0.z;
    ctx.g.add(placed(pyramidGeo, x, heightFast(x, z) - 0.04, z, s, 0));
    sp.take(x, z, 0.75 * s);
    if (n >= 4) {   // 피라미드 앞을 지키는 스핑크스
      const sx = x, sz = z + 0.6 * s + 0.35;
      ctx.g.add(placed(sphinxGeo, sx, heightFast(sx, sz) - 0.02, sz, 0.75, -Math.PI / 2));
      sp.take(sx, sz, 0.45);
      if (n >= 5) for (const k of [-1, 1]) { const ox = sx + k * 0.45, oz = sz + 0.25; ctx.g.add(placed(obeliskGeo, ox, heightFast(ox, oz), oz, 1)); sp.take(ox, oz, 0.12); }
    }
    if (n >= 7) {
      const far = [...comp].sort((a, b) => Math.hypot(toWorld(b).x - x, toWorld(b).z - z) - Math.hypot(toWorld(a).x - x, toWorld(a).z - z));
      for (const h of far.slice(0, 2)) { const w = toWorld(h); if (sp.free(w.x, w.z, 0.4)) { ctx.g.add(placed(pyramidGeo, w.x, heightFast(w.x, w.z) - 0.04, w.z, 0.6, 0)); sp.take(w.x, w.z, 0.45); } }
    }
  }
  if (n >= 2) {   // 낙타 행렬과 천막
    const p = pointIn(ctx, comp, rnd, 'desert', 0.3);
    if (p && sp.free(p.x, p.z, 0.3)) {
      const rot = rnd() * 6;
      for (let i = 0; i < Math.min(3, n); i++) { const x = p.x + Math.cos(rot) * i * 0.3, z = p.z - Math.sin(rot) * i * 0.3; if (heightFast(x, z) > 0.4) ctx.g.add(placed(camelGeo, x, heightFast(x, z), z, 1, rot)); }
      sp.take(p.x, p.z, 0.3);
      const t = pointIn(ctx, comp, rnd, 'desert', 0.3);
      if (t && sp.free(t.x, t.z, 0.25)) { ctx.g.add(placed(tentDesertGeo, t.x, t.y, t.z, 1, rnd() * 6)); sp.take(t.x, t.z, 0.25); }
    }
  }
  const cacti = batch(cactusGeo, vcFlat), barrels = batch(barrelCactusGeo, vcFlat), bushes = batch(dryBushGeo), rocks = batch(rockGeo, vcFlat);
  for (const h of comp) {
    const r2 = rng(seedOf(h) + 403), c = toWorld(h);
    for (let i = 0; i < 9; i++) {
      const p = inHex(r2, 0.08), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
      if (y < 0.35 || !sp.free(x, z, 0.1)) continue;
      if (i < 3) cacti.push(x, y - 0.01, z, 0.75 + r2() * 0.5, r2() * 6);
      else if (i < 5) barrels.push(x, y, z, 0.8 + r2() * 0.5, r2() * 6);
      else if (i < 7) bushes.push(x, y, z, 0.8 + r2() * 0.6, r2() * 6);
      else rocks.push(x, y, z, 0.04 + r2() * 0.06, r2() * 6, 0xc08a5a);
    }
  }
  ctx.g.add(cacti.build(), barrels.build(), bushes.build(), rocks.build());
}

// ═════════ 초원·꽃밭 ═════════
const windmillBody = merge(
  cyl(0.11, 0.17, 0.62, 0, 0.31, 0, 0xf2ead8, 8), paint(new THREE.ConeGeometry(0.15, 0.2, 8).translate(0, 0.72, 0), 0x8a4a32),
  box(0.08, 0.13, 0.02, 0, 0.065, 0.16, DARKWOOD), box(0.05, 0.05, 0.02, 0, 0.4, 0.125, 0x3d5a78), cyl(0.02, 0.02, 0.12, 0, 0.62, 0.12, DARKWOOD, 6).rotateX(Math.PI / 2),
);
const bladesGeo = merge(sph(0.03, 0, 0, 0, DARKWOOD, 6), ...[0, 1, 2, 3].map(i => box(0.07, 0.34, 0.008, 0.012, 0.19, 0, 0xe8dcc0).rotateZ(i * Math.PI / 2)),
  ...[0, 1, 2, 3].map(i => box(0.008, 0.36, 0.01, 0, 0.19, 0.005, DARKWOOD).rotateZ(i * Math.PI / 2)));
const picnicGeo = merge(
  box(0.3, 0.004, 0.24, 0, 0.003, 0, 0xd8352a), ...[-0.1, 0, 0.1].map(x => box(0.035, 0.005, 0.24, x, 0.004, 0, W)), ...[-0.08, 0, 0.08].map(z => box(0.3, 0.005, 0.03, 0, 0.0045, z, W)),
  cyl(0.04, 0.035, 0.05, 0.05, 0.03, 0.02, 0xb08a52, 8), paint(new THREE.TorusGeometry(0.035, 0.005, 3, 10, Math.PI).translate(0.05, 0.055, 0.02), 0x8a6a40),
  cyl(0.03, 0.03, 0.005, -0.07, 0.008, -0.04, W, 10), sph(0.015, -0.07, 0.02, -0.04, 0xd8302a, 6), cyl(0.008, 0.008, 0.05, -0.02, 0.028, 0.06, 0x6ac050, 5),
);
const beehiveGeo = merge(box(0.1, 0.04, 0.1, 0, 0.02, 0, WOOD), box(0.11, 0.05, 0.11, 0, 0.065, 0, 0xf0e0b0), box(0.11, 0.05, 0.11, 0, 0.115, 0, 0xf0c040),
  box(0.11, 0.05, 0.11, 0, 0.165, 0, 0xf0e0b0), paint(prism(0.08, 0.13).translate(0, 0.21, 0), 0xa04a35), box(0.03, 0.01, 0.01, 0, 0.05, 0.056, 0x2a2a2a));
const gazeboGeo = merge(
  paint(new THREE.CylinderGeometry(0.36, 0.38, 0.06, 6).translate(0, 0.03, 0), 0xe8e4dc),
  ...Array.from({ length: 6 }, (_, i) => cyl(0.014, 0.014, 0.36, Math.cos(i * Math.PI / 3) * 0.32, 0.24, Math.sin(i * Math.PI / 3) * 0.32, W, 6)),
  paint(new THREE.ConeGeometry(0.42, 0.22, 6).translate(0, 0.53, 0), 0x4a9a8a), paint(new THREE.CylinderGeometry(0.42, 0.42, 0.02, 6).translate(0, 0.42, 0), W),
  sph(0.03, 0, 0.66, 0, GOLD, 6), box(0.3, 0.02, 0.08, 0, 0.12, -0.2, WOOD),
);
function grass(ctx: Ctx, comp: Hex[]) {
  const n = comp.length, rnd = rng(seedOf(comp[0]) + 501), center = mostConnected(comp), cc = toWorld(center);
  if (n >= 3) {   // 풍차: 날개가 돈다
    const y = heightFast(cc.x, cc.z), rot = rnd() * 6;
    ctx.g.add(placed(windmillBody, cc.x, y, cc.z, 1.2, rot));
    const blades = placed(bladesGeo, 0, 0, 0, 1.2);
    const pivot = new THREE.Group();
    pivot.position.set(cc.x + Math.sin(rot) * 0.2, y + 0.75, cc.z + Math.cos(rot) * 0.2);
    pivot.rotation.y = rot;
    pivot.add(blades);
    ctx.g.add(pivot);
    ctx.updates.push(t => { blades.rotation.z = t * 0.8; });
    emit({ x: pivot.position.x, y: pivot.position.y, z: pivot.position.z, kind: 'windmill' });
  }
  if (n >= 2) {
    const others = comp.filter(h => h !== center), w = toWorld(others[0] ?? center), x = w.x + 0.3, z = w.z + 0.2;
    if (heightFast(x, z) > 0.4) ctx.g.add(placed(picnicGeo, x, heightFast(x, z), z, 1.2, rnd() * 6));
  }
}
function flower(ctx: Ctx, comp: Hex[]) {
  const n = comp.length, rnd = rng(seedOf(comp[0]) + 601), center = mostConnected(comp), cc = toWorld(center);
  if (n >= 4) ctx.g.add(placed(gazeboGeo, cc.x, heightFast(cc.x, cc.z) - 0.02, cc.z, 1.1, rnd() * 6));
  if (n >= 2) for (let i = 0; i < Math.min(4, n); i++) {
    const p = pointIn(ctx, comp, rnd, 'flower', 0.15);
    if (p && Math.hypot(p.x - cc.x, p.z - cc.z) > (n >= 4 ? 0.5 : 0)) ctx.g.add(placed(beehiveGeo, p.x, p.y, p.z, 1, rnd() * 6));
  }
}

// ═════════ 산 ═════════
const cairnGeo = merge(sph(0.06, 0, 0.04, 0, 0x8a8680, 6), sph(0.045, 0.01, 0.1, 0, 0x9a968e, 6), sph(0.03, 0, 0.15, 0.01, 0x8a8680, 6),
  cyl(0.006, 0.006, 0.4, 0.04, 0.2, 0, 0x6a6a6a, 4), paint(new THREE.ConeGeometry(0.06, 0.13, 3).rotateZ(-Math.PI / 2).scale(1, 1, 0.1).translate(0.105, 0.35, 0), 0xd03a2f));
const cabinGeo = merge(
  ...[0, 1, 2, 3, 4].map(i => paint(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 6).rotateZ(Math.PI / 2).translate(0, 0.03 + i * 0.05, 0.16), 0x7a5232)),
  ...[0, 1, 2, 3, 4].map(i => paint(new THREE.CylinderGeometry(0.025, 0.025, 0.42, 6).rotateZ(Math.PI / 2).translate(0, 0.03 + i * 0.05, -0.16), 0x7a5232)),
  box(0.38, 0.25, 0.3, 0, 0.13, 0, 0x6a4628), paint(prism(0.27, 0.5).translate(0, 0.37, 0), 0x3a3a40), paint(prism(0.28, 0.52).scale(1, 0.3, 1).translate(0, 0.43, 0), SNOW),
  box(0.07, 0.2, 0.07, 0.13, 0.42, -0.06, 0x7a7a7a), box(0.08, 0.13, 0.02, 0, 0.08, 0.16, 0x3a2a1a), box(0.07, 0.07, 0.02, 0.12, 0.15, 0.17, 0xffd070),
);
function mountain(ctx: Ctx, comp: Hex[]) {
  const n = comp.length, rnd = rng(seedOf(comp[0]) + 701);
  if (n >= 2) {   // 정상: 표본점 중 가장 높은 곳에 돌무더기와 깃발
    let top = { x: 0, z: 0, y: -9 };
    for (let i = 0; i < 60; i++) { const h = comp[Math.floor(rnd() * n)], c = toWorld(h), p = inHex(rnd, 0), y = heightFast(c.x + p.x, c.z + p.z); if (y > top.y) top = { x: c.x + p.x, z: c.z + p.z, y }; }
    ctx.g.add(placed(cairnGeo, top.x, top.y - 0.03, top.z, 1.2, rnd() * 6));
  }
  if (n >= 4) {   // 중턱 산장: 평평하고 적당히 높은 곳, 굴뚝 연기
    for (let i = 0; i < 80; i++) {
      const h = comp[Math.floor(rnd() * n)], c = toWorld(h), p = inHex(rnd, 0.1), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
      if (y < 0.85 || y > 1.6 || slope(x, z) > 0.7) continue;
      const rot = rnd() * 6;
      ctx.g.add(placed(cabinGeo, x, y - 0.03, z, 1, rot));
      ctx.updates.push(puffs(ctx.g, { x: x + Math.cos(rot) * 0.13 - Math.sin(rot) * 0.06, y: y + 0.5, z: z - Math.sin(rot) * 0.13 - Math.cos(rot) * 0.06, n: 8, color: 0xdddddd, size: [0.06, 0.4], rise: 1, drift: 0.2, speed: 0.15, tex: smokeTex, opacity: 0.35 }));
      break;
    }
  }
}

// ═════════ 숲 ═════════
const mushroomGeo = merge(cyl(0.012, 0.015, 0.05, 0, 0.025, 0, 0xf2ead8, 6), paint(new THREE.SphereGeometry(0.035, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(0, 0.045, 0), 0xd8302a),
  ...[0, 1, 2, 3, 4].map(i => sph(0.006, Math.cos(i * 1.3) * 0.02, 0.065 - (i % 2) * 0.008, Math.sin(i * 1.3) * 0.02, W, 4)));
const logGeo = merge(paint(new THREE.CylinderGeometry(0.035, 0.04, 0.4, 8).rotateZ(Math.PI / 2).translate(0, 0.035, 0), 0x6a4a2a),
  paint(new THREE.CircleGeometry(0.035, 8).rotateY(Math.PI / 2).translate(0.201, 0.035, 0), 0xc8a070), sph(0.02, 0.05, 0.07, 0.02, 0x4a8a3a, 5));
const treehouseGeo = merge(
  cyl(0.07, 0.11, 1.3, 0, 0.65, 0, 0x6a4628, 8),
  paint(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 10).translate(0, 0.7, 0), 0x9a7048), ...Array.from({ length: 10 }, (_, i) => cyl(0.006, 0.006, 0.1, Math.cos(i * 0.628) * 0.29, 0.76, Math.sin(i * 0.628) * 0.29, 0x7a5432, 4)),
  box(0.26, 0.2, 0.22, 0.04, 0.82, 0.02, 0xa8784a), paint(prism(0.17, 0.32).translate(0.04, 0.98, 0.02), 0x8a3a2a), box(0.06, 0.1, 0.01, 0.04, 0.77, 0.135, 0x3a2a1a),
  box(0.06, 0.06, 0.01, -0.06, 0.85, 0.135, 0xffd070),
  ...[0.1, 0.22, 0.34, 0.46, 0.58].map(y => box(0.1, 0.012, 0.012, 0.18, y, 0.2, 0x9a7048)), box(0.012, 0.66, 0.012, 0.13, 0.33, 0.2, 0x9a7048), box(0.012, 0.66, 0.012, 0.23, 0.33, 0.2, 0x9a7048),
  paint(new THREE.IcosahedronGeometry(0.42, 1).translate(0, 1.3, 0), 0x3a8a3a), paint(new THREE.IcosahedronGeometry(0.3, 1).translate(0.25, 1.15, -0.15), 0x4a9a42),
  paint(new THREE.IcosahedronGeometry(0.28, 1).translate(-0.25, 1.2, 0.1), 0x2f7a33),
);
function forest(ctx: Ctx, comp: Hex[]) {
  const n = comp.length, shrooms = batch(mushroomGeo, vcFlat), logs = batch(logGeo, vcFlat);
  for (const h of comp) {
    const rnd = rng(seedOf(h) + 801), c = toWorld(h);
    for (let i = 0; i < 4; i++) { const p = inHex(rnd, 0.1), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z); if (y > 0.4) shrooms.push(x, y, z, 0.7 + rnd() * 0.8, rnd() * 6); }
    if (rnd() < 0.6) { const p = inHex(rnd, 0.2), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z); if (y > 0.4 && slope(x, z) < 0.5) logs.push(x, y, z, 0.8 + rnd() * 0.4, rnd() * 6); }
  }
  ctx.g.add(shrooms.build(), logs.build());
  if (n >= 6) {   // 나무집: 공터가 아닌 깊은 칸 (공터는 가장 깊은 칸)
    const deep = [...comp].sort((a, b) => ctxDepth(ctx, b) - ctxDepth(ctx, a));
    const h = deep[Math.min(1, deep.length - 1)], c = toWorld(h), x = c.x + 0.35, z = c.z - 0.3;
    if (heightFast(x, z) > 0.4) ctx.g.add(placed(treehouseGeo, x, heightFast(x, z) - 0.03, z, 1, 0.4));
  }
}
const ctxDepth = (ctx: Ctx, h: Hex) => [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]].filter(([dq, dr]) => ctx.kindAt({ q: h.q + dq, r: h.r + dr }) === 'forest').length;

// ═════════ 밭·과수원·마을에 쓰는 건물 ═════════
export const barnGeo = merge(
  box(0.5, 0.32, 0.4, 0, 0.16, 0, 0xa8322a), ...[-0.25, 0.25].flatMap(x => [box(0.02, 0.32, 0.02, x, 0.16, 0.2, W), box(0.02, 0.32, 0.02, x, 0.16, -0.2, W)]),
  paint(new THREE.CylinderGeometry(0.29, 0.29, 0.54, 4, 1, false, 0, Math.PI).rotateZ(Math.PI / 2).rotateX(-Math.PI / 2).scale(1, 0.7, 1).translate(0, 0.32, 0), 0x4a3a32),
  box(0.2, 0.22, 0.02, 0, 0.11, 0.205, W), box(0.18, 0.2, 0.01, 0, 0.11, 0.212, 0xa8322a), box(0.24, 0.02, 0.012, 0, 0.11, 0.216, W).rotateZ(0.0),
  paint(new THREE.BoxGeometry(0.26, 0.015, 0.012).rotateZ(0.83).translate(0, 0.11, 0.218), W), paint(new THREE.BoxGeometry(0.26, 0.015, 0.012).rotateZ(-0.83).translate(0, 0.11, 0.218), W),
  box(0.08, 0.08, 0.02, 0, 0.36, 0.205, 0xf0e0b0),
  cyl(0.1, 0.1, 0.58, 0.38, 0.29, -0.05, 0xc8c8c8, 12), paint(new THREE.SphereGeometry(0.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.38, 0.58, -0.05), 0x8a8a8a),
  ...[0.12, 0.26, 0.4].map(y => paint(new THREE.TorusGeometry(0.101, 0.006, 3, 16).rotateX(Math.PI / 2).translate(0.38, y, -0.05), 0x9a9a9a)),
);
const stall = (awning: number) => merge(
  box(0.34, 0.12, 0.16, 0, 0.06, 0, WOOD), ...[[-0.16, -0.08], [0.16, -0.08], [-0.16, 0.08], [0.16, 0.08]].map(([x, z]) => cyl(0.008, 0.008, 0.32, x, 0.16, z, DARKWOOD, 4)),
  ...[0, 1, 2, 3, 4, 5].map(i => paint(new THREE.BoxGeometry(0.06, 0.012, 0.24).rotateX(0.35).translate(-0.15 + i * 0.06, 0.33, 0.02), i % 2 ? W : awning)),
);
export const fruitStallGeo = merge(stall(0xd8302a), ...[-0.1, 0, 0.1].flatMap(x => [box(0.08, 0.03, 0.1, x, 0.135, 0, 0xb08a52), ...[0, 1, 2].map(k => sph(0.016, x + (k - 1) * 0.022, 0.16, (k % 2) * 0.02 - 0.01, k === 1 ? 0x9ac040 : 0xd8302a, 5))]));
export const marketStallGeo = [0x2f6fc0, 0x3a9a50, 0xf0a020, 0x8a50c0].map(c => merge(stall(c), ...[-0.1, 0, 0.1].map((x, i) => box(0.07, 0.03, 0.08, x, 0.135, 0, [0xf0d080, 0xc06a3a, 0x90c060][i]))));

// ═════════ 화산 분화: 주기적으로 용암이 솟고, 비탈을 따라 흘러내린 뒤 식어 사라진다 ═════════
const lavaVS = /* glsl */`
attribute float aT; attribute float aS;
varying float vT; varying float vS;
void main() { vT = aT; vS = aS; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const lavaFS = /* glsl */`
uniform float grow, heat, fade, time;
varying float vT; varying float vS;
void main() {
  if (vT > grow) discard;
  float edge = 1.0 - abs(vS);
  float pulse = 0.75 + 0.25 * sin(vT * 38.0 - time * 4.0);
  float h = clamp(heat * pulse - (1.0 - edge) * 0.35, 0.0, 1.0);
  vec3 hot = mix(vec3(0.85, 0.12, 0.01), vec3(1.0, 0.5, 0.08), edge * heat) * 1.5;
  vec3 col = mix(vec3(0.07, 0.055, 0.05), hot, h);
  float a = (1.0 - fade) * smoothstep(0.0, 0.3, edge) * smoothstep(grow, grow - 0.04, vT);
  gl_FragColor = vec4(col, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
// 분화구 가장자리에서 가장 가파르게 내려가는 길을 따라간다 (바다·평지에 닿으면 멈춤)
function lavaPath(cx: number, cz: number, a: number, start: number) {
  let x = cx + Math.cos(a) * start, z = cz + Math.sin(a) * start, dir = a;
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i < 90; i++) {
    const y = heightFast(x, z);
    pts.push(new THREE.Vector3(x, y + 0.02, z));
    if (y < 0.2) break;
    let best = { y, d: dir };
    for (let k = -4; k <= 4; k++) { const d = dir + k * 0.3, yy = heightFast(x + Math.cos(d) * 0.09, z + Math.sin(d) * 0.09); if (yy < best.y) best = { y: yy, d }; }
    if (best.y > y - 0.002) break;
    dir = best.d; x += Math.cos(dir) * 0.09; z += Math.sin(dir) * 0.09;
  }
  return pts;
}
function ribbon(pts: THREE.Vector3[], w0: number) {
  const pos: number[] = [], at: number[] = [], as: number[] = [], idx: number[] = [], n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
    const nx = -tz / l, nz = tx / l, w = w0 * (1 - 0.45 * i / n) * (0.8 + 0.4 * Math.sin(i * 0.7));
    for (const s of [-1, 1]) { const x = pts[i].x + nx * w * s, z = pts[i].z + nz * w * s; pos.push(x, Math.max(pts[i].y, heightFast(x, z) + 0.02), z); at.push(i / (n - 1)); as.push(s); }
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aT', new THREE.Float32BufferAttribute(at, 1));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(as, 1));
  g.setIndex(idx);
  return g;
}
export function eruption(ctx: Ctx, cx: number, cz: number, crater: number, seed: number, light: THREE.PointLight) {
  const rnd = rng(seed), period = 38, offset = rnd() * period;
  let te = 99;   // 분화 시작 뒤 지난 시간 (소리에서 읽는다)
  emit({ x: cx, y: heightFast(cx, cz), z: cz, kind: 'volcano', level: () => te < 6 ? 1 : te < 20 ? 0.5 : 0 });
  const mat = new THREE.ShaderMaterial({ uniforms: { grow: { value: 0 }, heat: { value: 1 }, fade: { value: 1 }, time: { value: 0 } }, vertexShader: lavaVS, fragmentShader: lavaFS,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, side: THREE.DoubleSide });
  const streams = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const pts = lavaPath(cx, cz, rnd() * Math.PI * 2, crater * 1.05);
    if (pts.length > 5) streams.add(new THREE.Mesh(ribbon(pts, 0.05 + rnd() * 0.04), mat));
  }
  streams.renderOrder = 2;
  ctx.g.add(streams);
  // 용암 분수: 주황 불똥이 포물선으로 튀었다 떨어진다
  const sparks: { s: THREE.Sprite; v: THREE.Vector3; d: number }[] = [], y0 = heightFast(cx, cz) + 0.1;
  for (let i = 0; i < 36; i++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, color: 0xff7a20, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
    const a = rnd() * 6.283, r = 0.3 + rnd() * 0.7;
    sparks.push({ s, v: new THREE.Vector3(Math.cos(a) * r, 2.2 + rnd() * 1.6, Math.sin(a) * r), d: rnd() * 1.2 });
    s.visible = false;
    ctx.g.add(s);
  }
  ctx.updates.push(t => {
    te = (t + offset) % period;
    const u = mat.uniforms;
    u.time.value = t;
    u.grow.value = Math.min(1, Math.max(0, (te - 1) / 7));
    u.heat.value = 1 - Math.min(1, Math.max(0, (te - 11) / 9));
    u.fade.value = te < 1 ? 1 : Math.min(1, Math.max(0, (te - 22) / 8));
    streams.visible = te < 30.5;
    const erupting = te < 6;
    light.intensity = erupting ? 6 + Math.sin(t * 20) * 1.5 : 2.5;
    for (const p of sparks) {
      const tau = ((te + p.d) % 1.3);
      p.s.visible = erupting;
      if (!erupting) continue;
      p.s.position.set(cx + p.v.x * tau, y0 + p.v.y * tau - 4.9 * tau * tau * 0.6, cz + p.v.z * tau);
      p.s.scale.setScalar(0.12 + 0.1 * (1 - tau / 1.3));
      (p.s.material as THREE.SpriteMaterial).opacity = 1 - tau / 1.3;
    }
  });
}

export const EXTRA_CLUSTER: Partial<Record<Kind, (ctx: Ctx, comp: Hex[]) => void>> = { beach, snow, desert, grass, flower, mountain, forest };
