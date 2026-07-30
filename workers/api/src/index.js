import { verifyAccessJwt, enforceRateLimit } from './security.js';
import { validateQuiz, validateAnswers } from './validation.js';

const securityHeaders = {
  'Content-Type': 'application/json; charset=utf-8',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cache-Control': 'no-store'
};

function json(data, status = 200, extra = {}) { return new Response(JSON.stringify(data), { status, headers: { ...securityHeaders, ...extra } }); }
function slugify(value) { return value.normalize('NFKC').toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠ー]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'quiz'; }
function getPath(url) { return new URL(url).pathname.replace(/\/+$/, '') || '/'; }
function corsHeaders(request, env) {
  const origin = request.headers.get('Origin');
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map(v => v.trim());
  return origin && allowed.includes(origin) ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', 'Vary': 'Origin' } : {};
}
async function body(request) {
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw Object.assign(new Error('json_required'), { status: 415 });
  const length = Number(request.headers.get('content-length') || 0);
  if (length > 100_000) throw Object.assign(new Error('payload_too_large'), { status: 413 });
  return request.json().catch(() => { throw Object.assign(new Error('invalid_json'), { status: 400 }); });
}
async function admin(request, env) {
  const token = request.headers.get('Cf-Access-Jwt-Assertion') || request.headers.get('Authorization')?.replace(/^Bearer /, '');
  return verifyAccessJwt(token, env);
}
async function quizWithQuestions(env, idOrSlug, includeAnswers) {
  const quiz = await env.DB.prepare('SELECT * FROM quizzes WHERE id = ?1 OR slug = ?1').bind(idOrSlug).first();
  if (!quiz) return null;
  const { results } = await env.DB.prepare('SELECT id, position, prompt, explanation, options_json, correct_index FROM questions WHERE quiz_id = ? ORDER BY position').bind(quiz.id).all();
  return { id: quiz.id, slug: quiz.slug, title: quiz.title, description: quiz.description, status: quiz.status, version:quiz.version, updatedAt: quiz.updated_at, questions: results.map(q => ({ id:q.id, prompt:q.prompt, options:JSON.parse(q.options_json), ...(includeAnswers ? { correctIndex:q.correct_index, explanation:q.explanation } : {}) })) };
}

