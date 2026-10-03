const invalidSessionCodes = new Set([
    'refresh_token_not_found', 'refresh_token_already_used', 'session_not_found', 'session_expired',
    'user_not_found', 'user_banned', 'bad_jwt', 'invalid_jwt', 'invalid_credentials',
]);

const invalidSession = error => error?.name === 'AuthSessionMissingError' ||
    error?.name === 'AuthInvalidCredentialsError' || invalidSessionCodes.has(error?.code) ||
    error?.status === 401 || error?.status === 403;

// An auth rejection needs a fresh SDK token. Transport/database failures do not
// invalidate the account, and obsolete refresh results must not affect a login
// completed in another tab while the request was pending.
export function createAccountRecovery({ auth, getSession, reconnect }) {
    let generation = 0, active = true, pending = null, attempted = false;
    const refresh = () => {
        const session = getSession();
        if (!active || !session || attempted) return pending || Promise.resolve();
        if (pending) return pending;
        attempted = true;
        const epoch = generation;
        const current = () => active && generation === epoch && getSession()?.user?.id === session.user.id;
        const operation = Promise.resolve().then(() => auth.refreshSession()).then(async ({ data, error }) => {
            if (!current()) return;
            if (error) {
                if (getSession()?.access_token === session.access_token && invalidSession(error)) {
                    await auth.signOut({ scope: 'local' });
                    // Resume once without the expired account so room recovery
                    // receives its typed ownership error and exposes sign-in.
                    if (active && !getSession()) reconnect();
                }
                return;
            }
            if (data?.session?.access_token && getSession()?.access_token === data.session.access_token) reconnect();
        }).catch(() => { /* Network errors leave the current account intact. */ }).finally(() => { if (pending === operation) pending = null; });
        pending = operation;
        return operation;
    };
    return {
        refresh,
        connectionError(error) { return error?.data?.code === 'AUTH_REQUIRED' ? refresh() : Promise.resolve(); },
        authenticated() { attempted = false; },
        invalidate() { generation++; attempted = false; pending = null; },
        dispose() { active = false; generation++; },
    };
}
