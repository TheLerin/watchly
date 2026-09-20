// Keep a single room-entry operation alive, including time spent connecting.
export function createRoomRequester(socket, { schedule = setTimeout, cancelTimer = clearTimeout, connectTimeoutMs = 90000, ackTimeoutMs = 15000 } = {}) {
    let pending = null;
    const request = (event, payload) => {
        const key = JSON.stringify([event, payload]);
        if (pending) return pending.key === key ? pending.promise : Promise.reject(new Error('A room request is already in progress.'));
        let resolvePromise;
        let rejectPromise;
        const promise = new Promise((resolve, reject) => { resolvePromise = resolve; rejectPromise = reject; });
        let timer;
        let settled = false;
        const finish = (error, value) => {
            if (settled) return;
            settled = true;
            cancelTimer(timer);
            socket.off('connect', send);
            socket.io.off('reconnect_failed', failed);
            pending = null;
            if (error) rejectPromise(error);
            else resolvePromise(value);
        };
        const failed = () => finish(new Error('Could not connect to the room server. Please try again.'));
        const send = () => {
            cancelTimer(timer);
            timer = schedule(() => finish(new Error('The room request timed out. Please try again.')), ackTimeoutMs);
            socket.timeout(ackTimeoutMs).emit(event, payload, (error, response) => {
                if (error) return finish(new Error('The room request timed out. Please try again.'));
                if (!response?.ok) {
                    const failure = new Error(response?.error?.message || 'Could not enter the room.');
                    failure.code = response?.error?.code;
                    failure.retryable = Boolean(response?.error?.retryable);
                    return finish(failure);
                }
                finish(null, response);
            });
        };
        pending = { key, promise, cancel: () => finish(new Error('Room request canceled.')) };
        if (socket.connected) send();
        else {
            timer = schedule(failed, connectTimeoutMs);
            socket.once('connect', send);
            socket.io.once('reconnect_failed', failed);
            socket.connect();
        }
        return promise;
    };
    return { request, isPending: () => Boolean(pending), cancel: () => pending?.cancel() };
}
