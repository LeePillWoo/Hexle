// 아이템(생물·물건·장식) 정의: 이름, 놓을 수 있는 곳, 움직임 파라미터
export type Medium = 'land' | 'lake' | 'sea' | 'seafloor' | 'midwater' | 'air-land' | 'air-sea';
export type ItemGroup = 'land' | 'water' | 'deep' | 'decor';
export type ItemKind =
  | 'sheep' | 'cat' | 'cow' | 'chicken' | 'dog' | 'rabbit' | 'fox' | 'horse' | 'pig' | 'deer' | 'bear' | 'penguin' | 'bird' | 'butterfly'
  | 'camel' | 'polarBear' | 'goat' | 'llama' | 'lizard' | 'parrot'
  | 'fish' | 'duck' | 'swan' | 'frog' | 'flamingo'
  | 'shark' | 'boat' | 'raft' | 'dolphin' | 'whale' | 'turtle' | 'buoy' | 'seagull' | 'seal'
  | 'school' | 'clownfish' | 'ray' | 'jellyfish' | 'octopus' | 'crab' | 'starfish' | 'seahorse' | 'squid' | 'anglerfish' | 'urchin'
  | 'clam' | 'shell' | 'chest' | 'anchor' | 'amphora' | 'seaweed' | 'kelp' | 'coralPink' | 'coralYellow' | 'coralPurple' | 'lantern';

export type ItemInfo = {
  name: string; icon: string; medium: Medium; group: ItemGroup;
  radii: number[]; speed: number;                       // 놓은 자리를 도는 반지름 후보(큰 것부터)와 속도. radii [0] 이면 제자리
  y: 'surface' | 'floor' | 'mid' | 'air'; off: number;  // 높이 기준: 수면+off / 바닥+off / 수면-깊이×off / 표면+off
  minDepth?: number; bob?: [number, number]; hop?: boolean; jump?: boolean; pulse?: boolean; sway?: boolean; side?: boolean; bank?: boolean; light?: number;
};
const land = (name: string, icon: string, radii: number[], speed: number, x: Partial<ItemInfo> = {}): ItemInfo =>
  ({ name, icon, medium: 'land', group: 'land', radii, speed, y: 'floor', off: 0, ...x });
const sea = (name: string, icon: string, radii: number[], speed: number, off: number, x: Partial<ItemInfo> = {}): ItemInfo =>
  ({ name, icon, medium: 'sea', group: 'water', radii, speed, y: 'surface', off, ...x });
const lake = (name: string, icon: string, radii: number[], speed: number, off: number, x: Partial<ItemInfo> = {}): ItemInfo =>
  ({ name, icon, medium: 'lake', group: 'water', radii, speed, y: 'surface', off, ...x });
const deep = (name: string, icon: string, medium: 'seafloor' | 'midwater', radii: number[], speed: number, x: Partial<ItemInfo> = {}): ItemInfo =>
  ({ name, icon, medium, group: 'deep', radii, speed, y: medium === 'seafloor' ? 'floor' : 'mid', off: medium === 'seafloor' ? 0 : 0.5, ...x });
const decor = (name: string, icon: string, x: Partial<ItemInfo> = {}): ItemInfo =>
  ({ name, icon, medium: 'seafloor', group: 'decor', radii: [0], speed: 0, y: 'floor', off: 0, ...x });

