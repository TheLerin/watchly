export const PROFILE_FIELDS = 'id,username,display_name,avatar_url,created_at,updated_at';
export const normalizeUsername = value => String(value || '').trim().replace(/^@/, '').toLowerCase();
export const validUsername = value => /^[a-z0-9_]{3,24}$/.test(value);
export function safeReturnPath(value, fallback = '/my-watchly') {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return fallback;
    const path = value.split(/[?#]/)[0];
    return path === '/' || path === '/my-watchly' || path === '/profile' || /^\/room\/[A-Z0-9]{7}$/.test(path) ? path : fallback;
}
export function safeAvatar(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password && value.length <= 2048 ? url.href : null; } catch { return null; }
}
export function accountError(error, fallback = 'Something went wrong. Please try again.') {
    if (error?.code === '23505') return 'That username is already taken.';
    const code = String(error?.code || '');
    const message = String(error?.message || '');
    if (/otp_expired|otp_disabled|invalid_credentials/.test(code)) return 'That code is invalid or expired. Request a new one.';
    if (/over_.*rate_limit|429/.test(code)) return 'Please wait a moment before trying again.';
    if (/access_denied|oauth.*cancel/.test(code)) return 'Sign-in was cancelled. You can try again.';
    if (/network|fetch|timeout/i.test(message)) return 'Could not connect. Check your connection and try again.';
    const labels = {
        WATCHLY_SELF: 'You cannot add yourself.', WATCHLY_BLOCKED: 'This person is unavailable.',
        WATCHLY_NOT_FRIENDS: 'You can invite friends only.', WATCHLY_FORBIDDEN: 'That action is unavailable.',
        WATCHLY_NOT_FOUND: 'This request or invite is no longer available.', WATCHLY_EXPIRED: 'That invite has expired.',
        WATCHLY_PROFILE_REQUIRED: 'Set up your profile to continue.', WATCHLY_INVALID: 'Check the details and try again.',
    };
    for (const [key, label] of Object.entries(labels)) if (message.includes(key)) return label;
    return fallback;
}
