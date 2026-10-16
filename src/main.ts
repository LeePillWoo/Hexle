// Hexle: 타일·아이템을 얻어 섬과 바닷속에 배치한다. 타일을 놓으면 지형이 다시 생성돼 합쳐진다. 진행 상황은 브라우저에 저장된다.
import * as THREE from 'three';
import { createSky } from './world/sky';
import { createWater } from './world/water';
import { terrain } from './world/terrain';
import { createOverlay } from './world/overlay';
import { createCamera } from './render/camera';
import { createPostFX } from './render/postfx';
import { createDock, type Section } from './ui/inventory';
import { createHud, type Mode } from './ui/hud';
import { mountQuiz } from './ui/quiz';
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

// ── UI ──
const josa = (w: string, withFinal: string, without: string) => w + ((w.charCodeAt(w.length - 1) - 0xac00) % 28 ? withFinal : without);
const pickRandom = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
let selection: Selection | null = null, loading = false;

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
const synthMsg = (name: (k: string) => string) => (a: string, b: string, r: string) => hud.say(`합성: ${name(a)} + ${name(b)} → ${name(r)}!`);
const tileSection = (id: string, tabs: typeof TILE_TABS.land | typeof TILE_TABS.sea) => ({
  id, label: '🧩 타일', cls: 'tile', tabs, onSynth: synthMsg(k => TILE_INFO[k as Kind].name),
  info: (k: string) => ({ ...TILE_INFO[k as Kind], sub: TILE_SUB[TILE_INFO[k as Kind].rule] }),
  roll: () => pickRandom(tabs[0][1]),
  onSelect: (k: string | null) => choose(k ? { type: 'tile', kind: k as Kind } : null),
  onAdd: (k: string) => hud.say(`${TILE_INFO[k as Kind].name} 타일을 얻었어요`),
});
const itemSection = (id: string, tabs: typeof ITEM_TABS.island | typeof ITEM_TABS.deep) => ({
  id, label: '🐾 아이템', cls: 'item', tabs, onSynth: synthMsg(k => ITEM_INFO[k as ItemKind].name),
  info: (k: string) => ({ ...ITEM_INFO[k as ItemKind], sub: PLACE_NAME[ITEM_INFO[k as ItemKind].medium] }),
  roll: () => pickRandom(tabs[0][1]),
  onSelect: (k: string | null) => choose(k ? { type: 'item', kind: k as ItemKind } : null),
  onAdd: (k: string) => hud.say(`${josa(ITEM_INFO[k as ItemKind].name, '을', '를')} 얻었어요`),
});
// 모드마다 인벤토리 패널 하나 (타일·아이템은 탭). 섹션 id 는 저장 데이터 호환을 위해 예전 이름 그대로
const docks = {
  island: createDock({ id: 'islandInv', onChange: persist, sections: [tileSection('landTiles', TILE_TABS.land), itemSection('islandItems', ITEM_TABS.island)] }),
  sea: createDock({ id: 'seaInv', onChange: persist, sections: [tileSection('seaTiles', TILE_TABS.sea), itemSection('deepItems', ITEM_TABS.deep)] }),
};
const invs = { island: docks.island.sections, sea: docks.sea.sections } satisfies Record<Mode, Section[]>;
const allInvs = Object.values(invs).flat();
const layout = () => { for (const [m, d] of Object.entries(docks)) d.show(m === hud.mode); };
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
scene.add(lighthouse(state.LIGHTHOUSE.x, state.LIGHTHOUSE.z));
setMode('island');

// 문제: 맞히면 지금 모드(섬/바닷속)의 타일 한 장 + 아이템 한 장
mountQuiz(() => {
  const [tiles, items] = invs[hud.mode], t = tiles.roll(), i = items.roll();
  tiles.add(t);
  items.add(i);
  return `${TILE_INFO[t as Kind].name} 타일과 ${josa(ITEM_INFO[i as ItemKind].name, '을', '를')} 얻었어요`;
});

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
if (import.meta.env.DEV) Object.assign(window, { hexle: { state, invs, docks, choose, hud, cam, setMode, persist, canPlace, probe: placement.probe, refresh: state.refresh } });
