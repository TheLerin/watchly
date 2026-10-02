import { next } from '@vercel/functions';
import { roomPreviewHtml } from './social-preview/metadata.js';

export const config = { matcher: '/room/:roomCode' };

export default async function middleware(request) {
  const url = new URL(request.url);
  const room = url.pathname.match(/^\/room\/([^/]+)\/?$/);
  if (!room || !['GET', 'HEAD'].includes(request.method)) return next();

  try {
    // Fetch this deployment's static Vite shell, outside the room matcher. This
    // keeps hashed assets intact without depending on function filesystem layout.
    const headers = new Headers({ Accept: 'text/html' });
    for (const name of ['cookie', 'authorization', 'x-vercel-protection-bypass']) {
      if (request.headers.has(name)) headers.set(name, request.headers.get(name));
    }
    const shell = await fetch(new URL('/index.html', url), {
      headers, redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    if (!shell.ok || !shell.headers.get('content-type')?.includes('text/html')) return next();
    const html = roomPreviewHtml(await shell.text(), decodeURIComponent(room[1]));
    return new Response(request.method === 'HEAD' ? null : html, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'public, max-age=0, must-revalidate',
      },
    });
  } catch {
    // An unavailable static fetch must not break joining a room. The original
    // SPA rewrite still serves the app (with homepage tags) in that case.
    return next();
  }
}
