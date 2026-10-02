import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlayerResync } from '../src/utils/playerResync.js';

class Media extends EventTarget {
    readyState = 0; paused = true; seeking = false; time = 0; duration = 200;
    get currentTime() { return this.time; }
    set currentTime(value) { this.time = value; this.seeking = true; }
    play() { this.paused = false; this.dispatchEvent(new Event('playing')); return Promise.resolve(); }
    pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
    ready() { this.readyState = 4; this.dispatchEvent(new Event('canplay')); }
    seeked() { this.seeking = false; this.dispatchEvent(new Event('seeked')); }
}
function setup(options = {}) {
    let time = 0, completed = 0, timedOut = 0;
    const player = new Media(), target = { position: 85, playing: false, version: 1 }, timers = new Map(); let id = 0;
    const session = createPlayerResync({ getPlayer: () => player, getTarget: () => target, isReady: () => player.readyState >= 2,
        onComplete: () => completed++, onTimeout: () => timedOut++, now: () => time,
        schedule: fn => { timers.set(++id, fn); return id; }, cancel: key => timers.delete(key), ...options });
    return { player, target, session, complete: () => completed, timedOut: () => timedOut, advance: value => { time += value; for (const [key, fn] of [...timers]) { timers.delete(key); fn(); } } };
}

test('native paused restoration waits for readiness and completed seeking without autoplay', () => {
    const f = setup(); assert.equal(f.player.currentTime, 0); assert.equal(f.complete(), 0);
    f.player.ready(); assert.equal(f.player.currentTime, 85); assert.equal(f.complete(), 0);
    f.player.seeked(); assert.equal(f.complete(), 1); assert.equal(f.player.paused, true);
});
test('native playing restoration seeks before playing and accepts a newer authoritative seek', () => {
    const f = setup(); f.target.playing = true; f.player.ready();
    f.target.position = 120; f.target.version++;
    f.player.seeked(); assert.equal(f.player.currentTime, 120); assert.equal(f.player.paused, true);
    f.player.seeked(); assert.equal(f.player.paused, false); assert.equal(f.complete(), 1);
});
test('cancelled resync cannot play later; stalled readiness times out once', () => {
    const f = setup(); f.target.playing = true; f.session.dispose(); f.player.ready(); f.advance(31000);
    assert.equal(f.player.currentTime, 0); assert.equal(f.player.paused, true); assert.equal(f.complete(), 0);
    const stalled = setup(); stalled.advance(31000); stalled.advance(31000);
    assert.equal(stalled.timedOut(), 1); assert.equal(stalled.complete(), 0);
});
test('slow buffering catches up to the advancing server clock after the player becomes ready', () => {
    const f = setup(); f.target.playing = true; f.player.ready();
    f.player.readyState = 0; f.target.position = 90; f.advance(5000); f.player.seeked();
    assert.equal(f.complete(), 0); f.player.ready();
    assert.equal(f.player.currentTime, 90); assert.equal(f.player.paused, true);
    f.player.seeked(); assert.equal(f.complete(), 1); assert.equal(f.player.paused, false);
});
test('local restoration reuses canonical apply and honors its effective deadline', () => {
    let applied = 0;
    const f = setup({ applyLocal: () => { applied++; } }); f.target.waitMs = 750;
    f.player.ready(); assert.equal(applied, 0);
    f.target.waitMs = 0; f.session.pump(); assert.equal(applied, 1);
    f.player.time = 85; f.session.pump(); assert.equal(f.complete(), 1); assert.equal(applied, 1);
});
test('YouTube restoration waits for the right item, seeks, and explicitly preserves paused intent', () => {
    let id = 'old', position = 0, state = 5, completed = 0; const calls = [];
    const player = { getVideoData: () => ({ video_id: id }), getPlayerState: () => state, getCurrentTime: () => position, getDuration: () => 200,
        seekTo: value => { calls.push(['seek', value]); position = value; state = 1; }, pauseVideo: () => { calls.push(['pause']); state = 2; }, playVideo: () => { calls.push(['play']); state = 1; } };
    const resync = createPlayerResync({ youtube: true, getPlayer: () => player, getTarget: () => ({ videoId: 'new', position: 85, playing: false }), isReady: () => true,
        onComplete: () => completed++, schedule: () => 1, cancel: () => {} });
    assert.deepEqual(calls, []); id = 'new'; resync.pump(); assert.deepEqual(calls, [['seek', 85], ['pause']]);
    assert.equal(completed, 0); resync.pump(); assert.equal(completed, 1); assert.equal(state, 2);
});
