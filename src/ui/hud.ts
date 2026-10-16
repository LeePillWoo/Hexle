// HUD: 모드(섬/바닷속)·잠수 버튼, 그리드·경계선 토글, 안내 메시지
export type Mode = 'island' | 'sea';

export function createHud(o: { onMode: (m: Mode) => void; onDive: (down: boolean) => void; onToggle: (grid: boolean, edge: boolean) => void; onEscape: () => void }) {
  const bar = document.createElement('div');
  bar.className = 'panel';
  bar.id = 'bar';
  bar.innerHTML = `
    <button id="mIsland" class="mode on">🏝️ 섬</button><button id="mSea" class="mode">🌊 바닷속</button>
    <span class="sep"></span><button id="dive">🤿 잠수 (D)</button>`;
  const toggles = document.createElement('div');
  toggles.className = 'panel';
  toggles.id = 'toggles';
  toggles.innerHTML = `<label><input type="checkbox" id="tGrid" checked /> 육각 그리드 (G)</label><label><input type="checkbox" id="tEdge" checked /> 영역 경계선 (B)</label>`;
  const msg = document.createElement('div');
  msg.id = 'msg';
  document.body.append(bar, toggles, msg);

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const tGrid = $<HTMLInputElement>('tGrid'), tEdge = $<HTMLInputElement>('tEdge'), diveBtn = $<HTMLButtonElement>('dive');
  let mode: Mode = 'island', diving = false;
  const sync = () => o.onToggle(tGrid.checked, tEdge.checked);
  tGrid.onchange = tEdge.onchange = sync;

  function setMode(m: Mode, fire = true) {
    mode = m;
    $('mIsland').classList.toggle('on', m === 'island');
    $('mSea').classList.toggle('on', m === 'sea');
    if (fire) o.onMode(m);
  }
  function setDive(down: boolean) {
    diving = down;
    diveBtn.textContent = down ? '🌅 수면으로 (D)' : '🤿 잠수 (D)';
    o.onDive(down);
  }
  $('mIsland').onclick = () => setMode('island');
  $('mSea').onclick = () => setMode('sea');
  diveBtn.onclick = () => setDive(!diving);
  addEventListener('keydown', e => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    if (k === 'g') { tGrid.checked = !tGrid.checked; sync(); }
    if (k === 'b') { tEdge.checked = !tEdge.checked; sync(); }
    if (k === 'd') setDive(!diving);
    if (e.key === 'Escape') o.onEscape();
  });
  return {
    say(text: string, ok = true) { msg.textContent = text; msg.style.color = ok ? '#2f7a2f' : '#b3261e'; },
    setMode, setDive, get mode() { return mode; }, get diving() { return diving; },
  };
}
