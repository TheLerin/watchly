import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { getRoomPermissions, canManageMember } from '../src/utils/roomPermissions.js';
import { playerEventIntent } from '../src/utils/playerInteraction.js';
const { roomPermissions, canModerateMember } = createRequire(import.meta.url)('../../backend/permissions.js');

test('server capabilities give Host/Moderator playback rights without coordinator ownership, Viewer defaults deny', () => {
    const room = { controllerMemberId: 'host' };
    for (const role of ['Host', 'Moderator', 'Viewer']) {
        const member = { userId: role.toLowerCase(), role };
        const permissions = roomPermissions(member, room);
        assert.deepEqual(getRoomPermissions({ ...member, permissions }), permissions);
        for (const key of ['canControlPlayback', 'canSeek', 'canChangeSource', 'canAddToQueue', 'canManageQueue']) assert.equal(permissions[key], role !== 'Viewer');
        assert.equal(permissions.canAssignRoles, role === 'Host');
        assert.equal(permissions.canTransferOwnership, role === 'Host');
    }
    assert.equal(roomPermissions({ userId: 'viewer', role: 'Viewer' }, { controllerMemberId: 'viewer' }).canControlPlayback, true, 'existing server-granted controller fallback is preserved');
    assert.equal(getRoomPermissions({ role: 'Host' }).canControlPlayback, false, 'frontend does not invent authority from a claimed role');
});
test('member management shares server target restrictions and never permits kicking the Host or self', () => {
    for (const role of ['Host', 'Moderator', 'Viewer']) for (const targetRole of ['Host', 'Moderator', 'Viewer']) {
        const room = { controllerMemberId: 'host' }, member = { userId: 'actor', role }, target = { userId: 'target', role: targetRole };
        const allowed = canModerateMember(member, target, room);
        assert.equal(canManageMember({ ...member, permissions: roomPermissions(member, room) }, target), allowed);
        assert.equal(allowed, targetRole !== 'Host' && (role === 'Host' || (role === 'Moderator' && targetRole === 'Viewer')));
        assert.equal(canModerateMember(member, member, room), false);
    }
});
test('unauthorized native play/pause/seek resync; authorized user events become shared commands', () => {
    for (const canControl of [false, true]) for (const action of ['play', 'pause', 'seek']) {
        assert.equal(playerEventIntent({ action, canControl, authoritativePlaying: action === 'pause', position: 90, expectedPosition: 15 }), canControl ? 'shared' : 'resync');
    }
});
test('remote/resync events and programmatic seeks never become commands or recursive recovery', () => {
    for (const action of ['play', 'pause', 'seek']) assert.equal(playerEventIntent({ action, canControl: true, applyingState: true }), 'ignore');
    assert.equal(playerEventIntent({ action: 'seek', canControl: true, programmaticSeek: true, position: 90, expectedPosition: 15 }), 'ignore');
    assert.equal(playerEventIntent({ action: 'play', canControl: false, authoritativePlaying: true }), 'ignore');
    assert.equal(playerEventIntent({ action: 'pause', canControl: false, authoritativePlaying: false }), 'ignore');
});
