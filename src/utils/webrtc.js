// src/utils/webrtc.js — WebRTC Peer Connection Manager

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun2.l.google.com:19302' },
    { urls: 'stun:stun3.l.google.com:19302' },
    // Free TURN servers via Open Relay (replace with your own for production)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ],
  iceCandidatePoolSize: 10
};

export class PeerConnectionManager {
  constructor({ socket, localStream, onTrack, onConnectionStateChange }) {
    this.socket = socket;
    this.localStream = localStream;
    this.onTrack = onTrack;
    this.onConnectionStateChange = onConnectionStateChange;
    this.peers = new Map(); // socketId -> RTCPeerConnection
    this.pendingCandidates = new Map(); // socketId -> []
  }

  // Create a new RTCPeerConnection for a remote peer
  _createPeer(socketId) {
    if (this.peers.has(socketId)) return this.peers.get(socketId);

    const pc = new RTCPeerConnection(ICE_SERVERS);
    this.peers.set(socketId, pc);
    this.pendingCandidates.set(socketId, []);

    // Add local tracks
    if (this.localStream) {
      this.localStream.getTracks().forEach(track => {
        pc.addTrack(track, this.localStream);
      });
    }

    // ICE candidate handler
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) {
        this.socket.emit('ice-candidate', { to: socketId, candidate });
      }
    };

    // Remote track received
    pc.ontrack = ({ streams }) => {
      if (streams && streams[0]) {
        this.onTrack(socketId, streams[0]);
      }
    };

    // Connection state monitoring
    pc.onconnectionstatechange = () => {
      this.onConnectionStateChange?.(socketId, pc.connectionState);
    };

    pc.oniceconnectionstatechange = () => {
      if (pc.iceConnectionState === 'failed') {
        pc.restartIce();
      }
    };

    return pc;
  }

  // Initiator: create offer
  async callPeer(socketId) {
    const pc = this._createPeer(socketId);
    const offer = await pc.createOffer({
      offerToReceiveAudio: true,
      offerToReceiveVideo: true
    });
    await pc.setLocalDescription(offer);
    this.socket.emit('offer', { to: socketId, offer });
  }

  // Responder: handle incoming offer
  async handleOffer(socketId, offer) {
    const pc = this._createPeer(socketId);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));

    // Flush pending ICE candidates
    const pending = this.pendingCandidates.get(socketId) || [];
    for (const c of pending) await pc.addIceCandidate(new RTCIceCandidate(c));
    this.pendingCandidates.set(socketId, []);

    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.socket.emit('answer', { to: socketId, answer });
  }

  // Handle incoming answer
  async handleAnswer(socketId, answer) {
    const pc = this.peers.get(socketId);
    if (!pc) return;
    if (pc.signalingState === 'have-local-offer') {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  // Handle ICE candidate
  async handleIceCandidate(socketId, candidate) {
    const pc = this.peers.get(socketId);
    if (!pc) return;
    if (pc.remoteDescription) {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } else {
      // Queue it until remote description is set
      const pending = this.pendingCandidates.get(socketId) || [];
      pending.push(candidate);
      this.pendingCandidates.set(socketId, pending);
    }
  }

  // Replace local stream tracks (e.g. when toggling camera)
  async replaceTrack(kind, newTrack) {
    for (const [, pc] of this.peers) {
      const sender = pc.getSenders().find(s => s.track?.kind === kind);
      if (sender) {
        await sender.replaceTrack(newTrack);
      }
    }
  }

  // Remove a peer (they left)
  removePeer(socketId) {
    const pc = this.peers.get(socketId);
    if (pc) {
      pc.close();
      this.peers.delete(socketId);
      this.pendingCandidates.delete(socketId);
    }
  }

  // Close all connections
  closeAll() {
    for (const [, pc] of this.peers) pc.close();
    this.peers.clear();
    this.pendingCandidates.clear();
  }
}