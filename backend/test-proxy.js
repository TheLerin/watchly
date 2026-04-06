const http = require('http');
const req = http.request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/proxy/gdrive?id=1fxhnfFs6LALyeEDAilmWdH0k4lbxkgEb',
    method: 'GET',
    headers: { 'Range': 'bytes=5000000-' }
}, (res) => {
    console.log('Status:', res.statusCode);
    console.log('Headers:', res.headers);
    let chunks = [];
    res.on('data', c => chunks.push(c));
    res.on('end', () => {
         console.log('Body:', Buffer.concat(chunks).toString('utf-8'));
         res.destroy();
    });
});
req.end();
