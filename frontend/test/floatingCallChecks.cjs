const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async ({ a, b, floating, open, wait, decode, audio, evidence, artifacts }) => {
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const reveal = () => floating.hover({ position: { x: 10, y: 10 } });
    const click = async name => { await reveal(); await floating.getByRole('button', { name, exact: true }).click(); };
    const visible = async value => wait(async () => await floating.getAttribute('data-controls-visible') === String(value), `controls did not become ${value}`, 6000);
    const cameraA = b.locator('.call-camera-tile').filter({ hasText: 'Camera A' });
    await a.evaluate(() => { window.floatingBaseline = { room: window.testCallRoom, sid: window.testCallRoom.localParticipant.sid, camera: window.testCallRoom.localParticipant.getTrackPublication('camera').track.mediaStreamTrack, tokens: window.callTokenRequests }; });
    await wait(async () => await floating.locator('.call-camera-tile').count() === 1, 'remote-only float missing');
    assert.equal(await floating.locator('.call-camera-tile').filter({ hasText: 'Camera A' }).count(), 0);
    assert.equal(await floating.locator('header,.video-call-status,.video-call-actions,.call-device-settings').count(), 0);
    await wait(async () => { try { return (await decode(a, 'Camera B')).pixel[2] > 170; } catch { return false; } }, 'floating remote video not decoded');
    assert.equal(await cameraA.getAttribute('data-camera-on'), 'true');
    const frame = await floating.boundingBox(), video = await floating.locator('video').boundingBox();
    assert.ok(Math.abs(frame.width - video.width) < 5 && Math.abs(frame.height - video.height) < 5, 'video does not fill frame');
    await reveal(); await visible(true); await pause(2300); await visible(false); // Idle while still over video.
    await a.screenshot({ path: path.join(artifacts, 'floating-video-only.png') });
    await reveal(); await floating.getByRole('button', { name: 'Restore video panel', exact: true }).hover(); await pause(2300); await visible(true);
    await a.screenshot({ path: path.join(artifacts, 'floating-video-controls.png') });
    await a.mouse.move(1, 1); await visible(false);
    await floating.getByRole('button', { name: 'Unmute microphone', exact: true }).focus(); await a.keyboard.press('Tab'); await visible(true); await pause(2300); await visible(true);
    await a.evaluate(() => document.activeElement.blur()); await visible(false);
    await click('Unmute microphone'); await wait(async () => (await audio(b)).rms > .01, 'floating unmute failed');
    await click('Mute microphone'); await wait(async () => (await audio(b)).rms < .003, 'floating mute failed');
    await click('Turn camera off'); await cameraA.locator('.call-camera-fallback').waitFor();
    assert.equal(await floating.locator('.call-camera-tile').count(), 1); // Remote stays visible with own camera off.
    await click('Turn camera on'); await wait(async () => { try { return (await decode(b, 'Camera A')).pixel[0] > 170; } catch { return false; } }, 'floating camera enable failed');
    const afterControls = await floating.boundingBox(); assert.equal(afterControls.x, frame.x); assert.equal(afterControls.y, frame.y);
    await click('Turn camera off'); await a.evaluate(() => window.denyCamera = true); await click('Turn camera on');
    await floating.getByRole('alert').filter({ hasText: /Camera access blocked/ }).waitFor();
    await a.evaluate(() => window.denyCamera = false); await click('Turn camera on'); await cameraA.locator('video').waitFor();
    await open(b, 'Video'); await b.getByRole('button', { name: 'Turn camera off', exact: true }).click();
    await floating.locator('.call-camera-fallback').waitFor(); assert.match(await floating.locator('.call-camera-fallback').innerText(), /Camera B/);
    await b.getByRole('button', { name: 'Turn camera on', exact: true }).click(); await floating.locator('video').waitFor();
    await b.getByRole('button', { name: 'Leave call', exact: true }).click(); await floating.getByText('Waiting for others…', { exact: true }).waitFor();
    assert.equal(await floating.locator('.call-camera-tile').count(), 0);
    assert.equal(await a.evaluate(() => window.testCallRoom.localParticipant.isCameraEnabled), true);
    await b.getByRole('button', { name: 'Join video', exact: true }).click(); await b.locator('.video-call-content[data-camera-on="true"]').waitFor();
    await b.getByRole('button', { name: 'Unmute microphone', exact: true }).click(); await floating.locator('video').waitFor();
    await a.setViewportSize({ width: 390, height: 844 }); await a.mouse.move(1, 1); await visible(false);
    const tap = async () => { const box = await floating.boundingBox(); await a.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2); };
    await tap(); await visible(true); await tap(); await visible(false); await tap(); await visible(true); await pause(3300); await visible(false);
    await a.screenshot({ path: path.join(artifacts, 'floating-video-touch.png') });
    await a.setViewportSize({ width: 1366, height: 768 });
    assert.equal(await a.evaluate(() => window.testCallRoom === window.floatingBaseline.room && window.testCallRoom.localParticipant.sid === window.floatingBaseline.sid && window.callTokenRequests === window.floatingBaseline.tokens), true);
    evidence.checks.push('Floating video fills frame with remote only; own camera keeps transmitting; zero-peer waiting, remote camera-off avatar, real mic/camera toggles, desktop idle/hover hold/leave, touch toggle/3s hide pass');
};
