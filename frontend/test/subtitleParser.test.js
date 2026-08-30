import test from 'node:test';
import assert from 'node:assert/strict';
import { assToWebVtt, inferSubtitleLanguage, normalizeLanguageCode, srtToWebVtt } from '../src/utils/subtitleParser.js';

test('SRT is converted to valid WebVTT with multiline cues and millisecond timestamps', () => {
    const result = srtToWebVtt(`1\r\n00:00:01,250 --> 00:00:03,500\r\nHello\r\nworld\r\n\r\n2\r\n00:01:04.020 --> 00:01:05.100\r\n<b>Again</b>`);
    assert.match(result, /^WEBVTT/);
    assert.match(result, /00:00:01\.250 --> 00:00:03\.500\nHello\nworld/);
    assert.match(result, /00:01:04\.020 --> 00:01:05\.100\n<b>Again<\/b>/);
});

test('SRT conversion ignores malformed blocks and rejects files without valid cues', () => {
    assert.throws(() => srtToWebVtt('not subtitles'), /No readable subtitle cues/);
    const result = srtToWebVtt('garbage\n\n1\n00:00:00,000 --> 00:00:01,000\nValid');
    assert.match(result, /Valid/);
});

test('ASS dialogue becomes basic WebVTT text without override commands', () => {
    const ass = `[Script Info]\nTitle: Test\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.20,0:00:03.45,Default,,0,0,0,,{\\an8}First line\\NSecond line`;
    const result = assToWebVtt(ass);
    assert.match(result, /00:00:01\.200 --> 00:00:03\.450/);
    assert.match(result, /First line\nSecond line/);
    assert.doesNotMatch(result, /\\an8/);
    assert.match(result, /Advanced styling/);
});

test('subtitle language aliases normalize to useful BCP-47 codes', () => {
    assert.equal(normalizeLanguageCode('eng'), 'en');
    assert.equal(normalizeLanguageCode('mal'), 'ml');
    assert.equal(inferSubtitleLanguage('movie.Malayalam.srt'), 'ml');
    assert.equal(inferSubtitleLanguage('feature_hi.vtt'), 'hi');
});
