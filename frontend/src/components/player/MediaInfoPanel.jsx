import React from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, XCircle } from 'lucide-react';

const STATUS_META = {
    supported: { label: 'Supported', icon: CheckCircle2, className: 'text-emerald-400' },
    available: { label: 'Available', icon: CheckCircle2, className: 'text-emerald-400' },
    partial: { label: 'Partial', icon: AlertTriangle, className: 'text-amber-400' },
    unsupported: { label: 'Unsupported', icon: XCircle, className: 'text-red-400' },
    unknown: { label: 'Unconfirmed', icon: HelpCircle, className: 'text-amber-400' },
};

const formatDuration = seconds => {
    if (!Number.isFinite(seconds) || seconds <= 0) return 'Unknown';
    const rounded = Math.round(seconds);
    const hours = Math.floor(rounded / 3600);
    const minutes = Math.floor((rounded % 3600) / 60);
    const remainder = rounded % 60;
    return hours
        ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
        : `${minutes}:${String(remainder).padStart(2, '0')}`;
};

const TrackRow = ({ track, type }) => {
    const meta = STATUS_META[track.support] || STATUS_META.unknown;
    const Icon = meta.icon;
    const details = [
        track.codecLabel,
        type === 'video' && track.width && track.height ? `${track.width}×${track.height}` : '',
        type === 'video' && track.frameRate ? `${Number(track.frameRate.toFixed(2))} fps` : '',
        type === 'audio' && track.channels ? `${track.channels} ch` : '',
    ].filter(Boolean).join(' · ');
    return (
        <li className="media-info-track">
            <span className="min-w-0">
                <strong>{type === 'video' ? 'Video' : track.label}</strong>
                <small>{details || 'Details unavailable'}</small>
            </span>
            <span className={`media-info-status ${meta.className}`} title={meta.label}>
                <Icon size={13} />
                {meta.label}
            </span>
        </li>
    );
};

export default function MediaInfoPanel({ inspection, inspectionError }) {
    if (inspectionError) {
        return (
            <div className="media-info-fallback" role="status">
                <AlertTriangle size={14} />
                <span>{inspectionError} Watchly will still try normal browser playback.</span>
            </div>
        );
    }
    if (!inspection) return <p className="media-info-empty">Media details are available for local files.</p>;
    const compatibility = STATUS_META[inspection.compatibility?.status] || STATUS_META.unknown;
    const CompatibilityIcon = compatibility.icon;

    return (
        <div className="media-info-panel">
            <div className={`media-info-summary ${compatibility.className}`}>
                <CompatibilityIcon size={14} />
                <span>{inspection.compatibility?.message}</span>
            </div>
            <dl className="media-info-facts">
                <div><dt>Container</dt><dd>{inspection.container || 'Unknown'}</dd></div>
                <div><dt>Duration</dt><dd>{formatDuration(inspection.duration)}</dd></div>
                <div><dt>Browser check</dt><dd>{inspection.mimeSupport === 'probably' ? 'Likely supported' : inspection.mimeSupport === 'maybe' ? 'May be supported' : 'Unconfirmed'}</dd></div>
            </dl>

            {inspection.videoTracks?.length > 0 && (
                <div className="media-info-section">
                    <h4>Video</h4>
                    <ul>{inspection.videoTracks.map(track => <TrackRow key={`video-${track.id}`} track={track} type="video" />)}</ul>
                </div>
            )}
            {inspection.audioTracks?.length > 0 && (
                <div className="media-info-section">
                    <h4>Audio</h4>
                    <ul>{inspection.audioTracks.map(track => <TrackRow key={`audio-${track.id}`} track={track} type="audio" />)}</ul>
                </div>
            )}
            {inspection.subtitleTracks?.length > 0 && (
                <div className="media-info-section">
                    <h4>Embedded subtitles</h4>
                    <ul>{inspection.subtitleTracks.map(track => <TrackRow key={`subtitle-${track.id}`} track={track} type="subtitle" />)}</ul>
                </div>
            )}
        </div>
    );
}
