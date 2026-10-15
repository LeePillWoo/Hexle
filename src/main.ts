// M0 룩뎁: 하늘 + 실사 바다 + 캐주얼 섬
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { createOcean } from './ocean';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.5;
renderer.shadowMap.enabled = true;
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 1000);
camera.position.set(0, 13, 17);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.maxPolarAngle = 1.35;
controls.minDistance = 6;
controls.maxDistance = 60;

// 태양: 고도 25°, 방위 135°
const sunDir = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(65), THREE.MathUtils.degToRad(135));

const sky = new Sky();
sky.scale.setScalar(1000);
const su = sky.material.uniforms;
su.turbidity.value = 4;
su.rayleigh.value = 1.5;
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

const sun = new THREE.DirectionalLight(0xfff0d8, 2.2);
sun.position.copy(sunDir).multiplyScalar(30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, far: 80 });
scene.add(sun);

const ocean = createOcean(sunDir);
ocean.water.position.y = -0.35;
scene.add(ocean.water);

// 섬
const BASE = '/models/kaykit/';
const loader = new GLTFLoader();
const cache = new Map<string, Promise<THREE.Object3D>>();
async function place(path: string, p: THREE.Vector3, y = 0) {
  if (!cache.has(path)) cache.set(path, loader.loadAsync(BASE + path).then(g => g.scene));
  const o = (await cache.get(path)!).clone();
  o.traverse(m => { m.castShadow = m.receiveShadow = true; });
  o.position.set(p.x, y, p.z);
  scene.add(o);
}
const hexPos = (q: number, r: number) => new THREE.Vector3(2 * (q + r / 2), 0, Math.sqrt(3) * r);

const land: [number, number, string?][] = [
  [0, 0, 'decoration/props/tent.gltf'],
  [1, -1, 'decoration/nature/trees_A_large.gltf'],
  [0, -1, 'decoration/nature/trees_B_large.gltf'],
  [-1, 0, 'decoration/nature/trees_A_medium.gltf'],
  [1, 0, 'decoration/nature/mountain_A_grass_trees.gltf'],
  [-1, 1, 'decoration/props/resource_lumber.gltf'],
  [0, 1],
];
for (const [q, r, deco] of land) {
  const p = hexPos(q, r);
  place('tiles/base/hex_grass.gltf', p);
  for (let y = -1; y >= -3; y--) place('tiles/base/hex_grass_bottom.gltf', p, y);
  if (deco) place(deco, p);
}
ocean.setLand(land.map(([q, r]) => { const p = hexPos(q, r); return new THREE.Vector2(p.x, p.z); }));

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const clock = new THREE.Clock();
renderer.setAnimationLoop(() => {
  ocean.update(clock.getDelta());
  controls.update();
  renderer.render(scene, camera);
});
