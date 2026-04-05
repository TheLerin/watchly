const http = require('http');
const req = http.request({
    hostname: 'localhost',
    port: 5000,
    path: '/api/proxy/gdrive?id=1Tnd_7FpLftHl04Mv6JjLh133I_y9pAYF', // Valid public sample ID from the codebase history 
    method: 'GET',
    headers: { 'Range': 'bytes=5000000-' }
}, (res) => {
    console.log('Status:', res.statusCode);
    console.log('Headers:', res.headers);
    res.destroy();
});
req.end();
