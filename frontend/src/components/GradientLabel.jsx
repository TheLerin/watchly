// Keep one accessible label while crossfading to the same moving palette as the navigation.
export default function GradientLabel({ children }) {
    return <span className="landing-nav-label">
        <span className="landing-nav-text">{children}</span>
        <span className="landing-nav-gradient" aria-hidden="true" data-label={Array.isArray(children) ? children.join('') : children} />
    </span>;
}
