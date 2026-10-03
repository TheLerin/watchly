// Two separate browser processes use distinct fake microphone tones. The test
// verifies decoded remote PCM in both directions, not just participant counts.
// Supply deployed public URLs, or point these at an isolated local LiveKit setup.
const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const base = process.env.WATCHLY_TEST_BASE_URL, backend = process.env.WATCHLY_TEST_BACKEND_URL;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const wait = async (predicate, message, timeout = 45000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await predicate()) return; await sleep(200); } throw new Error(message); };
const artifacts = path.resolve(__dirname, 'artifacts'); mkdirSync(artifacts, { recursive: true });
const tone = (name, frequency) => {
    const samples = 48000 * 3, wav = Buffer.alloc(44 + samples * 2); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(48000, 24); wav.writeUInt32LE(96000, 28); wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(samples * 2, 40);
    for (let i = 0; i < samples; i++) wav.writeInt16LE(Math.round(7000 * Math.sin(2 * Math.PI * frequency * i / 48000)), 44 + i * 2);
    const file = path.join(artifacts, name); writeFileSync(file, wav); return file;
};
const audio = page => page.evaluate(async () => {
    const element = [...document.querySelectorAll('.livekit-voice audio')].find(audio => audio.srcObject?.getAudioTracks().some(track => track.readyState === 'live'));
    if (!element) return { rms: 0, frequency: 0, playing: false };
    if (!window.voiceProbe || window.voiceProbe.stream !== element.srcObject) {
        window.voiceProbe?.source.disconnect(); await window.voiceProbe?.context.close();
        const context = new AudioContext(), analyser = context.createAnalyser(), source = context.createMediaStreamSource(element.srcObject);
        analyser.fftSize = 8192; source.connect(analyser); await context.resume(); window.voiceProbe = { context, analyser, source, stream: element.srcObject };
    }
    const { analyser, context } = window.voiceProbe, signal = new Float32Array(analyser.fftSize), spectrum = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatTimeDomainData(signal); analyser.getFloatFrequencyData(spectrum);
    let peak = 0; for (let i = 1; i < spectrum.length; i++) if (spectrum[i] > spectrum[peak]) peak = i;
    return { rms: Math.sqrt(signal.reduce((sum, value) => sum + value * value, 0) / signal.length), frequency: peak * context.sampleRate / analyser.fftSize, playing: !element.paused && !element.muted && element.volume > 0, ready: element.readyState };
});
(async () => {
    assert.ok(base && backend, 'Set WATCHLY_TEST_BASE_URL and WATCHLY_TEST_BACKEND_URL to public Watchly URLs (no LiveKit credentials).');
    const chrome = process.env.BROWSER_EXECUTABLE || ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(existsSync);
    const edge = process.env.SECOND_BROWSER_EXECUTABLE || ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find(existsSync) || chrome;
    const browsers = [], errors = [], tokens = [], result = { base, backend, browsers: [path.basename(chrome), path.basename(edge)], checks: [] };
    let a, b;
    try {
        const health = await fetch(`${backend}/api/health`, { signal: AbortSignal.timeout(55000) }); assert.equal(health.status, 200);
        for (const [executablePath, frequency, name] of [[chrome, 440, 'voice-a.wav'], [edge, 880, 'voice-b.wav']]) {
            const browser = await chromium.launch({ executablePath, headless: true, args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', `--use-file-for-fake-audio-capture=${tone(name, frequency)}`, '--autoplay-policy=no-user-gesture-required', '--mute-audio', '--disable-background-timer-throttling', '--disable-renderer-backgrounding'] }); browsers.push(browser);
            const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
            page.on('pageerror', error => errors.push(error.message));
            page.on('response', async response => { if (response.url().endsWith('/api/livekit/token') && response.ok()) tokens.push(await response.json().catch(() => null)); });
            await page.addInitScript(() => {
                localStorage.setItem('watchly-appearance-settings', JSON.stringify({ uiTheme: 'glass-dark', roomStyle: 'classic' }));
                window.voiceCaptureCalls = []; window.voiceCapturedTracks = []; window.voicePeers = [];
                const original = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getUserMedia = async constraints => {
                    window.voiceCaptureCalls.push(constraints);
                    // Stable test tones must survive speech-oriented suppression.
                    const stream = await original({ ...constraints, audio: constraints.audio ? { ...(typeof constraints.audio === 'object' ? constraints.audio : {}), echoCancellation: false, noiseSuppression: false, autoGainControl: false } : false });
                    window.voiceCapturedTracks.push(...stream.getTracks()); return stream;
                };
                const PC = window.RTCPeerConnection;
                window.RTCPeerConnection = new Proxy(PC, { construct(target, args) { const pc = Reflect.construct(target, args, target); window.voicePeers.push(pc); return pc; } });
            });
            if (!a) a = page; else b = page;
        }
        await a.goto(base); await a.getByRole('button', { name: 'Create room', exact: true }).first().click(); await a.getByPlaceholder('Your nickname').fill('Voice A'); await a.locator('.room-launcher-submit').click(); await a.waitForURL('**/room/**');
        const roomUrl = a.url(), roomId = roomUrl.split('/').pop();
        await b.goto(roomUrl); await b.getByLabel('Nickname', { exact: true }).fill('Voice B'); await b.getByRole('button', { name: 'Join room', exact: true }).click();
        const synced = page => wait(async () => await page.locator('.room-ping-button').getAttribute('data-connection-phase') === 'connected', 'Watchly room is not synchronized'); await synced(a); await synced(b);
        // Production bundles do not expose their Socket.IO module. Room member
        // cards and the stable private session supply the same visible invariant.
        const memberships = async () => { for (const page of [a, b]) { await page.locator('#classic-room-tab').click(); await page.getByText('Voice A', { exact: true }).first().waitFor(); await page.getByText('Voice B', { exact: true }).first().waitFor(); await page.locator('.room-members-queue').getByText('Host', { exact: true }).waitFor(); await page.locator('.room-members-queue').getByText('Viewer', { exact: true }).waitFor(); assert.equal(new URL(page.url()).pathname, `/room/${roomId}`); assert.equal(await page.locator('.room-ping-button').getAttribute('data-connection-phase'), 'connected'); } };
        await memberships();
        for (const page of [a, b]) { await page.locator('#classic-call-tab').click(); await page.locator('[data-voice-provider="livekit"]').waitFor(); assert.equal(await page.evaluate(() => window.voiceCaptureCalls.length), 0); assert.equal(await page.locator('[data-voice-provider="livekit"]').getAttribute('data-voice-state'), 'disconnected'); }
        assert.equal(tokens.length, 0); result.checks.push('No voice connection, token request, or microphone capture on Watchly room join');
        for (const page of [a, b]) { await page.getByRole('button', { name: 'Join Voice', exact: true }).click(); await wait(async () => await page.locator('.livekit-voice').getAttribute('data-voice-state') === 'connected', 'LiveKit voice failed to connect'); await page.getByRole('button', { name: 'Mute', exact: true }).waitFor(); }
        for (const page of [a, b]) { await wait(async () => await page.locator('.livekit-voice-person').count() === 2, 'LiveKit participants missing'); assert.equal(await page.evaluate(() => window.voiceCaptureCalls.every(call => !call.video)), true); const stats = await page.evaluate(async () => { const all = await Promise.all(window.voicePeers.map(peer => peer.getStats())); return all.flatMap(report => [...report.values()]).filter(value => value.type === 'outbound-rtp' && value.kind === 'video').length; }); assert.equal(stats, 0); }
        await wait(async () => { const value = await audio(a); return value.playing && value.rms > .01 && Math.abs(value.frequency - 880) < 20; }, 'A did not render/decode B microphone audio');
        await wait(async () => { const value = await audio(b); return value.playing && value.rms > .01 && Math.abs(value.frequency - 440) < 20; }, 'B did not render/decode A microphone audio');
        result.audio = { aHearsB: await audio(a), bHearsA: await audio(b) }; result.checks.push('Bidirectional decoded microphone audio rendered and playing; camera/video publication absent');
        await wait(async () => await a.locator('.livekit-voice-person[data-speaking="true"]').count() > 0, 'Speaking indicator missing');
        await a.screenshot({ path: path.join(artifacts, 'livekit-a-connected.png'), fullPage: true }); await b.screenshot({ path: path.join(artifacts, 'livekit-b-connected.png'), fullPage: true });
        await b.getByRole('button', { name: 'Mute', exact: true }).click(); await b.getByRole('button', { name: 'Unmute', exact: true }).waitFor();
        await wait(async () => await a.locator('.livekit-voice-person').filter({ hasText: 'Voice B' }).getAttribute('data-muted') === 'true', 'Remote mute indicator missing');
        await wait(async () => (await audio(a)).rms < .003, 'Muted B microphone remained audible');
        await b.getByRole('button', { name: 'Unmute', exact: true }).click(); await b.getByRole('button', { name: 'Mute', exact: true }).waitFor();
        await wait(async () => { const value = await audio(a); return value.rms > .01 && Math.abs(value.frequency - 880) < 20; }, 'Unmuted B microphone did not resume audio'); result.checks.push('Mute stops remote audio and updates indicator; Unmute restores audio');
        await b.getByRole('button', { name: 'Leave Voice', exact: true }).click(); await b.getByRole('button', { name: 'Join Voice', exact: true }).waitFor();
        await wait(async () => await a.locator('.livekit-voice-person').count() === 1, 'Leaving voice did not remove participant');
        assert.equal(await b.evaluate(() => window.voiceCapturedTracks.every(track => track.readyState === 'ended')), true);
        await memberships(); result.checks.push('Leaving stops microphone and removes LiveKit participant while both Watchly memberships/room synchronization remain intact');
        await a.locator('#classic-call-tab').click(); await a.getByRole('button', { name: 'Leave Voice', exact: true }).click(); assert.equal(await a.evaluate(() => window.voiceCapturedTracks.every(track => track.readyState === 'ended')), true);
        assert.deepEqual(errors, []); assert.equal(tokens.length, 2);
        for (const token of tokens) { assert.deepEqual(Object.keys(token).sort(), ['participantToken', 'serverUrl']); const claims = JSON.parse(Buffer.from(token.participantToken.split('.')[1], 'base64url')); assert.deepEqual(claims.video.canPublishSources, ['microphone']); assert.equal(claims.video.room, `watchly-voice-${roomId}`); }
        result.passed = true; writeFileSync(path.join(artifacts, 'livekit-verification.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result, null, 2));
    } catch (error) {
        for (const [name, page] of [['a', a], ['b', b]]) if (page) { await page.screenshot({ path: path.join(artifacts, `livekit-${name}-failure.png`), fullPage: true }).catch(() => {}); console.error(name, await page.locator('.room-voice').innerText().catch(() => 'voice controls unavailable')); }
        throw error;
    } finally { await Promise.all(browsers.map(browser => browser.close())); }
})().catch(error => { console.error(error.message); process.exitCode = 1; });
