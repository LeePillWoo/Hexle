// 실행: node src/core/hex.check.ts
import assert from 'node:assert';
import { toWorld, fromWorld, corners, hexSdf, neighbors, key, clusters } from './hex.ts';

for (let q = -6; q <= 6; q++) for (let r = -6; r <= 6; r++) {
  const c = toWorld({ q, r });
  assert.deepStrictEqual(fromWorld(c.x, c.z), { q, r });
  // 꼭짓점 92% 지점까지는 같은 칸
  for (const p of corners(c.x, c.z)) {
    assert.deepStrictEqual(fromWorld(c.x + (p.x - c.x) * 0.92, c.z + (p.z - c.z) * 0.92), { q, r });
    assert.ok(Math.abs(hexSdf(p.x, p.z, c.x, c.z)) < 1e-9);
  }
  // 이웃 중심 사이 거리는 2
  for (const n of neighbors({ q, r })) {
    const w = toWorld(n);
    assert.ok(Math.abs(Math.hypot(w.x - c.x, w.z - c.z) - 2) < 1e-9);
  }
}
assert.strictEqual(key(fromWorld(-0.1, 0.1)), '0,0');
// 묶음: 붙은 두 칸 + 떨어진 한 칸 → 2묶음
assert.deepStrictEqual(clusters([{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 5, r: 5 }]).map(c => c.length).sort(), [1, 2]);
console.log('hex ok');
