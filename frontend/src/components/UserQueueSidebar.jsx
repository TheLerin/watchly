import React, { useState, useEffect } from 'react';
import { Crown, Shield, Video, MoreVertical, UserPlus, UserMinus, UserX, ArrowRight, Trash2, PlayCircle, SkipForward } from 'lucide-react';
import { useRoom } from '../context/RoomContext';
import { AnimatePresence, motion } from 'framer-motion';

const ROLE_BG = { Host:'linear-gradient(135deg,#7c3aed,#4f46e5)', Moderator:'linear-gradient(135deg,#2563eb,#4f46e5)' };
const ROLE_GLOW = { Host:'var(--glow-sm-purple)', Moderator:'0 0 12px rgba(59,130,246,0.45)' };

const RoleBadge = ({ role }) => {
    if (role === 'Host')      return <Crown  size={11} style={{ color:'#a78bfa', filter:'drop-shadow(0 0 4px rgba(167,139,250,0.7))' }} />;
    if (role === 'Moderator') return <Shield size={11} style={{ color:'#60a5fa', filter:'drop-shadow(0 0 4px rgba(96,165,250,0.6))' }}  />;
    return null;
};

const CtxItem = ({ icon, label, danger, onClick }) => (
    <button onClick={onClick}
        className="w-full px-3 py-2 text-left text-sm flex items-center gap-2 transition-colors rounded-lg"
        style={{ color: danger ? '#f87171' : 'var(--text)' }}
        onMouseEnter={e => e.currentTarget.style.background = danger ? 'rgba(239,68,68,0.08)' : 'var(--glass-hover)'}
        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
        {icon}{label}
    </button>
);

