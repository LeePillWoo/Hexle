// 바닷속 타일 장식: 산호초·해초숲·용궁·난파선·유적·해구·조개밭. 묶음이 클수록 더 많이, 더 크게.
import * as THREE from 'three';
import { centroid, corners, fromWorld, key, mostConnected, R, toWorld, type Hex } from '../core/hex';
import { rng, seedOf } from '../core/noise';
import { heightFast } from '../world/terrain';
import { makeSchool } from '../items/models';
import type { SeaKind } from './kinds';
import { batch, bubbleTex, glowMat, inHex, lumpy, merge, paint, placed, puffs, slope, swayMat, vc, vcFlat, type Ctx } from './models';

// ── 모델 (흰색으로 칠한 것은 인스턴스 색으로 물들인다) ──
const W = 0xffffff;
const rockGeo = paint(lumpy(new THREE.IcosahedronGeometry(1, 1), 0.12), 0x9a968c);
const branchCoral = merge(
  paint(new THREE.CylinderGeometry(0.02, 0.03, 0.18, 7).translate(0, 0.09, 0), W),
  ...[0, 1, 2, 3, 4, 5].flatMap(i => {
    const a = i * 1.05, t = 0.5 + (i % 3) * 0.2;
    return [paint(new THREE.CylinderGeometry(0.012, 0.02, 0.16, 6).translate(0, 0.08, 0).rotateZ(t).rotateY(a).translate(0, 0.12 + (i % 2) * 0.04, 0), W),
      paint(new THREE.SphereGeometry(0.02, 6, 5).translate(Math.sin(t) * 0.16 * Math.cos(a), 0.12 + (i % 2) * 0.04 + Math.cos(t) * 0.16, -Math.sin(t) * 0.16 * Math.sin(a)), W)];
  }),
);
const brainCoral = paint(lumpy(new THREE.IcosahedronGeometry(1, 2), 0.08).scale(0.12, 0.09, 0.11).translate(0, 0.07, 0), W);
const fanCoral = merge(
  paint(new THREE.CylinderGeometry(0.012, 0.018, 0.06, 6).translate(0, 0.03, 0), W),
  paint(new THREE.BoxGeometry(0.2, 0.2, 0.008).translate(0, 0.14, 0), W),
  paint(new THREE.BoxGeometry(0.12, 0.14, 0.008).rotateZ(-0.5).translate(0.09, 0.17, 0), W),
  paint(new THREE.BoxGeometry(0.1, 0.12, 0.008).rotateZ(0.5).translate(-0.08, 0.16, 0), W),
);
const tubeCoral = merge(...[0, 1, 2, 3, 4, 5].map(i => {
  const a = i * 1.05, r = 0.035 + (i % 2) * 0.02, h = 0.1 + (i * 37 % 10) * 0.012;
  return paint(new THREE.CylinderGeometry(0.02, 0.025, h, 7).translate(Math.cos(a) * r, h / 2, Math.sin(a) * r), W);
}));
const anemone = merge(
  paint(new THREE.SphereGeometry(0.05, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), W),
  ...Array.from({ length: 16 }, (_, i) => { const a = i * 2.4, r = 0.012 + (i % 4) * 0.01; return paint(new THREE.ConeGeometry(0.008, 0.07, 5).translate(0, 0.035, 0).rotateZ(0.25 + r * 8).rotateY(a).translate(Math.cos(a) * r, 0.045, -Math.sin(a) * r), W); }),
);
// 켈프 한 가닥: 줄기 + 어긋난 잎 + 공기주머니. 줄기는 살짝 어둡게 칠해 물들여도 잎과 구분
const kelpStrand = merge(
  paint(new THREE.CylinderGeometry(0.008, 0.012, 1.4, 5).translate(0, 0.7, 0), 0xc8d8c0),
  ...[0, 1, 2, 3, 4, 5, 6, 7].map(j => paint(new THREE.BoxGeometry(0.12, 0.05, 0.004).rotateZ(j % 2 ? 0.45 : -0.45).translate(j % 2 ? 0.05 : -0.05, 0.18 + j * 0.16, 0).rotateY(j * 0.6), W)),
  ...[0, 1, 2, 3].map(j => paint(new THREE.SphereGeometry(0.016, 6, 5).translate(0, 0.3 + j * 0.3, 0), 0xe8ffd0)),
);
const seaweedTuft = merge(...[0, 1, 2].flatMap(k => [0, 1, 2].map(j =>
  paint(new THREE.BoxGeometry(0.03, 0.11, 0.004).rotateZ(j % 2 ? 0.25 : -0.25).translate(Math.cos(k * 2.1) * 0.02 + j * 0.012, 0.06 + j * 0.1, Math.sin(k * 2.1) * 0.02).rotateY(k * 2.1), W))));
