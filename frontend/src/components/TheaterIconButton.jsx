import GradientIcon from './GradientIcon';

const TheaterIconButton = ({ icon, label, active = false, onClick, controls, className = '' }) => (
    <button
        type="button"
        className={`theater-icon-button ${className}`}
        aria-label={label}
        aria-expanded={active}
        aria-controls={controls}
        data-tooltip={label}
        onClick={onClick}
    >
        <GradientIcon>{icon}</GradientIcon>
    </button>
);

export default TheaterIconButton;
