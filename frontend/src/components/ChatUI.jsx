import React, { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { useRoom } from '../context/RoomContext';

const ChatUI = ({ hideHeader = false }) => {
    const { messages, sendMessage } = useRoom();
    const [inputValue, setInputValue] = useState('');
    const bottomRef = useRef(null);

    // Auto-scroll to latest message
    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages]);

    const handleSend = (e) => {
        e.preventDefault();
        if (!inputValue.trim()) return;
        sendMessage(inputValue);
        setInputValue('');
    };

    const getRoleColor = (role) => {
        switch (role) {
            case 'Host': return 'text-purple-400';
            case 'Moderator': return 'text-blue-400';
            default: return 'text-gray-400';
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden rounded-2xl" style={{ background: 'var(--panel-bg)', border: '1px solid var(--border-color)' }}>
            {/* Header — hidden when parent provides its own header (mobile chat sheet) */}
            {!hideHeader && (
                <div className="px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)' }}>
                    <h3 className="font-semibold text-sm" style={{ color: 'var(--text-color)' }}>Live Chat</h3>
                </div>
            )}

            {/* Messages */}
            <div className="flex-1 p-3 sm:p-4 overflow-y-auto space-y-3">
                {messages.length === 0 && (
                    <p className="text-center text-xs text-gray-500 pt-4">No messages yet — say hello! 👋</p>
                )}
                {messages.map(msg => (
                    <div key={msg.id} className="text-sm">
                        {msg.isSystem ? (
                            <p className="text-center text-xs text-gray-500 italic py-1">{msg.text}</p>
                        ) : (
                            <>
                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className={`font-semibold text-xs ${getRoleColor(msg.role)}`}>{msg.user}</span>
                                    <span className="text-[10px] text-gray-500">{msg.time}</span>
                                </div>
                                <div className="inline-block px-3 py-2 rounded-xl rounded-tl-none text-sm" style={{ color: 'var(--text-color)', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.07)' }}>
                                    {msg.text}
                                </div>
                            </>
                        )}
                    </div>
                ))}
                <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="p-3 shrink-0" style={{ borderTop: '1px solid var(--border-color)', background: 'rgba(255,255,255,0.03)' }}>
                <form onSubmit={handleSend} className="flex items-center gap-2">
                    <input
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        maxLength={500}
                        placeholder="Type a message..."
                        className="flex-1 py-2.5 px-4 rounded-xl text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500/50 transition-all"
                        style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid var(--border-color)', color: 'var(--text-color)' }}
                    />
                    <button
                        type="submit"
                        className="p-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition-colors shrink-0"
                    >
                        <Send size={16} />
                    </button>
                </form>
            </div>
        </div>
    );
};

export default ChatUI;
