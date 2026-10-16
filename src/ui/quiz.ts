// 덧셈 문제 패널 (지금은 꺼 둠). 다시 쓰려면 main.ts 에서 mountQuiz(() => 보상 지급) 한 줄.
// 패널 스타일(.panel, .title)은 index.html 의 CSS 를 쓴다.
export function mountQuiz(onCorrect: () => string) {
  const el = document.createElement('div');
  el.className = 'panel';
  el.style.cssText = 'top:14px;left:14px;width:220px';
  el.innerHTML = `
    <div class="title">문제를 풀면 보상을 얻어요</div>
    <div class="q" style="font-size:30px;font-weight:800;margin:4px 0 8px"></div>
    <form style="display:flex;gap:6px"><input type="number" inputmode="numeric" autocomplete="off"
      style="width:0;flex:1;font-size:20px;padding:4px 8px" /><button>확인</button></form>
    <div class="msg" style="min-height:20px;margin-top:6px;font-weight:600"></div>`;
  document.body.appendChild(el);
  const q = el.querySelector<HTMLElement>('.q')!, ans = el.querySelector('input')!, msg = el.querySelector<HTMLElement>('.msg')!;

  let a = 0, b = 0;
  function next() {
    const prev = a * 10 + b;
    do { a = 1 + Math.floor(Math.random() * 9); b = 1 + Math.floor(Math.random() * 9); } while (a * 10 + b === prev);
    q.textContent = `${a} + ${b} = ?`;
    ans.value = '';
    ans.focus();
  }
  el.querySelector('form')!.addEventListener('submit', e => {
    e.preventDefault();
    if (ans.value === '') return;
    if (Number(ans.value) === a + b) {
      msg.textContent = `정답! ${onCorrect()}`;
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
