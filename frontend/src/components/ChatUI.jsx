import React, { useEffect, useRef, useState, useMemo } from 'react';
import { Send, Check } from 'lucide-react';
import { useRoom } from '../context/RoomContext';
import { motion, AnimatePresence } from 'framer-motion';

const ROLE_COLOR = { Host: 'var(--text)', Moderator: 'var(--text-sub)' };
const ROLE_BG    = { Host: 'linear-gradient(135deg,var(--accent),var(--accent-2))', Moderator: 'var(--glass-border-top)' };

const Avatar = ({ nickname, role }) => (
    <div className="w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0"
         style={{ color: role==='Host' ? 'var(--btn-text)' : 'var(--text)', background: ROLE_BG[role] || 'var(--glass-border)', boxShadow: role==='Host' ? 'var(--glow-sm)' : 'none' }}>
        {nickname?.[0]?.toUpperCase() || '?'}
    </div>
);

const ChatUI = ({ hideHeader = false }) => {
    const { messages, sendMessage, currentUser } = useRoom();
    const [input, setInput] = useState('');
    const [sent, setSent] = useState(false);
    const bottomRef = useRef(null);

    const msgList = useMemo(() => messages, [messages]);

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [msgList]);

    const handleSend = (e) => {
        e.preventDefault();
        if (!input.trim()) return;
        sendMessage(input.trim());
        setInput('');
        setSent(true);
        setTimeout(() => setSent(false), 1000);
    };

    const isMe = (msg) => !msg.isSystem && msg.nickname === currentUser?.nickname;

    return (
        <div className="flex flex-col h-full overflow-hidden glass-panel rounded-2xl"
             style={{ borderRadius:18, backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}>

            {/* Header */}
            {!hideHeader && (
                <div className="px-4 py-3 shrink-0 flex items-center gap-2"
                     style={{ borderBottom:'1px solid var(--glass-border)' }}>
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                    <h3 className="syne font-semibold text-sm" style={{ color:'var(--text)' }}>Live Chat</h3>
                    <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full"
                          style={{ background:'var(--accent-soft)', color:'var(--accent)', border:'1px solid var(--accent-border)' }}>
                        {msgList.filter(m => !m.isSystem).length}
                    </span>
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 flex flex-col gap-2.5">
                {msgList.length === 0 && (
                    <motion.div initial={{ opacity:0, y:10 }} animate={{ opacity:1, y:0 }}
                        className="flex flex-col items-center justify-center h-full gap-2">
                        <span className="text-3xl">💬</span>
                        <p className="text-xs text-center" style={{ color:'var(--text-muted)' }}>
                            Be the first to say hello 👋
                        </p>
                    </motion.div>
                )}
                <AnimatePresence initial={false}>
                    {msgList.map(msg => (
                        <motion.div key={msg.id}
                            initial={{ opacity:0, y:10, scale:0.96 }}
                            animate={{ opacity:1, y:0, scale:1 }}
                            exit={{ opacity:0 }}
                            transition={{ type:'spring', damping:20, stiffness:300 }}>

                            {msg.isSystem ? (
                                <div className="flex items-center gap-2 my-1">
                                    <div className="flex-1 h-px" style={{ background:'var(--glass-border)' }} />
                                    <p className="text-[10px] italic px-2" style={{ color:'var(--text-muted)' }}>{msg.text}</p>
                                    <div className="flex-1 h-px" style={{ background:'var(--glass-border)' }} />
                                </div>
                            ) : (
                                <div className={`flex gap-2 ${isMe(msg) ? 'flex-row-reverse' : 'flex-row'}`}>
                                    {!isMe(msg) && <Avatar nickname={msg.nickname} role={msg.role} />}
                                    <div className={`flex flex-col gap-0.5 max-w-[78%] ${isMe(msg) ? 'items-end' : 'items-start'}`}>
                                        {!isMe(msg) && (
                                            <span className="text-[10px] font-semibold px-1"
                                                  style={{ color: ROLE_COLOR[msg.role] || 'var(--text-sub)' }}>
                                                {msg.nickname}
                                            </span>
                                        )}
                                        <div className="relative px-3 py-2 text-sm leading-relaxed"
                                             style={isMe(msg)
                                                ? { background:'var(--glass-bg-strong)', color:'var(--text)', border:'1px solid var(--accent-border)', borderBottomRightRadius:4, borderRadius:14, boxShadow:'0 4px 16px var(--accent-glow)' }
                                                : { background:'var(--glass-bg)', color:'var(--text)', border:'1px solid var(--glass-border)', borderTopColor:'var(--glass-border-top)', borderBottomLeftRadius:4, borderRadius:14 }}>
                                            {msg.text}
                                            {!isMe(msg) && msg.role && msg.role !== 'Viewer' && (
                                                <div className="absolute left-0 top-2 bottom-2 w-0.5 rounded-full"
                                                     style={{ background: ROLE_COLOR[msg.role], boxShadow:`0 0 6px ${ROLE_COLOR[msg.role]}` }} />
                                            )}
                                        </div>
                                        <span className="text-[9px] px-1" style={{ color:'var(--text-muted)' }}>{msg.time}</span>
                                    </div>
                                </div>
                            )}
                        </motion.div>
                    ))}
                </AnimatePresence>
                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="p-3 shrink-0" style={{ borderTop:'1px solid var(--glass-border)' }}>
                <form onSubmit={handleSend} className="flex items-center gap-2">
                    <input type="text" value={input} onChange={e => setInput(e.target.value)}
                        maxLength={500} placeholder="Type a message…"
                        className="glass-input flex-1 py-2.5 px-4 rounded-xl text-sm" />
                    <motion.button type="submit"
                        whileTap={{ scale: 0.92 }}
                        className="p-2.5 rounded-xl shrink-0 transition-all"
                        style={{ color: 'var(--btn-text)', background:'linear-gradient(135deg,var(--accent),var(--accent-2))', boxShadow: input.trim() ? 'var(--glow-sm)' : 'none' }}>
                        <AnimatePresence mode="wait">
                            {sent
                                ? <motion.span key="c" initial={{scale:0}} animate={{scale:1}} exit={{scale:0}}><Check size={15}/></motion.span>
                                : <motion.span key="s" initial={{scale:0}} animate={{scale:1}} exit={{scale:0}}><Send size={15}/></motion.span>}
                        </AnimatePresence>
                    </motion.button>
                </form>
            </div>
        </div>
    );
};

export default ChatUI;
