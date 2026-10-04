import test from 'node:test';
import assert from 'node:assert/strict';
import { createSoundEffects, DEFAULT_SOUND_SETTINGS, normalizeSoundSettings, readSoundSettings, renderSoundSamples, SOUND_TONES } from '../src/utils/soundEffects.js';
import { createCallPresenceSounds, createMembershipSounds, createMediaActionSounds } from '../src/utils/soundNotifications.js';

test('sound preferences default to 35%, validate values and tolerate unavailable storage', () => {
    assert.deepEqual(readSoundSettings({ getItem() { throw new Error('Blocked'); } }), DEFAULT_SOUND_SETTINGS);
    assert.deepEqual(normalizeSoundSettings({ enabled: 'false', voice: false, volume: 10 }), { enabled: true, room: true, voice: false, volume: 1 });
    assert.equal(normalizeSoundSettings({ volume: NaN }).volume, .35);
    assert.equal(normalizeSoundSettings({ volume: -2 }).volume, 0);
});

test('eight soft short tones have silent endpoints, bounded peaks and no non-finite samples', () => {
    for (const tone of Object.values(SOUND_TONES)) {
        const samples = renderSoundSamples(tone, 48000);
        assert.ok(samples.length <= 48000 * .3); assert.equal(samples[0], 0); assert.equal(samples.at(-1), 0);
        let peak = 0; for (const value of samples) { assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); }
        assert.ok(peak > .02 && peak < .2);
    }
});

test('effects preload once, require successful unlock, drop missed events and connect only to local destination', async () => {
    const contexts = [], starts = [], stops = [];
    const engine = createSoundEffects({ createContext: () => {
        const context = { state: 'suspended', sampleRate: 48000, currentTime: 0, destination: {},
            createGain: () => ({ gain: { value: 0, setTargetAtTime() {} }, connect(target) { assert.equal(target, context.destination); } }),
            createBuffer: (_, length, rate) => ({ duration: length / rate, copyToChannel(samples) { this.samples = samples; } }),
            createBufferSource: () => ({ connect() {}, disconnect() {}, start() { starts.push(this.buffer.duration); }, stop() { stops.push(this); } }),
            resume: async () => { context.state = 'running'; }, close: async () => { context.state = 'closed'; } };
        contexts.push(context); return context;
    } });
    engine.preload(); engine.preload(); assert.equal(contexts.length, 1); assert.equal(engine.play('roomJoin'), false);
    engine.unlock(); await Promise.resolve(); assert.equal(starts.length, 0); // No delayed replay.
    assert.equal(engine.play('roomJoin'), true); assert.equal(engine.play('cameraOn'), true);
    engine.configure({ ...DEFAULT_SOUND_SETTINGS, room: false }); assert.equal(engine.play('roomLeave'), false); assert.equal(stops.length, 1);
    engine.configure({ ...DEFAULT_SOUND_SETTINGS, enabled: false }); assert.equal(engine.play('mute'), false);
    engine.configure({ ...DEFAULT_SOUND_SETTINGS, volume: 0 }); assert.equal(engine.play('voiceJoin'), false);
    contexts[0].state = 'suspended'; assert.equal(engine.play('voiceJoin'), false);
    engine.dispose(); engine.preload(); assert.equal(contexts.length, 2); assert.equal(engine.play('roomJoin'), false);
    engine.dispose();
});

test('room sounds exclude self, deduplicate stable identity and suppress transport loss/resume and snapshots', () => {
    const sounds = []; let ready = true;
    const presence = createMembershipSounds({ play: name => sounds.push(name), self: () => 'me', ready: () => ready });
    presence.baseline(['me', 'existing'], 'room'); presence.joined('me'); presence.joined('existing');
    presence.joined('was-offline-before-observer-joined', true);
    presence.joined('new'); presence.joined('new'); assert.deepEqual(sounds, ['roomJoin']);
    presence.left('new', 'disconnect'); presence.baseline(['me'], 'room'); presence.joined('new'); assert.equal(sounds.length, 1);
    ready = false; presence.joined('during-resync'); presence.left('existing', 'left');
    ready = true; presence.baseline(['me', 'new', 'during-resync'], 'room'); presence.joined('during-resync'); assert.equal(sounds.length, 1);
    presence.left('new', 'left'); presence.left('new', 'left'); presence.joined('new');
    assert.deepEqual(sounds, ['roomJoin', 'roomLeave', 'roomJoin']);
});

test('call sounds ignore initial participants, unknown disconnects and full/signaling recovery', () => {
    const sounds = [], presence = createCallPresenceSounds({ play: name => sounds.push(name), ready: () => true });
    presence.baseline(['existing']); presence.joined('existing'); presence.joined('new'); presence.joined('new');
    presence.left('new', false); presence.joined('new');
    presence.suspend(); presence.left('existing', false); presence.baseline(['existing', 'new']); presence.joined('existing'); presence.joined('new');
    assert.deepEqual(sounds, ['voiceJoin']);
    presence.left('new', true); presence.left('new', true); presence.joined('new');
    assert.deepEqual(sounds, ['voiceJoin', 'voiceLeave', 'voiceJoin']);
});

test('only successful explicit local actions produce feedback, concurrent duplicate actions produce one cue', async () => {
    const sounds = [], room = { state: 'disconnected', localParticipant: { isCameraEnabled: false, isMicrophoneEnabled: false } };
    let finish; const camera = new Promise(resolve => finish = resolve);
    const act = createMediaActionSounds({ room, play: name => sounds.push(name), act: async action => {
        if (action === 'cameraOn') { await camera; room.state = 'connected'; room.localParticipant.isCameraEnabled = true; }
        if (action === 'cameraOff') room.localParticipant.isCameraEnabled = false;
        if (action === 'joinVoice') { room.state = 'connected'; room.localParticipant.isMicrophoneEnabled = true; }
        if (action === 'toggleMicrophone') room.localParticipant.isMicrophoneEnabled = !room.localParticipant.isMicrophoneEnabled;
        if (action === 'leave') room.state = 'disconnected';
    } });
    const first = act('cameraOn'), second = act('cameraOn'); finish(); await Promise.all([first, second]); await act('cameraOn');
    await act('cameraOff'); await act('joinVoice'); await act('toggleMicrophone'); await act('toggleMicrophone'); await act('leave');
    assert.deepEqual(sounds, ['cameraOn', 'cameraOff', 'voiceJoin', 'mute', 'unmute', 'voiceLeave']);
    const failed = createMediaActionSounds({ room, play: name => sounds.push(name), act: async () => {} });
    await failed('cameraOn'); assert.equal(sounds.length, 6);
});
