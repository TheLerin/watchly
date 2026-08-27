export const PROTOCOL_VERSION = 2;
export const READY_STATES = Object.freeze({
    SELECT_FILE: 'SELECT_FILE', READY: 'READY', MISMATCH: 'MISMATCH',
    UNSUPPORTED: 'UNSUPPORTED', ERROR: 'ERROR', BUFFERING: 'BUFFERING'
});
export const protocolErrorMessage = response => response?.error?.message || 'The room request failed.';
export const commandId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
