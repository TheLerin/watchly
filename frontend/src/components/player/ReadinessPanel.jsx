import React from 'react';
import { AlertCircle, CheckCircle2, FileQuestion, LoaderCircle } from 'lucide-react';
import { useRoom } from '../../context/RoomContext';

const META = {
    READY: ['Ready', 'text-emerald-400', CheckCircle2],
    MISMATCH: ['Different file', 'text-red-400', AlertCircle],
    UNSUPPORTED: ['Unsupported format', 'text-red-400', AlertCircle],
    ERROR: ['File error', 'text-red-400', AlertCircle],
    BUFFERING: ['Buffering', 'text-amber-400', LoaderCircle],
    SELECT_FILE: ['Select file', 'text-zinc-400', FileQuestion]
};

export default function ReadinessPanel({ variant = 'classic', className = '' }) {
    const { users, localReadiness, mediaDescriptor, currentUser, controllerMemberId, requestControl } = useRoom();
    if (!mediaDescriptor) return null;
    return (
        <section className={`room-readiness border-t border-white/10 p-3 ${className}`} data-room-variant={variant} aria-label="Local file readiness">
            <div className="mb-2 flex justify-between text-xs font-bold text-zinc-400">
                <span>Local file readiness</span><span>{localReadiness.readyCount}/{localReadiness.totalCount}</span>
            </div>
            {currentUser?.userId !== controllerMemberId && ['Host', 'Moderator'].includes(currentUser?.role) &&
                <button onClick={requestControl} className="mb-3 rounded-lg border border-white/10 px-2 py-1 text-xs font-bold text-zinc-300">Take playback control</button>}
            <div className="space-y-2">
                {users.map(user => {
                    const state = localReadiness.statuses?.[user.userId] || { status: 'SELECT_FILE' };
                    const [label, color, Icon] = META[state.status] || META.SELECT_FILE;
                    return <div key={user.userId} className="flex items-center justify-between gap-2 text-xs">
                        <span className="truncate text-zinc-300">{user.nickname}</span>
                        <span className={`flex max-w-[65%] items-center gap-1 text-right ${color}`} title={state.reason || label}>
                            <Icon size={13} className="shrink-0" />
                            <span>{label}{state.reason && state.reason !== label ? ` — ${state.reason}` : ''}</span>
                        </span>
                    </div>;
                })}
            </div>
        </section>
    );
}