const shellGeo = merge(paint(new THREE.ConeGeometry(0.035, 0.09, 10).rotateZ(-1.2).translate(0.01, 0.03, 0), W), paint(new THREE.TorusGeometry(0.03, 0.007, 6, 14).rotateX(Math.PI / 2).translate(-0.025, 0.025, 0), 0xe0c0c0), paint(new THREE.SphereGeometry(0.02, 8, 6).translate(-0.03, 0.03, 0), W));
const starGeo = merge(paint(new THREE.SphereGeometry(0.03, 8, 6).scale(1, 0.5, 1).translate(0, 0.012, 0), W),
  ...[0, 1, 2, 3, 4].map(i => { const a = i / 5 * Math.PI * 2; return paint(new THREE.ConeGeometry(0.022, 0.09, 6).scale(1, 1, 0.7).rotateZ(-Math.PI / 2).rotateY(-a).translate(Math.cos(a) * 0.045, 0.012, Math.sin(a) * 0.045), W); }));
const urchinGeo = merge(paint(new THREE.SphereGeometry(0.04, 10, 8).translate(0, 0.04, 0), 0x3a2048),
  ...Array.from({ length: 24 }, (_, i) => { const y = 1 - (i / 23) * 1.8, r = Math.sqrt(1 - y * y), a = i * 2.399, dx = Math.cos(a) * r, dz = Math.sin(a) * r;
    return paint(new THREE.ConeGeometry(0.004, 0.06, 4).rotateZ(-Math.PI / 2).rotateZ(Math.asin(y)).rotateY(-Math.atan2(dz, dx)).translate(dx * 0.06, 0.04 + y * 0.06, dz * 0.06), 0x5a3070); }));
const dollarGeo = paint(new THREE.CircleGeometry(0.04, 12).rotateX(-Math.PI / 2).translate(0, 0.005, 0), 0xf0ead8);
const columnGeo = merge(paint(new THREE.BoxGeometry(0.14, 0.04, 0.14).translate(0, 0.02, 0), 0xb8b4a8), paint(new THREE.CylinderGeometry(0.05, 0.055, 0.5, 10).translate(0, 0.29, 0), 0xc4c0b4), paint(new THREE.BoxGeometry(0.14, 0.04, 0.14).translate(0, 0.56, 0), 0xb8b4a8));
const brokenColumn = merge(paint(new THREE.BoxGeometry(0.14, 0.04, 0.14).translate(0, 0.02, 0), 0xb8b4a8), paint(new THREE.CylinderGeometry(0.05, 0.055, 0.22, 10).translate(0, 0.15, 0).rotateZ(0.18), 0xc4c0b4));
const slabGeo = paint(new THREE.BoxGeometry(0.3, 0.04, 0.2).translate(0, 0.02, 0), 0xa8a49a);
const statueGeo = merge(
  paint(new THREE.BoxGeometry(0.26, 0.1, 0.26).translate(0, 0.05, 0), 0xa8a49a), paint(new THREE.CylinderGeometry(0.06, 0.08, 0.3, 8).translate(0, 0.25, 0), 0xc0bcb0),
  paint(new THREE.BoxGeometry(0.16, 0.2, 0.1).translate(0, 0.5, 0), 0xc0bcb0), paint(new THREE.SphereGeometry(0.06, 8, 6).translate(0, 0.66, 0), 0xc0bcb0),
  paint(new THREE.BoxGeometry(0.05, 0.18, 0.05).rotateZ(0.4).translate(0.12, 0.5, 0), 0xc0bcb0), paint(new THREE.BoxGeometry(0.05, 0.18, 0.05).translate(-0.1, 0.48, 0), 0xc0bcb0),
);
const archGeo = merge(columnGeo.clone().translate(-0.3, 0, 0), columnGeo.clone().translate(0.3, 0, 0), paint(new THREE.BoxGeometry(0.78, 0.08, 0.16).translate(0, 0.62, 0), 0xb8b4a8));
// 난파선: 기울어진 선체, 부러진 돛대와 찢어진 돛
const hullGeo = merge(
  paint(new THREE.BoxGeometry(0.9, 0.3, 0.36).translate(0, 0.15, 0), 0x6a4a2a), paint(new THREE.ConeGeometry(0.18, 0.3, 4).rotateZ(-Math.PI / 2).rotateX(Math.PI / 4).translate(0.58, 0.15, 0), 0x6a4a2a),
  paint(new THREE.BoxGeometry(0.86, 0.02, 0.32).translate(0, 0.31, 0), 0x8a6a3a), paint(new THREE.BoxGeometry(0.22, 0.14, 0.26).translate(-0.28, 0.38, 0), 0x6a4a2a),
  ...[0.17, -0.17].map(z => paint(new THREE.BoxGeometry(0.9, 0.05, 0.02).translate(0, 0.34, z), 0x5a3a22)),
  paint(new THREE.BoxGeometry(0.2, 0.1, 0.02).translate(0.2, 0.1, 0.19), 0x1a1a1a),   // 구멍
);
const mastGeo = merge(paint(new THREE.CylinderGeometry(0.02, 0.025, 0.9, 6).translate(0, 0.45, 0), 0x5a3a22), paint(new THREE.BoxGeometry(0.5, 0.025, 0.025).translate(0, 0.7, 0), 0x5a3a22),
  paint(new THREE.BoxGeometry(0.4, 0.3, 0.006).translate(-0.05, 0.52, 0.01), 0xd8d0c0));
