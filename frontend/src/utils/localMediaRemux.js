const MAX_PENDING_BYTES = 24 * 1024 * 1024;
const BUFFER_AHEAD_SECONDS = 150;
const KEEP_BEHIND_SECONDS = 75;

const concatBytes = (...parts) => {
    const filtered = parts.filter(Boolean);
    const size = filtered.reduce((sum, part) => sum + part.byteLength, 0);
    const output = new Uint8Array(size);
    let offset = 0;
    for (const part of filtered) {
        output.set(part, offset);
        offset += part.byteLength;
    }
    return output;
};

const remuxError = (code, message) => Object.assign(new Error(message), { code });

export function getRemuxEligibility(inspection, audioTrack, mediaSourceApi = globalThis.MediaSource) {
    const videoTrack = inspection?.videoTracks?.[0];
    if (!inspection || !videoTrack || !audioTrack) return { supported: false, reason: 'Missing video or audio track metadata.' };
    if (!mediaSourceApi?.isTypeSupported) return { supported: false, reason: 'MediaSource playback is unavailable in this browser.' };
    if (videoTrack.support === 'unsupported') return { supported: false, reason: `${videoTrack.codecLabel || 'Video'} cannot be decoded here.` };
    if (audioTrack.support === 'unsupported') return { supported: false, reason: `${audioTrack.codecLabel || 'Audio'} cannot be decoded here.` };
    if (!videoTrack.codecParameter || !audioTrack.codecParameter) {
        return { supported: false, reason: 'The browser-friendly codec identifiers are unavailable.' };
    }
    const mimeType = `video/mp4; codecs="${videoTrack.codecParameter}, ${audioTrack.codecParameter}"`;
    if (!mediaSourceApi.isTypeSupported(mimeType)) {
        return { supported: false, reason: `This browser cannot play a remuxed ${videoTrack.codecLabel || 'video'} + ${audioTrack.codecLabel || 'audio'} stream.`, mimeType };
    }
    return { supported: true, mimeType, reason: '' };
}

class SourceBufferAppender {
    constructor(sourceBuffer, mediaSource, { getCurrentTime, startTime, signal }) {
        this.sourceBuffer = sourceBuffer;
        this.mediaSource = mediaSource;
        this.getCurrentTime = getCurrentTime;
        this.startTime = startTime;
        this.signal = signal;
        this.queue = [];
        this.pendingBytes = 0;
        this.running = false;
        this.failedError = null;
        this.capacityWaiters = [];
        this.firstMediaSettled = false;
        this.firstMedia = new Promise((resolve, reject) => {
            this.resolveFirstMedia = resolve;
            this.rejectFirstMedia = reject;
        });
    }

    enqueue(data, { media = false, timestamp = 0 } = {}) {
        if (this.signal.aborted) return;
        const copy = data.slice();
        this.pendingBytes += copy.byteLength;
        this.queue.push({ data: copy, media, timestamp });
        void this.drain().catch(error => this.fail(error));
    }

    waitForCapacity() {
        if (this.signal.aborted || this.pendingBytes < MAX_PENDING_BYTES) return Promise.resolve();
        return new Promise(resolve => this.capacityWaiters.push(resolve));
    }

    releaseCapacityWaiters() {
        if (this.pendingBytes >= MAX_PENDING_BYTES) return;
        this.capacityWaiters.splice(0).forEach(resolve => resolve());
    }

    async waitForIdle() {
        while (!this.signal.aborted && !this.failedError && (
            this.running || this.queue.length || this.sourceBuffer.updating
        )) {
            await new Promise(resolve => setTimeout(resolve, 20));
        }
        if (this.failedError) throw this.failedError;
    }

