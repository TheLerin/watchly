import { useId } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Check, RotateCcw } from 'lucide-react';
import { useTheme, THEME_META, ROOM_APPEARANCE_META } from '../context/ThemeContext';
import { CINEMA_PRESET_META } from '../utils/appearanceSettings';
import SoundSettings from './SoundSettings';

const MotionDiv = motion.div;

function ChoiceCard({ label, description, selected, onClick, orb }) {
    return (
        <button type="button" className="appearance-choice" aria-pressed={selected} onClick={onClick}>
            {orb && <span className="appearance-orb" aria-hidden="true" style={{ background: `radial-gradient(circle at 40% 40%, ${orb[0]}, ${orb[1]})` }} />}
            <span className="appearance-choice-label">{label}</span>
            {description && <span className="appearance-choice-description">{description}</span>}
            {selected && <Check className="appearance-choice-check" size={13} aria-hidden="true" />}
        </button>
    );
}

function ToggleRow({ label, setting, description }) {
    const { appearanceSettings, updateAppearance } = useTheme();
    const id = useId();
    const checked = appearanceSettings[setting];
    return (
        <div className="appearance-row">
            <div className="appearance-row-copy">
                <label htmlFor={id}>{label}</label>
                {description && <p id={`${id}-hint`}>{description}</p>}
            </div>
            <button id={id} type="button" role="switch" aria-checked={checked}
                aria-describedby={description ? `${id}-hint` : undefined}
                className="appearance-switch" onClick={() => updateAppearance({ [setting]: !checked })}>
                <span aria-hidden="true"><i /></span>
            </button>
        </div>
    );
}

export default function AppearancePanel({ supportsTheater, panelRef, panelEvents }) {
    const { appearanceSettings: settings, setTheme, setRoomAppearance, setCinemaPreset, updateAppearance, resetAppearance } = useTheme();
    const systemReduceMotion = useReducedMotion();
    const cinematic = settings.roomStyle === 'cinematic';
    const reduceMotion = systemReduceMotion || (cinematic && settings.reduceMotion);
    return (
        <MotionDiv ref={panelRef} {...panelEvents} id="watchly-appearance" role="dialog" aria-labelledby="watchly-appearance-title"
            initial={reduceMotion ? false : { opacity: 0, scale: 0.98, y: -6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 1 } : { opacity: 0, scale: 0.98, y: -6 }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
            className="room-settings-popover appearance-panel">
            <div className="appearance-panel-header">
                <h2 id="watchly-appearance-title">Appearance</h2>
                <p>Customize how your room looks.</p>
            </div>
            <div className="appearance-panel-body">
                <section className="appearance-section" aria-labelledby="appearance-room-style">
                    <h3 id="appearance-room-style">Room style</h3>
                    <div className="appearance-choices">
                        {Object.entries(ROOM_APPEARANCE_META).map(([id, meta]) => (
                            <ChoiceCard key={id} {...meta} selected={settings.roomStyle === id} onClick={() => setRoomAppearance(id)} />
                        ))}
                    </div>
                    {cinematic && !supportsTheater && <p className="appearance-compact-note">Theater uses the compact layout on this screen.</p>}
                </section>
                <section className="appearance-section" aria-labelledby="appearance-ui-theme">
                    <h3 id="appearance-ui-theme">UI theme</h3>
                    <div className="appearance-choices appearance-theme-choices">
                        {Object.entries(THEME_META).map(([id, meta]) => (
                            <ChoiceCard key={id} {...meta} selected={settings.uiTheme === id} onClick={() => setTheme(id)} />
                        ))}
                    </div>
                </section>
                {cinematic && <>
                    <section className="appearance-section" aria-labelledby="appearance-cinema-preset">
                        <h3 id="appearance-cinema-preset">Cinema preset</h3>
                        <div className="appearance-choices">
                            {Object.entries(CINEMA_PRESET_META).map(([id, meta]) => (
                                <ChoiceCard key={id} {...meta} selected={settings.cinemaPreset === id} onClick={() => setCinemaPreset(id)} />
                            ))}
                        </div>
                    </section>
                    <section className="appearance-section" aria-labelledby="appearance-ambience">
                        <h3 id="appearance-ambience">Ambience</h3>
                        <ToggleRow label="Ambient screen lighting" setting="ambientLighting" description="Reflect screen light into the room" />
                        <div className="appearance-brightness">
                            <label htmlFor="appearance-brightness">Room brightness <span>{settings.roomBrightness}%</span></label>
                            <input id="appearance-brightness" type="range" min="0" max="100" step="1" value={settings.roomBrightness}
                                onChange={event => updateAppearance({ roomBrightness: Number(event.target.value) })} />
                        </div>
                        <ToggleRow label="Aisle lights" setting="aisleLights" />
                        <ToggleRow label="Sofa" setting="sofa" />
                        <ToggleRow label="Wall details" setting="wallDetails" />
                    </section>
                    <section className="appearance-section" aria-labelledby="appearance-playback">
                        <h3 id="appearance-playback">Playback experience</h3>
                        <ToggleRow label="Auto-hide controls" setting="autoHideControls" />
                        <div className="appearance-row">
                            <label htmlFor="appearance-hide-delay">Hide controls after</label>
                            <select id="appearance-hide-delay" value={settings.hideDelay} disabled={!settings.autoHideControls}
                                onChange={event => updateAppearance({ hideDelay: event.target.value === 'never' ? 'never' : Number(event.target.value) })}>
                                <option value="2">2 seconds</option><option value="3">3 seconds</option>
                                <option value="5">5 seconds</option><option value="never">Never</option>
                            </select>
                        </div>
                        <ToggleRow label="Dim room while playing" setting="dimWhilePlaying" />
                        <ToggleRow label="Screen expansion" setting="screenExpansion" />
                        <ToggleRow label="Reduce motion" setting="reduceMotion" />
                    </section>
                </>}
                <SoundSettings />
                <button type="button" className="appearance-reset" onClick={resetAppearance}><RotateCcw size={13} aria-hidden="true" />Reset appearance</button>
            </div>
        </MotionDiv>
    );
}
