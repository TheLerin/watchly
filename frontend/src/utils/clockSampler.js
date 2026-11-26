const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] || 0;
export function createClockSampler({ request, now, connected, onResult, wallTime = Date.now }) {
    let generation = 0, pending = null;
    return {
        cancel() { generation++; pending = null; },
        sample(count = 7) {
            if (!connected()) return Promise.resolve(null);
            if (pending) return pending;
            const token = generation, samples = [];
            const operation = (async () => {
                for (let index = 0; index < Math.min(7, Math.max(1, count)); index++) {
                    if (token !== generation || !connected()) return null;
                    const sent = now(); let response;
                    try { response = await request(sent); } catch { response = null; }
                    const received = now();
                    if (token !== generation || !connected()) return null;
                    if (Number.isFinite(response?.serverTimeMs)) samples.push({ rtt: received - sent, offset: response.serverTimeMs - (sent + received) / 2 });
                }
                if (!samples.length || token !== generation) return null;
                const best = samples.sort((a, b) => a.rtt - b.rtt).slice(0, 5);
                const result = { offsetMs: median(best.map(value => value.offset)), rttMs: median(best.map(value => value.rtt)), sampledAt: wallTime() };
                onResult(result); return result;
            })();
            pending = operation;
            operation.finally(() => { if (pending === operation) pending = null; }).catch(() => {});
            return operation;
        },
    };
}
