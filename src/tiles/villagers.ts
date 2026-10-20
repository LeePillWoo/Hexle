// 마을 주민: 카메라가 마을 가까이 왔을 때만 보이고 움직인다.
//  집 문·우물가·가판대 앞을 오가며, 칸 사이는 길(칸 중심을 잇는 선)을 따라 걷고, 우물은 둘레로 돌아간다. 문에 닿으면 잠시 집에 들어간다.
import * as THREE from 'three';
import { centroid, key, neighbors, toWorld, type Hex } from '../core/hex';
import { rng, seedOf } from '../core/noise';
import { heightFast } from '../world/terrain';
import { merge, paint, vc, type Ctx } from './models';

// 카메라가 바라보는 곳과 그곳까지 거리 (main 이 매 프레임 채운다)
export const view = { target: new THREE.Vector3(), dist: Infinity };
const SHOW_DIST = 7;      // 이보다 가까이 확대했을 때만
const SPEED = 0.2;        // 걷는 속도 (월드 단위/초)

// ── 모델: 몸통·머리·머리카락은 한 덩어리, 팔다리는 따로 흔든다 ──
const SKIN = [0xf1c9a5, 0xd9a47a, 0xa8714a, 0xf6d7bd];
const SHIRT = [0xc0563f, 0x3f6fa0, 0x6a9a4a, 0xd9a83a, 0x8a4f9e, 0xe8e2d4];
const HAIR = [0x3a2a1e, 0x6b4a2b, 0xc89a4a, 0x1e1a18, 0x8a8a8a];
const bodyGeo = (shirt: number, skin: number, hair: number) => merge(
  paint(new THREE.BoxGeometry(0.046, 0.052, 0.03).translate(0, 0.076, 0), shirt),
  paint(new THREE.IcosahedronGeometry(0.022, 1).translate(0, 0.122, 0), skin),
  paint(new THREE.SphereGeometry(0.024, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 0.126, -0.003), hair),
);
const BODIES = SHIRT.map((s, i) => bodyGeo(s, SKIN[i % SKIN.length], HAIR[(i * 3) % HAIR.length]));
const legGeo = paint(new THREE.BoxGeometry(0.018, 0.05, 0.02).translate(0, -0.025, 0), 0x4a4038);   // 축이 엉덩이
const ARMS = SHIRT.map((s, i) => merge(
  paint(new THREE.BoxGeometry(0.012, 0.036, 0.014).translate(0, -0.018, 0), s),                 // 축이 어깨
  paint(new THREE.BoxGeometry(0.012, 0.01, 0.014).translate(0, -0.041, 0), SKIN[i % SKIN.length]),
));

function person(i: number) {
  const g = new THREE.Group(), body = new THREE.Mesh(BODIES[i % BODIES.length], vc);
  body.castShadow = true;
  const limb = (geo: THREE.BufferGeometry, x: number, y: number) => { const m = new THREE.Mesh(geo, vc); m.position.set(x, y, 0); g.add(m); return m; };
  const legs = [limb(legGeo, -0.011, 0.05), limb(legGeo, 0.011, 0.05)];
  const arms = [limb(ARMS[i % ARMS.length], -0.03, 0.098), limb(ARMS[i % ARMS.length], 0.03, 0.098)];
  g.add(body);
  g.scale.setScalar(1.1);
  return { g, legs, arms };
}

// 갈 곳: 문(들어가서 쉼) 또는 서 있을 자리(face 쪽을 보고 머문다). hub = 그 자리가 붙은 칸
export type Spot = { x: number; z: number; hub: Hex; door?: boolean; face?: number };
type P = { x: number; z: number };

