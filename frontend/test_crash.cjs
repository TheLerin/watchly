const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();
    
    page.on('pageerror', err => {
        console.log('PAGE ERROR:', err.message);
    });
    
    page.on('console', msg => {
        if (msg.type() === 'error') {
            console.log('CONSOLE ERROR:', msg.text());
        }
    });

    try {
        await page.goto('http://localhost:5174/room/test', { waitUntil: 'networkidle' });
        console.log('Page loaded successfully');
    } catch (e) {
        console.log('Navigation failed:', e.message);
    }
    
    await browser.close();
})();
