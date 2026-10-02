const assert = require('node:assert/strict');

module.exports = async ({ host, viewer, video, values, wait, touch = false }) => {
 const cdp = await host.context().newCDPSession(host);
 await cdp.send('DOM.enable');
 const control = async pseudo => {
  await video(host).hover();
  const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
  const nodes = [];
  const walk = value => {
   if (value.attributes?.includes(pseudo)) nodes.push(value);
   for (const child of [...(value.children || []), ...(value.shadowRoots || [])]) walk(child);
  };
  walk(root);
  for (const node of nodes) {
   const result = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId }).catch(() => null);
   if (!result) continue; // Native controls also include hidden overflow-menu copies.
   const q = result.model.content;
   if (q[2] > q[0] && q[5] > q[1]) {
    let thumb;
    const findThumb = value => {
     if (value.attributes?.includes('-webkit-slider-thumb')) thumb = value;
     for (const child of [...(value.children || []), ...(value.shadowRoots || [])]) findThumb(child);
    };
    findThumb(node);
    const thumbModel = thumb && await cdp.send('DOM.getBoxModel', { nodeId: thumb.nodeId }).catch(() => null);
    // Chromium paints a 12px media thumb without exposing its box in some builds.
    const inset = thumbModel ? (thumbModel.model.border[2] - thumbModel.model.border[0]) / 2 : 6;
    return { x: q[0] + inset, y: q[1], width: q[2] - q[0] - inset * 2, height: q[5] - q[1] };
   }
  }
  throw new Error(`visible native ${pseudo} control not found`);
 };
 const clickTimeline = async target => {
  const box = await control('-webkit-media-controls-timeline');
  const duration = await video(host).evaluate(el => el.duration);
  const point = { x: box.x + box.width * target / duration, y: box.y + box.height / 2 };
  if (touch) {
   await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
   await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else await host.mouse.click(point.x, point.y);
 };
 const toggleNative = async () => {
  const box = await control('-webkit-media-controls-play-button');
  await host.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
 };
 const settle = async playing => {
  await wait(async () => {
   const a = await values(host), b = await values(viewer);
   return a.ready >= 3 && b.ready >= 3 && a.paused === !playing && b.paused === !playing && Math.abs(a.time - b.time) < .3;
  }, 'native seek did not preserve playback and synchronize');
 };
 for (const page of [host, viewer]) await page.evaluate(async () => {
  const { socket } = await import('/src/socket.js');
  const el = document.querySelector('.room-player-surface video');
  window.seekCheckVideo = el;
  window.seekCheckSource = el.currentSrc;
  window.seekCheckCommands = [];
  window.seekCheckPauses = [];
  window.seekCommandListener = (event, payload) => {
   if (event === 'playback:command') window.seekCheckCommands.push({ ...payload, at: performance.now() });
  };
  window.seekPauseListener = () => window.seekCheckPauses.push({ time: el.currentTime, seeking: el.seeking, paused: el.paused });
  socket.onAnyOutgoing(window.seekCommandListener);
  el.addEventListener('pause', window.seekPauseListener);
 });
 if (touch) await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
 try {
  if (!(await values(host)).paused) { await video(host).evaluate(el => el.pause()); await settle(false); }
  await clickTimeline(40);
  assert.ok(Math.abs((await values(host)).time - 40) < .3, 'paused seek must update locally immediately');
  assert.equal((await values(host)).paused, true);
  await wait(async () => Math.abs((await values(viewer)).time - 40) < .3, 'paused receiver did not follow');
  await settle(false);
  assert.equal(await host.evaluate(() => seekCheckCommands.filter(command => command.action === 'PLAY').length), 0,
   'paused seeking must never request play');
  await toggleNative();
  await settle(true);
  await host.evaluate(() => { seekCheckCommands = []; seekCheckPauses = []; });
  await viewer.evaluate(() => { seekCheckCommands = []; });
  await clickTimeline(60);
  assert.ok(Math.abs((await values(host)).time - 60) < .3, 'playing seek must update locally immediately');
  await settle(true);
  await clickTimeline(5);
  assert.ok(Math.abs((await values(host)).time - 5) < .3, 'backward seek must update locally immediately');
  await settle(true);

  // Delayed commands and delayed confirmations must not undo fresh local input.
  await host.evaluate(async () => {
   const { socket } = await import('/src/socket.js');
   window.seekOriginalPacket = socket.packet;
   window.seekOriginalOnevent = socket.onevent;
   // Delay packets after Socket.IO registers the acknowledgement. Delaying emit
   // would leave its shared timeout flag for unrelated telemetry to consume.
   socket.packet = function(packet) {
    if (packet.data?.[0] === 'playback:command' && packet.data[1]?.action === 'SEEK') {
     setTimeout(() => window.seekOriginalPacket.call(this, packet), 350);
     return;
    }
    return window.seekOriginalPacket.call(this, packet);
   };
   socket.onevent = function(packet) {
    if (packet.data?.[0] === 'playback:state') setTimeout(() => window.seekOriginalOnevent.call(this, packet), 350);
    else window.seekOriginalOnevent.call(this, packet);
   };
  });
  for (const target of [10, 40, 15, 55, 12]) {
   await clickTimeline(target);
   assert.ok(Math.abs((await values(host)).time - target) < .3, 'rapid seek waited for a socket roundtrip');
  }
  await wait(async () => {
   const result = await values(viewer);
   return !result.paused && result.time >= 12 && result.time < 17;
  }, 'latest rapid seek did not reach the receiver');
  await settle(true);
  await host.evaluate(async () => {
   const { socket } = await import('/src/socket.js');
   socket.packet = window.seekOriginalPacket;
   socket.onevent = window.seekOriginalOnevent;
  });
  await host.waitForTimeout(1000);
  assert.equal(await host.evaluate(() => seekCheckCommands.filter(command => command.action === 'PAUSE' || command.action === 'PLAY').length), 0,
   'playing clicks and rapid seeks must not send false play/pause commands');
  await host.evaluate(() => { seekCheckCommands = []; });
  const box = await control('-webkit-media-controls-timeline');
  const duration = await video(host).evaluate(el => el.duration);
  const start = { x: box.x + box.width * .2, y: box.y + box.height / 2 };
  const end = { x: box.x + box.width * .8, y: start.y };
  if (touch) {
   await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [start] });
   for (let index = 1; index <= 24; index++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: start.x + (end.x - start.x) * index / 24, y: start.y }] });
   }
   await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
   await host.mouse.move(start.x, start.y);
   await host.mouse.down();
   await host.mouse.move(end.x, end.y, { steps: 32 });
   await host.mouse.up();
  }
  const localTarget = (await values(host)).time;
  // Cinema screen expansion changes the physical track width during a native
  // scrub pause. Use the browser's actual target, rather than assuming the
  // initial CSS geometry stays fixed throughout the drag.
  assert.ok(localTarget > duration * .75 && localTarget < duration * .85,
   `native scrub must update locally on release: ${localTarget}`);
  await host.waitForFunction(target => {
   const latest = seekCheckCommands.filter(command => command.action === 'SEEK').at(-1);
   return latest && Math.abs(latest.positionSec - target) < .3;
  }, localTarget, { timeout: 1000 });
  await settle(true);
  const commands = await host.evaluate(() => seekCheckCommands);
  assert.ok(commands.filter(command => command.action === 'SEEK').length <= 5, 'drag flooded seek commands');
  assert.equal(commands.filter(command => command.action === 'PAUSE' || command.action === 'PLAY').length, 0,
   'native scrubbing must not send false play/pause commands');
  assert.equal(await viewer.evaluate(() => seekCheckCommands.length), 0, 'receiver echoed authoritative seeks');
  await toggleNative();
  await settle(false);
  await clickTimeline(20);
  await wait(async () => Math.abs((await values(viewer)).time - 20) < .3, 'paused forward seek did not synchronize');
  await settle(false);
  await toggleNative();
  await settle(true);
  for (const page of [host, viewer]) {
   assert.equal(await page.getByText('Playback request timed out. Please try again.', { exact: true }).count(), 0,
    'seek acknowledgement timed out');
   assert.ok(await page.evaluate(() => seekCheckVideo === document.querySelector('.room-player-surface video')), 'seek remounted video');
   assert.equal(await video(page).evaluate(el => el.currentSrc), await page.evaluate(() => seekCheckSource), 'seek recreated the object URL');
  }
  console.log(`PASS local native ${touch ? 'touch' : 'mouse'} clicks/scrubbing: playing, paused, forward/back, rapid seeks, delayed confirmations, play/pause, no echoes/remounts/blob reloads`);
 } finally {
  for (const page of [host, viewer]) await page.evaluate(async () => {
   const { socket } = await import('/src/socket.js');
   socket.offAnyOutgoing(window.seekCommandListener);
   window.seekCheckVideo?.removeEventListener('pause', window.seekPauseListener);
   if (window.seekOriginalPacket) socket.packet = window.seekOriginalPacket;
   if (window.seekOriginalOnevent) socket.onevent = window.seekOriginalOnevent;
  });
  await cdp.detach();
 }
};
