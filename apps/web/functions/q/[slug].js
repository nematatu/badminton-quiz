import { SLUG_PATTERN } from '../../public/shared/contracts.js';
import { SECURITY_HEADERS } from '../_lib/security-headers.js';
import { renderSharePage } from '../_lib/share-page.js';

/**
 * 共有URL `/q/<slug>`。
 *
 * 画面は通常の index.html（SPA）と同じだが、クローラー向けにタイトルと OGP タグを
 * クイズの内容へ差し替えて返す。クイズは Service Binding で API Worker の公開APIから
 * 取得する（正解は含まれない）。存在しない・非公開のクイズは 404 で、
 * 画面側が「見つかりません」を表示する。
 */
export async function onRequestGet({ request, env, params }) {
  const url = new URL(request.url);
  const slug = String(params.slug ?? '');
  const [page, quiz] = await Promise.all([env.ASSETS.fetch(new URL('/', url)).then(response => response.text()), loadQuiz(env, slug)]);

  const html = quiz
    ? renderSharePage(page, { title: quiz.title, description: quiz.description, questionCount: quiz.questions.length, url: `${url.origin}/q/${encodeURIComponent(slug)}` })
    : page;
  return new Response(html, {
    status: quiz ? 200 : 404,
    headers: { ...SECURITY_HEADERS, 'Content-Type': 'text/html; charset=utf-8' }
  });
}

async function loadQuiz(env, slug) {
  if (!SLUG_PATTERN.test(slug)) return null;
  try {
    const response = await env.API.fetch(`https://qraft-api.internal/v1/quizzes/${encodeURIComponent(slug)}`);
    return response.ok ? await response.json() : null;
  } catch (error) {
    // API が落ちていても画面自体は返す（プレビューが既定の文言になるだけ）。
    console.error(JSON.stringify({ event: 'share_page_quiz_unavailable', message: String(error?.message ?? error) }));
    return null;
  }
}
