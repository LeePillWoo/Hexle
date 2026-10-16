// Hexle: 타일·아이템을 얻어 섬과 바닷속에 배치한다. 타일을 놓으면 지형이 다시 생성돼 합쳐진다. 진행 상황은 브라우저에 저장된다.
import * as THREE from 'three';
import { createSky } from './world/sky';
import { createWater } from './world/water';
import { terrain } from './world/terrain';
import { createOverlay } from './world/overlay';
import { createCamera } from './render/camera';
import { createPostFX } from './render/postfx';
import { createInventory, type Inventory } from './ui/inventory';
import { createHud, type Mode } from './ui/hud';
import { setupPlacement, type Selection } from './ui/placement';
import * as state from './game/state';
import { canPlace } from './items/index';
import { clearSave, loadSave, writeSave } from './game/save';
import { lighthouse } from './tiles/index';
import { isSeaKind, RULE_HINT, TILE_INFO, TILE_TABS, type Kind } from './tiles/kinds';
import { ITEM_INFO, ITEM_TABS, PLACE_NAME, type ItemKind } from './items/kinds';

// 좁은 화면(모바일)은 레이아웃을 바꾸고, 터치 기기는 그래픽 품질을 낮춘다
const narrow = matchMedia('(max-width: 760px)');
const lowEnd = narrow.matches || matchMedia('(pointer: coarse)').matches;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, lowEnd ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const cam = createCamera(renderer.domElement);
const { sunDir } = createSky(renderer, scene, lowEnd ? 1024 : 2048);
const water = createWater(sunDir, lowEnd ? 512 : 1024);
const overlay = createOverlay();
const postfx = createPostFX(renderer, scene, cam.camera);
scene.add(water.group, terrain, overlay.group, state.group);
scene.add(lighthouse(state.LIGHTHOUSE.x, state.LIGHTHOUSE.z));

// ── UI ──
const josa = (w: string, withFinal: string, without: string) => w + ((w.charCodeAt(w.length - 1) - 0xac00) % 28 ? withFinal : without);
const pickRandom = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
let selection: Selection | null = null, side: 'tile' | 'item' = 'tile', loading = false;

const hud = createHud({
  onMode: m => setMode(m),
  onDive: down => { cam.dive(down); setMode(down ? 'sea' : 'island'); },
  onToggle: (g, b) => { overlay.grid.visible = g; overlay.edge.visible = overlay.seaEdge.visible = b; },
  onErase: on => { if (on) choose(null); placement.clear(); hud.say(on ? '지울 타일이나 생물을 클릭하세요 · Esc 취소' : ''); },
  onReset: async () => {
    if (!await hud.confirm('섬을 처음 상태로 되돌릴까요?\n배치한 타일·아이템과 보유 카드가 모두 사라집니다.', '초기화')) return;
    clearSave();
    for (const inv of allInvs) inv.set({});
    choose(null);
    hud.setErase(false, false);
    if (hud.diving) hud.setDive(false);
    state.reset();
    setMode('island');
    hud.say('처음 상태로 되돌렸어요');
  },
  onEscape: () => { if (hud.erasing) hud.setErase(false); else choose(null); },
});
const TILE_SUB: Record<string, string> = { attach: '섬에 붙여서', island: '바다에 새 섬', sea: '바다 칸' };
const swap = () => { side = side === 'tile' ? 'item' : 'tile'; layout(); };
const tileInv = (id: string, title: string, tabs: typeof TILE_TABS.land | typeof TILE_TABS.sea) => createInventory({
  id, title, side: 'left', addLabel: '+ 타일 추가', tabs, swapLabel: '아이템 ▸', onSwap: swap, onChange: persist,
  info: k => ({ ...TILE_INFO[k as Kind], sub: TILE_SUB[TILE_INFO[k as Kind].rule] }),
  roll: () => pickRandom(tabs[0][1]),
  onSelect: k => choose(k ? { type: 'tile', kind: k as Kind } : null),
  onAdd: k => hud.say(`${TILE_INFO[k as Kind].name} 타일을 얻었어요`),
});
const itemInv = (id: string, title: string, tabs: typeof ITEM_TABS.island | typeof ITEM_TABS.deep) => createInventory({
  id, title, side: 'right', addLabel: '+ 아이템 추가', tabs, swapLabel: '◂ 타일', onSwap: swap, onChange: persist,
  info: k => ({ ...ITEM_INFO[k as ItemKind], sub: PLACE_NAME[ITEM_INFO[k as ItemKind].medium] }),
  roll: () => pickRandom(tabs[0][1]),
  onSelect: k => choose(k ? { type: 'item', kind: k as ItemKind } : null),
  onAdd: k => hud.say(`${josa(ITEM_INFO[k as ItemKind].name, '을', '를')} 얻었어요`),
});
const invs = {
  island: [tileInv('landTiles', '섬 타일', TILE_TABS.land), itemInv('islandItems', '섬 아이템', ITEM_TABS.island)],
  sea: [tileInv('seaTiles', '바닷속 타일', TILE_TABS.sea), itemInv('deepItems', '바닷속 아이템', ITEM_TABS.deep)],
} satisfies Record<Mode, Inventory[]>;
const allInvs = Object.values(invs).flat();
// 보이는 패널: 모드에 맞는 한 쌍. 좁은 화면이면 그중 타일/아이템 하나만
function layout() {
  for (const [m, [tiles, items]] of Object.entries(invs)) {
    tiles.show(m === hud.mode && (!narrow.matches || side === 'tile'));
    items.show(m === hud.mode && (!narrow.matches || side === 'item'));
  }
}
narrow.addEventListener('change', layout);
function setMode(m: Mode) {
  hud.setMode(m, false);
  layout();
  if (selection) choose(null);
}