export const ITEM_INFO: Record<ItemKind, ItemInfo> = {
  // 땅
  sheep: land('양', '🐑', [0.35, 0.2], 0.12),
  cat: land('고양이', '🐈', [0.4, 0.2], 0.2),
  cow: land('소', '🐄', [0.45, 0.25], 0.08),
  chicken: land('닭', '🐔', [0.25, 0.15], 0.18, { hop: true }),
  dog: land('개', '🐕', [0.5, 0.3], 0.3),
  rabbit: land('토끼', '🐇', [0.35, 0.2], 0.25, { hop: true }),
  fox: land('여우', '🦊', [0.5, 0.3], 0.22),
  horse: land('말', '🐎', [0.6, 0.35], 0.35),
  pig: land('돼지', '🐖', [0.3, 0.2], 0.1),
  deer: land('사슴', '🦌', [0.5, 0.3], 0.15),
  bear: land('곰', '🐻', [0.4, 0.25], 0.08),
  penguin: land('펭귄', '🐧', [0.3, 0.2], 0.1),
  camel: land('낙타', '🐫', [0.5, 0.3], 0.1),
  polarBear: land('북극곰', '🐻‍❄️', [0.45, 0.25], 0.08),
  goat: land('염소', '🐐', [0.3, 0.2], 0.15, { hop: true }),
  llama: land('라마', '🦙', [0.4, 0.25], 0.1),
  lizard: land('도마뱀', '🦎', [0.3, 0.15], 0.3),
  parrot: { name: '앵무새', icon: '🦜', medium: 'air-land', group: 'land', radii: [0.7, 0.5, 0.3], speed: 0.8, y: 'air', off: 1.0, bank: true },
  bird: { name: '새', icon: '🐦', medium: 'air-land', group: 'land', radii: [0.9, 0.6, 0.4], speed: 0.9, y: 'air', off: 1.3, bank: true },
  butterfly: { name: '나비', icon: '🦋', medium: 'air-land', group: 'land', radii: [0.3, 0.2], speed: 0.4, y: 'air', off: 0.22, bob: [5, 0.04] },
  // 호수
  fish: lake('잉어', '🐟', [0.6, 0.4, 0.2], 0.8, -0.1, { bob: [3, 0.02] }),
  duck: lake('오리', '🦆', [0.5, 0.3, 0.15], 0.15, 0, { bob: [1.6, 0.012] }),
  swan: lake('백조', '🦢', [0.6, 0.35, 0.2], 0.1, 0, { bob: [1.3, 0.012] }),
  frog: lake('개구리', '🐸', [0], 0, 0, { bob: [2.2, 0.01] }),
  flamingo: lake('플라밍고', '🦩', [0.35, 0.2], 0.05, 0),
  // 바다 위
  shark: sea('상어', '🦈', [1.5, 1, 0.5], 0.35, -0.08, { minDepth: 0.5 }),
  boat: sea('돛단배', '⛵', [1.2, 0.7, 0.3], 0.08, 0, { bob: [1.5, 0.02] }),
  raft: sea('뗏목', '🛶', [0.8, 0.5, 0.3], 0.06, 0.01, { bob: [1.2, 0.015] }),
  dolphin: sea('돌고래', '🐬', [1.4, 1, 0.6], 0.6, -0.05, { minDepth: 0.5, jump: true }),
  whale: sea('고래', '🐋', [2.2, 1.6, 1.0], 0.25, -0.12, { minDepth: 0.9, bob: [0.8, 0.02] }),
  turtle: sea('바다거북', '🐢', [0.9, 0.6, 0.3], 0.12, -0.04, { bob: [1.1, 0.01] }),
  buoy: sea('부표', '🛟', [0], 0, -0.04, { bob: [1.4, 0.03], light: 0xffd060 }),
  seal: sea('물범', '🦭', [0.8, 0.5, 0.3], 0.15, -0.03, { bob: [1.2, 0.015] }),
  seagull: { name: '갈매기', icon: '🕊️', medium: 'air-sea', group: 'water', radii: [1.2, 0.8, 0.5], speed: 0.8, y: 'air', off: 1.1, bank: true },
  // 바닷속 생물
  school: deep('물고기 떼', '🐠', 'midwater', [0], 0),
  clownfish: deep('흰동가리', '🐡', 'midwater', [0.4, 0.25, 0.15], 0.5, { bob: [3, 0.015] }),
  ray: deep('가오리', '🪁', 'midwater', [1.2, 0.8, 0.4], 0.3, { off: 0.65, bob: [1, 0.03] }),
  jellyfish: deep('해파리', '🪼', 'midwater', [0.3, 0.15], 0.08, { off: 0.4, bob: [1.2, 0.06], pulse: true }),
  octopus: deep('문어', '🐙', 'seafloor', [0.3, 0.15], 0.05, { pulse: true }),
  crab: deep('게', '🦀', 'seafloor', [0.3, 0.2], 0.2, { side: true }),
  starfish: deep('불가사리', '⭐', 'seafloor', [0], 0),
  seahorse: deep('해마', '🐎', 'midwater', [0.2, 0.1], 0.1, { off: 0.6, bob: [1.5, 0.03] }),
  squid: deep('오징어', '🦑', 'midwater', [0.7, 0.4], 0.25, { off: 0.45, bob: [1, 0.03] }),
  anglerfish: deep('아귀', '🎣', 'midwater', [0.5, 0.3], 0.1, { off: 0.8, minDepth: 2.2, light: 0x9fffee }),
  urchin: deep('성게', '🦔', 'seafloor', [0], 0),
  // 바닷속 장식
  clam: decor('진주조개', '🦪'),
  shell: decor('소라', '🐚'),
  chest: decor('보물상자', '💰'),
  anchor: decor('닻', '⚓'),
  amphora: decor('항아리', '🏺'),
  seaweed: decor('해초', '🌿', { sway: true }),
  kelp: decor('켈프', '🌱', { sway: true, minDepth: 0.9 }),
  coralPink: decor('가지 산호', '🪸'),
  coralYellow: decor('뇌 산호', '🧠'),
  coralPurple: decor('부채 산호', '🪭'),
  lantern: decor('석등', '🏮', { light: 0xffd080 }),
};
export const ITEM_KINDS = Object.keys(ITEM_INFO) as ItemKind[];
export const PLACE_NAME: Record<Medium, string> = {
  land: '땅', lake: '호수', sea: '바다', seafloor: '바다 바닥', midwater: '바닷속', 'air-land': '땅 위', 'air-sea': '바다 위',
};
const by = (f: (i: ItemInfo) => boolean) => ITEM_KINDS.filter(k => f(ITEM_INFO[k]));
export const ITEM_TABS = {
  island: [
    ['전체', by(i => i.group === 'land' || i.group === 'water')], ['땅', by(i => i.medium === 'land')],
    ['하늘', by(i => i.medium.startsWith('air'))], ['바다', by(i => i.medium === 'sea')], ['호수', by(i => i.medium === 'lake')],
  ],
  deep: [['전체', by(i => i.group === 'deep' || i.group === 'decor')], ['생물', by(i => i.group === 'deep')], ['장식', by(i => i.group === 'decor')]],
} satisfies Record<string, [string, ItemKind[]][]>;
