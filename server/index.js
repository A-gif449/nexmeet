// server/index.js — NexMeet Signaling Server
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
  transports: ['websocket', 'polling']
});

// ── CORS for Express routes ────────────────────────────────────────────────
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

const MAX_PARTICIPANTS = 4;
const rooms = new Map();

app.get('/', (_, res) => {
  res.json({
    status: '🚀 NexMeet Signaling Server is running',
    rooms: rooms.size,
    maxParticipantsPerRoom: MAX_PARTICIPANTS
  });
});

app.get('/health', (_, res) => res.json({ status: 'ok', rooms: rooms.size }));

app.get('/create-room', (_, res) => {
  const roomId = uuidv4().slice(0, 8).toUpperCase();
  rooms.set(roomId, new Map());
  res.json({ roomId });
});

io.on('connection', (socket) => {
  console.log(`[+] Socket connected: ${socket.id}`);

  socket.on('join-room', ({ roomId, displayName }) => {
    const room = rooms.get(roomId);
    if (!room) {
      socket.emit('error', { code: 'ROOM_NOT_FOUND', message: 'Room does not exist.' });
      return;
    }
    if (room.size >= MAX_PARTICIPANTS) {
      socket.emit('error', { code: 'ROOM_FULL', message: `This room is full (max ${MAX_PARTICIPANTS} participants).` });
      return;
    }

    const peerId = uuidv4();
    room.set(socket.id, { peerId, displayName: displayName || 'Guest', joinedAt: Date.now() });
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.peerId = peerId;
    socket.data.displayName = displayName || 'Guest';

    const existingPeers = [];
    room.forEach((info, sid) => {
      if (sid !== socket.id) {
        existingPeers.push({ socketId: sid, peerId: info.peerId, displayName: info.displayName });
      }
    });

    socket.emit('room-joined', { roomId, peerId, existingPeers, participantCount: room.size });
    socket.to(roomId).emit('peer-joined', { socketId: socket.id, peerId, displayName: socket.data.displayName });
    console.log(`[Room ${roomId}] ${displayName} joined. Participants: ${room.size}`);
  });

  socket.on('offer', ({ to, offer }) => {
    io.to(to).emit('offer', { from: socket.id, peerId: socket.data.peerId, displayName: socket.data.displayName, offer });
  });

  socket.on('answer', ({ to, answer }) => {
    io.to(to).emit('answer', { from: socket.id, answer });
  });

  socket.on('ice-candidate', ({ to, candidate }) => {
    io.to(to).emit('ice-candidate', { from: socket.id, candidate });
  });

  socket.on('media-state', ({ video, audio }) => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit('peer-media-state', { socketId: socket.id, video, audio });
  });

  socket.on('screen-share-started', () => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit('peer-screen-share', { socketId: socket.id, sharing: true });
  });

  socket.on('screen-share-stopped', () => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit('peer-screen-share', { socketId: socket.id, sharing: false });
  });

  socket.on('chat-message', ({ message }) => {
    const roomId = socket.data.roomId;
    if (!roomId) return;
    io.to(roomId).emit('chat-message', { from: socket.id, displayName: socket.data.displayName, message, timestamp: Date.now() });
  });

  socket.on('raise-hand', ({ raised }) => {
    const roomId = socket.data.roomId;
    if (roomId) socket.to(roomId).emit('peer-raise-hand', { socketId: socket.id, raised });
  });

  socket.on('reaction', ({ emoji }) => {
    const roomId = socket.data.roomId;
    if (roomId) io.to(roomId).emit('peer-reaction', { socketId: socket.id, displayName: socket.data.displayName, emoji });
  });

  socket.on('disconnect', () => {
    const { roomId, displayName } = socket.data;
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId);
      room.delete(socket.id);
      socket.to(roomId).emit('peer-left', { socketId: socket.id });
      console.log(`[Room ${roomId}] ${displayName} left. Remaining: ${room.size}`);
      if (room.size === 0) {
        rooms.delete(roomId);
        console.log(`[Room ${roomId}] Closed (empty)`);
      }
    }
  });
});

const PORT = process.env.PORT || 4000;
httpServer.listen(PORT, () => {
  console.log(`\n🚀 NexMeet Signaling Server running on http://localhost:${PORT}\n`);
});
