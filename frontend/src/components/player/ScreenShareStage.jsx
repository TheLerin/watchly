import { useEffect, useRef, useState } from 'react';
import { Maximize, Minimize, Play, Square } from 'lucide-react';
import { useRoomScreenShare } from '../../context/ScreenShareContext';
import ControlIconButton from '../ControlIconButton';
import GradientLabel from '../GradientLabel';
import GradientIcon from '../GradientIcon';

export default function ScreenShareStage() {
    const { active, sharing, remoteStream, previewStream, stop } = useRoomScreenShare();
    const video = useRef(null), root = useRef(null);
    const [blocked, setBlocked] = useState(false), [fullscreen, setFullscreen] = useState(false);
    const stream = sharing ? previewStream : remoteStream;
    useEffect(() => {
        const element = video.current;
        if (!element) return;
        let current = true;
        element.srcObject = stream;
        void element.play().then(() => { if (current) setBlocked(false); }).catch(() => { if (current) setBlocked(true); });
        return () => { current = false; element.srcObject = null; };
    }, [stream]);
    useEffect(() => {
        const update = () => setFullscreen(Boolean(document.fullscreenElement));
        document.addEventListener('fullscreenchange', update);
        return () => document.removeEventListener('fullscreenchange', update);
    }, []);
    if (!active) return null;
    return <section ref={root} className="screen-share-stage" aria-label="Shared screen on main player">
        <video ref={video} className="screen-share-video" autoPlay playsInline controls muted={sharing} aria-label={sharing ? 'Your shared screen preview' : 'Shared screen'} />
        <div className="screen-share-stage-heading"><span>{sharing ? 'You’re sharing your screen' : 'Shared screen'}</span><div>
            <ControlIconButton label={fullscreen ? 'Exit shared screen fullscreen' : 'Fullscreen shared screen'} icon={fullscreen ? <Minimize size={17} /> : <Maximize size={17} />} onClick={() => {
                if (document.fullscreenElement) void document.exitFullscreen(); else void root.current.closest('.room-player-surface')?.requestFullscreen?.().catch(() => {});
            }} />
            {sharing && <ControlIconButton label="Stop screen sharing" icon={<Square size={17} />} onClick={() => stop()} />}
        </div></div>
        {blocked && <button className="screen-share-play" onClick={() => void video.current.play().then(() => setBlocked(false)).catch(() => {})}><GradientIcon><Play size={23} aria-hidden="true" /></GradientIcon><GradientLabel>Play shared screen</GradientLabel></button>}
    </section>;
}
