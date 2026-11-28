// Pages forwards application traffic to the existing WATCHLY service binding.
const BING_TOKEN = 'D076BA3A466F949A85D20E308F1132CA';
const BING_XML = `<?xml version="1.0"?>\n<users>\n\t<user>${BING_TOKEN}</user>\n</users>`;
const BING_META = `<meta name="msvalidate.01" content="${BING_TOKEN}" />`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === '/BingSiteAuth.xml' && ['GET', 'HEAD'].includes(request.method)) {
      return new Response(request.method === 'HEAD' ? null : BING_XML, {
        headers: { 'Content-Type': 'application/xml; charset=UTF-8', 'Cache-Control': 'no-cache' }
      });
    }
    if (!env.WATCHLY) {
      return new Response('Watchly is not connected yet. Configure the WATCHLY service binding and redeploy.', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=UTF-8', 'Cache-Control': 'no-store' }
      });
    }
    const response = await env.WATCHLY.fetch(request);
    if (url.pathname !== '/' || request.method !== 'GET' || response.status !== 200 ||
        !response.headers.get('Content-Type')?.toLowerCase().includes('text/html')) return response;
    return new HTMLRewriter()
      .on('head meta[name="msvalidate.01"]', { element(element) { element.remove(); } })
      .on('head', { element(element) { element.append(BING_META, { html: true }); } })
      .transform(response);
  }
};
