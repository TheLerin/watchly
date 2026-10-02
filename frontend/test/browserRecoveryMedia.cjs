const assert = require('node:assert/strict');

// Synthetic capture avoids hardware/permission automation; peer connections,
// signaling, offline transport and retained MediaStreamTracks are genuine.
module.exports = async ({ host, viewer, snapshot, offline, online, wait }) => {
    for (const page of [host, viewer]) {
        await page.evaluate(() => {
            window.microphoneRequests = 0; window.recoveryPeers = [];
            const Original = window.RTCPeerConnection;
            window.RTCPeerConnection = new Proxy(Original, { construct(target, args) {
                const peer = Reflect.construct(target, args, target); window.recoveryPeers.push(peer); return peer;
            } });
            navigator.mediaDevices.getUserMedia = async () => {
                window.microphoneRequests++;
                const context = new AudioContext(), oscillator = context.createOscillator(), destination = context.createMediaStreamDestination();
                oscillator.connect(destination); oscillator.start();
                window.recoveryMicContext = context; window.recoveryMic = destination.stream;
                return destination.stream;
            };
        });
        await page.locator('#classic-call-tab').click();
        await page.getByRole('button', { name: 'Join Voice', exact: true }).click();
    }
    await wait(async () => (await snapshot()).members.filter(member => member.isVoiceActive).length === 2, 'voice members did not join');
    await wait(async () => await viewer.evaluate(() => window.recoveryPeers.some(peer => peer.connectionState === 'connected')), 'initial voice peer not connected');
    await viewer.getByRole('button', { name: 'Mute', exact: true }).click();
    await offline(viewer); await online(viewer);
    await wait(async () => (await snapshot()).members.filter(member => member.isVoiceActive).length === 2, 'voice did not silently rejoin');
    await wait(async () => await viewer.evaluate(() => window.recoveryPeers.some(peer => peer.connectionState === 'connected')), 'restored voice peer not connected');
    assert.equal(await viewer.evaluate(() => window.microphoneRequests), 1);
    assert.equal(await viewer.evaluate(() => window.recoveryMic.getAudioTracks()[0].readyState), 'live');
    assert.equal(await viewer.evaluate(() => window.recoveryMic.getAudioTracks()[0].enabled), false);
    assert.ok((await snapshot()).members.some(member => member.isVoiceActive && member.isMuted));
    for (const page of [host, viewer]) await page.locator('.room-voice-group').getByRole('button', { name: 'Leave', exact: true }).click();
    console.log('PASS voice reuses the live muted microphone, renegotiates real peers and requests no new capture');

    await host.evaluate(() => {
        window.displayRequests = 0;
        navigator.mediaDevices.getDisplayMedia = async () => {
            window.displayRequests++;
            const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 180;
            canvas.getContext('2d').fillRect(0, 0, 320, 180);
            window.recoveryScreen = canvas.captureStream(5); return window.recoveryScreen;
        };
        window.recoveryWrites = [];
    });
    await host.getByRole('button', { name: 'Share Screen (Beta)', exact: true }).click();
    await host.getByRole('button', { name: 'Stop sharing', exact: true }).waitFor();
    await offline(host); await online(host);
    assert.equal(await host.evaluate(() => window.recoveryScreen.getVideoTracks()[0].readyState), 'ended');
    assert.equal(await host.evaluate(() => window.displayRequests), 1);
    assert.equal(await host.getByRole('button', { name: 'Stop sharing', exact: true }).count(), 0);
    await host.getByText('Screen sharing was interrupted. Start sharing again when ready.', { exact: true }).waitFor();
    assert.deepEqual(await host.evaluate(() => window.recoveryWrites), []);
    console.log('PASS controller recovery keeps the room paused; interrupted screen capture stops and requires an explicit restart');
};
