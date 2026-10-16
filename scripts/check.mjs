// 헤드리스 크롬 자동 점검: 모든 타일·아이템을 놓고 배치 규칙·잠수·저장 복원·지우기·초기화·모바일 레이아웃을 검사한 뒤 스크린샷을 남긴다.
// 사용: npm run dev 를 띄운 채로  node scripts/check.mjs <출력 폴더>
// 콘솔 오류(셰이더 컴파일 등)가 있으면 마지막 줄에 찍힌다. 개발 서버의 window.hexle 핸들을 쓴다.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const OUT = process.argv[2] ?? join(tmpdir(), 'hexle-check');
mkdirSync(OUT, { recursive: true });
const CHROME = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const chrome = spawn(CHROME, ['--headless=new', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--window-size=1400,900',
  '--remote-debugging-port=9338', `--user-data-dir=${join(OUT, 'chrome')}`, 'http://localhost:5173/']);
const wait = ms => new Promise(r => setTimeout(r, ms));
let target;
for (let i = 0; i < 50 && !target; i++) { await wait(300); try { target = (await (await fetch('http://127.0.0.1:9338/json')).json()).find(t => t.type === 'page'); } catch {} }
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r));
let id = 0; const pending = new Map(); const logs = [];
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id) pending.get(m.id)?.(m);
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) logs.push(m.params.type + ': ' + m.params.args.map(a => a.value ?? a.description ?? '').join(' ').slice(0, 300));
  if (m.method === 'Runtime.exceptionThrown') logs.push('EXC: ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text).slice(0, 400));
});
const send = (method, params = {}) => new Promise(r => { pending.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
await send('Runtime.enable');
const js = async expr => { const r = (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result; if (r.exceptionDetails) console.log('ERR', JSON.stringify(r.exceptionDetails).slice(0, 600)); return r.result?.value; };
const shot = async name => writeFileSync(join(OUT, `${name}.png`), Buffer.from((await send('Page.captureScreenshot')).result.data, 'base64'));
const view = (tx, ty, tz, px, py, pz) => js(`hexle.cam.controls.target.set(${tx}, ${ty}, ${tz}); hexle.cam.camera.position.set(${px}, ${py}, ${pz}); 0`);
const mouse = (type, x, y) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1, pointerType: 'mouse' });
const tap = async (x, y) => { await mouse('mouseMoved', x, y); await wait(80); await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await wait(900); };
const screenOf = (x, y, z) => js(`(() => { const c = hexle.cam.camera, v = new c.position.constructor(${x}, ${y}, ${z}).project(c); return [(v.x + 1) / 2 * innerWidth, (1 - v.y) / 2 * innerHeight]; })()`);
const summary = () => js(`JSON.stringify([hexle.state.cells.length, hexle.state.items.length, Object.values(hexle.invs).flat().map(i => Object.values(i.counts()).reduce((a, b) => a + b, 0))])`);

await wait(6000);
await js(`localStorage.removeItem('hexle.save.v1'); 0`);
await send('Page.reload'); await wait(6000);
const cells = {
  forest: [[0, -2], [1, -2], [-1, -1]], mountain: [[-2, 0], [-3, 1]], farm: [[0, 1], [1, 1]], house: [[2, -1], [3, -1], [3, -2]],
  volcano: [[-2, -1], [-3, 0]], castle: [[2, 0], [2, 1], [1, 2]], orchard: [[-1, 1], [-2, 2]], snow: [[1, -3], [2, -3]], beach: [[3, 0]],
  islet: [[6, 2]], reef: [[4, 1], [5, 0], [4, 2]], kelp: [[-4, 3], [-3, 3]], palace: [[0, 4], [1, 3], [-1, 4], [0, 5], [1, 4]],
  wreck: [[-5, 1]], ruins: [[4, -3]], trench: [[-5, -2], [-5, -1]], shells: [[5, -1]],
};
console.log(await js(`(() => { const t0 = performance.now(); const c = ${JSON.stringify(cells)};
  for (const k in c) for (const [q, r] of c[k]) hexle.state.cells.push({ hex: { q, r }, kind: k });
  hexle.refresh(); return 'refresh ms ' + Math.round(performance.now() - t0) + ', cells ' + hexle.state.cells.length; })()`));
console.log(await js(`(() => { const put = [['cow', 0.6, 0.4], ['chicken', -0.5, 0.3], ['bird', 0.3, -0.6], ['butterfly', -0.3, -0.3], ['horse', 1.2, 0.3], ['penguin', 3.2, -5.0],
  ['dolphin', 6, 5], ['whale', -2, 8], ['seagull', 3, 6], ['boat', 7, -4], ['buoy', 8, 2], ['turtle', 5, 4],
  ['school', 9, 1.7], ['ray', 10, 0], ['jellyfish', 8.5, 3.5], ['octopus', 10, -1.7], ['crab', 10.5, -1.5], ['seahorse', 9.5, 2.2],
  ['chest', 9.2, -1.9], ['kelp', 9.8, 2.6], ['seaweed', 10.2, 2.0], ['coralPink', 9.4, 2.4], ['lantern', 1, 7.5], ['anglerfish', -10, -3.5], ['clam', 10.4, -2.0]];
  const skipped = []; for (const [k, x, z] of put) { if (hexle.canPlace(k, x, z)) hexle.state.addItem(k, x, z); else skipped.push(k); }
  hexle.persist(); return 'items ' + hexle.state.items.length + (skipped.length ? ' (놓을 수 없는 자리라 건너뜀: ' + skipped + ')' : ''); })()`));
// 넓어진 범위: 먼 바다(반경 약 18칸)에도 새 섬을 놓을 수 있고, 한 칸 놓는 데 걸리는 시간
console.log('far islet:', await js(`(() => { const ok = hexle.state.canPlaceTile('islet', { q: 18, r: -2 }); const t0 = performance.now(); hexle.state.placeTile({ q: 18, r: -2 }, 'islet');
  const t1 = performance.now(); hexle.state.placeTile({ q: 1, r: -1 }, 'forest'); return 'ok=' + ok + ' far ' + Math.round(t1 - t0) + 'ms, near ' + Math.round(performance.now() - t1) + 'ms'; })()`));
console.log('canPlaceTile:', await js(`JSON.stringify({ attachOnSea: hexle.state.canPlaceTile('grass', { q: 8, r: 0 }), attachNext: hexle.state.canPlaceTile('grass', { q: -1, r: 0 }),
  isletNearLand: hexle.state.canPlaceTile('islet', { q: -1, r: 0 }), isletFar: hexle.state.canPlaceTile('islet', { q: -6, r: -3 }), reefOnLand: hexle.state.canPlaceTile('reef', { q: 0, r: 0 }), reefFar: hexle.state.canPlaceTile('reef', { q: 6, r: -4 }) })`));
await js(`document.getElementById('tGrid').click(); hexle.docks.island.el.querySelector('.egg').click(); (hexle.docks.island.el.querySelectorAll('.mtab')[1].click(), hexle.docks.island.el.querySelector('.egg').click(), hexle.docks.island.el.querySelectorAll('.mtab')[0].click()); 0`);
await view(0.5, 0, 1, 0.5, 24, 15); await wait(3000); await shot('all');
await view(1.5, 0, -0.5, 1.5, 6, 3.5); await wait(1500); await shot('land');
await view(4.3, 0, 6.9, 4.3, 7, 11); await wait(1500); await shot('palace_top');
await view(9, -1, 1, 9, 5.5, 5); await wait(1500); await shot('reef_top');
await view(4.3, -1.2, 6.9, 4.3, -0.75, 10.2); await wait(2500); await shot('palace_under');
await view(9.5, -0.9, 1.5, 7.2, -0.5, 3.8); await wait(1500); await shot('reef_under');
await view(-9, -3.2, -2.5, -7.5, -2.4, 0.5); await wait(1500); await shot('trench_under');
await view(1.5, 0.3, 0, 1.5, 12, 9); await wait(1200); await js(`hexle.cam.dive(true); 0`); await wait(3000);
console.log('after dive:', await js(`hexle.hud.mode + ' underwater=' + hexle.cam.isUnderwater() + ' camY=' + hexle.cam.camera.position.y.toFixed(2)`));
await js(`hexle.docks.sea.el.querySelector('.egg').click(); (hexle.docks.sea.el.querySelectorAll('.mtab')[1].click(), hexle.docks.sea.el.querySelector('.egg').click()); 0`);
await shot('dive_ui');
await js(`hexle.cam.dive(false); 0`); await wait(3000);
console.log('after surface:', await js(`hexle.hud.mode + ' underwater=' + hexle.cam.isUnderwater() + ' camY=' + hexle.cam.camera.position.y.toFixed(2)`));

// 문제: 정답을 넣으면 타일·아이템 카드가 한 장씩 늘어난다, 오답이면 그대로
const cardSum = () => js(`Object.values(hexle.invs).flat().reduce((s, i) => s + Object.values(i.counts()).reduce((a, b) => a + b, 0), 0)`);
const solveQuiz = (wrong) => js(`(() => { const t = document.querySelector('#quiz .q').textContent.replace(' = ?', '').split(' '), a = +t[0], b = +t[2];
  const r = { '+': a + b, '-': a - b, '×': a * b, '÷': a / b }[t[1]]; const inp = document.querySelector('#quiz input'); inp.value = ${wrong ? 'r + 1' : 'r'};
  document.querySelector('#quiz form').requestSubmit(); return t.join(' ') + ' → ' + document.querySelector('#quiz .qmsg').textContent; })()`);
for (const [op, d] of [['+', '1'], ['-', '2'], ['×', '3'], ['÷', '2'], ['rand', 'rand']]) {
  await js(`(() => { const o = document.querySelector('#quiz .op'), g = document.querySelector('#quiz .digits'); o.value = '${op}'; g.value = '${d}'; o.onchange(); return 0; })()`);
  const before = await cardSum(); const r = await solveQuiz(false); console.log('quiz', op, d, ':', r, '| cards +' + ((await cardSum()) - before));
}
{ const before = await cardSum(); console.log('quiz wrong:', await solveQuiz(true), '| cards +' + ((await cardSum()) - before)); }
// 합성: 가장 많은 카드(초원 3장) 두 장을 써서, 가장 적게 가진 종류 중 하나가 나온다
console.log('synth:', await js(`(() => { const inv = hexle.invs.island[0]; inv.set({ grass: 3, forest: 1 }); hexle.docks.island.el.querySelector('.synth').click();
  const c = inv.counts(); return JSON.stringify(c) + ' msg=' + document.getElementById('msg').textContent; })()`));
console.log('synth balanced:', await js(`(() => { const inv = hexle.invs.island[0]; inv.set({ grass: 3, forest: 1 }); const b = hexle.docks.island.el.querySelector('.synth');
  let n = 0; while (!b.disabled && n < 20) { b.click(); n++; } return 'fused ' + n + 'x → ' + JSON.stringify(inv.counts()) + ' label=' + b.textContent; })()`));
await js(`hexle.persist(); 0`);
console.log('synth one card:', await js(`(() => { const inv = hexle.invs.island[0]; inv.set({ grass: 1 }); return 'disabled=' + (hexle.docks.island.sections[0].renderBody(), hexle.docks.island.el.querySelector('.synth').disabled); })()`));
await js(`hexle.persist(); 0`);
await shot('quiz_ui');

// 소리: 화면을 한 번 누르면 켜지고, 가까이 가면 주변에 맞는 소리가 깔린다
await mouse('mousePressed', 700, 300); await mouse('mouseReleased', 700, 300);
await view(9.6, -0.3, 0.5, 9.6, 3, 3); await wait(7000);
console.log('sound near reef/sea:', await js(`JSON.stringify(hexle.sound.debug())`));
await view(0.5, 0.6, -1.5, 0.5, 3.5, 1.5); await wait(7000);
console.log('sound near forest/camp:', await js(`JSON.stringify(hexle.sound.debug())`));
await view(0, 0, 0, 0, 40, 25); await wait(7000);
console.log('sound far:', await js(`JSON.stringify(hexle.sound.debug())`));

// 저장·복원: 새로고침 후 칸·아이템·카드 수가 같아야 한다
const before = await summary();
await send('Page.reload'); await wait(7000);
const after = await summary();
console.log('persist:', before === after ? 'ok ' + after : 'MISMATCH ' + before + ' vs ' + after);

// 지우기: 소(아이템)와 밭(타일)을 탭해서 지우면 카드로 돌아온다
await view(1.5, 0.3, 0, 1.5, 12, 9); await wait(2500);   // 카메라가 멈춘 뒤 좌표를 잰다
await js(`hexle.hud.setErase(true); 0`);
const cow = await js(`(() => { const it = hexle.state.items.find(i => i.kind === 'cow'); return [it.obj.position.x, it.obj.position.y, it.obj.position.z]; })()`);
let [sx, sy] = await screenOf(...cow); sy -= 10;   // 발이 아니라 몸통을 탭 (모델에 직접 맞게)
await tap(sx, sy);
console.log('erase item:', await js(`'items=' + hexle.state.items.length + ' cowCards=' + (hexle.invs.island[1].counts().cow ?? 0) + ' msg=' + document.getElementById('msg').textContent`));
[sx, sy] = await screenOf(1, 0.6, 1.73); await tap(sx, sy);   // 밭 칸 (0,1)
console.log('erase tile:', await js(`'cells=' + hexle.state.cells.length + ' farmCards=' + (hexle.invs.island[0].counts().farm ?? 0) + ' msg=' + document.getElementById('msg').textContent`));
await js(`hexle.hud.setErase(false); 0`);

// 모바일 레이아웃: 패널 하나가 화면 폭에 맞고, 탭으로 타일·아이템을 바꾼다
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true }); await wait(1500);
await js(`hexle.docks.island.el.querySelector('.egg').click(); hexle.docks.island.el.querySelector('.egg').click(); 0`); await wait(300);
await shot('mobile');
console.log('mobile:', await js(`JSON.stringify({ narrow: matchMedia('(max-width: 760px)').matches, dockW: Math.round(hexle.docks.island.el.getBoundingClientRect().width), seaShown: getComputedStyle(hexle.docks.sea.el).display !== 'none' })`));
await js(`hexle.docks.island.el.querySelectorAll('.mtab')[1].click(); 0`); await wait(300);
console.log('item tab:', await js(`hexle.docks.island.el.querySelector('.mtab.on').textContent`));
await shot('mobile_items');
await send('Emulation.clearDeviceMetricsOverride'); await wait(800);

// 초기화: 확인 창에서 취소하면 그대로, 초기화를 누르면 처음 상태
await js(`document.getElementById('reset').click(); 0`); await wait(300);
console.log('modal open:', await js(`!document.getElementById('modal').hidden`));
await js(`document.querySelector('#modal .no').click(); 0`); await wait(300);
console.log('after cancel:', await js(`'cells=' + hexle.state.cells.length + ' modalHidden=' + document.getElementById('modal').hidden`));
await js(`document.getElementById('reset').click(); 0`); await wait(300);
await js(`document.querySelector('#modal .yes').click(); 0`); await wait(2500);
console.log('after reset:', await js(`'cells=' + hexle.state.cells.length + ' items=' + hexle.state.items.length + ' saved=' + !!localStorage.getItem('hexle.save.v1')`));
console.log('console:', logs.length ? logs.slice(0, 12).join('\n  ') : 'clean');
console.log('screenshots →', OUT);
ws.close(); chrome.kill();
