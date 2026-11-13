/**
 * 共有URL（/q/<slug>）用に、index.html のタイトルと説明・OGP タグをクイズの内容へ差し替える。
 *
 * X などのクローラーは JavaScript を実行しないため、共有時のプレビューに
 * クイズ名を出すにはサーバー側で HTML に埋め込む必要がある。
 * 値は必ず HTML エスケープしてから埋め込む。
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = value => String(value).replace(/[&<>"']/g, char => ESCAPES[char]);

function setMeta(html, attribute, name, content) {
  const pattern = new RegExp(`<meta ${attribute}="${name}" content="[^"]*">`);
  const tag = `<meta ${attribute}="${name}" content="${escapeHtml(content)}">`;
  return pattern.test(html) ? html.replace(pattern, () => tag) : html.replace('</head>', () => `  ${tag}\n  </head>`);
}

/**
 * @param {string} html index.html の内容
 * @param {{ title: string, description: string, questionCount: number, url: string, image?: string }} quiz
 *   image は共有カード画像の絶対URL（1200×630）。あれば X では大きい画像のカードで表示される。
 */
export function renderSharePage(html, quiz) {
  const title = `${quiz.title} | Qraft`;
  const description = quiz.description || `全${quiz.questionCount}問の4択クイズに挑戦しよう。`;
  let page = html.replace(/<title>[^<]*<\/title>/, () => `<title>${escapeHtml(title)}</title>`);
  page = setMeta(page, 'name', 'description', description);
  page = setMeta(page, 'property', 'og:title', title);
  page = setMeta(page, 'property', 'og:description', description);
  page = setMeta(page, 'property', 'og:url', quiz.url);
  if (quiz.image) {
    page = setMeta(page, 'property', 'og:image', quiz.image);
    page = setMeta(page, 'property', 'og:image:width', '1200');
    page = setMeta(page, 'property', 'og:image:height', '630');
    page = setMeta(page, 'property', 'og:image:alt', 'Qraft — 4択クイズ');
    page = setMeta(page, 'name', 'twitter:card', 'summary_large_image');
  }
  return page;
}
