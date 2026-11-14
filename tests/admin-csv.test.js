import assert from 'node:assert/strict';
import test from 'node:test';
import { CSV_HEADER, decodeCsvFile, parseCsv, questionsFromCsv, questionsToCsv } from '../apps/admin/public/js/csv.js';

const sample = [
  { prompt: '空の色は？', options: ['青', '赤', '緑', '黄'], correctIndex: 0, explanation: '' },
  { prompt: '"引用符", カンマ、\n改行を含む問題', options: ['1', '2', '3', '4'], correctIndex: 3, explanation: '解説, です' }
];

test('書き出した CSV を読み込むと同じ問題に戻る（引用符・カンマ・改行を含む）', () => {
  const csv = questionsToCsv(sample);
  assert.ok(csv.startsWith('﻿'), 'Excel 向けに BOM 付き');
  assert.ok(csv.includes(CSV_HEADER.join(',')));
  const { questions, errors } = questionsFromCsv(csv);
  assert.deepEqual(errors, []);
  assert.deepEqual(questions, sample);
});

test('parseCsv: 引用符の中の "" と改行、CRLF、末尾の空行', () => {
  assert.deepEqual(parseCsv('a,"b ""c""",d\r\n"e\nf",,g\r\n\r\n'), [
    ['a', 'b "c"', 'd'],
    ['e\nf', '', 'g']
  ]);
});

test('見出し行は省略でき、正解は全角数字も受け付ける', () => {
  const { questions, errors } = questionsFromCsv('問い,A,B,C,D,２,\n');
  assert.deepEqual(errors, []);
  assert.equal(questions[0].correctIndex, 1);
  // 「問題文」という文の問題は、正解の列が数字なので見出しと取り違えない
  const literal = questionsFromCsv('問題文,A,B,C,D,3,\n');
  assert.deepEqual(literal.errors, []);
  assert.equal(literal.questions[0].prompt, '問題文');
});

test('誤りのある行は「何行目の何が悪いか」をまとめて返す', () => {
  const csv = [CSV_HEADER.join(','), ',A,B,C,D,1,', '問い,A,B,,D,5,', `${'あ'.repeat(301)},A,B,C,D,1,`].join('\n');
  const { errors } = questionsFromCsv(csv);
  assert.deepEqual(errors, [
    '2 行目: 問題文が空です',
    '3 行目: 選択肢を 4 つ入力してください、正解は 1〜4 の数字で入力してください',
    '4 行目: 問題文は 300 文字までです'
  ]);
  assert.deepEqual(questionsFromCsv('').errors, ['CSV が空です。']);
  assert.deepEqual(questionsFromCsv(CSV_HEADER.join(',')).errors, ['問題の行がありません。']);
});

test('decodeCsvFile: UTF-8 と、Excel が保存する Shift_JIS の両方を読める', () => {
  const utf8 = new TextEncoder().encode('問題文,選択肢1');
  assert.equal(decodeCsvFile(utf8.buffer), '問題文,選択肢1');
  // 「問題文」を Shift_JIS で表したバイト列
  const sjis = Uint8Array.from([0x96, 0xe2, 0x91, 0xe8, 0x95, 0xb6]);
  assert.equal(decodeCsvFile(sjis.buffer), '問題文');
});
