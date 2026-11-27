// Load with node --require for local acceptance suites. Child Node processes inherit this guard.
const http = require('node:http'), https = require('node:https');
const { syncBuiltinESMExports } = require('node:module');
const local = value => ['localhost', '127.0.0.1', '::1', '[::1]'].includes(String(value).toLowerCase());
const check = value => {
    const host = typeof value === 'string' || value instanceof URL ? new URL(value).hostname : value?.hostname || value?.host || 'localhost';
    if (!local(host)) throw new Error('External networking is disabled for this local acceptance test.');
};
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, options) => { check(typeof input === 'string' || input instanceof URL ? input : input.url); return originalFetch(input, options); };
for (const module of [http, https]) {
    for (const method of ['request', 'get']) {
        const original = module[method];
        module[method] = function (...args) { check(args[0]); return original.apply(this, args); };
    }
}
syncBuiltinESMExports();
