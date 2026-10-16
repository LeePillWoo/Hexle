// CPU 노이즈·보간·난수. 지형(world/terrain)과 장식(tiles)이 같이 쓴다
export type Pt = { x: number; z: number };

export const hash = (x: number, z: number) => { const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return s - Math.floor(s); };
export function vnoise(x: number, z: number) {
  const ix = Math.floor(x), iz = Math.floor(z);
  let fx = x - ix, fz = z - iz;
  fx = fx * fx * (3 - 2 * fx); fz = fz * fz * (3 - 2 * fz);
  const a = hash(ix, iz), b = hash(ix + 1, iz), c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}
export const fbm = (x: number, z: number) => { let s = 0, a = 0.5; for (let i = 0; i < 4; i++) { s += a * vnoise(x, z); x *= 2.03; z *= 2.03; a *= 0.5; } return s; };
export const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// 능선형 노이즈: 1-|2n-1| 을 제곱해 겹치면 날카로운 등줄기와 골이 생긴다
export function ridged(x: number, z: number) {
  let s = 0, a = 0.5, f = 1;
  for (let i = 0; i < 4; i++) {
    const n = 1 - Math.abs(2 * vnoise(x * f + i * 17.3, z * f - i * 9.1) - 1);
    s += a * n * n; f *= 2.1; a *= 0.5;
  }
  return s / 0.94;
}
export function segDist(x: number, z: number, a: Pt, b: Pt) {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.min(1, Math.max(0, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
}
// 시드 고정 난수 (같은 칸은 항상 같은 배치)
export function rng(seed: number) {
  let s = Math.abs(Math.floor(seed)) % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
export const seedOf = (h: { q: number; r: number }) => h.q * 7919 + h.r * 104729 + 1e6;
