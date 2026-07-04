import React, { useEffect, useRef, useState } from 'react';
import {
    Activity,
    ArrowRight,
    Check,
    ChevronRight,
    Clock3,
    Globe2,
    HardDrive,
    Hash,
    Lock,
    MessageSquare,
    Mic,
    MonitorPlay,
    Play,
    Radio,
    ShieldCheck,
    Signal,
    Sparkles,
    User,
    Users,
    Wifi,
    Zap,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useRoom } from '../context/RoomContext';

const MotionArticle = motion.article;
const MotionDiv = motion.div;
const MotionHeader = motion.header;
const MotionSection = motion.section;

export const BackgroundLayers = () => (
    <>
        <div className="bg-base-layer" />
        <div className="fixed inset-0 z-[1] pointer-events-none overflow-hidden">
            <div
                className="absolute inset-0"
                style={{
                    background:
                        'linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)',
                    backgroundSize: '56px 56px',
                    maskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.95), rgba(0,0,0,0.45) 48%, rgba(0,0,0,0.08))',
                    WebkitMaskImage: 'linear-gradient(to bottom, rgba(0,0,0,0.95), rgba(0,0,0,0.45) 48%, rgba(0,0,0,0.08))',
                }}
            />
            <div
                className="absolute inset-0"
                style={{
                    background:
                        'linear-gradient(180deg, rgba(0,0,0,0.18) 0%, rgba(0,0,0,0.72) 52%, rgba(0,0,0,0.96) 100%)',
                }}
            />
        </div>
        <div className="noise-overlay" />
    </>
);

const fadeUp = (delay = 0, y = 18) => ({
    initial: { opacity: 0, y },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1], delay },
});

const navItems = [
    { label: 'Product', target: 'product-preview' },
    { label: 'Features', target: 'features' },
    { label: 'Voice', target: 'voice' },
    { label: 'Trust', target: 'trust' },
];

const features = [
    {
        icon: <MonitorPlay size={18} />,
        title: 'Synchronized playback',
        desc: 'Play, pause, seek, and drift correction stay aligned for everyone in the room.',
    },
    {
        icon: <Mic size={18} />,
        title: 'Premium voice rooms',
        desc: 'A refined call dock keeps mute, leave, participants, and ping visible without stealing focus.',
    },
    {
        icon: <MessageSquare size={18} />,
        title: 'Live room chat',
        desc: 'A compact conversation layer designed for quick reactions while the video stays primary.',
    },
    {
        icon: <HardDrive size={18} />,
        title: 'Drive and direct video',
        desc: 'Stream shared video sources through a clean queue and host-controlled playback flow.',
    },
    {
        icon: <ShieldCheck size={18} />,
        title: 'Roles and control',
        desc: 'Hosts and moderators can guide rooms confidently with clear ownership and queue actions.',
    },
    {
        icon: <Signal size={18} />,
        title: 'Connection-aware UI',
        desc: 'Ping and Wi-Fi quality states show green, yellow, or red before users wonder what is wrong.',
    },
];

const trustItems = [
    'No account required',
    'Private room codes',
    'Host and moderator roles',
    'Connection state visibility',
    'Responsive watch room',
    'Clean reconnect handling',
];

const previewUsers = [
    { name: 'Ari', state: 'Host', active: true },
    { name: 'Sam', state: 'Muted', active: false },
    { name: 'Mia', state: 'Voice', active: true },
];

const roomEvents = [
    'Ari added a video to queue',
    'Mia joined voice',
    'Playback synced at 01:42:18',
];

