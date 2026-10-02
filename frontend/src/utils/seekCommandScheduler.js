// Native controls can emit many seeking events during a drag. Apply those
// locally through the browser, but keep network traffic below the room's
// ten-command-per-second limit, with the latest target sent on the trailing edge.
export function createSeekCommandScheduler({ send, now = () => performance.now(), schedule = setTimeout, cancel = clearTimeout, intervalMs = 200 }) {
    let lastSentAt = -Infinity;
    let pending;
    let timer;
    const flush = () => {
        cancel(timer);
        timer = undefined;
        if (!pending) return;
        const request = pending;
        pending = undefined;
        lastSentAt = now();
        send(request.positionSec, request.options);
    };
    return {
        enqueue(positionSec, options) {
            pending = { positionSec, options };
            const remaining = intervalMs - (now() - lastSentAt);
            if (remaining <= 0) flush();
            else if (timer === undefined) timer = schedule(flush, remaining);
        },
        flush,
        cancel() {
            cancel(timer);
            timer = undefined;
            pending = undefined;
            lastSentAt = -Infinity;
        },
    };
}
