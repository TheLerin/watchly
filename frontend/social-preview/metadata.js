export const siteOrigin = 'https://wchly.vercel.app';

// Only the head changes. Vite's app root, scripts, styles and PWA tags survive.
export function roomPreviewHtml(html, roomCode) {
  const url = `${siteOrigin}/room/${encodeURIComponent(roomCode)}`;
  const title = 'Join my Watchly room';
  const description = 'Watch together in perfect sync.';
  return html.replace(/<head\b[^>]*>[\s\S]*?<\/head>/i, head => head
    .replace(/<title>[\s\S]*?<\/title>/i, `<title>${title}</title>`)
    .replace(/(<meta\b[^>]*(?:name|property)="(?:og:title|twitter:title)"[^>]*content=")[^"]*("[^>]*>)/gi, `$1${title}$2`)
    .replace(/(<meta\b[^>]*(?:name|property)="(?:description|og:description|twitter:description)"[^>]*content=")[^"]*("[^>]*>)/gi, `$1${description}$2`)
    .replace(/(<meta\b[^>]*(?:name|property)="(?:og:url|twitter:url)"[^>]*content=")[^"]*("[^>]*>)/gi, `$1${url}$2`)
    .replace(/(<link\b[^>]*rel="canonical"[^>]*href=")[^"]*("[^>]*>)/gi, `$1${url}$2`));
}
