import React, { useEffect, useRef, useState } from 'react';
import { Send, Check, MessageSquare, X } from 'lucide-react';
import { useRoom } from '../context/RoomContext';
import { motion, AnimatePresence } from 'framer-motion';
import GradientIcon from './GradientIcon';
import ControlIconButton from './ControlIconButton';

const MotionDiv = motion.div;
const MotionButton = motion.button;
const MotionSpan = motion.span;

const roleStyles = {
    Host: {
        color: '#000',
        background: '#fff',
        border: '1px solid rgba(255,255,255,0.24)',
    },
    Moderator: {
        color: '#e4e4e7',
        background: 'rgba(255,255,255,0.10)',
        border: '1px solid rgba(255,255,255,0.14)',
    },
};

const Avatar = ({ nickname, role }) => {
    const style = roleStyles[role] || {
        color: '#d4d4d8',
        background: 'rgba(255,255,255,0.06)',
        border: '1px solid rgba(255,255,255,0.10)',
    };

    return (
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl text-xs font-bold" style={style}>
            {nickname?.[0]?.toUpperCase() || '?'}
        </div>
    );
};

const ChatUI = ({ hideHeader = false, variant = 'classic', className = '', visible = true, onClose }) => {
    const { messages, sendMessage, currentUser } = useRoom();
    const [input, setInput] = useState('');
    const [sent, setSent] = useState(false);
    const listRef = useRef(null);
    const nearBottomRef = useRef(true);
    const sentTimerRef = useRef(null);
    const msgList = messages;

    useEffect(() => {
        const list = listRef.current;
        if (list && visible && nearBottomRef.current) list.scrollTop = list.scrollHeight;
    }, [msgList, visible]);
    useEffect(() => () => clearTimeout(sentTimerRef.current), []);

    const handleSend = (e) => {
        e.preventDefault();
        if (!input.trim()) return;
        sendMessage(input.trim());
        setInput('');
        setSent(true);
        clearTimeout(sentTimerRef.current);
        sentTimerRef.current = setTimeout(() => setSent(false), 1000);
    };

    const isMe = (msg) => !msg.isSystem && msg.nickname === currentUser?.nickname;

    return (
        <div
            className={`room-chat flex h-full min-h-0 min-w-0 flex-col overflow-hidden rounded-3xl border border-white/10 bg-black/70 shadow-2xl shadow-black/30 backdrop-blur-xl ${className}`}
            data-room-variant={variant}
        >
            {!hideHeader && (
                <div className="chat-panel-header flex shrink-0 items-center gap-2 border-b border-white/10 px-4 py-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] text-zinc-400">
                        <MessageSquare size={15} />
                    </span>
                    <div className="chat-panel-title"><h3 className="text-sm font-bold text-white">Live Chat</h3><p>A little closer, wherever you are.</p></div>
                    <span className="chat-message-count ml-auto rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] font-bold text-zinc-400" aria-label={`${msgList.filter(m => !m.isSystem).length} messages`}>
                        {msgList.filter(m => !m.isSystem).length}
                    </span>
                    {onClose && <ControlIconButton label="Close chat" icon={<X size={16} />} onClick={onClose} />}
                </div>
            )}

            <div
                ref={listRef}
                className="chat-message-list flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-x-hidden overflow-y-auto p-3"
                aria-label="Chat messages"
                onScroll={event => {
                    const list = event.currentTarget;
                    nearBottomRef.current = list.scrollHeight - list.scrollTop - list.clientHeight < 64;
                }}
            >
                {msgList.length === 0 && (
                    <MotionDiv
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        className="chat-empty flex h-full flex-col items-center justify-center gap-3 text-center"
                    >
                        <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.03] text-zinc-500">
                            <MessageSquare size={20} />
                        </span>
                        <strong>Share the moment</strong>
                        <p>Reactions, plot twists, or just a hello. Start the conversation.</p>
                    </MotionDiv>
                )}

                <AnimatePresence initial={false}>
                    {msgList.map(msg => (
                        <MotionDiv
                            key={msg.id}
                            className="min-w-0"
                            initial={{ opacity: 0, y: 10, scale: 0.96 }}
                            animate={{ opacity: 1, y: 0, scale: 1 }}
                            exit={{ opacity: 0 }}
                            transition={{ type: 'spring', damping: 20, stiffness: 300 }}
                        >
                            {msg.isSystem ? (
                                <div className="chat-system-message my-1 flex items-center gap-2">
                                    <div className="h-px flex-1 bg-white/10" />
                                    <p className="px-2 text-[10px] italic text-zinc-600">{msg.text}</p>
                                    <div className="h-px flex-1 bg-white/10" />
                                </div>
                            ) : (
                                <div className={`flex gap-2 ${isMe(msg) ? 'flex-row-reverse' : 'flex-row'}`}>
                                    {!isMe(msg) && <Avatar nickname={msg.nickname} role={msg.role} />}
                                    <div className={`flex min-w-0 max-w-[78%] flex-col gap-0.5 ${isMe(msg) ? 'items-end' : 'items-start'}`}>
                                        {!isMe(msg) && (
                                            <span className="px-1 text-[10px] font-semibold text-zinc-400">
                                                {msg.nickname}
                                            </span>
                                        )}
                                        <div className="chat-message-bubble relative max-w-full break-words px-3 py-2 text-sm leading-relaxed" data-own={isMe(msg)}>
                                            {msg.text}
                                        </div>
                                        <span className="chat-message-time px-1 text-[9px] text-zinc-600">{msg.time}</span>
                                    </div>
                                </div>
                            )}
                        </MotionDiv>
                    ))}
                </AnimatePresence>
            </div>

            <div className="chat-composer shrink-0 border-t border-white/10 p-3">
                <form onSubmit={handleSend} className="flex min-w-0 items-center gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        maxLength={500}
                        placeholder="Type a message..."
                        aria-label="Message"
                        className="h-11 min-w-0 flex-1 rounded-xl border border-white/10 bg-white/[0.03] px-4 text-sm text-white outline-none transition placeholder:text-zinc-600 focus:border-white/30"
                    />
                    <MotionButton
                        type="submit"
                        aria-label="Send message"
                        title="Send message"
                        whileTap={{ scale: 0.92 }}
                        disabled={!input.trim()}
                        className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-black/40 text-white backdrop-blur-sm transition hover:bg-black/60 disabled:opacity-40"
                    >
                        <AnimatePresence mode="wait">
                            {sent ? (
                                <MotionSpan key="sent" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                                    <GradientIcon><Check size={15} /></GradientIcon>
                                </MotionSpan>
                            ) : (
                                <MotionSpan key="send" initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }}>
                                    <GradientIcon><Send size={15} /></GradientIcon>
                                </MotionSpan>
                            )}
                        </AnimatePresence>
                    </MotionButton>
                </form>
            </div>
        </div>
    );
};

export default ChatUI;
