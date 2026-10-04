const assert = require('node:assert/strict');
const { io } = require('socket.io-client');

function instrument() {
    window.soundStarts = []; window.soundContexts = []; window.soundGainValues = []; window.soundStreamOutputs = 0;
    const start = AudioBufferSourceNode.prototype.start, connect = GainNode.prototype.connect;
    AudioBufferSourceNode.prototype.start = function (...args) { if (this.buffer) window.soundStarts.push(this.buffer.duration); return start.apply(this, args); };
    GainNode.prototype.connect = function (target, ...args) {
        if (target === this.context.destination) { window.soundContexts.push(this.context); window.soundGainValues.push(this.gain.value); }
        return connect.call(this, target, ...args);
    };
    const stream = AudioContext.prototype.createMediaStreamDestination;
    AudioContext.prototype.createMediaStreamDestination = function (...args) { window.soundStreamOutputs++; return stream.apply(this, args); };
}
const counts = page => page.evaluate(async () => {
    const { SOUND_TONES } = await import('/src/utils/soundEffects.js');
    return Object.fromEntries(Object.entries(SOUND_TONES).map(([name, tone]) => [name, window.soundStarts.filter(duration => Math.abs(duration - tone.duration) < .0001).length]));
});
const clear = async (...pages) => { for (const page of pages) await page.evaluate(() => window.soundStarts = []); };

