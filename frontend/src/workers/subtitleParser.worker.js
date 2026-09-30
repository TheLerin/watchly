import { parseSubtitleFile } from '../utils/subtitleParser.js';

self.onmessage = async event => {
    try {
        const parsed = await parseSubtitleFile(event.data);
        self.postMessage({ ok: true, parsed });
    } catch (error) {
        self.postMessage({ ok: false, message: error.message || 'Could not read subtitle file.' });
    }
};
