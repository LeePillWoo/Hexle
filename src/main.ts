// Hexle: 타일·아이템을 얻어 섬과 바닷속에 배치한다. 타일을 놓으면 지형이 다시 생성돼 합쳐진다.
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
import { lighthouse } from './tiles/index';
import { RULE_HINT, TILE_INFO, TILE_TABS, type Kind } from './tiles/kinds';
import { ITEM_INFO, ITEM_TABS, PLACE_NAME, type ItemKind } from './items/kinds';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const cam = createCamera(renderer.domElement);
const { sunDir } = createSky(renderer, scene);
const water = createWater(sunDir);
const overlay = createOverlay();
const postfx = createPostFX(renderer, scene, cam.camera);
scene.add(water.group, terrain, overlay.group, state.group);
state.init(cells => overlay.rebuild(cells));
scene.add(lighthouse(state.LIGHTHOUSE.x, state.LIGHTHOUSE.z));

// ── UI ──
const josa = (w: string, withFinal: string, without: string) => w + ((w.charCodeAt(w.length - 1) - 0xac00) % 28 ? withFinal : without);
const pickRandom = <T,>(a: readonly T[]) => a[Math.floor(Math.random() * a.length)];
let selection: Selection | null = null;
const hud = createHud({
  onMode: m => setMode(m),
  onDive: down => { cam.dive(down); setMode(down ? 'sea' : 'island'); },
  onToggle: (g, b) => { overlay.grid.visible = g; overlay.edge.visible = overlay.seaEdge.visible = b; },
  onEscape: () => choose(null),
});
const TILE_SUB: Record<string, string> = { attach: '섬에 붙여서', island: '바다에 새 섬', sea: '바다 칸' };
const tileInv = (id: string, title: string, tabs: typeof TILE_TABS.land | typeof TILE_TABS.sea) => createInventory({
  id, title, side: 'left', addLabel: '+ 타일 추가', tabs,
  info: k => ({ ...TILE_INFO[k as Kind], sub: TILE_SUB[TILE_INFO[k as Kind].rule] }),
  roll: () => pickRandom(tabs[0][1]),
  onSelect: k => choose(k ? { type: 'tile', kind: k as Kind } : null),
  onAdd: k => hud.say(`${TILE_INFO[k as Kind].name} 타일을 얻었어요`),
});
const itemInv = (id: string, title: string, tabs: typeof ITEM_TABS.island | typeof ITEM_TABS.deep) => createInventory({
  id, title, side: 'right', addLabel: '+ 아이템 추가', tabs,
  info: k => ({ ...ITEM_INFO[k as ItemKind], sub: PLACE_NAME[ITEM_INFO[k as ItemKind].medium] }),
  roll: () => pickRandom(tabs[0][1]),
  onSelect: k => choose(k ? { type: 'item', kind: k as ItemKind } : null),
  onAdd: k => hud.say(`${josa(ITEM_INFO[k as ItemKind].name, '을', '를')} 얻었어요`),
});
const invs = {
  island: [tileInv('landTiles', '섬 타일', TILE_TABS.land), itemInv('islandItems', '섬 아이템', ITEM_TABS.island)],
  sea: [tileInv('seaTiles', '바닷속 타일', TILE_TABS.sea), itemInv('deepItems', '바닷속 아이템', ITEM_TABS.deep)],
} satisfies Record<Mode, Inventory[]>;
function setMode(m: Mode) {
  hud.setMode(m, false);
  for (const [k, list] of Object.entries(invs)) for (const inv of list) inv.show(k === m);
  if (selection) choose(null);
}
setMode('island');

// 한 번에 한 카드만 선택: 다른 패널의 선택은 풀고, 안내 문구를 띄운다
function choose(sel: Selection | null) {
  selection = sel;
  for (const inv of Object.values(invs).flat()) if (sel ? inv.selected !== sel.kind : true) inv.clear();
  overlay.cands.visible = sel?.type === 'tile' && TILE_INFO[sel.kind].rule === 'attach';
  placement.clear();
  if (!sel) { hud.say(''); return; }
  hud.say((sel.type === 'tile' ? RULE_HINT[TILE_INFO[sel.kind].rule] : `${PLACE_NAME[ITEM_INFO[sel.kind].medium]}에만 놓을 수 있어요`) + ' · Esc 취소');
}
const holder = (sel: Selection) => Object.values(invs).flat().find(inv => inv.selected === sel.kind)!;
const placement = setupPlacement({
  canvas: renderer.domElement, camera: cam.camera, overlay,
  getSelection: () => selection,
  onPlaced: sel => {
    const left = holder(sel).take(sel.kind);
    if (!left) choose(null); else { placement.clear(); if (sel.type === 'tile') overlay.cands.visible = TILE_INFO[sel.kind].rule === 'attach'; }
    hud.say(left ? `배치했어요 · ${left}개 남음` : '배치했어요');
  },
  onRejected: sel => hud.say(sel.type === 'tile' ? RULE_HINT[TILE_INFO[sel.kind].rule]
    : `${josa(ITEM_INFO[sel.kind].name, '은', '는')} ${PLACE_NAME[ITEM_INFO[sel.kind].medium]}에만 놓을 수 있어요`, false),
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
if (import.meta.env.DEV) Object.assign(window, { hexle: { state, invs, choose, hud, cam, setMode, refresh: state.refresh } });