// 한 번에 한 카드만 선택: 다른 패널의 선택은 풀고, 지우기 모드는 끄고, 안내 문구를 띄운다
function choose(sel: Selection | null) {
  selection = sel;
  for (const inv of allInvs) if (sel ? inv.selected !== sel.kind : true) inv.clear();
  if (sel && hud.erasing) hud.setErase(false, false);
  overlay.cands.visible = sel?.type === 'tile' && TILE_INFO[sel.kind].rule === 'attach';
  placement.clear();
  if (!sel) { hud.say(''); return; }
  hud.say((sel.type === 'tile' ? RULE_HINT[TILE_INFO[sel.kind].rule] : `${PLACE_NAME[ITEM_INFO[sel.kind].medium]}에만 놓을 수 있어요`) + ' · Esc 취소');
}
const holder = (sel: Selection) => allInvs.find(inv => inv.selected === sel.kind)!;
// 자리를 잃거나 지운 카드를 제자리 인벤토리로
function giveBack(type: 'tile' | 'item', kind: string) {
  const g = type === 'item' ? ITEM_INFO[kind as ItemKind].group : undefined;
  (type === 'tile' ? (isSeaKind(kind as Kind) ? invs.sea[0] : invs.island[0]) : (g === 'deep' || g === 'decor' ? invs.sea[1] : invs.island[1])).add(kind);
}
const placement = setupPlacement({
  canvas: renderer.domElement, camera: cam.camera, overlay,
  getSelection: () => selection, getErase: () => hud.erasing,
  onPlaced: sel => {
    const left = holder(sel).take(sel.kind);
    if (!left) choose(null); else { placement.clear(); if (sel.type === 'tile') overlay.cands.visible = TILE_INFO[sel.kind].rule === 'attach'; }
    hud.say(left ? `배치했어요 · ${left}개 남음` : '배치했어요');
    persist();
  },
  onRejected: sel => hud.say(sel.type === 'tile' ? RULE_HINT[TILE_INFO[sel.kind].rule]
    : `${josa(ITEM_INFO[sel.kind].name, '은', '는')} ${PLACE_NAME[ITEM_INFO[sel.kind].medium]}에만 놓을 수 있어요`, false),
  onErased: (type, kind) => {
    giveBack(type, kind);
    const name = type === 'tile' ? TILE_INFO[kind as Kind].name : ITEM_INFO[kind as ItemKind].name;
    hud.say(`${josa(name, '을', '를')} 지웠어요 · 카드로 돌아갔어요`);
    persist();
  },
});

// ── 저장·복원 ──
function persist() {
  if (loading) return;
  writeSave({ v: 1, cells: state.cells, items: state.items.map(i => ({ kind: i.kind, x: i.x, z: i.z })), inv: Object.fromEntries(allInvs.map(inv => [inv.id, inv.counts()])) });
}
state.onRebuild((cells, lost) => {
  overlay.rebuild(cells);
  for (const k of lost.tiles) giveBack('tile', k);
  for (const k of lost.items) giveBack('item', k);
  persist();
});
const saved = loadSave();
if (saved) {
  loading = true;
  for (const inv of allInvs) inv.set(saved.inv[inv.id] ?? {});
  state.restore(saved.cells, saved.items);
  loading = false;
  persist();
} else state.refresh();
setMode('island');

addEventListener('resize', () => {
  cam.resize();
  renderer.setSize(innerWidth, innerHeight);
  postfx.resize();
});

// ── 루프 ──
const timer = new THREE.Timer();
let wasUnder = false;
renderer.setAnimationLoop(t => {
  timer.update(t);
  const dt = timer.getDelta(), now = timer.getElapsed();
  water.update(dt);
  state.update(now);
  cam.update(dt);
  const under = cam.isUnderwater();
  if (under !== wasUnder) { wasUnder = under; water.setUnderwater(under); setMode(under ? 'sea' : 'island'); }
  postfx.render(under, now);
});

// 개발 서버에서만: 콘솔·자동 테스트용 핸들
if (import.meta.env.DEV) Object.assign(window, { hexle: { state, invs, choose, hud, cam, setMode, persist, canPlace, probe: placement.probe, refresh: state.refresh } });
