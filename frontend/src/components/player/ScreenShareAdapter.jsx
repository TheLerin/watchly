import React, { useState } from 'react';
import { MonitorUp, Square } from 'lucide-react';
import { useRoomScreenShare } from '../../context/ScreenShareContext';
import { useRoom } from '../../context/RoomContext';
import GradientLabel from '../GradientLabel';
import GradientIcon from '../GradientIcon';

export default function ScreenShareAdapter({ variant = 'classic', className = '' }) {
    const { permissions, roomActionsEnabled } = useRoom();
    const { supported, sharing, remoteStream, status, warning, iceWarning, start, stop } = useRoomScreenShare();
    const [error, setError] = useState('');
    return <section className={`room-screen-share rounded-xl border border-white/10 p-3 ${className}`} data-room-variant={variant}>
        <div className="room-panel-heading"><MonitorUp size={19} aria-hidden="true" /><div><h2>Screen share</h2><p>{sharing ? 'Your screen is on the main player.' : remoteStream ? 'Watching on the main player.' : 'Put a tab or screen on the big screen.'}</p></div></div>
        {(sharing || permissions.canShareScreen) && <button disabled={status === 'requesting-permission' || (!supported && !sharing) || (!roomActionsEnabled && !sharing)} onClick={async () => { setError(''); try { if (sharing) stop(); else await start(); } catch (e) { setError(e.name === 'NotAllowedError' ? 'Screen permission was denied. Nothing was shared; try again only when ready.' : e.message); } }} className="room-screen-share-action flex items-center gap-2 text-xs font-bold text-zinc-300 disabled:opacity-40">
            <GradientIcon>{sharing ? <Square size={17}/> : <MonitorUp size={17}/>}</GradientIcon><GradientLabel>{sharing ? 'Stop sharing' : 'Share Screen (Beta)'}</GradientLabel>
        </button>}
        {!supported && <p className="room-panel-hint">This browser can watch shared screens but cannot start screen capture.</p>}
        {error && <p className="mt-2 text-xs text-red-400">{error}</p>}
        {warning && <p className="mt-2 text-xs text-amber-400">{warning}</p>}
        {iceWarning && <p className="mt-2 text-xs text-amber-400">{iceWarning}</p>}
        {status !== 'idle' && <p className="mt-2 text-[10px] uppercase tracking-wide text-zinc-500">{status.replaceAll('-', ' ')}</p>}
    </section>;
}
