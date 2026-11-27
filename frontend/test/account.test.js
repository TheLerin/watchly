import test from 'node:test';
import assert from 'node:assert/strict';
import { accountError, normalizeUsername, safeAvatar, safeReturnPath, validUsername } from '../src/utils/account.js';
import { readRecentRooms, rememberRoom, updateRecentRoomName } from '../src/utils/recentRooms.js';
test('account return destinations cannot redirect to another origin or an auth loop', () => {
    for (const value of ['https://evil.example', '//evil.example', '/\\evil.example', '/auth', '/auth/callback', '/my-watchly\n//evil.example']) assert.equal(safeReturnPath(value), '/my-watchly');
    assert.equal(safeReturnPath('/room/ABCDEFG?access_token=private'), '/room/ABCDEFG');
    assert.equal(safeReturnPath('/profile'), '/profile');
});
test('usernames normalize case and avatars/errors never introduce unsafe schemes or raw credentials', () => {
    assert.equal(normalizeUsername(' @LeRin '), 'lerin'); assert.equal(validUsername('lerin_1'), true);
    for (const value of ['a', 'bob@example.com', 'has space', 'bad.dot', 'X'.repeat(25)]) assert.equal(validUsername(value), false);
    assert.equal(safeAvatar('javascript:alert(1)'), null); assert.equal(safeAvatar('https://secret@evil.example/a.png'), null);
    assert.equal(accountError({ code: '23505', message: 'raw SQL user email' }), 'That username is already taken.');
    assert.equal(accountError({ code: 'otp_expired' }), 'That code is invalid or expired. Request a new one.');
    assert.equal(accountError({ message: 'raw provider secret' }), 'Something went wrong. Please try again.');
});
test('recent rooms are local, capped and store no membership credentials or video details', () => {
    let saved = ''; const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
    for (let index = 0; index < 12; index++) rememberRoom(storage, `ROOM${String(index).padStart(3, '0')}`, index);
    rememberRoom(storage, 'ROOM005', 100); const rooms = readRecentRooms(storage);
    assert.equal(rooms.length, 10); assert.deepEqual(rooms[0], { code: 'ROOM005', visitedAt: 100 });
    assert.equal(rooms.filter(room => room.code === 'ROOM005').length, 1);
    saved = '{bad'; assert.deepEqual(readRecentRooms(storage), []);
});

test('room names survive history updates, rename does not reorder visits, and untrusted history fields are discarded', () => {
    let saved = ''; const storage = { getItem: () => saved, setItem: (_key, value) => { saved = value; } };
    rememberRoom(storage, 'ABCDEFG', 10, ' Friday   movie night ');
    rememberRoom(storage, 'HIJKLMN', 20, 'Other room');
    updateRecentRoomName(storage, 'ABCDEFG', 'Weekend watch party');
    assert.deepEqual(readRecentRooms(storage)[1], { code: 'ABCDEFG', visitedAt: 10, name: 'Weekend watch party' });
    rememberRoom(storage, 'ABCDEFG', 30);
    assert.equal(readRecentRooms(storage)[0].name, 'Weekend watch party');
    updateRecentRoomName(storage, 'ABCDEFG', '');
    assert.equal(readRecentRooms(storage)[0].name, undefined);
    saved = JSON.stringify([{ code: 'ABCDEFG', visitedAt: 40, name: 'x'.repeat(49), resumeToken: 'secret' }, null]);
    assert.deepEqual(readRecentRooms(storage), [{ code: 'ABCDEFG', visitedAt: 40 }]);
});
