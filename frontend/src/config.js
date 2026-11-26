const env = import.meta.env || {};
// An explicit legacy URL keeps existing Vercel/Render builds working. Cloudflare builds are same-origin.
export const BACKEND_URL = (env.VITE_BACKEND_URL || '').replace(/\/$/, '');
export const TRANSPORT = env.VITE_REALTIME_TRANSPORT || (BACKEND_URL ? 'socketio' : 'native');
export const API_URL = path => `${BACKEND_URL}${path}`;
