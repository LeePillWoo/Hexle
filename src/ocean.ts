// 수면: three Water(평면 반사 + 노멀맵 잔물결)를 투명하게 개조.
// 깊이·해안 거리는 terrain 의 field 텍스처에서 읽는다. 수면 높이는 y=0.
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { shared, FIELD_GLSL } from './terrain';

// 아주 잔잔한 일렁임. xyz = (높이, d/dx, d/dz)
const WAVES = /* glsl */`
vec3 waves(vec2 p, float t) {
  vec3 r = vec3(0.0);
  vec4 w[3] = vec4[3](vec4(0.80, 0.60, 0.9, 0.012), vec4(-0.50, 0.86, 1.4, 0.008), vec4(0.95, -0.31, 2.3, 0.004));
  for (int i = 0; i < 3; i++) {
    float ph = dot(p, w[i].xy) * w[i].z + t * sqrt(9.8 * w[i].z) * 0.5;
    r.x += w[i].w * sin(ph);
    r.yz += w[i].w * w[i].z * cos(ph) * w[i].xy;
  }
  return r;
}
`;

export function createOcean(sunDir: THREE.Vector3) {
  const normals = new THREE.TextureLoader().load('/textures/waternormals.jpg');
  normals.wrapS = normals.wrapT = THREE.RepeatWrapping;

  const water = new Water(new THREE.PlaneGeometry(400, 400, 200, 200), {
    textureWidth: 1024,
    textureHeight: 1024,
    waterNormals: normals,
    sunDirection: sunDir,
    sunColor: 0xfff6e8,
    waterColor: 0x0a4f86,
    distortionScale: 1.2,
  });
  water.rotation.x = -Math.PI / 2;

  const m = water.material as THREE.ShaderMaterial;
  m.transparent = true;
  m.uniforms.size.value = 14;
  Object.assign(m.uniforms, shared);
  m.vertexShader = m.vertexShader
    .replace('void main() {', WAVES + 'void main() {')
    .replace('mirrorCoord = modelMatrix * vec4( position, 1.0 );',
      'vec4 wp = modelMatrix * vec4( position, 1.0 ); wp.y += waves(wp.xz, time).x; mirrorCoord = wp;')
    .replace('vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );', 'vec4 mvPosition = viewMatrix * wp;');
  m.fragmentShader = m.fragmentShader
    .replace('void main() {', FIELD_GLSL + WAVES + 'void main() {')
    .replace('vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );', `
      vec3 wv = waves(worldPosition.xz, time);
      vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) + vec3(-wv.y, 0.0, -wv.z) * 0.4 );
      if (fieldAt(worldPosition.xz).b > 0.5) discard;   // 호수 자리는 호수 수면이 맡는다
      float depth = max(0.0, -landH(worldPosition.xz));
      float s = landS(worldPosition.xz);`)
    .replace('vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;', `
      float shallow = 1.0 - smoothstep(0.0, 3.0, depth);
      vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * mix(waterColor, vec3(0.04, 0.5, 0.66), shallow) * 1.6;
      reflectance *= 1.0 - shallow * 0.5;`)
    .replace('vec3 outgoingLight = albedo;', `
      float n = noise.x;
      // 물가 거품: 해안선에 붙은 또렷한 흰 띠 + 살짝 떨어진 두 번째 줄
      float fn = fbm(worldPosition.xz * 4.0 + time * 0.15);
      float foam = 1.0 - smoothstep(0.1, 0.16, depth + (fn - 0.5) * 0.08);
      foam += (1.0 - smoothstep(0.03, 0.06, abs(depth - 0.26 - sin(time * 0.8 + s * 3.0) * 0.04))) * smoothstep(0.45, 0.6, fn) * 0.8;
      // 해안으로 밀려오는 잔파도: 해안 거리 s 를 따라 띠가 안쪽으로 이동, 노이즈로 끊어진다
      float ph = fract(s * 0.9 + time * 0.22);
      float band = smoothstep(0.82, 0.96, ph) * (1.0 - smoothstep(0.96, 1.0, ph));
      band *= smoothstep(1.8, 0.4, s) * smoothstep(0.0, 0.2, s) * smoothstep(0.35, 0.6, fbm(worldPosition.xz * 2.0 + time * 0.2));
      foam = clamp(foam + band * 0.7, 0.0, 1.0);
      vec3 outgoingLight = mix(albedo, vec3(0.97), foam * 0.9);
      // 투명도: 얕으면 바닥이 훤히 비치고, 깊거나 비스듬히 보면 불투명·반사
      float a = clamp((1.0 - exp(-depth * 0.55)) * 1.1, 0.0, 1.0);
      a = max(max(a, reflectance), max(min(1.0, dot(specularLight, vec3(0.33))), foam * 0.9));`)
    .replace('gl_FragColor = vec4( outgoingLight, alpha );', 'gl_FragColor = vec4( outgoingLight, alpha * a );');

  return { water, update: (dt: number) => { shared.time.value += dt; } };
}