    waitForUpdateEnd() {
        if (!this.sourceBuffer.updating) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const cleanup = () => {
                this.sourceBuffer.removeEventListener('updateend', onEnd);
                this.sourceBuffer.removeEventListener('error', onError);
                this.signal.removeEventListener('abort', onAbort);
            };
            const onEnd = () => { cleanup(); resolve(); };
            const onError = () => { cleanup(); reject(remuxError('SOURCE_BUFFER', 'The browser rejected a remuxed media segment.')); };
            const onAbort = () => { cleanup(); resolve(); };
            this.sourceBuffer.addEventListener('updateend', onEnd, { once: true });
            this.sourceBuffer.addEventListener('error', onError, { once: true });
            this.signal.addEventListener('abort', onAbort, { once: true });
        });
    }

    async waitUntilNearPlayback(absoluteTimestamp) {
        while (!this.signal.aborted) {
            const current = Math.max(this.startTime, Number(this.getCurrentTime?.()) || this.startTime);
            if (absoluteTimestamp <= current + BUFFER_AHEAD_SECONDS) return;
            await new Promise(resolve => setTimeout(resolve, 350));
        }
    }

    async removeOldBuffer() {
        if (this.signal.aborted || this.sourceBuffer.updating || !this.sourceBuffer.buffered.length) return;
        const current = Number(this.getCurrentTime?.()) || this.startTime;
        const removeBefore = current - KEEP_BEHIND_SECONDS;
        const bufferedStart = this.sourceBuffer.buffered.start(0);
        if (removeBefore <= bufferedStart + 5) return;
        this.sourceBuffer.remove(bufferedStart, removeBefore);
        await this.waitForUpdateEnd();
    }

    async append(item) {
        await this.waitUntilNearPlayback(item.timestamp);
        if (this.signal.aborted) return;
        await this.waitForUpdateEnd();
        try {
            this.sourceBuffer.appendBuffer(item.data);
            await this.waitForUpdateEnd();
        } catch (error) {
            if (error?.name !== 'QuotaExceededError') throw error;
            await this.removeOldBuffer();
            this.sourceBuffer.appendBuffer(item.data);
            await this.waitForUpdateEnd();
        }
        if (item.media && !this.firstMediaSettled) {
            this.firstMediaSettled = true;
            this.resolveFirstMedia();
        }
        await this.removeOldBuffer();
    }

    async drain() {
        if (this.running) return;
        this.running = true;
        try {
            while (this.queue.length && !this.signal.aborted) {
                const item = this.queue.shift();
                await this.append(item);
                this.pendingBytes -= item.data.byteLength;
                this.releaseCapacityWaiters();
            }
        } catch (error) {
            if (!this.firstMediaSettled) {
                this.firstMediaSettled = true;
                this.rejectFirstMedia(error);
            }
            throw error;
        } finally {
            this.running = false;
            if (this.queue.length && !this.signal.aborted && !this.failedError) {
                void this.drain().catch(error => this.fail(error));
            }
        }
    }

    fail(error) {
        this.failedError = error;
        this.queue = [];
        this.pendingBytes = 0;
        if (!this.firstMediaSettled) {
            this.firstMediaSettled = true;
            this.rejectFirstMedia(error);
        }
        this.capacityWaiters.splice(0).forEach(resolve => resolve());
    }
}

const waitForSourceOpen = (mediaSource, signal) => {
    if (mediaSource.readyState === 'open') return Promise.resolve();
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            mediaSource.removeEventListener('sourceopen', onOpen);
            mediaSource.removeEventListener('sourceclose', onClose);
            signal.removeEventListener('abort', onAbort);
        };
        const onOpen = () => { cleanup(); resolve(); };
        const onClose = () => { cleanup(); reject(remuxError('MEDIA_SOURCE_CLOSED', 'The remuxed media stream closed before it was ready.')); };
        const onAbort = () => { cleanup(); resolve(); };
        mediaSource.addEventListener('sourceopen', onOpen, { once: true });
        mediaSource.addEventListener('sourceclose', onClose, { once: true });
        signal.addEventListener('abort', onAbort, { once: true });
    });
};

/**
 * Builds a copy-only fragmented MP4 stream around the requested room time.
 * The caller assigns `session.url` to the existing authoritative <video>.
 */
