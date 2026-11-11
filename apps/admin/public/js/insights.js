import { QUIZ_STATUS, STATUS_LABELS } from '../shared/contracts.js';
import { h } from '../shared/dom.js';

/**
 * クイズの分析画面: 主要指標・得点分布・設問別の正答率・変更履歴。
 *
 * グラフはすべて 1 系列なのでテーマ色 1 色で描き、値は必ず文字でも併記する
 * （色や棒の長さだけに頼らない）。棒にはホバーで詳細を出す title を付ける。
 */

const LETTERS = ['A', 'B', 'C', 'D'];
const dateTime = new Intl.DateTimeFormat('ja-JP', { dateStyle: 'medium', timeStyle: 'short' });
const percent = value => (value === null || value === undefined ? '—' : `${Math.round(value * 100)}%`);

const ACTION_LABELS = {
  'quiz.create': '作成',
  'quiz.update': '編集',
  'quiz.publish': '公開',
  'quiz.archive': '非公開',
  'quiz.delete': '削除'
};

export function insightsView(quiz, stats, history) {
  return [
    h(
      'div',
      { class: 'insights-head' },
      h('div', null, h('p', { class: 'eyebrow' }, h('span', { class: `status status-${quiz.status}` }, STATUS_LABELS[quiz.status]), ` ${quiz.slug}`), h('h2', { class: 'insights-title' }, quiz.title)),
      h('a', { class: 'button', href: `#/edit/${encodeURIComponent(quiz.id)}` }, '編集する')
    ),
    kpis(stats),
    stats.totalAttempts > stats.attempts &&
      h('p', { class: 'notice' }, `問題を編集する前の回答 ${stats.totalAttempts - stats.attempts} 件は、設問ごとの集計に含めていません（設問の内容が変わっているため）。`),
    stats.attempts
      ? [scoreDistribution(stats), questionRates(stats)]
      : h(
          'div',
          { class: 'empty' },
          h('p', null, 'まだ回答がありません。'),
          quiz.status !== QUIZ_STATUS.PUBLISHED && h('p', { class: 'muted' }, '公開すると回答者の結果がここに集計されます。')
        ),
    historyPanel(history)
  ];
}

function kpis(stats) {
  const tile = (label, value, note, compact = false) =>
    h('div', { class: 'stat' }, h('strong', { class: compact ? 'is-compact' : null }, value), h('span', null, label), note && h('small', null, note));
  return h(
    'div',
    { class: 'stats' },
    tile('挑戦回数', stats.attempts.toLocaleString('ja-JP')),
    tile('平均正答率', percent(stats.averageRate)),
    tile('満点', stats.perfectCount.toLocaleString('ja-JP'), stats.attempts ? `${percent(stats.perfectCount / stats.attempts)} の人` : null),
    tile('最後の回答', stats.lastAttemptAt ? dateTime.format(new Date(stats.lastAttemptAt)) : '—', null, true)
  );
}

/** 得点ごとの人数（縦棒）。0点〜満点を左から並べる。 */
function scoreDistribution(stats) {
  const max = Math.max(...stats.scoreDistribution, 1);
  return h(
    'section',
    { class: 'panel' },
    h('h2', null, '得点の分布'),
    h(
      'ol',
      { class: 'columns', 'aria-label': '得点ごとの人数' },
      stats.scoreDistribution.map((count, score) => {
        const bar = h('span', { class: 'column-bar', 'aria-hidden': 'true' });
        bar.style.setProperty('--size', `${(count / max) * 100}%`);
        return h(
          'li',
          { class: 'column', title: `${score}点: ${count}人（${percent(count / stats.attempts)}）` },
          h('span', { class: 'column-value' }, count),
          h('span', { class: 'column-track' }, bar),
          h('span', { class: 'column-label' }, `${score}点`)
        );
      })
    )
  );
}

/** 設問ごとの正答率（名前・棒・数値の行リスト）と、選択肢ごとの回答数。 */
function questionRates(stats) {
  return h(
    'section',
    { class: 'panel' },
    h('h2', null, '設問ごとの正答率'),
    h('p', { class: 'hint' }, '正答率の低い設問は、問題文や選択肢が紛らわしい可能性があります。'),
    h(
      'ol',
      { class: 'meter-list' },
      stats.questions.map((question, index) => {
        const bar = h('span', { class: 'meter-bar', 'aria-hidden': 'true' });
        bar.style.setProperty('--size', `${(question.correctRate ?? 0) * 100}%`);
        return h(
          'li',
          { class: 'meter-row' },
          h('span', { class: 'meter-name' }, `第${index + 1}問 ${question.prompt}`),
          h('span', { class: 'meter-track', title: `正答率 ${percent(question.correctRate)}` }, bar),
          h('span', { class: 'meter-value' }, percent(question.correctRate)),
          h(
            'ul',
            { class: 'option-counts', 'aria-label': '選択肢ごとの回答数' },
            question.options.map((option, optionIndex) =>
              h(
                'li',
                { class: optionIndex === question.correctIndex ? 'is-correct' : null },
                `${LETTERS[optionIndex]}. ${option}: ${question.optionCounts[optionIndex]}人`,
                optionIndex === question.correctIndex && h('span', { class: 'correct-tag' }, '正解')
              )
            ),
            question.unanswered > 0 && h('li', null, `時間切れ・未回答: ${question.unanswered}人`)
          )
        );
      })
    )
  );
}

function historyPanel(events) {
  return h(
    'section',
    { class: 'panel' },
    h('h2', null, '変更履歴'),
    events.length
      ? h(
          'ol',
          { class: 'history' },
          events.map(event =>
            h(
              'li',
              null,
              h('time', { datetime: event.createdAt }, dateTime.format(new Date(event.createdAt))),
              h('span', { class: 'history-action' }, ACTION_LABELS[event.action] ?? event.action, event.metadata?.duplicatedFrom && '（複製）'),
              h('span', { class: 'muted' }, event.actor)
            )
          )
        )
      : h('p', { class: 'muted' }, '履歴はありません。')
  );
}
