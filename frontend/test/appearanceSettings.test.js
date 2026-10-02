import test from 'node:test';
import assert from 'node:assert/strict';
import { APPEARANCE_STORAGE_KEY, CINEMA_DEFAULTS, DEFAULT_APPEARANCE, architecturalLight, normalizeAppearance, readAppearance } from '../src/utils/appearanceSettings.js';

const storage = entries => ({ getItem: key => entries[key] ?? null });

test('legacy Cinema Luxe keeps its effective cinematic layout and migrates to dark UI + Luxe', () => {
    assert.deepEqual(readAppearance(storage({ 'watchly-theme': 'cinema-luxe', 'watchly-room-appearance': 'classic' })), DEFAULT_APPEARANCE);
});

test('legacy UI themes and Classic preferences retain their meaning', () => {
    for (const theme of ['light', 'light-glass', 'glass-light']) {
        const result = readAppearance(storage({ 'watchly-theme': theme, 'watchly-room-appearance': 'classic' }));
        assert.equal(result.uiTheme, 'glass-light');
        assert.equal(result.roomStyle, 'classic');
    }
    assert.equal(readAppearance(storage({ 'watchly-theme': 'dark-glass' })).uiTheme, 'glass-dark');
});

test('saved independent options and custom preset overrides take precedence over legacy keys', () => {
    const custom = { ...DEFAULT_APPEARANCE, uiTheme: 'glass-light', cinemaPreset: 'minimal', roomBrightness: 63, sofa: true, hideDelay: 'never' };
    assert.deepEqual(readAppearance(storage({ [APPEARANCE_STORAGE_KEY]: JSON.stringify(custom), 'watchly-theme': 'cinema-luxe' })), custom);
});

test('malformed or unavailable storage safely recovers existing preferences', () => {
    for (const invalid of ['{invalid', 'null', '[]', 'false']) {
        assert.equal(readAppearance(storage({ [APPEARANCE_STORAGE_KEY]: invalid, 'watchly-room-appearance': 'classic' })).roomStyle, 'classic');
    }
    assert.deepEqual(readAppearance({ getItem() { throw new Error('Unavailable'); } }), DEFAULT_APPEARANCE);
});

test('invalid controls cannot inject unsafe slider values, delays or boolean settings', () => {
    assert.equal(normalizeAppearance({ roomBrightness: -80 }).roomBrightness, 0);
    assert.equal(normalizeAppearance({ roomBrightness: 900 }).roomBrightness, 100);
    for (const invalid of [NaN, Infinity, '90']) assert.equal(normalizeAppearance({ roomBrightness: invalid }).roomBrightness, 35);
    const normalized = normalizeAppearance({ cinemaPreset: 'minimal', sofa: 'true', hideDelay: 0, unexpected: true });
    assert.equal(normalized.sofa, false);
    assert.equal(normalized.hideDelay, 3);
    assert.equal('unexpected' in normalized, false);
    assert.deepEqual(normalizeAppearance(null), DEFAULT_APPEARANCE);
});

test('preset defaults differ only in ambience; light intensity preserves the current Luxe default and stays bounded', () => {
    assert.equal(CINEMA_DEFAULTS.minimal.roomBrightness, 15);
    assert.equal(CINEMA_DEFAULTS.minimal.aisleLights, false);
    assert.equal(CINEMA_DEFAULTS.minimal.sofa, false);
    assert.equal(CINEMA_DEFAULTS.minimal.wallDetails, false);
    assert.equal(architecturalLight(35), 1);
    assert.equal(architecturalLight(0), 0.18);
    assert.equal(architecturalLight(100), 1.75);
    assert.ok(architecturalLight(20) < architecturalLight(50));
});
