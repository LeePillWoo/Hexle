// 수중 후처리: 물속에 있을 때만 렌더 타깃에 그리고 굴절·푸른 안개·광선·부유물·비네팅을 얹는다. 물 밖에서는 그대로 그린다.
import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const FRAG = /* glsl */`
#include <packing>
uniform sampler2D tDiffuse;
uniform sampler2D tDepth;
uniform float cameraNear, cameraFar, time, strength;
uniform vec2 res;
varying vec2 vUv;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float viewZ(vec2 uv) { return -perspectiveDepthToViewZ(texture2D(tDepth, uv).x, cameraNear, cameraFar); }
void main() {
  float w = strength;
  // 굴절: 느린 물결로 화면을 일그러뜨리고 색을 살짝 어긋나게
  vec2 off = vec2(sin(vUv.y * 14.0 + time * 1.1) + sin(vUv.y * 5.0 - time * 0.6),
                  cos(vUv.x * 12.0 + time * 0.9) + cos(vUv.x * 4.0 + time * 0.4)) * 0.004 * w;
  vec2 uv = vUv + off;
  vec3 col = vec3(texture2D(tDiffuse, uv + off * 0.5).r, texture2D(tDiffuse, uv).g, texture2D(tDiffuse, uv - off * 0.5).b);
  // 거리 안개: 멀수록 푸른 물빛
  float z = viewZ(uv);
  float fog = 1.0 - exp(-z * 0.075);
  vec3 fogCol = mix(vec3(0.03, 0.26, 0.38), vec3(0.1, 0.5, 0.6), vUv.y * 0.6 + 0.2);
  col = mix(col, fogCol, fog * w);
  // 위에서 내려오는 광선
  float sh = 0.0;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    sh += pow(0.5 + 0.5 * sin(vUv.x * (9.0 + fi * 5.0) + vUv.y * 2.5 + time * (0.25 + fi * 0.1) + fi * 2.0), 6.0) / 3.0;
  }
  col += vec3(0.5, 0.85, 0.9) * sh * pow(vUv.y, 2.0) * 0.35 * w;
  // 부유물
  float snow = 0.0;
  for (int i = 0; i < 2; i++) {
    vec2 p = vUv * res / (28.0 + float(i) * 20.0) + vec2(time * 0.02 * (1.0 + float(i)), time * 0.04);
    vec2 c = floor(p), f = fract(p);
    float h = hash(c);
    if (h > 0.93) snow += smoothstep(0.08, 0.0, length(f - vec2(hash(c + 1.0), hash(c + 2.0)))) * 0.25;
  }
  col += snow * w;
  col *= 1.0 - w * 0.3 * smoothstep(0.5, 1.0, length(vUv - 0.5) * 1.35);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function createPostFX(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4, depthTexture: new THREE.DepthTexture(size.x, size.y) });
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: rt.texture }, tDepth: { value: rt.depthTexture }, time: { value: 0 }, strength: { value: 1 },
      cameraNear: { value: camera.near }, cameraFar: { value: camera.far }, res: { value: size.clone() },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position, 1.0); }',
    fragmentShader: FRAG, depthTest: false, depthWrite: false,
  });
  const quad = new FullScreenQuad(mat);
  return {
    resize() {
      renderer.getDrawingBufferSize(size);
      rt.setSize(size.x, size.y);
      mat.uniforms.res.value.copy(size);
    },
    render(underwater: boolean, t: number) {
      if (!underwater) { renderer.render(scene, camera); return; }
      mat.uniforms.time.value = t;
      renderer.setRenderTarget(rt);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      quad.render(renderer);
    },
  };
}