const LandingPage = () => {
    const navigate = useNavigate();
    const { joinRoom, currentUser, roomId } = useRoom();
    const [nickname, setNickname] = useState('');
    const [joinCode, setJoinCode] = useState('');
    const [activeTab, setActiveTab] = useState('create');
    const actionRef = useRef(null);

    useEffect(() => {
        if (currentUser && roomId) navigate(`/room/${roomId}`);
    }, [currentUser, roomId, navigate]);

    const handleCreate = () => {
        if (!nickname.trim()) return;
        joinRoom(Math.random().toString(36).substring(2, 9).toUpperCase(), nickname.trim());
    };

    const handleJoin = () => {
        if (!nickname.trim() || !joinCode.trim()) return;
        joinRoom(joinCode.trim().toUpperCase(), nickname.trim());
    };

    const handleKey = (e) => {
        if (e.key !== 'Enter') return;
        activeTab === 'create' ? handleCreate() : handleJoin();
    };

    const scrollTo = (target) => {
        document.getElementById(target)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const focusAction = (tab = 'create') => {
        setActiveTab(tab);
        actionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        window.setTimeout(() => document.getElementById('nickname-input')?.focus(), 350);
    };

    const canSubmit = nickname.trim() && (activeTab === 'create' || joinCode.trim());

    return (
        <div className="min-h-screen relative overflow-hidden" style={{ isolation: 'isolate', background: 'var(--bg-base)' }}>
            <BackgroundLayers />

            <MotionHeader
                {...fadeUp(0.05, 8)}
                className="sticky top-0 z-40 border-b border-white/10 bg-black/70 backdrop-blur-xl"
            >
                <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
                    <button onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} className="flex items-center gap-3">
                        <img src="/logo.png" alt="Watchly" className="h-10 w-auto theme-invert" />
                        <span className="text-sm font-bold tracking-tight text-white sm:text-base">Watchly</span>
                    </button>

                    <nav className="hidden items-center rounded-full border border-white/10 bg-white/[0.03] px-2 py-1 md:flex">
                        {navItems.map(item => (
                            <button
                                key={item.target}
                                onClick={() => scrollTo(item.target)}
                                className="rounded-full px-3 py-1.5 text-sm font-medium text-zinc-400 transition hover:bg-white/[0.06] hover:text-white"
                            >
                                {item.label}
                            </button>
                        ))}
                    </nav>

                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => focusAction('join')}
                            className="hidden rounded-lg border border-white/10 px-3 py-2 text-sm font-semibold text-zinc-200 transition hover:border-white/25 hover:bg-white/[0.05] sm:inline-flex"
                        >
                            Join Room
                        </button>
                        <button
                            onClick={() => focusAction('create')}
                            className="rounded-lg bg-white px-3 py-2 text-sm font-bold text-black transition hover:bg-zinc-200"
                        >
                            Create Room
                        </button>
                    </div>
                </div>
            </MotionHeader>

            <main className="relative z-10">
                <section className="mx-auto flex max-w-7xl flex-col items-center px-4 pb-10 pt-10 sm:px-6 sm:pt-14 lg:px-8">
                    <MotionDiv {...fadeUp(0.12)} className="flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-zinc-300">
                        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                        Free. No sign-up. Just paste a link and watch.
                    </MotionDiv>

                    <MotionDiv {...fadeUp(0.2)} className="mt-7 max-w-5xl text-center">
                        <h1 className="text-balance text-5xl font-semibold leading-[0.95] tracking-tight text-white sm:text-6xl lg:text-7xl">
                            Same scene. Same second. Miles apart.
                        </h1>
                        <p className="mx-auto mt-5 max-w-2xl text-base leading-7 text-zinc-400 sm:text-lg">
                            Watchly syncs your video perfectly with friends anywhere in the world — complete with
                            voice chat, live reactions, queue control, and a room that feels like sitting together.
                        </p>
                    </MotionDiv>

                    <MotionDiv {...fadeUp(0.28)} className="mt-7 flex flex-col items-center gap-3 sm:flex-row">
                        <button
                            onClick={() => focusAction('create')}
                            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white px-5 text-sm font-bold text-black transition hover:bg-zinc-200"
                        >
                            Create Room
                            <ArrowRight size={15} />
                        </button>
                        <button
                            onClick={() => focusAction('join')}
                            className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.03] px-5 text-sm font-bold text-white transition hover:border-white/25 hover:bg-white/[0.06]"
                        >
                            Join Existing Room
                        </button>
                    </MotionDiv>

                    <MotionDiv
                        id="product-preview"
                        {...fadeUp(0.36)}
                        className="mt-9 grid w-full gap-4 lg:grid-cols-[1.1fr_0.9fr]"
                    >
                        <ProductPreview />
                        <ActionPanel
                            ref={actionRef}
                            activeTab={activeTab}
                            canSubmit={canSubmit}
                            handleCreate={handleCreate}
                            handleJoin={handleJoin}
                            handleKey={handleKey}
                            joinCode={joinCode}
                            nickname={nickname}
                            setActiveTab={setActiveTab}
                            setJoinCode={setJoinCode}
                            setNickname={setNickname}
                        />
                    </MotionDiv>
                </section>

                <MotionSection id="features" {...fadeUp(0.08)} className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
                    <SectionHeading
                        eyebrow="Built for watching together"
                        title="Every feature designed around the shared moment."
                        desc="Video stays front and center while voice, chat, and queue controls stay within reach — never in the way."
                    />
                    <div className="mt-10 grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 md:grid-cols-2 lg:grid-cols-3">
                        {features.map((feature, index) => (
                            <MotionArticle
                                key={feature.title}
                                {...fadeUp(index * 0.04)}
                                className="group bg-black p-6 transition hover:bg-zinc-950"
                            >
                                <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white transition group-hover:border-white/25">
                                    {feature.icon}
                                </div>
                                <h3 className="mt-5 text-base font-semibold text-white">{feature.title}</h3>
                                <p className="mt-2 text-sm leading-6 text-zinc-500">{feature.desc}</p>
                            </MotionArticle>
                        ))}
                    </div>
                </MotionSection>

                <MotionSection id="voice" {...fadeUp(0.08)} className="border-y border-white/10 bg-white/[0.02] px-4 py-16 sm:px-6 lg:px-8">
                    <div className="mx-auto grid max-w-7xl gap-8 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
                        <div>
                            <p className="text-sm font-semibold text-emerald-400">Talk while you watch</p>
                            <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                                Voice that feels like you're in the same room.
                            </h2>
                            <p className="mt-5 max-w-xl text-base leading-8 text-zinc-400">
                                React, laugh, and talk in real time with compact voice controls that stay out of the way.
                                Connection quality shows instantly through color-coded latency states.
                            </p>
                            <div className="mt-7 grid gap-3 sm:grid-cols-3">
                                {[
                                    ['Fast', '31 ms', '#22c55e'],
                                    ['Okay', '182 ms', '#eab308'],
                                    ['Slow', '421 ms', '#ef4444'],
                                ].map(([label, ping, color]) => (
                                    <div key={label} className="rounded-xl border border-white/10 bg-black px-4 py-3">
                                        <div className="flex items-center gap-2 text-sm font-bold" style={{ color }}>
                                            <Wifi size={15} />
                                            {label}
                                        </div>
                                        <p className="mt-1 text-xs text-zinc-500">{ping}</p>
                                    </div>
                                ))}
                            </div>
                        </div>
                        <VoicePreview />
                    </div>
                </MotionSection>

                <MotionSection id="trust" {...fadeUp(0.08)} className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
                    <div className="grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-start">
                        <SectionHeading
                            eyebrow="Trust by design"
                            title="Transparent rooms where everyone knows what's happening."
                            desc="Roles, connection quality, and room state are always visible — so everyone can focus on watching, not wondering."
                            align="left"
                        />
                        <div className="grid gap-px overflow-hidden rounded-2xl border border-white/10 bg-white/10 sm:grid-cols-2">
                            {trustItems.map(item => (
                                <div key={item} className="flex items-center gap-3 bg-black p-4">
                                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-400">
                                        <Check size={14} />
                                    </span>
                                    <span className="text-sm font-medium text-zinc-300">{item}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </MotionSection>

                <section className="px-4 pb-16 sm:px-6 lg:px-8">
                    <div className="mx-auto max-w-7xl rounded-3xl border border-white/10 bg-white/[0.03] px-6 py-10 text-center sm:px-10 sm:py-14">
                        <p className="text-sm font-semibold text-zinc-500">Ready in seconds</p>
                        <h2 className="mx-auto mt-3 max-w-2xl text-3xl font-semibold tracking-tight text-white sm:text-5xl">
                            Drop a link, share the code, start watching together.
                        </h2>
                        <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
                            <button
                                onClick={() => focusAction('create')}
                                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white px-5 text-sm font-bold text-black transition hover:bg-zinc-200"
                            >
                                Create Room
                                <ChevronRight size={15} />
                            </button>
                            <button
                                onClick={() => focusAction('join')}
                                className="inline-flex h-11 items-center justify-center rounded-lg border border-white/10 px-5 text-sm font-bold text-white transition hover:bg-white/[0.06]"
                            >
                                Join Room
                            </button>
                        </div>
                    </div>
                </section>
            </main>

            <footer className="relative z-10 border-t border-white/10 px-4 py-6 text-center text-xs text-zinc-600">
                © Watchly {new Date().getFullYear()} — Watch together, perfectly in sync.
            </footer>
        </div>
    );
};

const SectionHeading = ({ eyebrow, title, desc, align = 'center' }) => (
    <div className={align === 'center' ? 'mx-auto max-w-3xl text-center' : 'max-w-2xl'}>
        <p className="text-sm font-semibold text-zinc-500">{eyebrow}</p>
        <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-5xl">{title}</h2>
        <p className="mt-5 text-base leading-8 text-zinc-400">{desc}</p>
    </div>
);

const ProductPreview = () => (
    <div className="overflow-hidden rounded-3xl border border-white/10 bg-zinc-950 shadow-2xl shadow-black/60">
        <div className="flex h-12 items-center justify-between border-b border-white/10 bg-black px-4">
            <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                <span className="h-2.5 w-2.5 rounded-full bg-yellow-500" />
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </div>
            <div className="hidden items-center gap-2 rounded-full border border-white/10 px-3 py-1 text-xs font-medium text-zinc-400 sm:flex">
                <Lock size={12} />
                ROOM 8HWXIZR
            </div>
        </div>

        <div className="grid min-h-[480px] gap-px bg-white/10 lg:grid-cols-[1fr_280px]">
            <div className="bg-black p-4">
                <div className="relative flex aspect-video min-h-[260px] items-center justify-center overflow-hidden rounded-2xl border border-white/10 bg-zinc-950">
                    <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4">
                        <span className="rounded-full border border-white/10 bg-black/70 px-3 py-1 text-xs font-semibold text-zinc-300">
                            Playing now
                        </span>
                        <span className="flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3 py-1 text-xs font-semibold text-emerald-400">
                            <Activity size={12} />
                            Synced
                        </span>
                    </div>
                    <div className="flex h-16 w-16 items-center justify-center rounded-full bg-white text-black shadow-xl">
                        <Play size={24} fill="currentColor" />
                    </div>
                    <div className="absolute inset-x-4 bottom-4">
                        <div className="mb-3 flex items-center justify-between text-xs text-zinc-500">
                            <span>01:42:18</span>
                            <span>02:15:04</span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                            <div className="h-full w-[64%] rounded-full bg-white" />
                        </div>
                    </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                    {[
                        ['Latency', '31 ms', <Wifi size={15} />],
                        ['Viewers', '12 active', <Users size={15} />],
                        ['Queue', '4 videos', <Clock3 size={15} />],
                    ].map(([label, value, icon]) => (
                        <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                            <div className="flex items-center gap-2 text-xs font-medium text-zinc-500">{icon}{label}</div>
                            <div className="mt-2 text-sm font-bold text-white">{value}</div>
                        </div>
                    ))}
                </div>
            </div>

            <div className="grid gap-px bg-white/10">
                <div className="bg-black p-4">
                    <div className="mb-3 flex items-center justify-between">
                        <h3 className="text-sm font-bold text-white">Room</h3>
                        <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-[10px] font-bold text-emerald-400">LIVE</span>
                    </div>
                    <div className="space-y-2">
                        {previewUsers.map(user => (
                            <div key={user.name} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] p-2.5">
                                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-xs font-bold text-black">
                                    {user.name.charAt(0)}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <p className="truncate text-xs font-bold text-white">{user.name}</p>
                                    <p className="text-[11px] text-zinc-500">{user.state}</p>
                                </div>
                                <span className={`h-2 w-2 rounded-full ${user.active ? 'bg-emerald-400' : 'bg-zinc-600'}`} />
                            </div>
                        ))}
                    </div>
                </div>

                <div className="bg-black p-4">
                    <h3 className="mb-3 text-sm font-bold text-white">Activity</h3>
                    <div className="space-y-2">
                        {roomEvents.map(event => (
                            <div key={event} className="rounded-xl bg-white/[0.03] px-3 py-2 text-xs text-zinc-400">
                                {event}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    </div>
);

const ActionPanel = React.forwardRef(({
    activeTab,
    canSubmit,
    handleCreate,
    handleJoin,
    handleKey,
    joinCode,
    nickname,
    setActiveTab,
    setJoinCode,
    setNickname,
}, ref) => (
    <div
        ref={ref}
        id="room-action-card"
        className="rounded-3xl border border-white/10 bg-black p-5 shadow-2xl shadow-black/50 sm:p-6"
    >
        <div className="mb-5">
            <p className="text-sm font-semibold text-zinc-500">Start watching</p>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight text-white">Create or join a room.</h2>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
            {[
                { id: 'create', label: 'Create Room' },
                { id: 'join', label: 'Join Room' },
            ].map(tab => (
                <button
                    key={tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className={`rounded-lg px-3 py-2.5 text-sm font-bold transition ${activeTab === tab.id ? 'bg-white text-black' : 'text-zinc-500 hover:text-white'}`}
                >
                    {tab.label}
                </button>
            ))}
        </div>

        <div className="mt-5 space-y-3">
            <label className="block">
                <span className="mb-2 block text-xs font-semibold uppercase text-zinc-600">Nickname</span>
                <span className="relative block">
                    <User size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                    <input
                        id="nickname-input"
                        type="text"
                        placeholder="Your nickname..."
                        value={nickname}
                        maxLength={24}
                        onChange={e => setNickname(e.target.value)}
                        onKeyDown={handleKey}
                        className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-10 pr-3 text-sm font-medium text-white outline-none transition placeholder:text-zinc-700 focus:border-white/30"
                    />
                </span>
            </label>

            <AnimatePresence initial={false}>
                {activeTab === 'join' && (
                    <MotionDiv
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: 'auto' }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                    >
                        <label className="block pt-1">
                            <span className="mb-2 block text-xs font-semibold uppercase text-zinc-600">Room code</span>
                            <span className="relative block">
                                <Hash size={17} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
                                <input
                                    id="room-code-input"
                                    type="text"
                                    placeholder="ROOM CODE"
                                    value={joinCode}
                                    maxLength={10}
                                    onChange={e => setJoinCode(e.target.value.toUpperCase())}
                                    onKeyDown={handleKey}
                                    className="h-12 w-full rounded-xl border border-white/10 bg-white/[0.03] pl-10 pr-3 font-mono text-sm font-bold uppercase tracking-widest text-white outline-none transition placeholder:text-zinc-700 focus:border-white/30"
                                />
                            </span>
                        </label>
                    </MotionDiv>
                )}
            </AnimatePresence>
        </div>

        <button
            id={activeTab === 'create' ? 'create-room-btn' : 'join-room-btn'}
            onClick={activeTab === 'create' ? handleCreate : handleJoin}
            disabled={!canSubmit}
            className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-white text-sm font-bold text-black transition hover:bg-zinc-200 disabled:cursor-not-allowed disabled:opacity-40"
        >
            {activeTab === 'create' ? <Play size={16} fill="currentColor" /> : <Users size={16} />}
            {activeTab === 'create' ? 'Create Room' : 'Join Room'}
            <ChevronRight size={16} />
        </button>

        <div className="mt-5 grid gap-2 text-xs text-zinc-500 sm:grid-cols-3">
            {[
                [<Globe2 size={13} />, 'No signup'],
                [<Radio size={13} />, 'Live sync'],
                [<Sparkles size={13} />, 'Premium UI'],
            ].map(([icon, text]) => (
                <div key={text} className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                    {icon}
                    {text}
                </div>
            ))}
        </div>
    </div>
));

ActionPanel.displayName = 'ActionPanel';

const VoicePreview = () => (
    <div className="rounded-3xl border border-white/10 bg-black p-4 shadow-2xl shadow-black/50">
        <div className="rounded-2xl border border-white/10 bg-zinc-950 p-4">
            <div className="flex items-center gap-3">
                <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-400">
                    <Mic size={19} />
                </div>
                <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-bold text-white">Voice Call</p>
                        <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-400">
                            Live
                        </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">3 users - 08:42 - 31 ms</p>
                </div>
                <button className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-xs font-bold text-emerald-400">
                    Ping
                </button>
            </div>

            <div className="mt-4 grid gap-2">
                {[
                    ['You', 'Mic on', true],
                    ['Sam', 'Muted', false],
                    ['Mia', 'Speaking', true],
                ].map(([name, state, active]) => (
                    <div key={name} className="flex items-center gap-3 rounded-xl border border-white/10 bg-black px-3 py-2.5">
                        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-white text-xs font-bold text-black">
                            {name.charAt(0)}
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="truncate text-xs font-bold text-white">{name}</p>
                            <p className={`text-[11px] ${active ? 'text-emerald-400' : 'text-red-400'}`}>{state}</p>
                        </div>
                        <span className={`h-2.5 w-2.5 rounded-full ${active ? 'bg-emerald-400' : 'bg-red-400'}`} />
                    </div>
                ))}
            </div>
        </div>
    </div>
);

export default LandingPage;
