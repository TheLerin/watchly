// Keep the exact brand artwork; only remove its empty square padding for tabs.
import { readFile, writeFile } from 'node:fs/promises';
const logo = await readFile(new URL('../frontend/public/logo.png', import.meta.url));
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="19 22 153 153"><image width="192" height="192" href="data:image/png;base64,${logo.toString('base64')}"/></svg>\n`;
await writeFile(new URL('../frontend/public/favicon.svg', import.meta.url), svg);
