// 인벤토리 패널: 같은 종류는 한 장에 ×개수, 탭으로 분류, 5열×4줄 고정 그리드. 접기 버튼, 모바일용 타일↔아이템 전환 버튼
export type InventoryOpts = {
  id: string; title: string; side: 'left' | 'right'; addLabel: string;
  tabs: readonly (readonly [string, readonly string[]])[];
  info: (kind: string) => { name: string; icon: string; sub: string };
  roll: () => string;                         // 추가 버튼: 무작위 종류
  onSelect: (kind: string | null) => void;
  onAdd?: (kind: string) => void;
  onChange?: () => void;                      // 보유 수가 바뀔 때 (저장용)
  swapLabel?: string; onSwap?: () => void;    // 모바일: 타일 ↔ 아이템 패널 전환
};
const SLOTS = 20;   // 5열 × 4줄 — 카드 수가 바뀌어도 패널 크기·버튼 위치가 그대로

export function createInventory(o: InventoryOpts) {
  const have = new Map<string, number>();
  let tab = 0, selected: string | null = null;
  const el = document.createElement('div');
  el.className = `panel inv ${o.side}`;
  el.id = o.id;
  el.innerHTML = `<div class="head"><button class="swap">${o.swapLabel ?? ''}</button><span class="title">${o.title}</span><button class="fold" title="접기/펼치기">▾</button></div>
    <button class="add">${o.addLabel}</button><div class="tabs"></div><div class="cards"></div>`;
  document.body.appendChild(el);
  const tabsEl = el.querySelector('.tabs')!, cardsEl = el.querySelector('.cards')!;
  el.querySelector<HTMLButtonElement>('.add')!.onclick = () => { const k = o.roll(); add(k); o.onAdd?.(k); };
  el.querySelector<HTMLButtonElement>('.swap')!.onclick = () => o.onSwap?.();
  el.querySelector<HTMLButtonElement>('.fold')!.onclick = () => {
    const folded = el.classList.toggle('collapsed');
    el.querySelector('.fold')!.textContent = folded ? '▴' : '▾';
  };

  function render() {
    const total = (kinds: readonly string[]) => kinds.reduce((s, k) => s + (have.get(k) ?? 0), 0);
    tabsEl.replaceChildren(...o.tabs.map(([name, kinds], i) => {
      const b = document.createElement('button');
      b.className = 'tab' + (i === tab ? ' on' : '');
      b.innerHTML = `${name} <i>${total(kinds)}</i>`;
      b.onclick = () => { tab = i; render(); };
      return b;
    }));
    const slots: HTMLElement[] = o.tabs[tab][1].filter(k => have.get(k)).map(kind => {
      const b = document.createElement('button'), info = o.info(kind), on = selected === kind;
      b.className = 'card' + (on ? ' sel' : '');
      b.innerHTML = `<b>${info.icon}</b>${info.name}<small>${info.sub}</small><em>×${have.get(kind)}</em>`;
      b.onclick = () => select(on ? null : kind);
      return b;
    });
    while (slots.length < SLOTS || slots.length % 5) slots.push(Object.assign(document.createElement('div'), { className: 'slot' }));
    cardsEl.replaceChildren(...slots);
  }
  function add(kind: string) { have.set(kind, (have.get(kind) ?? 0) + 1); render(); o.onChange?.(); }
  // 한 장 쓰고 남은 수를 돌려준다
  function take(kind: string) {
    const left = (have.get(kind) ?? 0) - 1;
    if (left > 0) have.set(kind, left); else have.delete(kind);
    if (left <= 0 && selected === kind) selected = null;
    render();
    o.onChange?.();
    return Math.max(0, left);
  }
  function select(kind: string | null) { selected = kind; render(); o.onSelect(kind); }
  function clear() { if (selected) { selected = null; render(); } }   // 다른 패널이 선택될 때 (콜백 없이)
  const counts = () => Object.fromEntries(have);
  function set(c: Record<string, number>) {
    have.clear();
    for (const [k, n] of Object.entries(c)) if (n > 0 && o.tabs[0][1].includes(k)) have.set(k, Math.floor(n));
    selected = null;
    render();
  }
  render();
  return { id: o.id, el, add, take, select, clear, counts, set, get selected() { return selected; }, show(v: boolean) { el.style.display = v ? '' : 'none'; } };
}
export type Inventory = ReturnType<typeof createInventory>;
