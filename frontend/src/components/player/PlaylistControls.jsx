import React from 'react';
import { SkipBack, SkipForward, Play, Pause } from 'lucide-react';
import { useRoom } from '../../context/RoomContext';

export default function PlaylistControls({ ready }) {
    const { videoState: state, currentUser, controllerMemberId, updatePlaylist, playVideo, pauseVideo, getExpectedPosition, localReadiness, roomActionsEnabled } = useRoom();
    if (state.sourceType !== 'youtube-playlist') return null;
    const host = currentUser?.userId === controllerMemberId;
    const count = state.playlistItems?.length || 0;
    const title = state.playlistTitles?.[state.currentVideoId] || (count ? `Video ${state.playlistIndex + 1}` : 'Loading playlist…');
    const button = 'flex min-h-10 items-center gap-1 rounded-xl border border-white/10 px-3 text-xs font-semibold text-zinc-200 hover:bg-white/5 disabled:opacity-40';
    return <div className="watch-playback-details playlist-controls flex shrink-0 flex-wrap items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] p-3 text-xs" aria-label="YouTube playlist controls">
        <div className="min-w-0 flex-1 basis-40">
            <div className="font-semibold text-zinc-300">YouTube Playlist {count > 0 && <span className="ml-2 font-mono text-zinc-500">{state.playlistIndex + 1} / {count}</span>}</div>
            <div className="mt-1 truncate text-zinc-400" title={title}>{title}</div>
            <div className="mt-1 text-[10px] text-zinc-500" role="status">{state.playlistStatus === 'finished' ? 'Playlist finished' : state.playlistStatus === 'error' ? 'Playlist unavailable' : ready ? `${localReadiness.readyCount}/${localReadiness.totalCount} ready` : 'Loading current item…'}</div>
        </div>
        {host && <>
            <button type="button" className={button} aria-label="Previous playlist video" disabled={!roomActionsEnabled || !count || state.playlistStatus === 'loading' || (state.playlistIndex === 0 && getExpectedPosition(state) <= 5)} onClick={() => updatePlaylist('PREVIOUS')}><SkipBack size={14}/> Previous</button>
            <button type="button" className={button} disabled={!roomActionsEnabled || !ready} onClick={() => state.isPlaying ? pauseVideo(getExpectedPosition(state)) : playVideo()}><span>{state.isPlaying ? <Pause size={14}/> : <Play size={14}/>}</span>{state.isPlaying ? 'Pause playlist' : 'Play Now'}</button>
            <button type="button" className={button} aria-label="Next playlist video" disabled={!roomActionsEnabled || !count || state.playlistStatus !== 'ready' || state.playlistIndex >= count - 1} onClick={() => updatePlaylist('NEXT')}><SkipForward size={14}/> Next</button>
        </>}
    </div>;
}
