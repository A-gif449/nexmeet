// src/main.js — NexMeet Application Core
import { io } from 'socket.io-client';
import { PeerConnectionManager } from './utils/webrtc.js';
import { AudioAnalyzer } from './utils/audioAnalyzer.js';
import { getAvatarGradient, getInitials, formatTime, formatChatTime, copyToClipboard, showNotification } from './utils/helpers.js';

// ─── State ──────────────────────────────────────────────────────────────────
const state = {
  socket: null,
  pcManager: null,
  audioAnalyzer: new AudioAnalyzer(),
  localStream: null,
  screenStream: null,
  roomId: null,
  peerId: null,
  displayName: '',
  micOn: true,
  cameraOn: true,
  screenSharing: false,
  handRaised: false,
  sidebarOpen: false,
  sidebarTab: 'chat', // 'chat' | 'participants'
  peers: new Map(),   // socketId -> { peerId, displayName, videoOn, audioOn, handRaised, stream }
  chatMessages: [],
  unreadCount: 0,
  startTime: null,
  timerInterval: null,
  reactionsOpen: false
};

// ─── DOM refs ────────────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const lobby   = $('lobby');
const prejoin = $('prejoin');
const room    = $('room');

// ─── RENDER LOBBY ─────────────────────────────────────────────────────────
function renderLobby() {
  lobby.innerHTML = `
    <div class="lobby-logo"><div class="dot"></div>NexMeet</div>
    <div class="lobby-hero">
      <h1>Meet <span>Without Limits</span></h1>
      <p>Crystal-clear video meetings for up to 4 people — no downloads needed</p>
    </div>
    <div class="lobby-card">
      <div class="lobby-tabs">
        <button class="lobby-tab active" data-tab="new">New Meeting</button>
        <button class="lobby-tab" data-tab="join">Join Meeting</button>
      </div>
      <div class="lobby-section active" id="tab-new">
        <div class="field-group">
          <span class="field-label">Your Name</span>
          <input class="field-input" id="name-new" type="text" placeholder="Enter your display name" maxlength="32" />
        </div>
        <button class="btn-primary" id="create-room-btn">✦ Start New Meeting</button>
      </div>
      <div class="lobby-section" id="tab-join">
        <div class="field-group">
          <span class="field-label">Your Name</span>
          <input class="field-input" id="name-join" type="text" placeholder="Enter your display name" maxlength="32" />
        </div>
        <div class="field-group">
          <span class="field-label">Meeting Code</span>
          <input class="field-input" id="room-code" type="text" placeholder="e.g. AB12CD34" maxlength="8" style="text-transform:uppercase;letter-spacing:0.1em;" />
        </div>
        <button class="btn-primary" id="join-room-btn">→ Join Meeting</button>
      </div>
    </div>
    <div class="lobby-features">
      <div class="lobby-feature"><div class="lobby-feature-icon">🔒</div><div class="lobby-feature-label">End-to-End<br>Encrypted</div></div>
      <div class="lobby-feature"><div class="lobby-feature-icon">⚡</div><div class="lobby-feature-label">Ultra-Low<br>Latency</div></div>
      <div class="lobby-feature"><div class="lobby-feature-icon">👥</div><div class="lobby-feature-label">Up to 4<br>Participants</div></div>
      <div class="lobby-feature"><div class="lobby-feature-icon">🎥</div><div class="lobby-feature-label">HD Video<br>Quality</div></div>
    </div>
  `;

  // Tab switching
  lobby.querySelectorAll('.lobby-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      lobby.querySelectorAll('.lobby-tab').forEach(b => b.classList.remove('active'));
      lobby.querySelectorAll('.lobby-section').forEach(s => s.classList.remove('active'));
      btn.classList.add('active');
      $(`tab-${btn.dataset.tab}`).classList.add('active');
    });
  });

 $('create-room-btn').addEventListener('click', async () => {
    const name = $('name-new').value.trim();
    if (!name) { showNotification('Please enter your name', 'warning'); $('name-new').focus(); return; }
    state.displayName = name;
    const btn = $('create-room-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Starting...';
    const res = await fetch('https://nexmeet-2nts.onrender.com/create-room').catch(() => null);
    btn.disabled = false;
    btn.textContent = '✦ Start New Meeting';
    if (!res?.ok) { showNotification('Server offline. Please try again in a moment.', 'error', 6000); return; }
    const { roomId } = await res.json();
    state.roomId = roomId;
    showPrejoin();
  });

  $('join-room-btn').addEventListener('click', () => {
    const name = $('name-join').value.trim();
    const code = $('room-code').value.trim().toUpperCase();
    if (!name) { showNotification('Please enter your name', 'warning'); $('name-join').focus(); return; }
    if (code.length !== 8) { showNotification('Enter a valid 8-character meeting code', 'warning'); $('room-code').focus(); return; }
    state.displayName = name;
    state.roomId = code;
    showPrejoin();
  });

  // Check for ?room= in URL
  const params = new URLSearchParams(location.search);
  const urlRoom = params.get('room');
  if (urlRoom) {
    lobby.querySelector('[data-tab="join"]').click();
    setTimeout(() => { if ($('room-code')) $('room-code').value = urlRoom; }, 10);
  }
}

