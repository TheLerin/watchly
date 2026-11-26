const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { AccessToken } = require('livekit-server-sdk');
const { registerLivekitVoice } = require('../livekitVoice');
const { voiceRoomName, voiceRoomCode } = require('../livekitIdentity');
test('legacy Render authenticates webhooks and ignores foreign rooms even with identical API keys and member IDs', async () => {
    let webhook; const removals = [];
    const env = { LIVEKIT_URL: 'wss://media-test.livekit.cloud', LIVEKIT_API_KEY: 'test-api', LIVEKIT_API_SECRET: 'test-secret-fixture', LIVEKIT_ROOM_NAMESPACE: 'legacy-render' };
    const app = { use() {}, post(_path, ...handlers) { webhook = handlers.at(-1); } };
    const dispose = registerLivekitVoice({ app, io: {}, rooms: new Map(), accounts: {}, env }); dispose.removeMember = async (...args) => removals.push(args);
    try {
        const deliver = async (name, forged = false) => {
            const raw = JSON.stringify({ id: name, event: 'participant_joined', room: { name }, participant: { identity: 'watchly-shared' } });
            const token = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, { ttl: 60 }); token.sha256 = crypto.createHash('sha256').update(raw).digest('base64');
            const authorization = forged ? 'forged' : await token.toJwt();
            const response = { code: 200, setHeader() {}, status(code) { this.code = code; return this; }, json(value) { this.value = value; return this; } };
            await webhook({ body: Buffer.from(raw), get: () => authorization }, response); return response;
        };
        for (const namespace of ['staging','production']) assert.equal((await deliver(voiceRoomName('ABCDEFG', { LIVEKIT_ROOM_NAMESPACE: namespace }))).value.ignored, true);
        assert.equal((await deliver('watchly-voice-ABCDEFG')).value.ignored, true); assert.equal(removals.length, 0);
        const own = voiceRoomName('ABCDEFG', env); assert.equal(voiceRoomCode(own, env), 'ABCDEFG');
        assert.equal((await deliver(own, true)).code, 401); assert.equal(removals.length, 0);
        assert.equal((await deliver(own)).code, 200); assert.deepEqual(removals, [['ABCDEFG','shared']]);
        assert.equal((await deliver(own)).value.duplicate, true); assert.equal(removals.length, 1);
    } finally { dispose(); }
});
