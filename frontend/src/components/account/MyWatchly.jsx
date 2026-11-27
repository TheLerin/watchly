import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertCircle, History, LogIn, Mail, MoreHorizontal, Plus, Search, UserPlus, Users } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useRoom } from '../../context/RoomContext';
import useSocial from '../../hooks/useSocial';
import { readRecentRooms } from '../../utils/recentRooms';
import { RoomLauncher } from '../LandingPage';
import { AccountGate } from './AuthPages';
import AccountShell from './AccountShell';
import Avatar from './Avatar';
import GradientLabel from '../GradientLabel';
import './my-watchly.css';

export const Person = ({ person, children, status }) => (
    <div className="person-row">
        <Avatar name={person.display_name} url={person.avatar_url} size={40} />
        <div className="person-name">
            <strong title={person.display_name}>{person.display_name}</strong>
            <span>@{person.username}</span>
            {status && <span className={`person-presence is-${status}`}>
                {status === 'in_room' ? 'In a room' : status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Presence unavailable'}
            </span>}
        </div>
        <div className="person-actions">{children}</div>
    </div>
);

function FriendMenu({ username, disabled, onRemove, onBlock }) {
    const root = useRef(null);
    const [open, setOpen] = useState(false);
    useLayoutEffect(() => {
        const details = root.current, trigger = details.querySelector('summary'), menu = details.querySelector('div');
        if (!open) { menu.style.visibility = 'hidden'; return; }
        const bounds = trigger.getBoundingClientRect();
        const height = menu.getBoundingClientRect().height;
        menu.style.left = `${Math.max(8, Math.min(bounds.right - 150, window.innerWidth - 158))}px`;
        menu.style.top = `${bounds.bottom + height + 8 > window.innerHeight ? Math.max(8, bounds.top - height - 6) : bounds.bottom + 6}px`;
        menu.style.visibility = 'visible';
        const close = event => {
            if (event.type === 'pointerdown' && details.contains(event.target)) return;
            if (event.type === 'keydown' && event.key !== 'Escape') return;
            details.open = false;
            if (event.type === 'keydown') trigger.focus();
        };
        window.addEventListener('scroll', close, true); window.addEventListener('resize', close);
        document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
        return () => {
            window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close);
            document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close);
        };
    }, [open]);
    return <details ref={root} className="person-menu" onToggle={event => setOpen(event.currentTarget.open)}>
        <summary aria-label={`Options for @${username}`}><MoreHorizontal size={19} aria-hidden="true" /></summary>
        <div>
            <button disabled={disabled} onClick={onRemove}><GradientLabel>Remove friend</GradientLabel></button>
            <button disabled={disabled} onClick={onBlock}><GradientLabel>Block</GradientLabel></button>
        </div>
    </details>;
}