// ─── RENDER PRE-JOIN ─────────────────────────────────────────────────────
async function showPrejoin() {
  lobby.style.display = 'none';
  prejoin.style.display = 'flex';

  prejoin.innerHTML = `
    <div class="prejoin-container">
      <div class="prejoin-preview" id="preview-box">
        <video id="preview-video" autoplay muted playsinline></video>
        <div class="prejoin-preview-placeholder" id="preview-placeholder">
          <div class="avatar-lg">${getInitials(state.displayName)}</div>
          <span style="font-size:13px;color:var(--text-muted)">Camera is off</span>
        </div>
      </div>
      <div class="prejoin-settings">
        <div>
          <div class="prejoin-title">Ready to join?</div>
          <div class="prejoin-subtitle">Room: <strong style="color:var(--accent);font-family:monospace;letter-spacing:0.1em">${state.roomId}</strong></div>
        </div>
        <div class="device-toggles">
          <div class="device-toggle">
            <div class="device-toggle-info">
              <div class="device-toggle-icon">🎙️</div>
              <div>
                <div class="device-toggle-name">Microphone</div>
                <div class="device-toggle-status" id="mic-status">Detecting...</div>
              </div>
            </div>
            <div class="toggle-switch on" id="mic-toggle"></div>
          </div>
          <div class="device-toggle">
            <div class="device-toggle-info">
              <div class="device-toggle-icon">📷</div>
              <div>
                <div class="device-toggle-name">Camera</div>
                <div class="device-toggle-status" id="cam-status">Detecting...</div>
              </div>
            </div>
            <div class="toggle-switch on" id="cam-toggle"></div>
          </div>
        </div>
        <button class="btn-primary" id="join-now-btn">🚀 Join Meeting</button>
        <button style="background:none;border:none;color:var(--text-muted);cursor:pointer;font-size:13px;text-align:left" id="back-btn">← Back</button>
      </div>
    </div>
  `;

  // Get user media
  try {
    state.localStream = await navigator.mediaDevices.getUserMedia({
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
    const pv = $('preview-video');
    pv.srcObject = state.localStream;
    $('preview-placeholder').style.display = 'none';
    $('mic-status').textContent = 'Ready';
    $('cam-status').textContent = 'Ready';
    state.micOn = true; state.cameraOn = true;
  } catch (err) {
    $('mic-status').textContent = 'Not available';
    $('cam-status').textContent = 'Not available';
    showNotification('Could not access camera/mic. Check permissions.', 'warning', 5000);
    state.localStream = new MediaStream();
    state.micOn = false; state.cameraOn = false;
    $('mic-toggle').classList.remove('on');
    $('cam-toggle').classList.remove('on');
  }

  // Toggle logic
  $('mic-toggle').addEventListener('click', () => {
    state.micOn = !state.micOn;
    $('mic-toggle').classList.toggle('on', state.micOn);
    state.localStream?.getAudioTracks().forEach(t => t.enabled = state.micOn);
  });
  $('cam-toggle').addEventListener('click', () => {
    state.cameraOn = !state.cameraOn;
    $('cam-toggle').classList.toggle('on', state.cameraOn);
    state.localStream?.getVideoTracks().forEach(t => t.enabled = state.cameraOn);
    $('preview-placeholder').style.display = state.cameraOn ? 'none' : 'flex';
  });

  $('join-now-btn').addEventListener('click', joinMeeting);
  $('back-btn').addEventListener('click', () => {
    state.localStream?.getTracks().forEach(t => t.stop());
    state.localStream = null;
    prejoin.style.display = 'none';
    lobby.style.display = 'flex';
  });
}

// ─── JOIN MEETING ─────────────────────────────────────────────────────────
function joinMeeting() {
  prejoin.style.display = 'none';
  room.style.display = 'flex';
  renderRoom();
  connectSocket();
}

// ─── RENDER ROOM ──────────────────────────────────────────────────────────
function renderRoom() {
  room.innerHTML = `
    <div class="room-header">
      <div class="room-info">
        <div class="room-brand">NexMeet</div>
        <div class="room-id-badge">
          <span id="room-id-display">${state.roomId}</span>
          <button id="copy-room-id">Copy</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:20px">
        <div class="room-participants-count">
          <div class="participant-dots" id="participant-dots">
            ${[0,1,2,3].map(i => `<div class="participant-dot" id="dot-${i}"></div>`).join('')}
          </div>
          <span id="participant-count-label" style="font-size:12px;color:var(--text-muted)">1 / 4</span>
        </div>
        <div class="room-timer" id="room-timer">00:00</div>
      </div>
    </div>

    <div class="room-body">
      <div class="video-grid count-1" id="video-grid"></div>
      <div class="room-sidebar" id="sidebar">
        <div class="sidebar-tabs">
          <button class="sidebar-tab active" data-tab="chat" id="tab-btn-chat">
            💬 Chat <span class="unread-badge hidden" id="unread-badge">0</span>
          </button>
          <button class="sidebar-tab" data-tab="participants" id="tab-btn-participants">
            👥 People
          </button>
        </div>
        <div class="sidebar-content">
          <div id="sidebar-chat" class="sidebar-panel">
            <div class="chat-messages" id="chat-messages">
              <div class="empty-state">
                <div class="empty-state-icon">💬</div>
                <p>No messages yet.<br>Start the conversation!</p>
              </div>
            </div>
            <div class="chat-input-area">
              <textarea class="chat-input" id="chat-input" placeholder="Type a message…" rows="1"></textarea>
              <button class="chat-send-btn" id="chat-send">➤</button>
            </div>
          </div>
          <div id="sidebar-participants" class="sidebar-panel hidden">
            <div class="participants-list" id="participants-list"></div>
          </div>
        </div>
      </div>
    </div>

    <div class="control-bar">
      <div class="control-group" style="gap:16px">
        <div class="ctrl-btn-wrapper">
          <button class="ctrl-btn ${state.micOn ? '' : 'muted'}" id="btn-mic">${state.micOn ? '🎙️' : '🔇'}</button>
          <span class="ctrl-btn-label">${state.micOn ? 'Mute' : 'Unmute'}</span>
        </div>
        <div class="ctrl-btn-wrapper">
          <button class="ctrl-btn ${state.cameraOn ? '' : 'muted'}" id="btn-cam">${state.cameraOn ? '📷' : '📷'}</button>
          <span class="ctrl-btn-label">${state.cameraOn ? 'Stop Video' : 'Start Video'}</span>
        </div>
      </div>

      <div class="control-group" style="gap:12px;position:relative">
        <div class="ctrl-btn-wrapper">
          <button class="ctrl-btn" id="btn-screen">🖥️</button>
          <span class="ctrl-btn-label">Share</span>
        </div>
        <div class="ctrl-btn-wrapper" style="position:relative">
          <button class="ctrl-btn" id="btn-reactions">😊</button>
          <span class="ctrl-btn-label">React</span>
          <div class="reactions-popup" id="reactions-popup">
            ${['👍','❤️','😂','😮','🎉','👏','🙌','🔥'].map(e => `<button class="reaction-btn">${e}</button>`).join('')}
          </div>
        </div>
        <div class="ctrl-btn-wrapper">
          <button class="ctrl-btn" id="btn-hand">✋</button>
          <span class="ctrl-btn-label">Raise Hand</span>
        </div>
        <div class="ctrl-btn-wrapper">
          <button class="ctrl-btn" id="btn-chat">💬</button>
          <span class="ctrl-btn-label">Chat</span>
        </div>
      </div>

      <div class="control-group">
        <button class="end-call-btn" id="btn-end">📵 <span>End Call</span></button>
      </div>
    </div>

    <div class="notifications-container" id="notifications"></div>
  `;

  // Add local video tile
  addLocalTile();
  updateGrid();

  // Wire controls
  $('copy-room-id').addEventListener('click', () => {
    const url = `${location.origin}?room=${state.roomId}`;
    copyToClipboard(url).then(() => showNotification('Meeting link copied! Share it with others.', 'success'));
  });

  $('btn-mic').addEventListener('click', toggleMic);
  $('btn-cam').addEventListener('click', toggleCamera);
  $('btn-screen').addEventListener('click', toggleScreen);
  $('btn-hand').addEventListener('click', toggleHand);
  $('btn-chat').addEventListener('click', toggleSidebar);
  $('btn-end').addEventListener('click', endCall);

  $('btn-reactions').addEventListener('click', (e) => {
    e.stopPropagation();
    state.reactionsOpen = !state.reactionsOpen;
    $('reactions-popup').classList.toggle('open', state.reactionsOpen);
    $('btn-reactions').classList.toggle('active', state.reactionsOpen);
  });

  document.addEventListener('click', () => {
    if (state.reactionsOpen) {
      state.reactionsOpen = false;
      $('reactions-popup').classList.remove('open');
      $('btn-reactions').classList.remove('active');
    }
  });

  $('reactions-popup').querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      sendReaction(btn.textContent);
    });
  });

  // Sidebar tabs
  ['chat','participants'].forEach(tab => {
    $(`tab-btn-${tab}`).addEventListener('click', () => {
      state.sidebarTab = tab;
      document.querySelectorAll('.sidebar-tab').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.sidebar-panel').forEach(p => p.classList.add('hidden'));
      $(`tab-btn-${tab}`).classList.add('active');
      $(`sidebar-${tab}`).classList.remove('hidden');
      if (tab === 'chat') { state.unreadCount = 0; updateUnread(); }
      if (tab === 'participants') updateParticipantsList();
    });
  });

  // Chat
  $('chat-send').addEventListener('click', sendChat);
  $('chat-input').addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });

  // Timer
  state.startTime = Date.now();
  state.timerInterval = setInterval(() => {
    if ($('room-timer')) $('room-timer').textContent = formatTime(Date.now() - state.startTime);
  }, 1000);
}

