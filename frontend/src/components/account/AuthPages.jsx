import GradientLabel from '../GradientLabel';
import { useEffect, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { useRoom } from '../../context/RoomContext';
import { supabase } from '../../supabase';
import { accountError, normalizeUsername, safeAvatar, safeReturnPath } from '../../utils/account';
import AccountShell from './AccountShell';
import Avatar from './Avatar';
import AccountDialog from './AccountDialog';
import './account-polish.css';

export function AccountGate({ children, setup = false }) {
    const auth = useAuth(), location = useLocation();
    if (auth.isAuthLoading || (auth.user && auth.isProfileLoading)) return <AccountShell className="auth-page"><div className="account-skeleton" aria-label="Loading account" /></AccountShell>;
    if (!auth.isAuthenticated) return <Navigate to={`/auth?returnTo=${encodeURIComponent(safeReturnPath(location.pathname))}`} replace />;
    if (auth.profileError) return <AccountShell className="auth-page"><p role="alert">{auth.profileError}</p><button className="account-primary" onClick={auth.refreshProfile}><GradientLabel>Retry profile</GradientLabel></button></AccountShell>;
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
        <button className="account-secondary auth-google" disabled={busy || !auth.configured || inRoom} onClick={() => run(() => auth.signInWithGoogle(destination))}><svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path fill="#4285f4" d="M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.23c1.89-1.74 2.99-4.3 2.99-7.36Z"/><path fill="#34a853" d="M12 22c2.7 0 4.96-.9 6.61-2.41l-3.23-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.81-1.76-5.6-4.12H3.06v2.59A10 10 0 0 0 12 22Z"/><path fill="#fbbc05" d="M6.4 13.93a6 6 0 0 1 0-3.86V7.48H3.06a10 10 0 0 0 0 9.04l3.34-2.59Z"/><path fill="#ea4335" d="M12 5.95c1.47 0 2.79.5 3.82 1.49l2.87-2.87A9.6 9.6 0 0 0 12 2a10 10 0 0 0-8.94 5.48l3.34 2.59A6 6 0 0 1 12 5.95Z"/></svg><GradientLabel>Continue with Google</GradientLabel></button>
        {inRoom && <p className="account-muted small">Use an email code to keep this room open. Google sign-in is available after you leave the room.</p>}
        <div className="account-divider"><span>or</span></div>
        <form onSubmit={event => { event.preventDefault(); void run(async () => { if (sent) await auth.verifyEmail(email, code); else { await auth.signInWithEmail(email, destination); setSent(true); } }); }}>
            <label>Email<input type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} value={email} onChange={event => { setEmail(event.target.value); setSent(false); }} disabled={busy} /></label>
            {sent && <><p className="account-notice" role="status">Check your email for a sign-in code or link.</p><label>Sign-in code<input autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6,10}" minLength={6} maxLength={10} required value={code} onChange={event => setCode(event.target.value.replace(/\D/g, ''))} /></label></>}
            {error && <p className="account-error" role="alert">{error}</p>}
            <button className="account-primary" disabled={busy || !auth.configured}><GradientLabel>{busy ? 'Please wait…' : sent ? 'Verify code' : 'Continue with email'}</GradientLabel></button>
            {sent && <button type="button" className="account-text-action" disabled={busy} onClick={() => run(() => auth.signInWithEmail(email, destination))}><GradientLabel>Send a new email</GradientLabel></button>}
        </form>
        <p className="account-muted small">By continuing, you agree to our <Link to="/terms">Terms</Link> and <Link to="/privacy">Privacy policy</Link>.</p>
        {!inRoom && <Link className="account-text-action" to="/">Watch as a guest</Link>}
    </section>;
}

export default function AuthPage() {
    const auth = useAuth(), location = useLocation();
    const destination = safeReturnPath(new URLSearchParams(location.search).get('returnTo'));
    if (auth.user && auth.isProfileLoading) return <AccountShell className="auth-page" hideActions><div className="account-skeleton" aria-label="Loading profile" /></AccountShell>;
    if (auth.profileError) return <AccountShell className="auth-page" hideActions><p role="alert">{auth.profileError}</p><button className="account-secondary" onClick={auth.refreshProfile}><GradientLabel>Retry profile</GradientLabel></button></AccountShell>;
    if (!auth.isAuthLoading && auth.user) return <Navigate to={auth.profile ? destination : `/setup-profile?returnTo=${encodeURIComponent(destination)}`} replace />;
    return <AccountShell className="auth-page" hideActions>{auth.isAuthLoading ? <div className="account-skeleton" aria-label="Loading account" /> : <AuthForm destination={destination} />}</AccountShell>;
}

