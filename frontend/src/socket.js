import { io } from 'socket.io-client';

// ISSUE-40: Renamed from 'URL' to avoid shadowing the global URL Web API
// One Manager owns transport backoff. Room recovery stops it on intentional
// leave/permanent session errors; temporary outages keep retrying at the cap.
const SOCKET_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

export const socket = io(SOCKET_URL, {
    autoConnect: false,         // Only connect when explicitly joining a room
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 8000,
    timeout: 10000,
});