// ─── LOCAL TILE ────────────────────────────────────────────────────────────
function addLocalTile() {
  const tile = document.createElement('div');
  tile.className = 'video-tile local';
  tile.id = 'tile-local';
  tile.innerHTML = `
    <video id="local-video" autoplay muted playsinline></video>
    <div class="video-tile-overlay"></div>
    <div class="video-tile-avatar ${state.cameraOn ? '' : 'visible'}" id="avatar-local">
      <div class="avatar-circle" style="background:${getAvatarGradient(state.displayName)}">${getInitials(state.displayName)}</div>
      <div class="avatar-name">${state.displayName}</div>
    </div>
    <div class="video-tile-info">
      <div class="video-tile-name">
        ${state.displayName}
        <span class="you-badge">You</span>
      </div>
      <div class="tile-media-icons">
        <div class="tile-media-icon ${state.micOn ? '' : 'muted'}" id="local-mic-icon">${state.micOn ? '🎙️' : '🔇'}</div>
      </div>
    </div>
    <div class="hand-raise-badge" id="local-hand">✋</div>
    <div class="screenshare-indicator" id="local-screen">Sharing Screen</div>
  `;
  $('video-grid').appendChild(tile);

  const localVideo = $('local-video');
  if (state.localStream) localVideo.srcObject = state.localStream;
  state.audioAnalyzer.attach('local', state.localStream, (id, speaking) => {
    const t = $('tile-local');
    if (t) t.classList.toggle('speaking', speaking && state.micOn);
  });
}

