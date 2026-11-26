import { useEffect } from 'react';
import toast from 'react-hot-toast';
import { observePwaUpdates } from '../utils/pwaUpdate';

export default function PwaUpdateNotice() {
    useEffect(() => observePwaUpdates({ serviceWorker: navigator.serviceWorker, onReady: () => {
        toast('An update is ready. Close all Watchly tabs after your session to use it.', { id: 'watchly-update-ready', duration: 10000 });
    } }), []);
    return null;
}
