import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

const PORT = 3000;

// Servir arquivos estáticos da pasta public
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Gerador de ID amigável para salas
function generateRoomId() {
  const adjectives = ['live', 'stream', 'sync', 'view', 'cast', 'flow', 'peer', 'hub'];
  const nouns = ['room', 'desk', 'space', 'zone', 'team', 'share', 'grid', 'lab'];
  const num = Math.floor(100 + Math.random() * 900);
  const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  return `${adj}-${noun}-${num}`;
}

// Rota para gerar novo ID de sala
app.get('/api/create-room', (req, res) => {
  const roomId = generateRoomId();
  res.json({ roomId });
});

// Rota direta para sala (/room/:roomId)
app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Gerenciamento de estado de salas e usuários conectados
// Map: roomId -> Map(socketId -> { id, name, isSharing })
const rooms = new Map();

io.on('connection', (socket) => {
  console.log(`[Socket] Conectado: ${socket.id}`);

  let currentRoom = null;
  let currentUser = null;

  // Usuário entra em uma sala
  socket.on('join-room', ({ roomId, userName }) => {
    if (!roomId) return;

    currentRoom = roomId;
    currentUser = {
      id: socket.id,
      name: userName || `Participante-${socket.id.substring(0, 4)}`,
      isSharing: false,
      joinedAt: Date.now()
    };

    socket.join(roomId);

    if (!rooms.has(roomId)) {
      rooms.set(roomId, new Map());
    }
    const roomUsers = rooms.get(roomId);

    // Lista de usuários existentes na sala antes deste entrar
    const existingUsers = Array.from(roomUsers.values());

    // Registra o novo usuário
    roomUsers.set(socket.id, currentUser);

    console.log(`[Sala ${roomId}] Usuário ${currentUser.name} (${socket.id}) entrou. Total: ${roomUsers.size}`);

    // Envia lista de usuários já presentes para quem acabou de entrar
    socket.emit('room-joined', {
      self: currentUser,
      users: existingUsers,
      roomId: roomId
    });

    // Notifica os demais que um novo usuário entrou
    socket.to(roomId).emit('user-joined', currentUser);

    // Atualiza contagem de participantes para todos na sala
    io.in(roomId).emit('room-users-updated', Array.from(roomUsers.values()));
  });

  // Sinalização WebRTC: Offer
  socket.on('signal-offer', ({ targetId, offer, isScreenShare }) => {
    socket.to(targetId).emit('signal-offer', {
      callerId: socket.id,
      userName: currentUser?.name || 'Participante',
      offer,
      isScreenShare
    });
  });

  // Sinalização WebRTC: Answer
  socket.on('signal-answer', ({ targetId, answer }) => {
    socket.to(targetId).emit('signal-answer', {
      responderId: socket.id,
      answer
    });
  });

  // Sinalização WebRTC: ICE Candidate
  socket.on('ice-candidate', ({ targetId, candidate }) => {
    socket.to(targetId).emit('ice-candidate', {
      senderId: socket.id,
      candidate
    });
  });

  // Atualização de status de compartilhamento de tela
  socket.on('sharing-status', ({ isSharing }) => {
    if (!currentRoom || !rooms.has(currentRoom)) return;

    const roomUsers = rooms.get(currentRoom);
    if (roomUsers.has(socket.id)) {
      const user = roomUsers.get(socket.id);
      user.isSharing = isSharing;
      currentUser.isSharing = isSharing;

      // Transmite a todos na sala
      io.in(currentRoom).emit('user-sharing-status', {
        userId: socket.id,
        userName: user.name,
        isSharing
      });

      io.in(currentRoom).emit('room-users-updated', Array.from(roomUsers.values()));
    }
  });

  // Mensagens do chat da sala
  socket.on('send-chat-message', ({ text }) => {
    if (!currentRoom || !text?.trim()) return;

    const messageData = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: socket.id,
      senderName: currentUser?.name || 'Participante',
      text: text.trim().substring(0, 500),
      time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    io.in(currentRoom).emit('new-chat-message', messageData);
  });

  // Função utilitária para processar saída de usuário da sala
  function handleUserLeave(roomId, socketId) {
    if (!roomId || !rooms.has(roomId)) return;

    const roomUsers = rooms.get(roomId);
    const departingUser = roomUsers.get(socketId);

    if (departingUser) {
      console.log(`[Sala ${roomId}] Usuário ${departingUser.name} (${socketId}) saiu da sala.`);
      
      // Se o usuário estava transmitindo, encerra explicitamente a transmissão para todos
      if (departingUser.isSharing) {
        io.in(roomId).emit('user-sharing-status', {
          userId: socketId,
          userName: departingUser.name,
          isSharing: false
        });
      }

      roomUsers.delete(socketId);

      // Notifica os outros participantes sobre a saída
      socket.to(roomId).emit('user-left', {
        userId: socketId,
        userName: departingUser.name
      });

      // Se a sala ficou vazia, remove da memória
      if (roomUsers.size === 0) {
        rooms.delete(roomId);
        console.log(`[Sala ${roomId}] Sala vazia removida.`);
      } else {
        io.in(roomId).emit('room-users-updated', Array.from(roomUsers.values()));
      }
    }
  }

  // Saída voluntária da sala
  socket.on('leave-room', () => {
    if (currentRoom) {
      socket.leave(currentRoom);
      handleUserLeave(currentRoom, socket.id);
      currentRoom = null;
      currentUser = null;
    }
  });

  // Desconexão
  socket.on('disconnect', () => {
    console.log(`[Socket] Desconectado: ${socket.id}`);
    if (currentRoom) {
      handleUserLeave(currentRoom, socket.id);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`===========================================`);
  console.log(`🚀 ScreenShare Live Server rodando!`);
  console.log(`📡 URL Local: http://localhost:${PORT}`);
  console.log(`===========================================`);
});