// ─── REMOTE TILE ──────────────────────────────────────────────────────────
function addRemoteTile(socketId, info) {
  const { displayName } = info;
  const tileId = `tile-${socketId}`;
  if ($(tileId)) return;

  const tile = document.createElement('div');
  tile.className = 'video-tile remote';
  tile.id = tileId;
  tile.innerHTML = `
    <video id="video-${socketId}" autoplay playsinline></video>
    <div class="video-tile-overlay"></div>
    <div class="video-tile-avatar visible" id="avatar-${socketId}">
      <div class="avatar-circle" style="background:${getAvatarGradient(displayName)}">${getInitials(displayName)}</div>
      <div class="avatar-name">${displayName}</div>
    </div>
    <div class="video-tile-info">
      <div class="video-tile-name">${displayName}</div>
      <div class="tile-media-icons">
        <div class="tile-media-icon" id="mic-icon-${socketId}">🎙️</div>
      </div>
    </div>
    <div class="hand-raise-badge" id="hand-${socketId}">✋</div>
    <div class="screenshare-indicator" id="screen-${socketId}">Sharing Screen</div>
  `;
  $('video-grid').appendChild(tile);
  updateGrid();
  updateParticipantDots();
  if (state.sidebarTab === 'participants' && state.sidebarOpen) updateParticipantsList();
}

