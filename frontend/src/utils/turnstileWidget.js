let loading;
export function loadTurnstile({ document = globalThis.document, scope = globalThis } = {}) {
    if (scope.turnstile) return Promise.resolve(scope.turnstile);
    if (loading) return loading;
    loading = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; script.async = true; script.defer = true;
        const failed = () => { clearTimeout(timer); script.remove(); loading = null; reject(new Error('Security verification could not load. Check your connection and retry.')); };
        const timer = setTimeout(failed, 15000);
        script.onerror = failed;
        script.onload = () => { clearTimeout(timer); if (!scope.turnstile) failed(); else resolve(scope.turnstile); };
        document.head.appendChild(script);
    });
    return loading;
}

export function createCreationVerification(onPrompt) {
    let pending, generation = 0;
    const finish = (error, token) => {
        if (!pending) return;
        const current = pending; pending = null; onPrompt(null);
        if (error) current.reject(error); else current.resolve(token);
    };
    return {
        request(challenge) {
            if (!challenge || challenge.action !== 'room_create' || typeof challenge.siteKey !== 'string' || !/^[\w-]{1,256}$/.test(challenge.siteKey)) return Promise.reject(new Error('Security verification is not configured correctly.'));
            if (pending) return pending.promise;
            const promise = new Promise((resolve, reject) => { pending = { resolve, reject }; }); pending.promise = promise;
            onPrompt({ ...challenge, requestId: ++generation }); return promise;
        },
        complete(token) { if (typeof token === 'string' && token.length > 0 && token.length <= 2048) finish(null, token); },
        cancel() { finish(new Error('Room verification canceled.')); },
        dispose() { if (pending) { const current = pending; pending = null; current.reject(new Error('Room verification canceled.')); } },
    };
}
