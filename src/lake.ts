// 호수 수면: 지형 전체를 덮는 평면 하나를 y=LAKE_Y 에 두고, field 의 호수 마스크 밖은 버린다
import * as THREE from 'three';
import { FIELD_GLSL, HALF, LAKE_Y, shared } from './terrain';

const mat = new THREE.ShaderMaterial({
  uniforms: shared,
  transparent: true,
  vertexShader: /* glsl */`
    varying vec3 vW;
    void main() {
      vW = (modelMatrix * vec4(position, 1.0)).xyz;
      gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
    }`,
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
      float fr = pow(1.0 - normalize(cameraPosition - vW).y, 4.0);           // 비스듬히 보면 하늘 반사
      col = mix(col, vec3(0.7, 0.85, 0.95), fr * 0.6);
      a = max(a, fr * 0.8);
      float foam = 1.0 - smoothstep(0.0, 0.04, depth);                       // 물가 테두리
      col = mix(col, vec3(1.0), foam * 0.5);
      gl_FragColor = vec4(col, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});

export const lakeSurface = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF, 2 * HALF).rotateX(-Math.PI / 2), mat);
lakeSurface.position.y = LAKE_Y;
