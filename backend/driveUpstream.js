const { request } = require('node:https');

// The caller validates every destination and follows redirects explicitly.
function requestDriveHop(url, { method, headers, signal, timeout }, transport = request) {
    return new Promise((resolve, reject) => {
        const upstream = transport(url, {
            method,
            headers: { ...headers, 'Accept-Encoding': 'identity' },
            signal,
        }, data => {
            clearTimeout(deadline);
            resolve({ status: data.statusCode, headers: data.headers, data });
        });
        const deadline = setTimeout(() => {
            upstream.destroy(new Error('Timed out waiting for Google Drive response headers'));
        }, timeout);
        upstream.on('error', error => {
            clearTimeout(deadline);
            reject(error);
        });
        upstream.end();
    });
}

module.exports = { requestDriveHop };
