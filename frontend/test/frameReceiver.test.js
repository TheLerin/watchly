import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrameReceiver } from '../src/utils/frameReceiver.js';

test('large snapshots are assembled in order, acknowledged, and interrupted transfers expire', () => {
    let failed = 0, expire; const receipts = [];
    const receiver = createFrameReceiver({ receipt: id => receipts.push(id), fail: () => failed++, schedule: fn => { expire = fn; return 1; }, cancel() {} });
    const raw = JSON.stringify({ v: 1, event: 'snapshot', args: ['x'.repeat(20000)] });
    assert.equal(receiver.accept({ v: 1, type: 'chunk', id: 'a', index: 0, count: 2, data: raw.slice(0, 12000), deliveryId: 1 }), null);
    const result = receiver.accept({ v: 1, type: 'chunk', id: 'a', index: 1, count: 2, data: raw.slice(12000), deliveryId: 2 });
    assert.equal(result.args[0].length, 20000); assert.deepEqual(receipts, [1, 2]);
    receiver.accept({ v: 1, type: 'chunk', id: 'b', index: 0, count: 2, data: '{}' }); expire(); assert.equal(failed, 1);
    receiver.accept({ v: 1, type: 'chunk', id: 'c', index: 1, count: 2, data: '{}' }); assert.equal(failed, 2);
});
