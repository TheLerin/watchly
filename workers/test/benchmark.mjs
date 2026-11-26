// SQLite/domain simulation only: no sockets, workerd, network, media or provider billing measurements.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { environment, connect } from './harness.mjs';

const results = [];
const percentile = (values, fraction) => values.sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * fraction))] || 0;
for (const participants of [10, 50, 100, 250, 500]) {
  const setup = environment(), groups = [], clients = [];
  const started = performance.now(), cpu = process.cpuUsage();
  for (let roomIndex = 0; roomIndex < participants / 10; roomIndex++) {
    const code = `R${String(roomIndex).padStart(6, '0')}`, item = await setup.room(code); item.code = code;
    const group = { code, item, clients: [] }; groups.push(group);
    for (let member = 0; member < 10; member++) {
      const client = await connect(item); group.clients.push(client); clients.push(client);
      item.object.io.sockets.sockets.get(client.id).data.queueDeltas = true;
      assert.equal((await client.send(member ? 'room:join' : 'room:create', { roomId: code, nickname: `Member ${member}`, protocolVersion: 2 })).ok, true);
    }
  }
  const writes = () => groups.reduce((sum, group) => sum + group.item.object.store.rowsWritten, 0);
  const baselineWrites = writes(), latencies = [];
  for (let repeat = 0; repeat < 5; repeat++) await Promise.all(clients.map(async client => {
    const start = performance.now(); await client.send('network_ping'); await client.send('clock:ping'); latencies.push(performance.now() - start);
  }));
  await Promise.all(clients.map(client => client.send('room:snapshot')));
  const readOnlyWrites = writes() - baselineWrites;
  for (const group of groups) for (const client of group.clients.slice(1)) await client.send('change_video', { roomId: group.code, url: 'https://example.test/forbidden.mp4' });
  const rejectedWrites = writes() - baselineWrites - readOnlyWrites;
  assert.equal(readOnlyWrites, 0); assert.equal(rejectedWrites, 0);
  let mutationRows = 0;
  for (const group of groups) {
    const beforeMutation = group.item.object.store.rowsWritten;
    for (let index = 0; index < 10; index++) await group.clients[0].send('add_to_queue', { roomId: group.code, url: `https://example.test/${index}.mp4` });
    for (const [index, client] of group.clients.entries()) await client.send('send_message', { roomId: group.code, message: { id: `message-${index}`, text: 'Simulation message' } });
    mutationRows += group.item.object.store.rowsWritten - beforeMutation;
    await setup.evict(group.code);
    const snapshot = (await group.clients[0].send('room:snapshot')).snapshot;
    assert.equal(snapshot.queue.length, 10); assert.equal(snapshot.chatHistory.length, 10); assert.equal(snapshot.members.length, 10);
  }
  const usage = process.cpuUsage(cpu);
  results.push({ participants, rooms: groups.length, elapsedMs: performance.now() - started, twoPingEventsP50Ms: percentile(latencies, 0.5), twoPingEventsP95Ms: percentile(latencies, 0.95), twoPingEventsP99Ms: percentile(latencies, 0.99), cpuMs: (usage.user + usage.system) / 1000, readOnlyEvents: participants * 11, readOnlyLogicalRowsWritten: readOnlyWrites, rejectedEvents: participants * 0.9, rejectedLogicalRowsWritten: rejectedWrites, mutationLogicalRowsWritten: mutationRows, restoredRecordBytes: groups.reduce((sum, group) => sum + group.item.object.store.bytes(), 0), rssBytes: process.memoryUsage().rss });
  console.log(JSON.stringify(results.at(-1)));
}
await mkdir('docs', { recursive: true });
await writeFile('docs/local-benchmark.json', JSON.stringify({ recordedAt: new Date().toISOString(), runtime: process.version, simulationOnly: true, limitations: 'In-process SQLite lifecycle harness. Latency includes Node scheduling for two ping events, not network latency or playback drift. Logical record writes omit platform index billing. RSS is process-wide and cases share a process; it is not per-room memory. Rate guard is tested separately; this bypasses ingress.', results }, null, 2) + '\n');
