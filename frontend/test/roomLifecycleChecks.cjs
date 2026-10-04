const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

// Runs inside the real two-browser/SFU fixture with camera and mic active.
module.exports = async ({ a, b, open, wait, snapshot, evidence }) => {
    const movie = page => page.locator('.room-player-surface video');
    const appearance = async choice => {
        await a.getByRole('button', { name: 'Room settings', exact: true }).click();
        await a.locator('.appearance-panel').getByRole('button', { name: new RegExp(`^${choice}(?: |$)`) }).click();
        await a.keyboard.press('Escape'); await a.locator('.appearance-panel').waitFor({ state: 'hidden' });
    };
    for (const page of [a, b]) await page.evaluate(async () => {
        const { socket } = await import('/src/socket.js');
        window.lifecycleSocket = socket; window.lifecycleConnections = 0; window.lifecycleReadiness = 0;
        socket.on('connect', () => window.lifecycleConnections++);
        const emit = socket.emit; socket.emit = function (event, ...args) {
            if (event === 'media:ready') window.lifecycleReadiness++;
            return emit.call(this, event, ...args);
        };
        window.lifecycleFiles = new Map(); window.lifecycleRevoked = [];
        const create = URL.createObjectURL, revoke = URL.revokeObjectURL;
        URL.createObjectURL = value => { const url = create(value); if (value instanceof File) window.lifecycleFiles.set(url, value); return url; };
        URL.revokeObjectURL = url => { window.lifecycleRevoked.push(url); return revoke(url); };
    });
    const buffer = readFileSync(path.resolve(__dirname, '../public/bg-video.mp4'));
    await open(a, 'Watch');
    await a.locator('input[type=file][accept^="video/"]').setInputFiles({ name: 'private-local-movie.mp4', mimeType: 'video/mp4', buffer });
    await wait(async () => (await snapshot()).media?.sourceType === 'local-file', 'local declaration failed');
    await b.locator('input[type=file][accept^="video/"]').setInputFiles({ name: 'same-content.mp4', mimeType: 'video/mp4', buffer });
    await wait(async () => (await snapshot()).members.every(member => member.localReady === true), 'local file readiness incomplete');
    await movie(a).evaluate(video => video.play());
    await wait(async () => await movie(a).evaluate(video => !video.paused && video.currentTime > 1) && await movie(b).evaluate(video => !video.paused && video.currentTime > 1), 'local playback failed');
    const source = (await snapshot()).media.mediaId;
    for (const page of [a, b]) await page.evaluate(() => {
        const video = document.querySelector('.room-player-surface video');
        window.lifecycleBaseline = { video, src: video.src, file: window.lifecycleFiles.get(video.src),
            call: window.testCallRoom, participant: window.testCallRoom.localParticipant.sid,
            camera: window.testCallRoom.localParticipant.getTrackPublication('camera').track.mediaStreamTrack,
            mic: window.testCallRoom.localParticipant.getTrackPublication('microphone').track.mediaStreamTrack,
            socketId: window.lifecycleSocket.id, tokens: window.callTokenRequests, captures: window.callCaptures.length,
            readiness: window.lifecycleReadiness, connections: window.lifecycleConnections, time: video.currentTime };
        window.lifecycleLoads = 0; video.addEventListener('loadstart', () => window.lifecycleLoads++);
        video.addEventListener('emptied', () => window.lifecycleLoads++);
    });
    const verify = async (label, playing = true, unchangedReadiness = true) => {
        for (const page of [a, b]) {
            const state = await page.evaluate(() => {
                const before = window.lifecycleBaseline, video = document.querySelector('.room-player-surface video'), room = window.testCallRoom;
                return { sameVideo: video === before.video, sameURL: video?.src === before.src,
                    sameFile: before.file instanceof File && window.lifecycleFiles.get(video?.src) === before.file,
                    revoked: window.lifecycleRevoked.includes(before.src), loads: window.lifecycleLoads,
                    sameRoom: room === before.call, sameParticipant: room.localParticipant.sid === before.participant,
                    sameCamera: room.localParticipant.getTrackPublication('camera')?.track.mediaStreamTrack === before.camera,
                    sameMic: room.localParticipant.getTrackPublication('microphone')?.track.mediaStreamTrack === before.mic,
                    cameraLive: before.camera.readyState === 'live', micLive: before.mic.readyState === 'live',
                    connected: room.state === 'connected', socket: window.lifecycleSocket.connected && window.lifecycleSocket.id === before.socketId,
                    tokens: window.callTokenRequests - before.tokens, captures: window.callCaptures.length - before.captures,
                    readiness: window.lifecycleReadiness - before.readiness, connections: window.lifecycleConnections - before.connections,
                    paused: video?.paused, ready: video?.readyState, time: video?.currentTime,
                    microphoneMuted: !room.localParticipant.isMicrophoneEnabled };
            });
            for (const field of ['sameVideo', 'sameURL', 'sameFile', 'sameRoom', 'sameParticipant', 'sameCamera', 'sameMic', 'cameraLive', 'micLive', 'connected', 'socket']) assert.equal(state[field], true, `${label}: ${field}: ${JSON.stringify(state)}`);
            for (const field of ['loads', 'tokens', 'captures', 'connections', ...(unchangedReadiness ? ['readiness'] : [])]) assert.equal(state[field], 0, `${label}: ${field}`);
            assert.equal(state.revoked, false, `${label}: blob revoked`); assert.equal(state.paused, !playing, `${label}: playback changed`);
            assert.equal(state.microphoneMuted, page === a, `${label}: microphone state changed`); assert.ok(state.ready >= 2);
        }
        const room = await snapshot(); assert.equal(room.media.mediaId, source);
        assert.ok(room.members.every(member => member.localReady === true), `${label}: readiness reset`);
        assert.equal(room.playback.status === 'playing', playing);
    };
    for (const style of ['Cinematic', 'Classic']) for (const theme of ['Light Glass', 'Dark Glass']) {
        await a.setViewportSize({ width: 1366, height: 768 }); await appearance(style); await appearance(theme);
        for (const [width, height] of [[1920,1080], [1180,650], [1179,650], [1024,768], [390,844], [844,390], [1366,649], [1366,768]]) {
            await a.setViewportSize({ width, height });
            const cinema = style === 'Cinematic' && width >= 1180 && height >= 650;
            await wait(async () => await a.locator('.room-shell').getAttribute('data-room-appearance') === (cinema ? 'cinematic' : 'classic') && await a.locator(width >= 1180 ? '.room-desktop-workspace' : '.room-mobile-workspace').count() === 1, 'layout transition incomplete');
            assert.equal(await a.evaluate(() => JSON.parse(localStorage.getItem('watchly-appearance-settings')).roomStyle), style === 'Cinematic' ? 'cinematic' : 'classic', 'compact fallback overwrote room preference');
            await verify(`${style}/${theme}/${width}x${height}`);
        }
    }
    for (const tab of ['Room', 'Chat', 'Call', 'Video', 'Watch']) { await open(a, tab); await verify(`tab ${tab}`); }
    await open(a, 'Video'); await a.getByRole('button', { name: 'Pop out video call', exact: true }).click();
    const floating = a.getByRole('region', { name: 'Floating video call', exact: true });
    await floating.getByRole('button', { name: 'Fullscreen movie with video call', exact: true }).click();
    await wait(() => a.evaluate(() => Boolean(document.fullscreenElement)), 'fullscreen failed'); await verify('fullscreen');
    await a.evaluate(() => document.exitFullscreen()); await verify('fullscreen exit');
    await floating.getByRole('button', { name: 'Restore video panel', exact: true }).click(); await verify('restore');
    await movie(a).evaluate(video => video.pause()); await wait(async () => (await snapshot()).playback.status !== 'playing' && await movie(a).evaluate(video => video.paused && !video.seeking) && await movie(b).evaluate(video => video.paused && !video.seeking), 'pause sync failed');
    // Explicit play/pause seeks can finish decoding asynchronously and report
    // READY again; require retained readiness rather than zero reports here.
    const position = await movie(a).evaluate(video => video.currentTime);
    await appearance('Cinematic'); await a.setViewportSize({ width: 390, height: 844 }); await verify('paused resize', false, false);
    assert.ok(Math.abs(await movie(a).evaluate(video => video.currentTime) - position) < .25, 'paused position reset');
    await a.setViewportSize({ width: 1366, height: 768 }); await appearance('Classic'); await open(a, 'Video');
    await movie(a).evaluate(video => video.play()); await wait(async () => (await snapshot()).playback.status === 'playing' && await movie(a).evaluate(video => !video.paused && !video.seeking) && await movie(b).evaluate(video => !video.paused && !video.seeking), 'resume failed');
    await verify('resume', true, false); assert.ok(await movie(a).evaluate(video => video.currentTime > window.lifecycleBaseline.time));
    evidence.checks.push('Local File/blob/video/controller, camera/mic/LiveKit participant, Socket.IO identity and readiness persist through 32 breakpoint/style/theme transitions, tab changes, fullscreen and paused playback');
    evidence.lifecycle = { sameFile: true, sameObjectURL: true, sameVideoNode: true, videoReloads: 0,
        additionalTokenRequests: 0, additionalCaptures: 0, socketReconnects: 0, readinessRepublishes: 0, transitions: 32 };
};

