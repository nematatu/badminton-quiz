import { WorkerEntrypoint } from 'cloudflare:workers';
import { handleAdmin } from './admin-api.js';
import { HttpError, errorResponse, pathnameOf } from './http.js';
import { corsHeaders, publicRouter } from './public-api.js';

/**
 * qraft-api Worker のエントリポイント。
 *
 * - default export: 公開ドメイン（api.example.com）向け。公開APIのみ。
 * - AdminApi:       Admin Pages の Service Binding 専用。管理APIのみ。
 *
 * 管理APIを別エントリポイントにすることで、管理ルートはインターネットから
 * そもそも到達できない。
 */

function toErrorResponse(error, request, headers) {
  if (error instanceof HttpError) return errorResponse(error, headers);
  console.error(
    JSON.stringify({
      event: 'unhandled_error',
      method: request.method,
      path: pathnameOf(request),
      message: String(error?.message ?? error)
    })
  );
  return errorResponse(new HttpError(500, 'internal_error'), headers);
}

export default {
  async fetch(request, env, ctx) {
    const cors = corsHeaders(request, env);
    try {
      if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      return await publicRouter(request, { env, ctx, cors });
    } catch (error) {
      return toErrorResponse(error, request, cors);
    }
  }
};

export class AdminApi extends WorkerEntrypoint {
  async fetch(request) {
    try {
      return await handleAdmin(request, { env: this.env, ctx: this.ctx });
    } catch (error) {
      return toErrorResponse(error, request, {});
    }
  }
}
