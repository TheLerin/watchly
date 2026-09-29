import { useEffect } from 'react';

const SAMPLE_WIDTH = 24;
const SAMPLE_HEIGHT = 14;
const SAMPLE_INTERVAL_MS = 320;

const averageRegion = (data, x0, y0, x1, y1) => {
  let red = 0;
  let green = 0;
  let blue = 0;
  let weight = 0;

  for (let y = y0; y < y1; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      const index = (y * SAMPLE_WIDTH + x) * 4;
      const luminance = data[index] * 0.2126 + data[index + 1] * 0.7152 + data[index + 2] * 0.0722;
      const pixelWeight = 0.45 + (luminance / 255) * 0.55;
      red += data[index] * pixelWeight;
      green += data[index + 1] * pixelWeight;
      blue += data[index + 2] * pixelWeight;
      weight += pixelWeight;
    }
  }

  return weight
    ? [red, green, blue].map(channel => Math.round(channel / weight)).join(' ')
    : '24 24 26';
};

const useVideoAmbientLight = (videoRef, targetRef, enabled = true) => {
  useEffect(() => {
    const video = videoRef instanceof HTMLVideoElement ? videoRef : videoRef?.current;
    const target = targetRef?.current;
    if (!target) return undefined;

    target.style.setProperty('--ambient-opacity', '0');
    if (!enabled || !(video instanceof HTMLVideoElement)) return undefined;

    const canvas = document.createElement('canvas');
    canvas.width = SAMPLE_WIDTH;
    canvas.height = SAMPLE_HEIGHT;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) return undefined;

    let interval = null;
    let blocked = false;

    const stop = () => {
      if (interval !== null) window.clearInterval(interval);
      interval = null;
      target.style.setProperty('--ambient-opacity', '0');
    };

    const sample = () => {
      if (blocked || video.paused || video.ended || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
      try {
        context.drawImage(video, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        const { data } = context.getImageData(0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        const setRegion = (name, ambientName, x0, y0, x1, y1) => {
          const colour = averageRegion(data, x0, y0, x1, y1);
          target.style.setProperty(name, colour);
          if (ambientName) target.style.setProperty(ambientName, `rgb(${colour})`);
        };
        setRegion('--video-left-rgb', '--ambient-left-color', 0, 0, 7, SAMPLE_HEIGHT);
        setRegion('--video-center-rgb', null, 7, 0, 17, SAMPLE_HEIGHT);
        setRegion('--video-right-rgb', '--ambient-right-color', 17, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        setRegion('--video-top-rgb', '--ambient-top-color', 0, 0, SAMPLE_WIDTH, 4);
        setRegion('--video-bottom-rgb', '--ambient-bottom-color', 0, 10, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        setRegion('--video-rgb', null, 0, 0, SAMPLE_WIDTH, SAMPLE_HEIGHT);
        target.style.setProperty('--ambient-opacity', '1');
      } catch {
        // Cross-origin media cannot be sampled. Leave the theater neutral.
        blocked = true;
        stop();
      }
    };

    const start = () => {
      if (blocked || video.paused || video.ended || interval !== null) return;
      sample();
      interval = window.setInterval(sample, SAMPLE_INTERVAL_MS);
    };

    video.addEventListener('play', start);
    video.addEventListener('pause', stop);
    video.addEventListener('ended', stop);
    start();

    return () => {
      stop();
      video.removeEventListener('play', start);
      video.removeEventListener('pause', stop);
      video.removeEventListener('ended', stop);
    };
  }, [targetRef, videoRef, enabled]);
};

export default useVideoAmbientLight;
