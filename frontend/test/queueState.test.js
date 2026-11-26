import test from 'node:test';
import assert from 'node:assert/strict';
import { applyQueueDelta } from '../src/utils/queueState.js';
test('queue deltas converge, ignore duplicates and demand snapshots for gaps and unknown items', () => {
    let state = { queue: [], revision: 0 };
    state = applyQueueDelta(state, { baseRevision: 0, revision: 1, op: 'add', item: { id: 'one' }, index: 0 });
    state = applyQueueDelta(state, { baseRevision: 1, revision: 2, op: 'add', item: { id: 'two' }, index: 1 });
    state = applyQueueDelta(state, { baseRevision: 2, revision: 3, op: 'move', itemId: 'two', index: 0 });
    assert.deepEqual(state.queue.map(item => item.id), ['two', 'one']);
    assert.equal(applyQueueDelta(state, { baseRevision: 2, revision: 3 }), state);
    assert.equal(applyQueueDelta(state, { baseRevision: 4, revision: 5 }).needsSnapshot, true);
    assert.equal(applyQueueDelta(state, { baseRevision: 3, revision: 4, op: 'remove', itemId: 'absent' }).needsSnapshot, true);
    state = applyQueueDelta(state, { baseRevision: 3, revision: 4, op: 'remove', itemId: 'one' });
    assert.deepEqual(state.queue.map(item => item.id), ['two']);
});
