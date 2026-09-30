import test from 'node:test';
import assert from 'node:assert/strict';
import { detectVideoSource } from '../src/utils/videoSources.js';

test('recognizes direct media, manifests, embeds, and extensionless CDN URLs', () => {
    assert.equal(detectVideoSource('https://cdn.example/movie.mp4?token=123').kind, 'direct');
    assert.equal(detectVideoSource('https://cdn.example/live.m3u8?token=123').kind, 'hls');
    assert.equal(detectVideoSource('https://cdn.example/movie.mpd').kind, 'dash');
    assert.equal(detectVideoSource('https://cdn.example/signed/abc').kind, 'unknown');
    assert.equal(detectVideoSource('https://vimeo.com/1234').kind, 'embed');
    assert.equal(detectVideoSource('file:///movie.mp4').kind, 'invalid');
});

test('normalizes common YouTube URLs without losing the start time', () => {
    for (const url of [
        'https://youtu.be/dQw4w9WgXcQ?t=42',
        'https://www.youtube.com/embed/dQw4w9WgXcQ?start=42',
        'https://youtube.com/watch?v=dQw4w9WgXcQ&t=42&list=abc',
    ]) {
        const source = detectVideoSource(url);
        assert.equal(source.kind, 'youtube');
        assert.equal(source.url, 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42');
    }
});