function audit(env, actor, action, quizId, metadata = {}) {
  return env.DB.prepare('INSERT INTO audit_events(id,actor,action,quiz_id,metadata_json,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),actor,action,quizId,JSON.stringify(metadata),new Date().toISOString());
}

export default {
  async fetch(request, env) {
    const path = getPath(request.url);
    const cors = corsHeaders(request, env);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (path === '/health') return json({ ok:true, environment:env.ENVIRONMENT }, 200, { 'Cache-Control':'no-cache', ...cors });

      if (path === '/v1/quizzes' && request.method === 'GET') {
        const { results } = await env.DB.prepare("SELECT slug,title,description,updated_at FROM quizzes WHERE status='published' ORDER BY published_at DESC LIMIT 100").all();
        return json({ quizzes:results.map(q => ({ slug:q.slug,title:q.title,description:q.description,updatedAt:q.updated_at })) }, 200, { 'Cache-Control':'public, max-age=60, s-maxage=300', ...cors });
      }
      const publicMatch = path.match(/^\/v1\/quizzes\/([^/]+)$/);
      if (publicMatch && request.method === 'GET') {
        const quiz = await quizWithQuestions(env, decodeURIComponent(publicMatch[1]), false);
        if (!quiz || quiz.status !== 'published') return json({ error:'not_found' }, 404, cors);
        delete quiz.status;
        return json(quiz, 200, { 'Cache-Control':'public, max-age=60, s-maxage=600', ...cors });
      }
      const submitMatch = path.match(/^\/v1\/quizzes\/([^/]+)\/attempts$/);
      if (submitMatch && request.method === 'POST') {
        await enforceRateLimit(request, env, decodeURIComponent(submitMatch[1]));
        const quiz = await quizWithQuestions(env, decodeURIComponent(submitMatch[1]), true);
        if (!quiz || quiz.status !== 'published') return json({ error:'not_found' }, 404, cors);
        const answers = validateAnswers(await body(request), quiz.questions.length);
        const details = quiz.questions.map((q, i) => ({ correctIndex:q.correctIndex, explanation:q.explanation, correct:answers[i] === q.correctIndex }));
        const score = details.filter(v => v.correct).length;
        await env.DB.prepare('INSERT INTO attempts(id,quiz_id,score,total,answers_json,created_at) VALUES(?,?,?,?,?,?)').bind(crypto.randomUUID(),quiz.id,score,details.length,JSON.stringify(answers),new Date().toISOString()).run();
        return json({ score, total:details.length, details }, 201, cors);
      }

      if (!path.startsWith('/admin/')) return json({ error:'not_found' }, 404, cors);
      const identity = await admin(request, env);
      if (path === '/admin/quizzes' && request.method === 'GET') {
        const { results } = await env.DB.prepare('SELECT id,slug,title,description,status,updated_at,published_at FROM quizzes ORDER BY updated_at DESC LIMIT 200').all();
        return json({ quizzes:results });
      }
      if (path === '/admin/quizzes' && request.method === 'POST') {
        const input = validateQuiz(await body(request));
        const id = crypto.randomUUID(), now = new Date().toISOString();
        const slug = `${slugify(input.title)}-${id.slice(0, 6)}`;
        const actor = identity.email || identity.sub;
        const statements = [env.DB.prepare('INSERT INTO quizzes(id,slug,title,description,status,created_by,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?)').bind(id,slug,input.title,input.description,'draft',actor,now,now), ...input.questions.map(q => env.DB.prepare('INSERT INTO questions(id,quiz_id,position,prompt,explanation,options_json,correct_index) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,q.position,q.prompt,q.explanation,JSON.stringify(q.options),q.correctIndex)), audit(env,actor,'quiz.create',id,{ title:input.title })];
        await env.DB.batch(statements);
        return json(await quizWithQuestions(env,id,true), 201);
      }
      const adminMatch = path.match(/^\/admin\/quizzes\/([^/]+)$/);
      if (adminMatch && request.method === 'GET') {
        const quiz = await quizWithQuestions(env,decodeURIComponent(adminMatch[1]),true);
        return quiz ? json(quiz) : json({ error:'not_found' },404);
      }
      if (adminMatch && request.method === 'PUT') {
        const id = decodeURIComponent(adminMatch[1]);
        const existing = await env.DB.prepare('SELECT id,status,version FROM quizzes WHERE id=?').bind(id).first();
        if (!existing) return json({ error:'not_found' },404);
        const raw = await body(request);
        if (!Number.isInteger(raw.version) || raw.version !== existing.version) return json({ error:'edit_conflict', currentVersion:existing.version },409);
        const input = validateQuiz(raw); const now = new Date().toISOString(); const actor = identity.email || identity.sub;
        const updated = await env.DB.prepare('UPDATE quizzes SET title=?,description=?,updated_at=?,version=version+1 WHERE id=? AND version=?').bind(input.title,input.description,now,id,raw.version).run();
        if (!updated.meta.changes) return json({ error:'edit_conflict' },409);
        const statements = [env.DB.prepare('DELETE FROM questions WHERE quiz_id=?').bind(id), ...input.questions.map(q => env.DB.prepare('INSERT INTO questions(id,quiz_id,position,prompt,explanation,options_json,correct_index) VALUES(?,?,?,?,?,?,?)').bind(crypto.randomUUID(),id,q.position,q.prompt,q.explanation,JSON.stringify(q.options),q.correctIndex)), audit(env,actor,'quiz.update',id,{ fromVersion:raw.version })];
        await env.DB.batch(statements); return json(await quizWithQuestions(env,id,true));
      }
      if (adminMatch && request.method === 'DELETE') {
        const id = decodeURIComponent(adminMatch[1]);
        const quiz = await env.DB.prepare("SELECT id,title FROM quizzes WHERE id=? AND status!='published'").bind(id).first();
        if (!quiz) return json({ error:'not_found_or_published' },409);
        const actor = identity.email || identity.sub;
        await env.DB.batch([audit(env,actor,'quiz.delete',id,{ title:quiz.title }),env.DB.prepare('DELETE FROM quizzes WHERE id=?').bind(id)]);
        return new Response(null,{status:204,headers:securityHeaders});
      }
      const statusMatch = path.match(/^\/admin\/quizzes\/([^/]+)\/status$/);
      if (statusMatch && request.method === 'POST') {
        const { status } = await body(request);
        if (!['published','archived'].includes(status)) return json({ error:'invalid_status' },400);
        const now = new Date().toISOString();
        const quizId = decodeURIComponent(statusMatch[1]); const actor = identity.email || identity.sub;
        const result = await env.DB.prepare("UPDATE quizzes SET status=?,updated_at=?,version=version+1,published_at=CASE WHEN ?='published' THEN COALESCE(published_at,?) ELSE published_at END WHERE id=?").bind(status,now,status,now,quizId).run();
        if (result.meta.changes) await audit(env,actor,status==='published'?'quiz.publish':'quiz.archive',quizId).run();
        return result.meta.changes ? json({ ok:true,status }) : json({ error:'not_found' },404);
      }
      return json({ error:'not_found' },404);
    } catch (error) {
      const status = error.status || (String(error.message).includes('access_') || String(error.message).includes('signature') ? 401 : 500);
      if (status >= 500) console.error(JSON.stringify({ event:'request_error', path, message:error.message }));
      return json({ error:status === 500 ? 'internal_error' : error.message },status,{ ...(status === 429 ? {'Retry-After':'60'}:{}), ...cors });
    }
  }
};
