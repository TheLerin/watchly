const axios = require('axios');
const fs = require('fs');

const id = '1fxhnfFs6LALyeEDAilmWdH0k4lbxkgEb'; 
const UA      = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124.0 Safari/537.36';
const REFERER = 'https://drive.google.com/';

const logs = [];
function log(...args) {
    logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
}

async function readBodyText(stream) {
    const chunks = [];
    for await (const c of stream) chunks.push(Buffer.from(c));
    return Buffer.concat(chunks).toString('utf-8');
}

async function runTest() {
    const startUrl = `https://drive.google.com/uc?export=download&id=${id}&confirm=t`;
    let url = startUrl;
    let cookieJar = '';
    let hops = 10;

    while (hops-- > 0) {
        log('\nHOP', 10 - hops);
        log('GET', url);
        
        const headers = {
            'User-Agent': UA,
            'Referer':    REFERER,
            'Accept':     'video/mp4,video/webm,video/*;q=0.9,*/*;q=0.8',
        };
        if (cookieJar) headers['Cookie'] = cookieJar;

        let hop;
        try {
            hop = await axios({
                method: 'GET', url, responseType: 'stream',
                headers, maxRedirects: 0,
                validateStatus: s => s < 600
            });
        } catch (e) {
            log('Error catch:', e.message);
            if (e.response && e.response.headers.location) {
                hop = e.response;
            } else {
                break;
            }
        }

        const sc = hop.headers['set-cookie'];
        if (sc) {
            const fresh = sc.map(c => c.split(';')[0]).join('; ');
            cookieJar   = cookieJar ? `${cookieJar}; ${fresh}` : fresh;
            log('Added cookies:', fresh);
        }

        const status = hop.status;
        const ct     = hop.headers['content-type'] || '';
        const loc    = hop.headers['location']     || '';

        log('Status:', status);
        log('Content-Type:', ct);
        log('Location:', loc);

        if (status >= 300 && status < 400 && loc) {
            try { hop.data.destroy(); } catch (_) {}
            url = loc.startsWith('http') ? loc : `https://drive.google.com${loc}`;
            log('Redirecting to:', url);
            continue;
        }

        if (!ct.includes('text/html') && status < 400) {
            log('\n✅ SUCCESS!');
            log('Headers:', hop.headers);
            try { hop.data.destroy(); } catch (_) {}
            break;
        }

        if (status === 403 || status === 404) {
            log('Failed:', status);
            try { hop.data.destroy(); } catch (_) {}
            break;
        }

        if (ct.includes('text/html')) {
            const html = await readBodyText(hop.data);
            log('Got HTML, length:', html.length);
            
            const cm = html.match(/[?&]confirm=([0-9A-Za-z_-]+)/)
                     || html.match(/name=["']confirm["'][^>]*value=["']([^"']+)["']/i);
            const um = html.match(/name=["']uuid["'][^>]*value=["']([^"']+)["']/i)
                     || html.match(/[?&]uuid=([0-9A-Za-z_-]+)/);

            if (cm) {
                const confirm = cm[1];
                const uuid    = um ? um[1] : null;
                url = `https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=${confirm}`;
                if (uuid) url += `&uuid=${uuid}`;
                log('Extracted confirm:', confirm, 'uuid:', uuid);
                log('Next URL:', url);
                continue;
            } else {
                log('Could not find confirm token!');
            }
            break;
        }

        break;
    }
    
    fs.writeFileSync('log.json', JSON.stringify(logs, null, 2));
}
runTest();
