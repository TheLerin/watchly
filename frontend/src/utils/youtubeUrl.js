const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,150}$/;

export function parseYouTubeUrl(value) {
    if (typeof value !== 'string' || value.length > 4096) return null;
    let url;
    try {
        const text = value.trim();
        url = new URL(/^(?:(?:www|m|music)\.)?youtube\.com\/|^(?:www\.)?youtu\.be\//i.test(text) ? `https://${text}` : text);
    } catch { return null; }
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || !(host === 'youtu.be' || host === 'www.youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com'))) return null;
    const candidate = host.endsWith('youtu.be') ? url.pathname.split('/')[1]
        : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    const videoId = VIDEO_ID.test(candidate || '') ? candidate : null;
    let list = url.searchParams.get('list');
    if (list !== null && !PLAYLIST_ID.test(list)) {
        if (!videoId) return { kind: 'invalid', url: '' };
        list = null;
    }
    if (!list && !videoId) return { kind: 'invalid', url: '' };
    const index = url.searchParams.get('index');
    const playlistIndex = index && /^[1-9]\d{0,4}$/.test(index) ? Number(index) - 1 : 0;
    const normalized = new URL(videoId ? 'https://www.youtube.com/watch' : 'https://www.youtube.com/playlist');
    if (videoId) normalized.searchParams.set('v', videoId);
    if (list) {
        normalized.searchParams.set('list', list);
        if (index && /^[1-9]\d{0,4}$/.test(index)) normalized.searchParams.set('index', String(playlistIndex + 1));
    }
    const start = url.searchParams.get('t') || url.searchParams.get('start');
    if (start && /^[\dhms]+$/i.test(start)) normalized.searchParams.set('t', start);
    return { kind: list ? 'youtube-playlist' : 'youtube', url: normalized.toString(), videoId, playlistId: list || null, playlistIndex };
}