const barrelGeo = merge(paint(new THREE.CylinderGeometry(0.07, 0.07, 0.17, 14).translate(0, 0.085, 0), 0x8a5a33), ...[0.03, 0.14].map(y => paint(new THREE.CylinderGeometry(0.073, 0.073, 0.015, 14).translate(0, y, 0), 0x4a4a4a)));
const plankGeo = paint(new THREE.BoxGeometry(0.3, 0.02, 0.07).translate(0, 0.01, 0), 0x7a5a3a);
const chestGeo = merge(paint(new THREE.BoxGeometry(0.14, 0.1, 0.1).translate(0, 0.05, 0), 0x8a5a33), paint(new THREE.BoxGeometry(0.14, 0.03, 0.1).rotateZ(1.0).translate(-0.06, 0.14, 0), 0x8a5a33),
  ...[0.04, -0.04].map(x => paint(new THREE.BoxGeometry(0.015, 0.102, 0.102).translate(x, 0.05, 0), 0xd8b030)));
const coinsGeo = merge(paint(new THREE.SphereGeometry(1, 8, 6).scale(0.05, 0.02, 0.035).translate(0, 0.1, 0), 0xffd040), paint(new THREE.SphereGeometry(0.012, 6, 5).translate(0.02, 0.105, 0.01), 0xffd040));
const glowDot = paint(new THREE.SphereGeometry(0.025, 6, 5), W);
const spireGeo = paint(lumpy(new THREE.ConeGeometry(0.1, 0.6, 6), 0.1).translate(0, 0.3, 0), 0x2e2e36);

