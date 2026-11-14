import { LIMITS, OPTION_COUNT, charLength } from '../shared/contracts.js';

/**
 * 問題の CSV 読み込み・書き出し。
 *
 * 形式（1 行目は見出し）:
 *   問題文,選択肢1,選択肢2,選択肢3,選択肢4,正解,解説
 * 正解は 1〜4（何番目の選択肢か）。解説は空でもよい。
 * Excel で編集できるよう、書き出しは UTF-8（BOM 付き）、読み込みは UTF-8 と Shift_JIS に対応する。
 */

export const CSV_HEADER = ['問題文', '選択肢1', '選択肢2', '選択肢3', '選択肢4', '正解', '解説'];

/** CSV の書式の誤り（引用符が閉じていない等）。line は何行目（表計算ソフトの行番号）か。 */
export class CsvSyntaxError extends Error {
  /** @param {number} line @param {string} message */
  constructor(line, message) {
    super(`${line} 行目: ${message}`);
    this.name = 'CsvSyntaxError';
    this.line = line;
  }
}

/**
 * RFC 4180 形式の CSV を行に分ける（引用符・引用符内の改行とカンマに対応）。
 * line は 1 から数えた行番号。空行も数えるので、表計算ソフトの行番号と一致する。
 * 空行（Excel が末尾に付けることがある）は結果に含めない。
 * @param {string} text
 * @returns {Array<{ line: number, cells: string[] }>}
 * @throws {CsvSyntaxError} 引用符が閉じていないとき（以降の行が 1 つの項目に飲み込まれるのを防ぐ）
 */
export function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  let quoteLine = 0;
  const finishRow = () => {
    row.push(field);
    rows.push({ line: rows.length + 1, cells: row });
    row = [];
    field = '';
  };
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
    } else if (char === '"' && field === '') {
      quoted = true;
      quoteLine = rows.length + 1;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      finishRow();
    } else {
      field += char;
    }
  }
  if (quoted) throw new CsvSyntaxError(quoteLine, '引用符（"）が閉じられていません');
  if (field !== '' || row.length) finishRow();
  return rows.filter(({ cells }) => cells.some(cell => cell.trim() !== ''));
}

/**
 * CSV を行の配列にする（行番号が要らないとき用）。
 * @param {string} text
 * @returns {string[][]}
 */
export function parseCsv(text) {
  return parseCsvRows(text).map(({ cells }) => cells);
}

/** @param {string[][]} rows */
export function toCsv(rows) {
  const escape = value => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
  return rows.map(cells => cells.map(cell => escape(String(cell ?? ''))).join(',')).join('\r\n') + '\r\n';
}

/**
 * ファイルの中身を文字列にする。UTF-8（BOM の有無を問わない）として読めなければ Shift_JIS として読む。
 * @param {ArrayBuffer} buffer
 */
export function decodeCsvFile(buffer) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    return new TextDecoder('shift_jis').decode(buffer);
  }
}

/**
 * CSV の文字列から問題を作る。誤りのある行は「何行目の何が悪いか」を errors に入れる。
 * @param {string} text
 * @returns {{ questions: Array<{ prompt: string, options: string[], correctIndex: number, explanation: string }>, errors: string[] }}
 */
export function questionsFromCsv(text) {
  let rows;
  try {
    rows = parseCsvRows(text.replace(/^\uFEFF/, ''));
  } catch (error) {
    if (error instanceof CsvSyntaxError) return { questions: [], errors: [error.message] };
    throw error;
  }
  const errors = [];
  if (!rows.length) return { questions: [], errors: ['CSV が空です。'] };

  // 1 行目が見出しなら読み飛ばす（「問題文」という問題を見出しと取り違えないよう、正解の列が数字でないことも確かめる）
  const [firstCell = '', ...firstRest] = rows[0].cells.map(cell => cell.trim());
  const isHeader = firstCell === CSV_HEADER[0] && !/^\d+$/.test((firstRest[OPTION_COUNT] ?? '').normalize('NFKC'));
  const body = isHeader ? rows.slice(1) : rows;
  if (!body.length) return { questions: [], errors: ['問題の行がありません。'] };
  if (body.length > LIMITS.questions) errors.push(`問題は ${LIMITS.questions} 問までです（${body.length} 行あります）。`);

  const questions = body.slice(0, LIMITS.questions).map(({ line, cells }) => {
    const [prompt = '', ...rest] = cells.map(cell => cell.trim());
    const options = rest.slice(0, OPTION_COUNT);
    const correct = rest[OPTION_COUNT] ?? '';
    const explanation = rest[OPTION_COUNT + 1] ?? '';
    const problems = [];
    // 引用符で囲み忘れたカンマ等で列がずれると、解説の後ろが黙って捨てられてしまうので誤りにする（末尾の空の列は許す）
    if (rest.slice(OPTION_COUNT + 2).some(cell => cell !== '')) problems.push(`列は ${CSV_HEADER.length} 列までです（カンマを含む項目は "" で囲んでください）`);
    if (!prompt) problems.push('問題文が空です');
    else if (charLength(prompt) > LIMITS.prompt) problems.push(`問題文は ${LIMITS.prompt} 文字までです`);
    if (options.length < OPTION_COUNT || options.some(option => !option)) problems.push(`選択肢を ${OPTION_COUNT} つ入力してください`);
    else if (options.some(option => charLength(option) > LIMITS.option)) problems.push(`選択肢は ${LIMITS.option} 文字までです`);
    const correctNumber = Number(correct.normalize('NFKC'));
    if (!Number.isInteger(correctNumber) || correctNumber < 1 || correctNumber > OPTION_COUNT) problems.push(`正解は 1〜${OPTION_COUNT} の数字で入力してください`);
    if (charLength(explanation) > LIMITS.explanation) problems.push(`解説は ${LIMITS.explanation} 文字までです`);
    if (problems.length) errors.push(`${line} 行目: ${problems.join('、')}`);
    return {
      prompt,
      options: Array.from({ length: OPTION_COUNT }, (_, optionIndex) => options[optionIndex] ?? ''),
      correctIndex: problems.length ? 0 : correctNumber - 1,
      explanation
    };
  });
  return { questions, errors };
}

/** 問題を CSV（見出し付き、Excel 向けに BOM 付き）にする。 */
export function questionsToCsv(questions) {
  return (
    '\uFEFF' +
    toCsv([
      CSV_HEADER,
      ...questions.map(question => [question.prompt, ...question.options, String(question.correctIndex + 1), question.explanation])
    ])
  );
}
