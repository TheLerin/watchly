export const NETWORK_QUALITY_META = {
  good: {
    label: 'Fast',
    color: '#22c55e',
    bg: 'rgba(34, 197, 94, 0.12)',
    border: 'rgba(34, 197, 94, 0.28)',
  },
  fair: {
    label: 'Okay',
    color: '#eab308',
    bg: 'rgba(234, 179, 8, 0.13)',
    border: 'rgba(234, 179, 8, 0.30)',
  },
  poor: {
    label: 'Slow',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.13)',
    border: 'rgba(239, 68, 68, 0.30)',
  },
  checking: {
    label: 'Checking',
    color: 'var(--text-sub)',
    bg: 'var(--glass-bg)',
    border: 'var(--glass-border)',
  },
  offline: {
    label: 'Offline',
    color: '#ef4444',
    bg: 'rgba(239, 68, 68, 0.13)',
    border: 'rgba(239, 68, 68, 0.30)',
  },
};

export function getNetworkQualityFromPing(pingMs, isConnected = true) {
  if (!isConnected) return 'offline';
  if (pingMs == null) return 'checking';
  if (pingMs <= 120) return 'good';
  if (pingMs <= 260) return 'fair';
  return 'poor';
}

export function formatPing(pingMs) {
  return pingMs == null ? '-- ms' : `${Math.round(pingMs)} ms`;
}
