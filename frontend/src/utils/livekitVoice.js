// Participant credentials are fetched only for an explicit Join Voice action.
export async function requestVoiceToken({ backendUrl, roomId, memberId, socketId, accountToken, storage = sessionStorage, fetcher = fetch, signal }) {
    let saved;
    try { saved = JSON.parse(storage.getItem('watchTogetherSession')); } catch { /* Missing or invalid private session. */ }
    if (!saved?.resumeToken || saved.roomId !== roomId || saved.memberId !== memberId || !socketId) throw new Error('Reconnect to your Watchly room before joining voice.');
    const response = await fetcher(`${backendUrl.replace(/\/$/, '')}/api/livekit/token`, {
        method: 'POST', signal, cache: 'no-store',
        headers: { 'Content-Type': 'application/json', ...(accountToken ? { Authorization: `Bearer ${accountToken}` } : {}) },
        body: JSON.stringify({ roomId, socketId, resumeToken: saved.resumeToken }),
    });
    const result = await response.json().catch(() => null);
    if (!response.ok) throw new Error(result?.error || 'Voice could not connect. Please retry.');
    if (!result?.serverUrl || !result?.participantToken) throw new Error('Voice returned an invalid connection response.');
    return result;
}

// Own pending capture as well as published audio: cancelling, leaving, or
// unmounting must stop a microphone that resolves after its request was cancelled.
export function createVoiceSession({ room, requestToken, createMicrophone, canJoin, onState }) {
    let generation = 0, pending = false, controller = null, microphone = null;
    const leave = async () => {
        generation++; controller?.abort(); microphone?.stop(); microphone = null;
        await room.disconnect();
        onState({ joining: false });
    };
    const join = async () => {
        if (pending || room.state !== 'disconnected') return;
        if (!canJoin()) { onState({ error: 'Wait for your Watchly room to reconnect before joining voice.' }); return; }
        pending = true;
        const attempt = ++generation;
        controller = new AbortController();
        const current = () => attempt === generation && canJoin();
        onState({ joining: true, error: '' });
        // Called in the user's click stack, allowing remote audio on browsers
        // which require a gesture. This neither captures nor connects voice.
        void room.startAudio().catch(() => {});
        let track;
        try {
            const { serverUrl, participantToken } = await requestToken(controller.signal);
            if (!current()) return;
            track = await createMicrophone();
            if (!current()) { track.stop(); return; }
            microphone = track;
            await room.connect(serverUrl, participantToken, { autoSubscribe: true, websocketTimeout: 10000, peerConnectionTimeout: 15000 });
            if (!current()) { track.stop(); await room.disconnect(); return; }
            await room.localParticipant.publishTrack(track, { source: 'microphone' });
            if (!current()) { track.stop(); await room.disconnect(); }
        } catch (error) {
            track?.stop();
            if (attempt === generation) {
                microphone = null; await room.disconnect();
                onState({ error: error.name === 'NotAllowedError' ? 'Microphone access is blocked. Allow it in your browser and try again.' : error.name === 'NotFoundError' ? 'No microphone was found.' : error.message || 'Voice could not connect. Please retry.' });
            }
        } finally {
            pending = false;
            if (attempt === generation) onState({ joining: false });
        }
    };
    return { join, leave };
}
