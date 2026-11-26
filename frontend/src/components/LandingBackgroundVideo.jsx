import { useEffect, useRef, useState } from 'react';

export default function LandingBackgroundVideo({ videoRef }) {
    const container = useRef(null);
    const [enabled, setEnabled] = useState(false);
    const [mobile, setMobile] = useState(() => window.matchMedia('(max-width: 1024px)').matches);
    useEffect(() => {
        const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
        let visible = false;
        const update = () => setEnabled(visible && !motion.matches && !navigator.connection?.saveData);
        const observer = new IntersectionObserver(entries => { visible = entries[0].isIntersecting; update(); }, { rootMargin: '100px' });
        observer.observe(container.current);
        motion.addEventListener('change', update);
        const compact = window.matchMedia('(max-width: 1024px)');
        const resize = () => setMobile(compact.matches);
        compact.addEventListener('change', resize);
        return () => { observer.disconnect(); motion.removeEventListener('change', update); compact.removeEventListener('change', resize); };
    }, []);
    useEffect(() => {
        const video = videoRef.current;
        if (!video) return;
        video.load();
        const update = () => { if (enabled && !document.hidden) void video.play().catch(() => {}); else video.pause(); };
        update(); document.addEventListener('visibilitychange', update);
        return () => document.removeEventListener('visibilitychange', update);
    }, [enabled, mobile, videoRef]);
    return <div ref={container} style={{ width: '100%', height: '100%' }}>
        <video ref={videoRef} className="cinema-video" autoPlay={enabled} muted loop playsInline preload="none" poster={mobile ? '/bg-video-mobile-poster.jpg' : '/bg-video-poster.jpg'} aria-hidden="true">
            {enabled && <>
                <source media="(max-width: 1024px)" src="/bg-video-mobile.webm" type="video/webm" />
                <source media="(max-width: 1024px)" src="/bg-video-mobile.mp4" type="video/mp4" />
                <source src="/bg-video.webm" type="video/webm" />
                <source src="/bg-video.mp4" type="video/mp4" />
            </>}
        </video>
    </div>;
}
