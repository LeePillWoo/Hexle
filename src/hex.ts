// pointy-top axial 육각 좌표. 칸 폭 2 (내접원 반지름 1, 외접원 반지름 R)
export const SQ3 = Math.sqrt(3);
export const R = 2 / SQ3;
export type Hex = { q: number; r: number };

export const key = (h: Hex) => `${h.q},${h.r}`;
export const toWorld = (h: Hex) => ({ x: 2 * h.q + h.r, z: SQ3 * h.r });

export function fromWorld(x: number, z: number): Hex {
  const r = z / SQ3, q = (x - r) / 2, s = -q - r;
  let rq = Math.round(q), rr = Math.round(r);
  const rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq + 0, r: rr + 0 };   // +0: -0 제거 (key 문자열이 "-0" 이 되지 않게)
}

const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];
export const neighbors = (h: Hex) => DIRS.map(([dq, dr]) => ({ q: h.q + dq, r: h.r + dr }));

export const corners = (cx: number, cz: number) =>
  [0, 1, 2, 3, 4, 5].map(i => ({ x: cx + R * Math.sin(i * Math.PI / 3), z: cz + R * Math.cos(i * Math.PI / 3) }));

// 육각형까지 부호 거리 (안쪽 음수)
export function hexSdf(x: number, z: number, cx: number, cz: number) {
  const ax = Math.abs(x - cx), az = Math.abs(z - cz);
  return Math.max(ax, ax * 0.5 + az * SQ3 / 2) - 1;
}
