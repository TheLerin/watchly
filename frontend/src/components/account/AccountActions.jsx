import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { LogOut, Plus, UserRound } from 'lucide-react';
import toast from 'react-hot-toast';
import { useAuth } from '../../context/AuthContext';
import { useRoom } from '../../context/RoomContext';
import Avatar from './Avatar';
import './account.css';

export default function AccountActions({ onCreate, compact = false }) {
    const { user, profile, isAuthLoading, isProfileLoading, signOut } = useAuth();
    const { roomId, leaveRoom } = useRoom();
    const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
    const root = useRef(null), navigate = useNavigate();
    useEffect(() => {
        if (!open) return;
        const close = event => { if (event.key === 'Escape' || (event.type === 'pointerdown' && !root.current?.contains(event.target))) setOpen(false); };
        document.addEventListener('pointerdown', close); document.addEventListener('keydown', close);
        return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', close); };
    }, [open]);
    if (isAuthLoading || (user && isProfileLoading)) return <div className="account-nav-skeleton" aria-label="Loading account" />;
    if (!user) return <div className="account-nav-actions"><Link className="account-text-action" to="/auth">Sign in</Link><Link className="account-primary" to="/auth">Get started</Link></div>;
    const name = profile?.display_name || 'Your account';
    return <div className="account-nav-actions" ref={root}>
        {!compact && <Link className="account-text-action" to="/my-watchly">My Watchly</Link>}
        {!compact && onCreate && <button className="account-primary" onClick={onCreate}><Plus size={16} />Create room</button>}
        <div className="account-menu-anchor">
            <button className="account-avatar-button" aria-label="Account menu" aria-expanded={open} onClick={() => setOpen(!open)}><Avatar name={name} url={profile?.avatar_url} /></button>
            {open && <div className="account-menu" aria-label="Your account">
                <strong>{name}</strong><span>{profile ? `@${profile.username}` : 'Finish setting up your profile'}</span>
                <Link to="/my-watchly" onClick={() => setOpen(false)}>My Watchly</Link>
                <Link to={profile ? '/profile' : '/setup-profile'} onClick={() => setOpen(false)}><UserRound size={15} />Profile</Link>
                <hr />
                <button disabled={busy} onClick={async () => {
                    setBusy(true);
                    try { if (roomId) leaveRoom(); await signOut(); setOpen(false); navigate('/'); } catch (error) { toast.error(error.message); }
                    finally { setBusy(false); }
                }}><LogOut size={15} />{roomId ? 'Leave room & sign out' : 'Sign out'}</button>
            </div>}
        </div>
    </div>;
}
