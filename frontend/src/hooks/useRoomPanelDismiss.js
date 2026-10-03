import { useCallback, useEffect, useRef } from 'react';

// Keep native clicks/taps available to the player. React's capture path also
// recognizes dialogs portaled by panel children outside the DOM boundary.
export default function useRoomPanelDismiss({ activePanel, onClose, panelRef, triggerRefs }) {
    const ownedEvents = useRef(new WeakSet());
    const onPointerDownCapture = useCallback(event => { ownedEvents.current.add(event.nativeEvent); }, []);
    const onKeyDownCapture = useCallback(event => {
        if (!panelRef.current?.contains(event.target)) ownedEvents.current.add(event.nativeEvent);
    }, [panelRef]);
    useEffect(() => {
        if (!activePanel) return;
        const pendingEscapes = new Set();
        const outside = event => {
            if (ownedEvents.current.has(event) || panelRef.current?.contains(event.target)
                || triggerRefs.some(ref => {
                    const button = event.target.closest?.('button');
                    return button && ref.current?.contains(button);
                })) return;
            onClose();
        };
        const escape = event => {
            if (event.key !== 'Escape') return;
            // Nested dialogs may handle Escape later in the native listener
            // order, including when a nonfocusable dialog heading was clicked.
            const timer = setTimeout(() => {
                pendingEscapes.delete(timer);
                if (event.defaultPrevented || ownedEvents.current.has(event)) return;
                const trigger = triggerRefs.flatMap(ref => ref.current ? [ref.current] : [])
                    .map(element => element.matches('button[aria-expanded="true"]') ? element
                        : element.querySelector('button[aria-expanded="true"],button[aria-selected="true"],button[data-active="true"]'))
                    .find(Boolean);
                onClose(); trigger?.focus();
            }, 0);
            pendingEscapes.add(timer);
        };
        document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
        return () => {
            document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape);
            pendingEscapes.forEach(clearTimeout);
        };
    }, [activePanel, onClose, panelRef, triggerRefs]);
    return { onPointerDownCapture, onKeyDownCapture };
}
