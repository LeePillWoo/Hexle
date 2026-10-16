// 사칙연산 문제 패널: 연산(덧셈·뺄셈·곱셈·나눗셈·랜덤)과 자릿수(한·두·세 자리·랜덤)를 고른다. 맞히면 onCorrect 보상.
// 고른 설정은 브라우저에 기억한다.
type Op = '+' | '-' | '×' | '÷';
const OPS: Op[] = ['+', '-', '×', '÷'];
const KEY = 'hexle.quiz.v1';
const rand = (lo: number, hi: number) => lo + Math.floor(Math.random() * (hi - lo + 1));
const ofDigits = (n: number) => rand(n === 1 ? 1 : 10 ** (n - 1), 10 ** n - 1);

// n 자리 문제 하나. 뺄셈은 답이 음수가 안 되게, 곱셈·나눗셈은 한 자리 수로 곱하고 나눈다(나눗셈은 나누어떨어지게)
export function makeProblem(op: Op, n: number) {
  let a: number, b: number, answer: number;
  switch (op) {
    case '+': a = ofDigits(n); b = ofDigits(n); answer = a + b; break;
    case '-': a = ofDigits(n); b = ofDigits(n); if (b > a) [a, b] = [b, a]; answer = a - b; break;
    case '×': a = ofDigits(n); b = n === 1 ? rand(1, 9) : rand(2, 9); answer = a * b; break;
    case '÷': {
      b = rand(2, 9);
      const lo = n === 1 ? 1 : 10 ** (n - 1), hi = 10 ** n - 1;
      const q = rand(Math.max(1, Math.ceil(lo / b)), Math.max(1, Math.floor(hi / b)));
      a = b * q; answer = q; break;
    }
  }
  return { text: `${a} ${op} ${b} = ?`, answer };
}

export function mountQuiz(onCorrect: (digits: number) => string) {
  let cfg = { op: 'rand', digits: '1' };
  try { cfg = { ...cfg, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; } catch { /* 기본값 */ }
  const el = document.createElement('div');
  el.className = 'panel';
  el.id = 'quiz';
  el.innerHTML = `
    <div class="head"><span class="title">문제를 풀면 카드를 얻어요</span><button class="fold" title="접기/펼치기">▾</button></div>
    <div class="body">
      <div class="modes">
        <select class="op"><option value="+">덧셈</option><option value="-">뺄셈</option><option value="×">곱셈</option><option value="÷">나눗셈</option><option value="rand">랜덤</option></select>
        <select class="digits"><option value="1">한 자리</option><option value="2">두 자리</option><option value="3">세 자리</option><option value="rand">자릿수 랜덤</option></select>
      </div>
      <div class="q"></div>
      <form><input type="number" inputmode="numeric" autocomplete="off" enterkeyhint="done" /><button>확인</button></form>
      <div class="qmsg"></div>
    </div>`;
  document.body.appendChild(el);
  const $ = <T extends Element>(s: string) => el.querySelector(s) as T;
  const q = $<HTMLElement>('.q'), ans = $<HTMLInputElement>('input'), msg = $<HTMLElement>('.qmsg');
  const opSel = $<HTMLSelectElement>('.op'), digSel = $<HTMLSelectElement>('.digits');
  opSel.value = cfg.op; digSel.value = cfg.digits;

  let cur = { text: '', answer: 0 }, curDigits = 1;
  function next() {
    const op = opSel.value === 'rand' ? OPS[rand(0, 3)] : opSel.value as Op;
    curDigits = digSel.value === 'rand' ? rand(1, 3) : Number(digSel.value);
    let p = makeProblem(op, curDigits);
    while (p.text === cur.text) p = makeProblem(op, curDigits);
    cur = p;
    q.textContent = p.text;
    ans.value = '';
  }
  const save = () => { cfg = { op: opSel.value, digits: digSel.value }; try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch { /* 무시 */ } next(); };
  opSel.onchange = digSel.onchange = save;
  $<HTMLButtonElement>('.fold').onclick = () => { const f = el.classList.toggle('collapsed'); $<HTMLButtonElement>('.fold').textContent = f ? '▴' : '▾'; };
  $<HTMLFormElement>('form').addEventListener('submit', e => {
    e.preventDefault();
    if (ans.value === '') return;
    if (Number(ans.value) === cur.answer) {
      msg.textContent = `정답! ${onCorrect(curDigits)}`;
      msg.style.color = '#2f7a2f';
      next();
    } else {
      msg.textContent = '다시 생각해 봐요';
      msg.style.color = '#b3261e';
      ans.select();
    }
  });
  next();
  return el;
}