function removeRemoteTile(socketId) {
  const tile = $(`tile-${socketId}`);
  if (tile) tile.remove();
  state.audioAnalyzer.detach(socketId);
  updateGrid();
  updateParticipantDots();
  if (state.sidebarTab === 'participants' && state.sidebarOpen) updateParticipantsList();
}

function setRemoteStream(socketId, stream) {
  const video = $(`video-${socketId}`);
  if (video) {
    video.srcObject = stream;
    const avatar = $(`avatar-${socketId}`);
    const hasVideo = stream.getVideoTracks().length > 0 && stream.getVideoTracks()[0].enabled;
    if (avatar) avatar.classList.toggle('visible', !hasVideo);
    state.audioAnalyzer.attach(socketId, stream, (id, speaking) => {
      const t = $(`tile-${id}`);
      const peerInfo = state.peers.get(id);
      if (t) t.classList.toggle('speaking', speaking && peerInfo?.audioOn !== false);
    });
  }
}

function updateGrid() {
  const grid = $('video-grid');
  if (!grid) return;
  const count = grid.querySelectorAll('.video-tile').length;
  grid.className = `video-grid count-${Math.max(1, count)}`;
  const label = $('participant-count-label');
  if (label) label.textContent = `${count} / 4`;
}

function updateParticipantDots() {
  const count = document.querySelectorAll('.video-tile').length;
  [0,1,2,3].forEach(i => {
    const dot = $(`dot-${i}`);
    if (dot) dot.classList.toggle('active', i < count);
  });
}

