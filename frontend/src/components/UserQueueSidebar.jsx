import React, { useEffect, useState } from 'react';
import {
    ArrowRight,
    ArrowUp,
    ArrowDown,
    CheckCircle2,
    CircleDashed,
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
import { canManageMember } from '../utils/roomPermissions';
import RoomAccountActions from './account/InviteFriends';
import Avatar from './account/Avatar';

const MotionDiv = motion.div;

const roleMeta = {
    Host: {
        icon: <Crown size={11} />,
        label: 'Host',
        className: 'border-white/20 bg-white text-black',
    },
    Moderator: {
        icon: <Shield size={11} />,
        label: 'Moderator',
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

const UserQueueSidebar = ({ compact = false, variant = 'classic', className = '' }) => {
    const {
        users,
        currentUser,
        promoteUser,
        demoteUser,
        transferHost,
        kickUser,
        queue,
        removeFromQueue,
        reorderQueue,
        playNext,
        videoState,
        permissions,
        roomActionsEnabled,
        requestControl,
    } = useRoom();
    const [openMenuId, setOpenMenuId] = useState(null);
    const canManageQueue = permissions.canManageQueue;
    const canRequestControl = !permissions.isPlaybackCoordinator && permissions.canRequestControl;

    useEffect(() => {
        const close = () => setOpenMenuId(null);
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, []);

    return (
        <div
            className={`room-members-queue flex flex-col ${compact ? '' : 'h-full gap-3'} ${className}`}
            data-room-variant={variant}
        >
            <section className={compact ? '' : 'flex min-h-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/70'}>
                <div className="room-members-header flex shrink-0 items-center justify-between border-b border-white/10 px-4 py-3">
                    <div className="room-members-heading">
                        <h3 className="text-sm font-bold text-white">Members</h3>
                        <p className="text-xs text-zinc-600">{users.length} online</p>
                    </div>
                    <RoomAccountActions />
                </div>

                <div className="space-y-1 overflow-y-auto p-2">
                    {canRequestControl && <button type="button" onClick={requestControl} className="mb-2 rounded-lg border border-white/10 px-3 py-2 text-xs font-bold text-zinc-300">Take playback control</button>}
                    {users.map(user => {
                        const isMe = currentUser?.id === user.id;
                        const canManage = !isMe && canManageMember(currentUser, user);
                        const role = roleMeta[user.role] || roleMeta.Viewer;

                        return (
                            <div key={user.id} className="group relative">
                                <div className="room-member-row flex items-center gap-2 rounded-2xl border border-transparent px-2.5 py-2 transition hover:border-white/10 hover:bg-white/[0.04]">
                                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white text-xs font-bold text-black">
                                        <Avatar name={user.nickname} url={user.avatarUrl} size={32} />
                                    </div>
                                    <div className="min-w-0 flex-1">
                                        <div className="flex min-w-0 items-center gap-1.5">
                                            <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white" title={user.nickname}>{user.nickname}</span>
                                            {isMe && <span className="shrink-0 rounded-full border border-white/10 px-1.5 py-0.5 text-[9px] font-bold text-zinc-500">You</span>}
                                        </div>
                                        {user.username && <span className="block truncate text-[10px] text-zinc-500">@{user.username}</span>}
                                        <span className={`mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${role.className}`}>
                                            {role.icon}
                                            {role.label}
                                        </span>
                                        {videoState.sourceType === 'local' && (
                                            <span className={`ml-1 mt-1 inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px] font-bold ${user.localReady ? 'border-emerald-500/25 bg-emerald-500/10 text-emerald-400' : 'border-amber-500/20 bg-amber-500/10 text-amber-300'}`}>
                                                {user.localReady ? <CheckCircle2 size={10} /> : <CircleDashed size={10} />}
                                                {user.localReady ? 'Ready' : 'Not ready'}
                                            </span>
                                        )}
                                    </div>
                                    {canManage && (
                                        <button
                                            onClick={e => {
                                                e.stopPropagation();
                                                setOpenMenuId(openMenuId === user.id ? null : user.id);
                                            }}
                                            className="room-member-menu-button flex h-8 w-8 shrink-0 items-center justify-center rounded-xl text-zinc-500 opacity-0 transition hover:bg-white/[0.06] hover:text-white group-hover:opacity-100 focus:opacity-100"
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
                                            className="room-member-menu absolute right-8 top-9 z-50 w-48 rounded-2xl border border-white/10 bg-black p-1.5 shadow-2xl shadow-black/70"
                                        >
                                            {permissions.canAssignRoles && user.role === 'Viewer' && (
                                                <ActionItem icon={<UserPlus size={14} />} label="Promote to mod" onClick={() => { promoteUser(user.id); setOpenMenuId(null); }} />
                                            )}
                                            {permissions.canAssignRoles && user.role === 'Moderator' && (
                                                <ActionItem icon={<UserMinus size={14} />} label="Demote to viewer" onClick={() => { demoteUser(user.id); setOpenMenuId(null); }} />
                                            )}
                                            {permissions.canTransferOwnership && (
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
                    {canManageQueue && queue.length > 0 && (
                        <button disabled={!roomActionsEnabled} onClick={playNext} className="flex items-center gap-1 text-xs font-bold text-white transition hover:text-zinc-300 disabled:opacity-40">
                            <SkipForward size={12} />
                            Play Next
                        </button>
                    )}
                </div>

                <div className={`space-y-1 overflow-y-auto p-2 ${compact ? 'max-h-40' : 'flex-1'}`}>
                    {videoState.sourceType === 'youtube-playlist' && <div className="playlist-up-next space-y-1 border-b border-white/10 pb-3 text-xs">
                        <p className="px-2 py-1 font-bold text-zinc-500">PLAYLIST · NOW PLAYING</p>
                        <p className="truncate rounded-xl bg-white/5 p-2 text-zinc-200">{(videoState.playlistIndex || 0) + 1}. {videoState.playlistTitles?.[videoState.currentVideoId] || 'YouTube Playlist'}</p>
                        <p className="px-2 pt-2 text-[10px] font-bold text-zinc-600">PLAYLIST UP NEXT</p>
                        {(videoState.playlistItems || []).slice(videoState.playlistIndex + 1, videoState.playlistIndex + 21).map((id, offset) => <p key={`${offset}-${id}`} className="truncate px-2 py-1.5 text-zinc-500">{videoState.playlistIndex + offset + 2}. {videoState.playlistTitles?.[id] || `Video ${videoState.playlistIndex + offset + 2}`}{videoState.unavailableIndexes?.includes(videoState.playlistIndex + offset + 1) ? ' · unavailable' : ''}</p>)}
                        {videoState.playlistStatus === 'finished' && <p className="p-2 text-zinc-500">Playlist finished</p>}
                        <p className="px-2 pt-3 font-bold text-zinc-500">WATCHLY ROOM QUEUE</p>
                    </div>}
                    <AnimatePresence>
                        {queue.length === 0 ? (
                            <div className="rounded-2xl border border-dashed border-white/10 p-4 text-xs leading-5 text-zinc-600">
                                {canManageQueue ? 'Add a video URL from the player controls to build the room queue.' : 'The queue is empty.'}
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
                                <span className="min-w-0 flex-1 truncate text-xs font-medium text-zinc-400" title={item.label}>{item.label}</span>
                                {canManageQueue && (
                                    <div className="flex shrink-0 items-center gap-1">
                                        <button type="button" aria-label={`Move queue item ${idx + 1} up`} disabled={!roomActionsEnabled || idx === 0} onClick={() => reorderQueue(item.id, 'up')} className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 disabled:opacity-30"><ArrowUp size={12} /></button>
                                        <button type="button" aria-label={`Move queue item ${idx + 1} down`} disabled={!roomActionsEnabled || idx === queue.length - 1} onClick={() => reorderQueue(item.id, 'down')} className="rounded-lg p-1 text-zinc-400 hover:bg-white/10 disabled:opacity-30"><ArrowDown size={12} /></button>
                                    <button
                                        type="button" aria-label={`Remove queue item ${idx + 1}`} disabled={!roomActionsEnabled}
                                        onClick={() => removeFromQueue(item.id)}
                                        className="rounded-lg p-1 text-zinc-500 transition hover:bg-red-500/10 hover:text-red-300 disabled:opacity-30"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                    </div>
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
