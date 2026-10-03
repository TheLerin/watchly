import { accountError } from './account.js';

export const SOCIAL_SECTIONS = ['friends', 'requests', 'invites', 'blocks'];
const emptyData = () => ({ friends: [], requests: [], outgoing: [], invites: [], sentInvites: [], blocks: [] });
const sectionKeys = { friends: ['friends'], requests: ['requests', 'outgoing'], invites: ['invites', 'sentInvites'], blocks: ['blocks'] };
export function socialSections(table, row = {}) {
    if (table === 'friend_requests') return row.status === 'accepted' ? ['requests', 'friends'] : ['requests'];
    if (table === 'friendships') return ['friends'];
    if (table === 'room_invites') return ['invites'];
    if (table === 'blocks') return SOCIAL_SECTIONS;
    return [];
}

// Events invalidate projections, never patch relationship rules locally.
// Invalidations during a fetch cause a trailing fetch of committed DB state.
export function createSocialStore({ client, socket, owner, windowTarget = window, documentTarget = document, debounceMs = 60 }) {
    let state = { ...emptyData(), loading: Boolean(owner), error: '', presence: {} };
    const listeners = new Set(), dirty = new Set(), controllers = new Set();
    let active = false, generation = 0, timer, running = null, removal = Promise.resolve(), cleanup = () => {};
    const publish = patch => { state = { ...state, ...patch }; for (const listener of listeners) listener(); };
    const refreshPresence = () => { if (socket.connected) socket.emit('social:refresh'); };
    const drain = async () => {
        if (running) return running;
        const current = generation;
        const work = async () => {
            while (active && current === generation && dirty.size) {
                const sections = [...dirty]; dirty.clear();
                const controller = new AbortController(); controllers.add(controller);
                try {
                    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(10000)]);
                    let { data, error } = await client.rpc('get_social_data', { sections }).abortSignal(signal);
                    // Keep the existing social page/actions usable during a
                    // staggered deploy before SQL reaches the project. Normal
                    // operation always uses the targeted projection above.
                    if (error?.code === 'PGRST202') {
                        const legacy = await client.rpc('get_my_watchly').abortSignal(signal);
                        data = legacy.data ? { sentInvites: [], ...legacy.data } : null;
                        error = legacy.error;
                    }
                    if (!active || current !== generation) return;
                    if (error) throw error;
                    const patch = { loading: false, error: '' };
                    for (const section of sections) for (const key of sectionKeys[section]) {
                        if (!Array.isArray(data?.[key])) throw new Error('Invalid social response');
                        patch[key] = data[key];
                    }
                    publish(patch);
                    if (sections.includes('friends')) refreshPresence();
                } catch (error) {
                    if (active && current === generation) publish({ loading: false,
                        error: accountError(error, 'Your people could not load. Please retry.') });
                } finally { controllers.delete(controller); }
            }
        };
        const promise = work(); running = promise;
        try { await promise; } finally { if (running === promise) running = null; }
    };
    const invalidate = (sections, immediate = false) => {
        if (!active) return Promise.resolve();
        for (const section of sections) if (sectionKeys[section]) dirty.add(section);
        clearTimeout(timer);
        if (immediate) return drain();
        timer = setTimeout(() => { void drain(); }, debounceMs);
        return Promise.resolve();
    };
    const load = () => invalidate(SOCIAL_SECTIONS, true);
    const start = () => {
        if (active || !client || !owner) return () => {};
        active = true; const current = ++generation;
        const live = () => active && generation === current;
        // Supabase rejoins automatically; reconcile missed events after each
        // subscription acknowledgement, coalescing the two channels' joins.
        const subscribed = new Set(); let reconciled = false;
        const joined = index => status => {
            if (!live()) return;
            if (status === 'SUBSCRIBED') subscribed.add(index);
            else { subscribed.delete(index); reconciled = false; }
            if (subscribed.size === 2 && !reconciled) { reconciled = true; void invalidate(SOCIAL_SECTIONS); }
        };
        const channels = [];
        const connect = async () => {
            // SDK channel removal is asynchronous. Finish it before reusing the
            // private account topic during React Strict Mode effect replay.
            await removal;
            if (!live()) return;
            const changes = client.channel(`watchly-social-records:${owner}`);
            channels.push(changes);
            const columns = { friend_requests: ['sender_id', 'receiver_id'], friendships: ['user_low', 'user_high'],
                blocks: ['blocker_id'], room_invites: ['sender_id', 'receiver_id'] };
            for (const [table, fields] of Object.entries(columns)) for (const event of ['INSERT', 'UPDATE']) for (const column of fields) {
                changes.on('postgres_changes', { schema: 'public', table, event, filter: `${column}=eq.${owner}` }, payload => {
                    if (live()) void invalidate(socialSections(table, payload.new));
                });
            }
            changes.subscribe(joined(0));
            const privateChanges = client.channel(`watchly-social:${owner}`, { config: { private: true } })
                .on('broadcast', { event: 'social_changed' }, message => {
                    if (live()) void invalidate(socialSections(message.payload?.table));
                }).subscribe(joined(1));
            channels.push(privateChanges);
        };
        void connect();
        const foreground = () => { if (documentTarget.visibilityState === 'visible') void invalidate(SOCIAL_SECTIONS); };
        const watch = () => { if (live()) socket.emit('social:watch', {}); };
        const disconnected = () => { if (live()) publish({ presence: {} }); };
        const presence = statuses => {
            if (!live() || !Array.isArray(statuses)) return;
            publish({ presence: Object.fromEntries(statuses.filter(value => typeof value.accountId === 'string'
                && ['online', 'in_room', 'offline'].includes(value.status)).map(value => [value.accountId, value.status])) });
        };
        socket.on('friends:presence', presence); socket.on('connect', watch);
        socket.on('account:ready', watch); socket.on('disconnect', disconnected);
        if (socket.connected) watch(); else socket.connect();
        windowTarget.addEventListener('focus', foreground); documentTarget.addEventListener('visibilitychange', foreground);
        void load();
        cleanup = () => {
            active = false; generation++; clearTimeout(timer); dirty.clear();
            for (const controller of controllers) controller.abort(); controllers.clear(); running = null;
            removal = Promise.all(channels.map(channel => client.removeChannel(channel)));
            socket.off('friends:presence', presence); socket.off('connect', watch);
            socket.off('account:ready', watch); socket.off('disconnect', disconnected); socket.emit('social:unwatch');
            windowTarget.removeEventListener('focus', foreground); documentTarget.removeEventListener('visibilitychange', foreground);
        };
        // An earlier Strict Mode cleanup cannot dispose the replacement.
        return () => { if (live()) cleanup(); };
    };
    const mutate = async (operation, args) => {
        const current = generation;
        if (!active) throw new Error('Sign in before updating your people.');
        const { data, error } = await client.rpc(operation, args);
        if (error) throw new Error(accountError(error, 'That action could not be completed. Please retry.'));
        if (active && current === generation) {
            const sections = operation === 'request_friend' ? ['requests', ...(data === 'friends' ? ['friends'] : [])]
                : operation === 'respond_friend_request' ? ['requests', ...(args.accept ? ['friends'] : [])]
                : operation === 'remove_friend' ? ['friends', 'invites']
                : operation === 'respond_room_invite' ? ['invites'] : SOCIAL_SECTIONS;
            await invalidate(sections, true);
        }
        return data;
    };
    const invite = targetId => new Promise((resolve, reject) => {
        const current = generation;
        if (!active || !socket.connected) return reject(new Error('Reconnect to your room before inviting a friend.'));
        socket.timeout(10000).emit('social:invite', { targetId }, async (error, response) => {
            if (error || !response?.ok) return reject(new Error(response?.error?.message || 'That invite could not be sent. Please retry.'));
            if (active && current === generation) await invalidate(['invites'], true);
            resolve(response.inviteId);
        });
    });
    return { start, subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        getSnapshot: () => state, load, mutate, invite };
}
