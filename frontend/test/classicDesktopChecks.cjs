const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async ({ host, viewer, baseUrl, video, values, wait }) => {
 const appearance = async (page, choice) => {
  await page.getByRole('button', { name: 'Room settings', exact: true }).click();
  await page.locator('.appearance-panel').getByRole('button', { name: new RegExp('^' + choice + '(?: |$)') }).click();
  await page.keyboard.press('Escape');
  await page.locator('.appearance-panel').waitFor({ state: 'hidden' });
 };
 const tab = (page, name) => page.getByRole('tab', { name, exact: true }).click();
 const bounds = async page => {
  const player = await page.locator('.room-player-surface').boundingBox();
  const rail = await page.locator('.room-right-rail').boundingBox();
  const tabs = await page.locator('.classic-desktop-tabs').boundingBox();
  const controls = await page.locator('.video-player-controls').boundingBox();
  return { player, rail, tabs, controls };
 };
 await host.evaluate(() => { window.classicVideo = document.querySelector('.room-player-surface video'); });
 await appearance(host, 'Classic');
 await appearance(viewer, 'Classic');
 await tab(host, 'Watch');
 assert.ok(await host.evaluate(() => window.classicVideo === document.querySelector('.room-player-surface video')),
  'changing desktop appearance must retain the player');
 for (const [width, height] of [[1920, 1080], [1600, 900], [1440, 900], [1366, 768], [1280, 800], [2560, 1440], [1920, 650]]) {
  await host.setViewportSize({ width, height });
  const { player, rail, tabs, controls } = await bounds(host);
  assert.ok(Math.abs(player.width / player.height - 16 / 9) < .005, 'player must remain 16:9');
  assert.ok(player.x + player.width + 19 <= rail.x, 'sidebar must sit to the right of the player');
  assert.ok(Math.abs(player.y - rail.y) < 1, 'player and sidebar must align at the top');
  assert.ok(rail.width >= 360 && rail.width <= 420);
  assert.ok(controls.x >= rail.x && controls.x + controls.width <= rail.x + rail.width);
  assert.ok(controls.y >= tabs.y + tabs.height && controls.y + controls.height <= rail.y + rail.height);
  assert.ok(player.y + player.height <= height - 23 && rail.y + rail.height <= height - 23);
  assert.ok(await host.evaluate(() => document.documentElement.scrollWidth <= innerWidth && document.documentElement.scrollHeight <= innerHeight),
   'desktop should not scroll the document');
  assert.equal(await host.locator('.room-player-surface').count(), 1);
  assert.equal(await host.locator('.watch-source-controls').count(), 1);
  assert.equal(await host.locator('#room-link-input').count(), 1);
  assert.equal(await host.getByRole('button', { name: 'Play Now', exact: true }).count(), 1);
  assert.equal(await host.getByRole('button', { name: 'Queue', exact: true }).count(), 1);
  assert.equal(await host.getByTitle('Play a file that stays on each person’s device').count(), 1);
 }
 await host.setViewportSize({ width: 1366, height: 768 });
 const darkBounds = await bounds(host);
 await appearance(host, 'Light Glass');
 assert.deepEqual(await bounds(host), darkBounds, 'Light Glass must use the same layout');
 const lightColors = await host.locator('.classic-desktop-tabs').evaluate(el => ({
  background: getComputedStyle(el).backgroundColor,
  text: getComputedStyle(el.querySelector('[aria-selected="true"]')).color,
 }));
 assert.equal(lightColors.background, 'rgb(235, 235, 238)');
 assert.equal(lightColors.text, 'rgb(39, 39, 42)');
 await appearance(host, 'Dark Glass');
 await host.getByRole('tab', { name: 'Watch', exact: true }).focus();
 await host.keyboard.press('ArrowRight');
 assert.equal(await host.getByRole('tab', { name: 'Room', exact: true }).getAttribute('aria-selected'), 'true');
 await host.keyboard.press('End');
 assert.equal(await host.getByRole('tab', { name: 'Chat', exact: true }).evaluate(el => el === document.activeElement), true);
 await host.keyboard.press('Home');
 assert.equal(await host.getByRole('tab', { name: 'Watch', exact: true }).getAttribute('aria-selected'), 'true');
 console.log('PASS Classic desktop sizing, single controls, Light Glass, keyboard tabs');

 await host.locator('#room-link-input').fill('https://example.com/draft.mp4');
 await tab(host, 'Chat');
 await host.getByPlaceholder('Type a message...').fill('Classic chat draft');
 await tab(host, 'Call');
 await host.evaluate(() => {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 180;
  canvas.getContext('2d').fillRect(0, 0, 320, 180);
  navigator.mediaDevices.getDisplayMedia = async () => (window.classicScreenStream = canvas.captureStream(5));
  navigator.mediaDevices.getUserMedia = async () => {
   const audio = new AudioContext();
   const oscillator = audio.createOscillator();
   const destination = audio.createMediaStreamDestination();
   oscillator.connect(destination); oscillator.start();
   window.classicAudioContext = audio;
   window.classicVoiceStream = destination.stream;
   return destination.stream;
  };
 });
 await host.getByRole('button', { name: 'Join Voice', exact: true }).click();
 await host.getByRole('button', { name: 'Mute', exact: true }).waitFor();
 await host.getByRole('button', { name: 'Share Screen (Beta)', exact: true }).click();
 await host.getByRole('button', { name: 'Stop sharing', exact: true }).waitFor();
 const beforeTabs = await values(host);
 for (let repeat = 0; repeat < 3; repeat++) {
  for (const name of ['Room', 'Chat', 'Watch', 'Call']) {
   await tab(host, name);
   assert.equal(await host.locator('.video-player-controls').isVisible(), name === 'Watch');
   assert.equal(await host.locator('.room-members-group').isVisible(), name === 'Room');
   assert.equal(await host.locator('.room-voice-group').isVisible(), name === 'Call');
   assert.equal(await host.locator('.room-share-group').isVisible(), name === 'Call');
   assert.equal(await host.locator('.room-chat-group').isVisible(), name === 'Chat');
   assert.ok(await host.evaluate(() => window.classicVideo === document.querySelector('.room-player-surface video')));
   assert.ok(await video(host).isVisible());
  }
 }
 assert.equal(await host.evaluate(() => window.classicVoiceStream.getAudioTracks()[0].readyState), 'live');
 assert.equal(await host.evaluate(() => window.classicScreenStream.getVideoTracks()[0].readyState), 'live');
 await host.getByRole('button', { name: 'Mute', exact: true }).click();
 await host.getByRole('button', { name: 'Unmute', exact: true }).waitFor();
 await host.getByRole('button', { name: 'Stop sharing', exact: true }).click();
 assert.equal(await host.evaluate(() => window.classicScreenStream.getVideoTracks()[0].readyState), 'ended');
 await host.locator('.room-voice').getByRole('button', { name: 'Leave', exact: true }).click();
 await host.getByRole('button', { name: 'Join Voice', exact: true }).waitFor();
 assert.equal(await host.evaluate(() => window.classicVoiceStream.getAudioTracks()[0].readyState), 'ended');
 await host.evaluate(() => window.classicAudioContext.close());
 await tab(host, 'Chat');
 assert.equal(await host.getByPlaceholder('Type a message...').inputValue(), 'Classic chat draft');
 await tab(viewer, 'Chat');
 await host.getByPlaceholder('Type a message...').press('Enter');
 await viewer.getByText('Classic chat draft', { exact: true }).waitFor();
 await host.evaluate(async roomId => {
  const { socket } = await import('/src/socket.js');
  for (let index = 0; index < 10; index++) {
   socket.emit('send_message', { roomId, message: { id: `classic_scroll_${index}`, text: `Classic scroll ${index} ${'longword'.repeat(12)}` } });
   await new Promise(resolve => setTimeout(resolve, 530));
  }
 }, host.url().split('/').pop());
 await viewer.getByText(/Classic scroll 9/).waitFor();
 const messages = host.locator('.room-chat .overflow-y-auto').first();
 assert.ok(await messages.evaluate(el => el.scrollHeight > el.clientHeight && el.scrollWidth <= el.clientWidth + 1),
  'Classic chat must scroll internally and wrap long messages');
 const chat = await host.locator('.room-chat').boundingBox();
 const chatInput = await host.getByPlaceholder('Type a message...').boundingBox();
 assert.ok(chatInput.y + chatInput.height <= chat.y + chat.height);
 const afterTabs = await values(host);
 assert.equal(afterTabs.paused, beforeTabs.paused, 'tabs must not pause playback');
 assert.ok(afterTabs.time >= beforeTabs.time, 'tabs must not reset playback time');
 await tab(host, 'Watch');
 assert.equal(await host.locator('#room-link-input').inputValue(), 'https://example.com/draft.mp4');
 console.log('PASS Classic tab state, chat, voice and screen sharing (synthetic capture)');

 await host.locator('#room-link-input').fill(baseUrl + '/bg-video.mp4');
 await host.getByRole('button', { name: 'Play Now', exact: true }).click();
 await wait(async () => !(await values(viewer)).paused, 'Classic Play Now did not synchronize');
 await host.getByTitle('Streaming direct file').waitFor();
 await host.locator('#room-link-input').fill(baseUrl + '/bg-video.mp4');
 await host.getByRole('button', { name: 'Queue', exact: true }).click();
 await tab(host, 'Room');
 const removeQueued = host.getByRole('button', { name: 'Remove queue item 1', exact: true });
 await removeQueued.waitFor();
 assert.ok(await host.locator('.room-members-queue').getByText('Browser viewer', { exact: true }).count());
 await removeQueued.click();
 await tab(host, 'Watch');
 host.once('dialog', dialog => dialog.accept('Classic local test'));
 const chooser = host.waitForEvent('filechooser');
 await host.getByTitle('Play a file that stays on each person’s device').click();
 await (await chooser).setFiles(path.resolve(__dirname, '../public/bg-video.mp4'));
 await viewer.getByRole('heading', { name: 'Choose the same local file', exact: true }).waitFor();
 await host.getByRole('button', { name: 'Start anyway', exact: true }).click();
 await viewer.locator('input[type=file][accept^="video/"]').setInputFiles(path.resolve(__dirname, '../public/bg-video.mp4'));
 await tab(host, 'Room');
 await host.getByRole('region', { name: 'Local file readiness', exact: true }).getByText('2/2', { exact: true }).waitFor();
 await tab(host, 'Watch');
 await host.getByTitle('This video stays on each person’s device').waitFor();
 await video(host).evaluate(el => {
  window.classicAudioTracks = [
   { id: 'english', label: 'English', language: 'en', enabled: true },
   { id: 'malayalam', label: 'Malayalam', language: 'ml', enabled: false },
  ];
  Object.defineProperty(el, 'audioTracks', { configurable: true, value: window.classicAudioTracks });
 });
 await host.locator('input[type=file][accept*=".srt"]').setInputFiles({
  name: 'classic-en.srt', mimeType: 'application/x-subrip',
  buffer: Buffer.from('1\n00:00:00,000 --> 00:00:10,000\nClassic subtitle.\n'),
 });
 await wait(async () => video(host).evaluate(el => [...el.textTracks].some(track => track.mode === 'showing')), 'Classic subtitles did not activate');
 const audio = host.locator('.media-control-field').filter({ hasText: 'Audio' }).locator('select');
 await audio.selectOption({ label: 'Malayalam' });
 assert.deepEqual(await host.evaluate(() => window.classicAudioTracks.map(track => track.enabled)), [false, true]);
 const subtitles = host.locator('.media-control-field').filter({ hasText: 'Subtitles' }).locator('select');
 const subtitleId = await subtitles.inputValue();
 await subtitles.selectOption('');
 await wait(async () => video(host).evaluate(el => [...el.textTracks].every(track => track.mode !== 'showing')), 'Classic subtitles did not turn off');
 await subtitles.selectOption(subtitleId);
 await tab(host, 'Chat');
 await tab(host, 'Watch');
 assert.deepEqual(await host.evaluate(() => window.classicAudioTracks.map(track => track.enabled)), [false, true], 'Classic tabs reset audio');
 await wait(async () => video(host).evaluate(el => [...el.textTracks].some(track => track.mode === 'showing')), 'Classic tabs reset subtitles');
 await viewer.setViewportSize({ width: 1366, height: 768 });
 await viewer.getByRole('button', { name: 'Fullscreen video locally', exact: true }).click();
 await wait(async () => viewer.evaluate(() => Boolean(document.fullscreenElement)), 'Classic fullscreen did not start');
 const full = await viewer.locator('.room-player-surface').boundingBox();
 assert.ok(full.width >= 1365 && full.height >= 767);
 await viewer.evaluate(() => document.exitFullscreen());
 await wait(async () => viewer.evaluate(() => !document.fullscreenElement), 'Classic fullscreen did not exit');
 await video(host).evaluate(el => { delete el.audioTracks; });
 await host.locator('#room-link-input').fill(baseUrl + '/bg-video.mp4');
 await host.getByRole('button', { name: 'Play Now', exact: true }).click();
 await wait(async () => !(await values(viewer)).paused, 'Classic local-to-URL switch did not synchronize');
 console.log('PASS Classic Play Now, queue, members, local file, readiness, audio selector (synthetic native tracks), subtitles, fullscreen');

 await host.setViewportSize({ width: 1280, height: 720 });
 await viewer.setViewportSize({ width: 1280, height: 720 });
 await appearance(host, 'Cinematic');
 await appearance(viewer, 'Cinematic');
 const watch = host.getByRole('button', { name: 'Watch controls', exact: true });
 if (await watch.getAttribute('aria-expanded') !== 'true') await watch.click();
};
