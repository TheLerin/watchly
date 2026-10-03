import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRoom } from '../../context/RoomContext';
import { supabase } from '../../supabase';
import { accountError, normalizeUsername, safeAvatar, safeReturnPath } from '../../utils/account';
import AccountShell from './AccountShell';
import Avatar from './Avatar';
import AccountDialog from './AccountDialog';

export function AccountGate({ children, setup = false }) {
    const auth = useAuth(), location = useLocation();
    if (auth.isAuthLoading || (auth.user && auth.isProfileLoading)) return <AccountShell><div className="account-skeleton" aria-label="Loading account" /></AccountShell>;
    if (!auth.isAuthenticated) return <Navigate to={`/auth?returnTo=${encodeURIComponent(safeReturnPath(location.pathname))}`} replace />;
    if (auth.profileError) return <AccountShell><p role="alert">{auth.profileError}</p><button className="account-primary" onClick={auth.refreshProfile}>Retry profile</button></AccountShell>;
    if (!setup && !auth.profile) return <Navigate to={`/setup-profile?returnTo=${encodeURIComponent(safeReturnPath(location.pathname))}`} replace />;
    return children;
}

export function AuthForm({ destination = '/my-watchly', inRoom = false }) {
    const auth = useAuth();
    const [email, setEmail] = useState(''), [code, setCode] = useState(''), [sent, setSent] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
    const run = async operation => { setBusy(true); setError(''); try { await operation(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } };
    return <section className="account-card auth-card">
        <p className="account-eyebrow">WATCHLY</p><h1>Welcome to Watchly</h1><p className="account-muted">Keep your people close. Keep movie night simple.</p>
        {!auth.configured && <p className="account-notice" role="status">Accounts are not configured yet. You can still create or join a room as a guest.</p>}
        <button className="account-secondary" disabled={busy || !auth.configured || inRoom} onClick={() => run(() => auth.signInWithGoogle(destination))}>Continue with Google</button>
        {inRoom && <p className="account-muted small">Use an email code to keep this room open. Google sign-in is available after you leave the room.</p>}
        <div className="account-divider"><span>or</span></div>
        <form onSubmit={event => { event.preventDefault(); void run(async () => { if (sent) await auth.verifyEmail(email, code); else { await auth.signInWithEmail(email, destination); setSent(true); } }); }}>
            <label>Email<input type="email" autoComplete="email" required maxLength={254} value={email} onChange={event => { setEmail(event.target.value); setSent(false); }} disabled={busy} /></label>
            {sent && <><p className="account-notice" role="status">Check your email for a sign-in code or link.</p><label>Sign-in code<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} /></label></>}
            {error && <p className="account-error" role="alert">{error}</p>}
            <button className="account-primary" disabled={busy || !auth.configured}>{busy ? 'Please wait…' : sent ? 'Verify code' : 'Continue with email'}</button>
            {sent && <button type="button" className="account-text-action" disabled={busy} onClick={() => run(() => auth.signInWithEmail(email, destination))}>Send a new email</button>}
        </form>
        <p className="account-muted small">By continuing, you agree to our <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy policy</Link>.</p>
        {!inRoom && <Link className="account-text-action" to="/">Watch as a guest</Link>}
    </section>;
}

export default function AuthPage() {
    const auth = useAuth(), location = useLocation();
    const destination = safeReturnPath(new URLSearchParams(location.search).get('returnTo'));
    if (auth.user && auth.isProfileLoading) return <AccountShell><div className="account-skeleton" aria-label="Loading profile" /></AccountShell>;
    if (auth.profileError) return <AccountShell><p role="alert">{auth.profileError}</p><button className="account-secondary" onClick={auth.refreshProfile}>Retry profile</button></AccountShell>;
    if (!auth.isAuthLoading && auth.user) return <Navigate to={auth.profile ? destination : `/setup-profile?returnTo=${encodeURIComponent(destination)}`} replace />;
    return <AccountShell>{auth.isAuthLoading ? <div className="account-skeleton" aria-label="Loading account" /> : <AuthForm destination={destination} />}</AccountShell>;
}

