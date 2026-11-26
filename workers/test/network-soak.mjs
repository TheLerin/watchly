import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { localServer } from './local-server.mjs';
import { client } from './client.mjs';

const seconds = Number(process.env.WATCHLY_NETWORK_SOAK_SECONDS ?? 60);
if (!Number.isInteger(seconds) || seconds < 10 || seconds > 28800) throw new Error('Set the soak duration between 10 and 28800 seconds.');
const server = await localServer();
const roomId = crypto.randomUUID().replaceAll('-', '').slice(0, 7).toUpperCase();
const entry = { roomId, protocolVersion: 2 };
const sockets = new Set();
const open = async () => {
  const socket = await client(server.base, roomId, { recordEvents: false });
  sockets.add(socket);
  return socket;
};
const close = socket => { socket.close(); sockets.delete(socket); };
const latencies = [];
let reconnects = 0, maxDriftSeconds = 0;
try {
  const host = await open();
  assert.ok((await host.send('room:create', { ...entry, nickname: 'Soak host' })).ok);
  let viewer = await open();
  let membership = await viewer.send('room:join', { ...entry, nickname: 'Soak viewer' });
  assert.ok(membership.ok);
  const memberId = membership.memberId;
  const source = 'https://example.test/soak.mp4';
  await host.send('change_video', { roomId, url: source });
  const started = performance.now();
  while (performance.now() - started < seconds * 1000) {
    const sampleAt = performance.now();
    const [a, b] = await Promise.all([host.send('room:snapshot'), viewer.send('room:snapshot')]);
    latencies.push(performance.now() - sampleAt);
    assert.equal(a.snapshot.members.length, 2);
    assert.equal(a.snapshot.videoState.url, source);
    assert.equal(b.snapshot.videoState.url, source);
    const drift = Math.abs(b.snapshot.videoState.playedSeconds - a.snapshot.videoState.playedSeconds);
    maxDriftSeconds = Math.max(maxDriftSeconds, drift);
    assert.ok(drift < 1, `Room state drift exceeded one second: ${drift}`);
    if (latencies.length % 5 === 0) {
      const oldProof = membership.resumeToken;
      close(viewer);
      viewer = await open();
      membership = await viewer.send('room:join', { ...entry, nickname: 'Soak viewer', memberId, resumeToken: oldProof });
      assert.equal(membership.memberId, memberId);
      assert.notEqual(membership.resumeToken, oldProof);
      reconnects++;
    }
    await delay(2000);
  }
  latencies.sort((a, b) => a - b);
  console.log(JSON.stringify({ localWorkerd: true, durationSeconds: Math.round((performance.now() - started) / 1000), snapshots: latencies.length * 2,
    reconnects, maxDriftSeconds, snapshotPairP95Ms: latencies[Math.floor(latencies.length * 0.95)], runnerRssBytes: process.memoryUsage().rss }));
} finally {
  for (const socket of sockets) close(socket);
  server.stop();
}
