# Watchly social preview

`../public/og-image-watchly.png` is the final 1200 × 630 Open Graph and Twitter card.

The editable composition is `watchly.html`. It uses the existing `../public/logo.png` and an unchanged copy of the user-supplied screenshot in `assets/watchly-room.png`. The original video frame, interface, walls, lighting, and sofa are preserved. The screenshot is scaled proportionally, displayed straight, and framed with a subtle gray border and black shadow. All headline, description, and feature text is outside the screenshot.

To regenerate from the `frontend` directory:

```sh
node social-preview/render.cjs
```

The renderer uses Playwright and installed Chrome or Edge. Set `BROWSER_EXECUTABLE` to use another Chromium executable. The layout loads DM Sans from Google Fonts and fails if the font or either image cannot load, rather than silently exporting an incomplete card.

The root `index.html` points Open Graph and Twitter metadata to the new PNG. The prior `og-image.png` is retained.
