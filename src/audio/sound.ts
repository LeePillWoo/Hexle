// 소리: 음원 파일 없이 Web Audio 로 합성한다.
//  - 깔리는 소리(바람·파도·물 찰랑임·나뭇잎·벌·풀벌레·눈보라·사막 바람·용암·모닥불·물속·먼바다):
//    화면 중심(카메라가 바라보는 곳) 주변의 타일과 물을 세어 섞는다. 멀리서 보면 바람과 먼바다만 은은하게.
//  - 한 번씩 나는 소리(새·갈매기·개구리·종·풍차·불똥·거품·분화·동물 울음): 가까이 줌인했을 때 소리 나는 것 근처에서.
//  - 좌우 위치에 따라 왼쪽·오른쪽 스피커로 나누고, 물속에선 먹먹하게 깎는다.
import * as THREE from 'three';
import { emitters } from './emitters';
import { surfaceAt } from '../world/terrain';
import * as state from '../game/state';
import type { ItemKind } from '../items/kinds';

type Voice = { wave: OscillatorType; f0: number; fm?: number; f1: number; dur: number; reps?: number; gap?: number; vib?: number; rate?: number; formant: number; q: number; noise?: number; every: [number, number] };
const V = (wave: OscillatorType, f0: number, f1: number, dur: number, formant: number, q: number, x: Partial<Voice> = {}): Voice => ({ wave, f0, f1, dur, formant, q, every: [5, 11], ...x });
// 동물 울음: 톱니·사각파에 높낮이 미끄러짐·떨림·포먼트(입 모양) 필터
const VOICES: Partial<Record<ItemKind, Voice>> = {
  sheep: V('sawtooth', 430, 390, 0.55, 1100, 3, { vib: 22, rate: 9 }),
  goat: V('sawtooth', 520, 480, 0.45, 1300, 3, { vib: 40, rate: 12 }),
  cow: V('sawtooth', 125, 100, 1.2, 450, 2, { vib: 3, rate: 5, every: [8, 15] }),
  chicken: V('square', 680, 520, 0.08, 1600, 3, { reps: 4, gap: 0.06 }),
  dog: V('sawtooth', 330, 220, 0.13, 900, 2, { reps: 2, gap: 0.16, noise: 0.4 }),
  cat: V('sawtooth', 560, 520, 0.5, 1100, 4, { fm: 820 }),
  horse: V('sawtooth', 900, 500, 0.9, 1500, 2, { vib: 35, rate: 14, every: [9, 16] }),
  pig: V('square', 190, 150, 0.16, 700, 3, { reps: 2, gap: 0.08, noise: 0.3 }),
  deer: V('sine', 1500, 1100, 0.25, 1300, 1, { every: [9, 16] }),
  bear: V('sawtooth', 85, 65, 0.9, 300, 2, { noise: 0.6, every: [9, 16] }),
  polarBear: V('sawtooth', 80, 60, 0.9, 300, 2, { noise: 0.6, every: [9, 16] }),
  penguin: V('sawtooth', 700, 520, 0.25, 1200, 2, { reps: 2, gap: 0.1, vib: 25, rate: 15 }),
  camel: V('sawtooth', 150, 115, 0.7, 500, 2, { noise: 0.4, every: [8, 14] }),
  llama: V('sawtooth', 800, 900, 0.4, 1500, 3, { fm: 1100 }),
  fox: V('sine', 900, 700, 0.3, 1200, 1, { fm: 1400, reps: 2, gap: 0.1 }),
  duck: V('sawtooth', 320, 280, 0.12, 1100, 5, { reps: 3, gap: 0.08 }),
  swan: V('sawtooth', 520, 470, 0.3, 1300, 3, { reps: 2, gap: 0.15 }),
  flamingo: V('sawtooth', 700, 650, 0.12, 1500, 3, { reps: 3, gap: 0.07 }),
  frog: V('sawtooth', 95, 85, 0.1, 500, 5, { reps: 3, gap: 0.05, every: [3, 7] }),
  seal: V('sawtooth', 420, 300, 0.18, 900, 2, { reps: 3, gap: 0.1, noise: 0.3 }),
  whale: V('sine', 180, 140, 2.6, 600, 0.7, { fm: 420, vib: 4, rate: 3, every: [12, 20] }),
  dolphin: V('sine', 3000, 3500, 0.45, 3500, 0.7, { fm: 5200, reps: 2, gap: 0.1 }),
  parrot: V('sawtooth', 1500, 1100, 0.18, 2000, 2, { reps: 2, gap: 0.12 }),
  seagull: V('sawtooth', 1300, 900, 0.3, 1600, 2, { reps: 3, gap: 0.12 }),
};
const BUBBLY = new Set<ItemKind>(['fish', 'school', 'clownfish', 'ray', 'jellyfish', 'octopus', 'squid', 'seahorse', 'anglerfish', 'turtle', 'shark', 'crab', 'clam']);
const ss = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export function createSound(camera: THREE.Camera, target: THREE.Vector3) {
  let ac: AudioContext | null = null, enabled = true, underwater = false;
  let master: GainNode, muffle: BiquadFilterNode, sfx: GainNode, noise: AudioBuffer;
  const beds: Record<string, GainNode> = {};
  let active = 0;   // 지금 울리는 한 번짜리 소리 수 (너무 시끄럽지 않게)

  // ── 준비: 첫 클릭·터치 때 (브라우저 자동재생 정책) ──
  function init() {
    ac = new AudioContext();
    master = ac.createGain(); master.gain.value = enabled ? 0.8 : 0;
    muffle = ac.createBiquadFilter(); muffle.type = 'lowpass'; muffle.frequency.value = 20000;
    sfx = ac.createGain(); sfx.gain.value = 1;
    sfx.connect(muffle); muffle.connect(master); master.connect(ac.destination);
    noise = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noiseSrc = () => { const s = ac!.createBufferSource(); s.buffer = noise; s.loop = true; s.start(0, Math.random() * 2); return s; };
    const filt = (type: BiquadFilterType, f: number, q = 0.7) => { const b = ac!.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; };
    // 진폭을 느리게 출렁이게 (파도가 밀려왔다 빠지듯)
    const swell = (node: AudioNode, rate: number, depth: number) => {
      const g = ac!.createGain(); g.gain.value = 1 - depth;
      const l = ac!.createOscillator(); l.frequency.value = rate;
      const lg = ac!.createGain(); lg.gain.value = depth;
      l.connect(lg); lg.connect(g.gain); l.start();
      node.connect(g);
      return g;
    };
    const bed = (name: string, out: AudioNode) => { const g = ac!.createGain(); g.gain.value = 0; out.connect(g); g.connect(muffle); beds[name] = g; };
    const noiseBed = (name: string, type: BiquadFilterType, f: number, q: number, rate: number, depth: number, sweep = 0) => {
      const s = noiseSrc(), b = filt(type, f, q);
      if (sweep) { const l = ac!.createOscillator(); l.frequency.value = rate * 0.7; const lg = ac!.createGain(); lg.gain.value = sweep; l.connect(lg); lg.connect(b.frequency); l.start(); }
      s.connect(b);
      bed(name, swell(b, rate, depth));
    };
    noiseBed('wind', 'bandpass', 450, 0.6, 0.07, 0.6, 120);
    noiseBed('far', 'lowpass', 280, 0.7, 0.05, 0.4);
    noiseBed('waves', 'lowpass', 650, 0.7, 0.11, 0.85);
    noiseBed('foam', 'highpass', 2600, 0.7, 0.11, 0.9);
    noiseBed('lap', 'lowpass', 1000, 0.8, 0.6, 0.7);
    noiseBed('leaves', 'highpass', 2600, 0.7, 0.25, 0.6);
    noiseBed('snowWind', 'bandpass', 800, 4, 0.09, 0.7, 260);
    noiseBed('desertWind', 'bandpass', 1300, 2, 0.06, 0.6, 300);
    noiseBed('lava', 'lowpass', 130, 0.8, 0.25, 0.5);
    noiseBed('fire', 'bandpass', 2400, 0.8, 9, 0.9);
    noiseBed('under', 'lowpass', 320, 0.7, 0.12, 0.5);
    // 벌: 떨리는 톱니파 붕붕
    { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.value = 215;
      const l = ac.createOscillator(); l.frequency.value = 7; const lg = ac.createGain(); lg.gain.value = 9; l.connect(lg); lg.connect(o.frequency); l.start(); o.start();
      const b = filt('bandpass', 420, 2); o.connect(b); bed('bees', swell(b, 0.3, 0.6)); }
    // 풀벌레: 높은 사인파를 빠르게 끊고, 그 묶음을 다시 느리게 끊는다
    { const o = ac.createOscillator(); o.frequency.value = 4400; o.start();
      const g1 = swell(o, 28, 1), g2 = swell(g1, 0.8, 1); bed('crickets', g2); }
  }
  const unlock = () => { if (!ac) init(); if (ac!.state === 'suspended') ac!.resume(); };
  addEventListener('pointerdown', unlock);
  addEventListener('keydown', unlock);

  // ── 한 번짜리 소리 ──
  const v3 = new THREE.Vector3();
  function panFor(x: number, y: number, z: number) {
    v3.set(x, y, z).applyMatrix4(camera.matrixWorldInverse);
    return Math.max(-1, Math.min(1, v3.x / Math.max(1.5, -v3.z * 0.6)));
  }
  function out(vol: number, pan: number, life: number) {
    const g = ac!.createGain(), p = ac!.createStereoPanner();
    g.gain.value = vol; p.pan.value = pan;
    g.connect(p); p.connect(sfx);
    active++;
    setTimeout(() => { active--; g.disconnect(); p.disconnect(); }, (life + 0.3) * 1000);
    return g;
  }
  function env(g: AudioParam, t: number, peak: number, dur: number, attack = 0.02) {
    g.setValueAtTime(0, t); g.linearRampToValueAtTime(peak, t + attack); g.setTargetAtTime(0, t + dur * 0.7, dur * 0.15 + 0.01);
  }
  function voice(p: Voice, vol: number, pan: number) {
    const t0 = ac!.currentTime, reps = p.reps ?? 1, life = reps * (p.dur + (p.gap ?? 0));
    const o0 = out(vol, pan, life);
    for (let r = 0; r < reps; r++) {
      const t = t0 + r * (p.dur + (p.gap ?? 0)), osc = ac!.createOscillator(), f = ac!.createBiquadFilter(), g = ac!.createGain();
      osc.type = p.wave;
      const k = 0.93 + Math.random() * 0.14;   // 매번 조금씩 다른 목소리
      osc.frequency.setValueAtTime(p.f0 * k, t);
      if (p.fm) osc.frequency.linearRampToValueAtTime(p.fm * k, t + p.dur * 0.4);
      osc.frequency.linearRampToValueAtTime(p.f1 * k, t + p.dur);
      if (p.vib) { const l = ac!.createOscillator(), lg = ac!.createGain(); l.frequency.value = p.rate ?? 6; lg.gain.value = p.vib; l.connect(lg); lg.connect(osc.frequency); l.start(t); l.stop(t + p.dur + 0.1); }
      f.type = 'bandpass'; f.frequency.value = p.formant; f.Q.value = p.q;
      osc.connect(f); f.connect(g); g.connect(o0);
      env(g.gain, t, 0.5, p.dur);
      osc.start(t); osc.stop(t + p.dur + 0.2);
      if (p.noise) {
        const n = ac!.createBufferSource(), ng = ac!.createGain(); n.buffer = noise;
        n.connect(ng); ng.connect(f); env(ng.gain, t, p.noise, p.dur); n.start(t, Math.random()); n.stop(t + p.dur + 0.2);
      }
    }
  }
  function tone(freqs: number[], vol: number, pan: number, decay: number, type: OscillatorType = 'sine') {   // 종·풍경
    const t = ac!.currentTime, o0 = out(vol, pan, decay * 4);
    freqs.forEach((fr, i) => {
      const o = ac!.createOscillator(), g = ac!.createGain(); o.type = type; o.frequency.value = fr;
      o.connect(g); g.connect(o0);
      g.gain.setValueAtTime(0.4 / (i + 1), t); g.gain.setTargetAtTime(0, t + 0.01, decay / (1 + i * 0.5));
      o.start(t); o.stop(t + decay * 4);
    });
  }
  function noiseHit(vol: number, pan: number, type: BiquadFilterType, f0: number, f1: number, dur: number) {   // 바람 휙·불똥·쾅
    const t = ac!.currentTime, o0 = out(vol, pan, dur), n = ac!.createBufferSource(), f = ac!.createBiquadFilter(), g = ac!.createGain();
    n.buffer = noise; f.type = type; f.frequency.setValueAtTime(f0, t); f.frequency.linearRampToValueAtTime(f1, t + dur);
    n.connect(f); f.connect(g); g.connect(o0);
    env(g.gain, t, 1, dur, Math.min(0.15, dur * 0.3));
    n.start(t, Math.random()); n.stop(t + dur + 0.2);
  }
  function chirp(vol: number, pan: number) {   // 새: 짧은 높은음 몇 개
    const t0 = ac!.currentTime, n = 3 + Math.floor(Math.random() * 4), base = rand(2400, 3800), o0 = out(vol, pan, n * 0.12);
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.11, o = ac!.createOscillator(), g = ac!.createGain();
      o.frequency.setValueAtTime(base * rand(0.9, 1.2), t); o.frequency.exponentialRampToValueAtTime(base * rand(1.2, 1.6), t + 0.06);
      o.connect(g); g.connect(o0); env(g.gain, t, 0.35, 0.07, 0.005); o.start(t); o.stop(t + 0.12);
    }
  }
  function bubble(vol: number, pan: number) {
    const t = ac!.currentTime, o0 = out(vol, pan, 0.15), o = ac!.createOscillator(), g = ac!.createGain();
    o.frequency.setValueAtTime(rand(300, 600), t); o.frequency.exponentialRampToValueAtTime(rand(900, 1600), t + 0.08);
    o.connect(g); g.connect(o0); env(g.gain, t, 0.4, 0.09, 0.005); o.start(t); o.stop(t + 0.15);
  }

  // ── 매 0.2초: 주변을 세어 깔리는 소리 섞기 ──
  const nextAt = new WeakMap<object, number>(), emitNext = new Map<string, number>();
  let lastTick = 0, birdAt = 0, gullAt = 0, frogAt = 0, bubbleAt = 0;
  const lastLevel = new Map<string, number>();
  function setBed(name: string, v: number) { beds[name]?.gain.setTargetAtTime(v, ac!.currentTime, 0.6); }
  function update(t: number) {
    if (!ac || ac.state !== 'running' || !enabled) return;
    if (t - lastTick < 0.2) return;
    lastTick = t;
    const camDist = camera.position.distanceTo(target);
    const near = 1 - ss(7, 20, camDist), far = ss(12, 40, camDist);
    // 주변 타일 종류 (화면 중심에서 가까울수록 크게)
    const w: Record<string, number> = {};
    for (const c of state.cells) {
      const x = 2 * c.hex.q + c.hex.r, z = Math.sqrt(3) * c.hex.r, d = Math.hypot(x - target.x, z - target.z);
      if (d < 6) w[c.kind] = (w[c.kind] ?? 0) + (1 - d / 6) * 0.5;
    }
    const W = (k: string) => Math.min(1, w[k] ?? 0);
    // 주변 물: 화면 중심 둘레 16 점
    let sea = 0, lake = 0;
    for (let i = 0; i < 16; i++) {
      const a = i / 16 * Math.PI * 2, r = 1 + (i % 4) * 1.2, s = surfaceAt(target.x + Math.cos(a) * r, target.z + Math.sin(a) * r);
      if (s.water - s.h > 0.05) { if (!s.lake) sea++; else if (!s.ice) lake++; }
    }
    sea /= 16; lake /= 16;
    const greens = Math.min(1, W('forest') + W('grass') + W('flower') + W('orchard') + W('farm') * 0.5);
    if (underwater) {
      for (const k of Object.keys(beds)) setBed(k, 0);
      setBed('under', 0.55);
    } else {
      setBed('under', 0);
      setBed('far', 0.22 * far + 0.05);
      setBed('wind', 0.06 + 0.2 * far + near * 0.15 * Math.min(1, W('mountain') + W('snow') * 0.5));
      setBed('waves', near * sea * 0.55 + far * 0.04);
      setBed('foam', near * sea * 0.12 * (1 + W('beach') + W('islet')));
      setBed('lap', near * lake * 0.5);
      setBed('leaves', near * W('forest') * 0.3);
      setBed('bees', near * W('flower') * 0.18);
      setBed('crickets', near * Math.min(1, W('grass') + W('farm') + W('orchard')) * 0.05);
      setBed('snowWind', near * W('snow') * 0.3);
      setBed('desertWind', near * W('desert') * 0.3);
    }
    // 소리 나는 장식
    let lava = 0, fire = 0;
    for (const e of emitters) {
      const d = Math.hypot(e.x - target.x, e.z - target.z), vol = near * Math.max(0, 1 - d / 4.5) ** 2;
      const id = `${e.kind}${e.x.toFixed(1)},${e.z.toFixed(1)}`;
      if (e.kind === 'volcano') {
        const lv = e.level?.() ?? 0;
        lava = Math.max(lava, near * Math.max(0, 1 - d / 7) * (0.25 + lv * 0.6));
        if (lv > 0.9 && (lastLevel.get(id) ?? 0) < 0.9 && vol > 0.01) noiseHit(Math.min(1, vol * 2 + 0.2), panFor(e.x, e.y, e.z), 'lowpass', 160, 50, 2.5);   // 분화 쾅
        lastLevel.set(id, lv);
        continue;
      }
      if (e.kind === 'fire') { fire = Math.max(fire, vol); if (vol > 0.02 && Math.random() < 0.5) noiseHit(vol * 0.25, panFor(e.x, e.y, e.z), 'highpass', 2500, 3000, 0.03); continue; }
      if (vol < 0.02 || underwater !== (e.kind === 'chime')) continue;
      if ((emitNext.get(id) ?? 0) > t) continue;
      if (e.kind === 'windmill') {   // 날개가 지날 때마다 휙, 가끔 삐걱
        noiseHit(vol * 0.5, panFor(e.x, e.y, e.z), 'bandpass', 300, 900, 0.6);
        if (Math.random() < 0.3) voice(V('sawtooth', 70, 60, 0.4, 300, 6), vol * 0.4, panFor(e.x, e.y, e.z));
        emitNext.set(id, t + 1.96);   // 날개 4장 × 0.8 rad/s
      } else if (e.kind === 'bell') { tone([392, 940, 1530, 2110], vol * 0.6, panFor(e.x, e.y, e.z), 1.6); emitNext.set(id, t + rand(14, 28)); }
      else { tone([1760, 2349, 2637].map(f => f * rand(0.98, 1.02)), vol * 0.3, panFor(e.x, e.y, e.z), 1.2); emitNext.set(id, t + rand(3, 7)); }   // 용궁 풍경
    }
    if (!underwater) { setBed('lava', lava); setBed('fire', fire * 0.25); }
    // 자연의 한 번짜리 소리
    if (active < 6 && !underwater) {
      if (t > birdAt && near * greens > 0.05) { chirp(near * greens * 0.5, rand(-0.8, 0.8)); birdAt = t + rand(2, 6) / (0.4 + greens); }
      if (t > gullAt && near * sea > 0.15) { voice(VOICES.seagull!, near * sea * 0.25, rand(-0.8, 0.8)); gullAt = t + rand(8, 18); }
      if (t > frogAt && near * lake > 0.1) { voice(VOICES.frog!, near * lake * 0.4, rand(-0.6, 0.6)); frogAt = t + rand(3, 8); }
    }
    if (underwater && t > bubbleAt) { bubble(0.25, rand(-0.8, 0.8)); bubbleAt = t + rand(0.4, 2); }
    // 동물·배·물고기: 가까운 것만
    for (const it of state.items) {
      if (active >= 6) break;
      const p = it.obj.position, d = Math.hypot(p.x - target.x, p.z - target.z), vol = near * Math.max(0, 1 - d / 4) ** 2;
      if (vol < 0.03) continue;
      const due = nextAt.get(it) ?? t + rand(0.5, 3);
      if (!nextAt.has(it)) { nextAt.set(it, due); continue; }
      if (t < due) continue;
      const pan = panFor(p.x, p.y, p.z), deep = BUBBLY.has(it.kind), v = VOICES[it.kind];
      if (deep) { if (underwater) bubble(vol * 0.5, pan); nextAt.set(it, t + rand(1, 3)); continue; }
      if (underwater && it.kind !== 'whale' && it.kind !== 'dolphin') { nextAt.set(it, t + 3); continue; }
      if (it.kind === 'bird') chirp(vol * 0.6, pan);
      else if (it.kind === 'boat' || it.kind === 'raft') voice(V('sawtooth', 70, 60, 0.5, 300, 6), vol * 0.4, pan);
      else if (it.kind === 'buoy') tone([1320, 2640], vol * 0.25, pan, 0.8);
      else if (v) voice(v, vol * 0.6, pan);
      else { nextAt.set(it, t + 30); continue; }
      nextAt.set(it, t + rand(...(v?.every ?? [5, 11])));
    }
  }
  return {
    update,
    // 진단용: 컨텍스트 상태와 깔리는 소리 음량
    debug: () => ({ state: ac?.state ?? 'none', active, beds: Object.fromEntries(Object.entries(beds).map(([k, g]) => [k, +g.gain.value.toFixed(3)]).filter(([, v]) => (v as number) > 0.005)) }),
    setEnabled(on: boolean) { enabled = on; if (ac) master.gain.setTargetAtTime(on ? 0.8 : 0, ac.currentTime, 0.1); },
    setUnderwater(on: boolean) { underwater = on; if (ac) muffle.frequency.setTargetAtTime(on ? 700 : 20000, ac.currentTime, 0.2); },
  };
}
