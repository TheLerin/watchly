import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
export default function AccountDialog({ title, onClose, children, card = false }) {
    const root = useRef(null);
    useEffect(() => {
        const previous = document.activeElement, overflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden'; root.current?.querySelector('button:not(:disabled),input:not(:disabled)')?.focus();
        const key = event => {
            if (event.key === 'Escape') { event.preventDefault(); onClose(); }
            if (event.key !== 'Tab') return;
            const elements = [...root.current.querySelectorAll('button:not(:disabled),input:not(:disabled),a[href],summary')];
            const first = elements[0], last = elements.at(-1);
            if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
            if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        };
        document.addEventListener('keydown', key);
        return () => { document.removeEventListener('keydown', key); document.body.style.overflow = overflow; previous?.focus(); };
    }, [onClose]);
    return createPortal(<div className="account-overlay" onPointerDown={event => { if (event.target === event.currentTarget) onClose(); }}><section ref={root} className={`account-dialog ${card ? 'account-card' : ''}`} role="dialog" aria-modal="true" aria-label={title}><button className="account-dialog-close" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}><X size={20} /></button>{children}</section></div>, document.body);
}