// ── 용궁 ──
const JADE = 0x2f8f7a, RED = 0xb8352c, GOLD = 0xe0b040, WALL = 0xf2e8d8;
// 네모 피라미드 지붕: 4각 원뿔을 45° 돌려 변을 축에 맞추고 가로세로를 따로 늘린다
const roof = (w: number, d: number, h: number, c = JADE) => paint(new THREE.ConeGeometry(1, 1, 4).rotateY(Math.PI / 4).scale((w / 2) * Math.SQRT2, h, (d / 2) * Math.SQRT2), c);
// 전각: 기단·붉은 기둥·벽·문·격자창·층층 지붕·용마루. 입구는 +z. { solid, glow } 두 지오메트리
function hall(w: number, d: number, tiers: number) {
  const parts: THREE.BufferGeometry[] = [
    paint(new THREE.BoxGeometry(w + 0.3, 0.08, d + 0.3).translate(0, 0.04, 0), 0x8a9aa8), paint(new THREE.BoxGeometry(w + 0.1, 0.03, d + 0.1).translate(0, 0.095, 0), 0xa8b4bc),
    paint(new THREE.BoxGeometry(w, 0.4, d).translate(0, 0.3, 0), WALL),
    paint(new THREE.BoxGeometry(0.14, 0.24, 0.02).translate(0, 0.22, d / 2 + 0.01), 0x5a1f1a),
    ...[-0.25, 0.25].map(k => paint(new THREE.BoxGeometry(0.12, 0.12, 0.02).translate(k * w, 0.3, d / 2 + 0.01), GOLD)),
  ];
  for (const x of [-1, -0.33, 0.33, 1]) for (const z of [-1, 1]) parts.push(paint(new THREE.CylinderGeometry(0.03, 0.03, 0.42, 8).translate(x * w / 2, 0.3, z * d / 2 + z * 0.08), RED));
  let y = 0.5, rw = w + 0.5, rd = d + 0.5;
  for (let t = 0; t < tiers; t++) {
    parts.push(roof(rw, rd, 0.22).translate(0, y, 0), paint(new THREE.BoxGeometry(rw * 0.55, 0.035, 0.05).translate(0, y + 0.22, 0), GOLD));
    if (t < tiers - 1) { parts.push(paint(new THREE.BoxGeometry(rw * 0.55, 0.22, rd * 0.55).translate(0, y + 0.3, 0), WALL)); y += 0.42; rw *= 0.62; rd *= 0.62; }
  }
  parts.push(paint(new THREE.SphereGeometry(0.04, 8, 6).translate(0, y + 0.26, 0), GOLD));
  const glow = merge(...[-0.4, 0.4].map(k => paint(new THREE.BoxGeometry(0.06, 0.08, 0.06).translate(k * w / 2, 0.36, d / 2 + 0.12), 0xffb080)));
  return { solid: merge(...parts), glow };
}
const HALL = { big: hall(1.2, 0.8, 2), mid: hall(0.9, 0.6, 1), small: hall(0.7, 0.5, 1) };
const gateGeo = {
  solid: merge(...[-0.3, 0.3].map(x => paint(new THREE.CylinderGeometry(0.035, 0.035, 0.55, 8).translate(x, 0.275, 0), RED)),
    paint(new THREE.BoxGeometry(0.8, 0.05, 0.08).translate(0, 0.55, 0), RED), roof(0.95, 0.3, 0.16).translate(0, 0.58, 0), paint(new THREE.BoxGeometry(0.5, 0.03, 0.04).translate(0, 0.74, 0), GOLD)),
  glow: merge(...[-0.3, 0.3].map(x => paint(new THREE.BoxGeometry(0.06, 0.08, 0.06).translate(x, 0.42, 0.08), 0xffb080))),
};
const pagodaGeo = merge(paint(new THREE.BoxGeometry(0.3, 0.3, 0.3).translate(0, 0.15, 0), WALL), roof(0.52, 0.52, 0.14).translate(0, 0.3, 0),
  paint(new THREE.BoxGeometry(0.2, 0.2, 0.2).translate(0, 0.46, 0), WALL), roof(0.36, 0.36, 0.12).translate(0, 0.62, 0), paint(new THREE.SphereGeometry(0.03, 8, 6).translate(0, 0.78, 0), GOLD),
  ...[-0.13, 0.13].flatMap(x => [-0.13, 0.13].map(z => paint(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 6).translate(x, 0.15, z), RED))));
