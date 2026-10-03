const assert = require('node:assert/strict');
const path = require('node:path');

module.exports = async ({ host, viewer, browser, baseUrl, video, values, wait }) => {
 const shell = page => page.locator('.room-shell');
 const select = async (page, name) => {
  await page.mouse.move(640, 350);
  await page.getByRole('button', { name: 'Room settings', exact: true }).click();
  await page.locator('.appearance-panel').getByRole('button', { name: new RegExp('^' + name + '(?: |$)') }).click();
  await page.getByRole('button', { name: 'Room settings', exact: true }).click();
 };
 const originalStyle = page => page.locator('.room-player-surface').evaluate(element => {
  const css = getComputedStyle(element);
  return { radius: css.borderRadius, shadow: css.boxShadow, width: css.width, position: css.position };
 });
 await host.evaluate(() => { window.cinemaOriginalVideo = document.querySelector('.room-player-surface video'); });
 const darkStyle = await originalStyle(host);
 await select(host, 'Light Glass');
 const lightStyle = await originalStyle(host);
 for (let cycle = 0; cycle < 2; cycle++) {
  await select(host, 'Classic');
  assert.equal(await host.locator('.cinema-luxe-scene').count(), 0);
  assert.equal(await shell(host).getAttribute('data-cinema-playing'), null);
  assert.equal(await shell(host).getAttribute('data-cinema-controls-hidden'), null);
  assert.equal(await shell(host).evaluate(element => element.style.getPropertyValue('--cinema-video-r')), '');
  await select(host, 'Dark Glass');
  assert.equal(await shell(host).getAttribute('data-theme'), 'glass-dark');
  await select(host, 'Cinematic');
  await select(host, 'Luxe');
  assert.equal(await shell(host).getAttribute('data-theme'), 'cinema-luxe');
  assert.equal(await host.locator('.cinema-luxe-scene').count(), 1);
  assert.deepEqual(await originalStyle(host), darkStyle);
  await select(host, 'Light Glass');
  assert.deepEqual(await originalStyle(host), lightStyle);
 }
 await select(host, 'Dark Glass');
 await select(host, 'Luxe');
 await select(viewer, 'Luxe');
 assert.equal(await host.evaluate(() => window.cinemaOriginalVideo === document.querySelector('.room-player-surface video')), true,
  'appearance switches must preserve the authoritative video element');
 await wait(async () => await shell(host).getAttribute('data-cinema-ambient') === 'sampled', 'same-origin video was not sampled');
 await host.waitForTimeout(800);
 const geometry = await host.evaluate(() => {
  const screen = document.querySelector('.room-player-surface').getBoundingClientRect();
  const sofa = document.querySelector('.luxe-sofa').getBoundingClientRect();
  return {
   radius: getComputedStyle(document.querySelector('.room-player-surface')).borderRadius,
   playerShadow: getComputedStyle(document.querySelector('.room-player-surface')).boxShadow,
   recess: document.querySelector('.luxe-screen-recess').getBoundingClientRect(),
   platform: document.querySelector('.luxe-platform').getBoundingClientRect(),
   previousScreenWidth: Math.min(innerWidth * 0.695, 1450, (innerHeight - 230) * 1.67) * 1.04,
   nonInteractive: [...document.querySelectorAll('.cinema-luxe-scene, .cinema-luxe-scene *')].every(element => getComputedStyle(element).pointerEvents === 'none'),
   floor: getComputedStyle(document.querySelector('.luxe-floor')).clipPath,
   screen, sofa, scrollHeight: document.documentElement.scrollHeight, height: innerHeight,
  };
 });
 assert.equal(geometry.radius, '3px');
 assert.equal(geometry.playerShadow, 'none', 'the video should have one thin bezel without nested frame shadows');
 assert.ok(Math.abs(geometry.screen.width / geometry.previousScreenWidth - 0.97) < 0.001,
  'desktop screen should be 3% smaller than the previous Cinema Luxe screen');
 assert.ok((geometry.recess.width - geometry.screen.width) / 2 >= 15 && (geometry.recess.width - geometry.screen.width) / 2 <= 18,
  'recess should be about one third thinner while retaining one bezel');
 assert.ok(geometry.platform.height >= 16 && geometry.platform.height <= 30, 'screen platform should remain low');
 assert.ok(geometry.sofa.top > geometry.platform.bottom + 15, 'leave visible floor between platform and sofa');
 assert.equal(geometry.nonInteractive, true);
 assert.match(geometry.floor, /^polygon/);
 assert.ok(geometry.sofa.top > geometry.screen.bottom, 'sofa must sit below the screen');
 assert.ok(geometry.scrollHeight <= geometry.height + 1, 'theater must fit in the viewport');
 assert.equal(await host.locator('.luxe-aisle i').count(), 8);
 assert.equal(await host.locator('.luxe-ceiling i').count(), 2);
 const watchButton = host.getByRole('button', { name: 'Watch controls', exact: true });
 if (await watchButton.getAttribute('aria-expanded') === 'true') await watchButton.click();
 await host.evaluate(() => document.activeElement.blur());
 await host.mouse.move(640, 350);
 await wait(async () => await shell(host).getAttribute('data-cinema-controls-hidden') === 'true', 'inactive chrome did not hide');
 await host.mouse.move(641, 350);
 assert.equal(await shell(host).getAttribute('data-cinema-controls-hidden'), null);
 await wait(async () => await shell(host).getAttribute('data-cinema-controls-hidden') === 'true', 'chrome did not hide again');
 await host.keyboard.press('Escape');
 assert.equal(await shell(host).getAttribute('data-cinema-controls-hidden'), null);
 await host.getByRole('button', { name: 'Room settings', exact: true }).focus();
 await host.waitForTimeout(3400);
 assert.equal(await shell(host).getAttribute('data-cinema-controls-hidden'), null, 'focused controls must stay visible');
 for (const name of ['Room settings', 'Members and queue', 'Audio and subtitles', 'Live chat']) {
  await host.getByRole('button', { name, exact: true }).click();
  if (name === 'Live chat') await host.getByPlaceholder('Type a message...').fill('Theme typing check');
  else await host.evaluate(() => document.activeElement.blur());
  await host.mouse.move(640, 350);
  await host.waitForTimeout(3400);
  assert.equal(await shell(host).getAttribute('data-cinema-controls-hidden'), null, `${name} should inhibit autohide`);
  if (name === 'Live chat') await host.getByPlaceholder('Type a message...').fill('');
  await host.getByRole('button', { name, exact: true }).click();
 }
 await host.evaluate(() => {
  window.cinemaReadPixels = CanvasRenderingContext2D.prototype.getImageData;
  window.cinemaSampleFailures = 0;
  CanvasRenderingContext2D.prototype.getImageData = function () {
   window.cinemaSampleFailures++;
   throw new DOMException('Test canvas security failure', 'SecurityError');
  };
 });
 await wait(async () => await shell(host).getAttribute('data-cinema-ambient') === 'neutral', 'canvas failure did not fall back');
 await host.waitForTimeout(1200);
 assert.equal(await host.evaluate(() => window.cinemaSampleFailures), 1, 'failed sampling should stop');
 assert.equal((await values(host)).paused, false, 'ambient failure must not pause playback');
 await host.evaluate(() => { CanvasRenderingContext2D.prototype.getImageData = window.cinemaReadPixels; });
 await select(host, 'Classic');
 await select(host, 'Cinematic');
 await select(host, 'Luxe');
 await wait(async () => await shell(host).getAttribute('data-cinema-ambient') === 'sampled', 'ambient sampling did not recover');
 await host.evaluate(() => {
  const media = document.querySelector('.room-player-surface video');
  Object.defineProperty(media, 'currentSrc', { configurable: true, value: 'https://remote.invalid/movie.mp4' });
  window.cinemaDrawImage = CanvasRenderingContext2D.prototype.drawImage;
  window.cinemaUnsafeSamples = 0;
  CanvasRenderingContext2D.prototype.drawImage = function (...args) {
   window.cinemaUnsafeSamples++;
   return window.cinemaDrawImage.apply(this, args);
  };
  media.dispatchEvent(new Event('loadeddata'));
 });
 await host.waitForTimeout(1100);
 assert.equal(await shell(host).getAttribute('data-cinema-ambient'), 'neutral');
 assert.equal(await host.evaluate(() => window.cinemaUnsafeSamples), 0, 'cross-origin sources must never be sampled');
 await host.evaluate(() => {
  CanvasRenderingContext2D.prototype.drawImage = window.cinemaDrawImage;
  const media = document.querySelector('.room-player-surface video');
  delete media.currentSrc;
  media.dispatchEvent(new Event('loadeddata'));
 });
 await video(host).evaluate(media => media.pause());
 await wait(async () => await shell(host).getAttribute('data-cinema-playing') === 'false' && (await values(viewer)).paused,
  'pause must restore room lighting and synchronize');
 await host.waitForTimeout(800);
 assert.equal(await host.locator('.luxe-wall').first().evaluate(element => getComputedStyle(element).opacity), '1');
 assert.equal(await host.locator('.luxe-ceiling').evaluate(element => getComputedStyle(element).opacity), '1');
 await host.screenshot({ path: path.resolve(__dirname, '../../cinema-luxe-paused-visual-verification.png') });
 await video(host).evaluate(media => media.play());
 await wait(async () => await shell(host).getAttribute('data-cinema-playing') === 'true', 'playback must dim the room');
 await host.waitForTimeout(800);
 assert.equal(await host.locator('.luxe-wall').first().evaluate(element => getComputedStyle(element).opacity), '0.6');
 assert.equal(await host.locator('.luxe-ceiling').evaluate(element => getComputedStyle(element).opacity), '0.5');
 assert.equal(await viewer.evaluate(() => JSON.parse(localStorage.getItem('watchly-appearance-settings')).cinemaPreset), 'luxe');
 for (const page of [host, viewer]) {
  await page.evaluate(() => {
   window.cinemaAudioContext = new AudioContext();
   const destination = window.cinemaAudioContext.createMediaStreamDestination();
   window.cinemaMicrophone = destination.stream;
   navigator.mediaDevices.getUserMedia = async () => destination.stream;
  });
  await page.getByRole('button', { name: 'Voice call', exact: true }).click();
  await page.getByRole('button', { name: 'Join Voice', exact: true }).click();
  await page.locator('.room-voice').getByRole('button', { name: 'Mute', exact: true }).waitFor();
 }
 await host.locator('.room-voice').getByRole('button', { name: 'Mute', exact: true }).click();
 assert.equal(await host.evaluate(() => window.cinemaMicrophone.getAudioTracks()[0].enabled), false);
 await host.locator('.room-voice').getByRole('button', { name: 'Unmute', exact: true }).click();
 assert.equal(await host.evaluate(() => window.cinemaMicrophone.getAudioTracks()[0].enabled), true);
 for (const page of [host, viewer]) {
  await page.locator('.room-voice').getByRole('button', { name: 'Leave', exact: true }).click();
  await page.getByRole('button', { name: 'Join Voice', exact: true }).waitFor();
  assert.equal(await page.evaluate(() => window.cinemaMicrophone.getAudioTracks()[0].readyState), 'ended');
  await page.evaluate(() => window.cinemaAudioContext.close());
  await page.getByRole('button', { name: 'Voice call', exact: true }).click();
 }
 console.log('PASS Cinema Luxe voice join, mute, unmute and leave (synthetic microphone)');
 await host.setViewportSize({ width: 1440, height: 900 });
 await host.waitForTimeout(800);
 await host.screenshot({ path: path.resolve(__dirname, '../../cinema-luxe-playing-visual-verification.png') });
 for (const viewport of [{ width: 390, height: 844 }, { width: 844, height: 390 }, { width: 1024, height: 768 }, { width: 1280, height: 600 }]) {
  await host.setViewportSize(viewport);
  await wait(async () => await shell(host).getAttribute('data-room-appearance') === 'classic', 'compact viewport should settle into the existing Classic layout');
  assert.equal(await shell(host).getAttribute('data-room-appearance'), 'classic');
  assert.equal(await host.locator('.luxe-sofa').isVisible(), false);
  assert.equal(await host.locator('.luxe-aisle').first().isVisible(), false);
  assert.ok(await host.getByRole('button', { name: 'Room settings', exact: true }).isVisible());
  if (viewport.width < 1180) {
   await host.getByRole('button', { name: 'Chat', exact: true }).click();
   await host.getByPlaceholder('Type a message...').fill('Compact Cinema Luxe');
   await host.getByPlaceholder('Type a message...').fill('');
   await host.getByRole('button', { name: 'Watch', exact: true }).click();
  }
 }
 await host.setViewportSize({ width: 1280, height: 720 });
 await wait(async () => await shell(host).getAttribute('data-room-appearance') === 'cinematic', 'desktop should restore the selected cinematic style');
 if (await watchButton.getAttribute('aria-expanded') !== 'true') await watchButton.click();
 const idle = await browser.newPage({ viewport: { width: 1440, height: 900 } });
 await idle.addInitScript(() => localStorage.setItem('watchly-theme', 'cinema-luxe'));
 await idle.goto(baseUrl);
 await idle.getByRole('button', { name: 'Create room', exact: true }).first().click();
 await idle.getByPlaceholder('Your nickname').fill('Cinema visual check');
 await idle.locator('.room-launcher-submit').click();
 await idle.waitForURL('**/room/**');
 await idle.getByRole('heading', { name: 'No video playing', exact: true }).waitFor();
 assert.equal(await shell(idle).getAttribute('data-cinema-playing'), 'false');
 await idle.reload();
 await idle.getByRole('heading', { name: 'No video playing', exact: true }).waitFor();
 assert.equal(await shell(idle).getAttribute('data-theme'), 'cinema-luxe', 'theme should persist on reload');
 await idle.waitForTimeout(800);
 await idle.screenshot({ path: path.resolve(__dirname, '../../cinema-luxe-idle-visual-verification.png') });
 await idle.close();
 console.log('PASS Cinema Luxe persistence, no style leakage/player replacement, architecture, autohide, focused/open controls, canvas failure, safe remote fallback and responsive layouts');
};
