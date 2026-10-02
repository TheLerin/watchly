import React, { useEffect, useState } from 'react';
import { Maximize, Minimize, PictureInPicture2, Volume2, VolumeX } from 'lucide-react';

export default function ViewerPlayerControls({ getPlayer, youtube, native, audio, getProgress, fullscreen, onFullscreen, onSync, outOfSync, playing }) {
    const [volume, setVolume] = useState(100);
    const [muted, setMuted] = useState(false);
    const [progress, setProgress] = useState({ time: 0, duration: 0 });
    const [pipError, setPipError] = useState('');
    useEffect(() => {
        const read = () => {
            const player = getPlayer();
            if (!player) return;
            const progress = getProgress?.();
            const time = progress?.time ?? (youtube ? player.getCurrentTime?.() : player.currentTime);
            const duration = progress?.duration ?? (youtube ? player.getDuration?.() : player.duration);
            setProgress({ time: Number(time) || 0, duration: Number.isFinite(duration) ? duration : 0 });
            setVolume(audio?.volume ?? Math.round(youtube ? player.getVolume?.() ?? 100 : (player.volume ?? 1) * 100));
            setMuted(audio?.muted ?? (youtube ? Boolean(player.isMuted?.()) : Boolean(player.muted)));
        };
        read(); const timer = setInterval(read, 1000);
        return () => clearInterval(timer);
    }, [getPlayer, youtube, audio, getProgress]);
    const changeVolume = value => {
        const player = getPlayer();
        if (audio) audio.setVolume(value);
        else if (youtube) player?.setVolume?.(value); else if (player) player.volume = value / 100;
        setVolume(value);
    };
    const toggleMute = () => {
        const player = getPlayer();
        if (audio) audio.setMuted(!muted);
        else if (youtube) { if (muted) player?.unMute?.(); else player?.mute?.(); }
        else if (player) player.muted = !muted;
        setMuted(!muted);
    };
    const pip = async () => {
        try {
            setPipError('');
            if (document.pictureInPictureElement) await document.exitPictureInPicture();
            else {
                const player = getPlayer();
                if (!player?.requestPictureInPicture) throw new Error('Unsupported player');
                await player.requestPictureInPicture();
            }
        } catch { setPipError('Picture-in-picture is unavailable for this player.'); }
    };
    return <div className="viewer-player-controls absolute inset-x-0 bottom-0 z-10 flex flex-wrap items-center gap-2 bg-black/85 px-3 py-2 text-xs text-zinc-200" data-out-of-sync={outOfSync}>
        <span className="text-[10px] text-zinc-400">{playing ? 'Room playing' : 'Room paused'} · Shared controls are read-only</span>
        <progress aria-label="Read-only room playback progress" value={progress.time} max={progress.duration || 1} className="h-1 min-w-12 flex-1 accent-white" />
        <button type="button" aria-label={muted ? 'Unmute video locally' : 'Mute video locally'} onClick={toggleMute} className="p-2">{muted ? <VolumeX size={16} /> : <Volume2 size={16} />}</button>
        <input type="range" aria-label="Local video volume" min="0" max="100" value={volume} onChange={event => changeVolume(Number(event.target.value))} className="w-16 accent-white" />
        <button type="button" aria-label="Fullscreen video locally" onClick={onFullscreen} className="p-2">{fullscreen ? <Minimize size={16} /> : <Maximize size={16} />}</button>
        {native && document.pictureInPictureEnabled && <button type="button" aria-label="Picture-in-picture video locally" onClick={pip} className="p-2"><PictureInPicture2 size={16} /></button>}
        {outOfSync && <div className="viewer-sync-status flex w-full items-center justify-between gap-2" role="status"><span>Playback is controlled by the Host and Moderators.</span><button type="button" onClick={onSync} className="shrink-0 rounded-lg border border-white/30 px-3 py-2 font-bold">Sync to Room</button></div>}
        {pipError && <span role="status">{pipError}</span>}
    </div>;
}
