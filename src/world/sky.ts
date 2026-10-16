// 하늘·태양·환경광
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';

// shadowSize: 그림자 맵 크기 (모바일은 작게)
export function createSky(renderer: THREE.WebGLRenderer, scene: THREE.Scene, shadowSize = 2048) {
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
  sun.shadow.mapSize.set(shadowSize, shadowSize);
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  Object.assign(sun.shadow.camera, { left: -20, right: 20, top: 20, bottom: -20, far: 80 });
  scene.add(sun);

  return { sunDir, sun };
}
