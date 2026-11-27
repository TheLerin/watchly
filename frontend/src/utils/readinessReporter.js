// Layout changes can produce waiting/canplay in the same frame. Report sustained stalls,
// while recovery/file-selection announcements remain owned by the room session.
export function createReadinessReporter({ send, schedule = setTimeout, cancel = clearTimeout, delay = 250 }) {
    let pending, last = '';
    const clear = () => { cancel(pending); pending = undefined; };
    const report = (mediaId, status, reason) => {
        clear();
        const key = JSON.stringify([mediaId, status, status === 'READY' ? null : reason]);
        const publish = () => { pending = undefined; if (last !== key) { send(mediaId, status, reason); last = key; } };
        if (status === 'BUFFERING') pending = schedule(publish, delay);
        else publish();
    };
    return { report, reset() { clear(); last = ''; }, dispose: clear };
}
