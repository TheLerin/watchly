import React, { useEffect, useState } from 'react';
import {
    ArrowRight,
    Crown,
    MoreVertical,
    PlayCircle,
    Shield,
    SkipForward,
    Trash2,
    UserMinus,
    UserPlus,
    UserX,
    Video,
} from 'lucide-react';
import { useRoom } from '../context/RoomContext';
import { AnimatePresence, motion } from 'framer-motion';

const MotionDiv = motion.div;

const roleMeta = {
    Host: {
        icon: <Crown size={11} />,
        label: 'Host',
        className: 'border-white/20 bg-white text-black',
    },
    Moderator: {
        icon: <Shield size={11} />,
        label: 'Mod',
        className: 'border-white/10 bg-white/[0.08] text-zinc-200',
    },
    Viewer: {
        icon: null,
        label: 'Viewer',
        className: 'border-white/10 bg-white/[0.03] text-zinc-500',
    },
};

const ActionItem = ({ icon, label, danger, onClick }) => (
    <button
        onClick={onClick}
        className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition ${danger ? 'text-red-300 hover:bg-red-500/10' : 'text-zinc-200 hover:bg-white/[0.06]'}`}
    >
        {icon}
        {label}
    </button>
);

const UserQueueSidebar = ({ compact = false }) => {
    const {
        users,
        currentUser,
        promoteUser,
        demoteUser,
        transferHost,
        kickUser,
        queue,
        removeFromQueue,
        playNext,
    } = useRoom();
    const [openMenuId, setOpenMenuId] = useState(null);
    const isPrivileged = currentUser?.role === 'Host' || currentUser?.role === 'Moderator';

    useEffect(() => {
        const close = () => setOpenMenuId(null);
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, []);

    return (
        <div className={`flex flex-col ${compact ? '' : 'h-full gap-3'}`}>
            <section className={compact ? '' : 'flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/70'}>
                <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
                    <div>
                        <h3 className="text-sm font-bold text-white">Members</h3>
                        <p className="text-xs text-zinc-600">{users.length} online</p>
                    </div>
                </div>

                <div className="space-y-1 overflow-y-auto p-2">
                    {users.map(user => {
                        const isMe = currentUser?.id === user.id;
                        const canManage = currentUser && !isMe && (
                            currentUser.role === 'Host' ||
                            (currentUser.role === 'Moderator' && user.role === 'Viewer')
                        );
                        const role = roleMeta[user.role] || roleMeta.Viewer;

                        return (
                            <div key={user.id} className="group relative">
                                <div className="flex items-center gap-2 rounded-2xl border border-transparent px-2.5 py-2 transition hover:border-white/10 hover:bg-white/[0.04]">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-xs font-bold text-black">
                                        {user.nickname?.[0]?.toUpperCase() || '?'}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            <span className="truncate text-sm font-semibold text-white">{user.nickname}</span>
                                            {isMe && <span className="rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] font-bold text-zinc-500">You</span>}
                                        </div>
                                        <span className={`mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${role.className}`}>
                                            {role.icon}
                                            {role.label}
                                        </span>
                                    </div>
                                    {canManage && (
                                        <button
                                            onClick={e => {
                                                e.stopPropagation();
                                                setOpenMenuId(openMenuId === user.id ? null : user.id);
                                            }}
                                            className="flex h-8 w-8 items-center justify-center rounded-xl text-zinc-500 opacity-0 transition hover:bg-white/[0.06] hover:text-white group-hover:opacity-100 focus:opacity-100"
                                        >
                                            <MoreVertical size={14} />
                                        </button>
                                    )}
                                </div>

                                <AnimatePresence>
                                    {openMenuId === user.id && (
                                        <MotionDiv
                                            initial={{ opacity: 0, scale: 0.96, y: -4 }}
                                            animate={{ opacity: 1, scale: 1, y: 0 }}
                                            exit={{ opacity: 0, scale: 0.96, y: -4 }}
                                            transition={{ duration: 0.14 }}
                                            className="absolute right-8 top-9 z-50 w-48 rounded-2xl border border-white/10 bg-black p-1.5 shadow-2xl shadow-black/70"
                                        >
                                            {currentUser.role === 'Host' && user.role === 'Viewer' && (
                                                <ActionItem icon={<UserPlus size={14} />} label="Promote to mod" onClick={() => { promoteUser(user.id); setOpenMenuId(null); }} />
                                            )}
                                            {currentUser.role === 'Host' && user.role === 'Moderator' && (
                                                <ActionItem icon={<UserMinus size={14} />} label="Demote to viewer" onClick={() => { demoteUser(user.id); setOpenMenuId(null); }} />
                                            )}
                                            {currentUser.role === 'Host' && (
                                                <ActionItem icon={<ArrowRight size={14} />} label="Transfer host" onClick={() => { transferHost(user.id); setOpenMenuId(null); }} />
                                            )}
                                            <div className="my-1 h-px bg-white/10" />
                                            <ActionItem icon={<UserX size={14} />} label="Kick user" danger onClick={() => { kickUser(user.id); setOpenMenuId(null); }} />
                                        </MotionDiv>
                                    )}
                                </AnimatePresence>
                            </div>
                        );
                    })}
                </div>
            </section>

            <section
                className={compact ? 'border-t border-white/10' : 'flex min-h-0 flex-1 flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/70'}
            >
                <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
                    <div className="flex items-center gap-2">
                        <Video size={14} className="text-zinc-500" />
                        <h3 className="text-sm font-bold text-white">Up Next</h3>
                        {queue.length > 0 && (
                            <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold text-zinc-400">
                                {queue.length}
                            </span>
                        )}
                    </div>
                    {isPrivileged && queue.length > 0 && (
                        <button onClick={playNext} className="flex items-center gap-1 text-xs font-bold text-white transition hover:text-zinc-300">
                            <SkipForward size={12} />
                            Play Next
                        </button>
                    )}
                </div>

                <div className={`space-y-1 overflow-y-auto p-2 ${compact ? 'max-h-40' : 'flex-1'}`}>
                    <AnimatePresence>
                        {queue.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-white/10 p-4 text-xs leading-5 text-zinc-600">
                                {isPrivileged ? 'Add a video URL from the player controls to build the room queue.' : 'The queue is empty.'}
                            </div>
                        ) : queue.map((item, idx) => (
                            <MotionDiv
                                key={item.id}
                                initial={{ opacity: 0, x: -8 }}
                                animate={{ opacity: 1, x: 0 }}
                                exit={{ opacity: 0, x: 8 }}
                                transition={{ duration: 0.18 }}
                                className="group/queue flex items-center gap-2 rounded-2xl border border-transparent px-2.5 py-2 transition hover:border-white/10 hover:bg-white/[0.04]"
                            >
                                <span className="w-5 shrink-0 font-mono text-xs text-zinc-600">{idx + 1}</span>
                                <PlayCircle size={14} className="shrink-0 text-zinc-500" />
                                <span className="flex-1 truncate text-xs font-medium text-zinc-400" title={item.label}>{item.label}</span>
                                {isPrivileged && (
                                    <button
                                        onClick={() => removeFromQueue(item.id)}
                                        className="rounded-lg p-1 text-zinc-600 opacity-0 transition hover:bg-red-500/10 hover:text-red-300 group-hover/queue:opacity-100"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                )}
                            </MotionDiv>
                        ))}
                    </AnimatePresence>
                </div>
            </section>
        </div>
    );
};

export default UserQueueSidebar;
