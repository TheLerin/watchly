import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaSynchronizer } from '../src/utils/mediaSynchronizer.js';
import { playbackCommand } from '../src/utils/playbackCommands.js';

function fixture() {
    let now = 1000;
    const pending = new Map();
    let id = 0;
    const video = Object.assign(new EventTarget(), { readyState: 4, seeking: false, currentTime: 0, paused: true, playbackRate: 1,
        play() { this.paused = false; return Promise.resolve(); }, pause() { this.paused = true; } });
    const errors = [];
    const sync = createMediaSynchronizer({ serverNow: () => now, toLocalDelay: deadline => deadline - now,
        schedule: fn => { pending.set(++id, fn); return id; }, cancel: timer => pending.delete(timer),
        onPlayError: error => errors.push(error) });
    const advance = time => { now = time; const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(fn => fn()); };
    return { video, sync, pending, errors, advance };
}
const state = (extra = {}) => ({ seq: 1, status: 'playing', positionSec: 10, effectiveAtServerMs: 1750, rate: 1, ...extra });

test('URL and local playback controls use their respective server protocols', () => {
    const remote = { sourceType: 'remote' };
    for (const [action, event] of [['PLAY', 'play_video'], ['PAUSE', 'pause_video'], ['SEEK', 'seek_video'], ['ENDED', 'pause_video']]) {
        const command = playbackCommand(remote, action, { positionSec: 12 });
        assert.equal(command.event, event);
        assert.equal(command.payload.playedSeconds, 12);
        assert.equal(playbackCommand({ sourceType: 'local', localMedia: { sessionId: 'movie' } }, action).event, 'playback:command');
    }
});
test('scheduled state and drift correction do not execute before the shared deadline', () => {
    const { sync, video, advance } = fixture();
    sync.apply(video, state());
    sync.correct(video, state(), true);
    assert.equal(video.currentTime, 0);
    assert.equal(video.paused, true);
    advance(1750);
    assert.equal(video.currentTime, 10);
    assert.equal(video.paused, false);
    assert.equal(sync.isApplyingSeek(video), true);
    assert.equal(sync.finishSeek(video), true);
    assert.equal(sync.isApplyingSeek(video), false);
});
test('new command cancels old deadlines; stale forced state cannot replace it', () => {
    const { sync, video, advance, pending } = fixture();
    sync.apply(video, state());
    sync.apply(video, state({ seq: 2, status: 'paused', positionSec: 20 }));
    assert.equal(pending.size, 1);
    assert.equal(sync.apply(video, state(), { force: true }), false);
    advance(1750);
    assert.equal(video.paused, true);
    assert.equal(video.currentTime, 20);
});
test('seeked retries a command that arrived during seeking without needing canplay', () => {
    const { sync, video, advance } = fixture();
    video.seeking = true;
    sync.apply(video, state());
    advance(1750);
    video.seeking = false;
    video.dispatchEvent(new Event('seeked'));
    assert.equal(video.paused, false);
    assert.equal(video.currentTime, 10);
});
test('reset removes loading listeners and accepts a new media sequence starting at zero', () => {
    const { sync, video, advance } = fixture();
    video.readyState = 0;
    sync.apply(video, state());
    advance(1750);
    sync.reset();
    video.readyState = 4;
    video.dispatchEvent(new Event('canplay'));
    assert.equal(video.paused, true);
    assert.equal(sync.apply(video, state({ seq: 0, status: 'paused', positionSec: 3 })), true);
    assert.equal(video.currentTime, 3);
});
test('disconnect cancellation prevents a scheduled play; paused corrections seek precisely', () => {
    const { sync, video, advance } = fixture();
    sync.apply(video, state());
    sync.cancel();
    advance(1750);
    assert.equal(video.paused, true);
    video.currentTime = 9.8;
    sync.correct(video, state({ status: 'paused' }));
    assert.equal(video.currentTime, 10);
    assert.equal(video.playbackRate, 1);
});
test('autoplay denial is surfaced to the player', async () => {
    const { sync, video, advance, errors } = fixture();
    video.play = () => Promise.reject(new DOMException('Click to play', 'NotAllowedError'));
    sync.apply(video, state());
    advance(1750);
    await Promise.resolve();
    assert.equal(errors[0].name, 'NotAllowedError');
});

test('a user seek superseding an unfinished programmatic seek is not suppressed', () => {
    const { sync, video, advance } = fixture();
    sync.apply(video, state({ status: 'paused' }));
    advance(1750);
    video.currentTime = 20;
    assert.equal(sync.isApplyingSeek(video), false);
    assert.equal(sync.finishSeek(video), false);
});