export function ProfileForm({ onSaved }) {
    const { user, profile, saveProfile } = useAuth();
    const providerAvatar = safeAvatar(user?.user_metadata?.avatar_url || user?.user_metadata?.picture);
    const [name, setName] = useState(profile?.display_name || String(user?.user_metadata?.full_name || user?.user_metadata?.name || '').slice(0, 24));
    const [username, setUsername] = useState(profile?.username || '');
    const [avatar, setAvatar] = useState(profile?.avatar_url ?? providerAvatar);
    const [busy, setBusy] = useState(false), [error, setError] = useState('');
    return <section className="account-card auth-card"><p className="account-eyebrow">YOUR WATCHLY</p><h1>{profile ? 'Your profile' : 'Make yourself at home'}</h1>
        <div className="profile-avatar"><Avatar name={name} url={avatar} size={64} /><div><button className="account-text-action" onClick={() => setAvatar(null)}><GradientLabel>Use initials</GradientLabel></button>{providerAvatar && <button className="account-text-action" onClick={() => setAvatar(providerAvatar)}><GradientLabel>Use Google avatar</GradientLabel></button>}</div></div>
        <form onSubmit={async event => { event.preventDefault(); setBusy(true); setError(''); try { await saveProfile({ displayName: name, username, avatar }); onSaved?.(); } catch (failure) { setError(failure.message); } finally { setBusy(false); } }}>
            <label>Display name<input required maxLength={24} autoComplete="nickname" value={name} onChange={event => setName(event.target.value)} /></label>
            <label>Username<span className="username-field"><span aria-hidden="true">@</span><input aria-label="Username" required minLength={3} maxLength={24} pattern="[a-zA-Z0-9_]{3,24}" autoCapitalize="none" autoComplete="off" value={username} onChange={event => setUsername(normalizeUsername(event.target.value))} /></span></label>
            <p className="account-muted small">3–24 letters, numbers or underscores. Your email stays private.</p>
            {error && <p className="account-error" role="alert">{error}</p>}
            <button className="account-primary" disabled={busy}><GradientLabel>{busy ? 'Saving…' : profile ? 'Save profile' : 'Continue'}</GradientLabel></button>
        </form>
    </section>;
}
export function ProfilePage() {
    const navigate = useNavigate(), location = useLocation();
    return <AccountGate setup><AccountShell className="auth-page"><ProfileForm onSaved={() => navigate(safeReturnPath(new URLSearchParams(location.search).get('returnTo')), { replace: true })} /></AccountShell></AccountGate>;
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
    return <AccountShell className="auth-page"><section className="account-card auth-card"><h1>{callbackError ? 'Sign-in needs another try' : 'Signing you in…'}</h1>{callbackError ? <><p role="alert" className="account-error">{callbackError}</p><Link className="account-primary" to="/auth"><GradientLabel>Try again</GradientLabel></Link></> : <div className="account-skeleton" aria-label="Restoring sign-in" />}</section></AccountShell>;
}

export function RoomAccountDialog({ onClose }) {
    const auth = useAuth(), { roomId } = useRoom();
    return <AccountDialog title="Watchly account" onClose={onClose}>
        {auth.isAuthLoading || auth.isProfileLoading ? <div className="account-skeleton" /> : auth.profileError ? <><p role="alert">{auth.profileError}</p><button onClick={auth.refreshProfile}><GradientLabel>Retry profile</GradientLabel></button></> : auth.user ? auth.profile ? <section className="account-card"><h2>You’re signed in</h2><p>Your room, role and playback stay in place.</p><button className="account-primary" onClick={onClose}><GradientLabel>Continue watching</GradientLabel></button></section> : <ProfileForm onSaved={onClose} /> : <AuthForm inRoom destination={`/room/${roomId}`} />}
    </AccountDialog>;
}
