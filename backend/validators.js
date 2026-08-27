const PROTOCOL_VERSION = 2;
const ROOM_CODE = /^[A-Z0-9]{7}$/;
const MEDIA_ID = /^sampled-sha256-v1:[1-9]\d{0,15}:[a-f0-9]{64}$/;
const COMMAND_ID = /^[a-zA-Z0-9_-]{8,100}$/;

const normalizedText = (value, max) => typeof value === 'string'
    ? value.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max)
    : '';
const validRoomCode = value => ROOM_CODE.test(value);
const validMediaId = value => typeof value === 'string' && MEDIA_ID.test(value);
const validCommandId = value => typeof value === 'string' && COMMAND_ID.test(value);
const finiteNonNegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;

module.exports = {
    PROTOCOL_VERSION, normalizedText, validRoomCode, validMediaId, validCommandId, finiteNonNegative
};
