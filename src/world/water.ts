// 물: 바다 수면(위에서 볼 때: three Water 반사 + 투명), 수면 밑면(물속에서 볼 때), 호수 수면, 심연 바닥
import * as THREE from 'three';
import { Water } from 'three/addons/objects/Water.js';
import { FIELD_GLSL, HALF, LAKE_Y, shared } from './terrain';

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

function createSurface(sunDir: THREE.Vector3, reflection: number) {
  const normals = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/waternormals.jpg`);
  normals.wrapS = normals.wrapT = THREE.RepeatWrapping;
  const water = new Water(new THREE.PlaneGeometry(400, 400, 200, 200), {
    textureWidth: reflection, textureHeight: reflection, waterNormals: normals, sunDirection: sunDir,
    sunColor: 0xfff6e8, waterColor: 0x0a4f86, distortionScale: 1.2,
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
  return water;
}

// 수면 밑면: 물속에서 올려다본 수면. 똑바로 위는 하늘이 비치는 창(스넬 창), 비스듬히는 거울처럼 어두운 청록
const underside = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
  uniforms: shared, side: THREE.BackSide, transparent: true,
  vertexShader: /* glsl */`
    varying vec3 vW;
    void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
  fragmentShader: 'uniform float time;\n' + FIELD_GLSL + /* glsl */`
    varying vec3 vW;
    void main() {
      if (fieldAt(vW.xz).b > 0.5) discard;
      vec3 dir = normalize(vW - cameraPosition);
      float n = fbm(vW.xz * 1.2 + time * 0.12) + fbm(vW.xz * 3.0 - time * 0.2) * 0.5;
      float win = smoothstep(0.5, 0.78, dir.y + (n - 0.75) * 0.25);
      float c = caustics(vW.xz * 0.8, time);
      vec3 sky = vec3(0.7, 0.88, 1.0) * (1.0 + c * 0.6);
      vec3 mirror = vec3(0.03, 0.26, 0.34) * (0.8 + c * 0.5);
      vec3 col = mix(mirror, sky, win);
      gl_FragColor = vec4(col, 0.92);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}));

// 호수 수면: 지형 전체를 덮는 평면 하나를 y=LAKE_Y 에 두고, field 의 호수 마스크 밖은 버린다
const lake = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF, 2 * HALF).rotateX(-Math.PI / 2), new THREE.ShaderMaterial({
  uniforms: shared, transparent: true, side: THREE.DoubleSide,
  vertexShader: /* glsl */`
    varying vec3 vW;
    void main() { vW = (modelMatrix * vec4(position, 1.0)).xyz; gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0); }`,
  fragmentShader: 'uniform float time;\n' + FIELD_GLSL + /* glsl */`
    varying vec3 vW;
    void main() {
      vec4 f = fieldAt(vW.xz);
      float depth = LAKE_Y - landH(vW.xz);
      if (f.b < 0.5 || depth <= 0.0) discard;
      // 에메랄드: 얕은 곳은 맑은 청록, 깊은 곳은 짙은 비취색. 투명도를 낮게 둬서 밝은 바닥이 비쳐 빛나게
      vec3 col = mix(vec3(0.0, 0.58, 0.42), vec3(0.0, 0.3, 0.26), smoothstep(0.0, 0.6, depth));
      float a = 0.3 + 0.4 * smoothstep(0.0, 0.6, depth);
      float c = caustics(vW.xz * 0.7, time * 0.8);
      col += c * 0.08 + pow(c, 4.0) * 0.5;                                     // 수면 반짝임
      a += pow(c, 4.0) * 0.3;
      float fr = pow(1.0 - abs(normalize(cameraPosition - vW).y), 4.0);      // 비스듬히 보면 하늘 반사
      col = mix(col, vec3(0.7, 0.85, 0.95), fr * 0.6);
      a = max(a, fr * 0.8);
      float foam = 1.0 - smoothstep(0.0, 0.04, depth);                       // 물가 테두리
      col = mix(col, vec3(1.0), foam * 0.5);
      vec4 f3 = field3At(vW.xz);
      // 오아시스: 더 맑은 하늘빛 청록
      col = mix(col, mix(vec3(0.1, 0.72, 0.75), vec3(0.0, 0.42, 0.55), smoothstep(0.0, 0.6, depth)) + c * 0.08, f3.a * 0.85);
      // 빙판: 불투명한 얼음 + 금 + 눈가루
      if (f3.b > 0.5) {
        float crack = 1.0 - smoothstep(0.0, 0.025, vEdge(vW.xz * 2.2, 0.0));
        float crack2 = 1.0 - smoothstep(0.0, 0.02, vEdge(vW.xz * 5.0 + 3.0, 0.0));
        vec3 ice = mix(vec3(0.72, 0.9, 1.0), vec3(0.92, 0.98, 1.0), fbm(vW.xz * 1.3)) * 1.15;
        ice = mix(ice, vec3(0.4, 0.68, 0.88), max(crack * 0.7, crack2 * 0.35));
        ice = mix(ice, vec3(1.15), smoothstep(0.55, 0.72, fbm(vW.xz * 3.0)) * 0.7);
        ice += pow(max(0.0, 1.0 - abs(normalize(cameraPosition - vW).y)), 3.0) * 0.15;
        col = ice; a = 0.94;
      }
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
}));
lake.position.y = LAKE_Y;

// 지형 밖 심연: 물속에서 지형 가장자리 너머로 하늘이 보이지 않게
const abyss = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x021a2a }));
abyss.position.y = -4.6;

// reflection: 반사 텍스처 크기 (모바일은 작게)
export function createWater(sunDir: THREE.Vector3, reflection = 1024) {
  const water = createSurface(sunDir, reflection);
  const group = new THREE.Group().add(water, underside, lake, abyss);
  underside.visible = false;
  return {
    group,
    update(dt: number) { shared.time.value += dt; },
    setUnderwater(under: boolean) { water.visible = !under; underside.visible = under; },
  };
}
