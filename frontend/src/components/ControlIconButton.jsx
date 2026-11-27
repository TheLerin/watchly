import GradientIcon from './GradientIcon';

export default function ControlIconButton({ label, icon, className = '', ...props }) {
    return <button type="button" aria-label={label} title={label} data-tooltip={label} className={`watchly-icon-button ${className}`} {...props}>
        <GradientIcon>{icon}</GradientIcon>
    </button>;
}
