import { useId } from 'react';
import { useSoundEffects } from '../context/SoundEffectsContext';

function SoundToggle({ label, setting, disabled = false }) {
    const id = useId(), { settings, updateSoundSettings } = useSoundEffects();
    return <div className="appearance-row"><label htmlFor={id}>{label}</label>
        <button id={id} type="button" role="switch" className="appearance-switch" aria-checked={settings[setting]} disabled={disabled}
            onClick={() => updateSoundSettings({ [setting]: !settings[setting] })}><span aria-hidden="true"><i /></span></button>
    </div>;
}

export default function SoundSettings() {
    const { settings, updateSoundSettings } = useSoundEffects(), id = useId();
    return <section className="appearance-section" aria-labelledby={`${id}-title`}>
        <h3 id={`${id}-title`}>Sound</h3>
        <SoundToggle label="Sound effects" setting="enabled" />
        <SoundToggle label="Room join sounds" setting="room" disabled={!settings.enabled} />
        <SoundToggle label="Voice sounds" setting="voice" disabled={!settings.enabled} />
        <div className="appearance-brightness"><label htmlFor={id}>Effects volume <span>{Math.round(settings.volume * 100)}%</span></label>
            <input id={id} type="range" aria-label="Effects volume" aria-valuetext={`${Math.round(settings.volume * 100)}%`} min="0" max="100" step="1" value={Math.round(settings.volume * 100)} disabled={!settings.enabled}
                onChange={event => updateSoundSettings({ volume: Number(event.target.value) / 100 })} />
        </div>
        <p className="appearance-compact-note">Soft local effects. Room join sounds include departures; voice sounds include camera and microphone controls.</p>
    </section>;
}
