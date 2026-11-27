import { useEffect, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ShieldCheck, X, MonitorPlay } from 'lucide-react';
import { useConsent } from '../context/ConsentContext';
import ControlIconButton from './ControlIconButton';
import GradientLabel from './GradientLabel';
import './privacy.css';

export function PrivacyFooter() {
    const { pathname } = useLocation(), { openPreferences } = useConsent();
    if (pathname.startsWith('/room/')) return null;
    return <footer className="privacy-footer"><span>© {new Date().getFullYear()} Watchly</span><nav aria-label="Legal and privacy"><Link to="/privacy">Privacy</Link><Link to="/terms">Terms</Link><Link to="/cookies">Cookies</Link><button type="button" onClick={openPreferences}>Cookie settings</button></nav></footer>;
}
export default function PrivacyControls() {
    const { choice, saveChoice, preferencesOpen, openPreferences, closePreferences } = useConsent();
    const dialog = useRef(null), externalInput = useRef(null);
    useEffect(() => {
        const element = dialog.current;
        if (preferencesOpen && !element.open) { externalInput.current.checked = choice?.externalMedia === true; element.showModal(); }
        else if (!preferencesOpen && element.open) element.close();
    }, [preferencesOpen, choice]);
    return <>
        {!choice && <section className="cookie-banner" aria-label="Privacy choices">
            <ShieldCheck size={23} aria-hidden="true" /><div><h2>Your privacy, your choice</h2><p>Watchly uses essential storage for sign-in, room recovery and your settings. External video players stay off until you allow them. <Link to="/cookies">Learn more</Link></p></div>
            <div className="cookie-banner-actions"><button type="button" onClick={() => saveChoice(false)}><GradientLabel>Necessary only</GradientLabel></button><button type="button" onClick={() => saveChoice(true)}><GradientLabel>Allow external players</GradientLabel></button><button type="button" onClick={openPreferences}>Customize</button></div>
        </section>}
        <dialog ref={dialog} className="cookie-dialog" aria-labelledby="cookie-dialog-title" onCancel={event => { event.preventDefault(); closePreferences(); }} onKeyDown={event => event.stopPropagation()}>
            <header><div><p className="legal-eyebrow">PRIVACY CHOICES</p><h2 id="cookie-dialog-title">Cookie settings</h2></div><ControlIconButton label="Close cookie settings" icon={<X size={18} />} onClick={closePreferences} /></header>
            <p>You can use local-file rooms, chat and account features without enabling external video players.</p>
            <div className="consent-category"><div><h3>Essential storage</h3><p>Authentication, room recovery, security and the settings you choose.</p></div><span>Always on</span></div>
            <label className="consent-category"><div><h3>External video players</h3><p>YouTube, Vimeo and similar players can contact their providers and use cookies or storage, including for analytics or advertising.</p></div><input ref={externalInput} type="checkbox" defaultChecked={choice?.externalMedia === true} /></label>
            <p className="consent-note">Watchly does not add analytics or advertising tags. Other providers control their own data practices. Changing this choice stops embedded players in this tab; it cannot erase cookies already set by another site.</p>
            <div className="cookie-dialog-actions"><button type="button" onClick={() => saveChoice(false)}>Necessary only</button><button type="button" onClick={() => saveChoice(externalInput.current.checked)}>Save choices</button></div>
            <Link to="/privacy" onClick={closePreferences}>Read the privacy policy</Link>
        </dialog>
    </>;
}
export function ExternalMediaConsent() {
    const { saveChoice, openPreferences } = useConsent();
    return <section className="external-media-consent" aria-label="External video permission"><MonitorPlay size={32} aria-hidden="true" /><h2>Allow this video player?</h2><p>Playing embedded videos connects to providers such as YouTube or Vimeo. They may use cookies and collect playback information. Your room and chat still work while this player is off.</p><button type="button" className="watchly-action" onClick={() => saveChoice(true)}><GradientLabel>Allow external players</GradientLabel></button><button type="button" onClick={openPreferences}>Cookie settings</button></section>;
}
