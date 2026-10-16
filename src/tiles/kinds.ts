// 타일 종류 정의. 육지 타일은 섬을 넓히고, 바닷속 타일은 해저를 꾸민다.
import { clusters, type Hex } from '../core/hex';

export type LandKind = 'camp' | 'grass' | 'forest' | 'mountain' | 'beach' | 'farm' | 'flower' | 'house'
  | 'volcano' | 'castle' | 'orchard' | 'snow' | 'islet';
export type SeaKind = 'reef' | 'kelp' | 'palace' | 'wreck' | 'ruins' | 'trench' | 'shells';
export type Kind = LandKind | SeaKind;
export type Cell = { hex: Hex; kind: Kind };
// attach: 기존 육지에 붙여서 / island: 육지와 떨어진 바다에 새 섬으로 / sea: 바다 칸(해저)
export type Rule = 'attach' | 'island' | 'sea';

export const TILE_INFO: Record<Kind, { name: string; icon: string; rule: Rule }> = {
  camp: { name: '캠프', icon: '⛺', rule: 'attach' },
  grass: { name: '초원', icon: '🌿', rule: 'attach' },
  forest: { name: '숲', icon: '🌲', rule: 'attach' },
  mountain: { name: '산', icon: '⛰️', rule: 'attach' },
  beach: { name: '모래사장', icon: '🏖️', rule: 'attach' },
  farm: { name: '밭', icon: '🌾', rule: 'attach' },
  flower: { name: '꽃밭', icon: '🌷', rule: 'attach' },
  house: { name: '집', icon: '🏠', rule: 'attach' },
  volcano: { name: '화산', icon: '🌋', rule: 'attach' },
  castle: { name: '성', icon: '🏰', rule: 'attach' },
  orchard: { name: '과수원', icon: '🍎', rule: 'attach' },
  snow: { name: '설원', icon: '❄️', rule: 'attach' },
  islet: { name: '새 섬', icon: '🏝️', rule: 'island' },
  reef: { name: '산호초', icon: '🪸', rule: 'sea' },
  kelp: { name: '해초숲', icon: '🍃', rule: 'sea' },
  palace: { name: '용궁', icon: '🏯', rule: 'sea' },
  wreck: { name: '난파선', icon: '🚢', rule: 'sea' },
  ruins: { name: '유적', icon: '🏛️', rule: 'sea' },
  trench: { name: '해구', icon: '🕳️', rule: 'sea' },
  shells: { name: '조개밭', icon: '🐚', rule: 'sea' },
};
export const SEA_KINDS: SeaKind[] = ['reef', 'kelp', 'palace', 'wreck', 'ruins', 'trench', 'shells'];
export const LAND_KINDS = (Object.keys(TILE_INFO) as Kind[]).filter(k => k !== 'camp' && !isSeaKind(k)) as LandKind[];
export function isSeaKind(k: Kind): k is SeaKind { return (SEA_KINDS as string[]).includes(k); }
export const RULE_HINT: Record<Rule, string> = {
  attach: '섬에 붙은 빛나는 칸을 클릭해 배치', island: '육지와 떨어진 바다 칸을 클릭해 새 섬 만들기', sea: '바다 칸(호수 제외)을 클릭해 배치',
};

// 같은 종류끼리 이어진 칸 묶음
export const cellsOf = (cells: Cell[], kind: Kind) => clusters(cells.filter(c => c.kind === kind).map(c => c.hex));

export const TILE_TABS = {
  land: [
    ['전체', LAND_KINDS], ['자연', ['grass', 'forest', 'flower', 'orchard']],
    ['지형', ['mountain', 'volcano', 'beach', 'snow', 'islet']], ['마을', ['farm', 'house', 'castle']],
  ],
  sea: [['전체', SEA_KINDS], ['생태', ['reef', 'kelp', 'shells']], ['건축', ['palace', 'ruins', 'wreck']], ['지형', ['trench']]],
} as const satisfies Record<string, readonly (readonly [string, readonly Kind[]])[]>;
