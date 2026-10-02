/* global process */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { roomPreviewHtml } from '../social-preview/metadata.js';

// Vercel bundles the exact Vite-built shell through includeFiles. No backend
// room lookup, private room data, bot detection, or second application render.
let appShell;
export default async function handler(request, response) {
  const roomCode = request.query.roomCode;
  if (typeof roomCode !== 'string' || !roomCode) {
    response.statusCode = 400;
    response.end('Missing room code');
    return;
  }
  appShell ??= readFile(join(process.cwd(), 'dist/index.html'), 'utf8');
  const html = roomPreviewHtml(await appShell, roomCode);
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
  response.statusCode = 200;
  response.end(request.method === 'HEAD' ? undefined : html);
}
