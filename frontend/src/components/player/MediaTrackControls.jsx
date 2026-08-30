import React, { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, FileText, Headphones, Languages, LoaderCircle, Plus, Trash2, X } from 'lucide-react';
import MediaInfoPanel from './MediaInfoPanel';
import './media-track-controls.css';

const describeAudio = track => [track.label, track.codecLabel || track.codec, track.channels ? `${track.channels} ch` : ''].filter(Boolean).join(' · ');

export default function MediaTrackControls({
    variant,
    audioTracks,
    subtitleTracks,
    activeAudioId,
    activeSubtitleId,
    capabilities,
    inspection,
    inspectionError,
    isInspecting,
    audioSwitchStatus,
    subtitleLoadingId,
    onAudioChange,
    onSubtitleChange,
    onSubtitleFiles,
    onRemoveSubtitle,
}) {
    const [mobileOpen, setMobileOpen] = useState(false);
    const [isCompact, setIsCompact] = useState(() => (
        typeof window !== 'undefined' && window.matchMedia('(max-width: 1179px)').matches
    ));
    const fileInputRef = useRef(null);
    const bodyId = useId();
    const selectableAudio = audioTracks.filter(track => track.switchable && track.support !== 'unsupported');
    const showAudio = audioTracks.length > 0;
    const externalSubtitles = subtitleTracks.filter(track => track.origin === 'external');

    useEffect(() => {
        const mediaQuery = window.matchMedia('(max-width: 1179px)');
        const handleChange = event => {
            setIsCompact(event.matches);
            if (!event.matches) setMobileOpen(false);
        };
        mediaQuery.addEventListener('change', handleChange);
        return () => mediaQuery.removeEventListener('change', handleChange);
    }, []);

    useEffect(() => {
        if (!mobileOpen) return undefined;
        const handleKeyDown = event => {
            if (event.key === 'Escape') setMobileOpen(false);
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [mobileOpen]);

    const controlsBody = (
        <div
            className={`media-controls-body${isCompact ? ' media-controls-body--mobile' : ''}`}
            id={bodyId}
            role={isCompact ? 'dialog' : undefined}
            aria-modal={isCompact ? 'true' : undefined}
            aria-label={isCompact ? 'Media controls' : undefined}
        >
            <div className="media-controls-title">
                <span>Media</span>
                {isInspecting && <small><LoaderCircle size={12} className="animate-spin" /> Inspecting…</small>}
                {!isInspecting && audioSwitchStatus?.status === 'preparing' && (
                    <small><LoaderCircle size={12} className="animate-spin" /> Preparing {audioSwitchStatus.label}…</small>
                )}
                {isCompact && (
                    <button type="button" className="media-controls-close" onClick={() => setMobileOpen(false)} aria-label="Close media controls">
                        <X size={16} />
                    </button>
                )}
            </div>

            <div className="media-controls-grid">
                {showAudio && (
                    <label className="media-control-field">
                        <span><Headphones size={13} /> Audio</span>
                        {selectableAudio.length > 0 ? (
                            <select value={activeAudioId || selectableAudio[0]?.id || ''} onChange={event => onAudioChange(event.target.value)}>
                                {audioTracks.map(track => (
                                    <option key={track.id} value={track.id} disabled={!track.switchable || track.support === 'unsupported'}>
                                        {describeAudio(track)}{!track.switchable ? ' — switching unavailable' : track.support === 'unsupported' ? ' — unsupported' : ''}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <span className="media-unavailable" title="This browser detected multiple audio tracks but does not expose audio switching.">
                                {audioTracks.length} tracks detected · switching unavailable
                            </span>
                        )}
                    </label>
                )}

                <label className="media-control-field">
                    <span><Languages size={13} /> Subtitles</span>
                    <select value={activeSubtitleId || ''} onChange={event => onSubtitleChange(event.target.value || null)}>
                        <option value="">Off</option>
                        {subtitleTracks.some(track => track.origin === 'embedded') && (
                            <optgroup label="Embedded">
                                {subtitleTracks.filter(track => track.origin === 'embedded').map(track => (
                                    <option key={track.id} value={track.id} disabled={!track.switchable}>
                                        {track.label}{track.limited ? ' (basic)' : ''}{!track.switchable ? ` — ${track.codecLabel || 'unsupported'}` : ''}{subtitleLoadingId === track.id ? ' — loading…' : ''}
                                    </option>
                                ))}
                            </optgroup>
                        )}
                        {externalSubtitles.length > 0 && (
                            <optgroup label="External">
                                {externalSubtitles.map(track => (
                                    <option key={track.id} value={track.id}>{track.label}{track.limited ? ' (basic)' : ''}</option>
                                ))}
                            </optgroup>
                        )}
                    </select>
                </label>
            </div>

            {audioSwitchStatus?.status === 'error' && (
                <p className="media-track-warning" role="status">
                    {audioSwitchStatus.message || `${audioSwitchStatus.label || 'This audio track'} cannot be switched safely in this browser.`}
                </p>
            )}

            {capabilities.canUseExternalSubtitles && (
                <>
                    <button type="button" className="media-add-subtitle" onClick={() => fileInputRef.current?.click()}>
                        <Plus size={13} /> Add subtitle file
                    </button>
                    <input
                        ref={fileInputRef}
                        className="hidden"
                        type="file"
                        accept=".vtt,.srt,.ass,.ssa,text/vtt,application/x-subrip"
                        multiple
                        onChange={event => {
                            const files = [...event.target.files];
                            event.target.value = '';
                            if (files.length) onSubtitleFiles(files);
                        }}
                    />
                </>
            )}

            {externalSubtitles.length > 0 && (
                <div className="media-external-list" aria-label="External subtitles">
                    {externalSubtitles.map(track => (
                        <span key={track.id}>
                            <FileText size={11} />
                            <span title={`${track.formatLabel}${track.limited ? ' — basic timing and text only' : ''}`}>{track.label}</span>
                            <button type="button" onClick={() => onRemoveSubtitle(track.id)} aria-label={`Remove ${track.label} subtitles`}>
                                <Trash2 size={11} />
                            </button>
                        </span>
                    ))}
                </div>
            )}

            {(capabilities.canInspectFile || inspection || inspectionError) && (
                <details className="media-info-details">
                    <summary>File Info <ChevronDown size={13} /></summary>
                    <MediaInfoPanel inspection={inspection} inspectionError={inspectionError} />
                </details>
            )}
        </div>
    );

    return (
        <section className="media-track-controls" data-variant={variant} data-mobile-open={mobileOpen} aria-label="Media languages and compatibility">
            <button
                type="button"
                className="media-mobile-trigger"
                aria-expanded={mobileOpen}
                aria-controls={bodyId}
                onClick={() => setMobileOpen(value => !value)}
            >
                <Languages size={15} />
                Media
                <ChevronDown size={14} className={mobileOpen ? 'rotate-180' : ''} />
            </button>
            {isCompact
                ? mobileOpen && createPortal(
                    <div className="media-controls-mobile-layer" data-variant={variant}>
                        <button type="button" className="media-controls-backdrop" aria-label="Close media controls" onClick={() => setMobileOpen(false)} />
                        {controlsBody}
                    </div>,
                    document.body
                )
                : controlsBody}
        </section>
    );
}
