import { useEffect } from 'react';

const SAMPLE_WIDTH = 24;
const SAMPLE_HEIGHT = 14;
const SAMPLE_INTERVAL_MS = 750;

const averageRegion = (context, x, y, width, height) => {
  const { data } = context.getImageData(x, y, width, height);
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;

  for (let index = 0; index < data.length; index += 4) {
    const luminance = (data[index] * 0.2126) + (data[index + 1] * 0.7152) + (data[index + 2] * 0.0722);
    const pixelWeight = 0.45 + (luminance / 255) * 0.55;
    red += data[index] * pixelWeight;
    green += data[index + 1] * pixelWeight;
    blue += data[index + 2] * pixelWeight;
    weight += pixelWeight;
  }

  if (!weight) return [28, 44, 39];
  return [red, green, blue].map(channel => Math.round(channel / weight));
};

const writeColour = (target, name, colour) => {
  target.style.setProperty(name, colour.join(' '));
};

const useVideoAmbientLight = (videoRef, targetRef) => {
  useEffect(() => {
    const video = videoRef instanceof HTMLVideoElement ? videoRef : videoRef?.current;
    const target = targetRef?.current;
    if (!(video instanceof HTMLVideoElement) || !target) return undefined;

    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return undefined;

    let stopped = false;
    let frameRequest = null;
    let animationRequest = null;
    let lastSample = -Infinity;

    const sampleFrame = (now) => {
      if (stopped) return;

      if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && now - lastSample >= SAMPLE_INTERVAL_MS) {
        try {
          context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
          const third = Math.floor(SAMPLE_WIDTH / 3);
          const bottomY = Math.floor(SAMPLE_HEIGHT * 0.7);

          writeColour(target, '--video-left-rgb', averageRegion(context, 0, 0, third, SAMPLE_HEIGHT));
          writeColour(target, '--video-center-rgb', averageRegion(context, third, 0, third, SAMPLE_HEIGHT));
          writeColour(target, '--video-right-rgb', averageRegion(context, third * 2, 0, SAMPLE_WIDTH - third * 2, SAMPLE_HEIGHT));
          writeColour(target, '--video-bottom-rgb', averageRegion(context, 0, bottomY, SAMPLE_WIDTH, SAMPLE_HEIGHT - bottomY));
          writeColour(target, '--video-rgb', averageRegion(context, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT));
          lastSample = now;
        } catch {
          // Same-origin media is expected. Keep the default CSS colours if sampling is unavailable.
          stopped = true;
          return;
        }
      }

      scheduleNextFrame();
    };

    const scheduleNextFrame = () => {
      if (stopped) return;
      if ('requestVideoFrameCallback' in video) {
        frameRequest = video.requestVideoFrameCallback(sampleFrame);
      } else {
        animationRequest = window.requestAnimationFrame(sampleFrame);
      }
    };

    scheduleNextFrame();

    return () => {
      stopped = true;
      if (frameRequest !== null && 'cancelVideoFrameCallback' in video) {
        video.cancelVideoFrameCallback(frameRequest);
      }
      if (animationRequest !== null) window.cancelAnimationFrame(animationRequest);
    };
  }, [targetRef, videoRef]);
};

export default useVideoAmbientLight;
