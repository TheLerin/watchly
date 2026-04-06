const axios = require('axios');

// Replace this with any Google Drive share link ID
// Format: https://drive.google.com/file/d/THIS_PART/view
const TEST_ID = process.argv[2] || '1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs78OVNW0';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';

async function trace() {
    let url = `https://drive.usercontent.google.com/download?id=${TEST_ID}&export=download&authuser=0&confirm=t`;
    let cookieJar = '';
    let hop = 0;

    while (hop < 10) {
        console.log(`\n--- HOP ${++hop} ---`);
        console.log('URL:', url.slice(0, 120));

        const headers = { 'User-Agent': UA };
        if (cookieJar) headers['Cookie'] = cookieJar;

        let r;
        try {
            r = await axios({ method: 'GET', url, responseType: 'stream',
                headers, maxRedirects: 0, validateStatus: s => s < 600 });
        } catch(e) {
            if (e.response) r = e.response;
            else { console.error('FATAL:', e.message); break; }
        }

        const sc = r.headers['set-cookie'];
        if (sc) {
            const fresh = sc.map(c => c.split(';')[0]).join('; ');
            cookieJar = cookieJar ? `${cookieJar}; ${fresh}` : fresh;
            console.log('Set-Cookie (count):', sc.length);
        }

        console.log('Status:', r.status);
        console.log('Content-Type:', r.headers['content-type']);
        console.log('Location:', r.headers['location'] || 'none');

        if (r.status >= 300 && r.status < 400 && r.headers['location']) {
            r.data.destroy();
            url = r.headers['location'].startsWith('http') ? r.headers['location'] : 'https://drive.google.com' + r.headers['location'];
            continue;
        }

        const ct = r.headers['content-type'] || '';
        if (!ct.includes('text/html')) {
            console.log('\n✅ SUCCESS — Got actual file. Content-Length:', r.headers['content-length']);
            r.data.destroy();
            break;
        }

        if (ct.includes('text/html')) {
            const chunks = [];
            for await (const c of r.data) chunks.push(Buffer.from(c));
            const html = Buffer.concat(chunks).toString('utf-8');
            console.log('HTML length:', html.length);
            console.log('HTML snippet:', html.slice(0, 300).replace(/\s+/g, ' '));

            const formMatch = html.match(/action="(https?:\/\/[^"]*download[^"]*)"/i)
                           || html.match(/action="([^"]*\/download[^"]*)"/i);
            const confirmMatch = html.match(/[?&]confirm=([0-9A-Za-z_-]+)/)
                              || html.match(/name=["']confirm["'][^>]*value=["']([^"']+)["']/i);
            const uuidMatch = html.match(/name=["']uuid["'][^>]*value=["']([^"']+)["']/i);

            console.log('Form action found:', formMatch ? formMatch[1].slice(0,80) : 'NONE');
            console.log('Confirm token:', confirmMatch ? confirmMatch[1] : 'NONE');
            console.log('UUID:', uuidMatch ? uuidMatch[1] : 'NONE');

            if (formMatch) {
                url = formMatch[1].replace(/&amp;/g, '&');
                if (!url.startsWith('http')) url = 'https://drive.google.com' + url;
            } else if (confirmMatch) {
                const confirm = confirmMatch[1];
                const uuid = uuidMatch ? uuidMatch[1] : null;
                url = `https://drive.usercontent.google.com/download?id=${TEST_ID}&export=download&confirm=${confirm}`;
                if (uuid) url += `&uuid=${uuid}`;
            } else {
                console.log('\n❌ Could not find any download link in the HTML');
                break;
            }
            continue;
        }

        break;
    }
}

trace().catch(e => console.error('Error:', e.message));
