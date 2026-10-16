// 인벤토리 패널: 같은 종류는 한 장에 ×개수, 탭으로 분류, 5열×4줄 고정 그리드.
// 합성: 두 장을 고르면 이 인벤토리에서 가장 적게 가진 종류(없는 것 포함) 중 하나가 나온다.
// 접기 버튼 왼쪽 빈 곳은 투명 버튼(테스트용 이스터에그): 누르면 무작위 카드 한 장.
export type InventoryOpts = {
  id: string; title: string; side: 'left' | 'right';
  tabs: readonly (readonly [string, readonly string[]])[];
  info: (kind: string) => { name: string; icon: string; sub: string };
  roll: () => string;                         // 이스터에그: 무작위 종류
  onSelect: (kind: string | null) => void;
  onAdd?: (kind: string) => void;
  onSynth?: (a: string, b: string, result: string) => void;
  onChange?: () => void;                      // 보유 수가 바뀔 때 (저장용)
  swapLabel?: string; onSwap?: () => void;    // 모바일: 타일 ↔ 아이템 패널 전환
};
const SLOTS = 20;   // 5열 × 4줄 — 카드 수가 바뀌어도 패널 크기·버튼 위치가 그대로

export function createInventory(o: InventoryOpts) {
  const have = new Map<string, number>();
  let tab = 0, selected: string | null = null, synth: string[] | null = null;
  const el = document.createElement('div');
  el.className = `panel inv ${o.side}`;
  el.id = o.id;
  el.innerHTML = `<div class="head"><button class="swap">${o.swapLabel ?? ''}</button><span class="title">${o.title}</span><button class="egg" aria-hidden="true" tabindex="-1"></button><button class="fold" title="접기/펼치기">▾</button></div>
    <div class="row"><button class="synth">⚗️ 합성 (2장 → 1장)</button><button class="cancel" hidden>취소</button></div><div class="tabs"></div><div class="cards"></div>`;
  document.body.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const tabsEl = q('.tabs'), cardsEl = q('.cards'), synthBtn = q<HTMLButtonElement>('.synth'), cancelBtn = q<HTMLButtonElement>('.cancel');
  q<HTMLButtonElement>('.egg').onclick = () => { const k = o.roll(); add(k); o.onAdd?.(k); };
  q<HTMLButtonElement>('.swap').onclick = () => o.onSwap?.();
  q<HTMLButtonElement>('.fold').onclick = () => { const f = el.classList.toggle('collapsed'); q('.fold').textContent = f ? '▴' : '▾'; };
  synthBtn.onclick = () => {
    if (!synth) { if (selected) select(null); synth = []; render(); return; }
    if (synth.length === 2) fuse();
  };
  cancelBtn.onclick = () => { synth = null; render(); };

  const all = () => o.tabs[0][1];
  function fuse() {
    const [a, b] = synth!;
    for (const k of [a, b]) dec(k);
    const counts = all().map(k => have.get(k) ?? 0), min = Math.min(...counts);
    const pool = all().filter((_, i) => counts[i] === min), result = pool[Math.floor(Math.random() * pool.length)];
    have.set(result, (have.get(result) ?? 0) + 1);
    synth = [];
    render();
    o.onChange?.();
    o.onSynth?.(a, b, result);
  }
  function dec(k: string) { const n = (have.get(k) ?? 0) - 1; if (n > 0) have.set(k, n); else have.delete(k); }

  function render() {
    const total = (kinds: readonly string[]) => kinds.reduce((s, k) => s + (have.get(k) ?? 0), 0);
    el.classList.toggle('synthing', !!synth);
    synthBtn.textContent = synth ? `⚗️ 합성하기 (${synth.length}/2)` : '⚗️ 합성 (2장 → 1장)';
    synthBtn.disabled = !!synth && synth.length < 2;
    cancelBtn.hidden = !synth;
    tabsEl.replaceChildren(...o.tabs.map(([name, kinds], i) => {
      const b = document.createElement('button');
      b.className = 'tab' + (i === tab ? ' on' : '');
      b.innerHTML = `${name} <i>${total(kinds)}</i>`;
      b.onclick = () => { tab = i; render(); };
      return b;
    }));
    const slots: HTMLElement[] = o.tabs[tab][1].filter(k => have.get(k)).map(kind => {
      const b = document.createElement('button'), info = o.info(kind), picked = synth?.filter(k => k === kind).length ?? 0;
      const on = synth ? picked > 0 : selected === kind;
      b.className = 'card' + (on ? ' sel' : '');
      b.innerHTML = `<b>${info.icon}</b>${info.name}<small>${info.sub}</small><em>×${have.get(kind)}</em>${picked ? `<u>${picked}</u>` : ''}`;
      b.onclick = () => {
        if (!synth) { select(selected === kind ? null : kind); return; }
        // 합성 고르기: 같은 종류는 가진 만큼까지, 두 장 찼으면 다시 누른 것을 뺀다
        if (picked && (synth.length === 2 || picked >= (have.get(kind) ?? 0))) synth.splice(synth.indexOf(kind), 1);
        else if (synth.length < 2) synth.push(kind);
        render();
      };
      return b;
    });
    while (slots.length < SLOTS || slots.length % 5) slots.push(Object.assign(document.createElement('div'), { className: 'slot' }));
    cardsEl.replaceChildren(...slots);
  }
  function add(kind: string, n = 1) { have.set(kind, (have.get(kind) ?? 0) + n); render(); o.onChange?.(); }
  // 한 장 쓰고 남은 수를 돌려준다
  function take(kind: string) {
    dec(kind);
    const left = have.get(kind) ?? 0;
    if (!left && selected === kind) selected = null;
    render();
    o.onChange?.();
    return left;
  }
  function select(kind: string | null) { selected = kind; render(); o.onSelect(kind); }
  function clear() { if (selected || synth) { selected = null; synth = null; render(); } }   // 다른 패널이 선택될 때 (콜백 없이)
  const counts = () => Object.fromEntries(have);
  function set(c: Record<string, number>) {
    have.clear();
    for (const [k, n] of Object.entries(c)) if (n > 0 && all().includes(k)) have.set(k, Math.floor(n));
    selected = null; synth = null;
    render();
  }
  render();
  return { id: o.id, el, add, take, select, clear, counts, set, roll: o.roll, get selected() { return selected; }, show(v: boolean) { el.style.display = v ? '' : 'none'; } };
}
export type Inventory = ReturnType<typeof createInventory>;
