// M0 룩뎁: 하늘 + 투명한 바다(코스틱) + 섬
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import { createOcean } from './ocean';
import { buildIsland, dock, lighthouse, type Tile } from './island';

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

const sun = new THREE.DirectionalLight(0xfff0d8, 2.4);
sun.position.copy(sunDir).multiplyScalar(30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.02;
Object.assign(sun.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, far: 80 });
scene.add(sun);

const ocean = createOcean(sunDir);
scene.add(ocean.water, ocean.bed);

const tiles: Tile[] = [
  { q: 0, r: -1, kind: 'forest' },
  { q: 1, r: -1, kind: 'forest' },
  { q: -1, r: 0, kind: 'grass' },
  { q: 0, r: 0, kind: 'camp' },
  { q: 1, r: 0, kind: 'grass' },
];
const island = buildIsland(tiles);
scene.add(island.group, dock(0.2, 1.9), lighthouse(7, -4.5));
ocean.setLand(island.centers, [{ x: 7, z: -4.5, r: 0.15 }]);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

const timer = new THREE.Timer();
renderer.setAnimationLoop(t => {
  timer.update(t);
  ocean.update(timer.getDelta());
  island.update(timer.getElapsed());
  controls.update();
  renderer.render(scene, camera);
});
