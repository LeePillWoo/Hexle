// 에셋 미리보기: 원점에 샘플 섬, 그 뒤로 KayKit 모델 전체를 폴더별로 나열한다.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const BASE = '/models/kaykit/';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.body.appendChild(renderer.domElement);

const labels = new CSS2DRenderer();
labels.setSize(innerWidth, innerHeight);
Object.assign(labels.domElement.style, { position: 'fixed', top: '0', pointerEvents: 'none' });
document.body.appendChild(labels.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1d3b5c);
scene.add(new THREE.HemisphereLight(0xcfe8ff, 0x2a4a3a, 1.2));
const sun = new THREE.DirectionalLight(0xfff0d0, 2.5);
sun.position.set(10, 18, 8);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12 });
scene.add(sun);

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 500);
camera.position.set(0, 14, 16);
if (location.hash === '#catalog') { camera.position.set(0, 40, -8); }
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
if (location.hash === '#catalog') controls.target.set(0, 0, -34);

const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();
function load(path: string) {
  if (!cache.has(path)) cache.set(path, loader.loadAsync(BASE + path).then(g => g.scene));
  return cache.get(path)!.then(o => {
    const c = o.clone();
    c.traverse(m => { m.castShadow = m.receiveShadow = true; m.userData.name = path; });
    return c;
  });
}

function label(text: string, cls: string, pos: THREE.Vector3) {
  const div = document.createElement('div');
  div.className = cls;
  div.textContent = text;
  const o = new CSS2DObject(div);
  o.position.copy(pos);
  scene.add(o);
}

// pointy-top hex, KayKit 타일 폭 2 → 반지름 2/√3
const hexPos = (q: number, r: number) => new THREE.Vector3(2 * (q + r / 2), 0, Math.sqrt(3) * r);

// 샘플 섬: 스크린샷 구성을 흉내낸 것 (숲, 산, 텐트, 해안)
async function island() {
  const land: [number, number, string?][] = [
    [0, 0, 'decoration/props/tent.gltf'],
    [1, -1, 'decoration/nature/trees_A_large.gltf'],
    [0, -1, 'decoration/nature/trees_B_large.gltf'],
    [-1, 0, 'decoration/nature/trees_A_medium.gltf'],
    [1, 0, 'decoration/nature/mountain_A_grass_trees.gltf'],
    [-1, 1, 'decoration/props/resource_lumber.gltf'],
    [0, 1],
  ];
  const isLand = new Set(land.map(([q, r]) => `${q},${r}`));
  for (const [q, r, deco] of land) {
    const p = hexPos(q, r);
    scene.add((await load('tiles/base/hex_grass.gltf')).translateX(p.x).translateZ(p.z));
    scene.add((await load('tiles/base/hex_grass_bottom.gltf')).translateX(p.x).translateY(-1).translateZ(p.z));
    if (deco) scene.add((await load(deco)).translateX(p.x).translateZ(p.z));
  }
  for (let q = -4; q <= 4; q++) for (let r = -4; r <= 4; r++) {
    if (Math.abs(q + r) > 4 || isLand.has(`${q},${r}`)) continue;
    const p = hexPos(q, r);
    scene.add((await load('tiles/base/hex_water.gltf')).translateX(p.x).translateZ(p.z));
  }
  label('샘플 섬', 'group', new THREE.Vector3(0, 3, 0));
}

// 카탈로그: 폴더별로 한 블록씩, 한 줄에 12개
async function catalog() {
  const list: string[] = await (await fetch(BASE + 'index.json')).json();
  const groups = Map.groupBy(list, p => p.slice(0, p.lastIndexOf('/')));
  let z = -14;
  for (const [dir, files] of groups) {
    label(dir, 'group', new THREE.Vector3(-17, 0.5, z));
    const z0 = z;
    files.forEach((f, i) => {
      load(f).then(o => scene.add(o.translateX(-14 + (i % 12) * 2.6).translateZ(z0 - Math.floor(i / 12) * 3)));
    });
    z -= Math.ceil(files.length / 12) * 3 + 2;
  }
}

// 마우스 올린 모델 이름 표시
const nameEl = document.getElementById('name')!;
const ray = new THREE.Raycaster();
const mouse = new THREE.Vector2();
addEventListener('pointermove', e => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  nameEl.textContent = ray.intersectObjects(scene.children, true)[0]?.object.userData.name ?? '';
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
  labels.setSize(innerWidth, innerHeight);
});

renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  labels.render(scene, camera);
});

island();
catalog();
