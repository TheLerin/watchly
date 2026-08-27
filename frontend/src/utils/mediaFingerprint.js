export const FINGERPRINT_VERSION = 'sampled-sha256-v1';
export const SMALL_FILE_BYTES = 2 * 1024 * 1024;
export const SLICE_BYTES = 64 * 1024;
export const SLICE_COUNT = 32;

export const samplePositions = size => {
    if (size <= SMALL_FILE_BYTES) return [0];
    const maxStart = Math.max(0, size - SLICE_BYTES);
    return Array.from({ length: SLICE_COUNT }, (_, index) => Math.floor((maxStart * index) / (SLICE_COUNT - 1)));
};

const toHex = buffer => [...new Uint8Array(buffer)].map(byte => byte.toString(16).padStart(2, '0')).join('');

export async function fingerprintBlob(blob, onProgress = () => {}) {
    if (!(blob instanceof Blob) || blob.size <= 0) throw new Error('Choose a non-empty video file.');
    const positions = samplePositions(blob.size);
    const chunks = [];
    for (let index = 0; index < positions.length; index += 1) {
        const start = positions[index];
        const end = blob.size <= SMALL_FILE_BYTES ? blob.size : Math.min(blob.size, start + SLICE_BYTES);
        chunks.push(new Uint8Array(await blob.slice(start, end).arrayBuffer()));
        onProgress(Math.round(((index + 1) / (positions.length + 1)) * 100));
    }
    const header = new TextEncoder().encode(`${FINGERPRINT_VERSION}:${blob.size}:`);
    const sampled = new Uint8Array(header.length + chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = header.length; sampled.set(header, 0);
    chunks.forEach(chunk => { sampled.set(chunk, offset); offset += chunk.length; });
    const digest = await crypto.subtle.digest('SHA-256', sampled);
    onProgress(100);
    return toHex(digest);
}
