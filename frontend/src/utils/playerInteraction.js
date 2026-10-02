// One classification for native, iframe and keyboard interactions. The room
// state defines intent; permissions decide who may turn an event into a write.
export function playerEventIntent({ action, canControl, canSeek = canControl,
    applyingState, programmaticSeek, authoritativePlaying, position, expectedPosition }) {
    if (applyingState || (action === 'seek' && programmaticSeek)) return 'ignore';
    if (action === 'play' && authoritativePlaying) return 'ignore';
    if (action === 'pause' && !authoritativePlaying) return 'ignore';
    if (action === 'seek' && Math.abs(position - expectedPosition) < 0.35) return 'ignore';
    return (action === 'seek' ? canSeek : canControl) ? 'shared' : 'resync';
}
