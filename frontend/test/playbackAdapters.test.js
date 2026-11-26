import test from 'node:test';
import assert from 'node:assert/strict';
import { createPlaybackAdapter, correctPlayback } from '../src/utils/playbackAdapters.js';
import { expectedRemotePosition, remoteCanonical, canonicalPosition, transitionRemote } from '../../shared/playback-core.mjs';
import { rewriteGDriveUrl, resolveArchiveUrl } from '../src/utils/sourceResolvers.js';
import { observePwaUpdates } from '../src/utils/pwaUpdate.js';

test('remote and local projections share rate-aware canonical time through play/pause/seek', () => {
    let remote = { isPlaying: true, playedSeconds: 10, updatedAt: 1000, rate: 1.5, stateVersion: 2, sourceId: 'one', sourceEpoch: 1 };
    assert.equal(expectedRemotePosition(remote, 5000), 16);
    assert.equal(canonicalPosition(remoteCanonical(remote), 5000), 16);
    remote = transitionRemote(remote, { action: 'PAUSE', positionSec: 16, now: 5000 }); assert.equal(expectedRemotePosition(remote, 20000), 16);
    remote = transitionRemote(remote, { action: 'SEEK', positionSec: 30, now: 6000 }); assert.equal(expectedRemotePosition(remote, 10000), 30);
    remote = transitionRemote(remote, { action: 'PLAY', now: 10000 }); assert.equal(expectedRemotePosition(remote, 12000), 33);
});
test('HTML media smooths small drift and embeds expose only capabilities they implement', () => {
    const element = { currentTime: 10, playbackRate: 1 }, native = createPlaybackAdapter({ element });
    correctPlayback(native, 10.4, { baseRate: 1.5 }); assert.equal(element.playbackRate, 1.545);
    correctPlayback(native, 20); assert.equal(element.currentTime, 20);
    let sought; const embed = createPlaybackAdapter({ kind: 'embed', player: { getCurrentTime: () => 2, seekTo: value => { sought = value; } } });
    assert.equal(embed.capabilities.rate, false); assert.equal(embed.rate(1.03), false); correctPlayback(embed, 10); assert.equal(sought, 10);
    const youtube = createPlaybackAdapter({ kind: 'youtube', player: { setPlaybackRate() {}, getAvailablePlaybackRates: () => [1, 1.5] } });
    assert.equal(youtube.rate(1.03), false); assert.equal(youtube.rate(1.5), true);
});
test('source resolution validates hostnames and encodes archive filenames without leaking signed URLs to logs', async () => {
    assert.equal(rewriteGDriveUrl('https://drive.google.com.evil.test/file/d/abcdefghi'), 'https://drive.google.com.evil.test/file/d/abcdefghi');
    assert.match(rewriteGDriveUrl('https://drive.google.com/file/d/abcdefghi', { getItem: () => '{"roomId":"ABCDEFG"}' }), /id=abcdefghi&roomId=ABCDEFG$/);
    assert.equal(await resolveArchiveUrl('https://archive.org/details/sample', { fetcher: async () => Response.json({ files: [{ name: 'a movie.mp4', format: 'MPEG4' }] }) }), 'https://archive.org/download/sample/a%20movie.mp4');
});
test('waiting PWA updates notify once without skipping waiting or reloading an active session', async () => {
    let ready = 0, update;
    const registration = { waiting: {}, installing: null, addEventListener(name, fn) { update = fn; }, removeEventListener() {} };
    const stop = observePwaUpdates({ serviceWorker: { controller: {}, getRegistration: async () => registration }, onReady: () => ready++ });
    await Promise.resolve(); assert.equal(ready, 1); update(); stop(); assert.equal(ready, 1);
});
