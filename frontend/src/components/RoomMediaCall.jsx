import { lazy, Suspense } from 'react';
const legacy = import.meta.env.VITE_VOICE_PROVIDER === 'legacy';
const Provider = lazy(() => import('./LiveKitMediaProvider'));
const Panel = lazy(() => import('./VideoCallPanel'));
const Floating = lazy(() => import('./FloatingVideoCall'));
export function MediaCallProvider({ children }) {
    return legacy ? children : <Suspense fallback={<div role="status" className="p-6 text-zinc-400">Loading room…</div>}><Provider>{children}</Provider></Suspense>;
}
export function VideoCallPanel(props) {
    return legacy ? <p className="p-4 text-sm text-zinc-400">Video calling is unavailable in this voice mode.</p>
        : <Suspense fallback={<p role="status">Loading video controls…</p>}><Panel {...props} /></Suspense>;
}
export function FloatingVideoCall(props) {
    return legacy ? null : <Suspense fallback={null}><Floating {...props} /></Suspense>;
}
