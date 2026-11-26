export function observePwaUpdates({ serviceWorker, onReady }) {
    if (!serviceWorker?.getRegistration) return () => {};
    let disposed = false, registration, installing;
    const report = () => { if (!disposed && registration?.waiting && serviceWorker.controller) onReady(); };
    const state = () => { if (installing?.state === 'installed') report(); };
    const update = () => { installing?.removeEventListener('statechange', state); installing = registration.installing; installing?.addEventListener('statechange', state); };
    void serviceWorker.getRegistration().then(value => { if (disposed || !value) return; registration = value; report(); update(); registration.addEventListener('updatefound', update); }).catch(() => {});
    return () => { disposed = true; installing?.removeEventListener('statechange', state); registration?.removeEventListener('updatefound', update); };
}
