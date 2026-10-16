// 카메라: 궤도 조작 + 잠수/부상 + 바닥을 뚫지 않게
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { heightFast, surfaceAt } from '../world/terrain';

export function createCamera(canvas: HTMLElement) {
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 1000);
  camera.position.set(0, 15, 9);
  if (innerHeight > innerWidth) camera.position.multiplyScalar(1.5);   // 세로 화면(모바일)은 더 멀리서 시작
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0, 0.3);
  controls.enableDamping = true;
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI - 0.3;   // 수면 아래로 돌아 들어갈 수 있게
  controls.minDistance = 1.2;
  controls.maxDistance = 90;

  // 잠수/부상: 목표 지점(바라보는 곳)과 카메라 위치로 부드럽게 이동
  let goal: { t: THREE.Vector3; c: THREE.Vector3 } | null = null;
  function dive(down: boolean) {
    const t = controls.target, dir = camera.position.clone().sub(t).setY(0).normalize();
    if (!dir.lengthSq()) dir.set(0, 0, 1);
    if (down) {
      // 바라보던 곳에서 가장 가까운 깊은 바다 지점 p 를 찾고, 그 둘레에서 바닥이 가장 깊은 쪽으로 물러나 p 의 바닥 조금 위를 본다
      const deep = (x: number, z: number) => { const sf = surfaceAt(x, z); return !sf.lake && sf.h < -0.9; };
      const dirs = Array.from({ length: 8 }, (_, i) => new THREE.Vector3(Math.cos(i * Math.PI / 4), 0, Math.sin(i * Math.PI / 4)));
      let p = t.clone();
      if (!deep(t.x, t.z)) search: for (let s = 0.5; s <= 16; s += 0.5) for (const d of dirs) {
        const q = t.clone().addScaledVector(d, s);
        if (deep(q.x, q.z)) { p = q; break search; }
      }
      const back = dirs.reduce((a, b) => heightFast(p.x + b.x * 3.5, p.z + b.z * 3.5) < heightFast(p.x + a.x * 3.5, p.z + a.z * 3.5) ? b : a);
      const ty = Math.min(-0.4, heightFast(p.x, p.z) + 0.5), c = p.clone().addScaledVector(back, 3.5);
      goal = { t: new THREE.Vector3(p.x, ty, p.z), c: c.setY(Math.min(-0.15, Math.max(ty + 0.25, heightFast(c.x, c.z) + 0.3))) };
    } else {
      const tt = new THREE.Vector3(t.x, 0.3, t.z);
      goal = { t: tt, c: tt.clone().addScaledVector(dir, 17 * Math.sin(1.0)).setY(0.3 + 17 * Math.cos(1.0)) };
    }
  }
  function update(dt: number) {
    controls.update();
    if (goal) {
      const k = 1 - Math.exp(-dt * 3);
      controls.target.lerp(goal.t, k);
      camera.position.lerp(goal.c, k);
      if (camera.position.distanceTo(goal.c) < 0.02) goal = null;
    }
    // 바닥 뚫지 않게 (OrbitControls 는 매 프레임 카메라 위치에서 구면 좌표를 다시 읽으므로 그냥 밀어 올리면 된다)
    const floor = heightFast(camera.position.x, camera.position.z) + 0.25;
    if (camera.position.y < floor) camera.position.y = floor;
    const tf = heightFast(controls.target.x, controls.target.z) + 0.15;
    if (controls.target.y < tf) controls.target.y = tf;
    camera.lookAt(controls.target);
  }
  const isUnderwater = () => camera.position.y < surfaceAt(camera.position.x, camera.position.z).water - 0.02;
  function resize() {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  }
  return { camera, controls, dive, update, isUnderwater, resize };
}