export async function createLocalRemuxSession({
    file,
    inspection,
    audioTrackId,
    startTime = 0,
    duration,
    getCurrentTime = () => startTime,
    onStatus = () => {},
}) {
    const inspectedAudio = inspection?.audioTracks?.find(track => String(track.id) === String(audioTrackId));
    const eligibility = getRemuxEligibility(inspection, inspectedAudio);
    if (!eligibility.supported) throw remuxError('REMUX_UNAVAILABLE', eligibility.reason);

    const {
        Input,
        ALL_FORMATS,
        BlobSource,
        Output,
        Mp4OutputFormat,
        NullTarget,
        EncodedPacketSink,
        EncodedVideoPacketSource,
        EncodedAudioPacketSource,
    } = await import('mediabunny');

    const controller = new AbortController();
    const { signal } = controller;
    const mediaSource = new MediaSource();
    const url = URL.createObjectURL(mediaSource);
    const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file, { maxCacheSize: 8 * 1024 * 1024 }) });
    let output = null;
    let sourceBuffer = null;
    let appender = null;
    let disposed = false;

    const session = {
        url,
        mimeType: eligibility.mimeType,
        audioTrackId,
        baseTime: Math.max(0, Number(startTime) || 0),
        ready: null,
        covers(time) {
            if (!sourceBuffer) return false;
            for (let index = 0; index < sourceBuffer.buffered.length; index += 1) {
                if (time >= sourceBuffer.buffered.start(index) && time <= sourceBuffer.buffered.end(index)) return true;
            }
            return false;
        },
        async dispose() {
            if (disposed) return;
            disposed = true;
            controller.abort();
            try { await output?.cancel(); } catch { /* already finalized */ }
            try { sourceBuffer?.abort(); } catch { /* source already closed */ }
            try { if (mediaSource.readyState === 'open') mediaSource.endOfStream(); } catch { /* no-op */ }
            input.dispose();
            URL.revokeObjectURL(url);
        },
    };

    session.ready = (async () => {
        try {
            onStatus({ status: 'opening' });
            const [videoTracks, audioTracks] = await Promise.all([input.getVideoTracks(), input.getAudioTracks()]);
            const videoTrack = videoTracks[0];
            const audioTrack = audioTracks.find(track => String(track.id) === String(audioTrackId));
            if (!videoTrack || !audioTrack) throw remuxError('TRACK_MISSING', 'The selected local audio track could not be reopened.');

            const [videoCodec, audioCodec, videoConfig, audioConfig, videoRotation, videoLanguage, videoName, audioLanguage, audioName] = await Promise.all([
                videoTrack.getCodec(),
                audioTrack.getCodec(),
                videoTrack.getDecoderConfig(),
                audioTrack.getDecoderConfig(),
                videoTrack.getRotation(),
                videoTrack.getLanguageCode(),
                videoTrack.getName(),
                audioTrack.getLanguageCode(),
                audioTrack.getName(),
            ]);
            if (!videoCodec || !audioCodec || !videoConfig || !audioConfig) {
                throw remuxError('CODEC_CONFIG', 'The selected tracks do not provide enough codec data for safe remuxing.');
            }

            await waitForSourceOpen(mediaSource, signal);
            if (signal.aborted) return;
            sourceBuffer = mediaSource.addSourceBuffer(eligibility.mimeType);
            sourceBuffer.mode = 'segments';
            if (Number.isFinite(duration) && duration > 0) mediaSource.duration = duration;

            const videoSink = new EncodedPacketSink(videoTrack);
            const audioSink = new EncodedPacketSink(audioTrack);
            const requestedStart = Math.max(0, Number(startTime) || 0);
            const videoStartPacket = await videoSink.getKeyPacket(requestedStart, { verifyKeyPackets: true })
                || await videoSink.getFirstKeyPacket({ verifyKeyPackets: true });
            if (!videoStartPacket) throw remuxError('NO_KEYFRAME', 'No usable video key frame was found for remuxing.');
            const audioStartPacket = await audioSink.getPacket(videoStartPacket.timestamp) || await audioSink.getFirstPacket();
            if (!audioStartPacket) throw remuxError('NO_AUDIO_PACKET', 'The selected audio track contains no readable packets.');
            const baseTimestamp = Math.min(videoStartPacket.timestamp, audioStartPacket.timestamp);
            session.baseTime = baseTimestamp;
            sourceBuffer.timestampOffset = baseTimestamp;

            let ftyp = null;
            let pendingMoof = null;
            const format = new Mp4OutputFormat({
                fastStart: 'fragmented',
                minimumFragmentDuration: 2,
                onFtyp(data) { ftyp = data.slice(); },
                onMoov(data) {
                    appender.enqueue(concatBytes(ftyp, data), { timestamp: baseTimestamp });
                    ftyp = null;
                },
                onMoof(data, _position, timestamp) { pendingMoof = { data: data.slice(), timestamp }; },
                onMdat(data) {
                    if (!pendingMoof) return;
                    appender.enqueue(concatBytes(pendingMoof.data, data), {
                        media: true,
                        timestamp: baseTimestamp + pendingMoof.timestamp,
                    });
                    pendingMoof = null;
                },
            });
            appender = new SourceBufferAppender(sourceBuffer, mediaSource, { getCurrentTime, startTime: requestedStart, signal });
            output = new Output({ format, target: new NullTarget() });
            const videoSource = new EncodedVideoPacketSource(videoCodec);
            const audioSource = new EncodedAudioPacketSource(audioCodec);
            output.addVideoTrack(videoSource, {
                decoderConfig: videoConfig,
                rotation: videoRotation,
                languageCode: videoLanguage,
                name: videoName || undefined,
            });
            output.addAudioTrack(audioSource, {
                decoderConfig: audioConfig,
                languageCode: audioLanguage,
                name: audioName || undefined,
            });
            await output.start();

            onStatus({ status: 'remuxing', baseTimestamp });
            const pump = async (sink, firstPacket, source, decoderConfig) => {
                let first = true;
                for await (const packet of sink.packets(firstPacket)) {
                    if (signal.aborted) break;
                    await appender.waitUntilNearPlayback(packet.timestamp);
                    const shifted = packet.clone({ timestamp: packet.timestamp - baseTimestamp });
                    await source.add(shifted, first ? { decoderConfig } : undefined);
                    first = false;
                    await appender.waitForCapacity();
                }
                source.close();
            };

            const pumps = Promise.all([
                pump(videoSink, videoStartPacket, videoSource, videoConfig),
                pump(audioSink, audioStartPacket, audioSource, audioConfig),
            ]).then(async () => {
                if (!signal.aborted) {
                    await output.finalize();
                    await appender.waitForIdle();
                    if (mediaSource.readyState === 'open') mediaSource.endOfStream();
                }
            }).catch(error => {
                appender.fail(error);
                throw error;
            });
            // Avoid an unhandled rejection after the component has moved on.
            void pumps.catch(error => { if (!signal.aborted) onStatus({ status: 'error', error }); });

            await appender.firstMedia;
            if (signal.aborted) return;
            onStatus({ status: 'ready', baseTimestamp });
        } catch (error) {
            if (!signal.aborted) onStatus({ status: 'error', error });
            throw error;
        }
    })();

    session.ready.catch(() => {});
    return session;
}
