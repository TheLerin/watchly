const express = require('express');
const { voiceMember } = require('./livekitIdentity');

const selectedDrive = (room, id) => {
    try {
        const url = new URL(room.videoState.url);
        return ['drive.google.com', 'drive.usercontent.google.com'].includes(url.hostname) &&
            (url.searchParams.get('id') || url.pathname.match(/\/d\/([\w-]+)/)?.[1]) === id;
    } catch { return false; }
};
const fail = res => res.status(403).set('Cache-Control', 'no-store').json({ error: 'Join the room and select this Drive file before streaming.' });

function registerDriveAccess({ app, io, rooms, env = process.env }) {
    const security = () => import('../workers/src/drive.mjs');
    app.post('/api/media/session', express.json({ limit: '4kb' }), async (req, res) => {
        try {
            const { createMediaCookie, validDriveId } = await security();
            const proof = req.body;
            if (!validDriveId(proof?.fileId)) return res.status(400).json({ error: 'Invalid Drive file.' });
            const { room } = voiceMember({ io, rooms }, proof);
            if (!selectedDrive(room, proof.fileId)) return fail(res);
            const response = await createMediaCookie(env, { roomId: proof.roomId, socketId: proof.socketId, resumeToken: proof.resumeToken, fileId: proof.fileId }, env.NODE_ENV === 'production' || req.secure);
            response.headers.forEach((value, name) => res.setHeader(name, name === 'set-cookie' && env.NODE_ENV === 'production' ? value.replace('SameSite=Strict', 'SameSite=None') : value));
            return res.status(response.status).send(await response.text());
        } catch { return fail(res); }
    });
    app.use('/api/proxy/gdrive', async (req, res, next) => {
        if (req.method === 'OPTIONS') return res.sendStatus(204);
        if (!['GET', 'HEAD'].includes(req.method)) return res.sendStatus(405);
        try {
            const { validDriveId, verifyTicket } = await security();
            if (!validDriveId(req.query.id)) return res.status(400).json({ error: 'Invalid Drive file.' });
            if (req.headers.range && !/^bytes=(?:\d+-\d*|-\d+)$/.test(req.headers.range)) return res.sendStatus(416);
            const bridge = req.get('x-watchly-drive-ticket');
            if (bridge) {
                const proof = await verifyTicket(env.GDRIVE_LEGACY_SECRET, bridge);
                if (proof.aud !== 'watchly-drive-bridge' || proof.fileId !== req.query.id || proof.method !== req.method || proof.range !== (req.headers.range || '') || proof.exp * 1000 > Date.now() + 60000) return fail(res);
            } else {
                const roomId = req.query.roomId;
                if (typeof roomId !== 'string' || !/^[A-Z0-9]{7}$/.test(roomId)) return fail(res);
                const cookie = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`watchly_media_${roomId}=`))?.split('=')[1];
                const proof = await verifyTicket(env.MEDIA_SESSION_SECRET, cookie);
                if (proof.roomId !== roomId || proof.fileId !== req.query.id) return fail(res);
                const { room } = voiceMember({ io, rooms }, proof);
                if (!selectedDrive(room, proof.fileId)) return fail(res);
            }
            res.setHeader('Cache-Control', 'private, no-store');
            res.setHeader('X-Content-Type-Options', 'nosniff');
            next();
        } catch { return fail(res); }
    });
}
module.exports = { registerDriveAccess, selectedDrive };
