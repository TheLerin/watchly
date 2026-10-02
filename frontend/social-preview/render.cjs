const { chromium } = require('playwright');
const { existsSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

(async () => {
  const executablePath = process.env.BROWSER_EXECUTABLE || [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(existsSync);
  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(path.join(__dirname, 'watchly.html')).href);
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all([...document.images].map(image => image.decode()));
      for (const weight of [400, 600]) {
        const faces = await document.fonts.load(`${weight} 48px "DM Sans"`);
        if (!faces.length || faces.some(face => face.status !== 'loaded')) throw new Error('The preview font did not load.');
      }
      await document.fonts.ready;
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
    const output = path.resolve(__dirname, '../public/og-image-watchly.png');
    let rendered;
    // FontFace loading can finish before Chromium paints the new glyphs. Check
    // the exported pixels so an incomplete font paint never becomes the card.
    for (let attempt = 0; attempt < 20; attempt++) {
      const png = await page.screenshot({ type: 'png' });
      const headlinePixels = await page.evaluate(async base64 => {
        const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
        const image = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = document.createElement('canvas');
        canvas.width = 1200; canvas.height = 630;
        const context = canvas.getContext('2d');
        context.drawImage(image, 0, 0);
        const pixels = context.getImageData(50, 185, 380, 175).data;
        let count = 0;
        for (let index = 0; index < pixels.length; index += 4) {
          if (pixels[index] > 220 && pixels[index + 1] > 220 && pixels[index + 2] > 220) count++;
        }
        image.close();
        return count;
      }, png.toString('base64'));
      if (headlinePixels > 1500) { rendered = png; break; }
      await page.waitForTimeout(100);
    }
    if (!rendered) throw new Error('The headline did not paint completely; the previous card was preserved.');
    writeFileSync(output, rendered);
    console.log(`Saved 1200 × 630 preview: ${output}`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
