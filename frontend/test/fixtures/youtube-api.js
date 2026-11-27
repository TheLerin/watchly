// Deterministic provider boundary fixture. ReactPlayer and room transport stay real.
// ENDED -> playVideo restarts at zero; seeking to duration returns to ENDED.
window.YT = {
    loaded: 1,
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
    Player: class {
        constructor(container, options) {
            this.options = options; this.id = options.videoId; this.time = 0;
            this.state = -1; this.duration = 268; this.volume = 100; this.rate = 1; this.calls = [];
            this.frame = document.createElement('iframe'); this.frame.title = 'YouTube API fixture';
            (typeof container === 'string' ? document.getElementById(container) : container).replaceChildren(this.frame);
            (window.fixtureYouTubePlayers ||= []).push(this);
            this.timer = setInterval(() => {
                if (this.state !== 1) return;
                this.time = Math.min(this.duration, this.time + .05 * this.rate);
                if (this.time === this.duration) this.emit(0);
            }, 50);
            setTimeout(() => {
                options.events.onReady({ target: this });
                this.emit(options.playerVars.autoplay ? 1 : 5);
            }, 0);
        }
        emit(state) { this.state = state; this.options.events.onStateChange({ target: this, data: state }); }
        seekTo(position) {
            this.calls.push(['seek', position]); this.time = Math.min(this.duration, Math.max(0, position));
            this.emit(this.time === this.duration ? 0 : this.state === 1 ? 1 : 2);
        }
        playVideo() { this.calls.push(['play']); if (this.state === 0) this.time = 0; this.emit(1); }
        pauseVideo() { this.calls.push(['pause']); if (this.state !== 0) this.emit(2); }
        cueVideoById(value) { this.id = value.videoId; this.time = value.startSeconds || 0; this.emit(5); }
        getCurrentTime() { return this.time; }
        getDuration() { return this.duration; }
        getPlayerState() { return this.state; }
        getVideoData() { return { video_id: this.id, title: 'End and replay fixture' }; }
        getVideoLoadedFraction() { return 1; }
        getPlaylist() { return null; }
        getIframe() { return this.frame; }
        setVolume(value) { this.volume = value; }
        getVolume() { return this.volume; }
        setPlaybackRate(value) { this.rate = value; }
        getPlaybackRate() { return this.rate; }
        mute() { this.muted = true; }
        unMute() { this.muted = false; }
        isMuted() { return Boolean(this.muted); }
        setLoop() {}
        setShuffle() {}
        stopVideo() { this.state = -1; }
        destroy() { clearInterval(this.timer); this.frame.remove(); }
    },
};
window.onYouTubeIframeAPIReady?.();
