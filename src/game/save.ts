// 저장: 같은 브라우저에서 계속 이어지도록 localStorage 에 둔다 (서버 없음 → 기기·브라우저 간 연동은 안 됨)
import { TILE_INFO, type Cell } from '../tiles/kinds';
import { ITEM_INFO, type ItemKind } from '../items/kinds';

const KEY = 'hexle.save.v1';
export type Save = {
  v: 1;
  cells: Cell[];
  items: { kind: ItemKind; x: number; z: number }[];
  inv: Record<string, Record<string, number>>;   // 인벤토리 id → 종류별 개수
};

export function loadSave(): Save | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as Save;
    if (s.v !== 1 || !Array.isArray(s.cells)) return null;
    // 모르는 종류·깨진 값은 버린다 (버전이 바뀌어도 나머지는 살린다)
    s.cells = s.cells.filter(c => c && TILE_INFO[c.kind] && Number.isInteger(c.hex?.q) && Number.isInteger(c.hex?.r));
    s.items = (s.items ?? []).filter(i => i && ITEM_INFO[i.kind] && Number.isFinite(i.x) && Number.isFinite(i.z));
    s.inv = s.inv ?? {};
    return s;
  } catch { return null; }
}
export function writeSave(s: Save) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 저장 공간 없음·시크릿 모드 */ } }
export function clearSave() { try { localStorage.removeItem(KEY); } catch { /* 무시 */ } }
