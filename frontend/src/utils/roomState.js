export function acceptsVideoState(current, next) {
    if (!next || typeof next !== 'object') return false;
    if (Number.isInteger(next.sourceEpoch) && next.sourceEpoch < (current.sourceEpoch || 0)) return false;
    if (Number.isInteger(next.sourceEpoch) && next.sourceEpoch > (current.sourceEpoch || 0)) return true;
    const sameSource = next.sourceId === current.sourceId && next.localMedia?.sessionId === current.localMedia?.sessionId;
    return !(sameSource && Number.isInteger(next.stateVersion) && next.stateVersion < current.stateVersion);
}

export function mergeChatHistory(previous, history) {
    const messages = new Map(previous.map(message => [message.id, message]));
    for (const message of history || []) messages.set(message.id, message);
    return [...messages.values()].slice(-200);
}
