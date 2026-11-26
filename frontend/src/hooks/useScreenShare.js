import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../socket';
import { createUsageMeter, mediaUsageLimit } from '../utils/mediaUsage';

export default function useScreenShare(iceServers) {
    const peers = useRef(new Map());
    const localStream = useRef(null);
    const generation = useRef(0);
    const [remoteStream, setRemoteStream] = useState(null);
    const [sharing, setSharing] = useState(false);
    const [status, setStatus] = useState('idle');
    const [warning, setWarning] = useState('');
    const reportConnectionType = useCallback(async peer => {
        try {
            const stats = await peer.getStats();
            let pair = null;
            stats.forEach(report => {
                if (report.type === 'candidate-pair' && report.state === 'succeeded' && (report.nominated || report.selected)) pair = report;
            });
            if (!pair) stats.forEach(report => {
                if (report.type === 'transport' && report.selectedCandidatePairId) pair = stats.get(report.selectedCandidatePairId);
            });
            const local = pair ? stats.get(pair.localCandidateId) : null;
            const remote = pair ? stats.get(pair.remoteCandidateId) : null;
            const relayed = local?.candidateType === 'relay' || remote?.candidateType === 'relay';
            setStatus(relayed ? 'connected-relay' : 'connected-direct');
        } catch {
            setStatus('connected');
        }
    }, []);
    const close = useCallback((notify = true) => {
        generation.current++;
        peers.current.forEach(peer => peer.close()); peers.current.clear();
        localStream.current?.getTracks().forEach(track => track.stop()); localStream.current = null;
        setRemoteStream(null); setSharing(false); setStatus('idle'); if (notify && socket.connected) socket.emit('screen:stopped');
    }, []);
    useEffect(() => {
        if (!sharing && !remoteStream) return undefined;
        const meter = createUsageMeter({ limitBytes: mediaUsageLimit(), onLimit: () => { close(); setWarning('Screen sharing stopped at the configured media usage limit.'); } });
        const sample = async () => {
            for (const [id, peer] of peers.current) {
                try { meter.sample(await peer.getStats(), id); } catch { /* closed peer */ }
            }
        };
        void sample();
        const timer = setInterval(sample, 30000);
        return () => clearInterval(timer);
    }, [sharing, remoteStream, close]);
    const connection = useCallback(target => {
        peers.current.get(target)?.close();
        const peer = new RTCPeerConnection({ iceServers });
        peer._watchlyIce = [];
        peer.onicecandidate = event => event.candidate && socket.connected && socket.emit('screen:ice', { targetSocketId: target, candidate: event.candidate });
        peer.ontrack = event => setRemoteStream(event.streams[0]);
        peer._watchlyRestarted = false;
        peer.oniceconnectionstatechange = async () => {
            if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') reportConnectionType(peer);
            if (peer.iceConnectionState === 'failed' && !peer._watchlyRestarted && localStream.current) {
                try {
                    peer._watchlyRestarted = true; setStatus('reconnecting'); peer.restartIce();
                    const offer = await peer.createOffer({ iceRestart: true }); await peer.setLocalDescription(offer);
                    if (socket.connected && peers.current.get(target) === peer) socket.emit('screen:offer', { targetSocketId: target, offer });
                } catch { setStatus('failed'); setWarning('Screen sharing could not reconnect. Start sharing again.'); }
            } else if (peer.iceConnectionState === 'failed') {
                setStatus('failed'); setWarning('Direct connection failed. Try Local File Sync or configure TURN relay access.');
            }
        };
        peers.current.set(target, peer); return peer;
    }, [iceServers, reportConnectionType]);
    const offerViewer = useCallback(async target => {
        const stream = localStream.current, token = generation.current;
        if (!stream || !socket.connected) return;
        const peer = connection(target); stream.getTracks().forEach(track => peer.addTrack(track, stream));
        const sender = peer.getSenders().find(item => item.track?.kind === 'video');
        if (sender) { const params = sender.getParameters(); params.encodings ||= [{}]; params.encodings[0].maxBitrate = 2_500_000; await sender.setParameters(params); }
        const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
        if (token === generation.current && socket.connected && peers.current.get(target) === peer) socket.emit('screen:offer', { targetSocketId: target, offer });
    }, [connection]);
    const start = useCallback(async () => {
        if (!socket.connected) throw new Error('Wait for the room to reconnect before sharing your screen.');
        const token = ++generation.current;
        setWarning(''); setStatus('requesting-permission');
        try {
            const stream = await navigator.mediaDevices.getDisplayMedia({ video: { width: 1280, height: 720, frameRate: 30 }, audio: true });
            if (token !== generation.current || !socket.connected) { stream.getTracks().forEach(track => track.stop()); throw new Error('Screen sharing was interrupted. Start sharing again when ready.'); }
            localStream.current = stream; stream.getVideoTracks()[0].contentHint = 'motion'; stream.getVideoTracks()[0].onended = close;
            if (!stream.getAudioTracks().length) setWarning('No shared audio — stop and choose “Share tab audio”.');
            const response = await new Promise((resolve, reject) => socket.timeout(8000).emit(
                'screen:started', {}, (error, value) => error ? reject(new Error('Screen-share setup timed out.')) : resolve(value)
            ));
            if (token !== generation.current || !socket.connected) throw new Error('Screen sharing was interrupted. Start sharing again when ready.');
            if (!response?.ok) throw new Error(response?.error?.message || 'Could not share screen.');
            if (response.excludedCount) setWarning(`${response.excludedCount} participant(s) exceed the three-viewer beta limit. Use Local File Sync instead.`);
            for (const viewer of response.viewers) {
                await offerViewer(viewer.socketId);
                if (token !== generation.current || !socket.connected) throw new Error('Screen sharing was interrupted. Start sharing again when ready.');
            }
            setSharing(true); setStatus(response.viewers.length ? 'connecting' : 'sharing');
        } catch (error) {
            if (token === generation.current) close(Boolean(localStream.current));
            throw error;
        }
    }, [close, offerViewer]);
    useEffect(() => {
        const offer = async ({ senderSocketId, offer: description }) => {
            const token = generation.current, peer = connection(senderSocketId);
            try {
                await peer.setRemoteDescription(description);
                for (const candidate of peer._watchlyIce.splice(0)) await peer.addIceCandidate(candidate).catch(() => {});
                const answer = await peer.createAnswer(); await peer.setLocalDescription(answer);
                if (token === generation.current && socket.connected) socket.emit('screen:answer', { targetSocketId: senderSocketId, answer });
            } catch (error) {
                if (token === generation.current) setWarning(error.message || 'Screen sharing could not connect. Try sharing again.');
            }
        };
        const answer = async ({ senderSocketId, answer: description }) => {
            const peer = peers.current.get(senderSocketId); if (!peer) return;
            try { await peer.setRemoteDescription(description); for (const candidate of peer._watchlyIce.splice(0)) await peer.addIceCandidate(candidate).catch(() => {}); }
            catch { setWarning('Screen sharing could not connect. Start sharing again.'); }
        };
        const ice = ({ senderSocketId, candidate }) => {
            const peer = peers.current.get(senderSocketId); if (!peer) return;
            if (peer.remoteDescription) void peer.addIceCandidate(candidate).catch(() => {});
            else if (peer._watchlyIce.length < 128) peer._watchlyIce.push(candidate);
        };
        const viewerAdded = ({ socketId }) => { void offerViewer(socketId).catch(() => setWarning('A new viewer could not connect. Start sharing again.')); };
        const viewerLeft = ({ socketId }) => { peers.current.get(socketId)?.close(); peers.current.delete(socketId); };
        const stopped = () => close(false);
        const interrupted = () => {
            const wasSharing = Boolean(localStream.current || peers.current.size);
            close(false);
            if (wasSharing) setWarning('Screen sharing was interrupted. Start sharing again when ready.');
        };
        const unavailable = value => setWarning(value.message);
        socket.on('screen:offer', offer); socket.on('screen:answer', answer); socket.on('screen:ice', ice); socket.on('screen:stopped', stopped); socket.on('screen:unavailable', unavailable); socket.on('disconnect', interrupted);
        socket.on('screen:viewer-added', viewerAdded); socket.on('screen:viewer-left', viewerLeft);
        return () => { socket.off('screen:offer', offer); socket.off('screen:answer', answer); socket.off('screen:ice', ice); socket.off('screen:stopped', stopped); socket.off('screen:unavailable', unavailable); socket.off('disconnect', interrupted); socket.off('screen:viewer-added', viewerAdded); socket.off('screen:viewer-left', viewerLeft); close(false); };
    }, [close, connection, offerViewer]);
    return { supported: Boolean(navigator.mediaDevices?.getDisplayMedia), sharing, remoteStream, status, warning, start, stop: close };
}
