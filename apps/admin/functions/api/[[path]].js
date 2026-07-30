export async function onRequest(context) {
  const source = new URL(context.request.url);
  const target = new URL(`/admin/${context.params.path.join('/')}`, 'https://qraft-api.internal');
  target.search = source.search;
  const headers = new Headers(context.request.headers);
  headers.delete('cookie');
  headers.delete('x-forwarded-for');
  const request = new Request(target, { method:context.request.method, headers, body:['GET','HEAD'].includes(context.request.method) ? null : context.request.body, redirect:'manual' });
  return context.env.API.fetch(request);
}
