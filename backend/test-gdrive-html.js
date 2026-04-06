const axios = require('axios');
const fs = require('fs');
const TEST_ID = '1fxhnfFs6LALyeEDAilmWdH0k4lbxkgEb';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

async function testDriveLink() {
    let url = 'https://drive.google.com/uc?export=download&id=' + TEST_ID;
    console.log('Sending GET to:', url);
    try {
        const r1 = await axios.get(url, {
            headers: { 'User-Agent': UA, 'Referer': 'https://drive.google.com/' },
            maxRedirects: 0,
            validateStatus: s => true,
            timeout: 10000
        });
        console.log('Hop 1 Status:', r1.status);
        console.log('Hop 1 Location:', r1.headers['location']);
        
        let loc = r1.headers['location'];
        if (loc) {
             let url2 = loc.startsWith('http') ? loc : 'https://drive.google.com' + loc;
             console.log('Following redirect to:', url2);
             
             const sc1 = r1.headers['set-cookie'] || [];
             let cookies = sc1.map(c => c.split(';')[0]).join('; ');
             
             const r2 = await axios.get(url2, {
                headers: { 'User-Agent': UA, 'Referer': 'https://drive.google.com/', 'Cookie': cookies },
                maxRedirects: 0,
                validateStatus: s => true,
                responseType: 'arraybuffer',
                timeout: 10000
             });
             
             console.log('Hop 2 Status:', r2.status);
             const ct = r2.headers['content-type'] || '';
             console.log('Hop 2 Content-Type:', ct);
             
             if (ct.includes('text/html')) {
                 const html = r2.data.toString('utf-8');
                 fs.writeFileSync('gdrive-html-dump.html', html);
                 console.log('Saved ' + html.length + ' bytes to gdrive-html-dump.html');
             }
        }
    } catch(e) {
        console.error('Error:', e.message);
    }
}
testDriveLink();
