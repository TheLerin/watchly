// The server publishes these capabilities in snapshots and role/control events.
// No role policy is duplicated here. Missing/unrecognized capabilities deny.
export const permissionNames = [
    'canControlPlayback', 'canSeek', 'canChangeSource', 'canAddToQueue', 'canManageQueue',
    'canModerateMembers', 'canKickViewers', 'canKickModerators', 'canAssignRoles',
    'canTransferOwnership', 'canChangeRoomSettings', 'canRequestControl',
    'canShareScreen', 'isPlaybackCoordinator',
];
export function getRoomPermissions(member) {
    return Object.fromEntries(permissionNames.map(name => [name, member?.permissions?.[name] === true]));
}
export function canManageMember(member, target) {
    if (!member || !target || member.userId === target.userId || target.role === 'Host') return false;
    const permissions = getRoomPermissions(member);
    return target.role === 'Moderator' ? permissions.canKickModerators : permissions.canKickViewers;
}

export const actionPermission = {
    change_video: 'canChangeSource', add_to_queue: 'canAddToQueue',
    remove_from_queue: 'canManageQueue', reorder_queue: 'canManageQueue', play_next: 'canManageQueue',
    play_video: 'canControlPlayback', pause_video: 'canControlPlayback', seek_video: 'canSeek',
    sync_progress: 'isPlaybackCoordinator', video_ended: 'isPlaybackCoordinator',
    promote_to_moderator: 'canAssignRoles', demote_to_viewer: 'canAssignRoles',
    transfer_host: 'canTransferOwnership', kick_user: 'canModerateMembers',
};
