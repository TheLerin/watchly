import GradientLabel from './GradientLabel';
import { useEffect, useState } from 'react';
import { useRoom } from '../context/RoomContext';
import { ROOM_NAME_MAX_LENGTH } from '../../../shared/room-name.mjs';

const button = 'rounded-lg border border-white/15 px-3 py-2 text-xs text-zinc-200 disabled:opacity-40 hover:bg-white/10';
export default function RoomAccessPanel() {
    const { roomAccess, currentUser, roomId, accessRequest } = useRoom();
    const [password, setPassword] = useState(''), [invite, setInvite] = useState('');
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    const [optimisticPolicy, setOptimisticPolicy] = useState(null);
    const [roomName, setRoomName] = useState('');
    useEffect(() => { setRoomName(roomAccess?.policy?.roomName || ''); }, [roomAccess?.policy?.roomName]);
    const managing = ['Host', 'Moderator'].includes(currentUser?.role), host = currentUser?.role === 'Host';
    useEffect(() => { if (managing) void accessRequest('room:access-get').catch(() => {}); }, [managing, accessRequest]);
    if (!managing || !roomAccess?.policy) return null;
    const policy = optimisticPolicy || roomAccess.policy;
    const run = async (event, payload, then) => {
        setBusy(true); setError('');
        try { const result = await accessRequest(event, payload); then?.(result); }
        catch (failure) { setError(failure.message); }
        finally { setBusy(false); setOptimisticPolicy(null); }
    };
    const update = fields => {
        setOptimisticPolicy({ ...policy, ...fields });
        return run('room:access-update', { revision: policy.revision, ...fields });
    };
    return <details className="border-t border-white/10 px-4 py-3 text-xs text-zinc-300" data-testid="room-access-panel">
        <summary className="cursor-pointer font-semibold text-white"><GradientLabel>Room access</GradientLabel></summary>
        <div className="mt-3 space-y-3">
            {host && <>
                <form onSubmit={event => { event.preventDefault(); if (!busy) void update({ roomName }); }}>
                    <label htmlFor="room-display-name">Room name</label>
                    <input id="room-display-name" type="text" maxLength={ROOM_NAME_MAX_LENGTH} value={roomName} disabled={busy} onChange={event => setRoomName(event.target.value)} placeholder="Friday movie night" className="mt-2 w-full rounded-lg border border-white/15 bg-black/50 p-2" />
                    <button type="submit" className={`${button} mt-2`} disabled={busy || roomName === (policy.roomName || '')}><GradientLabel>Save room name</GradientLabel></button>
                </form>
                <label className="flex items-center justify-between gap-2">Entry
                    <select aria-label="Room visibility" value={policy.visibility} disabled={busy} onChange={event => update({ visibility: event.target.value })} className="rounded-lg border border-white/15 bg-zinc-950 p-2">
                        <option value="public">Room code</option><option value="private">Invitation only</option>
                    </select>
                </label>
                {[["locked", "Lock new joins"], ["accountOnly", "Require sign-in"], ["approvalRequired", "Approve new participants"]].map(([field, label]) => <label key={field} className="flex items-center gap-2"><input type="checkbox" checked={policy[field]} disabled={busy} onChange={event => update({ [field]: event.target.checked })} />{label}</label>)}
                <div><label htmlFor="room-access-password">{policy.hasPassword ? 'Change room password' : 'Set room password'}</label>
                    <input id="room-access-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} value={password} onChange={event => setPassword(event.target.value)} className="mt-2 w-full rounded-lg border border-white/15 bg-black/50 p-2" />
                    <div className="mt-2 flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || password.length < 8} onClick={() => run('room:access-update', { revision: policy.revision, password }, () => setPassword(''))}><GradientLabel>Save password</GradientLabel></button>
                        {policy.hasPassword && <button type="button" className={button} disabled={busy} onClick={() => update({ clearPassword: true })}><GradientLabel>Remove password</GradientLabel></button>}</div>
                </div>
            </>}
            <p className="leading-5 text-zinc-500">Existing admitted participants can reconnect. Guest bans follow the saved guest identity; invitation-only entry or approval gives stronger control.</p>
            <button type="button" disabled={busy} className={button} onClick={() => run('room:invite-create', { ttlSeconds: 3600, maxUses: 10 }, result => { const link = new URL(`/room/${roomId}`, window.location.origin); link.searchParams.set('invite', result.inviteToken); setInvite(link.href); })}><GradientLabel>Create 1-hour invitation</GradientLabel></button>
            {invite && <div className="space-y-2"><input aria-label="Invitation link" readOnly value={invite} className="w-full rounded-lg border border-white/15 bg-black/50 p-2" /><button type="button" className={button} onClick={() => navigator.clipboard.writeText(invite).catch(() => setError('Copy the invitation from the field above.'))}><GradientLabel>Copy invitation</GradientLabel></button></div>}
            {(roomAccess.invites || []).map(value => <div key={value.id} className="flex items-center justify-between gap-2"><span>{value.maxUses - value.uses} uses · expires {new Date(value.expiresAt).toLocaleTimeString()}</span><button type="button" className={button} disabled={busy} onClick={() => run('room:invite-revoke', { inviteId: value.id }, () => setInvite(''))}><GradientLabel>Revoke</GradientLabel></button></div>)}
            {(roomAccess.pending || []).map(value => <div key={value.id} className="space-y-2 rounded-lg border border-white/10 p-2"><p>{value.nickname} requests to join</p><div className="flex gap-2"><button type="button" className={button} disabled={busy} onClick={() => run('room:admission-decide', { requestId: value.id, approve: true })}><GradientLabel>Approve</GradientLabel></button><button type="button" className={button} disabled={busy} onClick={() => run('room:admission-decide', { requestId: value.id, approve: false })}><GradientLabel>Decline</GradientLabel></button></div></div>)}
            {(roomAccess.bans || []).filter(value => host || value.role === 'Viewer').map(value => <div key={value.memberId} className="flex items-center justify-between gap-2"><span>{value.nickname} · banned</span><button type="button" className={button} disabled={busy} onClick={() => run('room:unban', { memberId: value.memberId })}><GradientLabel>Unban</GradientLabel></button></div>)}
            {error && <p role="alert" className="text-red-300">{error}</p>}
        </div>
    </details>;
}
