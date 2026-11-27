import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { pageMetadata, cleanOrigin, siteStructuredData } from '../../social-preview/siteMetadata';

export default function PageMetadata() {
    const { pathname } = useLocation();
    useEffect(() => {
        const data = pageMetadata(pathname, pathname.startsWith('/room/') ? window.location.origin : cleanOrigin(import.meta.env.VITE_SITE_ORIGIN));
        const noindex = data.noindex || document.querySelector('meta[name="watchly-deployment-robots"]')?.content === 'noindex';
        document.title = data.title;
        for (const [key, value] of Object.entries({ description: data.description, 'og:title': data.title, 'twitter:title': data.title,
            'og:description': data.description, 'twitter:description': data.description, 'og:url': data.canonical, 'twitter:url': data.canonical,
            'og:image': data.image, 'og:image:secure_url': data.image, 'twitter:image': data.image, robots: noindex ? 'noindex, nofollow' : 'index, follow, max-image-preview:large' })) {
            let tag = document.head.querySelector(`meta[${key.startsWith('og:') ? 'property' : 'name'}="${key}"]`);
            if (!tag) { tag = document.createElement('meta'); tag.setAttribute(key.startsWith('og:') ? 'property' : 'name', key); document.head.append(tag); }
            tag.content = value;
        }
        const canonical = document.head.querySelector('link[rel="canonical"]'); if (canonical) canonical.href = data.canonical;
        document.getElementById('watchly-structured-data')?.remove();
        if (pathname === '/' && !noindex) { const script = document.createElement('script'); script.id = 'watchly-structured-data'; script.type = 'application/ld+json'; script.textContent = JSON.stringify(siteStructuredData(data.origin)); document.head.append(script); }
    }, [pathname]);
    return null;
}
