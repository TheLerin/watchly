import { io } from 'socket.io-client';

// ISSUE-40: Renamed from 'URL' to avoid shadowing the global URL Web API
// ISSUE-41: Added reconnectionAttempts limit so users see an error instead of
//           silently retrying forever when the backend is permanently down.
const SOCKET_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:5000';

export const socket = io(SOCKET_URL, {
    autoConnect: false,         // Only connect when explicitly joining a room
    reconnectionAttempts: 24,   // Render free instances can take close to a minute to wake.
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    timeout: 10000,
});
