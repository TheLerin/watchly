import test from 'node:test';
import assert from 'node:assert/strict';
import { createMediaSession } from '../src/utils/livekitMedia.js';
import { clampCallRect } from '../src/utils/floatingCall.js';
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const setup = (overrides = {}) => {
    const calls = [], states = [], publications = new Map();
    const track = source => ({ mediaStreamTrack: { readyState: 'live' }, stop() { this.mediaStreamTrack.readyState = 'ended'; calls.push(`stop:${source}`); },
        async mute() { publications.get(source).isMuted = true; }, async unmute() { publications.get(source).isMuted = false; } });
    const participant = { getTrackPublication: source => publications.get(source),
        get isCameraEnabled() { return Boolean(publications.get('camera') && !publications.get('camera').isMuted); },
        get isMicrophoneEnabled() { return Boolean(publications.get('microphone') && !publications.get('microphone').isMuted); },
        async publishTrack(value, options) { calls.push(`publish:${options.source}`); publications.set(options.source, { track: value, isMuted: false }); },
        async unpublishTrack(value) { for (const [source, pub] of publications) if (pub.track === value) publications.delete(source); } };
    const room = { state: 'disconnected', localParticipant: participant, startAudio: async () => {},
        async connect() { calls.push('connect'); room.state = 'connected'; }, async disconnect() { calls.push('disconnect'); room.state = 'disconnected'; publications.clear(); },
        async switchActiveDevice(kind) { calls.push(`switch:${kind}`); } };
    const session = createMediaSession({ room, requestToken: async () => { calls.push('token'); return { serverUrl: 'ws://test', participantToken: 'test' }; },
        createMicrophone: async () => { calls.push('capture:microphone'); return track('microphone'); }, createCamera: async () => { calls.push('capture:camera'); return track('camera'); },
        canJoin: () => true, onState: patch => states.push(patch), ...overrides });
    return { room, session, calls, states, track, publications };
};
test('idle session requests no permission; video first connects and publishes only camera, voice reuses it', async () => {
    const { session, calls, room } = setup(); assert.deepEqual(calls, []);
    await session.cameraOn(); assert.deepEqual(calls, ['token', 'connect', 'capture:camera', 'publish:camera']); assert.equal(room.localParticipant.isMicrophoneEnabled, false);
    await session.joinVoice(); assert.equal(calls.filter(call => call === 'connect').length, 1); assert.equal(room.localParticipant.isMicrophoneEnabled, true);
});
test('adding camera to muted voice does not unmute; camera-off preserves connection and microphone', async () => {
    const { session, room, calls } = setup(); await session.joinVoice(); await session.toggleMicrophone();
    await session.cameraOn(); assert.equal(room.localParticipant.isMicrophoneEnabled, false); assert.equal(calls.filter(call => call === 'token').length, 1);
    await session.cameraOff(); assert.equal(room.state, 'connected'); assert.equal(room.localParticipant.isCameraEnabled, false);
    await session.toggleMicrophone(); assert.equal(room.localParticipant.isMicrophoneEnabled, true);
});
test('simultaneous voice/video joins coalesce authorization and connection', async () => {
    const { session, calls } = setup(); await Promise.all([session.joinVoice(), session.cameraOn(), session.cameraOn()]);
    assert.equal(calls.filter(call => call === 'connect').length, 1); assert.equal(calls.filter(call => call === 'token').length, 1); assert.equal(calls.filter(call => call === 'capture:camera').length, 1);
});
test('membership and token rejection cannot request camera or microphone', async () => {
    const { session, calls } = setup({ canJoin: () => false }); await session.cameraOn(); await session.joinVoice(); assert.deepEqual(calls, []);
    const denied = setup({ requestToken: async () => { throw new Error('Denied'); } }); await denied.session.cameraOn(); assert.equal(denied.calls.includes('capture:camera'), false);
});
test('leave during camera permission stops the late camera and never publishes', async () => {
    const capture = deferred(), { session, track, calls } = setup({ createCamera: () => capture.promise });
    const joining = session.cameraOn(); await new Promise(resolve => setTimeout(resolve, 0)); await session.leave(); capture.resolve(track('camera')); await joining;
    assert.ok(calls.includes('stop:camera')); assert.ok(!calls.includes('publish:camera'));
});
test('camera-off while permission is pending stops late capture but preserves voice', async () => {
    const capture = deferred(), { session, track, room, calls } = setup({ createCamera: () => capture.promise }); await session.joinVoice();
    const starting = session.cameraOn(); await new Promise(resolve => setTimeout(resolve, 0)); await session.cameraOff(); capture.resolve(track('camera')); await starting;
    assert.ok(calls.includes('stop:camera')); assert.equal(room.state, 'connected'); assert.equal(room.localParticipant.isMicrophoneEnabled, true);
});
test('camera denied leaves voice live and reports recovery; leaving releases both kinds', async () => {
    const { session, room, states, calls } = setup({ createCamera: async () => { throw Object.assign(new Error(), { name: 'NotAllowedError' }); } });
    await session.joinVoice(); await session.cameraOn(); assert.equal(room.localParticipant.isMicrophoneEnabled, true); assert.match(states.find(value => value.cameraError)?.cameraError, /access blocked/);
    await session.openWithoutCamera(); assert.equal(states.at(-1).cameraError, ''); await session.leave(); assert.ok(calls.includes('stop:microphone'));
    const both = setup(); await both.session.joinVoice(); await both.session.cameraOn(); await both.session.leave(); assert.ok(both.calls.includes('stop:camera')); assert.ok(both.calls.includes('stop:microphone'));
});
test('device choices while off do not capture, active switching reuses the connection', async () => {
    const { session, calls } = setup(); await session.switchDevice('videoinput', 'camera-2'); await session.switchDevice('audioinput', 'mic-2'); assert.deepEqual(calls, []);
    await session.cameraOn(); await session.switchDevice('videoinput', 'camera-3'); assert.ok(calls.includes('switch:videoinput')); assert.equal(calls.filter(call => call === 'connect').length, 1);
});

