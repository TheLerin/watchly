import test from 'node:test';
import assert from 'node:assert/strict';
import { readConsent, consentChoice, CONSENT_MAX_AGE } from '../src/utils/consent.js';
test('consent requires an explicit current decision; malformed, expired and future data never enable media', () => {
    const now = 1800000000000;
    for (const value of [null, '{broken', '{}', JSON.stringify({ version: 1, externalMedia: 'true', updatedAt: now }), JSON.stringify(consentChoice(true, now - CONSENT_MAX_AGE)), JSON.stringify(consentChoice(true, now + 1))]) assert.equal(readConsent({ getItem: () => value }, now), null);
    for (const allowed of [true, false]) assert.equal(readConsent({ getItem: () => JSON.stringify(consentChoice(allowed, now)) }, now).externalMedia, allowed);
    assert.equal(readConsent({ getItem() { throw new Error('blocked'); } }, now), null);
});
