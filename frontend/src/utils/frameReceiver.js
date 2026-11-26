// Large snapshots are assembled within a fixed memory bound; an interrupted transfer must recover by reconnecting.
export function createFrameReceiver({ receipt, fail, schedule = setTimeout, cancel = clearTimeout }) {
    let transfer, timer;
    const reset = () => { cancel(timer); timer = undefined; transfer = undefined; };
    return {
        reset,
        accept(frame) {
            if (Number.isSafeInteger(frame.deliveryId)) receipt(frame.deliveryId);
            if (frame.type !== 'chunk') return frame;
            if (typeof frame.id !== 'string' || typeof frame.data !== 'string' || frame.data.length > 12000 || !Number.isInteger(frame.index) || !Number.isInteger(frame.count) || frame.count < 1 || frame.count > 350) { reset(); fail(); return null; }
            if (!transfer) {
                if (frame.index !== 0) { fail(); return null; }
                transfer = { id: frame.id, count: frame.count, parts: [], bytes: 0 };
                timer = schedule(() => { reset(); fail(); }, 10000);
            }
            if (transfer.id !== frame.id || transfer.count !== frame.count || transfer.parts.length !== frame.index) { reset(); fail(); return null; }
            transfer.bytes += new TextEncoder().encode(frame.data).length;
            if (transfer.bytes > 4 * 1024 * 1024) { reset(); fail(); return null; }
            transfer.parts.push(frame.data);
            if (transfer.parts.length !== transfer.count) return null;
            const raw = transfer.parts.join(''); reset();
            try { const value = JSON.parse(raw); if (value.v !== 1 || value.type === 'chunk') throw new Error(); return value; }
            catch { fail(); return null; }
        },
    };
}
