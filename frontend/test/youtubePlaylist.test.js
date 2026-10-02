import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYouTubeUrl } from '../src/utils/youtubeUrl.js';
import { createYouTubePlaylistSession } from '../src/utils/youtubePlaylistSession.js';

const list = 'PLBCF2DAC6FFB574DE', videos = ['GvgqDSnpRQM', 'V4DDt30Aat4', 'dQw4w9WgXcQ'];
test('YouTube playlist forms preserve list, selected video and one-based URL index', () => {
    for (const url of [`https://www.youtube.com/playlist?list=${list}`, `https://youtube.com/playlist?list=${list}`, `youtube.com/playlist?list=${list}`]) {
        const source = parseYouTubeUrl(url);
        assert.equal(source.kind, 'youtube-playlist');
        assert.equal(source.playlistId, list);
        assert.equal(source.videoId, null);
    }
    for (const url of [`https://youtube.com/watch?v=${videos[1]}&list=${list}&index=5`, `https://youtu.be/${videos[1]}?list=${list}&index=5`, `https://www.youtube-nocookie.com/embed/${videos[1]}?list=${list}&index=5`]) {
        const source = parseYouTubeUrl(url);
        assert.equal(source.playlistIndex, 4);
        assert.equal(source.videoId, videos[1]);
        assert.equal(source.playlistId, list);
        assert.ok(source.url.includes('index=5'));
    }
    for (const index of ['0', '-1', '1.5', 'NaN', '999999']) assert.equal(parseYouTubeUrl(`https://youtube.com/playlist?list=${list}&index=${index}`).playlistIndex, 0);
    assert.equal(parseYouTubeUrl('https://youtube.com/playlist?list=bad<script>').kind, 'invalid');
    assert.equal(parseYouTubeUrl(`https://youtube.com.evil.example/playlist?list=${list}`), null);
    assert.equal(parseYouTubeUrl(`https://youtu.be/${videos[0]}`).kind, 'youtube');
});

function fixture(host = true) {
    let time = 0;
    const calls = [], commands = [], status = [], errors = [];
    const state = { sourceType: 'youtube-playlist', sourceId: 'source', sourceRevision: 0, playlistId: list, playlistIndex: 0, playlistStatus: 'loading', currentVideoId: null, isPlaying: false, playedSeconds: 0 };
    const player = {
        items: videos, data: { video_id: videos[0], title: 'Actual API title' }, state: 5,
        cuePlaylist(...args) { calls.push(args); if (Array.isArray(args[0])) this.items = [...args[0]]; },
        getPlaylist() { return this.items; }, getVideoData() { return this.data; }, getPlayerState() { return this.state; }, setLoop() {}, setShuffle() {},
    };
    const session = createYouTubePlaylistSession({
        getState: () => state, getPlayer: () => player, isController: () => host, getPosition: () => state.playedSeconds,
        send: async (action, options, expected) => { commands.push({ action, options, expected: { ...expected } }); return true; },
        onReady: (...args) => status.push(args), onError: value => errors.push(value), now: () => time,
    });
    const resolve = () => Object.assign(state, { playlistItems: videos, playlistStatus: 'ready', currentVideoId: videos[0], sourceRevision: 1 });
    return { state, player, session, calls, commands, status, errors, resolve, time: value => { time = value; } };
}

test('controller discovers the real API list once and cues only the authoritative item', () => {
    const f = fixture();
    f.session.tick(); f.session.tick();
    assert.equal(f.calls.length, 1);
    assert.equal(f.commands.filter(command => command.action === 'RESOLVE').length, 1);
    assert.deepEqual(f.commands[0].options.items, videos);
    assert.equal(f.session.ready(), false);
    f.resolve();
    f.session.tick();
    assert.deepEqual(f.calls[1], [[videos[0]], 0, 0]);
    assert.equal(f.session.ready(), false);
    f.session.tick();
    assert.equal(f.session.ready(), true);
    f.time(1000);
    assert.equal(f.session.canEmit(), true);
    for (let count = 0; count < 20; count++) f.session.tick();
    assert.equal(f.commands.filter(command => command.action === 'READY').length, 1);
    assert.equal(f.calls.length, 2);
});

test('late viewer restores current item/time without publishing navigation or discovery', () => {
    const f = fixture(false);
    f.session.tick(); assert.equal(f.commands.length, 0);
    Object.assign(f.state, { playlistItems: videos, playlistStatus: 'ready', playlistIndex: 2, currentVideoId: videos[2], sourceRevision: 7, playedSeconds: 102, isPlaying: true });
    f.session.tick();
    assert.deepEqual(f.calls[0], [[videos[2]], 0, 102]);
    f.player.state = 1; f.player.data.video_id = videos[2];
    f.session.tick(); assert.equal(f.session.ready(), false, 'only a real CUED event marks a new item ready');
    f.player.state = 5; f.session.tick();
    assert.equal(f.session.ready(), true);
    assert.deepEqual(f.commands.map(command => command.action), ['READY']);
    f.session.fail('unavailable');
    assert.deepEqual(f.commands.map(command => command.action), ['READY']);
});

test('new item identity suppresses stale events, avoids echo commands and preserves paused seek position', () => {
    const f = fixture(); f.resolve(); f.session.tick(); f.session.tick(); f.time(1000);
    Object.assign(f.state, { currentVideoId: videos[1], playlistIndex: 1, sourceRevision: 2, playedSeconds: 8 });
    assert.equal(f.session.ready(), false);
    assert.equal(f.session.canEmit(), false);
    f.session.tick();
    assert.deepEqual(f.calls.at(-1), [[videos[1]], 0, 8]);
    f.session.fail('old error');
    assert.equal(f.commands.filter(command => command.action === 'ERROR').length, 0);
    f.player.data.video_id = videos[1]; f.player.state = 5; f.session.tick();
    assert.equal(f.session.ready(), true);
    assert.equal(f.commands.filter(command => ['NEXT', 'PREVIOUS', 'SELECT'].includes(command.action)).length, 0);
    f.session.fail('unavailable'); f.session.fail('unavailable');
    assert.equal(f.commands.filter(command => command.action === 'ERROR').length, 1);
    assert.equal(f.commands.at(-1).expected.sourceRevision, 2);
});

test('empty/unavailable playlist discovery fails finitely without marking it ready', () => {
    const f = fixture(); f.player.items = [];
    f.session.tick(); f.time(16000); f.session.tick(); f.session.tick();
    assert.equal(f.session.ready(), false);
    assert.equal(f.commands.filter(command => command.action === 'ERROR').length, 1);
});