// ─── SOCKET CONNECTION ────────────────────────────────────────────────────
function connectSocket() {
  // Connect directly to the signaling server on port 4000
  const socket = io('https://nexmeet-2nts.onrender.com/', { transports: ['websocket', 'polling'] });
  state.socket = socket;

  state.pcManager = new PeerConnectionManager({
    socket,
    localStream: state.localStream,
    onTrack: (socketId, stream) => {
      setRemoteStream(socketId, stream);
      const peerInfo = state.peers.get(socketId);
      if (peerInfo) peerInfo.stream = stream;
    },
    onConnectionStateChange: (socketId, connState) => {
      if (connState === 'failed') {
        showNotification('Connection issue with a participant.', 'warning');
      }
    }
  });

  socket.on('connect', () => {
    socket.emit('join-room', { roomId: state.roomId, displayName: state.displayName });
  });

  socket.on('room-joined', ({ roomId, peerId, existingPeers }) => {
    state.roomId = roomId;
    state.peerId = peerId;
    showNotification(`Joined meeting ${roomId}`, 'success');
    // Call existing peers
    existingPeers.forEach(peer => {
      state.peers.set(peer.socketId, { peerId: peer.peerId, displayName: peer.displayName, videoOn: true, audioOn: true });
      addRemoteTile(peer.socketId, peer);
      state.pcManager.callPeer(peer.socketId);
    });
    updateParticipantDots();
  });

  socket.on('peer-joined', ({ socketId, peerId, displayName }) => {
    state.peers.set(socketId, { peerId, displayName, videoOn: true, audioOn: true });
    addRemoteTile(socketId, { displayName });
    showNotification(`${displayName} joined the meeting`, 'info');
  });

  socket.on('peer-left', ({ socketId }) => {
    const peerInfo = state.peers.get(socketId);
    if (peerInfo) showNotification(`${peerInfo.displayName} left the meeting`, 'info');
    state.peers.delete(socketId);
    state.pcManager.removePeer(socketId);
    removeRemoteTile(socketId);
  });

  socket.on('offer', async ({ from, displayName, offer }) => {
    await state.pcManager.handleOffer(from, offer);
  });

  socket.on('answer', async ({ from, answer }) => {
    await state.pcManager.handleAnswer(from, answer);
  });

  socket.on('ice-candidate', async ({ from, candidate }) => {
    await state.pcManager.handleIceCandidate(from, candidate);
  });

  socket.on('peer-media-state', ({ socketId, video, audio }) => {
    const peerInfo = state.peers.get(socketId);
    if (peerInfo) { peerInfo.videoOn = video; peerInfo.audioOn = audio; }
    const avatar = $(`avatar-${socketId}`);
    if (avatar) avatar.classList.toggle('visible', !video);
    const micIcon = $(`mic-icon-${socketId}`);
    if (micIcon) { micIcon.textContent = audio ? '🎙️' : '🔇'; micIcon.classList.toggle('muted', !audio); }
    if (state.sidebarTab === 'participants' && state.sidebarOpen) updateParticipantsList();
  });

  socket.on('peer-screen-share', ({ socketId, sharing }) => {
    const indicator = $(`screen-${socketId}`);
    if (indicator) indicator.classList.toggle('visible', sharing);
    const peerInfo = state.peers.get(socketId);
    if (peerInfo) peerInfo.screenSharing = sharing;
  });

  socket.on('chat-message', ({ from, displayName, message, timestamp }) => {
    addChatMessage({ from, displayName, message, timestamp, own: from === socket.id });
    if (!state.sidebarOpen || state.sidebarTab !== 'chat') {
      state.unreadCount++;
      updateUnread();
    }
  });

  socket.on('peer-raise-hand', ({ socketId, raised }) => {
    const badge = $(`hand-${socketId}`);
    if (badge) badge.classList.toggle('visible', raised);
    const peerInfo = state.peers.get(socketId);
    if (peerInfo) {
      peerInfo.handRaised = raised;
      if (raised) showNotification(`${peerInfo.displayName} raised their hand ✋`, 'info');
    }
  });

  socket.on('peer-reaction', ({ socketId, displayName, emoji }) => {
    const tileId = socketId === socket.id ? 'tile-local' : `tile-${socketId}`;
    showReactionOnTile(tileId, emoji);
  });

  socket.on('error', ({ code, message }) => {
    showNotification(message, 'error', 6000);
    endCall(true);
  });

  socket.on('disconnect', () => {
    showNotification('Disconnected from server. Attempting reconnect…', 'warning');
  });
}