export function ProfileForm({ onSaved }) {
    const { user, profile, saveProfile } = useAuth();
    const providerAvatar = safeAvatar(user?.user_metadata?.avatar_url || user?.user_metadata?.picture);
    const [name, setName] = useState(profile?.display_name || String(user?.user_metadata?.full_name || user?.user_metadata?.name || '').slice(0, 24));
    const [username, setUsername] = useState(profile?.username || '');
    const [avatar, setAvatar] = useState(profile?.avatar_url ?? providerAvatar);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    return <section className="account-card auth-card"><p className="account-eyebrow">YOUR WATCHLY</p><h1>{profile ? 'Your profile' : 'Make yourself at home'}</h1>
        <div className="profile-avatar"><Avatar name={name} url={avatar} size={64} /><div><button className="account-text-action" onClick={() => setAvatar(null)}>Use initials</button>{providerAvatar && <button className="account-text-action" onClick={() => setAvatar(providerAvatar)}>Use Google avatar</button>}</div></div>
        <form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { await saveProfile({ displayName: name, username, avatar }); onSaved?.(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }}>
            <label>Display name<input required maxLength={24} autoComplete="nickname" value={name} onChange={event => setName(event.target.value)} /></label>
            <label>Username<span className="username-field"><span aria-hidden="true">@</span><input aria-label="Username" required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]{3,24}" autoCapitalize="none" autoComplete="off" value={username} onChange={event => setUsername(normalizeUsername(event.target.value))} /></span></label>
            <p className="account-muted small">3–24 letters, numbers or underscores. Your email stays private.</p>
            {error && <p className="account-error" role="alert">{error}</p>}
            <button className="account-primary" disabled={busy}>{busy ? 'Saving…' : profile ? 'Save profile' : 'Continue'}</button>
        </form>
    </section>;
}
export function ProfilePage() {
    const navigate = useNavigate(), location = useLocation();
    return <AccountGate setup><AccountShell><ProfileForm onSaved={() => navigate(safeReturnPath(new URLSearchParams(location.search).get('returnTo')), { replace: true })} /></AccountShell></AccountGate>;
}

let emailConfirmation;
export function AuthCallback() {
    const auth = useAuth(), navigate = useNavigate(), [error, setError] = useState(() => {
        const code = new URLSearchParams(window.location.search).get('error');
        return code ? accountError({ code }, 'Sign-in could not complete. Please try again.') : '';
    });
    const [confirmed, setConfirmed] = useState(!new URLSearchParams(window.location.search).has('token_hash'));
    const callbackError = error || (!auth.isAuthLoading && confirmed && !auth.user ? 'That sign-in link could not be verified. Request a new one.' : auth.profileError);
    useEffect(() => {
        const params = new URLSearchParams(window.location.search);
        if (params.has('error')) return;
        const tokenHash = params.get('token_hash');
        if (!tokenHash || !supabase) return;
        let active = true;
        if (emailConfirmation?.tokenHash !== tokenHash) emailConfirmation = { tokenHash, promise: supabase.auth.verifyOtp({ token_hash: tokenHash, type: 'email' }) };
        void emailConfirmation.promise.then(({ error: failure }) => { if (active) { if (failure) setError(accountError(failure, 'That sign-in link is invalid or expired.')); else setConfirmed(true); } }).catch(() => { if (active) setError('That sign-in link could not be verified. Please retry.'); });
        return () => { active = false; };
    }, []);
    useEffect(() => {
        if (!confirmed || auth.isAuthLoading || auth.isProfileLoading || callbackError || !auth.user) return;
        const destination = safeReturnPath(sessionStorage.getItem('watchly-auth-return'));
        sessionStorage.removeItem('watchly-auth-return');
        navigate(auth.profile ? destination : `/setup-profile?returnTo=${encodeURIComponent(destination)}`, { replace: true });
    }, [confirmed, auth.isAuthLoading, auth.isProfileLoading, auth.user, auth.profile, callbackError, navigate]);
    return <AccountShell><section className="account-card auth-card"><h1>{callbackError ? 'Sign-in needs another try' : 'Signing you in…'}</h1>{callbackError ? <><p role="alert" className="account-error">{callbackError}</p><Link className="account-primary" to="/auth">Try again</Link></> : <div className="account-skeleton" aria-label="Restoring sign-in" />}</section></AccountShell>;
}

export function RoomAccountDialog({ onClose }) {
    const auth = useAuth(), { roomId } = useRoom();
    return <AccountDialog title="Watchly account" onClose={onClose}>
        {auth.isAuthLoading || auth.isProfileLoading ? <div className="account-skeleton" /> : auth.profileError ? <><p role="alert">{auth.profileError}</p><button onClick={auth.refreshProfile}>Retry profile</button></> : auth.user ? auth.profile ? <section className="account-card"><h2>You’re signed in</h2><p>Your room, role and playback stay in place.</p><button className="account-primary" onClick={onClose}>Continue watching</button></section> : <ProfileForm onSaved={onClose} /> : <AuthForm inRoom destination={`/room/${roomId}`} />}
    </AccountDialog>;
}