const seaWallGeo = merge(paint(new THREE.BoxGeometry(R, 0.45, 0.12).translate(0, 0.1, 0), 0x7a8a98), paint(new THREE.BoxGeometry(R, 0.05, 0.16).translate(0, 0.33, 0), JADE));
const pearlGeo = { solid: paint(new THREE.CylinderGeometry(0.1, 0.13, 0.12, 10).translate(0, 0.06, 0), 0x8a9aa8), glow: paint(new THREE.SphereGeometry(0.1, 14, 10).translate(0, 0.22, 0), 0xbffcff) };
const lanternGeo = { solid: merge(paint(new THREE.BoxGeometry(0.08, 0.04, 0.08).translate(0, 0.02, 0), 0x7a7a80), paint(new THREE.CylinderGeometry(0.02, 0.02, 0.12, 6).translate(0, 0.1, 0), 0x7a7a80),
  paint(new THREE.BoxGeometry(0.07, 0.07, 0.07).translate(0, 0.2, 0), 0x6a6a70), paint(new THREE.ConeGeometry(0.06, 0.05, 6).translate(0, 0.27, 0), 0x5a5a60)), glow: paint(new THREE.BoxGeometry(0.074, 0.04, 0.074).translate(0, 0.2, 0), 0xffe0a0) };
function placeGlow(ctx: Ctx, g: { solid: THREE.BufferGeometry; glow: THREE.BufferGeometry }, x: number, y: number, z: number, s = 1, rotY = 0) {
  ctx.g.add(placed(g.solid, x, y, z, s, rotY), placed(g.glow, x, y, z, s, rotY, glowMat));
}

// ── 색 ──
const PINKS = [0xff6a8a, 0xff8ab0, 0xff5a70, 0xff9aa8], YELLOWS = [0xf0c040, 0xf8d860, 0xe8a830], PURPLES = [0xa060d8, 0xc080f0, 0x8050c0], ORANGES = [0xff8a3a, 0xffa050, 0xf07020];
const GREENS = [0x3a8a4a, 0x4a9a5a, 0x2f7a40, 0x5aa860], TEALS = [0x80f0e0, 0x60d8c8, 0x90ffe8];
const pickC = (rnd: () => number, cs: number[]) => cs[Math.floor(rnd() * cs.length)];
const school = (ctx: Ctx, x: number, z: number, dy: number, n = 18, r = 0.4) => {
  const s = makeSchool(n, r);
  s.mesh.position.set(x, heightFast(x, z) + dy, z);
  ctx.g.add(s.mesh);
  ctx.updates.push(s.update);
};

// 산호초: 가지·뇌·부채·관·말미잘 산호를 알록달록하게, 사이사이 해초, 칸 하나 걸러 물고기 떼
function reef(ctx: Ctx, comp: Hex[]) {
  const n = comp.length, k = 1 + 0.12 * Math.min(n, 6);
  const B = { branch: batch(branchCoral, vcFlat), brain: batch(brainCoral, vcFlat), fan: batch(fanCoral, vcFlat), tube: batch(tubeCoral, vcFlat), anem: batch(anemone, vcFlat), weed: batch(seaweedTuft, swayMat) };
  comp.forEach((h, idx) => {
    const rnd = rng(seedOf(h) + 101), c = toWorld(h);
    const put = (b: ReturnType<typeof batch>, count: number, s0: number, s1: number, colors: number[]) => {
      for (let i = 0; i < count * k; i++) {
        const p = inHex(rnd, -0.08), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
        if (ctx.kindAt(fromWorld(x, z)) !== 'reef' || y > -0.25 || slope(x, z) > 1.0) continue;
        b.push(x, y - 0.01, z, s0 + rnd() * (s1 - s0), rnd() * 6, pickC(rnd, colors));
      }
    };
    put(B.branch, 9, 0.7, 1.4, PINKS); put(B.brain, 4, 0.7, 1.3, YELLOWS); put(B.fan, 4, 0.7, 1.2, PURPLES);
    put(B.tube, 5, 0.7, 1.3, ORANGES); put(B.anem, 4, 0.8, 1.3, TEALS); put(B.weed, 5, 0.8, 1.4, GREENS);
    if (idx % 2 === 0) school(ctx, c.x, c.z, 0.35, 16 + n * 2, 0.4 + 0.05 * n);
  });
  ctx.g.add(...Object.values(B).map(b => b.build()));
}