// ─── CONTROLS ─────────────────────────────────────────────────────────────
function toggleMic() {
  state.micOn = !state.micOn;
  state.localStream?.getAudioTracks().forEach(t => t.enabled = state.micOn);
  const btn = $('btn-mic');
  btn.textContent = state.micOn ? '🎙️' : '🔇';
  btn.classList.toggle('muted', !state.micOn);
  btn.nextElementSibling.textContent = state.micOn ? 'Mute' : 'Unmute';
  $('local-mic-icon').textContent = state.micOn ? '🎙️' : '🔇';
  $('local-mic-icon').classList.toggle('muted', !state.micOn);
  state.socket?.emit('media-state', { video: state.cameraOn, audio: state.micOn });
}

function toggleCamera() {
  state.cameraOn = !state.cameraOn;
  state.localStream?.getVideoTracks().forEach(t => t.enabled = state.cameraOn);
  const btn = $('btn-cam');
  btn.classList.toggle('muted', !state.cameraOn);
  btn.nextElementSibling.textContent = state.cameraOn ? 'Stop Video' : 'Start Video';
  const avatar = $('avatar-local');
  if (avatar) avatar.classList.toggle('visible', !state.cameraOn);
  state.socket?.emit('media-state', { video: state.cameraOn, audio: state.micOn });
}

async function toggleScreen() {
  if (state.screenSharing) {
    stopScreenShare();
  } else {
    try {
      state.screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always', frameRate: { ideal: 30 } },
        audio: true
      });
      const screenTrack = state.screenStream.getVideoTracks()[0];
      await state.pcManager.replaceTrack('video', screenTrack);

      // Also update local video preview
      const localVideo = $('local-video');
      if (localVideo) localVideo.srcObject = state.screenStream;

      screenTrack.onended = () => stopScreenShare();
      state.screenSharing = true;
      $('btn-screen').classList.add('active');
      $('local-screen').classList.add('visible');
      state.socket?.emit('screen-share-started');
      showNotification('Screen sharing started', 'success');
    } catch (e) {
      if (e.name !== 'NotAllowedError') showNotification('Could not start screen share', 'error');
    }
  }
}

async function stopScreenShare() {
  state.screenStream?.getTracks().forEach(t => t.stop());
  state.screenStream = null;
  state.screenSharing = false;

  // Restore camera
  const camTrack = state.localStream?.getVideoTracks()[0];
  if (camTrack) await state.pcManager.replaceTrack('video', camTrack);
  const localVideo = $('local-video');
  if (localVideo) localVideo.srcObject = state.localStream;

  $('btn-screen').classList.remove('active');
  $('local-screen').classList.remove('visible');
  state.socket?.emit('screen-share-stopped');
  showNotification('Screen sharing stopped', 'info');
}

function toggleHand() {
  state.handRaised = !state.handRaised;
  $('btn-hand').classList.toggle('active', state.handRaised);
  $('local-hand').classList.toggle('visible', state.handRaised);
  state.socket?.emit('raise-hand', { raised: state.handRaised });
  if (state.handRaised) showNotification('Hand raised — others can see it', 'info');
}

function toggleSidebar() {
  state.sidebarOpen = !state.sidebarOpen;
  const sidebar = $('sidebar');
  sidebar.classList.toggle('open', state.sidebarOpen);
  $('btn-chat').classList.toggle('active', state.sidebarOpen);
  if (state.sidebarOpen && state.sidebarTab === 'chat') {
    state.unreadCount = 0; updateUnread();
    scrollChatBottom();
  }
  if (state.sidebarOpen && state.sidebarTab === 'participants') updateParticipantsList();
}

// ─── CHAT ──────────────────────────────────────────────────────────────────
function sendChat() {
  const input = $('chat-input');
  const msg = input.value.trim();
  if (!msg) return;
  state.socket?.emit('chat-message', { message: msg });
  input.value = '';
  input.style.height = 'auto';
}

