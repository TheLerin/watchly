const MEDIA_EXTENSION = /\.(mp4|m4v|webm|ogg|ogv|mov)(?:$|[?#])/i;
const HLS_EXTENSION = /\.m3u8(?:$|[?#])/i;
const DASH_EXTENSION = /\.mpd(?:$|[?#])/i;

export function detectVideoSource(value) {
    if (typeof value !== 'string' || value.length > 4096) return { kind: 'invalid', url: '' };
    let parsed;
    try { parsed = new URL(value.trim()); }
    catch { return { kind: 'invalid', url: '' }; }
    if (!['http:', 'https:'].includes(parsed.protocol)) return { kind: 'invalid', url: '' };
    const host = parsed.hostname.toLowerCase();
    if (host === 'youtu.be' || host === 'www.youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com')) {
        const id = host.includes('youtu.be')
            ? parsed.pathname.split('/')[1]
            : parsed.searchParams.get('v') || parsed.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
        if (!id || !/^[a-zA-Z0-9_-]{11}$/.test(id)) return { kind: 'invalid', url: '' };
        const normalized = new URL('https://www.youtube.com/watch');
        normalized.searchParams.set('v', id);
        const start = parsed.searchParams.get('t') || parsed.searchParams.get('start');
        if (start && /^[\dhms]+$/i.test(start)) normalized.searchParams.set('t', start);
        return { kind: 'youtube', url: normalized.toString() };
    }
    if (host === 'drive.google.com' || host === 'drive.usercontent.google.com') return { kind: 'drive', url: parsed.toString() };
    if (HLS_EXTENSION.test(parsed.pathname)) return { kind: 'hls', url: parsed.toString() };
    if (DASH_EXTENSION.test(parsed.pathname)) return { kind: 'dash', url: parsed.toString() };
    if (MEDIA_EXTENSION.test(parsed.pathname)) return { kind: 'direct', url: parsed.toString() };
    if (host === 'vimeo.com' || host.endsWith('.vimeo.com') ||
        host === 'streamable.com' || host.endsWith('.streamable.com') ||
        host === 'dailymotion.com' || host.endsWith('.dailymotion.com') || host === 'dai.ly') {
        return { kind: 'embed', url: parsed.toString() };
    }
    // A signed CDN URL may not expose an extension. Let HTMLMediaElement inspect
    // the response and codec, then report its real media error if it is a page.
    return { kind: 'unknown', url: parsed.toString() };
}
