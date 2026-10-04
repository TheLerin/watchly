import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minus, PanelRight, X, Mic, MicOff, Camera, CameraOff } from 'lucide-react';
import { useConnectionState, useLocalParticipant } from '@livekit/components-react';
import { ConnectionState } from 'livekit-client';
import { FloatingCameraSurface } from './VideoCallPanel';
import { useMediaCall } from './LiveKitMediaProvider';
import { useRoom } from '../context/RoomContext';
import { clampCallRect, resizeCallRect } from '../utils/floatingCall';
import './video-call.css';

const STORAGE_KEY = 'watchly-floating-call';
export default function FloatingVideoCall({ visible, onRestore }) {
    const [mount] = useState(() => Object.assign(document.createElement('div'), { className: 'watchly-floating-root' }));
    const [rect, setRect] = useState(() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; } });
    const [minimized, setMinimized] = useState(false);
    const [controlsVisible, setControlsVisible] = useState(false);
    const [wasVisible, setWasVisible] = useState(visible);
    const { act, view } = useMediaCall(), { roomActionsEnabled } = useRoom();
    const connection = useConnectionState(), { isCameraEnabled, isMicrophoneEnabled } = useLocalParticipant();
    const idle = useRef(null), controlsHovered = useRef(false), touch = useRef(false);
    const bounds = useRef({ width: innerWidth, height: innerHeight }), gesture = useRef(null), frame = useRef(null);
    const root = useRef(null);
    const scheduleHide = () => {
        clearTimeout(idle.current);
        idle.current = setTimeout(() => {
            if (gesture.current || controlsHovered.current || root.current?.querySelector('button:focus-visible')) return;
            setControlsVisible(false);
        }, touch.current ? 3000 : 2000);
    };
    const reveal = () => { setControlsVisible(true); scheduleHide(); };
    useEffect(() => () => clearTimeout(idle.current), []);
    const fit = useCallback(() => {
        const host = document.fullscreenElement;
        // A <video> itself has no paintable HTML children; our player wrapper
        // is the supported fullscreen surface for an interactive call overlay.
        const target = host && !['VIDEO', 'IFRAME'].includes(host.tagName) ? host : document.body;
        if (mount.parentElement !== target) target.appendChild(mount);
        bounds.current = { width: host?.clientWidth || innerWidth, height: host?.clientHeight || innerHeight };
        setRect(current => clampCallRect(current, bounds.current));
    }, [mount]);
    useEffect(() => {
        if (!visible) return;
        fit(); const observer = new ResizeObserver(fit);
        const fullscreen = () => { observer.disconnect(); if (document.fullscreenElement) observer.observe(document.fullscreenElement); fit(); };
        document.addEventListener('fullscreenchange', fullscreen); window.addEventListener('resize', fit); window.visualViewport?.addEventListener('resize', fit);
        fullscreen();
        return () => { observer.disconnect(); document.removeEventListener('fullscreenchange', fullscreen); window.removeEventListener('resize', fit); window.visualViewport?.removeEventListener('resize', fit); cancelAnimationFrame(frame.current); clearTimeout(idle.current); controlsHovered.current = false; gesture.current = null; mount.remove(); };
    }, [visible, fit, mount]);
    useEffect(() => { if (visible) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rect)); } catch { /* Keep working without storage. */ } } }, [rect, visible]);
    const start = (event, resize) => {
        if (!resize && event.target.closest('button,select,input,a')) return;
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
        touch.current = event.pointerType === 'touch';
        gesture.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, rect, resize, moved: false };
        if (resize || !touch.current) reveal();
    };
    const move = event => {
        if (event.pointerType === 'mouse') { touch.current = false; reveal(); }
        const active = gesture.current; if (!active || active.id !== event.pointerId) return;
        const dx = event.clientX - active.startX, dy = event.clientY - active.startY;
        if (!active.moved && Math.hypot(dx, dy) < 4) return;
        active.moved = true; reveal();
        const next = active.resize ? resizeCallRect(active.rect, bounds.current, active.resize, dx, dy)
            : { ...active.rect, x: active.rect.x + dx, y: active.rect.y + dy };
        cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => setRect(clampCallRect(next, bounds.current)));
    };
    const end = event => {
        const active = gesture.current;
        if (active?.id !== event.pointerId) return;
        gesture.current = null;
        if (event.type === 'pointerup' && touch.current && !active.moved && !active.resize) { setControlsVisible(value => !value); scheduleHide(); }
        else scheduleHide();
    };
    const cancelDrag = event => { if (event.key === 'Escape' && gesture.current) { gesture.current = null; scheduleHide(); event.preventDefault(); } };
    // Reset presentation on each pop-out, including restores from the sidebar.
    if (wasVisible !== visible) { setWasVisible(visible); setControlsVisible(false); setMinimized(false); }
    if (!visible) return null;
    const narrow = rect.width < 260, connected = connection === ConnectionState.Connected;
    const iconButton = (label, action, icon, disabled = false) => <button type="button" aria-label={label} title={label} disabled={disabled} onClick={action}>{icon}</button>;
    return createPortal(<section ref={root} className="floating-video-call" role="region" aria-label="Floating video call" data-minimized={minimized} data-narrow={narrow}
        data-controls-visible={controlsVisible || minimized} style={{ left: rect.x, top: rect.y, width: rect.width, height: minimized ? 48 : rect.height }} onKeyDown={cancelDrag}
        onPointerDown={event => start(event, false)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
        onPointerEnter={event => { if (event.pointerType === 'mouse') { touch.current = false; reveal(); } }} onPointerLeave={() => { controlsHovered.current = false; scheduleHide(); }}
        onFocusCapture={reveal} onBlurCapture={scheduleHide}>
        {!minimized && <FloatingCameraSurface compact={narrow} />}
        {(view.cameraError || view.error) && <p className="floating-call-error" role="alert">{view.cameraError || view.error}</p>}
        <div className="floating-call-overlay"><div className="floating-call-controls" onPointerEnter={event => { controlsHovered.current = event.pointerType === 'mouse'; reveal(); }} onPointerLeave={() => { controlsHovered.current = false; scheduleHide(); }}>
            {iconButton(isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone', () => void act('toggleMicrophone'), isMicrophoneEnabled ? <Mic size={15} /> : <MicOff size={15} />, !connected || view.micBusy)}
            {iconButton(isCameraEnabled ? 'Turn camera off' : 'Turn camera on', () => void act(isCameraEnabled ? 'cameraOff' : 'cameraOn'), isCameraEnabled ? <Camera size={15} /> : <CameraOff size={15} />, view.cameraBusy || (!connected && (connection !== ConnectionState.Disconnected || !roomActionsEnabled)))}
            {iconButton('Fullscreen movie with video call', () => { const surface = document.querySelector('.room-player-surface'); if (document.fullscreenElement) void document.exitFullscreen(); else void surface?.requestFullscreen?.().catch(() => {}); }, <Maximize2 size={14} />)}
            {iconButton(minimized ? 'Expand video call' : 'Minimize video call', () => setMinimized(!minimized), minimized ? <Maximize2 size={14} /> : <Minus size={14} />)}
            {iconButton('Restore video panel', onRestore, <PanelRight size={14} />)}
            {iconButton('Close floating window and restore video panel', onRestore, <X size={14} />)}
        </div></div>
        {!minimized && ['top', 'right', 'bottom', 'left', 'top-left', 'top-right', 'bottom-left', 'bottom-right'].map(edge => {
            const label = edge === 'bottom-right' ? 'Resize video call' : `Resize video call from ${edge}`;
            return <button key={edge} type="button" className="floating-call-resize" data-edge={edge} aria-label={label} title={label} onPointerDown={event => start(event, edge)}
                onKeyDown={event => { if (!event.key.startsWith('Arrow')) return; event.preventDefault(); setRect(current => resizeCallRect(current, bounds.current, edge, event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0, event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0)); }} />;
        })}
    </section>, mount);
}
