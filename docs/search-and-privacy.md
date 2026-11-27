# Search and privacy setup

The public canonical site is https://wchly.pages.dev. `VITE_SITE_ORIGIN` changes build metadata and generated sitemap URLs; when changing the canonical host, also set the Worker's public `SITE_ORIGIN` variable. Preview and staging Worker HTML is noindex. Room metadata uses the room's own deployment origin and never includes invite or authentication query values.

The homepage, privacy, terms and cookie pages have distinct HTML and client-navigation metadata. Account pages and rooms use noindex; unknown pages return HTTP 404 through the Worker. The build also produces `404.html` and static public/account route shells for Cloudflare Pages. `_redirects` retains dynamic room routing on Pages.

Navigation routes run through the Worker for metadata and real status codes. Bundles, images, background videos, PWA files and verification files retain direct static-asset serving through negative route patterns. Missing assets use the generated 404 fallback, rather than an HTTP-200 app shell.

Worker assets use `html_handling: none` so the existing Google `.html` ownership file stays at its exact URL without an extension-stripping redirect. Application routes are handled explicitly by the Worker.

Google ownership file `google2fd6608b68053b8d.html` is preserved. Bing verification is `/BingSiteAuth.xml` with the supplied owner token; the same token is present in the homepage `msvalidate.01` tag. Optional public build settings `VITE_GOOGLE_SITE_VERIFICATION` and `VITE_BING_SITE_VERIFICATION` support meta tags without changing the existing Google file.

After an approved deployment:

1. Confirm the verification files return 200 without sign-in or redirects.
2. In Google Search Console, use the URL-prefix property `https://wchly.pages.dev/`, complete ownership verification if needed, and submit `https://wchly.pages.dev/sitemap.xml`.
3. In Bing Webmaster Tools, select the XML verification method and click Verify, then submit the same sitemap.
4. Use each console's URL inspection tools for the homepage. Verification and a sitemap do not guarantee indexing or a particular search ranking.

The privacy contact is `assist.watchly@gmail.com`, overridable through public `VITE_PRIVACY_CONTACT_EMAIL`. `VITE_SITE_OPERATOR` can supply the operator's public name. Provider retention and operator identity must continue to match the actual deployment; these pages do not assert a legal certification.

Consent offers equally styled necessary-only and external-player choices. Third-party embedded players do not mount or load their SDK until permission is granted. Local files, native media playback, first-party Drive playback, chat and account features remain available. Cookie settings are accessible from the footer, a blocked player and the room Appearance panel. Revocation unmounts embedded players, including when notified by another tab. It cannot erase third-party cookies that were already set. The consent decision lasts 180 days; preferences and necessary authentication/session storage have separate purposes described in `/cookies`.

Validation: `npm test`, frontend `npm test` and `npm run lint`, `npm run build`, `npm run check:bindings`, `npm run test:browser:privacy`, and `npm run test:browser:youtube-ended`.
