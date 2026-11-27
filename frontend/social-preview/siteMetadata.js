export const DEFAULT_SITE_ORIGIN = 'https://wchly.pages.dev';
export const HOME_TITLE = 'Watchly — Watch Together with Friends, in Sync';
export const HOME_DESCRIPTION = 'Make movie night feel closer. Watch videos together in sync, share a screen, and chat by text, voice or video with friends on Watchly.';
export const siteStructuredData = origin => ({ '@context': 'https://schema.org', '@type': 'WebApplication', name: 'Watchly', url: `${cleanOrigin(origin)}/`, description: HOME_DESCRIPTION, applicationCategory: 'EntertainmentApplication', operatingSystem: 'Web browser', browserRequirements: 'Requires JavaScript' });
export const PUBLIC_PAGES = {
    '/': { title: HOME_TITLE, description: HOME_DESCRIPTION },
    '/privacy': { title: 'Privacy Policy | Watchly', description: 'How Watchly handles accounts, room messages, media, browser storage and your privacy choices.' },
    '/terms': { title: 'Terms of Use | Watchly', description: 'The terms for using Watchly rooms, accounts, shared playback and calls.' },
    '/cookies': { title: 'Cookie & Storage Policy | Watchly', description: 'Understand essential browser storage, third-party video players and how to change your Watchly consent choices.' },
};
const privatePages = { '/auth': 'Sign in', '/auth/callback': 'Signing you in', '/profile': 'Your profile', '/setup-profile': 'Set up your profile', '/my-watchly': 'My Watchly' };
export function cleanOrigin(value = DEFAULT_SITE_ORIGIN) {
    try { const url = new URL(value); if (['https:', 'http:'].includes(url.protocol) && !url.username && !url.password) return url.origin; } catch { /* use production origin */ }
    return DEFAULT_SITE_ORIGIN;
}
export function pageMetadata(pathname = '/', origin = DEFAULT_SITE_ORIGIN) {
    const path = pathname === '/' ? '/' : pathname.replace(/\/$/, '');
    const base = cleanOrigin(origin), publicPage = PUBLIC_PAGES[path];
    const room = /^\/room\/[A-Z0-9]{7}$/i.test(path);
    const known = Boolean(publicPage || room || privatePages[path]);
    return { ...(publicPage || { title: room ? 'Join my Watchly room' : privatePages[path] ? `${privatePages[path]} | Watchly` : 'Page not found | Watchly',
        description: room ? 'Watch together in perfect sync.' : known ? 'Your private Watchly experience.' : 'This page could not be found. Head back to Watchly to start or join a watch room.' }),
        path, status: known ? 200 : 404, noindex: !publicPage, canonical: `${base}${known ? path : '/404'}`, image: `${base}/og/watchly-room-v2.png`, origin: base };
}
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function pageMetadataHtml(html, pathname = '/', origin = DEFAULT_SITE_ORIGIN, { noindex = false } = {}) {
    const data = pageMetadata(pathname, origin), blocked = noindex || data.noindex;
    const replaceContent = (head, key, value) => {
        const pattern = new RegExp(`<meta\\b[^>]*(?:name|property)="${key.replaceAll(':', '\\:')}"[^>]*>`, 'gi');
        const tag = `<meta ${key.startsWith('og:') ? 'property' : 'name'}="${key}" content="${escape(value)}" />`;
        return pattern.test(head) ? head.replace(pattern, () => tag) : head.replace('</head>', `${tag}\n</head>`);
    };
    return html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, original => {
        let head = original.replace(/<title>[\s\S]*?<\/title>/i, () => `<title>${escape(data.title)}</title>`)
            .replace(/<link\b[^>]*rel="canonical"[^>]*>/gi, () => `<link rel="canonical" href="${escape(data.canonical)}" />`)
            .replace(/<script\b[^>]*id="watchly-structured-data"[^>]*>[\s\S]*?<\/script>/gi, '');
        for (const key of ['description', 'og:description', 'twitter:description']) head = replaceContent(head, key, data.description);
        for (const key of ['og:title', 'twitter:title']) head = replaceContent(head, key, data.title);
        for (const key of ['og:url', 'twitter:url']) head = replaceContent(head, key, data.canonical);
        for (const key of ['og:image', 'og:image:secure_url', 'twitter:image']) head = replaceContent(head, key, data.image);
        head = replaceContent(head, 'og:site_name', 'Watchly');
        head = replaceContent(head, 'robots', blocked ? 'noindex, nofollow' : 'index, follow, max-image-preview:large');
        head = replaceContent(head, 'watchly-deployment-robots', noindex ? 'noindex' : 'index');
        if (data.path === '/' && !blocked) head = head.replace('</head>', `<script id="watchly-structured-data" type="application/ld+json">${JSON.stringify(siteStructuredData(data.origin))}</script>\n</head>`);
        return head;
    });
}
