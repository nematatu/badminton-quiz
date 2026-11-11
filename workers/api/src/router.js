import { HttpError, decodeParam, pathnameOf } from './http.js';

/**
 * 依存なしの最小ルーター。
 *
 *   const router = createRouter([
 *     ['GET', '/v1/quizzes/:slug', handler],
 *   ]);
 *   const response = await router(request, context);
 *
 * パスは一致するがメソッドが違う場合は 405 と Allow ヘッダーを返す。
 */
export function createRouter(routes) {
  const compiled = routes.map(([method, pattern, handler]) => ({ method, handler, ...compile(pattern) }));

  return async function route(request, context) {
    const path = pathnameOf(request);
    const allowed = [];
    for (const route of compiled) {
      const match = route.regex.exec(path);
      if (!match) continue;
      if (route.method !== request.method) {
        allowed.push(route.method);
        continue;
      }
      const params = Object.fromEntries(route.keys.map((key, index) => [key, decodeParam(match[index + 1])]));
      return route.handler(request, { ...context, params });
    }
    if (allowed.length) throw new HttpError(405, 'method_not_allowed', { headers: { Allow: allowed.join(', ') } });
    throw new HttpError(404, 'not_found');
  };
}

function compile(pattern) {
  const keys = [];
  const source = pattern.replace(/:([a-zA-Z]+)/g, (_, key) => {
    keys.push(key);
    return '([^/]+)';
  });
  return { keys, regex: new RegExp(`^${source}$`) };
}
