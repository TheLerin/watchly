const { createClient } = require('@supabase/supabase-js');
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const failure = (code, message) => Object.assign(new Error(message), { code });

function createAccountService({ url = process.env.SUPABASE_URL, key = process.env.SUPABASE_PUBLISHABLE_KEY, serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY, fetcher = fetch } = {}) {
    let client = null;
    if (url && key) {
        try { client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, options) => fetcher(input, { ...options, signal: options?.signal || AbortSignal.timeout(8000) }) } }); }
        catch { /* Account configuration must never prevent guest connections. */ }
    }
    const request = async (path, token, body, apiKey = key) => {
        if (!client) throw failure('ACCOUNT_UNAVAILABLE', 'Accounts are not configured. You can join as a guest.');
        const response = await fetcher(`${url}/rest/v1/${path}`, {
            method: body === undefined ? 'GET' : 'POST',
            headers: { apikey: apiKey, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000),
        });
        if (!response.ok) throw failure('ACCOUNT_UNAVAILABLE', 'Account features are temporarily unavailable. Please retry.');
        return response.status === 204 ? null : response.json();
    };
    return {
        configured: Boolean(client),
        async verify(token) {
            if (!client) throw failure('ACCOUNT_UNAVAILABLE', 'Accounts are not configured. You can join as a guest.');
            if (typeof token !== 'string' || token.length > 16384) throw failure('AUTH_REQUIRED', 'Sign in again to use your account.');
            // getUser asks Supabase Auth to validate the JWT/session. Neither
            // decoded claims nor editable provider metadata authorize identity.
            const { data, error } = await client.auth.getUser(token);
            if (error || !uuid(data?.user?.id)) throw failure('AUTH_REQUIRED', 'Your account session expired. Sign in again.');
            let expiresAt;
            try { expiresAt = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).exp * 1000; } catch { /* Invalid verified token shape. */ }
            if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) throw failure('AUTH_REQUIRED', 'Your account session expired. Sign in again.');
            const profiles = await request(`profiles?id=eq.${data.user.id}&select=id,username,display_name,avatar_url`, token);
            const profile = profiles?.find(item => item.id === data.user.id) || null;
            return { id: data.user.id, profile, token, expiresAt };
        },
        async friendIds(account) { return (await request('rpc/friend_ids', account.token, {})).filter(uuid); },
        async invite(account, targetId, roomCode) {
            if (!uuid(targetId)) throw failure('INVALID_ACCOUNT', 'Choose a friend to invite.');
            if (!serviceRoleKey) throw failure('ACCOUNT_UNAVAILABLE', 'Friend invitations are not configured yet. You can share the room link.');
            return request('rpc/send_room_invite', serviceRoleKey, { verified_sender_id: account.id, target_id: targetId, invite_room_code: roomCode }, serviceRoleKey);
        },
        async touch(account) { return request('rpc/touch_profile', account.token, {}); },
    };
}

// Presence is Render-owned, aggregated across devices, and sent only after a
// fresh database-authorized friend lookup. Payloads contain no room codes.
function createFriendPresence({ io, accounts }) {
    let timer;
    const statuses = () => {
        const result = new Map();
        for (const socket of io.sockets.sockets.values()) {
            const account = socket.data.account;
            if (!account || account.expiresAt <= Date.now()) continue;
            const status = socket.data.roomId ? 'in_room' : 'online';
            if (result.get(account.id) !== 'in_room') result.set(account.id, status);
        }
        return result;
    };
    const send = async socket => {
        const account = socket.data.account;
        if (!account || account.expiresAt <= Date.now()) return;
        const friends = await accounts.friendIds(account);
        if (!socket.connected || socket.data.account !== account) return;
        const state = statuses();
        socket.emit('friends:presence', friends.map(id => ({ accountId: id, status: state.get(id) || 'offline' })));
    };
    const changed = () => {
        clearTimeout(timer);
        timer = setTimeout(() => {
            for (const socket of io.sockets.sockets.values()) if (socket.data.watchFriends) void send(socket).catch(() => {});
        }, 100);
        timer.unref?.();
    };
    return { send, changed };
}
module.exports = { createAccountService, createFriendPresence, uuid };