function addChatMessage({ from, displayName, message, timestamp, own }) {
  const container = $('chat-messages');
  if (!container) return;

  // Remove empty state
  const empty = container.querySelector('.empty-state');
  if (empty) empty.remove();

  const div = document.createElement('div');
  div.className = `chat-message ${own ? 'own' : ''}`;
  div.innerHTML = `
    <div class="chat-message-header">
      <span class="chat-message-name" style="color:${own ? 'var(--accent)' : getAvatarGradient(displayName).includes('#') ? 'var(--text-primary)' : 'var(--accent-2)'}">${displayName}</span>
      <span class="chat-message-time">${formatChatTime(timestamp)}</span>
    </div>
    <div class="chat-message-text">${escapeHtml(message)}</div>
  `;
  container.appendChild(div);
  scrollChatBottom();
  state.chatMessages.push({ from, displayName, message, timestamp, own });
}

function scrollChatBottom() {
  const c = $('chat-messages');
  if (c) c.scrollTop = c.scrollHeight;
}

function updateUnread() {
  const badge = $('unread-badge');
  if (!badge) return;
  badge.textContent = state.unreadCount;
  badge.classList.toggle('hidden', state.unreadCount === 0);
  $('btn-chat').classList.toggle('active', state.unreadCount > 0 || state.sidebarOpen);
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>');
}

// ─── PARTICIPANTS LIST ────────────────────────────────────────────────────
function updateParticipantsList() {
  const list = $('participants-list');
  if (!list) return;
  list.innerHTML = '';

  // Local
  const localItem = document.createElement('div');
  localItem.className = 'participant-item';
  localItem.innerHTML = `
    <div class="participant-avatar-sm" style="background:${getAvatarGradient(state.displayName)}">${getInitials(state.displayName)}</div>
    <div class="participant-name">${state.displayName} <span class="participant-you-tag">(You)</span></div>
    <div class="participant-media-badges">
      <span class="pmb ${state.micOn ? 'active' : ''}">${state.micOn ? '🎙️' : '🔇'}</span>
      <span class="pmb ${state.cameraOn ? 'active' : ''}">📷</span>
    </div>
  `;
  list.appendChild(localItem);

  // Remotes
  state.peers.forEach((info, socketId) => {
    const item = document.createElement('div');
    item.className = 'participant-item';
    item.innerHTML = `
      <div class="participant-avatar-sm" style="background:${getAvatarGradient(info.displayName)}">${getInitials(info.displayName)}</div>
      <div class="participant-name">${info.displayName}</div>
      <div class="participant-media-badges">
        <span class="pmb ${info.audioOn !== false ? 'active' : ''}">${info.audioOn !== false ? '🎙️' : '🔇'}</span>
        <span class="pmb ${info.videoOn !== false ? 'active' : ''}">📷</span>
        ${info.handRaised ? '<span class="pmb active">✋</span>' : ''}
      </div>
    `;
    list.appendChild(item);
  });
}

// ─── REACTIONS ────────────────────────────────────────────────────────────
function sendReaction(emoji) {
  state.socket?.emit('reaction', { emoji });
  showReactionOnTile('tile-local', emoji);
  state.reactionsOpen = false;
  $('reactions-popup').classList.remove('open');
  $('btn-reactions').classList.remove('active');
}

function showReactionOnTile(tileId, emoji) {
  const tile = $(tileId);
  if (!tile) return;
  const el = document.createElement('div');
  el.className = 'reaction-overlay';
  el.textContent = emoji;
  tile.appendChild(el);
  setTimeout(() => el.remove(), 2100);
}

// ─── END CALL ─────────────────────────────────────────────────────────────
function endCall(silent = false) {
  clearInterval(state.timerInterval);
  state.localStream?.getTracks().forEach(t => t.stop());
  state.screenStream?.getTracks().forEach(t => t.stop());
  state.pcManager?.closeAll();
  state.audioAnalyzer.detachAll();
  state.socket?.disconnect();

  // Reset state
  Object.assign(state, {
    localStream: null, screenStream: null, roomId: null, peerId: null,
    peers: new Map(), chatMessages: [], unreadCount: 0, sidebarOpen: false,
    micOn: true, cameraOn: true, screenSharing: false, handRaised: false
  });

  room.style.display = 'none';
  room.innerHTML = '';
  lobby.style.display = 'flex';
  if (!silent) showNotification('You left the meeting', 'info');
}

export function init() {
  renderLobby();
}