module.exports.verifyRelease = async ({ a, b, base, open, wait, evidence }) => {
    const input = a.locator('input[type=file][accept^="video/"]');
    await input.setInputFiles(path.resolve(__dirname, '../public/bg-video.mp4'));
    await wait(() => a.evaluate(() => document.querySelector('.room-player-surface video')?.src.startsWith('blob:')), 'local file was not restored after refresh');
    await a.evaluate(() => {
        window.departureFileURL = document.querySelector('.room-player-surface video').src;
        window.departureRevoked = []; const revoke = URL.revokeObjectURL;
        URL.revokeObjectURL = url => { window.departureRevoked.push(url); return revoke(url); };
    });
    await open(a, 'Watch'); await a.locator('#room-link-input').fill(`${base}/bg-video.mp4`);
    await a.getByRole('button', { name: 'Play Now', exact: true }).click();
    await wait(() => a.evaluate(() => window.departureRevoked.includes(window.departureFileURL)), 'source replacement did not revoke old File URL');
    await wait(() => b.evaluate(() => window.lifecycleRevoked.includes(window.lifecycleBaseline.src)), 'peer source replacement did not release File URL');
    assert.equal(await a.evaluate(() => window.callTracks.every(track => track.readyState === 'live')), true);
    assert.equal(await a.evaluate(() => window.callTokenRequests), 1);
    await wait(() => a.evaluate(() => !document.querySelector('.room-player-surface video')?.src.startsWith('blob:')), 'remote source transition incomplete');
    await input.setInputFiles(path.resolve(__dirname, '../public/bg-video.mp4'));
    await wait(() => a.evaluate(() => document.querySelector('.room-player-surface video')?.src.startsWith('blob:')), 'replacement local source not loaded');
    await a.evaluate(() => { window.departureFileURL = document.querySelector('.room-player-surface video').src; });
    evidence.checks.push('Actual source replacement releases both browsers’ local File URLs without disconnecting the media call');
};
