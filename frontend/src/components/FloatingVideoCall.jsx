import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Maximize2, Minus, PanelRight, X } from 'lucide-react';
import { VideoCallContent } from './VideoCallPanel';
import { clampCallRect } from '../utils/floatingCall';
import './video-call.css';

const STORAGE_KEY = 'watchly-floating-call';
export default function FloatingVideoCall({ visible, onRestore }) {
    const [mount] = useState(() => Object.assign(document.createElement('div'), { className: 'watchly-floating-root' }));
    const [rect, setRect] = useState(() => { try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; } catch { return {}; } });
    const [minimized, setMinimized] = useState(false);
    const bounds = useRef({ width: innerWidth, height: innerHeight }), gesture = useRef(null), frame = useRef(null);
    const root = useRef(null);
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
        return () => { observer.disconnect(); document.removeEventListener('fullscreenchange', fullscreen); window.removeEventListener('resize', fit); window.visualViewport?.removeEventListener('resize', fit); cancelAnimationFrame(frame.current); gesture.current = null; mount.remove(); };
    }, [visible, fit, mount]);
    useEffect(() => { if (visible) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(rect)); } catch { /* Keep working without storage. */ } } }, [rect, visible]);
    const start = (event, resize) => {
        if (!resize && event.target.closest('button,select,input,a')) return;
        if (event.button !== 0 || !event.isPrimary) return;
        event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
        gesture.current = { id: event.pointerId, startX: event.clientX, startY: event.clientY, rect, resize };
    };
    const move = event => {
        const active = gesture.current; if (!active || active.id !== event.pointerId) return;
        const dx = event.clientX - active.startX, dy = event.clientY - active.startY;
        const next = active.resize ? { ...active.rect, width: active.rect.width + dx, height: active.rect.height + dy }
            : { ...active.rect, x: active.rect.x + dx, y: active.rect.y + dy };
        if (active.resize) { next.width = Math.min(next.width, bounds.current.width - next.x - 8); next.height = Math.min(next.height, bounds.current.height - next.y - 8); }
        cancelAnimationFrame(frame.current); frame.current = requestAnimationFrame(() => setRect(clampCallRect(next, bounds.current)));
    };
    const end = event => { if (gesture.current?.id === event.pointerId) gesture.current = null; };
    const cancelDrag = event => { if (event.key === 'Escape' && gesture.current) { gesture.current = null; event.preventDefault(); } };
    if (!visible) return null;
    const narrow = rect.width < 260;
    return createPortal(<section ref={root} className="floating-video-call" role="region" aria-label="Floating video call" data-minimized={minimized} data-narrow={narrow}
        style={{ left: rect.x, top: rect.y, width: rect.width, height: minimized ? 48 : rect.height }} onKeyDown={cancelDrag}>
        <header className="floating-call-header" onPointerDown={event => start(event, false)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}>
            <strong>Video Call</strong><div><button type="button" aria-label="Fullscreen movie with video call" onClick={() => { const surface = document.querySelector('.room-player-surface'); if (document.fullscreenElement) void document.exitFullscreen(); else void surface?.requestFullscreen?.().catch(() => {}); }}><Maximize2 size={14} /></button>
                <button type="button" aria-label={minimized ? 'Expand video call' : 'Minimize video call'} onClick={() => setMinimized(!minimized)}>{minimized ? <Maximize2 size={14} /> : <Minus size={14} />}</button>
                <button type="button" aria-label="Restore video panel" onClick={onRestore}><PanelRight size={14} /></button><button type="button" aria-label="Close floating window and restore video panel" onClick={onRestore}><X size={14} /></button></div>
        </header>
        {!minimized && <><VideoCallContent floating compact={narrow} /><button type="button" className="floating-call-resize" aria-label="Resize video call" onPointerDown={event => start(event, true)} onPointerMove={move} onPointerUp={end} onPointerCancel={end} onLostPointerCapture={end}
            onKeyDown={event => { if (!event.key.startsWith('Arrow')) return; event.preventDefault(); setRect(current => clampCallRect({ ...current, width: current.width + (event.key === 'ArrowRight' ? 16 : event.key === 'ArrowLeft' ? -16 : 0), height: current.height + (event.key === 'ArrowDown' ? 16 : event.key === 'ArrowUp' ? -16 : 0) }, bounds.current)); }} /></>}
    </section>, mount);
}