function MyWatchlyContent() {
    const { profile } = useAuth(), room = useRoom(), social = useSocial(), navigate = useNavigate();
    const [query, setQuery] = useState(''), [results, setResults] = useState([]), [searchError, setSearchError] = useState(''), [searching, setSearching] = useState(false);
    const [pending, setPending] = useState(new Set()), [launcher, setLauncher] = useState(false), [tab, setTab] = useState('create'), [code, setCode] = useState('');
    const [launchError, setLaunchError] = useState('');
    const [roomName, setRoomName] = useState('');
    const searchPeople = social.search;
    const busyRef = useRef(new Set());
    const [searchOpen, setSearchOpen] = useState(false);
    const searchInputRef = useRef(null), findFriendsRef = useRef(null);
    const [recent] = useState(() => readRecentRooms(localStorage).sort((a, b) => b.visitedAt - a.visitedAt).slice(0, 5));
    useEffect(() => {
        let active = true;
        const timer = setTimeout(async () => {
            setSearchError('');
            if (query.replace(/^@/, '').trim().length < 3) { setResults([]); setSearching(false); return; }
            setSearching(true);
            try { const found = await searchPeople(query); if (active) setResults(found); }
            catch (error) { if (active) setSearchError(error.message); }
            finally { if (active) setSearching(false); }
        }, 300);
        return () => { clearTimeout(timer); active = false; };
    }, [query, searchPeople]);
    const run = async (key, operation) => {
        if (busyRef.current.has(key)) return;
        busyRef.current.add(key); setPending(new Set(busyRef.current));
        try { await operation(); } catch (error) { toast.error(error.message); }
        finally { busyRef.current.delete(key); setPending(new Set(busyRef.current)); }
    };
    const launch = async action => run('launch', async () => {
        if (action === 'join' && !/^[A-Z0-9]{7}$/.test(code.trim())) return;
        setLaunchError('');
        try {
            const response = action === 'create' ? await room.createRoom(profile.display_name, roomName) : await room.joinRoom(code.trim().toUpperCase(), profile.display_name);
            setLauncher(false); navigate(`/room/${response.roomId}`);
        } catch (error) { setLaunchError(error.message); }
    });
    const closeLauncher = useCallback(() => setLauncher(false), []);
    const friends = new Set(social.friends.map(friend => friend.id));
    const blocked = new Set(social.blocks.map(person => person.id));
    const visibleResults = results.filter(person => !blocked.has(person.id));
    const greeting = new Date().getHours() < 12 ? 'Good morning' : new Date().getHours() < 18 ? 'Good afternoon' : 'Good evening';
    const toggleSearch = () => {
        setSearchOpen(!searchOpen);
        if (!searchOpen) requestAnimationFrame(() => searchInputRef.current?.focus());
    };
    const canInvite = Boolean(room.roomId && room.permissions.canChangeSource && room.roomActionsEnabled);
    const inviteHint = !room.roomId ? 'Create or join a room to invite friends.'
        : !room.permissions.canChangeSource ? 'Only the host and moderators can invite friends.'
        : !room.roomActionsEnabled ? 'Reconnect to your room to invite friends.' : '';

    return (
        <AccountShell className="my-watchly-page" compactActions>
            <div className="my-watchly-heading">
                <div>
                    <p className="account-eyebrow">MY WATCHLY</p>
                    <h1>{greeting}, {profile.display_name}</h1>
                    <p className="account-muted">Your people, rooms and watch nights.</p>
                </div>
                <div className="my-watchly-room-actions" role="group" aria-label="Room actions">
                    <button className="account-primary" onClick={() => { setTab('create'); setLaunchError(''); setLauncher(true); }}>
                        <Plus size={17} aria-hidden="true" /><GradientLabel>Create room</GradientLabel>
                    </button>
                    <button className="account-secondary" onClick={() => { setTab('join'); setLaunchError(''); setLauncher(true); }}>
                        <LogIn size={17} aria-hidden="true" /><GradientLabel>Join room</GradientLabel>
                    </button>
                </div>
            </div>

            {social.error && <div className="account-notice my-watchly-error" role="alert">
                <AlertCircle size={18} aria-hidden="true" /><span>{social.error}</span>
                <button className="account-text-action" onClick={social.load}><GradientLabel>Retry</GradientLabel></button>
            </div>}

            <div className="my-watchly-sections">
                {(social.invites.length > 0 || social.requests.length > 0) && <div className="my-watchly-alerts">
                    {social.invites.length > 0 && <section className="account-card" aria-labelledby="invites-heading">
                        <div className="my-watchly-section-title"><Mail size={18} aria-hidden="true" /><h2 id="invites-heading">Invites</h2></div>
                        {social.invites.map(invite => <div className="invite-row" key={invite.id}>
                            <p><strong>{invite.sender.display_name}</strong> invited you to <span>Room {invite.room_code}</span></p>
                            <div className="person-actions">
                                <button className="account-primary" disabled={pending.has(invite.id)} onClick={() => run(invite.id, async () => {
                                    const roomCode = await social.checkInvite(invite.id);
                                    const response = await room.joinRoom(roomCode, profile.display_name);
                                    await social.mutate('respond_room_invite', { invite_id: invite.id, accept: true }).catch(() => {});
                                    navigate(`/room/${response.roomId}`);
                                })}><GradientLabel>Join</GradientLabel></button>
                                <button className="account-secondary" disabled={pending.has(invite.id)} onClick={() => run(invite.id, () => social.mutate('respond_room_invite', { invite_id: invite.id, accept: false }))}><GradientLabel>Decline</GradientLabel></button>
                            </div>
                        </div>)}
                    </section>}
                    {social.requests.length > 0 && <section className="account-card" aria-labelledby="requests-heading">
                        <div className="my-watchly-section-title"><UserPlus size={18} aria-hidden="true" /><h2 id="requests-heading">Friend requests</h2></div>
                        {social.requests.map(request => <Person key={request.id} person={request.sender}>
                            <button className="account-primary" disabled={pending.has(request.id)} onClick={() => run(request.id, () => social.mutate('respond_friend_request', { request_id: request.id, accept: true }))}><GradientLabel>Accept</GradientLabel></button>
                            <button className="account-secondary" disabled={pending.has(request.id)} onClick={() => run(request.id, () => social.mutate('respond_friend_request', { request_id: request.id, accept: false }))}><GradientLabel>Decline</GradientLabel></button>
                        </Person>)}
                    </section>}
                </div>}

                <section className="account-card my-watchly-friends" aria-labelledby="friends-heading">
                    <div className="account-section-heading">
                        <div className="my-watchly-section-title"><Users size={18} aria-hidden="true" /><h2 id="friends-heading">Friends</h2></div>
                        <button ref={findFriendsRef} className="account-secondary" aria-expanded={searchOpen} aria-controls="find-people" onClick={toggleSearch}>
                            <Search size={15} aria-hidden="true" /><GradientLabel>Find friends</GradientLabel>
                        </button>
                    </div>
                    {social.friends.length > 0 && inviteHint && <p className="account-muted my-watchly-invite-hint" id="friends-invite-hint">{inviteHint}</p>}

                    <div className="my-watchly-search" id="find-people" hidden={!searchOpen} onKeyDown={event => {
                        if (event.key === 'Escape') { setSearchOpen(false); findFriendsRef.current?.focus(); }
                    }}>
                        <label className="search-people-label">
                            <Search size={17} aria-hidden="true" />
                            <input ref={searchInputRef} aria-label="Search people by username" placeholder="@username" maxLength={25} autoCapitalize="none" value={query} onChange={event => setQuery(event.target.value)} />
                        </label>
                        <p className="account-muted small">Enter at least 3 characters. Search uses usernames, never email addresses.</p>
                        {searching && <p className="account-muted" role="status">Searching…</p>}
                        {searchError && <p className="account-error" role="alert">{searchError}</p>}
                        {visibleResults.map(person => <Person key={person.id} person={person}>
                            <button className="account-secondary" disabled={pending.has(person.id) || friends.has(person.id) || social.outgoing.includes(person.id)} onClick={() => run(person.id, async () => {
                                const status = await social.mutate('request_friend', { target_id: person.id });
                                toast.success(status === 'friends' ? 'You’re now friends.' : 'Friend request sent.');
                            })}><UserPlus size={15} aria-hidden="true" /><GradientLabel>{friends.has(person.id) ? 'Friends' : social.outgoing.includes(person.id) ? 'Requested' : 'Add Friend'}</GradientLabel></button>
                        </Person>)}
                        {!searching && !searchError && query.trim().length >= 3 && !visibleResults.length && <p className="account-muted">No people found.</p>}
                    </div>

                    {social.loading ? <div className="my-watchly-loading" role="status" aria-label="Loading friends">
                        {[0, 1, 2].map(row => <div className="my-watchly-skeleton-row" key={row} aria-hidden="true">
                            <span className="account-skeleton skeleton-avatar" /><div><span className="account-skeleton skeleton-name" /><span className="account-skeleton skeleton-detail" /></div>
                        </div>)}
                    </div> : social.friends.length ? <div className="my-watchly-friend-list" role={social.friends.length > 4 ? 'region' : undefined} aria-label={social.friends.length > 4 ? 'Friends list' : undefined} tabIndex={social.friends.length > 4 ? 0 : undefined}>
                        {social.friends.map(friend => <Person key={friend.id} person={friend} status={social.presence[friend.id] || 'unavailable'}>
                            <button className="account-secondary" disabled={!canInvite || pending.has(friend.id)} aria-describedby={inviteHint ? 'friends-invite-hint' : undefined} onClick={() => run(friend.id, async () => {
                                await social.invite(friend.id); toast.success('Invite sent.');
                            })}><GradientLabel>Invite</GradientLabel></button>
                            <FriendMenu username={friend.username} disabled={pending.has(friend.id)} onRemove={() => run(friend.id, () => social.mutate('remove_friend', { target_id: friend.id }))} onBlock={() => run(friend.id, () => social.mutate('block_person', { target_id: friend.id }))} />
                        </Person>)}
                    </div> : <p className="account-muted my-watchly-empty">
                        {social.error ? 'Your friends are temporarily unavailable.' : 'No friends yet. Find someone by username.'}
                    </p>}
                </section>

                <section className="account-card my-watchly-recent" aria-labelledby="recent-heading">
                    <div className="my-watchly-section-title"><History size={18} aria-hidden="true" /><h2 id="recent-heading">Recent rooms</h2></div>
                    {recent.length ? recent.map(item => <div className="invite-row" key={item.code}>
                        <p><strong>{item.name || `Room ${item.code}`}</strong>{item.name && <span className="my-watchly-recent-code">{item.code}</span>}<span>Last joined {new Date(item.visitedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></p>
                        <button className="account-secondary" disabled={pending.has(item.code)} onClick={() => run(item.code, async () => {
                            const response = await room.joinRoom(item.code, profile.display_name); navigate(`/room/${response.roomId}`);
                        })}><GradientLabel>Rejoin</GradientLabel></button>
                    </div>) : <p className="account-muted my-watchly-empty">Rooms you join will appear here.</p>}
                </section>

                {social.blocks.length > 0 && <section className="account-card my-watchly-blocked">
                    <details>
                        <summary><GradientLabel>Blocked people ({social.blocks.length})</GradientLabel></summary>
                        {social.blocks.map(person => <Person key={person.id} person={person}>
                            <button className="account-secondary" disabled={pending.has(person.id)} onClick={() => run(person.id, () => social.mutate('unblock_person', { target_id: person.id }))}><GradientLabel>Unblock</GradientLabel></button>
                        </Person>)}
                    </details>
                </section>}
            </div>

            <RoomLauncher activeTab={tab} setActiveTab={setTab} open={launcher} busy={pending.has('launch')} error={launchError} onClose={closeLauncher} nickname={profile.display_name} setNickname={() => {}} roomName={roomName} setRoomName={setRoomName} joinCode={code} setJoinCode={setCode} canSubmit={tab === 'create' || /^[A-Z0-9]{7}$/.test(code.trim())} handleCreate={() => launch('create')} handleJoin={() => launch('join')} handleKey={event => { if (event.key === 'Enter') void launch(tab); }} />
        </AccountShell>
    );
}
export default function MyWatchly() { return <AccountGate><MyWatchlyContent /></AccountGate>; }