const UserQueueSidebar = ({ compact = false }) => {
    const { users, currentUser, promoteUser, demoteUser, transferHost, kickUser, queue, removeFromQueue, playNext } = useRoom();
    const [openMenuId, setOpenMenuId] = useState(null);
    const isPrivileged = currentUser?.role === 'Host' || currentUser?.role === 'Moderator';

    useEffect(() => {
        const close = () => setOpenMenuId(null);
        document.addEventListener('click', close);
        return () => document.removeEventListener('click', close);
    }, []);

    return (
        <div className={`flex flex-col ${compact ? '' : 'h-full gap-3'}`}>

            {/* ── Users ── */}
            <div className={compact ? '' : 'glass-panel rounded-2xl overflow-hidden flex flex-col'}>
                <div className="px-4 py-2.5 flex items-center justify-between shrink-0"
                     style={{ borderBottom:'1px solid var(--glass-border)', background:'var(--glass-bg)' }}>
                    <h3 className="syne font-semibold text-sm flex items-center gap-2" style={{ color:'var(--text)' }}>
                        Users <span className="text-xs" style={{ color:'var(--text-muted)' }}>{users.length} online</span>
                    </h3>
                </div>
                <div className="p-2 space-y-0.5 overflow-y-auto">
                    {users.map(user => {
                        const isMe = currentUser?.id === user.id;
                        const canManage = currentUser && !isMe && (currentUser.role==='Host' || (currentUser.role==='Moderator' && user.role==='Viewer'));
                        return (
                            <div key={user.id} className="relative group">
                                <div className="flex items-center justify-between px-2 py-2 rounded-xl transition-all"
                                     onMouseEnter={e => e.currentTarget.style.background='var(--glass-hover)'}
                                     onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                                    <div className="flex items-center gap-2.5">
                                        <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold text-white shrink-0"
                                             style={{ background: ROLE_BG[user.role] || 'var(--glass-border)', boxShadow: ROLE_GLOW[user.role] || 'none' }}>
                                            {user.nickname?.[0]?.toUpperCase() || '?'}
                                        </div>
                                        <div className="flex items-center gap-1.5">
                                            <span className="text-sm font-medium" style={{ color:'var(--text)' }}>{user.nickname}</span>
                                            {isMe && <span className="text-[10px] px-1.5 py-0.5 rounded-full" style={{ color:'var(--text-muted)', background:'var(--glass-bg)', border:'1px solid var(--glass-border)' }}>you</span>}
                                            <RoleBadge role={user.role} />
                                        </div>
                                    </div>
                                    {canManage && (
                                        <button onClick={e => { e.stopPropagation(); setOpenMenuId(openMenuId===user.id ? null : user.id); }}
                                            className="p-1 rounded-lg opacity-0 group-hover:opacity-100 focus:opacity-100 transition-all"
                                            style={{ color:'var(--text-muted)', background:'var(--glass-bg)' }}>
                                            <MoreVertical size={13}/>
                                        </button>
                                    )}
                                </div>
                                <AnimatePresence>
                                    {openMenuId===user.id && (
                                        <motion.div
                                            initial={{ opacity:0, scale:0.94, y:-4 }} animate={{ opacity:1, scale:1, y:0 }}
                                            exit={{ opacity:0, scale:0.94, y:-4 }} transition={{ duration:0.14 }}
                                            className="absolute right-8 top-8 w-44 z-50 p-1.5"
                                            style={{ borderRadius:14, background:'var(--glass-bg-strong)', border:'1px solid var(--glass-border)', borderTopColor:'var(--glass-border-top)', backdropFilter:'blur(20px)', boxShadow:'var(--glass-shadow)' }}>
                                            {currentUser.role==='Host' && user.role==='Viewer'    && <CtxItem icon={<UserPlus  size={13} style={{ color:'#60a5fa' }}/>} label="Promote to Mod"   onClick={() => { promoteUser(user.id); setOpenMenuId(null); }} />}
                                            {currentUser.role==='Host' && user.role==='Moderator' && <CtxItem icon={<UserMinus size={13} style={{ color:'var(--text-muted)' }}/>} label="Demote to Viewer" onClick={() => { demoteUser(user.id); setOpenMenuId(null); }} />}
                                            {currentUser.role==='Host' && <CtxItem icon={<ArrowRight size={13} style={{ color:'var(--accent)' }}/>} label="Transfer Host" onClick={() => { transferHost(user.id); setOpenMenuId(null); }} />}
                                            <div style={{ height:1, background:'var(--glass-border)', margin:'4px 0' }} />
                                            <CtxItem icon={<UserX size={13}/>} label="Kick User" danger onClick={() => { kickUser(user.id); setOpenMenuId(null); }} />
                                        </motion.div>
                                    )}
                                </AnimatePresence>
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Queue ── */}
            <div className={compact ? '' : 'glass-panel rounded-2xl overflow-hidden flex flex-col flex-1'}
                 style={compact ? { borderTop:'1px solid var(--glass-border)' } : {}}>
                <div className="px-4 py-2.5 flex items-center justify-between shrink-0"
                     style={{ borderBottom:'1px solid var(--glass-border)', background:'var(--glass-bg)' }}>
                    <h3 className="syne font-semibold text-sm flex items-center gap-2" style={{ color:'var(--text)' }}>
                        <Video size={13} style={{ color:'var(--text-sub)' }} /> Up Next
                        {queue.length > 0 && (
                            <span className="text-xs px-1.5 py-0.5 rounded-full" style={{ background:'var(--accent-soft)', color:'var(--accent)', border:'1px solid var(--accent-border)' }}>
                                {queue.length}
                            </span>
                        )}
                    </h3>
                    {isPrivileged && queue.length > 0 && (
                        <button onClick={playNext} className="flex items-center gap-1 text-xs font-semibold transition-colors"
                            style={{ color:'var(--accent)' }}
                            onMouseEnter={e => e.currentTarget.style.color='#c4b5fd'}
                            onMouseLeave={e => e.currentTarget.style.color='var(--accent)'}>
                            <SkipForward size={12}/> Play Next
                        </button>
                    )}
                </div>
                <div className={`p-2 space-y-1 overflow-y-auto ${compact ? 'max-h-36' : 'flex-1'}`}>
                    <AnimatePresence>
                        {queue.length === 0 ? (
                            <p className="text-xs p-3" style={{ color:'var(--text-muted)' }}>
                                {isPrivileged ? 'Add URLs to the queue below.' : 'Queue is empty.'}
                            </p>
                        ) : queue.map((item, idx) => (
                            <motion.div key={item.id}
                                initial={{ opacity:0, x:-8 }} animate={{ opacity:1, x:0 }} exit={{ opacity:0, x:8 }}
                                transition={{ duration:0.18 }}
                                className="flex items-center gap-2 px-2 py-2 rounded-xl group/q transition-all"
                                onMouseEnter={e => e.currentTarget.style.background='var(--glass-hover)'}
                                onMouseLeave={e => e.currentTarget.style.background='transparent'}>
                                <span className="text-xs w-4 shrink-0 font-mono" style={{ color:'var(--text-muted)' }}>{idx+1}</span>
                                <PlayCircle size={12} style={{ color:'var(--text-muted)', flexShrink:0 }}/>
                                <span className="text-xs flex-1 truncate" style={{ color:'var(--text-sub)' }} title={item.label}>{item.label}</span>
                                {isPrivileged && (
                                    <button onClick={() => removeFromQueue(item.id)}
                                        className="opacity-0 group-hover/q:opacity-100 transition-all p-0.5 rounded"
                                        style={{ color:'var(--text-muted)' }}
                                        onMouseEnter={e => e.currentTarget.style.color='#f87171'}
                                        onMouseLeave={e => e.currentTarget.style.color='var(--text-muted)'}>
                                        <Trash2 size={11}/>
                                    </button>
                                )}
                            </motion.div>
                        ))}
                    </AnimatePresence>
                </div>
            </div>
        </div>
    );
};

export default UserQueueSidebar;
