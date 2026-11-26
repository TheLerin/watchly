// Separate lifecycle stress from network/runtime evidence: accelerated clock + a bounded real-time in-process run.
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { environment, connect } from './harness.mjs';
const wallStart = performance.now(), realNow = Date.now;
let clock = realNow(); Date.now = () => clock;
const setup = environment(), item = await setup.room(), clients = [];
const entry = { roomId: 'ABCDEFG', nickname: 'Host', protocolVersion: 2 };
try {
  for (let index = 0; index < 10; index++) { const client = await connect(item); clients.push(client); assert.equal((await client.send(index ? 'room:join' : 'room:create', { ...entry, nickname: `Soak ${index}` })).ok, true); }
  const host = clients[0]; await host.send('change_video', { roomId: entry.roomId, url: 'https://example.test/soak.mp4' });
  let anchor = clock, position = 0, reconstructions = 0, readOnlyEvents = 0, writesFromReads = 0;
  for (let tick = 1; tick <= 960; tick++) {
    clock += 30000;
    if (tick % 90 === 0) { position = tick * 2; anchor = clock; await host.send('seek_video', { roomId: entry.roomId, playedSeconds: position }); }
    if (tick % 30 === 0) { await setup.evict('ABCDEFG'); reconstructions++; }
    const before = item.object.store.rowsWritten;
    for (const client of clients) { await client.send('clock:ping'); readOnlyEvents++; }
    const snapshot = (await host.send('room:snapshot')).snapshot; readOnlyEvents++;
    assert.ok(Math.abs(snapshot.videoState.playedSeconds - (position + (clock - anchor) / 1000)) < 0.001);
    assert.equal(snapshot.members.length, 10);
    writesFromReads += item.object.store.rowsWritten - before;
    await item.object.alarm();
  }
  assert.equal(writesFromReads, 0);
  const logicalBase = clock, realBase = realNow();
  Date.now = () => logicalBase + realNow() - realBase;
  const seconds = Math.min(3600, Math.max(1, Number(process.env.WATCHLY_SOAK_SECONDS) || 60));
  const liveStart = performance.now(); let samples = 0;
  while (performance.now() - liveStart < seconds * 1000) {
    const snapshot = (await host.send('room:snapshot')).snapshot;
    assert.equal(snapshot.members.length, 10); samples++;
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  const result = { recordedAt: new Date().toISOString(), simulationOnly: true, acceleratedHours: 8, participants: 10, reconstructions, readOnlyEvents,
    readOnlyLogicalRowsWritten: writesFromReads, realTimeSeconds: Math.round((performance.now() - liveStart) / 1000), realTimeSamples: samples,
    totalWallMs: Math.round(performance.now() - wallStart), limitations: 'In-process Node/SQLite only. Accelerated clock is not an eight-hour wall-clock soak. No network, workerd, live video, provider billing or NAT coverage.' };
  await writeFile('docs/soak-results.json', JSON.stringify(result, null, 2) + '\n'); console.log(JSON.stringify(result));
} finally { Date.now = realNow; }
