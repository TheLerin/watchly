export const fingerprintLocalFile = (file, onProgress = () => {}) => new Promise((resolve, reject) => {
    const worker = new Worker(
        new URL('../workers/fileFingerprint.worker.js', import.meta.url),
        { type: 'module' }
    );
    worker.onmessage = event => {
        if (event.data?.type === 'progress') onProgress(event.data.progress);
        if (event.data?.type === 'complete') {
            worker.terminate();
            resolve(event.data.fingerprint);
        }
        if (event.data?.type === 'error') {
            worker.terminate();
            reject(new Error(event.data.message));
        }
    };
    worker.onerror = event => {
        worker.terminate();
        reject(new Error(event.message || 'The fingerprint worker failed.'));
    };
    worker.postMessage({ file });
});

export const readLocalVideoDuration = file => new Promise((resolve, reject) => {
    const video = document.createElement('video');
    if (file.type?.startsWith('video/') && video.canPlayType(file.type) === '') {
        reject(new Error(`This browser reports that ${file.type} is unsupported. Try MP4 with H.264/AAC or WebM.`));
        return;
    }
    const objectUrl = URL.createObjectURL(file);
    const cleanup = () => {
        video.removeAttribute('src');
        video.load();
        URL.revokeObjectURL(objectUrl);
    };
    const timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error('Could not read the video duration.'));
    }, 15000);

    video.preload = 'metadata';
    video.onloadedmetadata = () => {
        const duration = Number.isFinite(video.duration) ? video.duration : 0;
        clearTimeout(timeoutId);
        cleanup();
        resolve(duration);
    };
    video.onerror = () => {
        clearTimeout(timeoutId);
        cleanup();
        reject(new Error('This browser cannot read the selected video format.'));
    };
    video.src = objectUrl;
});

export const formatFileSize = bytes => {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const unit = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
    return `${(bytes / (1024 ** unit)).toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
};
