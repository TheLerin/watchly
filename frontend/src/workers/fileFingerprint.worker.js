import { fingerprintBlob } from '../utils/mediaFingerprint';

self.onmessage = async event => {
    const file = event.data?.file;
    if (!(file instanceof File) || file.size <= 0) {
        self.postMessage({ type: 'error', message: 'Choose a non-empty video file.' });
        return;
    }

    try {
        const fingerprint = await fingerprintBlob(file, progress => self.postMessage({ type: 'progress', progress }));
        self.postMessage({ type: 'complete', fingerprint });
    } catch (error) {
        self.postMessage({
            type: 'error',
            message: error instanceof Error ? error.message : 'Could not fingerprint this file.',
        });
    }
};
