const ROLES = Object.freeze({ HOST: 'Host', MODERATOR: 'Moderator', VIEWER: 'Viewer' });

// Computed only from server-owned membership. The coordinator is the single
// progress/discovery/end publisher, not the only member allowed to control.
function roomPermissions(member, room) {
    const valid = !member?.accountId || member.authenticated === true;
    const host = valid && member?.role === ROLES.HOST;
    const moderator = valid && member?.role === ROLES.MODERATOR;
    const coordinator = valid && Boolean(member?.userId && member.userId === room?.controllerMemberId);
    const playback = Boolean(member && (host || moderator || coordinator));
    return {
        canControlPlayback: playback, canSeek: playback, canChangeSource: playback,
        canAddToQueue: playback, canManageQueue: playback,
        canModerateMembers: host || moderator, canKickViewers: host || moderator,
        canKickModerators: host, canAssignRoles: host, canTransferOwnership: host,
        canChangeRoomSettings: host, canRequestControl: host || moderator,
        canShareScreen: coordinator && playback, isPlaybackCoordinator: coordinator,
    };
}

function canModerateMember(member, target, room) {
    if (!member || !target || member.userId === target.userId || target.role === ROLES.HOST) return false;
    const permissions = roomPermissions(member, room);
    return target.role === ROLES.MODERATOR ? permissions.canKickModerators : permissions.canKickViewers;
}

module.exports = { ROLES, roomPermissions, canModerateMember };
