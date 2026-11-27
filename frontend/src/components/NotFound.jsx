import { Link } from 'react-router-dom';
import { ArrowLeft, Clapperboard } from 'lucide-react';
import AccountShell from './account/AccountShell';
import './account/legal.css';
import GradientLabel from './GradientLabel';
export default function NotFound() {
    return <AccountShell className="legal-page" hideActions><section className="not-found-card"><span className="not-found-symbol"><Clapperboard size={36} aria-hidden="true" /></span><p className="legal-eyebrow">404 · SCENE NOT FOUND</p><h1>This scene is missing.</h1><p>The link may be old, mistyped, or no longer available. Your next watch night is still waiting.</p><Link to="/" className="watchly-action"><ArrowLeft size={17} aria-hidden="true" /><GradientLabel>Back to Watchly</GradientLabel></Link><Link to="/my-watchly" className="account-text-action">Open My Watchly</Link></section></AccountShell>;
}
