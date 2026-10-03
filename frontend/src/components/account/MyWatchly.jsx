import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, UserPlus } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useRoom } from '../../context/RoomContext';
import useSocial from '../../hooks/useSocial';
import { readRecentRooms } from '../../utils/recentRooms';
import { RoomLauncher } from '../LandingPage';
import { AccountGate } from './AuthPages';
import AccountShell from './AccountShell';
import Avatar from './Avatar';

export const Person = ({ person, children, status }) => <div className="person-row"><Avatar name={person.display_name} url={person.avatar_url} size={42} /><div className="person-name"><strong>{person.display_name}</strong><span>@{person.username}</span>{status && <span className={`person-presence is-${status}`}>{status === 'in_room' ? 'In a room' : status === 'online' ? 'Online' : status === 'offline' ? 'Offline' : 'Presence unavailable'}</span>}</div><div className="person-actions">{children}</div></div>;

function MyWatchlyContent() {
    const { profile } = useAuth(), room = useRoom(), social = useSocial(), navigate = useNavigate();
    const [query, setQuery] = useState(''), [results, setResults] = useState([]), [searchError, setSearchError] = useState(''), [searching, setSearching] = useState(false);
    const [pending, setPending] = useState(new Set()), [launcher, setLauncher] = useState(false), [tab, setTab] = useState('create'), [code, setCode] = useState('');
    const searchPeople = social.search;
    const busyRef = useRef(new Set());
    const [searchOpen, setSearchOpen] = useState(false);
    const searchInputRef = useRef(null), findFriendsRef = useRef(null);
    const [recent] = useState(() => readRecentRooms(localStorage));
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
        const response = action === 'create' ? await room.createRoom(profile.display_name) : await room.joinRoom(code.trim().toUpperCase(), profile.display_name);
        setLauncher(false); navigate(`/room/${response.roomId}`);
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
    return <AccountShell className="my-watchly-page"><div className="my-watchly-heading"><div><p className="account-eyebrow">MY WATCHLY</p><h1>{greeting}, {profile.display_name}</h1><p className="account-muted">Your people, rooms and watch nights.</p></div><div className="my-watchly-room-actions"><button className="account-primary" onClick={() => { setTab('create'); setLauncher(true); }}><Plus size={18} />Create room</button><button className="account-secondary" onClick={() => { setTab('join'); setLauncher(true); }}>Join room</button></div></div>
        {social.error && <div className="account-notice" role="alert">{social.error}<button className="account-text-action" onClick={social.load}>Retry</button></div>}
        <div className="my-watchly-sections"><section className="account-card my-watchly-friends" aria-labelledby="friends-heading"><div className="account-section-heading"><h2 id="friends-heading">Friends</h2><button ref={findFriendsRef} className="account-secondary" aria-expanded={searchOpen} aria-controls="find-people" onClick={toggleSearch}><Search size={16} />Find friends</button></div>
            <div className="my-watchly-search" id="find-people" hidden={!searchOpen} onKeyDown={event => { if (event.key === 'Escape') { setSearchOpen(false); findFriendsRef.current?.focus(); } }}>
                <label className="search-people-label"><Search size={18} aria-hidden="true" /><input ref={searchInputRef} aria-label="Search people by username" placeholder="@username" maxLength={25} autoCapitalize="none" value={query} onChange={event => setQuery(event.target.value)} /></label>
                <p className="account-muted small">Enter at least 3 characters. Search uses usernames, never email addresses.</p>
                {searching && <p className="account-muted" role="status">Searching…</p>}{searchError && <p className="account-error" role="alert">{searchError}</p>}
                {visibleResults.map(person => <Person key={person.id} person={person}><button className="account-secondary" disabled={pending.has(person.id) || friends.has(person.id) || social.outgoing.includes(person.id)} onClick={() => run(person.id, async () => { const status = await social.mutate('request_friend', { target_id: person.id }); toast.success(status === 'friends' ? 'You’re now friends.' : 'Friend request sent.'); })}><UserPlus size={15} />{friends.has(person.id) ? 'Friends' : social.outgoing.includes(person.id) ? 'Requested' : 'Add Friend'}</button></Person>)}
                {!searching && !searchError && query.trim().length >= 3 && !visibleResults.length && <p className="account-muted">No people found.</p>}
            </div>
            {social.loading ? <div className="my-watchly-loading" role="status" aria-label="Loading friends">{[0, 1, 2].map(row => <div className="my-watchly-skeleton-row" key={row} aria-hidden="true"><span className="account-skeleton skeleton-avatar" /><div><span className="account-skeleton skeleton-name" /><span className="account-skeleton skeleton-detail" /></div></div>)}</div> : social.friends.length ? <div className="my-watchly-friend-list">{social.friends.map(friend => <Person key={friend.id} person={friend} status={social.presence[friend.id] || 'unavailable'}>
                <button className="account-secondary" disabled={!room.roomId || !room.permissions.canChangeSource || !room.roomActionsEnabled || pending.has(friend.id)} title={room.roomId ? 'Host and Moderators can invite to the current room' : 'Join a room to invite friends'} onClick={() => run(friend.id, async () => { await social.invite(friend.id); toast.success('Invite sent.'); })}>Invite</button>
                <details className="person-menu"><summary aria-label={`Options for @${friend.username}`}>•••</summary><div><button disabled={pending.has(friend.id)} onClick={() => run(friend.id, () => social.mutate('remove_friend', { target_id: friend.id }))}>Remove friend</button><button disabled={pending.has(friend.id)} onClick={() => run(friend.id, () => social.mutate('block_person', { target_id: friend.id }))}>Block</button></div></details>
            </Person>)}</div> : <p className="account-muted my-watchly-empty">No friends yet. Find someone by username.</p>}
        </section>
        {(social.invites.length > 0 || social.requests.length > 0) && <div className="my-watchly-alerts">
        {social.invites.length > 0 && <section className="account-card" aria-labelledby="invites-heading"><h2 id="invites-heading">Invites</h2>{social.invites.map(invite => <div className="invite-row" key={invite.id}><p><strong>{invite.sender.display_name}</strong> invited you to <span>Room {invite.room_code}</span></p><div className="person-actions"><button className="account-primary" disabled={pending.has(invite.id)} onClick={() => run(invite.id, async () => { const response = await room.joinRoom(invite.room_code, profile.display_name); await social.mutate('respond_room_invite', { invite_id: invite.id, accept: true }).catch(() => {}); navigate(`/room/${response.roomId}`); })}>Join</button><button className="account-secondary" disabled={pending.has(invite.id)} onClick={() => run(invite.id, () => social.mutate('respond_room_invite', { invite_id: invite.id, accept: false }))}>Decline</button></div></div>)}</section>}
        {social.requests.length > 0 && <section className="account-card" aria-labelledby="requests-heading"><h2 id="requests-heading">Friend requests</h2>{social.requests.map(request => <Person key={request.id} person={request.sender}><button className="account-primary" disabled={pending.has(request.id)} onClick={() => run(request.id, () => social.mutate('respond_friend_request', { request_id: request.id, accept: true }))}>Accept</button><button className="account-secondary" disabled={pending.has(request.id)} onClick={() => run(request.id, () => social.mutate('respond_friend_request', { request_id: request.id, accept: false }))}>Decline</button></Person>)}</section>}
        </div>}
        {recent.length > 0 && <section className="account-card my-watchly-recent" aria-labelledby="recent-heading"><h2 id="recent-heading">Recent rooms</h2>{recent.map(item => <div className="invite-row" key={item.code}><p><strong>Room {item.code}</strong><span>Last joined {new Date(item.visitedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span></p><button className="account-secondary" disabled={pending.has(item.code)} onClick={() => run(item.code, async () => { const response = await room.joinRoom(item.code, profile.display_name); navigate(`/room/${response.roomId}`); })}>Rejoin</button></div>)}</section>}
        {social.blocks.length > 0 && <section className="account-card"><details><summary>Blocked people ({social.blocks.length})</summary>{social.blocks.map(person => <Person key={person.id} person={person}><button className="account-secondary" disabled={pending.has(person.id)} onClick={() => run(person.id, () => social.mutate('unblock_person', { target_id: person.id }))}>Unblock</button></Person>)}</details></section>}
        </div>
        <RoomLauncher activeTab={tab} setActiveTab={setTab} open={launcher} onClose={closeLauncher} nickname={profile.display_name} setNickname={() => {}} joinCode={code} setJoinCode={setCode} canSubmit={!pending.has('launch') && (tab === 'create' || /^[A-Z0-9]{7}$/.test(code.trim()))} handleCreate={() => launch('create')} handleJoin={() => launch('join')} handleKey={event => { if (event.key === 'Enter') void launch(tab); }} />
    </AccountShell>;
}
export default function MyWatchly() { return <AccountGate><MyWatchlyContent /></AccountGate>; }
