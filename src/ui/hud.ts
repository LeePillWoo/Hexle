// HUD: 상단 바(섬/바닷속 모드, 잠수, 지우기, 초기화, 격자·경계 토글), 안내 메시지, 확인 창
export type Mode = 'island' | 'sea';

export function createHud(o: {
  onMode: (m: Mode) => void; onDive: (down: boolean) => void; onToggle: (grid: boolean, edge: boolean) => void;
  onErase: (on: boolean) => void; onReset: () => void; onEscape: () => void;
}) {
  const btn = (id: string, icon: string, label: string, cls = '', title = '') =>
    `<button id="${id}" class="${cls}" title="${title}">${icon}<span class="label"> ${label}</span></button>`;
  const bar = document.createElement('div');
  bar.className = 'panel';
  bar.id = 'bar';
  bar.innerHTML = [
    btn('mIsland', '🏝️', '섬', 'mode on'), btn('mSea', '🌊', '바닷속', 'mode'), '<span class="sep"></span>',
    btn('dive', '🤿', '잠수 (D)'), '<span class="sep"></span>',
    btn('erase', '🧹', '지우기 (X)', '', '배치한 타일·생물 지우기'), btn('reset', '⟲', '초기화', '', '처음 상태로'), '<span class="sep"></span>',
    btn('tGrid', '⌗', '격자 (G)', 'on', '육각 그리드'), btn('tEdge', '⬡', '경계 (B)', 'on', '영역 경계선'),
  ].join('');
  const msg = document.createElement('div');
  msg.id = 'msg';
  const modal = document.createElement('div');
  modal.id = 'modal';
  modal.hidden = true;
  modal.innerHTML = `<div class="panel box"><p></p><div class="btns"><button class="no">취소</button><button class="yes">확인</button></div></div>`;
  document.body.append(bar, msg, modal);

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const isOn = (id: string) => $(id).classList.contains('on');
  let mode: Mode = 'island', diving = false, erasing = false, closeModal: ((v: boolean) => void) | null = null;
  const toggles = () => o.onToggle(isOn('tGrid'), isOn('tEdge'));
  for (const id of ['tGrid', 'tEdge']) $(id).onclick = () => { $(id).classList.toggle('on'); toggles(); };

  function setMode(m: Mode, fire = true) {
    mode = m;
    $('mIsland').classList.toggle('on', m === 'island');
    $('mSea').classList.toggle('on', m === 'sea');
    if (fire) o.onMode(m);
  }
  function setDive(down: boolean) {
    diving = down;
    $('dive').innerHTML = down ? '🌅<span class="label"> 수면으로 (D)</span>' : '🤿<span class="label"> 잠수 (D)</span>';
    o.onDive(down);
  }
  function setErase(on: boolean, fire = true) {
    erasing = on;
    $('erase').classList.toggle('on', on);
    if (fire) o.onErase(on);
  }
  // 확인 창: 확인을 눌러야 true
  function confirm(text: string, yes = '확인') {
    modal.querySelector('p')!.textContent = text;
    const yesBtn = modal.querySelector<HTMLButtonElement>('.yes')!, noBtn = modal.querySelector<HTMLButtonElement>('.no')!;
    yesBtn.textContent = yes;
    modal.hidden = false;
    return new Promise<boolean>(res => {
      closeModal = v => { modal.hidden = true; closeModal = null; res(v); };
      yesBtn.onclick = () => closeModal?.(true);
      noBtn.onclick = () => closeModal?.(false);
    });
  }
  $('mIsland').onclick = () => setMode('island');
  $('mSea').onclick = () => setMode('sea');
  $('dive').onclick = () => setDive(!diving);
  $('erase').onclick = () => setErase(!erasing);
  $('reset').onclick = () => o.onReset();
  addEventListener('keydown', e => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    if (e.key === 'Escape') { if (closeModal) closeModal(false); else o.onEscape(); return; }
    if (closeModal) return;
    const k = e.key.toLowerCase();
    if (k === 'g') $('tGrid').click();
    if (k === 'b') $('tEdge').click();
    if (k === 'd') setDive(!diving);
    if (k === 'x') setErase(!erasing);
  });
  return {
    say(text: string, ok = true) { msg.textContent = text; msg.style.color = ok ? '#2f7a2f' : '#b3261e'; },
    setMode, setDive, setErase, confirm,
    get mode() { return mode; }, get diving() { return diving; }, get erasing() { return erasing; },
  };
}
