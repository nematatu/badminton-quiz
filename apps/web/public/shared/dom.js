// 自動生成ファイル: packages/shared/src/dom.js を編集し `npm run sync:shared` を実行すること。
/**
 * ブラウザ用の小さな DOM ヘルパー。
 *
 * 画面は文字列 HTML を組み立てず、すべてこの関数で要素を作る。
 * テキストは常に textContent 相当で挿入されるため、エスケープ漏れによる
 * XSS が構造的に起きない（CSP の Trusted Types とも両立する）。
 */

/**
 * @template {keyof HTMLElementTagNameMap} K
 * @param {K} tag
 * @param {Record<string, any> | null} [props]
 * @param {...any} children Node・文字列・数値（false / null / undefined は無視、配列は展開）
 * @returns {HTMLElementTagNameMap[K]} 作った要素（h('button') なら HTMLButtonElement）
 */
export function h(tag, props, ...children) {
  const element = document.createElement(tag);
  for (const [key, value] of Object.entries(props ?? {})) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') element.className = String(value);
    else if (key === 'dataset') Object.assign(element.dataset, value);
    else if (key === 'style') Object.assign(element.style, value);
    else if (key.startsWith('on') && typeof value === 'function') element.addEventListener(key.slice(2).toLowerCase(), /** @type {EventListener} */ (value));
    else if (key in element && typeof value !== 'string') element[key] = value;
    else element.setAttribute(key, value === true ? '' : String(value));
  }
  append(element, children);
  return element;
}

function append(parent, children) {
  for (const child of children) {
    if (child === undefined || child === null || child === false) continue;
    if (Array.isArray(child)) append(parent, child);
    else parent.append(child instanceof Node ? child : String(child));
  }
}

/** コンテナの中身を差し替え、見出しへフォーカスを移して画面遷移を支援技術へ伝える。 */
export function mount(container, ...children) {
  container.replaceChildren();
  append(container, children);
  const heading = container.querySelector('h1');
  if (heading) {
    heading.tabIndex = -1;
    heading.focus({ preventScroll: true });
  }
  window.scrollTo({ top: 0 });
}

/**
 * 「本文へ移動」リンク。hash を変えるとハッシュルーティングが画面を切り替えてしまう
 * （回答途中の状態が消える）ため、URL は変えずに本文へフォーカスだけ移す。
 */
export function installSkipLink(link, target) {
  link.addEventListener('click', event => {
    event.preventDefault();
    target.focus();
    target.scrollIntoView();
  });
}

/** 画面下部に短い通知を出す。連続で呼ばれた場合は後の通知が前の通知を置き換える。 */
export function createToast(element) {
  let timer = 0;
  return message => {
    clearTimeout(timer);
    element.textContent = message;
    element.classList.add('show');
    timer = setTimeout(() => element.classList.remove('show'), 2600);
  };
}

export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
