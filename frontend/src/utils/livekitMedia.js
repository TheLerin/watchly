const captureError = (error, kind) => error?.name === 'NotAllowedError'
    ? `${kind} access blocked. Allow access in your browser and try again.`
    : error?.name === 'NotFoundError' ? `No ${kind.toLowerCase()} detected.`
        : error?.name === 'NotReadableError' ? `${kind} is unavailable or being used by another application.`
            : error?.message || `${kind} could not start. Please try again.`;

// One controller owns authorization, connection and every pending capture.
// UI mounts/portals never own the Room or its local tracks.
export function createMediaSession({ room, requestToken, createMicrophone, createCamera, canJoin, onState }) {
    let generation = 0, connection = null, abort = null, microphone = null, camera = null;
    let micWork = null, cameraWork = null, cameraGeneration = 0;
    const devices = { audioinput: '', videoinput: '' };
    let facingMode = 'user';
    const valid = attempt => attempt === generation && canJoin();
    const cameraOptions = () => ({ ...(devices.videoinput ? { deviceId: devices.videoinput } : { facingMode }) });
    const reset = () => {
        generation++; cameraGeneration++; abort?.abort();
        microphone?.stop(); camera?.stop(); microphone = null; camera = null;
        onState({ joining: false, micBusy: false, cameraBusy: false, error: '', cameraError: '' });
    };
    const leave = async () => { reset(); await room.disconnect(); };
    const connect = async () => {
        if (room.state === 'connected') return;
        if (connection) return connection;
        if (room.state !== 'disconnected') throw new Error('The call is reconnecting. Please wait.');
        if (!canJoin()) throw new Error('Reconnect to your Watchly room before joining the call.');
        const attempt = generation;
        abort = new AbortController();
        connection = (async () => {
            const token = await requestToken(abort.signal);
            if (!valid(attempt)) throw new Error('Call join cancelled.');
            await room.connect(token.serverUrl, token.participantToken, { autoSubscribe: true, websocketTimeout: 10000, peerConnectionTimeout: 15000 });
            if (!valid(attempt)) { await room.disconnect(); throw new Error('Call join cancelled.'); }
        })();
        try { await connection; } finally { connection = null; }
    };
    const enableMicrophone = async () => {
        if (micWork) return micWork;
        const attempt = generation;
        onState({ micBusy: true, error: '' });
        micWork = (async () => {
            let track;
            try {
                await connect();
                if (!valid(attempt)) return;
                const publication = room.localParticipant.getTrackPublication('microphone');
                if (publication?.track && publication.track.mediaStreamTrack?.readyState !== 'ended') { await publication.track.unmute(); return; }
                track = await createMicrophone(devices.audioinput ? { deviceId: devices.audioinput } : {});
                if (!valid(attempt)) { track.stop(); return; }
                microphone = track;
                await room.localParticipant.publishTrack(track, { source: 'microphone' });
                if (!valid(attempt)) { track.stop(); await room.localParticipant.unpublishTrack(track); }
            } catch (error) {
                track?.stop();
                if (attempt === generation) { microphone = null; onState({ error: captureError(error, 'Microphone') }); }
            } finally { micWork = null; if (attempt === generation) onState({ micBusy: false }); }
        })();
        return micWork;
    };
    const joinVoice = async () => {
        void room.startAudio().catch(() => {});
        onState({ joining: true, error: '' });
        const attempt = generation;
        try { await enableMicrophone(); } finally { if (attempt === generation) onState({ joining: false }); }
    };
    const cameraOff = async () => {
        cameraGeneration++;
        const track = camera || room.localParticipant.getTrackPublication('camera')?.track;
        camera = null; track?.stop();
        if (track) await room.localParticipant.unpublishTrack(track, true);
        onState({ cameraBusy: false });
    };
    const cameraOn = async () => {
        if (cameraWork || room.localParticipant.isCameraEnabled) return cameraWork;
        const attempt = generation, cameraAttempt = ++cameraGeneration;
        const current = () => valid(attempt) && cameraAttempt === cameraGeneration;
        onState({ cameraBusy: true, cameraError: '' });
        void room.startAudio().catch(() => {});
        cameraWork = (async () => {
            let track;
            try {
                await connect();
                if (!current()) return;
                track = await createCamera(cameraOptions());
                if (!current()) { track.stop(); return; }
                camera = track;
                track.on?.('ended', () => {
                    if (camera === track) { void cameraOff(); onState({ cameraError: 'Camera disconnected. Select another device or try again.' }); }
                });
                await room.localParticipant.publishTrack(track, { source: 'camera', simulcast: true });
                if (!current()) { track.stop(); await room.localParticipant.unpublishTrack(track, true); }
            } catch (error) {
                track?.stop();
                if (attempt === generation && cameraAttempt === cameraGeneration) { camera = null; onState({ cameraError: captureError(error, 'Camera') }); }
            } finally { cameraWork = null; if (current()) onState({ cameraBusy: false }); }
        })();
        return cameraWork;
    };
    const toggleMicrophone = async () => {
        if (room.localParticipant.isMicrophoneEnabled) {
            try { await room.localParticipant.getTrackPublication('microphone')?.track?.mute(); }
            catch (error) { onState({ error: captureError(error, 'Microphone') }); }
        } else await enableMicrophone();
    };
    const switchDevice = async (kind, deviceId) => {
        devices[kind] = deviceId;
        const source = kind === 'videoinput' ? 'camera' : 'microphone';
        const track = room.localParticipant.getTrackPublication(source)?.track;
        const enabled = kind === 'videoinput' ? room.localParticipant.isCameraEnabled : room.localParticipant.isMicrophoneEnabled;
        // Selecting an idle device must never open camera/microphone hardware.
        if (!enabled || !track) return;
        const attempt = generation, cameraAttempt = cameraGeneration;
        try { await room.switchActiveDevice(kind, deviceId); }
        finally { if (attempt !== generation || (kind === 'videoinput' && cameraAttempt !== cameraGeneration)) track.stop(); }
    };
    const flipCamera = async () => {
        facingMode = facingMode === 'user' ? 'environment' : 'user'; devices.videoinput = '';
        const track = room.localParticipant.getTrackPublication('camera')?.track;
        if (!room.localParticipant.isCameraEnabled || !track) return;
        const attempt = generation, cameraAttempt = cameraGeneration;
        try { await track.restartTrack(cameraOptions()); } finally { if (attempt !== generation || cameraAttempt !== cameraGeneration) track.stop(); }
    };
    const openWithoutCamera = async () => { try { await connect(); onState({ cameraError: '' }); } catch (error) { onState({ error: error.message }); } };
    return { joinVoice, connect, cameraOn, cameraOff, openWithoutCamera, toggleMicrophone, switchDevice, flipCamera, leave, reset };
}
