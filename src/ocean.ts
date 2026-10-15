// 바다: 투명한 수면(three Water 개조) + 해저 + 코스틱.
// 해안 거리장 텍스처 하나를 수면·해저·섬 셰이더가 같이 쓴다. 수면 높이는 y=0.
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';

// 해안 거리장: 월드 [-HALF, HALF]² 를 RES² 픽셀로, 값 = 육지까지 거리 / MAX_D
const RES = 256, HALF = 32, MAX_D = 8;
const distData = new Uint8Array(RES * RES * 4).fill(255);
const distTex = new THREE.DataTexture(distData, RES, RES);
distTex.magFilter = distTex.minFilter = THREE.LinearFilter;

// 수면·해저·섬 재질이 공유하는 uniform (같은 객체를 꽂아서 한 번에 갱신)
export const sea = {
  time: { value: 0 },
  landDist: { value: distTex },
  landHalf: { value: HALF },
};

// time 은 재질마다 선언 여부가 달라서 여기 넣지 않는다
export const SEA_GLSL = /* glsl */`
uniform sampler2D landDist;
uniform float landHalf;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 4; i++) { s += a * vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
float landD(vec2 xz) { return texture2D(landDist, xz / (2.0 * landHalf) + 0.5).r * ${MAX_D.toFixed(1)}; }
// 해저 높이: 해안선 바로 앞은 물 위로 살짝 나온 모래사장, 멀어질수록 깊어진다
float bedY(vec2 xz) {
  float d = landD(xz);
  return 0.15 - 0.7 * smoothstep(0.0, 0.6, d) - 3.5 * smoothstep(0.6, 3.5, d)
       + (fbm(xz * 0.8) - 0.5) * 0.3 * smoothstep(0.3, 1.5, d);
}
// 코스틱: 움직이는 보로노이 셀 경계 두 겹 → 수영장 바닥 그물무늬
float vEdge(vec2 p, float t) {
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 g = vec2(i, j);
    vec2 o = 0.5 + 0.4 * sin(t + 6.2831 * vec2(hash(n + g), hash(n + g + 19.7)));
    vec2 r = g + o - f;
    float d = dot(r, r);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
  }
  return sqrt(d2) - sqrt(d1);
}
float caustics(vec2 p, float t) {
  return exp(-vEdge(p * 1.6, t * 0.8) * 9.0) * 0.6 + exp(-vEdge(p * 2.3 + 5.0, t * 1.05) * 11.0) * 0.6;
}
// 물에 잠긴 표면 색: 빨강부터 흡수돼서 깊을수록 청록 → 남색
vec3 absorb(vec3 c, float y) { return c * exp(-max(0.0, -y) * vec3(1.6, 0.45, 0.35)); }
// 물에 잠긴 표면에 얹는 코스틱 빛 (깊을수록 약해짐)
vec3 underwaterLight(vec3 w, float t) {
  return caustics(w.xz, t) * smoothstep(0.05, -0.15, w.y) * exp(w.y * 0.5) * vec3(0.8, 1.0, 0.9) * 0.5;
}
`;

