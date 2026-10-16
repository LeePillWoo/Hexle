// Hexle: 덧셈 문제 → 타일 획득 → 섬 옆에 배치 → 지형이 다시 생성돼 합쳐진다
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { createOcean } from './ocean';
import { terrain, setLand } from './terrain';
import { decorate, lighthouse, type Kind } from './island';
import { createOverlay } from './overlay';
import { fromWorld, key, type Hex } from './hex';

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
controls.minDistance = 5;
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
scene.add(ocean.water, terrain, overlay.group);

// ── 섬 상태 ──
const LIGHTHOUSE = { x: 9, z: -6, r: 0.3 };
const land: { hex: Hex; kind: Kind; deco?: THREE.Object3D }[] = [
  { hex: { q: 0, r: 0 }, kind: 'camp' },
  { hex: { q: 0, r: -1 }, kind: 'forest' },
  { hex: { q: 1, r: 0 }, kind: 'grass' },
];
function refresh() {
  setLand(land.map(t => t.hex), [LIGHTHOUSE]);
  for (const t of land) if (!t.deco) scene.add(t.deco = decorate(t.hex, t.kind));
  overlay.rebuild(land.map(t => t.hex));
}
refresh();
scene.add(lighthouse(LIGHTHOUSE.x, LIGHTHOUSE.z));

// ── 문제 ──
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const qEl = $('q'), ans = $<HTMLInputElement>('ans'), msg = $('msg'), cardsEl = $('cards');
let a = 0, b = 0;
function nextQuestion() {
  const prev = a * 10 + b;
  do { a = 1 + Math.floor(Math.random() * 9); b = 1 + Math.floor(Math.random() * 9); } while (a * 10 + b === prev);
  qEl.textContent = `${a} + ${b} = ?`;
  ans.value = '';
  ans.focus();
}
$('qf').addEventListener('submit', e => {
  e.preventDefault();
  if (ans.value === '') return;
  if (Number(ans.value) === a + b) {
    const kind: Kind = Math.random() < 0.5 ? 'forest' : 'grass';
    inventory.push(kind);
    msg.textContent = `정답! ${NAMES[kind]} 타일을 얻었어요`;
    msg.style.color = '#2f7a2f';
    renderCards();
    nextQuestion();
  } else {
    msg.textContent = '다시 생각해 봐요';
    msg.style.color = '#b3261e';
    ans.select();
  }
});

// ── 보유 타일 ──
const NAMES: Record<Kind, string> = { forest: '숲', grass: '초원', camp: '캠프' };
const ICONS: Record<Kind, string> = { forest: '🌲', grass: '🌿', camp: '⛺' };
const inventory: Kind[] = [];
let selected = -1;
function renderCards() {
  cardsEl.replaceChildren(...inventory.map((k, i) => {
    const el = document.createElement('button');
    el.className = 'card' + (i === selected ? ' sel' : '');
    el.innerHTML = `<b>${ICONS[k]}</b>${NAMES[k]}`;
    el.onclick = () => select(i === selected ? -1 : i);
    return el;
  }));
  if (!inventory.length) cardsEl.textContent = '아직 없어요 — 문제를 풀어 보세요';
}
function select(i: number) {
  selected = i;
  overlay.cands.visible = i >= 0;
  overlay.hover(undefined);
  renderCards();
}
renderCards();
nextQuestion();

// ── 배치: 바다면(y=0)에 마우스 레이를 쏴서 칸을 찾는다 ──
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), hit = new THREE.Vector3();
const seaPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
function hexUnder(e: PointerEvent): Hex | undefined {
  ndc.set(e.clientX / innerWidth * 2 - 1, -e.clientY / innerHeight * 2 + 1);
  ray.setFromCamera(ndc, camera);
  return ray.ray.intersectPlane(seaPlane, hit) ? fromWorld(hit.x, hit.z) : undefined;
}
const canvas = renderer.domElement;
canvas.addEventListener('pointermove', e => { if (selected >= 0) overlay.hover(hexUnder(e)); });
let down = { x: 0, y: 0 };
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', e => {
  if (selected < 0 || e.button !== 0 || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; // 드래그는 카메라 조작
  const h = overlay.hover(hexUnder(e));
  if (!h || land.some(t => key(t.hex) === key(h))) return;
  land.push({ hex: h, kind: inventory.splice(selected, 1)[0] });
  select(-1);
  refresh();
});

// ── 토글 ──
const tGrid = $<HTMLInputElement>('tGrid'), tEdge = $<HTMLInputElement>('tEdge');
const syncToggles = () => { overlay.grid.visible = tGrid.checked; overlay.edge.visible = tEdge.checked; };
tGrid.onchange = tEdge.onchange = syncToggles;
addEventListener('keydown', e => {
  if (e.target === ans) return;
  if (e.key === 'g' || e.key === 'G') tGrid.checked = !tGrid.checked;
  if (e.key === 'b' || e.key === 'B') tEdge.checked = !tEdge.checked;
  if (e.key === 'Escape') select(-1);
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
  for (const tile of land) tile.deco?.userData.update?.(timer.getElapsed());
  controls.update();
  renderer.render(scene, camera);
});
