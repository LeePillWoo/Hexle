// 인벤토리 패널 하나에 타일·아이템 섹션을 탭으로. 머리줄: [타일][아이템] 탭 · 투명 버튼(이스터에그) · 접기 화살표.
// 섹션마다: 같은 종류는 한 장에 ×개수, 분류 탭, 5열×4줄 고정 그리드.
// 합성: 버튼 한 번에 가장 많이 가진 카드 두 장을 써서, 가장 적게 가진 종류(없는 것 포함) 중 하나를 얻는다.
//  가장 많은 종류와 가장 적은 종류의 차이가 1 이하로 고르게 모이면 더 합성하지 않는다.
// 이스터에그: 접기 화살표 왼쪽 빈 곳을 누르면 지금 열린 탭에 무작위 카드 한 장.
export type SectionOpts = {
  id: string; label: string; cls: string;
  tabs: readonly (readonly [string, readonly string[]])[];
  info: (kind: string) => { name: string; icon: string; sub: string };
  roll: () => string;                         // 무작위 종류 (문제 보상·이스터에그)
  onSelect: (kind: string | null) => void;
  onAdd?: (kind: string) => void;             // 이스터에그로 얻었을 때
  onSynth?: (a: string, b: string, result: string) => void;
};
const SLOTS = 20;   // 5열 × 4줄 — 카드 수가 바뀌어도 패널 크기·버튼 위치가 그대로

export function createDock(o: { id: string; sections: SectionOpts[]; onChange?: () => void }) {
  let active = 0;
  const el = document.createElement('div');
  el.className = 'panel inv';
  el.id = o.id;
  el.innerHTML = `<div class="head"><div class="main"></div><button class="egg" aria-hidden="true" tabindex="-1"></button><button class="fold" title="접기/펼치기">▾</button></div>
    <div class="row"><button class="synth">⚗️ 합성 (많은 카드 2장 → 1장)</button></div><div class="tabs"></div><div class="cards"></div>`;
  document.body.appendChild(el);
  const q = <T extends HTMLElement>(s: string) => el.querySelector(s) as T;
  const mainEl = q('.main'), tabsEl = q('.tabs'), cardsEl = q('.cards'), synthBtn = q<HTMLButtonElement>('.synth');

  const sections = o.sections.map(s => {
    const have = new Map<string, number>();
    let tab = 0, selected: string | null = null;
    const all = () => s.tabs[0][1], total = () => [...have.values()].reduce((a, b) => a + b, 0);
    const spread = () => { const c = all().map(k => have.get(k) ?? 0); return Math.max(...c) - Math.min(...c); };
    const canFuse = () => total() >= 2 && spread() >= 2;
    function dec(k: string) { const n = (have.get(k) ?? 0) - 1; if (n > 0) have.set(k, n); else have.delete(k); }
    const sec = {
      id: s.id, opts: s, roll: s.roll, total,
      get selected() { return selected; },
      add(kind: string, n = 1) { have.set(kind, (have.get(kind) ?? 0) + n); render(); o.onChange?.(); },
      // 한 장 쓰고 남은 수를 돌려준다
      take(kind: string) {
        dec(kind);
        const left = have.get(kind) ?? 0;
        if (!left && selected === kind) selected = null;
        render(); o.onChange?.();
        return left;
      },
      select(kind: string | null) { selected = kind; render(); s.onSelect(kind); },
      clear() { if (selected) { selected = null; render(); } },   // 다른 섹션이 선택될 때 (콜백 없이)
      counts: () => Object.fromEntries(have),
      set(c: Record<string, number>) {
        have.clear();
        for (const [k, n] of Object.entries(c)) if (n > 0 && all().includes(k)) have.set(k, Math.floor(n));
        selected = null; render();
      },
      fuse() {
        // 가장 많은 종류부터 두 장 (한 종류가 2장 이상이면 그것 두 장). 수가 같으면 무작위
        const owned = [...have].sort((x, y) => y[1] - x[1] || Math.random() - 0.5);
        if (!canFuse()) return;
        const a = owned[0][0], b = owned[0][1] >= 2 ? a : owned[1][0];
        dec(a); dec(b);
        if (selected && !have.get(selected)) sec.select(null);
        const counts = all().map(k => have.get(k) ?? 0), min = Math.min(...counts);
        const pool = all().filter((_, i) => counts[i] === min), result = pool[Math.floor(Math.random() * pool.length)];
        have.set(result, (have.get(result) ?? 0) + 1);
        render(); o.onChange?.();
        s.onSynth?.(a, b, result);
      },
      renderBody() {
        synthBtn.disabled = !canFuse();
        synthBtn.textContent = total() >= 2 && !canFuse() ? '⚗️ 합성 완료 (고르게 모였어요)' : '⚗️ 합성 (많은 카드 2장 → 1장)';
        tabsEl.replaceChildren(...s.tabs.map(([name, kinds], i) => {
          const b = document.createElement('button');
          b.className = 'tab' + (i === tab ? ' on' : '');
          b.innerHTML = `${name} <i>${kinds.reduce((n, k) => n + (have.get(k) ?? 0), 0)}</i>`;
          b.onclick = () => { tab = i; render(); };
          return b;
        }));
        const slots: HTMLElement[] = s.tabs[tab][1].filter(k => have.get(k)).map(kind => {
          const b = document.createElement('button'), info = s.info(kind), on = selected === kind;
          b.className = `card ${s.cls}` + (on ? ' sel' : '');
          b.innerHTML = `<b>${info.icon}</b>${info.name}<small>${info.sub}</small><em>×${have.get(kind)}</em>`;
          b.onclick = () => sec.select(on ? null : kind);
          return b;
        });
        while (slots.length < SLOTS || slots.length % 5) slots.push(Object.assign(document.createElement('div'), { className: 'slot' }));
        cardsEl.replaceChildren(...slots);
      },
    };
    return sec;
  });

  function render() {
    mainEl.replaceChildren(...sections.map((sec, i) => {
      const b = document.createElement('button');
      b.className = 'mtab' + (i === active ? ' on' : '');
      b.innerHTML = `${sec.opts.label} <i>${sec.total()}</i>`;
      b.onclick = () => { active = i; render(); };
      return b;
    }));
    sections[active].renderBody();
  }
  q<HTMLButtonElement>('.egg').onclick = () => { const s = sections[active], k = s.roll(); s.add(k); s.opts.onAdd?.(k); };
  q<HTMLButtonElement>('.fold').onclick = () => { const f = el.classList.toggle('collapsed'); q('.fold').textContent = f ? '▴' : '▾'; };
  synthBtn.onclick = () => sections[active].fuse();
  render();
  return { el, sections, show(v: boolean) { el.style.display = v ? '' : 'none'; } };
}
export type Section = ReturnType<typeof createDock>['sections'][number];
