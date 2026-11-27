// Route every browser context before navigation. No external HTTP or WebSocket connections are opened.
const allow = value => { try { return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(value).hostname); } catch { return false; } };
module.exports = function localOnlyBrowser(browser) {
    const guarded = new WeakSet();
    const guard = async context => {
        if (guarded.has(context)) return;
        guarded.add(context);
        await context.addInitScript(() => {
            const NativePeer = globalThis.RTCPeerConnection;
            if (NativePeer) globalThis.RTCPeerConnection = class extends NativePeer {
                constructor(configuration = {}) { super({ ...configuration, iceServers: [] }); }
                setConfiguration(configuration) { return super.setConfiguration({ ...configuration, iceServers: [] }); }
            };
        });
        await context.route('**/*', route => allow(route.request().url()) ? route.continue() : route.abort());
        await context.routeWebSocket(() => true, route => {
            if (allow(route.url())) route.connectToServer(); else route.close({ code: 1008, reason: 'External network disabled for local test' });
        });
    };
    const newContext = browser.newContext.bind(browser), newPage = browser.newPage.bind(browser);
    browser.newContext = async (...args) => { const context = await newContext(...args); await guard(context); return context; };
    browser.newPage = async (...args) => { const page = await newPage(...args); await guard(page.context()); return page; };
    return browser;
};
