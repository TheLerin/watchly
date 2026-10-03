import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();
// Missing configuration disables accounts only. Guests never depend on Supabase.
let client = null;
if (url && key) {
    try {
        client = createClient(url, key, {
            auth: { flowType: 'pkce', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
    } catch { /* Invalid configuration must not prevent guest playback. */ }
}
export const supabaseConfigured = Boolean(client);
export const supabase = client;
