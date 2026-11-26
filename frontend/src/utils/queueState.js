export function applyQueueDelta(state, delta) {
    if (!delta || !Number.isSafeInteger(delta.revision) || !Number.isSafeInteger(delta.baseRevision)) return { ...state, needsSnapshot: true };
    if (delta.revision <= state.revision) return state;
    if (delta.baseRevision !== state.revision || delta.revision !== state.revision + 1) return { ...state, needsSnapshot: true };
    const queue = [...state.queue];
    if (delta.op === 'add' && delta.item?.id && !queue.some(item => item.id === delta.item.id) && Number.isSafeInteger(delta.index) && delta.index >= 0 && delta.index <= queue.length) queue.splice(delta.index, 0, delta.item);
    else if (delta.op === 'remove') {
        const index = queue.findIndex(item => item.id === delta.itemId);
        if (index < 0) return { ...state, needsSnapshot: true };
        queue.splice(index, 1);
    } else if (delta.op === 'move') {
        const index = queue.findIndex(item => item.id === delta.itemId);
        if (index < 0 || !Number.isSafeInteger(delta.index) || delta.index < 0 || delta.index >= queue.length) return { ...state, needsSnapshot: true };
        const [item] = queue.splice(index, 1); queue.splice(delta.index, 0, item);
    } else return { ...state, needsSnapshot: true };
    return { queue, revision: delta.revision, needsSnapshot: false };
}
