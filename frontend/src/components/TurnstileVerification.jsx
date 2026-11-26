import { useEffect, useRef, useState } from 'react';
import { loadTurnstile } from '../utils/turnstileWidget';

// Mounted only when the server requires verification; ordinary room creation keeps the existing interface.
export default function TurnstileVerification({ challenge, onComplete, onCancel }) {
    const container = useRef(null), dialog = useRef(null);
    const [error, setError] = useState('');
    useEffect(() => {
        let disposed = false, widget, api;
        const previous = document.activeElement, overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden'; dialog.current.querySelector('button')?.focus();
        const keyboard = event => {
            if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); onCancel(); }
            if (event.key === 'Tab') {
                const fields = [...dialog.current.querySelectorAll('button,iframe,[tabindex="0"]')];
                const first = fields[0], last = fields.at(-1);
                event.stopImmediatePropagation();
                if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
                else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
            }
        };
        window.addEventListener('keydown', keyboard, true);
        void loadTurnstile().then(value => {
            if (disposed) return; api = value;
            widget = api.render(container.current, { sitekey: challenge.siteKey, action: 'room_create', theme: 'auto',
                callback: token => { if (!disposed) onComplete(token); },
                'expired-callback': () => { if (!disposed) api.reset(widget); },
                'timeout-callback': () => { if (!disposed) setError('Verification timed out. Cancel and retry.'); },
                'error-callback': () => { if (!disposed) setError('Verification failed. Cancel and retry.'); return true; },
            });
        }).catch(failure => { if (!disposed) setError(failure.message); });
        return () => {
            disposed = true; if (widget !== undefined) try { api.remove(widget); } catch { /* already removed */ }
            window.removeEventListener('keydown', keyboard, true); document.body.style.overflow = overflow; previous?.focus?.();
        };
    }, [challenge.siteKey, onComplete, onCancel]);
    return <div className="fixed inset-0 flex items-center justify-center bg-black/80 p-4" style={{ zIndex: 10000 }}>
        <section ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby="room-verification-title" className="w-full max-w-sm rounded-2xl border border-white/15 bg-zinc-950 p-5 text-white shadow-2xl">
            <h2 id="room-verification-title" className="text-lg font-semibold">Verify to create your room</h2>
            <p className="my-3 text-sm text-zinc-400">Complete this quick security check. Your room will open afterward.</p>
            <div ref={container} data-testid="turnstile-widget" />
            {error && <p role="alert" className="mt-3 text-sm text-red-300">{error}</p>}
            <button type="button" onClick={onCancel} className="mt-4 rounded-lg border border-white/15 px-4 py-2 text-sm">Cancel</button>
        </section>
    </div>;
}
