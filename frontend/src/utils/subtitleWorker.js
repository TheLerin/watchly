import { parseSubtitleFile } from './subtitleParser.js';

export function parseSubtitleFileOffThread(file) {
    if (typeof Worker === 'undefined') return parseSubtitleFile(file);
    return new Promise((resolve, reject) => {
        const worker = new Worker(new URL('../workers/subtitleParser.worker.js', import.meta.url), { type: 'module' });
        const finish = (error, parsed) => {
            clearTimeout(timeout);
            worker.terminate();
            if (error) reject(error);
            else resolve(parsed);
        };
        const timeout = setTimeout(() => finish(new Error('Subtitle parsing took too long. Try a smaller file.')), 30000);
        worker.onmessage = event => {
            if (event.data?.ok) finish(null, event.data.parsed);
            else finish(new Error(event.data?.message || 'Could not read subtitle file.'));
        };
        worker.onerror = event => finish(new Error(event.message || 'Subtitle parsing failed.'));
        worker.postMessage(file);
    });
}
