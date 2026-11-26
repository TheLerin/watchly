import { requestVoiceToken } from './livekitVoice';

// Application-facing media authorization contract. UI and track ownership stay with the existing LiveKit provider.
const livekit = Object.freeze({ name: 'livekit', authorize: requestVoiceToken });
export function getMediaProvider(name = 'livekit') {
    if (name === 'livekit') return livekit;
    throw new Error('The selected media provider is not enabled.');
}
// A future SFU adapter must implement authorize + connect/publish/subscribe/remove and pass the existing call suite.
// No Cloudflare Realtime app, credentials or billing resources are created by this boundary.
