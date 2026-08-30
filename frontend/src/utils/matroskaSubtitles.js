import { languageDisplayName, normalizeLanguageCode, subtitleCuesToWebVtt } from './subtitleParser.js';

// Mediabunny currently exposes Matroska video/audio input tracks, but not
// subtitle tracks. This intentionally small EBML reader fills only that gap.
// It reads element headers with Blob.slice(), skips movie packets by offset,
// and scans subtitle payloads only when a user selects an embedded track.

const IDS = {
    SEGMENT: 0x18538067,
    INFO: 0x1549a966,
    TIMESTAMP_SCALE: 0x2ad7b1,
    DURATION: 0x4489,
    TRACKS: 0x1654ae6b,
    TRACK_ENTRY: 0xae,
    TRACK_NUMBER: 0xd7,
    TRACK_UID: 0x73c5,
    TRACK_TYPE: 0x83,
    FLAG_ENABLED: 0xb9,
    FLAG_DEFAULT: 0x88,
    FLAG_FORCED: 0x55aa,
    DEFAULT_DURATION: 0x23e383,
    NAME: 0x536e,
    LANGUAGE: 0x22b59c,
    LANGUAGE_IETF: 0x22b59d,
    CODEC_ID: 0x86,
    CODEC_PRIVATE: 0x63a2,
    CLUSTER: 0x1f43b675,
    CLUSTER_TIMESTAMP: 0xe7,
    SIMPLE_BLOCK: 0xa3,
    BLOCK_GROUP: 0xa0,
    BLOCK: 0xa1,
    BLOCK_DURATION: 0x9b,
};

const DEFAULT_TIMECODE_SCALE = 1_000_000;
const MAX_STRING_BYTES = 256 * 1024;
const MAX_CUE_BYTES = 4 * 1024 * 1024;
const MAX_CUES = 200_000;
const metadataCache = new WeakMap();
const textDecoder = new TextDecoder('utf-8', { fatal: false });

const abortError = () => {
    if (typeof DOMException !== 'undefined') return new DOMException('Subtitle extraction was canceled.', 'AbortError');
    const error = new Error('Subtitle extraction was canceled.');
    error.name = 'AbortError';
    return error;
};

const throwIfAborted = signal => {
    if (signal?.aborted) throw abortError();
};

class BlobReader {
    constructor(blob, windowSize = 32 * 1024) {
        this.blob = blob;
        this.windowSize = windowSize;
        this.cacheStart = -1;
        this.cache = new Uint8Array();
    }

    async read(offset, length) {
        const start = Math.max(0, Math.floor(offset));
        const wanted = Math.max(0, Math.min(Math.floor(length), this.blob.size - start));
        if (!wanted) return new Uint8Array();
        const cacheEnd = this.cacheStart + this.cache.byteLength;
        if (start >= this.cacheStart && start + wanted <= cacheEnd) {
            return this.cache.subarray(start - this.cacheStart, start - this.cacheStart + wanted);
        }
        const fetchLength = Math.min(this.blob.size - start, Math.max(wanted, this.windowSize));
        this.cacheStart = start;
        this.cache = new Uint8Array(await this.blob.slice(start, start + fetchLength).arrayBuffer());
        return this.cache.subarray(0, wanted);
    }
}

function decodeVint(bytes, offset, preserveMarker) {
    const first = bytes[offset];
    if (!first) return null;
    let length = 1;
    let marker = 0x80;
    while (length <= 8 && !(first & marker)) {
        length += 1;
        marker >>= 1;
    }
    if (length > 8 || offset + length > bytes.length) return null;
    let value = BigInt(preserveMarker ? first : first & (marker - 1));
    for (let index = 1; index < length; index += 1) value = (value << 8n) | BigInt(bytes[offset + index]);
    const valueBits = BigInt(7 * length);
    const unknown = !preserveMarker && value === (1n << valueBits) - 1n;
    return { length, value, unknown };
}

