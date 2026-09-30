const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const { fork } = require('node:child_process');
const { existsSync } = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const freePort = () => new Promise(resolve => {
 const server = net.createServer();
 server.listen(0, '127.0.0.1', () => { const port = server.address().port; server.close(() => resolve(port)); });
});
const ready = async url => {
 for (let attempt = 0; attempt < 100; attempt++) {
  try { if ((await fetch(url)).ok) return; } catch { /* still starting */ }
  await new Promise(resolve => setTimeout(resolve, 100));
 }
 throw new Error('Test server did not start: ' + url);
};
(async () => {
 const backendPort = await freePort();
 const frontendPort = await freePort();
 const baseUrl = 'http://127.0.0.1:' + frontendPort;
 const backendUrl = 'http://127.0.0.1:' + backendPort;
 const backend = fork(path.resolve(__dirname, '../../backend/server.js'), [], { env: { ...process.env, PORT: String(backendPort), CORS_ORIGIN: baseUrl }, stdio: 'ignore' });
 const frontend = fork(path.resolve(__dirname, '../node_modules/vite/bin/vite.js'), ['--host', '127.0.0.1', '--port', String(frontendPort), '--strictPort'], { cwd: path.resolve(__dirname, '..'), env: { ...process.env, VITE_BACKEND_URL: backendUrl }, stdio: 'ignore' });
 let browser;
 try {
 await Promise.all([ready(backendUrl), ready(baseUrl)]);
 const executablePath = process.env.BROWSER_EXECUTABLE || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
 ].find(file => existsSync(file));
 browser = await chromium.launch({ executablePath, headless: true, args: ['--autoplay-policy=no-user-gesture-required'] });
 const errors=[];
 const host=await browser.newPage(); const viewer=await browser.newPage();
 for(const page of [host,viewer]) page.on('pageerror',e=>errors.push(e.message));
 const wait=async(fn,label)=>{for(let i=0;i<100;i++){if(await fn())return;await new Promise(r=>setTimeout(r,100));}throw new Error(label)};
 const video = page=>page.locator('.room-player-surface video');
 const values=page=>video(page).evaluate(v=>({time:v.currentTime,paused:v.paused,ready:v.readyState,duration:v.duration}));
 try {
 const invalidSession = await browser.newPage();
 await invalidSession.addInitScript(() => sessionStorage.setItem('watchTogetherSession', '{invalid'));
 await invalidSession.goto(baseUrl + '/room/ABCDEFG');
 await invalidSession.getByRole('heading', { name: 'Join ABCDEFG' }).waitFor();
 assert.equal(await invalidSession.evaluate(() => sessionStorage.getItem('watchTogetherSession')), null);
 await invalidSession.close();
 console.log('PASS malformed saved session recovers without waiting for a connection');
 await host.goto(baseUrl);
 await host.getByRole('button',{name:'Create room',exact:true}).first().click();
 await host.getByPlaceholder('Your nickname').fill('Browser host');
 await host.locator('.room-launcher-submit').click();
 await host.waitForURL('**/room/**');
 const roomId=host.url().split('/').pop();
 await viewer.goto(baseUrl);
 await viewer.getByRole('button',{name:'Join room',exact:true}).first().click();
 await viewer.getByPlaceholder('Your nickname').fill('Browser viewer');
 await viewer.getByPlaceholder('ROOM CODE').fill(roomId);
 await viewer.locator('.room-launcher-submit').click();
 await viewer.waitForURL('**/room/**');
 await host.getByRole('button', { name: 'Room details' }).click();
 await host.locator('.room-info-popover code').getByText(roomId, { exact: true }).waitFor();
 await host.getByRole('button', { name: 'Copy room code' }).click();
 await host.getByRole('button', { name: 'Room details' }).click();
 await host.locator('.room-leave-button').click();
 await host.getByText('Leave this room?', { exact: true }).waitFor();
 await host.locator('.room-leave-button').click();
 assert.equal(await host.locator('.room-leave-popover').count(), 0);
 const stage = await host.locator('.room-player-surface').boundingBox();
 assert.ok(Math.abs(stage.x + stage.width / 2 - 640) < 3, 'the screen should be centered in the viewport');
 assert.ok(stage.width > 800, 'the theater screen should use the available wall space');
 assert.equal(await host.locator('.theater-side-wall').count(), 2);
 assert.equal(await host.locator('.theater-floor').count(), 1);
 const roomGeometry = await host.evaluate(() => {
  const polygon = selector => getComputedStyle(document.querySelector(selector)).clipPath
   .match(/^polygon\((.*)\)$/)[1].split(',').map(value => {
    const [x, y] = value.trim().split(/\s+/).map(parseFloat);
    return { x, y };
   });
  return {
   back: polygon('.theater-back-wall'),
   left: polygon('.theater-wall-left'),
   right: polygon('.theater-wall-right'),
   floor: polygon('.theater-floor'),
  };
 });
 assert.equal(roomGeometry.back[0].x, roomGeometry.back[3].x, 'left room corner should be vertical');
 assert.equal(roomGeometry.back[1].x, roomGeometry.back[2].x, 'right room corner should be vertical');
 assert.deepEqual(roomGeometry.left[1], roomGeometry.back[0]);
 assert.deepEqual(roomGeometry.left[2], roomGeometry.back[3]);
 assert.deepEqual(roomGeometry.right[0], roomGeometry.back[1]);
 assert.deepEqual(roomGeometry.right[3], roomGeometry.back[2]);
 assert.deepEqual(roomGeometry.floor[0], roomGeometry.back[3]);
 assert.deepEqual(roomGeometry.floor[1], roomGeometry.back[2]);
 await host.getByRole('button', { name: 'Watch controls' }).click();
 await host.getByRole('textbox', { name: /Watch from Link/ }).fill(baseUrl + '/bg-video.mp4');
 await host.getByRole('button',{name:'Play Now',exact:true}).click();
 await video(host).waitFor(); await video(viewer).waitFor();
 await wait(async()=>{const a=await values(host),b=await values(viewer);return a.time>1&&b.time>1},'remote did not play');
 await wait(async()=>host.evaluate(()=>document.querySelector('.room-shell').style.getPropertyValue('--ambient-opacity')==='1'),'video ambient light did not start');
 assert.match(await host.evaluate(()=>document.querySelector('.room-shell').style.getPropertyValue('--video-left-rgb')), /^\d+ \d+ \d+$/);
 await video(host).evaluate(v=>v.pause());
 await wait(async()=> (await values(viewer)).paused,'remote pause did not synchronize');
 await wait(async()=>host.evaluate(()=>document.querySelector('.room-shell').style.getPropertyValue('--ambient-opacity')==='0'),'video ambient light did not stop on pause');
 await video(host).evaluate(v=>{v.currentTime=5});
 await wait(async()=>Math.abs((await values(viewer)).time-5)<0.3,'remote seek did not synchronize');
 await video(host).evaluate(v=>v.play());
 await wait(async()=>!(await values(viewer)).paused,'remote resume failed');
 console.log('PASS remote play, pause, seek, resume',await values(host),await values(viewer));

 await host.evaluate(() => {
  navigator.mediaDevices.getDisplayMedia = async () => {
   const canvas = document.createElement('canvas');
   canvas.width = 320; canvas.height = 180;
   canvas.getContext('2d').fillRect(0, 0, 320, 180);
   window.testScreenStream = canvas.captureStream(5);
   return window.testScreenStream;
  };
 });
 await host.getByRole('button', { name: 'Share screen' }).click();
 await host.getByRole('button', { name: 'Share Screen (Beta)' }).click();
 await host.getByRole('button', { name: 'Stop sharing' }).waitFor();

 host.on('dialog', dialog => dialog.accept('Browser regression movie'));
 const chooser = host.waitForEvent('filechooser');
 await host.getByTitle('Play a file that stays on each person’s device').click();
 await (await chooser).setFiles(path.resolve(__dirname, '../public/bg-video.mp4'));
 await viewer.getByRole('heading',{name:'Choose the same local file'}).waitFor();
 await host.getByRole('button', { name: 'Start anyway' }).click();
 await wait(async () => await video(host).count() && !(await values(host)).paused, 'Start anyway did not play for the host');
 await viewer.locator('input[type=file][accept^="video/"]').setInputFiles(path.resolve(__dirname, '../public/bg-video.mp4'));
 await viewer.getByRole('button', { name: 'Now watching' }).click();
 await host.getByText('2/2 ready',{exact:true}).waitFor();
 await wait(async () => await video(viewer).count() && !(await values(viewer)).paused, 'viewer did not join Start anyway playback');
 await host.getByRole('textbox', { name: /Watch from Link/ }).blur();
 await host.keyboard.press('Space');
 await wait(async()=> (await values(host)).paused&&(await values(viewer)).paused,'Start anyway playback did not pause');
 console.log('PASS Start anyway and late file readiness');
 assert.equal(await host.evaluate(() => window.testScreenStream.getVideoTracks()[0].readyState), 'live');
 await host.getByRole('button', { name: 'Stop sharing' }).click();
 assert.equal(await host.evaluate(() => window.testScreenStream.getVideoTracks()[0].readyState), 'ended');
 console.log('PASS screen sharing survives readiness updates and stops cleanly (synthetic capture)');
 await wait(async()=> (await values(host)).ready>=3&&(await values(viewer)).ready>=3,'local media not ready');
 await host.keyboard.press('Space');
 await wait(async()=>!(await values(host)).paused&&!(await values(viewer)).paused,'local scheduled play failed');
 await new Promise(r=>setTimeout(r,1500));
 let a=await values(host),b=await values(viewer);
 assert.ok(Math.abs(a.time-b.time)<0.3,JSON.stringify({a,b}));
 await host.keyboard.press('Space');
 await wait(async()=> (await values(host)).paused&&(await values(viewer)).paused,'local scheduled pause failed');
 await video(host).evaluate(v=>{v.currentTime=20});
 await wait(async()=>Math.abs((await values(viewer)).time-20)<0.3,'local paused seek failed');
 await host.keyboard.press('Space');
 await wait(async()=>!(await values(viewer)).paused,'local resume failed');
 await video(host).evaluate(v=>{v.currentTime=40});
 await wait(async()=> (await values(viewer)).time>=40,'local playing seek failed');
 await new Promise(r=>setTimeout(r,1200));
 a=await values(host);b=await values(viewer);
 assert.ok(Math.abs(a.time-b.time)<0.3,JSON.stringify({a,b}));
 console.log('PASS local play, pause, paused seek, playing seek, drift',a,b);
 const late = await browser.newPage();
 late.on('pageerror', error => errors.push(error.message));
 await late.goto(baseUrl);
 await late.getByRole('button', { name: 'Join room', exact: true }).first().click();
 await late.getByPlaceholder('Your nickname').fill('Late viewer');
 await late.getByPlaceholder('ROOM CODE').fill(roomId);
 await late.locator('.room-launcher-submit').click();
 await late.waitForURL('**/room/**');
 await late.getByRole('heading', { name: 'Choose the same local file' }).waitFor();
 await late.locator('input[type=file][accept^="video/"]').setInputFiles(path.resolve(__dirname, '../public/bg-video.mp4'));
 await wait(async () => {
  if (!await video(late).count()) return false;
  const h = await values(host), l = await values(late);
  return !l.paused && l.time > 40 && Math.abs(h.time - l.time) < 0.3;
 }, 'late local viewer did not join at the room position');
 await late.close();
 await host.getByText('2/2 ready', { exact: true }).waitFor();
 console.log('PASS local late join and departure readiness');
 await video(host).evaluate(v => { v.currentTime = v.duration - 1; });
 await wait(async () => {
  const result = await host.evaluate(async () => {
   const { socket } = await import('/src/socket.js');
   return new Promise(resolve => socket.emit('room:snapshot', {}, resolve));
  });
  return result.snapshot.playback.status === 'paused' && (await values(host)).paused && (await values(viewer)).paused;
 }, 'local movie did not finish');
 await host.keyboard.press('Space');
 await wait(async () => {
  const h = await values(host), v = await values(viewer);
  return !h.paused && !v.paused && h.time < 3 && v.time < 3;
 }, 'replaying an ended movie did not restart both players');
 console.log('PASS local movie ends and replays from the beginning');
 const sourceBeforeSubtitle = await video(host).getAttribute('src');
 await host.locator('input[type=file][accept*=".srt"]').setInputFiles({
  name: 'en.srt', mimeType: 'application/x-subrip',
  buffer: Buffer.from('1\n00:00:00,000 --> 00:00:10,000\nSubtitle worker loaded this track.\n'),
 });
 await wait(async () => video(host).evaluate(v => [...v.textTracks].some(track => track.mode === 'showing')),
  'selected subtitles did not become active');
 assert.equal(await video(host).getAttribute('src'), sourceBeforeSubtitle, 'loading subtitles must not reload the local video');
 console.log('PASS subtitle file loads off thread and activates without changing video source');
 await host.evaluate(async()=>{const {socket}=await import('/src/socket.js');socket.disconnect()});
 await wait(async()=> (await values(viewer)).paused,'host disconnect did not pause viewer');
 assert.ok(await viewer.getByText('Browser regression movie',{exact:true}).count()>0);
 await host.evaluate(async()=>{const {socket}=await import('/src/socket.js');socket.connect()});
 await viewer.getByText('2/2 ready',{exact:true}).waitFor();
 await host.getByText('2/2 ready',{exact:true}).waitFor();
 console.log('PASS local host disconnect, source preservation, reconnect readiness');
 await host.getByRole('textbox', { name: /Watch from Link/ }).fill(baseUrl + '/bg-video.mp4');
 await host.getByRole('button',{name:'Play Now',exact:true}).click();
 await wait(async()=> !(await values(viewer)).paused,'local to remote playback failed');
 assert.equal(await viewer.getByRole('region',{name:'Local file readiness'}).count(),0);
 console.log('PASS local to remote source switch');

 const viewerSocketId = await viewer.evaluate(async () => (await import('/src/socket.js')).socket.id);
 await host.evaluate(async ({ roomId, targetId }) => {
  (await import('/src/socket.js')).socket.emit('promote_to_moderator', { roomId, targetId });
 }, { roomId, targetId: viewerSocketId });
 await viewer.getByRole('button', { name: 'Members and queue' }).click();
 await viewer.getByRole('button', { name: 'Take playback control' }).click();
 await viewer.getByRole('button', { name: 'Watch controls' }).click();
 await viewer.getByRole('button', { name: 'Play Now', exact: true }).waitFor();
 assert.equal(await host.getByRole('button', { name: 'Play Now', exact: true }).count(), 0);
 await viewer.getByRole('textbox', { name: /Watch from Link/ }).fill(baseUrl + '/bg-video.mp4');
 await viewer.getByRole('button', { name: 'Queue', exact: true }).click();
 await viewer.getByRole('button', { name: 'Play Next', exact: true }).waitFor();
 await host.getByRole('button', { name: 'Members and queue' }).click();
 assert.equal(await host.getByRole('button', { name: 'Play Next', exact: true }).count(), 0);
 await host.evaluate(async ({ roomId, targetId }) => {
  (await import('/src/socket.js')).socket.emit('demote_to_viewer', { roomId, targetId });
 }, { roomId, targetId: viewerSocketId });
 await host.getByRole('button', { name: 'Watch controls' }).click();
 await host.getByRole('button', { name: 'Play Now', exact: true }).waitFor();
 await host.getByRole('button', { name: 'Play Next', exact: true }).waitFor();
 assert.equal(await viewer.getByRole('button', { name: 'Play Next', exact: true }).count(), 0);
 console.log('PASS moderator control on links and demotion');
 await video(host).evaluate(v => { v.currentTime = v.duration - 0.6; });
 await wait(async () => {
  const queueLength = await host.evaluate(async () => {
   const { socket } = await import('/src/socket.js');
   return new Promise(resolve => socket.emit('room:snapshot', {}, response => resolve(response.snapshot.queue.length)));
  });
  const h = await values(host), v = await values(viewer);
  return queueLength === 0 && !h.paused && !v.paused && h.time < 4 && v.time < 4;
 }, 'finished video did not automatically play the queued item');
 console.log('PASS queue automatically plays the next video, including the same URL');
 await host.getByRole('textbox', { name: /Watch from Link/ }).fill(baseUrl + '/');
 await host.getByRole('button', { name: 'Play Now', exact: true }).click();
 await host.getByText('This source cannot be played directly in the browser.', { exact: false }).waitFor();
 console.log('PASS unsupported webpage shows a useful playback error');
 await viewer.getByRole('button', { name: 'Live chat' }).click();
 await host.evaluate(async roomId => {
  const { socket } = await import('/src/socket.js');
  for (let i = 0; i < 14; i++) {
   socket.emit('send_message', { roomId, message: { id: `scroll_check_${i}`, text: `scroll check ${i} ${'longword'.repeat(12)}` } });
   await new Promise(resolve => setTimeout(resolve, 530));
  }
 }, roomId);
 await viewer.getByText(/scroll check 13/).waitFor();
 const messageList = viewer.locator('.room-chat .overflow-y-auto').first();
 assert.ok(await messageList.evaluate(element => element.scrollHeight - element.scrollTop - element.clientHeight < 64),
  'chat should follow new messages while the reader is at the bottom');
 await messageList.evaluate(element => { element.scrollTop = 0; });
 const scrollBefore = await messageList.evaluate(element => element.scrollTop);
 await host.evaluate(async roomId => {
  const { socket } = await import('/src/socket.js');
  socket.emit('send_message', { roomId, message: { id: 'scroll_check_new', text: 'scroll check newest' } });
 }, roomId);
 await viewer.getByText('scroll check newest', { exact: true }).waitFor();
 const chatLayout = await messageList.evaluate(element => ({
  scrollTop: element.scrollTop, scrollWidth: element.scrollWidth, clientWidth: element.clientWidth,
 }));
 assert.ok(chatLayout.scrollTop <= scrollBefore + 2, 'a new chat message should not pull a reader away from old messages');
 assert.ok(chatLayout.scrollWidth <= chatLayout.clientWidth + 1, 'long messages should wrap inside the chat panel');
 console.log('PASS chat keeps the reader position and wraps long messages');
 await host.evaluate(async ({ roomId, targetId }) => {
  (await import('/src/socket.js')).socket.emit('kick_user', { roomId, targetId });
 }, { roomId, targetId: viewerSocketId });
 await viewer.waitForURL(baseUrl + '/');
 await viewer.getByRole('button', { name: 'Create room', exact: true }).first().waitFor();
 assert.equal(await viewer.evaluate(() => sessionStorage.getItem('watchTogetherSession')), null);
 await viewer.getByRole('button', { name: 'Create room', exact: true }).first().click();
 await viewer.getByPlaceholder('Your nickname').fill('New host');
 await viewer.locator('.room-launcher-submit').click();
 await viewer.waitForURL('**/room/**');
 assert.notEqual(viewer.url().split('/').pop(), roomId);
 console.log('PASS kicked participant returns home and can create a new room');

 assert.deepEqual(errors,[]);
 } catch(error) {
  console.log('TIMES',await values(host).catch(()=>null),await values(viewer).catch(()=>null));
  console.log('HOST',await host.locator('body').innerText());
  console.log('VIEWER',await viewer.locator('body').innerText());
  throw error;
 }
 } finally { await browser?.close(); frontend.kill(); backend.kill(); }
})().catch(e=>{console.error(e);process.exitCode=1});
