import test from 'node:test';
import assert from 'node:assert/strict';
import { getRemuxEligibility } from '../src/utils/localMediaRemux.js';

const inspection = {
    videoTracks: [{
        codecLabel: 'H.264 / AVC',
        codecParameter: 'avc1.640028',
        support: 'supported',
    }],
};

const aac = {
    codecLabel: 'AAC',
    codecParameter: 'mp4a.40.2',
    support: 'supported',
};

test('copy-only remux eligibility requires MediaSource support for the exact codec pair', () => {
    const supportedApi = { isTypeSupported: value => value === 'video/mp4; codecs="avc1.640028, mp4a.40.2"' };
    const result = getRemuxEligibility(inspection, aac, supportedApi);
    assert.equal(result.supported, true);
    assert.equal(result.mimeType, 'video/mp4; codecs="avc1.640028, mp4a.40.2"');
});

test('remux eligibility rejects unsupported audio and uncertain codec identifiers truthfully', () => {
    const permissiveApi = { isTypeSupported: () => true };
    assert.equal(getRemuxEligibility(inspection, { ...aac, support: 'unsupported' }, permissiveApi).supported, false);
    assert.match(getRemuxEligibility(inspection, { ...aac, codecParameter: '' }, permissiveApi).reason, /codec identifiers/);
    assert.match(getRemuxEligibility(inspection, aac, { isTypeSupported: () => false }).reason, /cannot play a remuxed/);
});