// 잔잔한 너울. xyz = (높이, d/dx, d/dz)
const WAVES = /* glsl */`
vec3 waves(vec2 p, float t) {
  vec3 r = vec3(0.0);
  vec4 w[3] = vec4[3](vec4(0.80, 0.60, 0.9, 0.03), vec4(-0.50, 0.86, 1.4, 0.018), vec4(0.95, -0.31, 2.3, 0.01));
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
    sunColor: 0xfff2dd,
    waterColor: 0x0b5f78,
    distortionScale: 1.5,
  });
  water.rotation.x = -Math.PI / 2;

  const m = water.material as THREE.ShaderMaterial;
  m.transparent = true;
  m.uniforms.size.value = 14;
  Object.assign(m.uniforms, sea);
  m.vertexShader = m.vertexShader
    .replace('void main() {', WAVES + 'void main() {')
    .replace('mirrorCoord = modelMatrix * vec4( position, 1.0 );',
      'vec4 wp = modelMatrix * vec4( position, 1.0 ); wp.y += waves(wp.xz, time).x; mirrorCoord = wp;')
    .replace('vec4 mvPosition =  modelViewMatrix * vec4( position, 1.0 );', 'vec4 mvPosition = viewMatrix * wp;');
  m.fragmentShader = m.fragmentShader
    .replace('void main() {', SEA_GLSL + WAVES + 'void main() {')
    .replace('vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) );', `
      vec3 wv = waves(worldPosition.xz, time);
      vec3 surfaceNormal = normalize( noise.xzy * vec3( 1.5, 1.0, 1.5 ) + vec3(-wv.y, 0.0, -wv.z) * 0.6 );
      float d = landD(worldPosition.xz);
      float depth = max(0.0, -bedY(worldPosition.xz));`)
    .replace('vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * waterColor;', `
      float shallow = 1.0 - smoothstep(0.0, 2.5, depth);
      vec3 scatter = max( 0.0, dot( surfaceNormal, eyeDirection ) ) * mix(waterColor, vec3(0.03, 0.45, 0.42), shallow) * 1.5;
      reflectance *= 1.0 - shallow * 0.4;`)
    .replace('vec3 outgoingLight = albedo;', `
      float n = noise.x;
      float foam = 1.0 - smoothstep(0.0, 0.22, depth + n * 0.12);                       // 물가에 붙은 거품
      foam += (1.0 - smoothstep(0.0, 0.5, depth)) * smoothstep(0.5, 0.65, fbm(worldPosition.xz * 3.0 + time * 0.3))
            * smoothstep(0.65, 1.0, sin(d * 10.0 - time * 1.6) * 0.5 + 0.5 + n * 0.35);         // 밀려오는 띠 (끊어지게)
      foam = clamp(foam, 0.0, 1.0);
      vec3 outgoingLight = mix(albedo + caustics(worldPosition.xz, time) * shallow * 0.06, vec3(0.95), foam * 0.85);
      // 깊이에 따른 투명도: 얕으면 바닥이 비치고 깊으면 불투명
      float a = clamp((1.0 - exp(-depth * 0.8)) * 1.08, 0.0, 1.0);
      a = max(max(a, reflectance), foam * 0.85);`)
    .replace('gl_FragColor = vec4( outgoingLight, alpha );', 'gl_FragColor = vec4( outgoingLight, alpha * a );');

  // 해저: 정점 셰이더에서 거리장으로 높이를 만든다
  const bedMat = new THREE.MeshStandardMaterial({ roughness: 1 });
  bedMat.onBeforeCompile = s => {
    Object.assign(s.uniforms, sea);
    const head = 'uniform float time;\n' + SEA_GLSL + 'varying vec3 vW;\n';
    s.vertexShader = head + s.vertexShader
      .replace('#include <beginnormal_vertex>', `
        const float e = 0.15;
        vec3 objectNormal = normalize(vec3(
          bedY(position.xz - vec2(e, 0)) - bedY(position.xz + vec2(e, 0)), 2.0 * e,
          bedY(position.xz - vec2(0, e)) - bedY(position.xz + vec2(0, e))));`)
      .replace('#include <begin_vertex>', 'vec3 transformed = vec3(position.x, bedY(position.xz), position.z); vW = transformed;');
    s.fragmentShader = head + s.fragmentShader
      .replace('#include <color_fragment>', `
        vec3 c = mix(vec3(0.42, 0.36, 0.22), vec3(0.01, 0.08, 0.09), smoothstep(-0.2, -2.0, vW.y));
        c *= 0.75 + 0.5 * fbm(vW.xz * 1.5);
        c = mix(c, vec3(0.04, 0.06, 0.03), smoothstep(0.62, 0.7, fbm(vW.xz * 0.9 + 3.0)) * smoothstep(0.0, -0.6, vW.y)); // 바위·해초 얼룩
        diffuseColor.rgb = absorb(c, vW.y);`)
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += underwaterLight(vW, time) * diffuseColor.rgb * 2.0;');
  };
  const bed = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF, 2 * HALF, 256, 256).rotateX(-Math.PI / 2), bedMat);
  bed.receiveShadow = true;

  // 육지 = hex 칸(pointy-top, 내접원 반지름 1) + 원형 바위. 거리장을 다시 그린다.
  // ponytail: 픽셀 × 육지 전수 계산, 타일이 수백 개를 넘으면 점프플러딩으로 교체
  function setLand(hexes: THREE.Vector2[], rocks: { x: number; z: number; r: number }[] = []) {
    for (let j = 0; j < RES; j++) for (let i = 0; i < RES; i++) {
      const x = ((i + 0.5) / RES * 2 - 1) * HALF, z = ((j + 0.5) / RES * 2 - 1) * HALF;
      let d = MAX_D;
      for (const c of hexes) {
        const ax = Math.abs(x - c.x), az = Math.abs(z - c.y);
        d = Math.min(d, Math.max(ax, ax * 0.5 + az * 0.866) - 1);
      }
      for (const r of rocks) d = Math.min(d, Math.hypot(x - r.x, z - r.z) - r.r);
      distData[(j * RES + i) * 4] = Math.max(0, d) / MAX_D * 255;
    }
    distTex.needsUpdate = true;
  }

  return { water, bed, setLand, update: (dt: number) => { sea.time.value += dt; } };
}
