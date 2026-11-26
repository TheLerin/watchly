const ephemeral = new Set(['clock:ping', 'network_ping', 'room:snapshot', 'ice:config', 'room:access-get', 'playback:telemetry', 'webrtc_offer', 'webrtc_answer', 'webrtc_ice_candidate', 'screen:offer', 'screen:answer', 'screen:ice', 'social:watch', 'social:unwatch', 'social:refresh']);
const base = ['room_meta', 'connections_v2', 'acknowledgements'];
const groups = {
  send_message: ['chat_messages'], add_to_queue: ['queue_items'], remove_from_queue: ['queue_items'], reorder_queue: ['queue_items'],
  'room:access-update': ['room_access'], 'room:invite-create': ['room_invites', 'join_requests'], 'room:invite-revoke': ['room_invites', 'join_requests'],
  'room:admission-decide': ['join_requests'], 'room:unban': ['room_sets'], 'auth:update': ['memberships'], 'auth:clear': ['memberships'],
  'social:invite': ['room_invites', 'join_requests'],
};
export function tablesForEvent(event, authChanged = false) {
  let selected = ephemeral.has(event) ? ['connections_v2'] : groups[event] ? [...base, ...groups[event]] : undefined;
  if (selected && authChanged) selected = [...new Set([...selected, 'memberships', 'room_meta'])];
  return selected;
}
export const actionForEvent = event => event === 'room:create' ? 'create' : event === 'room:join' ? 'join' : event === 'auth:update' ? 'auth' : event.startsWith('room:') && !['room:snapshot', 'room:access-get'].includes(event) || event === 'social:invite' ? 'social' : null;
