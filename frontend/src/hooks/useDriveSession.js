import { useEffect, useState } from 'react';
import { BACKEND_URL } from '../config';
import { socket } from '../socket';

export function useDriveSession(url, roomId, memberId, connected, onError) {
    const [authorized, setAuthorized] = useState(null);
    const accessKey = `${url}|${roomId}|${memberId}|${socket.id || ''}`;
    useEffect(() => {
        if (!url?.includes('/api/proxy/gdrive')) return;
        if (!connected) return;
        const controller = new AbortController();
        let saved; try { saved = JSON.parse(sessionStorage.getItem('watchTogetherSession')); } catch { return; }
        if (!saved?.resumeToken || saved.roomId !== roomId || saved.memberId !== memberId || !socket.id) return;
        const requestUrl = new URL(url, window.location.origin);
        let pending = false;
        const authorize = async () => {
            if (pending || controller.signal.aborted) return;
            pending = true;
            try {
                const response = await fetch(`${BACKEND_URL}/api/media/session`, {
                    method: 'POST', credentials: 'include', signal: controller.signal,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ roomId, socketId: socket.id, resumeToken: saved.resumeToken, fileId: requestUrl.searchParams.get('id') }),
                });
                const result = await response.json();
                if (!response.ok) throw new Error(result.error || 'Drive authorization failed');
                if (!controller.signal.aborted) setAuthorized(accessKey);
            } catch (error) { if (!controller.signal.aborted) onError(error.message); }
            finally { pending = false; }
        };
        void authorize();
        const renewal = setInterval(authorize, 600000);
        const visible = () => { if (!document.hidden) void authorize(); };
        document.addEventListener('visibilitychange', visible);
        window.addEventListener('online', authorize);
        return () => { clearInterval(renewal); document.removeEventListener('visibilitychange', visible); window.removeEventListener('online', authorize); controller.abort(); };
    }, [url, roomId, memberId, connected, onError, accessKey]);
    return !url?.includes('/api/proxy/gdrive') || (connected && authorized === accessKey);
}
