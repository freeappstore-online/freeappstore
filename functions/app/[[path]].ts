/**
 * Proxy /app/* to the FAS console (console.freeappstore.online).
 * Same pattern as PAS — single origin, shared auth, PWA scoped to /app/.
 */

const CONSOLE_ORIGIN = 'https://console.freeappstore.online';

export const onRequest: PagesFunction = async ({ request }) => {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/app/, '') || '/';
  const target = `${CONSOLE_ORIGIN}${path}${url.search}`;

  const res = await fetch(target, {
    method: request.method,
    headers: request.headers,
    body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
  });

  // SPA fallback: 404 → serve index.html
  if (res.status === 404) {
    const fallback = await fetch(`${CONSOLE_ORIGIN}/index.html`);
    return new Response(fallback.body, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  }

  const headers = new Headers(res.headers);
  if (/\.[0-9a-f]{8,}\.(js|css)$/.test(path) || /\.(woff2|png|svg|ico)$/.test(path)) {
    headers.set('Cache-Control', 'public, max-age=31536000, immutable');
  } else if (path.endsWith('.html') || path === '/') {
    headers.set('Cache-Control', 'no-cache');
  }

  return new Response(res.body, { status: res.status, headers });
};
