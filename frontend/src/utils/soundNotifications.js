// Keep stable identities across transport loss. Snapshots establish a silent
// baseline; only explicit departures clear identities for a future real join.
export function createMembershipSounds({ play, ready, self }) {
    let scope;
    const seen = new Set();
    return {
        baseline(ids, roomId) { if (scope !== roomId) { seen.clear(); scope = roomId; } for (const id of ids) seen.add(id); },
        joined(id, resumed = false) { const known = seen.has(id); seen.add(id); if (id && id !== self() && !known && !resumed && ready()) play('roomJoin'); },
        left(id, reason) { if (!['left', 'kicked'].includes(reason)) return; const known = seen.delete(id); if (known && id !== self() && ready()) play('roomLeave'); },
    };
}

export function createCallPresenceSounds({ play, ready }) {
    const seen = new Set(); let active = false;
    return {
        baseline(ids) { active = true; for (const id of ids) seen.add(id); },
        suspend() { active = false; },
        reset() { seen.clear(); active = false; },
        joined(id) { const known = seen.has(id); seen.add(id); if (id && active && !known && ready()) play('voiceJoin'); },
        left(id, intentional) { if (!intentional) return; const known = seen.delete(id); if (known && active && ready()) play('voiceLeave'); },
    };
}

// Observe successful explicit actions, never SDK track restoration/cleanup.
export function createMediaActionSounds({ room, act, play }) {
    const pending = new Set();
    return async (action, ...args) => {
        const before = { camera: room.localParticipant.isCameraEnabled, mic: room.localParticipant.isMicrophoneEnabled, connected: room.state === 'connected' };
        const notify = !pending.has(action); pending.add(action);
        try {
            const result = await act(action, ...args), after = room.localParticipant;
            if (!notify) return result;
            if (action === 'cameraOn' && !before.camera && after.isCameraEnabled) play('cameraOn');
            if (action === 'cameraOff' && before.camera && !after.isCameraEnabled) play('cameraOff');
            if (action === 'toggleMicrophone' && before.mic !== after.isMicrophoneEnabled) play(after.isMicrophoneEnabled ? 'unmute' : 'mute');
            if (action === 'joinVoice' && !before.mic && after.isMicrophoneEnabled) play('voiceJoin');
            if (action === 'leave' && before.connected && room.state === 'disconnected') play('voiceLeave');
            return result;
        } finally { if (notify) pending.delete(action); }
    };
}
