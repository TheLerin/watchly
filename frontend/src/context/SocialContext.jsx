/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { useAuth } from './AuthContext';
import { supabase } from '../supabase';
import { socket } from '../socket';
import { createSocialStore } from '../utils/socialStore';
import { accountError, normalizeUsername } from '../utils/account';

const SocialContext = createContext(null);
async function search(text) {
    const query = normalizeUsername(text);
    if (!supabase || query.length < 3 || !/^[a-z0-9_]{3,24}$/.test(query)) return [];
    const { data, error } = await supabase.rpc('search_people', { query_text: query }).abortSignal(AbortSignal.timeout(10000));
    if (error) throw new Error(accountError(error, 'Search is unavailable. Please retry.'));
    return data || [];
}
export function SocialProvider({ children }) {
    const { user, profile, isAuthLoading } = useAuth();
    const owner = !isAuthLoading && profile ? user?.id : null;
    const store = useMemo(() => createSocialStore({ client: supabase, socket, owner }), [owner]);
    useEffect(() => store.start(), [store]);
    return <SocialContext.Provider value={store}>{children}</SocialContext.Provider>;
}
export function useSocialState() {
    const store = useContext(SocialContext);
    const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
    return { ...state, load: store.load, mutate: store.mutate, invite: store.invite, search };
}
