import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../supabase';
import { socket } from '../socket';
import { useAuth } from '../context/AuthContext';
import { accountError, normalizeUsername } from '../utils/account';

const empty = { friends: [], requests: [], outgoing: [], invites: [], blocks: [] };
export default function useSocial() {
    const { user, profile } = useAuth();
    const owner = user?.id;
    const ownerRef = useRef(owner); ownerRef.current = owner;
    const sequence = useRef(0);
    const [view, setView] = useState({ owner: null, data: empty, error: '', loaded: false });
    const [presence, setPresence] = useState({ owner: null, statuses: {} });
    const load = useCallback(async () => {
        if (!supabase || !owner) return;
        const request = ++sequence.current;
        try {
            const { data, error } = await supabase.rpc('get_my_watchly').abortSignal(AbortSignal.timeout(10000));
            if (ownerRef.current !== owner || sequence.current !== request) return;
            if (error) throw error;
            setView({ owner, data: { ...empty, ...data }, error: '', loaded: true });
            if (socket.connected) socket.emit('social:refresh');
        } catch (error) {
            if (ownerRef.current === owner && sequence.current === request) setView(previous => ({ owner, data: previous.owner === owner ? previous.data : empty, error: accountError(error, 'Your people could not load. Please retry.'), loaded: true }));
        }
    }, [owner]);
    const invalidate = useCallback(() => { sequence.current++; }, []);
    useEffect(() => {
        if (!owner || !profile) return;
        void load();
        const foreground = () => { if (document.visibilityState === 'visible') void load(); };
        const watch = () => socket.emit('social:watch', {});
        const disconnected = () => setPresence({ owner, statuses: {} });
        const changed = statuses => {
            if (!Array.isArray(statuses)) return;
            setPresence({ owner, statuses: Object.fromEntries(statuses.filter(value => typeof value.accountId === 'string' && ['online', 'in_room', 'offline'].includes(value.status)).map(value => [value.accountId, value.status])) });
        };
        socket.on('friends:presence', changed); socket.on('connect', watch); socket.on('account:ready', watch); socket.on('disconnect', disconnected);
        if (socket.connected) watch(); else socket.connect();
        const interval = setInterval(foreground, 30000);
        window.addEventListener('focus', foreground); document.addEventListener('visibilitychange', foreground);
        return () => { invalidate(); clearInterval(interval); socket.off('friends:presence', changed); socket.off('connect', watch); socket.off('account:ready', watch); socket.off('disconnect', disconnected); socket.emit('social:unwatch'); window.removeEventListener('focus', foreground); document.removeEventListener('visibilitychange', foreground); };
    }, [owner, profile, load, invalidate]);
    const mutate = useCallback(async (operation, args) => {
        const { data, error } = await supabase.rpc(operation, args);
        if (error) throw new Error(accountError(error, 'That action could not be completed. Please retry.'));
        await load(); socket.emit('social:refresh'); return data;
    }, [load]);
    const search = useCallback(async text => {
        const query = normalizeUsername(text);
        if (query.length < 3 || !/^[a-z0-9_]{3,24}$/.test(query)) return [];
        const { data, error } = await supabase.rpc('search_people', { query_text: query }).abortSignal(AbortSignal.timeout(10000));
        if (error) throw new Error(accountError(error, 'Search is unavailable. Please retry.'));
        return data || [];
    }, []);
    const invite = useCallback(targetId => new Promise((resolve, reject) => {
        if (!socket.connected) return reject(new Error('Reconnect to your room before inviting a friend.'));
        socket.timeout(10000).emit('social:invite', { targetId }, (error, response) => {
            if (error || !response?.ok) reject(new Error(response?.error?.message || 'That invite could not be sent. Please retry.'));
            else resolve(response.inviteId);
        });
    }), []);
    return { ...(view.owner === owner ? view.data : empty), loading: view.owner !== owner || !view.loaded,
        error: view.owner === owner ? view.error : '', presence: presence.owner === owner ? presence.statuses : {}, load, mutate, search, invite };
}
