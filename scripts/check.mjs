// 헤드리스 크롬 자동 점검: 모든 타일·아이템을 놓고 배치 규칙과 잠수를 검사한 뒤 스크린샷을 남긴다.
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

await wait(6000);
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
  for (const [k, x, z] of put) hexle.state.addItem(k, x, z); return 'items ' + hexle.state.items.length; })()`));
console.log('canPlaceTile:', await js(`JSON.stringify({ attachOnSea: hexle.state.canPlaceTile('grass', { q: 8, r: 0 }), attachNext: hexle.state.canPlaceTile('grass', { q: -1, r: 0 }),
  isletNearLand: hexle.state.canPlaceTile('islet', { q: -1, r: 0 }), isletFar: hexle.state.canPlaceTile('islet', { q: -6, r: -3 }), reefOnLand: hexle.state.canPlaceTile('reef', { q: 0, r: 0 }), reefFar: hexle.state.canPlaceTile('reef', { q: 6, r: -4 }) })`));
await js(`document.getElementById('tGrid').click(); document.getElementById('tEdge').click(); 0`);
await view(0.5, 0, 1, 0.5, 24, 15); await wait(3000); await shot('all');
await view(1.5, 0, -0.5, 1.5, 6, 3.5); await wait(1500); await shot('land');
await view(4.3, 0, 6.9, 4.3, 7, 11); await wait(1500); await shot('palace_top');
await view(9, -1, 1, 9, 5.5, 5); await wait(1500); await shot('reef_top');
await view(4.3, -1.2, 6.9, 4.3, -0.75, 10.2); await wait(2500); await shot('palace_under');
await view(9.5, -0.9, 1.5, 7.2, -0.5, 3.8); await wait(1500); await shot('reef_under');
await view(-9, -3.2, -2.5, -7.5, -2.4, 0.5); await wait(1500); await shot('trench_under');
await view(1.5, 0.3, 0, 1.5, 12, 9); await wait(1200); await js(`hexle.cam.dive(true); 0`); await wait(3000);
console.log('after dive:', await js(`hexle.hud.mode + ' underwater=' + hexle.cam.isUnderwater() + ' camY=' + hexle.cam.camera.position.y.toFixed(2)`));
await js(`document.querySelector('#seaTiles .add').click(); document.querySelector('#deepItems .add').click(); 0`);
await shot('dive_ui');
await js(`hexle.cam.dive(false); 0`); await wait(3000);
console.log('after surface:', await js(`hexle.hud.mode + ' underwater=' + hexle.cam.isUnderwater() + ' camY=' + hexle.cam.camera.position.y.toFixed(2)`));
console.log('console:', logs.length ? logs.slice(0, 12).join('\n  ') : 'clean');
console.log('screenshots →', OUT);
ws.close(); chrome.kill();
