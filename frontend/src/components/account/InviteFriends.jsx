import { useCallback, useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useRoom } from '../../context/RoomContext';
import useSocial from '../../hooks/useSocial';
import Avatar from './Avatar';
import AccountActions from './AccountActions';
import { RoomAccountDialog } from './AuthPages';
import AccountDialog from './AccountDialog';

function InviteList({ onClose }) {
    const social = useSocial(), { roomId } = useRoom();
    const [pending, setPending] = useState(null);
    const sent = new Set(social.sentInvites.filter(invite => invite.room_code === roomId).map(invite => invite.receiver_id));
    return <AccountDialog title="Invite friends" onClose={onClose} card><h2>Invite friends</h2><p className="account-muted">Invite someone to Room {roomId}.</p>
        {social.loading ? <div className="account-skeleton" aria-label="Loading friends" /> : social.error ? <><p role="alert">{social.error}</p><button className="account-secondary" onClick={social.load}>Retry</button></> : social.friends.length ? social.friends.map(friend => <div className="person-row" key={friend.id}><Avatar name={friend.display_name} url={friend.avatar_url} /><div className="person-name"><strong>{friend.display_name}</strong><span>@{friend.username}</span><span>{social.presence[friend.id] === 'in_room' ? 'In a room' : social.presence[friend.id] === 'online' ? 'Online' : 'Offline'}</span></div><button className="account-secondary" disabled={pending !== null || sent.has(friend.id)} onClick={async () => { setPending(friend.id); try { await social.invite(friend.id); toast.success('Invite sent.'); } catch (error) { toast.error(error.message); } finally { setPending(null); } }}>{sent.has(friend.id) ? 'Invited' : pending === friend.id ? 'Sending…' : 'Invite'}</button></div>) : <p className="account-muted">No friends yet. Find people in My Watchly after this room.</p>}
    </AccountDialog>;
}
export default function RoomAccountActions() {
    const { user, profile } = useAuth(), { permissions, roomActionsEnabled } = useRoom();
    const [mode, setMode] = useState(null);
    const close = useCallback(() => setMode(null), []);
    return <div className="room-account-actions">
        {profile ? <><AccountActions compact />{permissions.canChangeSource && <button className="account-secondary" disabled={!roomActionsEnabled} onClick={() => setMode('invite')}>Invite friends</button>}</> : <button className="account-secondary" onClick={() => setMode('account')}>{user ? 'Set up profile' : 'Sign in'}</button>}
        {mode === 'invite' && <InviteList onClose={close} />}{mode === 'account' && <RoomAccountDialog onClose={close} />}
    </div>;
}
