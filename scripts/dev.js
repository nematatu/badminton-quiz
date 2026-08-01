import { spawn } from 'node:child_process';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const publicDir = fileURLToPath(new URL('../apps/web/public/', import.meta.url));
const types = { '.css': 'text/css', '.html': 'text/html', '.js': 'text/javascript' };
const api = spawn('npm', ['run', 'dev:api', '--', '--port', '8787', '--var', 'ENVIRONMENT:development', '--var', 'ALLOWED_ORIGINS:http://localhost:3000'], {
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

const server = createServer((request, response) => {
  if (request.url === '/config.js') {
    response.writeHead(200, { 'Content-Type': 'text/javascript; charset=utf-8', 'Cache-Control': 'no-store' });
    response.end("window.QRAFT_CONFIG = Object.freeze({ API_ORIGIN: '/api' });\n");
    return;
  }

  if (request.url.startsWith('/api/')) {
    const upstream = new URL(request.url.slice(4), 'http://127.0.0.1:8787');
    fetch(upstream, { method: request.method, headers: request.headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request, duplex: 'half' })
      .then(async result => {
        const headers = Object.fromEntries(result.headers);
        delete headers['content-encoding'];
        delete headers['content-length'];
        response.writeHead(result.status, headers);
        response.end(Buffer.from(await result.arrayBuffer()));
      })
      .catch(() => {
        response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: 'api_unavailable' }));
      });
    return;
  }

  const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
  const relative = normalize(pathname).replace(/^(\.\.(\/|\\|$))+/, '').replace(/^[/\\]+/, '');
  let file = join(publicDir, relative || 'index.html');
  if (!existsSync(file) || !statSync(file).isFile()) file = join(publicDir, 'index.html');
  response.writeHead(200, { 'Content-Type': `${types[extname(file)] || 'application/octet-stream'}; charset=utf-8`, 'Cache-Control': 'no-store' });
  createReadStream(file).pipe(response);
});

server.listen(3000, '127.0.0.1', () => {
  console.log('\nQraft: http://localhost:3000');
  console.log('API:   http://localhost:8787/health\n');
});

server.on('error', error => {
  console.error(`公開画面を起動できません: ${error.message}`);
  api.kill('SIGTERM');
  process.exit(1);
});

function stop(code = 0) {
  server.close();
  api.kill('SIGTERM');
  process.exit(code);
}

api.on('exit', code => stop(code ?? 1));
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
