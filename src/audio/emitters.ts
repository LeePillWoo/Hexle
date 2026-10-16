// 소리 나는 장식 목록: 장식을 만들 때 등록하고, 섬을 다시 만들 때 비운다
export type EmitterKind = 'windmill' | 'fire' | 'volcano' | 'bell' | 'chime';
export type Emitter = { x: number; y: number; z: number; kind: EmitterKind; level?: () => number };
export const emitters: Emitter[] = [];
export const emit = (e: Emitter) => { emitters.push(e); };