// 해초숲: 흔들리는 켈프 가닥을 빽빽하게, 바닥엔 해초 덤불과 돌. 3칸 이상이면 물고기 떼
function kelpForest(ctx: Ctx, comp: Hex[]) {
  const n = comp.length, strands = batch(kelpStrand, swayMat), tufts = batch(seaweedTuft, swayMat), rocks = batch(rockGeo, vcFlat);
  for (const h of comp) {
    const rnd = rng(seedOf(h) + 103), c = toWorld(h);
    for (let i = 0; i < 14 + n * 2; i++) {
      const p = inHex(rnd, -0.05), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
      if (ctx.kindAt(fromWorld(x, z)) !== 'kelp' || y > -0.5) continue;
      strands.push(x, y, z, new THREE.Vector3(0.8 + rnd() * 0.4, Math.min(0.7 + rnd() * 0.7, (-y) * 0.75), 0.8 + rnd() * 0.4), rnd() * 6, pickC(rnd, GREENS));
    }
    for (let i = 0; i < 6; i++) { const p = inHex(rnd, 0.05), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z); if (y < -0.3) tufts.push(x, y, z, 0.8 + rnd() * 0.6, rnd() * 6, pickC(rnd, GREENS)); }
    for (let i = 0; i < 3; i++) { const p = inHex(rnd, 0.1), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z); if (y < -0.3) rocks.push(x, y, z, 0.04 + rnd() * 0.07, rnd() * 6, 0x6a7a70); }
  }
  if (n >= 3) { const c = centroid(comp); school(ctx, c.x, c.z, 0.7, 20, 0.5); }
  ctx.g.add(strands.build(), tufts.build(), rocks.build());
}

// 용궁: 1칸은 작은 전각, 이어지면 가운데 2층 본전·일주문·여의주, 곁칸마다 곁전과 석등. 4칸 이상은 담장과 모서리 탑. 거품이 올라온다
function palace(ctx: Ctx, comp: Hex[]) {
  const n = comp.length, center = mostConnected(comp), c = toWorld(center), rnd = rng(seedOf(center) + 107);
  const yAt = (x: number, z: number) => heightFast(x, z);
  if (n === 1) {
    placeGlow(ctx, HALL.mid, c.x, yAt(c.x, c.z), c.z, 1, 0);
    placeGlow(ctx, pearlGeo, c.x, yAt(c.x, c.z + 0.6), c.z + 0.6, 0.8);
    for (const x of [-0.45, 0.45]) placeGlow(ctx, lanternGeo, c.x + x, yAt(c.x + x, c.z + 0.5), c.z + 0.5);
  } else {
    placeGlow(ctx, HALL.big, c.x, yAt(c.x, c.z), c.z, 1, 0);
    placeGlow(ctx, gateGeo, c.x, yAt(c.x, c.z + 0.95), c.z + 0.95, 1, 0);
    placeGlow(ctx, pearlGeo, c.x, yAt(c.x, c.z + 0.55), c.z + 0.55, 0.9);
    for (const h of comp) {
      if (h === center) continue;
      const w = toWorld(h), face = Math.atan2(c.x - w.x, c.z - w.z);   // 곁전은 본전 쪽을 보고
      placeGlow(ctx, n >= 4 ? HALL.mid : HALL.small, w.x, yAt(w.x, w.z), w.z, 0.95, face);
      const lx = w.x + Math.sin(face) * 0.55, lz = w.z + Math.cos(face) * 0.55;
      for (const s of [1, -1]) placeGlow(ctx, lanternGeo, lx + Math.cos(face) * 0.3 * s, yAt(lx, lz), lz - Math.sin(face) * 0.3 * s);
    }
  }
  if (n >= 4) {   // 담장·모서리 탑. 본전 앞(일주문 쪽) 변은 비운다
    const inComp = (h: Hex) => comp.some(o => key(o) === key(h)), towers = new Map<string, { x: number; z: number }>();
    for (const h of comp) {
      const w = toWorld(h), cs = corners(w.x, w.z);
      for (let i = 0; i < 6; i++) {
        const a = cs[i], b = cs[(i + 1) % 6];
        if (inComp(fromWorld(a.x + b.x - w.x, a.z + b.z - w.z))) continue;
        for (const p of [a, b]) towers.set(`${p.x.toFixed(2)},${p.z.toFixed(2)}`, p);
        const mx = (a.x + b.x) / 2, mz = (a.z + b.z) / 2;
        if (h === center && Math.hypot(mx - c.x, mz - c.z - 0.95) < 0.6) continue;
        ctx.g.add(placed(seaWallGeo, mx, Math.min(yAt(a.x, a.z), yAt(b.x, b.z)) - 0.05, mz, 1, -Math.atan2(b.z - a.z, b.x - a.x)));
      }
    }
    for (const p of towers.values()) ctx.g.add(placed(pagodaGeo, p.x, yAt(p.x, p.z) - 0.05, p.z, 0.7));
  }
  for (let i = 0; i < 1 + Math.floor(n / 2); i++) {
    const h = comp[Math.floor(rnd() * n)], w = toWorld(h), x = w.x + (rnd() - 0.5) * 0.8, z = w.z + (rnd() - 0.5) * 0.8;
    ctx.updates.push(puffs(ctx.g, { x, y: yAt(x, z) + 0.05, z, n: 10, color: 0xcfefff, size: [0.03, 0.09], rise: Math.max(0.3, -yAt(x, z) - 0.1), drift: 0.05, speed: 0.22, tex: bubbleTex, opacity: 0.7, spread: 0.15 }));
  }
  school(ctx, c.x + 0.8, c.z - 0.4, 0.6, 14, 0.3);
}

