// Real Chrome/Edge, LiveKit SFU and decoded camera/audio. Only capture devices
// are synthetic; no mocked SDK, signaling, tracks or playback events.
const { chromium } = require('playwright'), assert = require('node:assert/strict');
const { fork, spawn } = require('node:child_process'), { existsSync, mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path'), net = require('node:net');
const artifacts = path.resolve(__dirname, 'artifacts'); mkdirSync(artifacts, { recursive: true });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const port = () => new Promise(resolve => { const server = net.createServer(); server.listen(0, '127.0.0.1', () => { const value = server.address().port; server.close(() => resolve(value)); }); });
const wait = async (predicate, message, timeout = 45000) => { const end = Date.now() + timeout; while (Date.now() < end) { if (await predicate()) return; await sleep(100); } throw new Error(message); };
function cameraFile(name, color) {
    const width = 320, height = 180, pixels = width * height;
    const frame = Buffer.concat([Buffer.from('FRAME\n'), Buffer.alloc(pixels, color[0]), Buffer.alloc(pixels / 4, color[1]), Buffer.alloc(pixels / 4, color[2])]);
    const file = path.join(artifacts, name); writeFileSync(file, Buffer.concat([Buffer.from(`YUV4MPEG2 W${width} H${height} F15:1 Ip A1:1 C420\n`), ...Array(45).fill(frame)])); return file;
}
function tone(name, frequency) {
    const samples = 48000 * 3, wav = Buffer.alloc(44 + samples * 2); wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16,16); wav.writeUInt16LE(1,20); wav.writeUInt16LE(1,22); wav.writeUInt32LE(48000,24); wav.writeUInt32LE(96000,28); wav.writeUInt16LE(2,32); wav.writeUInt16LE(16,34); wav.write('data',36); wav.writeUInt32LE(samples*2,40);
    for (let i=0;i<samples;i++) wav.writeInt16LE(Math.round(6000*Math.sin(2*Math.PI*frequency*i/48000)),44+i*2);
    const file=path.join(artifacts,name);writeFileSync(file,wav);return file;
}
const audio = page => page.evaluate(async () => {
    const element = [...document.querySelectorAll('.watchly-media-audio audio')].find(audio => audio.srcObject?.getAudioTracks().some(track => track.readyState === 'live'));
    if (!element) return { rms: 0, frequency: 0, playing: false };
    if (!window.callProbe || window.callProbe.stream !== element.srcObject) {
        window.callProbe?.source.disconnect(); await window.callProbe?.context.close();
        const context = new AudioContext(), analyser = context.createAnalyser(), source = context.createMediaStreamSource(element.srcObject);
        analyser.fftSize = 8192; source.connect(analyser); await context.resume(); window.callProbe = { context, analyser, source, stream: element.srcObject };
    }
    const { analyser, context } = window.callProbe, signal = new Float32Array(analyser.fftSize), spectrum = new Float32Array(analyser.frequencyBinCount);
    analyser.getFloatTimeDomainData(signal); analyser.getFloatFrequencyData(spectrum);
    let peak = 0; for (let i = 1; i < spectrum.length; i++) if (spectrum[i] > spectrum[peak]) peak = i;
    return { rms: Math.sqrt(signal.reduce((sum, value) => sum + value * value, 0) / signal.length), frequency: peak * context.sampleRate / analyser.fftSize, playing: !element.paused && !element.muted && element.volume > 0, ready: element.readyState };
});
(async () => {
    const serverPath = process.env.LIVEKIT_TEST_SERVER || path.join(artifacts, 'livekit-server/livekit-server.exe');
    assert.ok(existsSync(serverPath), 'Set LIVEKIT_TEST_SERVER to the official LiveKit server binary.');
    const backendPort=await port(), frontendPort=await port(), livekitPort=await port(), tcpPort=await port(), udpPort=await port();
    const base=`http://127.0.0.1:${frontendPort}`, backendUrl=`http://127.0.0.1:${backendPort}`;
    const sfu=spawn(serverPath,['--dev','--config-body',`port: ${livekitPort}\nrtc:\n  tcp_port: ${tcpPort}\n  udp_port: ${udpPort}\nkeys:\n  devkey: secret\nlogging:\n  level: error\n`,'--bind','127.0.0.1','--node-ip','127.0.0.1'],{stdio:'ignore',windowsHide:true});
    const backend=fork(path.resolve(__dirname,'../../backend/server.js'),[],{env:{...process.env,PORT:String(backendPort),CORS_ORIGIN:base,LIVEKIT_URL:`ws://127.0.0.1:${livekitPort}`,LIVEKIT_API_KEY:'devkey',LIVEKIT_API_SECRET:'secret',SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',SUPABASE_SERVICE_ROLE_KEY:''},stdio:'ignore'});
    const frontend=fork(path.resolve(__dirname,'../node_modules/vite/bin/vite.js'),['--host','127.0.0.1','--port',String(frontendPort),'--strictPort'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,VITE_BACKEND_URL:backendUrl,VITE_VOICE_PROVIDER:'livekit',VITE_SUPABASE_URL:'',VITE_SUPABASE_PUBLISHABLE_KEY:''},stdio:'ignore'});
    const browsers=[], pages=[], errors=[], evidence={checks:[], transport:'LiveKit 1.13.7 local SFU',capture:'synthetic red/blue cameras and 440/880 Hz microphones'};
    let a,b;
    try {
        await wait(async()=>{try{return(await fetch(base)).ok&&(await fetch(backendUrl)).ok&&(await fetch(`http://127.0.0.1:${livekitPort}`)).ok;}catch{return false;}},'test servers unavailable');
        const chrome=process.env.BROWSER_EXECUTABLE||'C:/Program Files/Google/Chrome/Application/chrome.exe';
        const edge=process.env.SECOND_BROWSER_EXECUTABLE||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe';
        for(const [executablePath,name,color,frequency] of [[chrome,'A',[82,90,240],440],[existsSync(edge)?edge:chrome,'B',[41,240,110],880]]) {
            const browser=await chromium.launch({executablePath,headless:true,args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream',`--use-file-for-fake-video-capture=${cameraFile(`camera-${name}.y4m`,color)}`,`--use-file-for-fake-audio-capture=${tone(`call-${name}.wav`,frequency)}`,'--autoplay-policy=no-user-gesture-required','--mute-audio','--disable-background-timer-throttling','--disable-renderer-backgrounding']}); browsers.push(browser);
            const page=await browser.newPage({viewport:{width:1366,height:768},hasTouch:true});pages.push(page);page.on('pageerror',error=>errors.push(error.message));
            await page.addInitScript(()=>{
                localStorage.setItem('watchly-appearance-settings',JSON.stringify({uiTheme:'glass-dark',roomStyle:'classic',hideDelay:'never'}));
                window.callCaptures=[];window.callTracks=[];window.callTokenRequests=0;
                const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
                navigator.mediaDevices.getUserMedia=async options=>{window.callCaptures.push(options);if(window.denyCamera&&options.video)throw new DOMException('Blocked','NotAllowedError');
                    const stream=await get({...options,audio:options.audio?{...options.audio,echoCancellation:false,noiseSuppression:false,autoGainControl:false}:false});window.callTracks.push(...stream.getTracks());return stream;};
                const request=window.fetch;window.fetch=(...args)=>{if(String(args[0]).endsWith('/api/livekit/token'))window.callTokenRequests++;return request(...args);};
            });
            if(!a)a=page;else b=page;
        }
        const synced=page=>wait(async()=>await page.locator('.room-ping-button').getAttribute('data-connection-phase')==='connected','Watchly not synced');
        const open=async(page,name)=>{const desktop=page.viewportSize().width>=1180, cinema=desktop&&await page.locator('.room-shell').getAttribute('data-room-appearance')==='cinematic';
            const label=cinema?({Video:'Video call',Call:'Voice call',Room:'Members and queue',Chat:'Live chat',Watch:'Watch controls'})[name]:name;
            const button=cinema?page.getByRole('button',{name:label,exact:true}):desktop?page.getByRole('tab',{name:label,exact:true}):page.locator('.mobile-classic-tabs').getByRole('button',{name:label,exact:true});
            if(await button.getAttribute(cinema?'aria-expanded':desktop?'aria-selected':'data-active')!=='true')await button.click();};
        await a.goto(base);await a.getByRole('button',{name:'Create room',exact:true}).first().click();await a.getByPlaceholder('Your nickname').fill('Camera A');await a.locator('.room-launcher-submit').click();await a.waitForURL('**/room/**');
        const roomId=a.url().split('/').pop();await b.goto(a.url());await b.getByLabel('Nickname',{exact:true}).fill('Camera B');await b.getByRole('button',{name:'Join room',exact:true}).click();await synced(a);await synced(b);
        for(const page of [a,b])assert.equal(await page.evaluate(()=>window.callCaptures.length+window.callTokenRequests),0);
        const snapshot=()=>a.evaluate(async()=>{const{socket}=await import('/src/socket.js');return new Promise(resolve=>socket.emit('room:snapshot',{},result=>resolve(result.snapshot)));});
        await open(a,'Watch');await a.locator('#room-link-input').fill(`${base}/bg-video.mp4`);await a.getByRole('button',{name:'Play Now',exact:true}).click();
        const movie=page=>page.locator('.room-player-surface video');await movie(a).waitFor();await movie(b).waitFor();
        for(const page of [a,b]){await page.evaluate(async()=>{const url=performance.getEntriesByType('resource').map(entry=>entry.name).find(url=>url.includes('/deps/livekit-client.js'));const{Room,RoomEvent}=await import(url);const emit=Room.prototype.emit;window.callConnectionStates=[];Room.prototype.emit=function(event,...args){window.testCallRoom=this;if(event===RoomEvent.ConnectionStateChanged)window.callConnectionStates.push(args[0]);return emit.call(this,event,...args);};});await open(page,'Call');await page.getByRole('button',{name:'Join Voice',exact:true}).click();await page.getByRole('button',{name:'Mute microphone',exact:true}).waitFor();}
        await wait(async()=>{const value=await audio(a);return value.playing&&value.rms>.01&&Math.abs(value.frequency-880)<20;},'A did not hear B');await wait(async()=>{const value=await audio(b);return value.playing&&value.rms>.01&&Math.abs(value.frequency-440)<20;},'B did not hear A');evidence.audio={aHearsB:await audio(a),bHearsA:await audio(b)};
        await a.getByRole('button',{name:'Mute microphone',exact:true}).click();await wait(async()=>(await audio(b)).rms<.003,'A mute did not silence remote audio');
        for(const page of [a,b]){await open(page,'Video');await page.getByRole('button',{name:'Turn camera on',exact:true}).click();await page.locator('.video-call-content:visible[data-camera-on="true"]').waitFor();}
        const tile=(page,name)=>page.locator('.call-camera-tile').filter({hasText:name});
        const decode=async(page,name)=>tile(page,name).locator('video').evaluate(video=>{const canvas=document.createElement('canvas');canvas.width=4;canvas.height=4;const context=canvas.getContext('2d');context.drawImage(video,0,0,4,4);return{time:video.currentTime,ready:video.readyState,pixel:[...context.getImageData(2,2,1,1).data],frames:video.getVideoPlaybackQuality().totalVideoFrames};});
        await wait(async()=>{try{const value=await decode(b,'Camera A');return value.ready>=2&&value.frames>2&&value.pixel[0]>170&&value.pixel[2]<70;}catch{return false;}},'B did not decode A red camera');
        await wait(async()=>{try{const value=await decode(a,'Camera B');return value.ready>=2&&value.frames>2&&value.pixel[2]>170&&value.pixel[0]<70;}catch{return false;}},'A did not decode B blue camera');
        evidence.video={aSeesB:await decode(a,'Camera B'),bSeesA:await decode(b,'Camera A')};
        assert.equal(await a.locator('.video-call-content:visible').getAttribute('data-microphone-on'),'false','camera join unmuted voice');
        for(const page of [a,b])assert.equal(await page.evaluate(()=>window.callTokenRequests),1,'camera added another connection/token');
        evidence.checks.push('Two browser processes decode opposite camera colors/frames; one token each; muted voice stays muted');
        await require('./roomLifecycleChecks.cjs')({ a, b, open, wait, snapshot, evidence });
        await a.getByRole('button',{name:'Turn camera off',exact:true}).click();await tile(b,'Camera A').locator('.call-camera-fallback').waitFor();assert.equal(await tile(b,'Camera A').locator('video').count(),0);
        await a.getByRole('button',{name:'Unmute microphone',exact:true}).click();await a.getByRole('button',{name:'Mute microphone',exact:true}).waitFor();
        await open(a,'Call');await a.getByRole('button',{name:'Mute microphone',exact:true}).click();await open(a,'Video');await a.getByRole('button',{name:'Unmute microphone',exact:true}).waitFor();
        await a.getByRole('button',{name:'Turn camera on',exact:true}).click();await tile(b,'Camera A').locator('video').waitFor();
        await b.getByRole('button',{name:'Mute microphone',exact:true}).click();await wait(async()=>(await audio(a)).rms<.003,'B mute did not silence remote audio');await b.getByRole('button',{name:'Unmute microphone',exact:true}).click();await wait(async()=>(await audio(a)).rms>.01,'B unmute did not resume audio');
        await a.evaluate(()=>window.testCallRoom.simulateScenario('signal-reconnect'));await wait(()=>a.evaluate(()=>window.callConnectionStates.some(value=>value.toLowerCase().includes('reconnecting'))&&window.testCallRoom.state==='connected'),'LiveKit signaling did not reconnect');await synced(a);await wait(async()=>{try{return(await decode(b,'Camera A')).frames>3;}catch{return false;}},'camera did not recover after reconnect');assert.equal(await a.evaluate(()=>window.callTokenRequests),1);evidence.checks.push('Real bidirectional PCM and mute silence/restoration; SDK signaling disconnect reconnects without affecting Watchly');
        evidence.checks.push('Camera off releases video/fallback without leaving; microphone state shared between Voice and Video');
        await a.getByRole('button',{name:'Pop out video call',exact:true}).click();const floating=a.getByRole('region',{name:'Floating video call',exact:true});await floating.waitFor();
        const originalMovie=await movie(a).evaluate(video=>{window.originalCallMovie=video;return video.currentTime;});
        const drag=async(dx,dy)=>{const box=await floating.locator('header').boundingBox();await a.mouse.move(box.x+25,box.y+15);await a.mouse.down();await a.mouse.move(box.x+25+dx,box.y+15+dy,{steps:8});await a.mouse.up();};
        const resize=async(dx,dy)=>{const handle=await floating.getByRole('button',{name:'Resize video call',exact:true}).boundingBox();await a.mouse.move(handle.x+8,handle.y+8);await a.mouse.down();await a.mouse.move(handle.x+8+dx,handle.y+8+dy,{steps:8});await a.mouse.up();};
        const bounds=async()=>{let report;await wait(async()=>{const box=await floating.boundingBox(),viewport=await a.evaluate(()=>({width:document.fullscreenElement?.clientWidth||innerWidth,height:document.fullscreenElement?.clientHeight||innerHeight}));report={box,viewport};return box&&box.x>=0&&box.y>=0&&box.x+box.width<=viewport.width+1&&box.y+box.height<=viewport.height+1;},'floating window failed to clamp',5000).catch(()=>assert.fail(JSON.stringify(report)));};
        await drag(-420,-220);await resize(120,70);await bounds();await drag(10000,10000);await bounds();await drag(-10000,-10000);await bounds();
        await floating.getByRole('button',{name:'Fullscreen movie with video call',exact:true}).click();await wait(()=>a.evaluate(()=>Boolean(document.fullscreenElement?.contains(document.querySelector('.floating-video-call')))),'floating call absent from fullscreen');
        await drag(250,180);await resize(100,70);await bounds();await a.screenshot({path:path.join(artifacts,'video-call-fullscreen.png')});
        await a.evaluate(()=>document.exitFullscreen());await wait(()=>a.evaluate(()=>document.querySelector('.watchly-floating-root')?.parentElement===document.body),'floating call not restored after fullscreen');
        for(const name of ['Room','Chat','Call']){await open(a,name);assert.equal(await floating.isVisible(),true);assert.equal(await tile(b,'Camera A').getAttribute('data-camera-on'),'true');}
        await floating.getByRole('button',{name:'Restore video panel',exact:true}).click();await a.locator('.room-video-call:visible').waitFor();assert.equal(await floating.count(),0);assert.equal(await a.evaluate(()=>window.callTokenRequests),1);
        assert.equal(await movie(a).evaluate(video=>video===window.originalCallMovie),true);assert.ok(await movie(a).evaluate(video=>!video.paused&&video.currentTime>0));assert.equal((await snapshot()).playback.status,'playing');evidence.checks.push('Pop out, drag, resize, edge clamping, fullscreen portal, fullscreen drag/resize, sidebar switches and restore preserve media/movie');
        await a.getByRole('button',{name:'Turn camera off',exact:true}).click();await a.evaluate(()=>window.denyCamera=true);await a.getByRole('button',{name:'Turn camera on',exact:true}).click();await a.getByText(/Camera access blocked/).waitFor();await a.getByRole('button',{name:'Open without camera',exact:true}).click();await synced(a);assert.equal((await snapshot()).members.length,2);await a.evaluate(()=>window.denyCamera=false);await a.getByRole('button',{name:'Turn camera on',exact:true}).click();
        await a.getByRole('button',{name:'Call device settings',exact:true}).click();await a.getByLabel('Camera device',{exact:true}).selectOption({index:1});await a.getByLabel('Microphone device',{exact:true}).selectOption({index:1});await a.getByRole('button',{name:'Call device settings',exact:true}).click();assert.equal(await a.evaluate(()=>window.callTokenRequests),1);
        evidence.checks.push('Denied camera recovers without breaking Watchly; device switching uses existing session');
        for(const name of ['Camera C','Camera D']){const page=await browsers[1].newPage({viewport:{width:1366,height:768}});pages.push(page);page.on('pageerror',error=>errors.push(error.message));await page.addInitScript(()=>localStorage.setItem('watchly-room-appearance','classic'));await page.goto(`${base}/room/${roomId}`);await page.getByLabel('Nickname',{exact:true}).fill(name);await page.getByRole('button',{name:'Join room',exact:true}).click();await synced(page);await open(page,'Video');await page.getByRole('button',{name:'Join video',exact:true}).click();await page.locator('.video-call-content:visible[data-camera-on="true"]').waitFor();}
        await wait(async()=>await a.locator('.call-camera-tile').count()===4,'four-participant grid incomplete');await a.screenshot({path:path.join(artifacts,'video-call-four-participants.png')});evidence.checks.push('Four participants share room and responsive 2x2 camera grid');
        await a.getByRole('button',{name:'Pop out video call',exact:true}).click();
        for(const style of ['Classic','Cinematic']){await a.setViewportSize({width:1366,height:768});await a.getByRole('button',{name:'Room settings',exact:true}).click();await a.locator('.appearance-panel').getByRole('button',{name:new RegExp(`^${style}(?: |$)`)}).click();await a.keyboard.press('Escape');
            for(const [width,height]of[[1920,1080],[1440,900],[1366,768],[1024,768],[390,844],[844,390]]){await a.setViewportSize({width,height});await bounds();assert.equal(await floating.isVisible(),true);}
        }
        const metrics=await a.context().newCDPSession(a);for(const scale of [.9,1,1.25]){const width=Math.floor(1366/scale),height=Math.floor(768/scale);await a.setViewportSize({width,height});await metrics.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:scale,mobile:false});await bounds();}await metrics.send('Emulation.clearDeviceMetricsOverride');await metrics.detach();
        await a.setViewportSize({width:390,height:844});await bounds();const headerBox=await floating.locator('header').boundingBox();const cdp=await a.context().newCDPSession(a);await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:headerBox.x+20,y:headerBox.y+15}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:50,y:100}]});await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});await bounds();await cdp.detach();
        assert.equal(await a.evaluate(()=>window.callTokenRequests),1);await a.screenshot({path:path.join(artifacts,'video-call-mobile.png')});evidence.checks.push('Classic/Cinema, desktop/tablet/portrait/landscape, 90/100/125% zoom-equivalent bounds, touch drag and orientation preserve session');
        await a.setViewportSize({width:1366,height:768});await floating.getByRole('button',{name:'Restore video panel',exact:true}).click();await a.getByRole('button',{name:'Leave call',exact:true}).click();await a.getByRole('button',{name:'Join video',exact:true}).waitFor();assert.equal(await a.evaluate(()=>window.callTracks.every(track=>track.readyState==='ended')),true);
        await wait(async()=>await b.locator('.call-camera-tile').count()===3,'leaving call did not remove participant');assert.equal((await snapshot()).members.length,4);evidence.checks.push('Leave call stops captured camera/microphone and removes media participant while Watchly room remains intact');
        await a.reload();await synced(a);await open(a,'Video');await a.getByRole('button',{name:'Join video',exact:true}).waitFor();assert.equal(await a.evaluate(()=>window.callCaptures.length+window.callTokenRequests),0,'refresh auto-enabled media');evidence.checks.push('Refresh restores Watchly membership with camera/mic off and no stale LiveKit session');
        await a.getByRole('button',{name:'Join video',exact:true}).click();await a.locator('.video-call-content:visible[data-camera-on="true"]').waitFor();await a.getByRole('button',{name:'Unmute microphone',exact:true}).click();await a.getByRole('button',{name:'Mute microphone',exact:true}).waitFor();await a.getByRole('button',{name:'Pop out video call',exact:true}).click();await floating.getByRole('button',{name:'Minimize video call',exact:true}).click();assert.equal(await floating.getAttribute('data-minimized'),'true');assert.equal(await a.evaluate(()=>window.callTracks.every(track=>track.readyState==='live')),true);await floating.getByRole('button',{name:'Expand video call',exact:true}).click();await floating.getByRole('button',{name:'Close floating window and restore video panel',exact:true}).click();await a.locator('.room-video-call:visible').waitFor();assert.equal(await a.evaluate(()=>window.callTokenRequests),1);await require('./roomLifecycleChecks.cjs').verifyRelease({a,b,base,open,wait,evidence});await a.getByRole('button',{name:'Leave room',exact:true}).first().click();if(await a.getByRole('button',{name:'Leave room',exact:true}).count()>1)await a.getByRole('button',{name:'Leave room',exact:true}).last().click();await a.waitForURL(base+'/');assert.equal(await a.evaluate(()=>window.callTracks.every(track=>track.readyState==='ended')),true);assert.equal(await a.locator('.watchly-floating-root').count(),0);assert.equal(await a.evaluate(()=>window.departureRevoked.includes(window.departureFileURL)),true,'room exit did not release local URL');evidence.checks.push('Minimize and X preserve camera/mic; leaving Watchly stops both tracks and removes floating UI');
        assert.deepEqual(errors,[]);evidence.passed=true;evidence.initialMovieTime=originalMovie;writeFileSync(path.join(artifacts,'video-call-verification.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
    }catch(error){for(const[name,page]of[['a',a],['b',b]])if(page){console.error(name,await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.join(artifacts,`video-call-${name}-failure.png`)}).catch(()=>{});}throw error;}
    finally{await Promise.all(browsers.map(browser=>browser.close()));frontend.kill();backend.kill();sfu.kill();}
})().catch(error=>{console.error(error);process.exitCode=1;});
