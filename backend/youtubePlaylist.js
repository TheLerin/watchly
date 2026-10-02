const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
const PLAYLIST_ID = /^[A-Za-z0-9_-]{10,150}$/;

function playlistSource(value) {
    let url;
    try { url = new URL(value); } catch { return null; }
    const host = url.hostname.toLowerCase();
    if (!['http:', 'https:'].includes(url.protocol) || !(host === 'youtu.be' || host === 'www.youtu.be' || host === 'youtube.com' || host.endsWith('.youtube.com') || host === 'youtube-nocookie.com' || host.endsWith('.youtube-nocookie.com'))) return null;
    const playlistId = url.searchParams.get('list');
    if (playlistId === null) return null;
    if (!PLAYLIST_ID.test(playlistId)) return { invalid: true };
    const candidate = host.endsWith('youtu.be') ? url.pathname.split('/')[1]
        : url.searchParams.get('v') || url.pathname.match(/^\/(?:embed|shorts|live)\/([^/]+)/)?.[1];
    const index = url.searchParams.get('index');
    return {
        sourceType: 'youtube-playlist', playlistId,
        requestedVideoId: VIDEO_ID.test(candidate || '') ? candidate : null,
        currentVideoId: null,
        playlistIndex: index && /^[1-9]\d{0,4}$/.test(index) ? Number(index) - 1 : 0,
        playlistItems: [], playlistTitles: {}, unavailableIndexes: [],
        playlistStatus: 'loading', sourceRevision: 0,
    };
}

function currentPlaylistItem(state, payload) {
    return state.sourceType === 'youtube-playlist' && payload.sourceId === state.sourceId &&
        payload.sourceRevision === state.sourceRevision && payload.playlistId === state.playlistId &&
        payload.playlistIndex === state.playlistIndex && payload.currentVideoId === state.currentVideoId;
}

function resolvePlaylist(state, items) {
    if (state.playlistStatus !== 'loading' || !Array.isArray(items) || !items.length || items.length > 10000 || !items.every(id => typeof id === 'string' && VIDEO_ID.test(id))) return false;
    const selected = state.requestedVideoId ? (items[state.playlistIndex] === state.requestedVideoId ? state.playlistIndex : items.indexOf(state.requestedVideoId)) : -1;
    state.playlistItems = [...items];
    state.playlistIndex = selected >= 0 ? selected : state.playlistIndex < items.length ? state.playlistIndex : 0;
    state.currentVideoId = items[state.playlistIndex];
    state.playlistStatus = 'ready';
    state.sourceRevision++;
    return true;
}

function movePlaylist(state, action, index) {
    if (!state.playlistItems.length) return false;
    let target = action === 'PREVIOUS' ? (state.playedSeconds > 5 ? state.playlistIndex : Math.max(0, state.playlistIndex - 1))
        : action === 'SELECT' ? index : state.playlistIndex + 1;
    if (!Number.isInteger(target) || target < 0 || target >= state.playlistItems.length) return false;
    const direction = action === 'PREVIOUS' ? -1 : 1;
    while (target >= 0 && target < state.playlistItems.length && state.unavailableIndexes.includes(target)) target += direction;
    if (target < 0 || target >= state.playlistItems.length) return false;
    state.playlistIndex = target;
    state.currentVideoId = state.playlistItems[target];
    state.playedSeconds = 0;
    state.updatedAt = Date.now();
    state.sourceRevision++;
    state.seekVersion++;
    state.stateVersion++;
    state.playlistStatus = 'ready';
    return true;
}

module.exports = { playlistSource, currentPlaylistItem, resolvePlaylist, movePlaylist };
