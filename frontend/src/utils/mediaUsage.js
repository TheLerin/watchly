// RTC byte counters are local estimates. They exclude transport overhead and are not provider invoices.
export function createUsageMeter({ limitBytes = 0, onLimit = () => {} } = {}) {
    const previous = new Map(); let total = 0, limited = false;
    return {
        sample(report, prefix = '') {
            report?.forEach(item => {
                if (!['outbound-rtp', 'inbound-rtp'].includes(item.type) || item.isRemote) return;
                const bytes = item.type === 'outbound-rtp' ? item.bytesSent : item.bytesReceived;
                if (!Number.isFinite(bytes) || bytes < 0) return;
                const key = `${prefix}:${item.id}`, old = previous.get(key);
                if (old !== undefined) total += Math.max(0, bytes - old);
                previous.set(key, bytes);
            });
            if (limitBytes > 0 && total >= limitBytes && !limited) { limited = true; onLimit(); }
            return total;
        },
        get totalBytes() { return total; },
    };
}
export const mediaUsageLimit = () => {
    const megabytes = Number(import.meta.env.VITE_MEDIA_SESSION_LIMIT_MB);
    return Number.isFinite(megabytes) && megabytes > 0 ? megabytes * 1024 * 1024 : 0;
};
