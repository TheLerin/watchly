import { client } from './client.mjs';
const base = process.env.WATCHLY_TEST_BASE || 'http://127.0.0.1:8787';
if (!['localhost', '127.0.0.1', '[::1]'].includes(new URL(base).hostname)) throw new Error('Load tests are restricted to localhost.');
const roomCount = Math.min(20, Math.max(1, Number(process.env.ROOMS) || 5));
const participants = Math.min(10, Math.max(2, Number(process.env.PARTICIPANTS) || 3));
const sockets = [], latencies = [];
try {
  for (let index = 0; index < roomCount; index++) {
    const code = crypto.randomUUID().replaceAll('-', '').slice(0, 7).toUpperCase();
    for (let member = 0; member < participants; member++) {
      const connection = await client(base, code); sockets.push(connection);
      const start = performance.now();
      const result = await connection.send(member ? 'room:join' : 'room:create', { roomId: code, nickname: `Member ${member}`, protocolVersion: 2 });
      if (!result.ok) throw new Error(JSON.stringify(result.error)); latencies.push(performance.now() - start);
    }
  }
  await Promise.all(sockets.map(value => value.send('room:snapshot')));
  latencies.sort((a, b) => a - b);
  console.log(JSON.stringify({ localOnly: true, rooms: roomCount, connections: sockets.length, entryP50Ms: latencies[Math.floor(latencies.length * 0.5)], entryP95Ms: latencies[Math.floor(latencies.length * 0.95)] }, null, 2));
} finally { sockets.forEach(value => value.close()); }
