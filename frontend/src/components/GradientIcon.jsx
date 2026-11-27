import { cloneElement, useId } from 'react';

export default function GradientIcon({ children }) {
    const id = `watchly-icon-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
    return <span className="watchly-gradient-icon" aria-hidden="true">
        {cloneElement(children, { className: `${children.props.className || ''} watchly-icon-base`, 'aria-hidden': true })}
        {cloneElement(children, { className: `${children.props.className || ''} watchly-icon-gradient`, style: { ...children.props.style, stroke: `url(#${id})` }, 'aria-hidden': true },
            <defs><linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#42ccec" /><stop offset="40%" stopColor="#aaf3eb" />
                <stop offset="70%" stopColor="#9d91bc" /><stop offset="100%" stopColor="#f0e08b" />
            </linearGradient></defs>)}
    </span>;
}