test('missing camera reports a usable error while microphone remains connected', async () => {
    const { session, states, room } = setup({ createCamera: async () => { throw Object.assign(new Error(), { name: 'NotFoundError' }); } });
    await session.joinVoice(); await session.cameraOn();
    assert.equal(room.state, 'connected'); assert.equal(room.localParticipant.isMicrophoneEnabled, true);
    assert.ok(states.some(value => value.cameraError === 'No camera detected.'));
});

test('unplugged camera is unpublished and releases capture without ending voice', async () => {
    let ended;
    const fixture = setup({ createCamera: async () => Object.assign(fixture.track('camera'), { on(event, handler) { if (event === 'ended') ended = handler; } }) });
    await fixture.session.joinVoice(); await fixture.session.cameraOn(); ended();
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(fixture.room.localParticipant.isCameraEnabled, false); assert.equal(fixture.room.localParticipant.isMicrophoneEnabled, true);
    assert.ok(fixture.states.some(value => value.cameraError?.includes('Camera disconnected')));
});
test('floating geometry clamps saved positions, sizes, orientation and narrow mobile cards', () => {
    for (const [width, height] of [[1920,1080], [1366,768], [1024,768], [390,844], [844,390], [320,200]]) {
        const value = clampCallRect({ x: 99999, y: -9999, width: 4000, height: 4000 }, { width, height });
        assert.ok(value.x >= 8 && value.y >= 8); assert.ok(value.x + value.width <= width - 8); assert.ok(value.y + value.height <= height - 8);
        if (width < 600) assert.ok(value.width <= width * .55);
        if (width < 600 || (width < 1180 && height < 500)) assert.ok(value.height <= 240 && value.height <= height * .55);
    }
});