async function readElementHeader(reader, offset, limit) {
    if (offset >= limit) return null;
    const bytes = await reader.read(offset, Math.min(16, limit - offset));
    const id = decodeVint(bytes, 0, true);
    if (!id) return null;
    const size = decodeVint(bytes, id.length, false);
    if (!size) return null;
    const dataStart = offset + id.length + size.length;
    if (dataStart > limit) return null;
    const numericSize = size.unknown
        ? limit - dataStart
        : size.value > BigInt(Number.MAX_SAFE_INTEGER)
            ? limit - dataStart
            : Number(size.value);
    const dataEnd = Math.min(limit, dataStart + numericSize);
    return {
        id: Number(id.value),
        start: offset,
        dataStart,
        dataEnd,
        size: Math.max(0, dataEnd - dataStart),
        unknownSize: size.unknown,
    };
}

async function readUnsigned(reader, element) {
    if (!element || element.size < 1 || element.size > 8) return null;
    const bytes = await reader.read(element.dataStart, element.size);
    let value = 0n;
    for (const byte of bytes) value = (value << 8n) | BigInt(byte);
    return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

async function readFloat(reader, element) {
    if (!element || ![4, 8].includes(element.size)) return null;
    const bytes = await reader.read(element.dataStart, element.size);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    return element.size === 4 ? view.getFloat32(0, false) : view.getFloat64(0, false);
}

async function readText(reader, element, maxBytes = MAX_STRING_BYTES) {
    if (!element || element.size > maxBytes) return '';
    const bytes = await reader.read(element.dataStart, element.size);
    return textDecoder.decode(bytes).replace(/\0+$/g, '').trim();
}

async function findSegment(reader) {
    let offset = 0;
    while (offset < reader.blob.size) {
        const element = await readElementHeader(reader, offset, reader.blob.size);
        if (!element) break;
        if (element.id === IDS.SEGMENT) return element;
        if (element.dataEnd <= offset) break;
        offset = element.dataEnd;
        if (offset > 4 * 1024 * 1024) break;
    }
    throw new Error('This file is not a readable Matroska/WebM container.');
}

function subtitleCodecInfo(codecId) {
    const codec = String(codecId || '').toUpperCase();
    if (codec === 'S_TEXT/ASS') return { format: 'ass', codecLabel: 'ASS', extractable: true, limited: true };
    if (codec === 'S_TEXT/SSA') return { format: 'ssa', codecLabel: 'SSA', extractable: true, limited: true };
    if (codec === 'S_TEXT/UTF8') return { format: 'utf8', codecLabel: 'SRT / UTF-8', extractable: true, limited: false };
    if (codec === 'S_TEXT/WEBVTT') return { format: 'vtt', codecLabel: 'WebVTT', extractable: true, limited: false };
    if (codec.includes('PGS')) return { format: 'pgs', codecLabel: 'PGS (image)', extractable: false, limited: false };
    if (codec.includes('VOBSUB')) return { format: 'vobsub', codecLabel: 'VobSub (image)', extractable: false, limited: false };
    return { format: codecId || 'unknown', codecLabel: codecId || 'Unknown', extractable: false, limited: false };
}

async function parseTrackEntry(reader, entry) {
    const track = {
        number: null,
        uid: null,
        type: null,
        enabled: true,
        default: false,
        forced: false,
        defaultDurationNs: null,
        name: '',
        language: '',
        codecId: '',
        codecPrivate: '',
    };
    let offset = entry.dataStart;
    while (offset < entry.dataEnd) {
        const element = await readElementHeader(reader, offset, entry.dataEnd);
        if (!element) break;
        switch (element.id) {
            case IDS.TRACK_NUMBER: track.number = await readUnsigned(reader, element); break;
            case IDS.TRACK_UID: track.uid = await readUnsigned(reader, element); break;
            case IDS.TRACK_TYPE: track.type = await readUnsigned(reader, element); break;
            case IDS.FLAG_ENABLED: track.enabled = (await readUnsigned(reader, element)) !== 0; break;
            case IDS.FLAG_DEFAULT: track.default = (await readUnsigned(reader, element)) !== 0; break;
            case IDS.FLAG_FORCED: track.forced = (await readUnsigned(reader, element)) !== 0; break;
            case IDS.DEFAULT_DURATION: track.defaultDurationNs = await readUnsigned(reader, element); break;
            case IDS.NAME: track.name = await readText(reader, element); break;
            case IDS.LANGUAGE: if (!track.language) track.language = await readText(reader, element, 256); break;
            case IDS.LANGUAGE_IETF: track.language = await readText(reader, element, 256); break;
            case IDS.CODEC_ID: track.codecId = await readText(reader, element, 512); break;
            case IDS.CODEC_PRIVATE: track.codecPrivate = await readText(reader, element); break;
            default: break;
        }
        if (element.dataEnd <= offset) break;
        offset = element.dataEnd;
    }
    return track;
}

async function parseTracks(reader, tracksElement) {
    const tracks = [];
    let offset = tracksElement.dataStart;
    while (offset < tracksElement.dataEnd) {
        const element = await readElementHeader(reader, offset, tracksElement.dataEnd);
        if (!element) break;
        if (element.id === IDS.TRACK_ENTRY) tracks.push(await parseTrackEntry(reader, element));
        if (element.dataEnd <= offset) break;
        offset = element.dataEnd;
    }
    return tracks;
}

async function parseInfo(reader, infoElement) {
    let timecodeScale = DEFAULT_TIMECODE_SCALE;
    let durationTicks = null;
    let offset = infoElement.dataStart;
    while (offset < infoElement.dataEnd) {
        const element = await readElementHeader(reader, offset, infoElement.dataEnd);
        if (!element) break;
        if (element.id === IDS.TIMESTAMP_SCALE) timecodeScale = await readUnsigned(reader, element) || DEFAULT_TIMECODE_SCALE;
        if (element.id === IDS.DURATION) durationTicks = await readFloat(reader, element);
        if (element.dataEnd <= offset) break;
        offset = element.dataEnd;
    }
    return { timecodeScale, durationTicks };
}

async function inspectMetadata(blob) {
    const reader = new BlobReader(blob);
    const segment = await findSegment(reader);
    let tracks = [];
    let info = { timecodeScale: DEFAULT_TIMECODE_SCALE, durationTicks: null };
    let offset = segment.dataStart;
    while (offset < segment.dataEnd) {
        const element = await readElementHeader(reader, offset, segment.dataEnd);
        if (!element) break;
        if (element.id === IDS.INFO) info = await parseInfo(reader, element);
        if (element.id === IDS.TRACKS) tracks = await parseTracks(reader, element);
        if (tracks.length && element.id === IDS.CLUSTER) break;
        if (element.dataEnd <= offset) break;
        offset = element.dataEnd;
    }
    const timecodeScaleSeconds = info.timecodeScale / 1_000_000_000;
    return {
        segment,
        timecodeScale: info.timecodeScale,
        timecodeScaleSeconds,
        duration: Number.isFinite(info.durationTicks) ? info.durationTicks * timecodeScaleSeconds : null,
        tracks,
    };
}

function getMetadata(blob) {
    if (!metadataCache.has(blob)) metadataCache.set(blob, inspectMetadata(blob));
    return metadataCache.get(blob);
}

export async function inspectMatroskaSubtitleTracks(blob) {
    const metadata = await getMetadata(blob);
    return metadata.tracks
        .filter(track => track.type === 17 && track.enabled && Number.isFinite(track.number))
        .map((track, index) => {
            const language = normalizeLanguageCode(track.language);
            const codec = subtitleCodecInfo(track.codecId);
            return {
                id: `mkv-subtitle:${track.number}`,
                trackNumber: track.number,
                index,
                language,
                label: track.name || languageDisplayName(language) || `Subtitle ${index + 1}`,
                codec: track.codecId,
                codecLabel: codec.codecLabel,
                format: codec.format,
                embedded: true,
                origin: 'embedded',
                default: track.default,
                forced: track.forced,
                extractable: codec.extractable,
                switchable: codec.extractable,
                limited: codec.limited,
                support: codec.extractable ? (codec.limited ? 'partial' : 'available') : 'unsupported',
                supported: codec.extractable,
            };
        });
}

function decodeBlockVint(bytes, offset) {
    const decoded = decodeVint(bytes, offset, false);
    if (!decoded || decoded.unknown || decoded.value > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    return { length: decoded.length, value: Number(decoded.value) };
}

function splitLacedFrames(bytes, cursor, flags) {
    const lacing = (flags & 0x06) >> 1;
    if (lacing === 0) return [bytes.subarray(cursor)];
    if (cursor >= bytes.length) return [];
    const frameCount = bytes[cursor] + 1;
    cursor += 1;
    if (frameCount < 1) return [];
    const sizes = [];

    if (lacing === 2) {
        const remaining = bytes.length - cursor;
        if (remaining % frameCount !== 0) return [];
        for (let index = 0; index < frameCount; index += 1) sizes.push(remaining / frameCount);
    } else if (lacing === 1) {
        for (let frame = 0; frame < frameCount - 1; frame += 1) {
            let size = 0;
            while (cursor < bytes.length) {
                const part = bytes[cursor++];
                size += part;
                if (part !== 255) break;
            }
            sizes.push(size);
        }
    } else {
        const firstSize = decodeBlockVint(bytes, cursor);
        if (!firstSize) return [];
        sizes.push(firstSize.value);
        cursor += firstSize.length;
        for (let frame = 1; frame < frameCount - 1; frame += 1) {
            const encoded = decodeBlockVint(bytes, cursor);
            if (!encoded) return [];
            const bias = (2 ** (7 * encoded.length) - 1) / 2;
            sizes.push(sizes[sizes.length - 1] + encoded.value - bias);
            cursor += encoded.length;
        }
    }

    if (sizes.length < frameCount) {
        const used = sizes.reduce((sum, size) => sum + size, 0);
        sizes.push(bytes.length - cursor - used);
    }
    if (sizes.some(size => !Number.isInteger(size) || size < 0)) return [];
    const frames = [];
    for (const size of sizes) {
        if (cursor + size > bytes.length) return [];
        frames.push(bytes.subarray(cursor, cursor + size));
        cursor += size;
    }
    return frames;
}

async function readSubtitleBlock(reader, element, targetTrackNumber) {
    const prefix = await reader.read(element.dataStart, Math.min(element.size, 16));
    const trackNumber = decodeBlockVint(prefix, 0);
    if (!trackNumber || trackNumber.value !== targetTrackNumber || element.size > MAX_CUE_BYTES) return null;
    const bytes = await reader.read(element.dataStart, element.size);
    let cursor = trackNumber.length;
    if (cursor + 3 > bytes.length) return null;
    const relativeTimestamp = new DataView(bytes.buffer, bytes.byteOffset + cursor, 2).getInt16(0, false);
    cursor += 2;
    const flags = bytes[cursor++];
    return { relativeTimestamp, frames: splitLacedFrames(bytes, cursor, flags) };
}

function basicAssText(packet) {
    let remainder = packet;
    // Matroska stores ASS/SSA packets without Start/End: ReadOrder, Layer,
    // Style, Name, MarginL, MarginR, MarginV, Effect, Text.
    for (let index = 0; index < 8; index += 1) {
        const comma = remainder.indexOf(',');
        if (comma < 0) return packet;
        remainder = remainder.slice(comma + 1);
    }
    return remainder
        .replace(/\{[^}]*\}/g, '')
        .replace(/\\[Nn]/g, '\n')
        .replace(/\\h/g, ' ')
        .trim();
}

function decodeSubtitleFrame(frame, format) {
    const value = textDecoder.decode(frame).replace(/\0+$/g, '').trim();
    if (!value) return '';
    if (format === 'ass' || format === 'ssa') return basicAssText(value);
    if (format === 'vtt') return value.replace(/^WEBVTT[^\n]*\n+/i, '').trim();
    return value;
}

async function parseBlockGroup(reader, group, targetTrackNumber) {
    let block = null;
    let durationTicks = null;
    let offset = group.dataStart;
    while (offset < group.dataEnd) {
        const element = await readElementHeader(reader, offset, group.dataEnd);
        if (!element) break;
        if (element.id === IDS.BLOCK) block = await readSubtitleBlock(reader, element, targetTrackNumber);
        if (element.id === IDS.BLOCK_DURATION) durationTicks = await readUnsigned(reader, element);
        if (element.dataEnd <= offset) break;
        offset = element.dataEnd;
    }
    return block ? { ...block, durationTicks } : null;
}

async function scanCluster(reader, cluster, context) {
    let clusterTimestamp = 0;
    const pending = [];
    let offset = cluster.dataStart;
    while (offset < cluster.dataEnd) {
        throwIfAborted(context.signal);
        const element = await readElementHeader(reader, offset, cluster.dataEnd);
        if (!element) break;
        if (element.id === IDS.CLUSTER_TIMESTAMP) clusterTimestamp = await readUnsigned(reader, element) || 0;
        if (element.id === IDS.SIMPLE_BLOCK) {
            const block = await readSubtitleBlock(reader, element, context.track.number);
            if (block) pending.push({ ...block, durationTicks: null });
        }
        if (element.id === IDS.BLOCK_GROUP) {
            const block = await parseBlockGroup(reader, element, context.track.number);
            if (block) pending.push(block);
        }
        context.visited += 1;
        if (context.visited % 1200 === 0) await new Promise(resolve => setTimeout(resolve, 0));
        if (element.dataEnd <= offset) break;
        offset = element.dataEnd;
    }

    for (const block of pending) {
        const start = (clusterTimestamp + block.relativeTimestamp) * context.scaleSeconds;
        const duration = Number.isFinite(block.durationTicks)
            ? block.durationTicks * context.scaleSeconds
            : context.track.defaultDurationNs
                ? context.track.defaultDurationNs / 1_000_000_000
                : null;
        const perFrameDuration = duration && block.frames.length ? duration / block.frames.length : null;
        block.frames.forEach((frame, index) => {
            const text = decodeSubtitleFrame(frame, context.codec.format);
            if (!text) return;
            const frameStart = start + (perFrameDuration || 0) * index;
            context.cues.push({ start: frameStart, end: perFrameDuration ? frameStart + perFrameDuration : null, text });
        });
        if (context.cues.length > MAX_CUES) throw new Error('This subtitle track contains too many cues to load safely.');
    }
}

export async function extractMatroskaSubtitle(blob, trackIdOrNumber, { signal } = {}) {
    throwIfAborted(signal);
    const metadata = await getMetadata(blob);
    const requestedNumber = typeof trackIdOrNumber === 'string'
        ? Number(trackIdOrNumber.replace(/^mkv-subtitle:/, ''))
        : Number(trackIdOrNumber);
    const track = metadata.tracks.find(candidate => candidate.type === 17 && candidate.number === requestedNumber);
    if (!track) throw new Error('That embedded subtitle track is no longer available.');
    const codec = subtitleCodecInfo(track.codecId);
    if (!codec.extractable) throw new Error(`${codec.codecLabel} subtitles are image-based or unsupported in this browser.`);

    const reader = new BlobReader(blob, 16 * 1024);
    const context = {
        track,
        codec,
        signal,
        scaleSeconds: metadata.timecodeScaleSeconds,
        cues: [],
        visited: 0,
    };
    let offset = metadata.segment.dataStart;
    while (offset < metadata.segment.dataEnd) {
        throwIfAborted(signal);
        const element = await readElementHeader(reader, offset, metadata.segment.dataEnd);
        if (!element) break;
        if (element.id === IDS.CLUSTER) await scanCluster(reader, element, context);
        if (element.dataEnd <= offset) break;
        offset = element.dataEnd;
    }

    context.cues.sort((left, right) => left.start - right.start);
    context.cues.forEach((cue, index) => {
        if (Number.isFinite(cue.end) && cue.end > cue.start) return;
        const nextStart = context.cues[index + 1]?.start;
        cue.end = Number.isFinite(nextStart) && nextStart > cue.start ? nextStart : cue.start + 4;
    });
    const note = codec.limited
        ? 'Embedded ASS/SSA converted to basic timing and text. Fonts, positioning, karaoke, and effects are not preserved.'
        : '';
    const vtt = subtitleCuesToWebVtt(context.cues, { note });
    return {
        blob: new Blob([vtt], { type: 'text/vtt;charset=utf-8' }),
        cueCount: context.cues.length,
        format: codec.format,
        formatLabel: codec.codecLabel,
        limited: codec.limited,
    };
}