// 난파선: 칸마다 기울어진 배 한 척과 부러진 돛대, 주변에 통·널빤지·보물상자, 선체에 해초
function wreck(ctx: Ctx, comp: Hex[]) {
  comp.forEach((h, idx) => {
    const rnd = rng(seedOf(h) + 111), c = toWorld(h), y = heightFast(c.x, c.z), rot = rnd() * 6;
    const hull = placed(hullGeo, c.x, y + 0.02, c.z, 1.1, rot);
    hull.rotation.order = 'YZX'; hull.rotation.z = 0.32;
    const mast = placed(mastGeo, c.x - Math.cos(rot) * 0.1, y + 0.3, c.z + Math.sin(rot) * 0.1, 1, rot);
    mast.rotation.order = 'YZX'; mast.rotation.z = 0.75;
    ctx.g.add(hull, mast);
    const barrels = batch(barrelGeo, vcFlat), planks = batch(plankGeo, vcFlat), weeds = batch(seaweedTuft, swayMat);
    for (let i = 0; i < 12; i++) {
      const p = inHex(rnd, 0.1), x = c.x + p.x, z = c.z + p.z, yy = heightFast(x, z);
      if (Math.hypot(p.x, p.z) < 0.45 || yy > -0.3) continue;
      if (i < 3) barrels.push(x, yy, z, 0.9 + rnd() * 0.3, rnd() * 6);
      else if (i < 7) planks.push(x, yy, z, 0.8 + rnd() * 0.5, rnd() * 6);
      else weeds.push(x, yy, z, 0.8 + rnd() * 0.6, rnd() * 6, pickC(rnd, GREENS));
    }
    for (let i = 0; i < 5; i++) { const a = rnd() * 6, r = 0.2 + rnd() * 0.2; weeds.push(c.x + Math.cos(a) * r, y + 0.3, c.z + Math.sin(a) * r, 0.7, rnd() * 6, pickC(rnd, GREENS)); }
    const cx = c.x + 0.6, cz = c.z + 0.35;
    ctx.g.add(placed(chestGeo, cx, heightFast(cx, cz), cz, 1, rnd() * 6), placed(coinsGeo, cx, heightFast(cx, cz), cz, 1, 0, glowMat));
    ctx.g.add(barrels.build(), planks.build(), weeds.build());
    if (idx === 0) school(ctx, c.x + 0.3, c.z - 0.5, 0.5, 14, 0.35);
  });
}

