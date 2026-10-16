// 실행: node src/core/quiz.check.ts — 문제 생성기: 자릿수·정답·음수·나누어떨어짐 검사
import assert from 'node:assert';
import { makeProblem } from '../ui/quiz.ts';

const digits = (s: string) => s.length;
for (const op of ['+', '-', '×', '÷'] as const) for (const n of [1, 2, 3]) for (let i = 0; i < 500; i++) {
  const p = makeProblem(op, n), [a, , b] = p.text.split(' '), A = Number(a), B = Number(b);
  const real = op === '+' ? A + B : op === '-' ? A - B : op === '×' ? A * B : A / B;
  assert.strictEqual(real, p.answer, p.text);
  assert.ok(p.answer >= 0 && Number.isInteger(p.answer), p.text);
  if (op === '+' || op === '-') { assert.strictEqual(digits(a), n, p.text); assert.strictEqual(digits(b), n, p.text); }
  if (op === '×') assert.strictEqual(digits(a), n, p.text);
  if (op === '÷') { assert.strictEqual(digits(a), n, p.text); assert.ok(B >= 2 && B <= 9, p.text); }
}
console.log('quiz ok');
