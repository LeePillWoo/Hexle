// 실사 바다: three Water(평면 반사 + 노멀맵 잔물결)에 세 가지를 덧붙인다.
//  1) 정점 셰이더 파도 — 수면이 실제로 출렁인다
//  2) 해안 거리 텍스처 — 섬 가까이는 얕은 청록색
//  3) 해안 거품
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';

const WAVES = /* glsl */`
// 방향성 사인파 합. xyz = (높이, d/dx, d/dz)
vec3 waves(vec2 p, float t) {
  vec3 r = vec3(0.0);
  vec4 w[4] = vec4[4](      // dir.x, dir.y, 파수 k, 진폭
    vec4( 0.80,  0.60, 0.9, 0.10),
    vec4(-0.50,  0.86, 1.4, 0.06),
    vec4( 0.95, -0.31, 2.3, 0.035),
    vec4(-0.20, -0.98, 3.7, 0.015));
  for (int i = 0; i < 4; i++) {
    float ph = dot(p, w[i].xy) * w[i].z + t * sqrt(9.8 * w[i].z) * 0.5;
    r.x += w[i].w * sin(ph);
    r.yz += w[i].w * w[i].z * cos(ph) * w[i].xy;
  }
  return r;
}
`;

// 해안 거리장: 월드 [-HALF, HALF]² 를 RES² 픽셀로, 값 = 육지까지 거리 / MAX_D
const RES = 256, HALF = 32, MAX_D = 6;

export function createOcean(sunDir: THREE.Vector3) {
  const normals = new THREE.TextureLoader().load('/textures/waternormals.jpg');
  normals.wrapS = normals.wrapT = THREE.RepeatWrapping;

  const water = new Water(new THREE.PlaneGeometry(400, 400, 256, 256), {
    textureWidth: 1024,
    textureHeight: 1024,
    waterNormals: normals,
    sunDirection: sunDir,
    sunColor: 0xfff2dd,
    waterColor: 0x0b4f7a,
    distortionScale: 2.5,
  });
  water.rotation.x = -Math.PI / 2;

  const distData = new Uint8Array(RES * RES * 4).fill(255);
  const distTex = new THREE.DataTexture(distData, RES, RES);
  distTex.magFilter = distTex.minFilter = THREE.LinearFilter;

  const m = water.material as THREE.ShaderMaterial;
  m.uniforms.size.value = 14;
  m.uniforms.landDist = { value: distTex };
  m.uniforms.landHalf = { value: HALF };
  m.vertexShader = m.vertexShader
    .replace('void main() {', WAVES + 'void main() {')
    .replace('mirrorCoord = modelMatrix * vec4( position, 1.0 );',
      'vec4 wp = modelMatrix * vec4( position, 1.0 ); wp.y += waves(wp.xz, time).x; mirrorCoord = wp;')
    .replace('vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );', 'vec4 mvPosition = viewMatrix * wp;');
  m.fragmentShader = m.fragmentShader
    .replace('void main() {', WAVES + `
      uniform sampler2D landDist;
      uniform float landHalf;
      void main() {`)
    .replace('vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );', `
      vec3 wv = waves(worldPosition.xz, time);
      vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) + vec3(-wv.y, 0.0, -wv.z) * 1.2 );
      float d = texture2D(landDist, worldPosition.xz / (2.0 * landHalf) + 0.5).r * ${MAX_D.toFixed(1)};`)
    .replace('vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;', `
      float shallow = 1.0 - smoothstep(0.0, 3.5, d);
      vec3 col = mix(waterColor, vec3(0.05, 0.55, 0.55), shallow);
      vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * col;
      reflectance *= 1.0 - shallow * 0.5;`)
    .replace('vec3 outgoingLight = albedo;', `
      float n = noise.x * 0.5 + noise.y * 0.5;
      float foam = smoothstep(0.35, 0.0, d + n * 0.15)                                  // 해안선에 붙은 거품
                 + smoothstep(0.9, 0.0, d) * smoothstep(0.6, 1.0, sin(d * 9.0 - time * 1.8) * 0.5 + 0.5 + n * 0.3) * 0.5; // 밀려오는 띠
      vec3 outgoingLight = mix(albedo, vec3(0.95), clamp(foam, 0.0, 1.0) * 0.85);`);

  // 육지 칸 중심 목록으로 거리장을 다시 그린다. pointy-top, 내접원 반지름 1
  // ponytail: 픽셀 × 타일 전수 계산, 타일이 수백 개를 넘으면 BFS/점프플러딩으로 교체
  function setLand(centers: THREE.Vector2[]) {
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      const x = ((i + 0.5) / RES * 2 - 1) * HALF, z = ((j + 0.5) / RES * 2 - 1) * HALF;
      let d = MAX_D;
      for (const c of centers) {
        const ax = Math.abs(x - c.x), az = Math.abs(z - c.y);
        d = Math.min(d, Math.max(ax, ax * 0.5 + az * 0.866) - 1);
      }
      distData[(j * RES + i) * 4] = Math.max(0, d) / MAX_D * 255;
    }
    distTex.needsUpdate = true;
  }

  return { water, setLand, update: (dt: number) => { m.uniforms.time.value += dt; } };
}