// 유적: 칸마다 둥글게 선 기둥(일부는 부러짐), 바닥 석판, 가운데엔 석상, 2칸 이상이면 아치
function ruins(ctx: Ctx, comp: Hex[]) {
  const center = mostConnected(comp), cols = batch(columnGeo, vcFlat), broken = batch(brokenColumn, vcFlat), slabs = batch(slabGeo, vcFlat), weeds = batch(seaweedTuft, swayMat);
  for (const h of comp) {
    const rnd = rng(seedOf(h) + 113), c = toWorld(h), a0 = rnd() * 6;
    for (let i = 0; i < 6; i++) {
      const a = a0 + i * Math.PI / 3, x = c.x + Math.cos(a) * 0.6, z = c.z + Math.sin(a) * 0.6, y = heightFast(x, z);
      if (y > -0.3) continue;
      (rnd() < 0.3 ? broken : cols).push(x, y, z, 0.85 + rnd() * 0.25, rnd() * 6, 0xffffff);
    }
    for (let i = 0; i < 8; i++) {
      const p = inHex(rnd, 0.15), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
      if (y > -0.3) continue;
      if (i < 4) slabs.push(x, y, z, 0.7 + rnd() * 0.6, rnd() * 6); else weeds.push(x, y, z, 0.8 + rnd() * 0.6, rnd() * 6, pickC(rnd, GREENS));
    }
    if (h === center) { ctx.g.add(placed(statueGeo, c.x, heightFast(c.x, c.z), c.z, 1, rnd() * 6)); if (comp.length >= 2) ctx.g.add(placed(archGeo, c.x, heightFast(c.x, c.z + 0.9), c.z + 0.9, 1, 0)); }
  }
  ctx.g.add(cols.build(), broken.build(), slabs.build(), weeds.build());
}

// 해구: 깊고 어두운 바닥에 발광 점들, 검은 바위와 뾰족한 첨탑
function trench(ctx: Ctx, comp: Hex[]) {
  const glows = batch(glowDot, glowMat), rocks = batch(rockGeo, vcFlat), spires = batch(spireGeo, vcFlat);
  for (const h of comp) {
    const rnd = rng(seedOf(h) + 117), c = toWorld(h);
    for (let i = 0; i < 32; i++) {
      const p = inHex(rnd, -0.1), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
      if (ctx.kindAt(fromWorld(x, z)) !== 'trench' || y > -2.0) continue;
      if (i < 20) glows.push(x, y + 0.02, z, 0.6 + rnd() * 0.8, 0, pickC(rnd, [0x30c0ff, 0x60ffe0, 0x9060ff]));
      else if (i < 27) rocks.push(x, y, z, 0.08 + rnd() * 0.14, rnd() * 6, 0x2a2a30);
      else spires.push(x, y - 0.05, z, 0.8 + rnd() * 1.2, rnd() * 6);
    }
  }
  ctx.g.add(glows.build(), rocks.build(), spires.build());
}

// 조개밭: 밝은 모래 위에 소라·불가사리·성게·성게·모래달러
function shellBed(ctx: Ctx, comp: Hex[]) {
  const shells = batch(shellGeo, vcFlat), stars = batch(starGeo, vcFlat), urchins = batch(urchinGeo, vcFlat), dollars = batch(dollarGeo, vc), rocks = batch(rockGeo, vcFlat);
  for (const h of comp) {
    const rnd = rng(seedOf(h) + 119), c = toWorld(h);
    for (let i = 0; i < 26; i++) {
      const p = inHex(rnd, 0.05), x = c.x + p.x, z = c.z + p.z, y = heightFast(x, z);
      if (y > -0.3) continue;
      if (i < 10) shells.push(x, y, z, 0.8 + rnd() * 0.6, rnd() * 6, pickC(rnd, [0xffd0c0, 0xfff0e0, 0xffb0a0, 0xf0e0ff]));
      else if (i < 14) stars.push(x, y, z, 0.8 + rnd() * 0.6, rnd() * 6, pickC(rnd, [0xf08a3a, 0xa050d0, 0xe04040, 0xf0c040]));
      else if (i < 17) urchins.push(x, y, z, 0.7 + rnd() * 0.5, rnd() * 6);
      else if (i < 22) dollars.push(x, y, z, 0.8 + rnd() * 0.6, rnd() * 6);
      else rocks.push(x, y, z, 0.03 + rnd() * 0.04, rnd() * 6, 0xb0a898);
    }
  }
  ctx.g.add(shells.build(), stars.build(), urchins.build(), dollars.build(), rocks.build());
}

export const SEA_CLUSTER: Record<SeaKind, (ctx: Ctx, comp: Hex[]) => void> = { reef, kelp: kelpForest, palace, wreck, ruins, trench, shells: shellBed };
