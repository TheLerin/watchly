/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, supabaseConfigured } from '../supabase';
import { socket, setSocketAccessToken } from '../socket';
import { accountError, normalizeUsername, PROFILE_FIELDS, safeAvatar, safeReturnPath, validUsername } from '../utils/account';
import { createAccountRecovery } from '../utils/accountRecovery';
import { readRoomSession } from '../utils/roomRecovery';

const AuthContext = createContext(null);
export const useAuth = () => useContext(AuthContext);
export function AuthProvider({ children }) {
    const [session, setSession] = useState(null);
    const [isAuthLoading, setAuthLoading] = useState(supabaseConfigured);
    const [profileState, setProfileState] = useState({ owner: null, profile: null, error: '', loaded: false });
    const sessionRef = useRef(null);
    const accountRecoveryRef = useRef(null);
    const profileGeneration = useRef(0);
    const user = session?.user || null;
    const loadProfile = useCallback(async accountId => {
        if (!supabase || !accountId) return;
        const generation = ++profileGeneration.current;
        try {
            const { data, error } = await supabase.from('profiles').select(PROFILE_FIELDS).eq('id', accountId).maybeSingle().abortSignal(AbortSignal.timeout(10000));
            if (sessionRef.current?.user?.id !== accountId || profileGeneration.current !== generation) return;
            setProfileState({ owner: accountId, profile: data, error: error ? accountError(error, 'Your profile could not load. Please retry.') : '', loaded: true });
        } catch { if (sessionRef.current?.user?.id === accountId && profileGeneration.current === generation) setProfileState({ owner: accountId, profile: null, error: 'Your profile could not load. Please retry.', loaded: true }); }
    }, []);
    useEffect(() => {
        if (!supabase) return;
        let active = true, sawEvent = false, loadedId = null;
        const apply = next => {
            if (!active) return;
            const previousId = sessionRef.current?.user?.id;
            if (previousId !== next?.user?.id) accountRecoveryRef.current?.invalidate();
            sessionRef.current = next; setSocketAccessToken(next?.access_token); setSession(next); setAuthLoading(false);
            if (previousId && !next && socket.connected) socket.emit('auth:clear');
            if (previousId && !next && !socket.connected) {
                const roomSession = readRoomSession(sessionStorage);
                if (roomSession && window.location.pathname === `/room/${roomSession.roomId}`) socket.connect();
            }
            // Never await a Supabase request inside its auth listener (client lock).
            if (next?.user?.id && loadedId !== next.user.id) { loadedId = next.user.id; setTimeout(() => { if (active) void loadProfile(next.user.id); }, 0); }
            if (!next) loadedId = null;
        };
        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => { sawEvent = true; apply(next); });
        void supabase.auth.getSession().then(({ data, error }) => { if (!sawEvent) apply(error ? null : data.session); }).catch(() => apply(null));
        return () => { active = false; subscription.unsubscribe(); };
    }, [loadProfile]);
    useEffect(() => {
        if (!supabase) return;
        const recovery = createAccountRecovery({ auth: supabase.auth, getSession: () => sessionRef.current,
            reconnect: () => { if (!socket.connected) socket.connect(); } });
        accountRecoveryRef.current = recovery;
        const expired = () => { void recovery.refresh(); };
        const rejected = error => { void recovery.connectionError(error); };
        const authenticated = () => recovery.authenticated();
        socket.on('account:expired', expired); socket.on('connect_error', rejected);
        socket.on('connect', authenticated); socket.on('account:ready', authenticated);
        return () => { recovery.dispose(); accountRecoveryRef.current = null; socket.off('account:expired', expired); socket.off('connect_error', rejected); socket.off('connect', authenticated); socket.off('account:ready', authenticated); };
    }, []);
    const profile = profileState.owner === user?.id ? profileState.profile : null;
    const profileError = profileState.owner === user?.id ? profileState.error : '';
    const isProfileLoading = Boolean(user && (profileState.owner !== user.id || !profileState.loaded));
    const refreshProfile = useCallback(() => loadProfile(sessionRef.current?.user?.id), [loadProfile]);
    const callbackUrl = useCallback(destination => {
        sessionStorage.setItem('watchly-auth-return', safeReturnPath(destination));
        return `${window.location.origin}/auth/callback`;
    }, []);
    const requireClient = () => { if (!supabase) throw new Error('Accounts are not configured yet. You can still watch as a guest.'); };
    const signInWithGoogle = useCallback(async destination => {
        requireClient();
        const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: callbackUrl(destination) } });
        if (error) throw new Error(accountError(error, 'Google sign-in could not start. Please try again.'));
    }, [callbackUrl]);
    const signInWithEmail = useCallback(async (email, destination) => {
        requireClient();
        const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: true, emailRedirectTo: callbackUrl(destination) } });
        if (error) throw new Error(accountError(error, 'We could not send your sign-in email. Please try again.'));
    }, [callbackUrl]);
    const verifyEmail = useCallback(async (email, token) => {
        requireClient();
        const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
        if (error) throw new Error(accountError(error, 'That code is invalid or expired. Request a new one.'));
    }, []);
    const saveProfile = useCallback(async ({ displayName, username, avatar }) => {
        requireClient(); const current = sessionRef.current?.user;
        const canonical = normalizeUsername(username), name = displayName.trim();
        if (!current) throw new Error('Sign in to save your profile.');
        if (!validUsername(canonical)) throw new Error('Use 3–24 letters, numbers or underscores for your username.');
        if (!name || name.length > 24) throw new Error('Choose a display name with 1–24 characters.');
        const { data, error } = await supabase.from('profiles').upsert({ id: current.id, username: canonical, display_name: name, avatar_url: safeAvatar(avatar) }, { onConflict: 'id' }).select(PROFILE_FIELDS).single();
        if (error) throw new Error(accountError(error, 'Your profile could not be saved. Please try again.'));
        if (sessionRef.current?.user?.id === current.id) {
            profileGeneration.current++;
            setProfileState({ owner: current.id, profile: data, error: '', loaded: true });
        }
        return data;
    }, []);
    const signOut = useCallback(async () => {
        requireClient(); const { error } = await supabase.auth.signOut();
        if (error) throw new Error(accountError(error, 'Sign-out did not complete. Please retry.'));
        // Themes, appearance and recent-room history are deliberately preserved.
        setSocketAccessToken(null); socket.disconnect();
    }, []);
    const value = useMemo(() => ({ user, session, profile, isAuthenticated: Boolean(user), isAuthLoading, isProfileLoading, profileError,
        configured: supabaseConfigured, refreshProfile, signInWithGoogle, signInWithEmail, verifyEmail, saveProfile, signOut }),
    [user, session, profile, isAuthLoading, isProfileLoading, profileError, refreshProfile, signInWithGoogle, signInWithEmail, verifyEmail, saveProfile, signOut]);
    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
