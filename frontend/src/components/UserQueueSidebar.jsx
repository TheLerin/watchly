import React, { useState, useEffect } from 'react';
import { Users, Crown, Shield, Video, MoreVertical, UserPlus, UserMinus, UserX, ArrowRight, Trash2, PlayCircle, SkipForward } from 'lucide-react';
import { useRoom } from '../context/RoomContext';
import { AnimatePresence, motion } from 'framer-motion';

// compact = used as an inlined accordion child (no outer wrapper card needed)
const UserQueueSidebar = ({ compact = false }) => {
    const { users, currentUser, promoteUser, demoteUser, transferHost, kickUser, queue, removeFromQueue, playNext } = useRoom();
    const [openMenuId, setOpenMenuId] = useState(null);

    const isPrivileged = currentUser?.role === 'Host' || currentUser?.role === 'Moderator';

    useEffect(() => {
        const handleClickOutside = () => setOpenMenuId(null);
        document.addEventListener('click', handleClickOutside);
        return () => document.removeEventListener('click', handleClickOutside);
    }, []);

    const panelStyle = { background: 'var(--panel-bg)', border: '1px solid var(--border-color)' };
    const headerStyle = { borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)' };

    const content = (
        <>
            {/* ── Users Section ── */}
            <div className={`${compact ? '' : 'flex-1'} overflow-hidden flex flex-col min-h-0 ${compact ? '' : 'rounded-2xl'}`}
                style={compact ? {} : panelStyle}>
                <div className="px-4 py-2.5 flex items-center justify-between shrink-0" style={headerStyle}>
                    <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-color)' }}>
                        <Users size={14} className="text-purple-400" /> Users
                    </h3>
                    <span className="text-xs text-gray-400">{users.length} Online</span>
                </div>
                <div className="overflow-y-auto p-2 space-y-0.5">
                    {users.map(user => (
                        <div key={user.id} className="relative group">
                            <div className="flex items-center justify-between px-2 py-1.5 hover:bg-white/5 rounded-lg transition-colors cursor-default">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium" style={{ color: 'var(--text-color)' }}>
                                        {user.nickname} {currentUser?.id === user.id && <span className="text-xs text-gray-500">(You)</span>}
                                    </span>
                                    {user.role === 'Host' && <Crown size={13} className="text-purple-400" />}
                                    {user.role === 'Moderator' && <Shield size={13} className="text-blue-400" />}
                                </div>

                                {currentUser && currentUser.id !== user.id &&
                                    (currentUser.role === 'Host' || (currentUser.role === 'Moderator' && user.role === 'Viewer')) && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === user.id ? null : user.id); }}
                                            className="p-1 rounded opacity-0 group-hover:opacity-100 focus:opacity-100 hover:bg-white/10 text-gray-400 transition-all"
                                        >
                                            <MoreVertical size={13} />
                                        </button>
                                    )}
                            </div>

                            <AnimatePresence>
                                {openMenuId === user.id && (
                                    <motion.div
                                        initial={{ opacity: 0, y: -4 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        exit={{ opacity: 0, y: -4 }}
                                        className="absolute right-8 top-8 w-44 rounded-xl shadow-xl overflow-hidden z-50 py-1"
                                        style={panelStyle}
                                    >
                                        {currentUser.role === 'Host' && user.role === 'Viewer' && (
                                            <button onClick={() => { promoteUser(user.id); setOpenMenuId(null); }}
                                                className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-white/5 flex items-center gap-2">
                                                <UserPlus size={13} className="text-blue-400" /> Promote to Mod
                                            </button>
                                        )}
                                        {currentUser.role === 'Host' && user.role === 'Moderator' && (
                                            <button onClick={() => { demoteUser(user.id); setOpenMenuId(null); }}
                                                className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-white/5 flex items-center gap-2">
                                                <UserMinus size={13} className="text-gray-400" /> Demote to Viewer
                                            </button>
                                        )}
                                        {currentUser.role === 'Host' && (
                                            <button onClick={() => { transferHost(user.id); setOpenMenuId(null); }}
                                                className="w-full px-3 py-2 text-left text-sm text-gray-200 hover:bg-white/5 flex items-center gap-2">
                                                <ArrowRight size={13} className="text-purple-400" /> Transfer Host
                                            </button>
                                        )}
                                        <button onClick={() => { kickUser(user.id); setOpenMenuId(null); }}
                                            className="w-full px-3 py-2 text-left text-sm text-red-400 hover:bg-red-500/10 flex items-center gap-2 border-t border-white/5 mt-1 pt-2">
                                            <UserX size={13} /> Kick User
                                        </button>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    ))}
                </div>
            </div>

            {/* ── Up Next Queue ── */}
            <div className={`${compact ? '' : 'flex-1'} overflow-hidden flex flex-col min-h-0 ${compact ? '' : 'rounded-2xl'}`}
                style={compact ? { borderTop: '1px solid var(--border-color)' } : panelStyle}>
                <div className="px-4 py-2.5 flex items-center justify-between shrink-0" style={headerStyle}>
                    <h3 className="font-semibold text-sm flex items-center gap-2" style={{ color: 'var(--text-color)' }}>
                        <Video size={14} /> Up Next
                        {queue.length > 0 && (
                            <span className="ml-1 text-xs bg-purple-500/20 text-purple-300 border border-purple-500/30 px-1.5 py-0.5 rounded-full">
                                {queue.length}
                            </span>
                        )}
                    </h3>
                    {isPrivileged && queue.length > 0 && (
                        <button onClick={playNext} className="flex items-center gap-1.5 text-xs text-purple-300 hover:text-purple-200 transition-colors">
                            <SkipForward size={13} /> Play Next
                        </button>
                    )}
                </div>
                <div className={`overflow-y-auto p-2 space-y-1 ${compact ? 'max-h-40' : 'flex-1'}`}>
                    <AnimatePresence>
                        {queue.length === 0 ? (
                            <p className="text-xs text-gray-500 p-3">
                                {isPrivileged ? 'Add URLs with the Queue button.' : 'Queue is empty.'}
                            </p>
                        ) : (
                            queue.map((item, idx) => (
                                <motion.div
                                    key={item.id}
                                    initial={{ opacity: 0, x: -8 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    exit={{ opacity: 0, x: 8 }}
                                    className="flex items-center gap-2 p-2 hover:bg-white/5 rounded-lg group/item"
                                >
                                    <span className="text-xs text-gray-500 w-4 flex-shrink-0">{idx + 1}</span>
                                    <PlayCircle size={13} className="text-gray-500 flex-shrink-0" />
                                    <span className="text-xs text-gray-300 flex-1 truncate" title={item.label}>{item.label}</span>
                                    {isPrivileged && (
                                        <button onClick={() => removeFromQueue(item.id)}
                                            className="opacity-0 group-hover/item:opacity-100 text-gray-500 hover:text-red-400 transition-all">
                                            <Trash2 size={12} />
                                        </button>
                                    )}
                                </motion.div>
                            ))
                        )}
                    </AnimatePresence>
                </div>
            </div>
        </>
    );

    if (compact) {
        // In compact mode (inside accordion) just return user list, no outer card
        return <div className="flex flex-col">{content}</div>;
    }

    return <div className="flex flex-col h-full gap-3">{content}</div>;
};

export default UserQueueSidebar;