export function villagers(ctx: Ctx, comp: Hex[], spots: Spot[], well?: Hex) {
  if (!spots.length) return;
  const rnd = rng(seedOf(comp[0]) + 97), inComp = new Set(comp.map(key)), wellKey = well && key(well);
  const c = centroid(comp), reach = 5 + Math.sqrt(comp.length) * 2;

  // 칸 사이 최단 경로 (같은 마을 칸만 밟는다)
  function hubs(a: Hex, b: Hex) {
    const prev = new Map<string, Hex | null>([[key(a), null]]), queue = [a];
    while (queue.length) {
      const h = queue.shift()!;
      if (key(h) === key(b)) break;
      for (const n of neighbors(h)) if (inComp.has(key(n)) && !prev.has(key(n))) { prev.set(key(n), h); queue.push(n); }
    }
    const out: Hex[] = [];
    for (let h: Hex | null | undefined = b; h; h = prev.get(key(h))) out.unshift(h);
    return out;
  }
  function route(from: P, to: Spot, fromHub: Hex): P[] {
    if (comp.length === 1) return [to];   // 집 한 채뿐인 마을: 집 앞마당에서 바로
    const hs = hubs(fromHub, to.hub), pts: P[] = [];
    hs.forEach((h, i) => {
      const w = toWorld(h);
      if (key(h) !== wellKey) { pts.push(w); return; }
      // 우물 칸은 가운데를 지나지 않고 둘레(반지름 0.3)를 따라 돈다
      const p = pts.at(-1) ?? from, n = i + 1 < hs.length ? toWorld(hs[i + 1]) : to;
      const a0 = Math.atan2(p.z - w.z, p.x - w.x), a1 = Math.atan2(n.z - w.z, n.x - w.x);
      const d = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)), steps = Math.max(1, Math.ceil(Math.abs(d) / (Math.PI / 4)));
      for (let k = 0; k <= steps; k++) { const a = a0 + d * k / steps; pts.push({ x: w.x + Math.cos(a) * 0.3, z: w.z + Math.sin(a) * 0.3 }); }
    });
    pts.push(to);
    return pts;
  }

  const crowd = new THREE.Group(), n = comp.length === 1 ? 2 : Math.min(3 + comp.length * 2, 14);
  const folk = Array.from({ length: n }, (_, i) => {
    const at = spots[Math.floor(rnd() * spots.length)], p = person(Math.floor(rnd() * 100));
    p.g.position.set(at.x, heightFast(at.x, at.z), at.z);
    crowd.add(p.g);
    return { ...p, at, path: [] as P[], wait: rnd() * 3, inside: false, step: rnd() * 6, i };
  });
  ctx.g.add(crowd);

  let last = 0;
  ctx.updates.push(t => {
    const dt = Math.min(0.1, t - last);
    last = t;
    crowd.visible = view.dist < SHOW_DIST && Math.hypot(view.target.x - c.x, view.target.z - c.z) < reach;
    if (!crowd.visible) return;
    for (const f of folk) {
      const o = f.g;
      if (f.wait > 0) {   // 머무는 중: 팔다리 내리고 가만히
        f.wait -= dt;
        for (const l of [...f.legs, ...f.arms]) l.rotation.x *= 0.8;
        if (f.wait <= 0 && f.inside) { f.inside = false; o.visible = true; }
        continue;
      }
      if (!f.path.length) {   // 다음 갈 곳: 지금 자리와 다른 곳
        const to = spots.length > 1 ? spots.filter(s => s !== f.at)[Math.floor(rnd() * (spots.length - 1))] : spots[0];
        f.path = route(o.position, to, f.at.hub);
        f.at = to;
      }
      const goal = f.path[0], dx = goal.x - o.position.x, dz = goal.z - o.position.z, d = Math.hypot(dx, dz);
      if (d < 0.01) {
        f.path.shift();
        if (!f.path.length) {   // 도착: 문이면 들어가서 쉬고, 아니면 그 자리를 보고 머문다
          f.inside = !!f.at.door && rnd() < 0.6;
          if (f.inside) o.visible = false;
          else if (f.at.face !== undefined) o.rotation.y = f.at.face;
          f.wait = f.inside ? 3 + rnd() * 6 : 1.5 + rnd() * 3;
        }
        continue;
      }
      const s = Math.min(d, SPEED * dt), x = o.position.x + dx / d * s, z = o.position.z + dz / d * s;
      f.step += dt * 16;
      o.position.set(x, heightFast(x, z) + Math.abs(Math.sin(f.step)) * 0.005, z);
      const turn = Math.atan2(dx, dz) - o.rotation.y;
      o.rotation.y += Math.atan2(Math.sin(turn), Math.cos(turn)) * Math.min(1, dt * 10);
      const swing = Math.sin(f.step) * 0.6;
      f.legs[0].rotation.x = swing; f.legs[1].rotation.x = -swing;
      f.arms[0].rotation.x = -swing * 0.8; f.arms[1].rotation.x = swing * 0.8;
    }
  });
}
