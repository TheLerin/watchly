import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { friendlyCodecName, inspectLocalMedia, summarizeCompatibility, supportLevel } from '../src/utils/mediaInspector.js';

const createGeneratedMatroskaFixture = async () => {
    const {
        Input,
        Output,
        MP4,
        BlobSource,
        MkvOutputFormat,
        BufferTarget,
        EncodedPacket,
        EncodedPacketSink,
        EncodedVideoPacketSource,
        EncodedAudioPacketSource,
    } = await import('mediabunny');
    const bytes = readFileSync(new URL('../public/bg-video.mp4', import.meta.url));
    const input = new Input({ formats: [MP4], source: new BlobSource(new Blob([bytes], { type: 'video/mp4' })) });
    const [videoTrack] = await input.getVideoTracks();
    const [videoCodec, videoConfig] = await Promise.all([
        videoTrack.getCodec(), videoTrack.getDecoderConfig(),
    ]);
    const pcmConfig = { codec: 'pcm-s16', numberOfChannels: 2, sampleRate: 48_000 };
    const target = new BufferTarget();
    const output = new Output({ format: new MkvOutputFormat(), target });
    const videoSource = new EncodedVideoPacketSource(videoCodec);
    const englishSource = new EncodedAudioPacketSource('pcm-s16');
    const malayalamSource = new EncodedAudioPacketSource('pcm-s16');
    output.addVideoTrack(videoSource, { decoderConfig: videoConfig });
    output.addAudioTrack(englishSource, { decoderConfig: pcmConfig, languageCode: 'eng', name: 'English' });
    output.addAudioTrack(malayalamSource, { decoderConfig: pcmConfig, languageCode: 'mal', name: 'Malayalam' });
    await output.start();

    const copyVideoPackets = async () => {
        let first = true;
        for await (const packet of new EncodedPacketSink(videoTrack).packets()) {
            if (packet.timestamp >= 2.5) break;
            await videoSource.add(packet, first ? { decoderConfig: videoConfig } : undefined);
            first = false;
        }
        videoSource.close();
    };
    const writeSilence = async source => {
        const packetDuration = 0.1;
        const packetBytes = new Uint8Array(4_800 * 2 * 2);
        for (let index = 0; index < 25; index += 1) {
            const packet = new EncodedPacket(packetBytes, 'key', index * packetDuration, packetDuration, index);
            await source.add(packet, index === 0 ? { decoderConfig: pcmConfig } : undefined);
        }
        source.close();
    };
    await Promise.all([copyVideoPackets(), writeSilence(englishSource), writeSilence(malayalamSource)]);
    await output.finalize();
    input.dispose();
    return target.buffer;
};

test('codec names are presented in familiar language', () => {
    assert.equal(friendlyCodecName('avc'), 'H.264 / AVC');
    assert.equal(friendlyCodecName('dts'), 'DTS');
    assert.equal(friendlyCodecName(null, 'V_MPEG4/ISO/AVC'), 'MPEG4/ISO/AVC');
});

test('compatibility summary distinguishes supported, partial, unknown and unsupported media', () => {
    const supported = summarizeCompatibility({
        mimeSupport: 'probably',
        videoTracks: [{ support: 'supported' }],
        audioTracks: [{ support: 'supported' }],
    });
    assert.equal(supported.status, 'supported');

    const partial = summarizeCompatibility({
        mimeSupport: 'maybe',
        videoTracks: [{ support: 'supported' }],
        audioTracks: [{ support: 'supported' }, { support: 'unsupported' }],
    });
    assert.equal(partial.status, 'partial');

    const unknown = summarizeCompatibility({
        mimeSupport: '',
        videoTracks: [{ support: 'supported' }],
        audioTracks: [],
    });
    assert.equal(unknown.status, 'unknown');

    const unsupported = summarizeCompatibility({
        mimeSupport: '',
        videoTracks: [{ support: 'unsupported' }],
        audioTracks: [],
    });
    assert.equal(unsupported.status, 'unsupported');
    assert.equal(supportLevel(null), 'unknown');
});

test('the lazy inspector reads real container and track metadata without decoding the whole movie', async () => {
    const bytes = readFileSync(new URL('../public/bg-video.mp4', import.meta.url));
    const inspection = await inspectLocalMedia(new Blob([bytes], { type: 'video/mp4' }));

    assert.match(inspection.mimeType, /^video\//);
    assert.ok(inspection.container);
    assert.ok(inspection.videoTracks.length > 0);
    assert.ok(inspection.videoTracks[0].codecLabel);
});

test('a generated Matroska fixture exposes two independently generated language tracks', async () => {
    const inspection = await inspectLocalMedia(new Blob([await createGeneratedMatroskaFixture()], { type: 'video/x-matroska' }));
    assert.match(inspection.container, /Matroska/i);
    assert.ok(inspection.duration > 0);
    assert.equal(inspection.audioTracks.length, 2);
    assert.deepEqual(inspection.audioTracks.map(track => track.label), ['English', 'Malayalam']);
    assert.deepEqual(inspection.audioTracks.map(track => track.language), ['en', 'ml']);
});
