import test from 'node:test';
import assert from 'node:assert/strict';
import { extractMatroskaSubtitle, inspectMatroskaSubtitleTracks } from '../src/utils/matroskaSubtitles.js';

const concat = (...parts) => {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
        output.set(part, offset);
        offset += part.length;
    }
    return output;
};

const id = hex => Uint8Array.from(hex.match(/../g).map(value => Number.parseInt(value, 16)));

const sizeVint = size => {
    for (let length = 1; length <= 8; length += 1) {
        const limit = 2 ** (7 * length) - 1;
        if (size < limit) {
            let encoded = BigInt(size) | (1n << BigInt(7 * length));
            const bytes = new Uint8Array(length);
            for (let index = length - 1; index >= 0; index -= 1) {
                bytes[index] = Number(encoded & 0xffn);
                encoded >>= 8n;
            }
            return bytes;
        }
    }
    throw new Error('fixture element is too large');
};

const element = (hexId, payload = new Uint8Array()) => concat(id(hexId), sizeVint(payload.length), payload);
const text = value => new TextEncoder().encode(value);
const uint = value => {
    const bytes = [];
    let remaining = value;
    do {
        bytes.unshift(remaining & 0xff);
        remaining = Math.floor(remaining / 256);
    } while (remaining);
    return Uint8Array.from(bytes);
};

const trackEntry = ({ number, codec, language, name, forced = false }) => element('AE', concat(
    element('D7', uint(number)),
    element('83', uint(17)),
    element('B9', uint(1)),
    element('88', uint(1)),
    element('55AA', uint(forced ? 1 : 0)),
    element('22B59C', text(language)),
    element('536E', text(name)),
    element('86', text(codec))
));

function fixture() {
    const assPacket = text('0,0,Default,,0,0,0,,{\\an8}Hello\\NMalayalam');
    const block = concat(Uint8Array.of(0x83, 0x03, 0xe8, 0x00), assPacket);
    const blockGroup = element('A0', concat(
        element('A1', block),
        element('9B', uint(2000))
    ));
    const tracks = element('1654AE6B', concat(
        trackEntry({ number: 3, codec: 'S_TEXT/ASS', language: 'mal', name: 'Malayalam' }),
        trackEntry({ number: 4, codec: 'S_HDMV/PGS', language: 'eng', name: 'English PGS', forced: true })
    ));
    const info = element('1549A966', element('2AD7B1', uint(1_000_000)));
    const cluster = element('1F43B675', concat(element('E7', uint(0)), blockGroup));
    const segment = element('18538067', concat(info, tracks, cluster));
    return new Blob([concat(element('1A45DFA3'), segment)], { type: 'video/x-matroska' });
}

test('Matroska inspection discovers text and image subtitle tracks without native textTracks', async () => {
    const tracks = await inspectMatroskaSubtitleTracks(fixture());
    assert.equal(tracks.length, 2);
    assert.deepEqual(tracks.map(track => track.label), ['Malayalam', 'English PGS']);
    assert.equal(tracks[0].format, 'ass');
    assert.equal(tracks[0].extractable, true);
    assert.equal(tracks[0].limited, true);
    assert.equal(tracks[1].format, 'pgs');
    assert.equal(tracks[1].support, 'unsupported');
    assert.equal(tracks[1].forced, true);
});

test('embedded Matroska ASS packets become safe basic WebVTT cues', async () => {
    const extracted = await extractMatroskaSubtitle(fixture(), 'mkv-subtitle:3');
    const vtt = await extracted.blob.text();
    assert.equal(extracted.cueCount, 1);
    assert.match(vtt, /00:00:01\.000 --> 00:00:03\.000/);
    assert.match(vtt, /Hello\nMalayalam/);
    assert.doesNotMatch(vtt, /\\an8/);
    assert.match(vtt, /Embedded ASS\/SSA converted/);
});

test('image-based embedded subtitles fail truthfully instead of pretending to render', async () => {
    await assert.rejects(() => extractMatroskaSubtitle(fixture(), 4), /image-based or unsupported/);
});

