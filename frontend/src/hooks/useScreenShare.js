import { useCallback, useEffect, useRef, useState } from 'react';
import { socket } from '../socket';

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
    const connection = useCallback(target => {
        const peer = new RTCPeerConnection({ iceServers });
        peer.onicecandidate = event => event.candidate && socket.connected && socket.emit('screen:ice', { targetSocketId: target, candidate: event.candidate });
        peer.ontrack = event => setRemoteStream(event.streams[0]);
        peer._watchlyRestarted = false;
        peer.oniceconnectionstatechange = async () => {
            if (peer.iceConnectionState === 'connected' || peer.iceConnectionState === 'completed') reportConnectionType(peer);
            if (peer.iceConnectionState === 'failed' && !peer._watchlyRestarted && localStream.current) {
                peer._watchlyRestarted = true; setStatus('reconnecting'); peer.restartIce();
                const offer = await peer.createOffer({ iceRestart: true }); await peer.setLocalDescription(offer);
                if (socket.connected) socket.emit('screen:offer', { targetSocketId: target, offer });
            } else if (peer.iceConnectionState === 'failed') {
                setStatus('failed'); setWarning('Direct connection failed. Try Local File Sync or configure TURN relay access.');
            }
        };
        peers.current.set(target, peer); return peer;
    }, [iceServers, reportConnectionType]);
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
                const peer = connection(viewer.socketId); stream.getTracks().forEach(track => peer.addTrack(track, stream));
                const sender = peer.getSenders().find(item => item.track?.kind === 'video');
                if (sender) { const params = sender.getParameters(); params.encodings ||= [{}]; params.encodings[0].maxBitrate = 2_500_000; await sender.setParameters(params); }
                const offer = await peer.createOffer(); await peer.setLocalDescription(offer);
                if (token !== generation.current || !socket.connected) throw new Error('Screen sharing was interrupted. Start sharing again when ready.');
                socket.emit('screen:offer', { targetSocketId: viewer.socketId, offer });
            }
            setSharing(true); setStatus(response.viewers.length ? 'connecting' : 'sharing');
        } catch (error) {
            if (token === generation.current) close(Boolean(localStream.current));
            throw error;
        }
    }, [close, connection]);
    useEffect(() => {
        const offer = async ({ senderSocketId, offer: description }) => {
            const token = generation.current, peer = connection(senderSocketId);
            try {
                await peer.setRemoteDescription(description);
                const answer = await peer.createAnswer(); await peer.setLocalDescription(answer);
                if (token === generation.current && socket.connected) socket.emit('screen:answer', { targetSocketId: senderSocketId, answer });
            } catch (error) {
                if (token === generation.current) setWarning(error.message || 'Screen sharing could not connect. Try sharing again.');
            }
        };
        const answer = ({ senderSocketId, answer: description }) => peers.current.get(senderSocketId)?.setRemoteDescription(description);
        const ice = ({ senderSocketId, candidate }) => peers.current.get(senderSocketId)?.addIceCandidate(candidate).catch(() => {});
        const stopped = () => close(false);
        const interrupted = () => {
            const wasSharing = Boolean(localStream.current || peers.current.size);
            close(false);
            if (wasSharing) setWarning('Screen sharing was interrupted. Start sharing again when ready.');
        };
        const unavailable = value => setWarning(value.message);
        socket.on('screen:offer', offer); socket.on('screen:answer', answer); socket.on('screen:ice', ice); socket.on('screen:stopped', stopped); socket.on('screen:unavailable', unavailable); socket.on('disconnect', interrupted);
        return () => { socket.off('screen:offer', offer); socket.off('screen:answer', answer); socket.off('screen:ice', ice); socket.off('screen:stopped', stopped); socket.off('screen:unavailable', unavailable); socket.off('disconnect', interrupted); close(false); };
    }, [close, connection]);
    return { supported: Boolean(navigator.mediaDevices?.getDisplayMedia), sharing, remoteStream, status, warning, start, stop: close };
}
