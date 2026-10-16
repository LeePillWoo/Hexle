// Hexle: 타일·아이템을 얻어 섬에 배치한다. 타일을 놓으면 지형(섬·호수·해저)이 다시 생성돼 합쳐진다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { createOcean } from './ocean';
import { terrain, setLand, pick, type Cell, type Kind } from './terrain';
import { lakeSurface } from './lake';
import { decorateAll, disposeDecor, lighthouse, TILE_INFO, TILE_KINDS } from './island';
import { canPlace, createItem, fitRadius, updateItem, ITEM_INFO, ITEM_KINDS, PLACE_NAME, type Item, type ItemKind } from './items';
import { createOverlay } from './overlay';
import { fromWorld, key, neighbors, toWorld, type Hex } from './hex';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.6;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 15, 9);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 0, 0.3);
controls.enableDamping = true;
controls.maxPolarAngle = 1.35;
controls.minDistance = 4;
controls.maxDistance = 50;

// 태양: 고도 35°, 방위 135°
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(55), THREE.MathUtils.degToRad(135));

const sky = new Sky();
sky.scale.setScalar(1000);
const su = sky.material.uniforms;
su.turbidity.value = 3;
su.rayleigh.value = 1.2;
su.mieCoefficient.value = 0.005;
su.mieDirectionalG.value = 0.8;
su.sunPosition.value.copy(sunDir);
scene.add(sky);

// 하늘을 환경광으로 (모델과 바다가 하늘을 반사)
const pmrem = new THREE.PMREMGenerator(renderer);
const skyScene = new THREE.Scene();
skyScene.add(sky.clone());
scene.environment = pmrem.fromScene(skyScene).texture;
scene.environmentIntensity = 0.6;

const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.position.copy(sunDir).multiplyScalar(30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, far: 80 });
scene.add(sun);

const ocean = createOcean(sunDir);
const overlay = createOverlay();
scene.add(ocean.water, terrain, lakeSurface, overlay.group);

// ── 섬 상태 ──
const LIGHTHOUSE = { x: 9, z: -6, r: 0.3 };
const land: Cell[] = [
  { hex: { q: 0, r: 0 }, kind: 'camp' },
  { hex: { q: 0, r: -1 }, kind: 'forest' },
  { hex: { q: 1, r: 0 }, kind: 'grass' },
];
const items: Item[] = [];
const decor = new THREE.Group();
scene.add(decor);
let lakeKeys = new Set<string>();

function refresh() {
  const lakes = setLand(land, [LIGHTHOUSE]);
  // 장식은 지형 높이가 바뀌었을 수 있으니 전부 다시 올린다
  for (const o of decor.children) disposeDecor(o);
  decor.clear();
  decor.add(decorateAll(land));
  overlay.rebuild(land.map(t => t.hex));
  // 놓을 수 없는 자리가 된 아이템(예: 메워진 호수의 물고기)은 사라진다
  for (const it of [...items]) {
    if (canPlace(it.kind, it.x, it.z)) fitRadius(it);
    else { scene.remove(it.obj); items.splice(items.indexOf(it), 1); }
  }
  // 새로 생긴 호수(기존 호수와 닿지 않는 새 호수 칸 묶음)에는 예시 물고기 한 마리
  const fresh = lakes.filter(h => !lakeKeys.has(key(h)));
  if (fresh.length && !fresh.some(h => neighbors(h).some(n => lakeKeys.has(key(n))))) {
    const c = toWorld(fresh[0]);
    if (canPlace('fish', c.x, c.z)) addItem(createItem('fish', c.x, c.z));
  }
  lakeKeys = new Set(lakes.map(key));
}
function addItem(it: Item) { items.push(it); scene.add(it.obj); }
refresh();
scene.add(lighthouse(LIGHTHOUSE.x, LIGHTHOUSE.z));

// ── 보유 카드: 타일 또는 아이템 ──
type Card = { type: 'tile'; kind: Kind } | { type: 'item'; kind: ItemKind };
const cards: Card[] = [];
let selected = -1;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const tileCards = $('tileCards'), itemCards = $('itemCards'), msg = $('msg');
const say = (text: string, ok = true) => { msg.textContent = text; msg.style.color = ok ? '#2f7a2f' : '#b3261e'; };
// 받침 유무로 조사 고르기 (물고기는 / 상어를)
const josa = (w: string, withFinal: string, without: string) => w + ((w.charCodeAt(w.length - 1) - 0xac00) % 28 ? withFinal : without);
const pickRandom = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

$('addTile').onclick = () => { const kind = pickRandom(TILE_KINDS); cards.push({ type: 'tile', kind }); say(`${TILE_INFO[kind].name} 타일을 얻었어요`); render(); };
$('addItem').onclick = () => { const kind = pickRandom(ITEM_KINDS); cards.push({ type: 'item', kind }); say(`${josa(ITEM_INFO[kind].name, "을", "를")} 얻었어요`); render(); };