module.exports = async ({ a, b, open, wait, audio, decode, synced, snapshot, base, backendUrl, roomId, evidence }) => {
    await clear(a, b);
    const oldParticipant = await a.evaluate(() => window.testCallRoom.localParticipant.sid);
    await a.evaluate(() => window.testCallRoom.simulateScenario('full-reconnect'));
    await wait(() => a.evaluate(old => window.testCallRoom.state === 'connected' && window.testCallRoom.localParticipant.sid !== old, oldParticipant), 'full LiveKit reconnect failed');
    await wait(async () => { try { return (await decode(b, 'Camera A')).frames > 2; } catch { return false; } }, 'camera after full reconnect failed');
    await new Promise(resolve => setTimeout(resolve, 400));
    assert.equal(await a.evaluate(() => window.soundStarts.length), 0, 'own LiveKit restart played cues');
    assert.equal(await b.evaluate(() => window.soundStarts.length), 0, 'remote LiveKit restart played cues');
    const oldSocket = await b.evaluate(async () => (await import('/src/socket.js')).socket.id);
    await b.evaluate(async () => (await import('/src/socket.js')).socket.io.engine.close());
    await wait(() => b.evaluate(async old => { const { socket } = await import('/src/socket.js'); return socket.connected && socket.id !== old; }, oldSocket), 'Socket.IO did not reconnect'); await synced(b);
    assert.equal((await snapshot()).members.length, 2);
    assert.equal(await a.evaluate(() => window.soundStarts.length), 0, 'remote socket recovery played member cues');
    assert.equal(await b.evaluate(() => window.soundStarts.length), 0, 'own socket recovery played cues');

    const settings = async () => { await a.getByRole('button', { name: 'Room settings', exact: true }).click(); await a.getByRole('heading', { name: 'Sound', exact: true }).scrollIntoViewIfNeeded(); };
    const close = () => a.keyboard.press('Escape');
    await settings(); const panel = a.locator('.appearance-panel');
    assert.equal(await panel.getByLabel('Effects volume', { exact: true }).inputValue(), '35');
    await panel.getByRole('switch', { name: 'Sound effects', exact: true }).click();
    assert.equal(await panel.getByRole('switch', { name: 'Voice sounds', exact: true }).isDisabled(), true); await close();
    await open(a, 'Video');
    for (const name of ['Turn camera off', 'Turn camera on', 'Unmute microphone', 'Mute microphone']) await a.getByRole('button', { name, exact: true }).click();
    assert.equal(await a.evaluate(() => window.soundStarts.length), 0); assert.equal(await b.evaluate(() => window.soundStarts.length), 0);
    await settings(); await panel.getByRole('switch', { name: 'Sound effects', exact: true }).click();
    await panel.getByRole('switch', { name: 'Voice sounds', exact: true }).click();
    await panel.getByRole('switch', { name: 'Room join sounds', exact: true }).click();
    const volume = panel.getByLabel('Effects volume', { exact: true }); await volume.press('Home'); for (let i = 0; i < 20; i++) await volume.press('ArrowRight'); assert.equal(await volume.inputValue(), '20'); await close();
    const persisted = await a.context().newPage(); await persisted.addInitScript(instrument); await persisted.goto(base);
    await wait(() => persisted.evaluate(() => window.soundGainValues.length > 0), 'effects did not preload');
    assert.ok(await persisted.evaluate(() => window.soundGainValues.every(value => Math.abs(value - .2) < .0001)));
    assert.equal(await persisted.evaluate(() => window.soundStarts.length), 0); await persisted.close();

    await open(b, 'Video'); await b.getByRole('button', { name: 'Leave call', exact: true }).click();
    await wait(async () => (await counts(b)).voiceLeave === 1, 'local voice leave missing');
    assert.equal((await counts(a)).voiceLeave, 0, 'voice category OFF ignored');
    await b.getByRole('button', { name: 'Join video', exact: true }).click(); await b.locator('.video-call-content[data-camera-on="true"]').waitFor();
    await b.getByRole('button', { name: 'Unmute microphone', exact: true }).click();
    await wait(async () => (await counts(b)).unmute === 1, 'local unmute cue did not complete');
    assert.equal(await a.evaluate(() => window.soundStarts.length), 0);

    const member = async () => {
        const client = io(backendUrl, { transports: ['websocket'], reconnection: false });
        await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
        const result = await new Promise(resolve => client.emit('room:join', { roomId, nickname: 'Sound visitor', protocolVersion: 2 }, resolve)); assert.equal(result.ok, true);
        return client;
    };
    await clear(a, b); let guest = await member();
    await wait(async () => (await counts(b)).roomJoin === 1, 'member join cue missing'); assert.equal((await counts(a)).roomJoin, 0);
    guest.emit('leave_room'); await wait(async () => (await counts(b)).roomLeave === 1, 'member leave cue missing'); guest.disconnect(); assert.equal((await counts(a)).roomLeave, 0);
    await settings(); await panel.getByRole('switch', { name: 'Room join sounds', exact: true }).click(); await panel.getByRole('switch', { name: 'Voice sounds', exact: true }).click();
    await volume.press('Home'); for (let i = 0; i < 35; i++) await volume.press('ArrowRight'); await close();
    await clear(a, b); await b.getByRole('button', { name: 'Leave call', exact: true }).click();
    await wait(async () => (await counts(a)).voiceLeave === 1 && (await counts(b)).voiceLeave === 1, 'enabled voice departure missing or duplicated');
    await b.getByRole('button', { name: 'Join video', exact: true }).click(); await b.locator('.video-call-content[data-camera-on="true"]').waitFor();
    await b.getByRole('button', { name: 'Unmute microphone', exact: true }).click();
    await wait(async () => (await counts(b)).unmute === 1 && (await counts(b)).cameraOn === 1, 'local rejoin cues did not complete');
    await wait(async () => (await counts(a)).voiceJoin === 1, 'remote voice join missing or duplicated');
    await clear(a, b); guest = await member(); await wait(async () => (await counts(a)).roomJoin === 1 && (await counts(b)).roomJoin === 1, 'enabled member join cue missing');
    guest.emit('leave_room'); await wait(async () => (await counts(a)).roomLeave === 1 && (await counts(b)).roomLeave === 1, 'enabled member leave cue missing'); guest.disconnect();
    await clear(a, b); await open(a, 'Video'); await a.getByRole('button', { name: 'Turn camera off', exact: true }).click(); await a.getByRole('button', { name: 'Turn camera on', exact: true }).click();
    await a.getByRole('button', { name: 'Unmute microphone', exact: true }).click(); await wait(async () => (await audio(b)).rms > .01, 'unmute interrupted remote microphone');
    await a.getByRole('button', { name: 'Mute microphone', exact: true }).click(); await wait(async () => (await audio(b)).rms < .003, 'sound was broadcast despite mute');
    assert.deepEqual(await counts(a), { roomJoin: 0, roomLeave: 0, voiceJoin: 0, voiceLeave: 0, cameraOn: 1, cameraOff: 1, unmute: 1, mute: 1 });
    assert.deepEqual(await counts(b), { roomJoin: 0, roomLeave: 0, voiceJoin: 0, voiceLeave: 0, cameraOn: 0, cameraOff: 0, unmute: 0, mute: 0 }, 'another participant received a local toggle cue');
    for (const page of [a, b]) assert.equal(await page.evaluate(() => window.soundStreamOutputs), 0, 'UI effects connected to a capture destination');
    assert.equal(await a.evaluate(() => window.callTokenRequests), 1);
    assert.ok(await a.locator('.room-player-surface video').evaluate(video => !video.paused && video.currentTime > 0));
    evidence.checks.push('Local notification sources, 35% defaults, master/category gating, persisted 20% gain, no self/duplicate joins, no LiveKit full/signal or Socket.IO recovery cues, local-only camera/mic cues and no capture destinations pass');
};
module.exports.instrument = instrument;
module.exports.counts = counts;
