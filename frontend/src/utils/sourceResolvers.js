import { BACKEND_URL } from '../config.js';

export function rewriteGDriveUrl(value, storage = globalThis.sessionStorage) {
    let url; try { url = new URL(value); } catch { return value; }
    if (!['drive.google.com', 'drive.usercontent.google.com'].includes(url.hostname)) return value;
    const id = url.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] || url.searchParams.get('id');
    if (!/^[\w-]{5,200}$/.test(id || '')) return value;
    let roomId = ''; try { roomId = JSON.parse(storage?.getItem('watchTogetherSession'))?.roomId || ''; } catch { /* missing session */ }
    return `${BACKEND_URL}/api/proxy/gdrive?id=${encodeURIComponent(id)}&roomId=${encodeURIComponent(roomId)}`;
}

export async function resolveArchiveUrl(value, { fetcher = fetch, signal } = {}) {
    let url; try { url = new URL(value); } catch { return value; }
    if (url.hostname !== 'archive.org' || !url.pathname.startsWith('/details/')) return value;
    const identifier = url.pathname.split('/')[2]; if (!identifier) return value;
    try {
        const response = await fetcher(`https://archive.org/metadata/${encodeURIComponent(identifier)}`, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(10000)]) : AbortSignal.timeout(10000) });
        if (!response.ok) return value;
        const data = await response.json(), files = (Array.isArray(data.files) ? data.files : []).filter(file => typeof file.name === 'string' && !file.name.includes('_thumb') && !file.name.includes('.thumbs'));
        let chosen;
        for (const format of ['MPEG4', 'h.264', 'H.264 IA', '512Kb MPEG4', 'Ogg Video']) { chosen = files.find(file => file.format === format); if (chosen) break; }
        chosen ||= files.find(file => /\.mp4$/i.test(file.name)) || files.find(file => /\.(ogv|webm)$/i.test(file.name));
        return chosen ? `https://archive.org/download/${encodeURIComponent(identifier)}/${chosen.name.split('/').map(encodeURIComponent).join('/')}` : value;
    } catch { return value; }
}