// 타일은 왼쪽, 아이템은 오른쪽 패널에 (선택 인덱스는 cards 전체 기준)
function render() {
  const els = cards.map((c, i) => {
    const el = document.createElement('button');
    const info = c.type === 'tile' ? TILE_INFO[c.kind] : ITEM_INFO[c.kind];
    const where = c.type === 'tile' ? '타일' : PLACE_NAME[ITEM_INFO[c.kind].place];
    el.className = `card ${c.type}` + (i === selected ? ' sel' : '');
    el.innerHTML = `<b>${info.icon}</b>${info.name}<small>${where}</small>`;
    el.onclick = () => select(i === selected ? -1 : i);
    return el;
  });
  tileCards.replaceChildren(...els.filter((_, i) => cards[i].type === 'tile'));
  itemCards.replaceChildren(...els.filter((_, i) => cards[i].type === 'item'));
  if (!tileCards.children.length) tileCards.textContent = '타일 추가 버튼을 눌러 보세요';
  if (!itemCards.children.length) itemCards.textContent = '아이템 추가 버튼을 눌러 보세요';
}
function select(i: number) {
  selected = i;
  overlay.cands.visible = cards[i]?.type === 'tile';
  overlay.hover(undefined);
  ghost.visible = false;
  render();
  if (i >= 0) say(cards[i].type === 'tile' ? '빛나는 칸을 클릭해 배치 · Esc 취소'
    : `${PLACE_NAME[ITEM_INFO[cards[i].kind as ItemKind].place]}에만 놓을 수 있어요 · Esc 취소`);
}
render();

// 아이템 배치 미리보기 고리: 놓을 수 있으면 초록, 없으면 빨강
const ghost = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.22, 32).rotateX(-Math.PI / 2),
  new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.85, depthTest: false }));
ghost.renderOrder = 11;
ghost.visible = false;
scene.add(ghost);

// ── 마우스 ──
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
function pointAt(e: PointerEvent) {
  ndc.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return pick(ray.ray);
}
function hover(e: PointerEvent): { hex?: Hex; p?: THREE.Vector3; ok: boolean } {
  const card = cards[selected], p = pointAt(e);
  if (!card || !p) { ghost.visible = false; return { ok: false }; }
  if (card.type === 'tile') {
    const hex = overlay.hover(fromWorld(p.x, p.z));
    return { hex, ok: !!hex };
  }
  const ok = canPlace(card.kind, p.x, p.z);
  ghost.visible = true;
  ghost.position.set(p.x, p.y + 0.02, p.z);
  (ghost.material as THREE.MeshBasicMaterial).color.set(ok ? 0x5cff7a : 0xff5050);
  return { p, ok };
}
const canvas = renderer.domElement;
canvas.addEventListener('pointermove', e => { if (selected >= 0) hover(e); });
let down = { x: 0, y: 0 };
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', e => {
  if (selected < 0 || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; // 드래그는 카메라 조작
  const card = cards[selected], h = hover(e);
  if (!h.ok) {
    if (card.type === 'item') say(`${josa(ITEM_INFO[card.kind].name, "은", "는")} ${PLACE_NAME[ITEM_INFO[card.kind].place]}에만 놓을 수 있어요`, false);
    return;
  }
  cards.splice(selected, 1);
  if (card.type === 'tile') {
    land.push({ hex: h.hex!, kind: card.kind });
    select(-1);
    refresh();
  } else {
    addItem(createItem(card.kind, h.p!.x, h.p!.z));
    select(-1);
  }
  say('배치했어요');
});

// ── 토글 ──
const tGrid = $<HTMLInputElement>('tGrid'), tEdge = $<HTMLInputElement>('tEdge');
const syncToggles = () => { overlay.grid.visible = tGrid.checked; overlay.edge.visible = tEdge.checked; };
tGrid.onchange = tEdge.onchange = syncToggles;
addEventListener('keydown', e => {
  if (e.key === 'g' || e.key === 'G') tGrid.checked = !tGrid.checked;
  if (e.key === 'b' || e.key === 'B') tEdge.checked = !tEdge.checked;
  if (e.key === 'Escape') { select(-1); say(''); }
  syncToggles();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const timer = new THREE.Timer();
renderer.setAnimationLoop(t => {
  timer.update(t);
  ocean.update(timer.getDelta());
  const now = timer.getElapsed();
  for (const o of decor.children) o.userData.update?.(now);
  for (const it of items) updateItem(it, now);
  controls.update();
  renderer.render(scene, camera);
});

// 개발 서버에서만: 콘솔·자동 테스트용 핸들
if (import.meta.env.DEV) Object.assign(window, { hexle: { land, items, cards, refresh, render, camera, controls,
  spawn: (k: ItemKind, x: number, z: number) => addItem(createItem(k, x, z)) } });
