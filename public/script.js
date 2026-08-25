/**
 * ScreenShare Live - Multi-Engine Screen Sharing & Streaming Platform
 * Dual Engine: Turbo WebSocket Canvas Stream (100% Anti-Black-Screen) + WebRTC P2P Mesh
 * Supports: Entire Screen, Application Windows, Browser Tabs, Webcam & Live Audio
 */

(function () {
  'use strict';

  // =========================================================================
  // Configurações e Estado Global
  // =========================================================================

  const RTC_CONFIG = {
    sdpSemantics: 'unified-plan',
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      {
        urls: [
          'turn:openrelay.metered.ca:80',
          'turn:openrelay.metered.ca:443',
          'turn:openrelay.metered.ca:443?transport=tcp'
        ],
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ],
    iceCandidatePoolSize: 10
  };

  const MQTT_BROKERS = [
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://broker.emqx.io:8084/mqtt',
    'wss://test.mosquitto.org:8081'
  ];

  const state = {
    myPeerId: null,
    roomId: null,
    userName: '',
    
    // Transmissão
    isSharingScreen: false,
    currentSharingMode: 'turbo', // 'turbo' (WebSocket Canvas) | 'webrtc'
    streamQuality: '720p',      // '1080p' | '720p' | '480p'
    streamFps: 30,              // 15 | 30 | 60
    
    // Mídias
    isMicActive: false,
    isRemoteAudioMuted: false,
    globalVolume: 1.0,
    userHasInteracted: false,
    focusedStreamId: null,

    localScreenStream: null,
    localMicStream: null,

    // Turbo Streaming Engine (Canvas / WebSocket Frame Capture)
    turboCaptureTimer: null,
    turboCaptureVideo: null,
    turboCaptureCanvas: null,
    turboCaptureCtx: null,
    turboAudioRecorder: null,

    // WebRTC Engine
    peerConnections: new Map(),
    makingOffer: new Map(),
    ignoreOffer: new Map(),
    pendingCandidates: new Map(),
    remoteStreams: new Map(),

    // Visualizadores Remotos Turbo: Map<senderId, { canvas, ctx, lastFrameTime, fpsCalc, audioContext, ... }>
    remoteTurboViewers: new Map(),

    // Conexões de Rede (Socket.IO prioritário com Fallback para MQTT)
    transportType: 'none', // 'socket.io' | 'mqtt'
    socket: null,
    mqttClient: null,
    mqttConnected: false,
    currentBrokerIndex: 0,
    heartbeatTimer: null,
    cleanupTimer: null,

    // Membros na sala: Map<id, { id, name, isSharing, streamMode, lastSeen }>
    members: new Map(),

    // UI
    isSidebarOpen: false,
    currentTab: 'chat',
    unreadMessages: 0
  };

  // Elementos do DOM
  const dom = {
    // Lobby
    lobbyModal: document.getElementById('lobby-modal'),
    userNameInput: document.getElementById('user-name-input'),
    roomCodeInput: document.getElementById('room-code-input'),
    btnCreateRoom: document.getElementById('btn-create-room'),
    btnJoinRoom: document.getElementById('btn-join-room'),

    // Modal de Seleção de Modo
    shareModeModal: document.getElementById('share-mode-modal'),
    btnCloseShareModeModal: document.getElementById('btn-close-share-mode-modal'),
    btnCancelShareModal: document.getElementById('btn-cancel-share-modal'),
    btnConfirmStartShare: document.getElementById('btn-confirm-start-share'),
    selectStreamQuality: document.getElementById('select-stream-quality'),
    selectStreamFps: document.getElementById('select-stream-fps'),
    modeOptionCards: document.querySelectorAll('.mode-option-card'),

    // Room
    roomContainer: document.getElementById('room-container'),
    headerRoomId: document.getElementById('header-room-id'),
    btnCopyLink: document.getElementById('btn-copy-link'),
    btnHeaderStopShare: document.getElementById('btn-header-stop-share'),
    sharingActiveBar: document.getElementById('sharing-active-bar'),
    btnBannerStopShare: document.getElementById('btn-banner-stop-share'),
    connectionStatusText: document.getElementById('connection-status-text'),
    btnToggleParticipants: document.getElementById('btn-toggle-participants'),
    participantCountBadge: document.getElementById('participant-count-badge'),
    btnToggleChat: document.getElementById('btn-toggle-chat'),
    chatUnreadBadge: document.getElementById('chat-unread-badge'),
    btnLeaveRoom: document.getElementById('btn-leave-room'),

    // Video Grid
    emptyState: document.getElementById('empty-state'),
    btnEmptyStartShare: document.getElementById('btn-empty-start-share'),
    btnEmptyCopy: document.getElementById('btn-empty-copy'),
    videoGrid: document.getElementById('video-grid'),

    // Controls
    btnToggleScreenShare: document.getElementById('btn-toggle-screen-share'),
    iconShare: document.getElementById('icon-share'),
    textShare: document.getElementById('text-share'),
    btnToggleMic: document.getElementById('btn-toggle-mic'),
    iconMic: document.getElementById('icon-mic'),
    btnToggleAudioMute: document.getElementById('btn-toggle-audio-mute'),
    iconVolume: document.getElementById('icon-volume'),
    globalVolumeSlider: document.getElementById('global-volume-slider'),
    globalVolumeText: document.getElementById('global-volume-text'),
    btnToggleLayout: document.getElementById('btn-toggle-layout'),
    btnFullscreenAll: document.getElementById('btn-fullscreen-all'),

    // Sidebar
    sidebar: document.getElementById('sidebar'),
    btnCloseSidebar: document.getElementById('btn-close-sidebar'),
    tabChat: document.getElementById('tab-chat'),
    tabUsers: document.getElementById('tab-users'),
    tabUsersCount: document.getElementById('tab-users-count'),
    panelChat: document.getElementById('panel-chat'),
    panelUsers: document.getElementById('panel-users'),
    chatMessages: document.getElementById('chat-messages'),
    chatForm: document.getElementById('chat-form'),
    chatInput: document.getElementById('chat-input'),
    participantsList: document.getElementById('participants-list'),

    // Toasts
    toastContainer: document.getElementById('toast-container')
  };

  // =========================================================================
  // Inicialização da Aplicação
  // =========================================================================

  function init() {
    if (window.lucide) {
      window.lucide.createIcons();
    }

    const savedName = localStorage.getItem('screenshare_username');
    if (savedName) {
      dom.userNameInput.value = savedName;
    }

    // Desbloqueio global do áudio do navegador na primeira interação
    const unlockAudio = () => {
      state.userHasInteracted = true;
      tryUnmuteAllAudio();
      document.removeEventListener('click', unlockAudio);
      document.removeEventListener('keydown', unlockAudio);
      document.removeEventListener('touchstart', unlockAudio);
    };
    document.addEventListener('click', unlockAudio, { passive: true });
    document.addEventListener('keydown', unlockAudio, { passive: true });
    document.addEventListener('touchstart', unlockAudio, { passive: true });

    // Verificar se há sala na URL
    const urlParams = new URLSearchParams(window.location.search);
    let roomIdFromUrl = urlParams.get('room');

    if (!roomIdFromUrl) {
      const pathMatch = window.location.pathname.match(/\/room\/([a-zA-Z0-9_-]+)/);
      if (pathMatch && pathMatch[1]) {
        roomIdFromUrl = pathMatch[1];
      }
    }

    if (roomIdFromUrl) {
      dom.roomCodeInput.value = roomIdFromUrl;
      if (savedName) {
        joinRoom(roomIdFromUrl, savedName);
      } else {
        dom.userNameInput.focus();
      }
    }

    setupEventListeners();
  }

  // =========================================================================
  // Event Listeners
  // =========================================================================

  function setupEventListeners() {
    dom.btnCreateRoom.addEventListener('click', handleCreateRoom);
    dom.btnJoinRoom.addEventListener('click', handleJoinRoom);

    dom.roomCodeInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleJoinRoom();
    });
    dom.userNameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (dom.roomCodeInput.value.trim()) {
          handleJoinRoom();
        } else {
          handleCreateRoom();
        }
      }
    });

    dom.btnCopyLink.addEventListener('click', copyRoomLink);
    dom.btnEmptyCopy.addEventListener('click', copyRoomLink);
    dom.btnEmptyStartShare.addEventListener('click', openShareModeModal);
    dom.btnToggleScreenShare.addEventListener('click', handleShareButtonClick);

    // Modal de Seleção de Modo
    if (dom.btnCloseShareModeModal) {
      dom.btnCloseShareModeModal.addEventListener('click', closeShareModeModal);
    }
    if (dom.btnCancelShareModal) {
      dom.btnCancelShareModal.addEventListener('click', closeShareModeModal);
    }
    if (dom.btnConfirmStartShare) {
      dom.btnConfirmStartShare.addEventListener('click', handleConfirmStartShare);
    }

    dom.modeOptionCards.forEach(card => {
      card.addEventListener('click', () => {
        dom.modeOptionCards.forEach(c => c.classList.remove('active'));
        card.classList.add('active');
        const radio = card.querySelector('input[type="radio"]');
        if (radio) radio.checked = true;
      });
    });

    dom.btnLeaveRoom.addEventListener('click', leaveRoom);
    if (dom.btnHeaderStopShare) {
      dom.btnHeaderStopShare.addEventListener('click', stopScreenSharing);
    }
    if (dom.btnBannerStopShare) {
      dom.btnBannerStopShare.addEventListener('click', stopScreenSharing);
    }

    dom.btnToggleMic.addEventListener('click', toggleMicrophone);
    dom.btnToggleAudioMute.addEventListener('click', toggleRemoteAudioMute);
    if (dom.globalVolumeSlider) {
      dom.globalVolumeSlider.addEventListener('input', handleGlobalVolumeChange);
    }
    dom.btnToggleLayout.addEventListener('click', toggleGridLayout);
    dom.btnFullscreenAll.addEventListener('click', toggleFullScreen);

    dom.btnToggleChat.addEventListener('click', () => toggleSidebar('chat'));
    dom.btnToggleParticipants.addEventListener('click', () => toggleSidebar('users'));
    dom.btnCloseSidebar.addEventListener('click', () => closeSidebar());

    dom.tabChat.addEventListener('click', () => switchSidebarTab('chat'));
    dom.tabUsers.addEventListener('click', () => switchSidebarTab('users'));

    dom.chatForm.addEventListener('submit', handleSendChatMessage);

    window.addEventListener('beforeunload', () => leaveRoomSilently());
    window.addEventListener('pagehide', () => leaveRoomSilently());
  }

  // =========================================================================
  // Gerenciamento de Salas
  // =========================================================================

  function generateRoomId() {
    const adjectives = ['turbo', 'live', 'fast', 'hd', 'view', 'flow', 'hub', 'pro'];
    const nouns = ['room', 'desk', 'cast', 'space', 'zone', 'grid', 'team', 'sync'];
    const num = Math.floor(100 + Math.random() * 900);
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    return `${adj}-${noun}-${num}`;
  }

  function handleCreateRoom() {
    const userName = dom.userNameInput.value.trim() || `Participante-${Math.floor(1000 + Math.random() * 9000)}`;
    localStorage.setItem('screenshare_username', userName);
    const newRoomId = generateRoomId();
    joinRoom(newRoomId, userName);
  }

  function handleJoinRoom() {
    const rawCode = dom.roomCodeInput.value.trim();
    const userName = dom.userNameInput.value.trim() || `Participante-${Math.floor(1000 + Math.random() * 9000)}`;

    if (!rawCode) {
      showToast('Por favor, informe o código da sala.', 'danger');
      dom.roomCodeInput.focus();
      return;
    }

    let roomId = rawCode;
    try {
      if (rawCode.includes('?room=')) {
        const parsed = new URL(rawCode);
        roomId = parsed.searchParams.get('room') || rawCode;
      }
    } catch (e) {}

    localStorage.setItem('screenshare_username', userName);
    joinRoom(roomId, userName);
  }

  function joinRoom(roomId, userName) {
    state.roomId = sanitizeRoomId(roomId);
    state.userName = userName;
    state.myPeerId = 'usr_' + Math.random().toString(36).substring(2, 9);

    const newUrl = `${window.location.origin}/?room=${encodeURIComponent(state.roomId)}`;
    window.history.pushState({ path: newUrl }, '', newUrl);

    dom.headerRoomId.textContent = state.roomId;
    dom.lobbyModal.classList.add('hidden');
    dom.roomContainer.classList.remove('hidden');

    state.members.set(state.myPeerId, {
      id: state.myPeerId,
      name: state.userName,
      isSharing: false,
      streamMode: 'turbo',
      lastSeen: Date.now()
    });
    updateParticipantsUI();

    initNetworking();

    showToast(`Conectado à sala: ${state.roomId}`, 'info');
  }

  function sanitizeRoomId(id) {
    return id.toLowerCase().replace(/[^a-z0-9_-]/g, '-').substring(0, 30);
  }

  // =========================================================================
  // Conexão de Rede Híbrida (Socket.IO Prioritário + Fallback MQTT)
  // =========================================================================

  function initNetworking() {
    dom.connectionStatusText.textContent = 'Conectando rede...';

    // 1. Tenta Socket.IO nativo do nosso servidor Express
    if (window.io) {
      console.log('[Network] Inicializando conexão Socket.IO...');
      initSocketIo();
    } else {
      console.log('[Network] Socket.IO não disponível, utilizando fallback MQTT...');
      initMqttSignaling();
    }
  }

  function initSocketIo() {
    try {
      const socket = window.io({
        transports: ['websocket', 'polling'],
        timeout: 10000
      });

      socket.on('connect', () => {
        state.transportType = 'socket.io';
        state.socket = socket;
        dom.connectionStatusText.textContent = '⚡ Turbo Conectado';
        console.log('[Socket.IO] Conectado com ID:', socket.id);

        socket.emit('join-room', {
          roomId: state.roomId,
          userName: state.userName
        });

        startHeartbeat();
      });

      socket.on('room-joined', ({ self, users }) => {
        console.log('[Socket.IO] Entrou na sala. Usuários existentes:', users);
        users.forEach(u => {
          state.members.set(u.id, {
            id: u.id,
            name: u.name,
            isSharing: !!u.isSharing,
            streamMode: u.streamMode || 'turbo',
            lastSeen: Date.now()
          });
          if (u.isSharing && u.streamMode === 'turbo') {
            socket.emit('request-keyframe', { targetId: u.id });
          } else if (u.isSharing && u.streamMode === 'webrtc') {
            getOrCreatePeerConnection(u.id);
          }
        });
        updateParticipantsUI();
      });

      socket.on('user-joined', (user) => {
        state.members.set(user.id, {
          id: user.id,
          name: user.name,
          isSharing: !!user.isSharing,
          streamMode: user.streamMode || 'turbo',
          lastSeen: Date.now()
        });
        updateParticipantsUI();
        showToast(`${user.name} entrou na sala`, 'info');

        if (state.isSharingScreen) {
          socket.emit('sharing-status', {
            isSharing: true,
            mode: state.currentSharingMode,
            fps: state.streamFps
          });
        }
      });

      socket.on('user-sharing-status', ({ userId, userName, isSharing, mode }) => {
        const member = state.members.get(userId);
        if (member) {
          member.isSharing = isSharing;
          member.streamMode = mode || 'turbo';
          updateParticipantsUI();
        }

        if (!isSharing) {
          handleRemoteStreamEnded(userId);
          showToast(`${userName || 'Participante'} finalizou a transmissão.`, 'info');
        } else {
          showToast(`${userName || 'Participante'} iniciou transmissão (${mode === 'turbo' ? 'Modo Turbo' : 'WebRTC'}).`, 'info');
          if (mode === 'turbo') {
            renderTurboViewerCard(userId, userName || 'Participante');
            socket.emit('request-keyframe', { targetId: userId });
          } else {
            getOrCreatePeerConnection(userId);
          }
        }
      });

      // Recepção de Frames de Vídeo Turbo (100% Anti-Tela Preta)
      socket.on('stream-frame', (data) => {
        handleIncomingTurboFrame(data);
      });

      // Recepção de Áudio Turbo
      socket.on('stream-audio-chunk', (data) => {
        handleIncomingTurboAudio(data);
      });

      // Pedido de frame imediato
      socket.on('request-keyframe', () => {
        if (state.isSharingScreen && state.currentSharingMode === 'turbo') {
          captureAndSendTurboFrame(true);
        }
      });

      // WebRTC Signaling
      socket.on('signal-offer', async ({ callerId, userName, offer }) => {
        await handleReceiveOffer(callerId, offer);
      });

      socket.on('signal-answer', async ({ responderId, answer }) => {
        await handleReceiveAnswer(responderId, answer);
      });

      socket.on('ice-candidate', async ({ senderId, candidate }) => {
        await handleReceiveIceCandidate(senderId, candidate);
      });

      socket.on('new-chat-message', (msg) => {
        appendChatMessage(msg);
      });

      socket.on('user-left', ({ userId, userName }) => {
        handlePeerLeft(userId);
      });

      socket.on('connect_error', (err) => {
        console.warn('[Socket.IO] Erro de conexão, tentando fallback MQTT:', err);
        if (!state.mqttConnected) {
          initMqttSignaling();
        }
      });

      socket.on('disconnect', () => {
        dom.connectionStatusText.textContent = 'Reconectando...';
      });

    } catch (e) {
      console.warn('[Socket.IO] Exceção ao conectar:', e);
      initMqttSignaling();
    }
  }

  function initMqttSignaling() {
    if (state.mqttClient) {
      try { state.mqttClient.end(true); } catch (e) {}
      state.mqttClient = null;
    }

    if (!window.mqtt) return;

    const brokerUrl = MQTT_BROKERS[state.currentBrokerIndex % MQTT_BROKERS.length];
    console.log(`[MQTT] Conectando ao broker (${brokerUrl})...`);

    const clientId = `ssl_${state.myPeerId}_${Math.random().toString(16).substring(2, 8)}`;
    const client = window.mqtt.connect(brokerUrl, {
      clientId,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 3000,
      keepalive: 30
    });

    const topics = {
      broadcast: `ssl_v3/${state.roomId}/bc`,
      direct: `ssl_v3/${state.roomId}/p/${state.myPeerId}`,
      frames: `ssl_v3/${state.roomId}/frames`
    };

    client.on('connect', () => {
      state.transportType = 'mqtt';
      state.mqttConnected = true;
      state.mqttClient = client;
      dom.connectionStatusText.textContent = 'MQTT P2P Online';

      client.subscribe([topics.broadcast, topics.direct, topics.frames], { qos: 0 }, (err) => {
        if (!err) {
          publishToRoom('join', {
            peerId: state.myPeerId,
            name: state.userName,
            isSharing: state.isSharingScreen,
            mode: state.currentSharingMode
          });
          startHeartbeat();
        }
      });
    });

    client.on('message', (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        if (payload.type === 'turbo-frame') {
          handleIncomingTurboFrame(payload);
        } else if (payload.type === 'turbo-audio') {
          handleIncomingTurboAudio(payload);
        } else {
          handleSignalingMessage(payload);
        }
      } catch (err) {}
    });

    client.on('error', () => {
      if (state.currentBrokerIndex < MQTT_BROKERS.length - 1) {
        state.currentBrokerIndex++;
        setTimeout(() => initMqttSignaling(), 1500);
      }
    });
  }

  function publishToRoom(type, data = {}) {
    if (state.transportType === 'socket.io' && state.socket && state.socket.connected) {
      if (type === 'sharing-status') {
        state.socket.emit('sharing-status', data);
      } else if (type === 'chat') {
        state.socket.emit('send-chat-message', data);
      }
    } else if (state.mqttClient && state.mqttConnected) {
      const topic = `ssl_v3/${state.roomId}/bc`;
      state.mqttClient.publish(topic, JSON.stringify({
        type,
        senderId: state.myPeerId,
        senderName: state.userName,
        ...data
      }), { qos: 0 });
    }
  }

  function sendDirectToPeer(targetPeerId, type, data = {}) {
    if (state.transportType === 'socket.io' && state.socket && state.socket.connected) {
      if (type === 'offer') {
        state.socket.emit('signal-offer', { targetId: targetPeerId, offer: data.sdp });
      } else if (type === 'answer') {
        state.socket.emit('signal-answer', { targetId: targetPeerId, answer: data.sdp });
      } else if (type === 'candidate') {
        state.socket.emit('ice-candidate', { targetId: targetPeerId, candidate: data.candidate });
      }
    } else if (state.mqttClient && state.mqttConnected) {
      const topic = `ssl_v3/${state.roomId}/p/${targetPeerId}`;
      state.mqttClient.publish(topic, JSON.stringify({
        type,
        senderId: state.myPeerId,
        senderName: state.userName,
        targetPeerId,
        ...data
      }), { qos: 0 });
    }
  }

  function startHeartbeat() {
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    if (state.cleanupTimer) clearInterval(state.cleanupTimer);

    state.heartbeatTimer = setInterval(() => {
      publishToRoom('presence', {
        peerId: state.myPeerId,
        name: state.userName,
        isSharing: state.isSharingScreen,
        mode: state.currentSharingMode
      });
    }, 6000);

    state.cleanupTimer = setInterval(() => {
      const now = Date.now();
      state.members.forEach((member, peerId) => {
        if (peerId !== state.myPeerId && now - (member.lastSeen || 0) > 20000) {
          handlePeerLeft(peerId);
        }
      });
    }, 10000);
  }

  // =========================================================================
  // Processamento de Sinalização Geral
  // =========================================================================

  async function handleSignalingMessage(msg) {
    if (!msg || !msg.type || msg.senderId === state.myPeerId) return;
    const senderId = msg.senderId;

    switch (msg.type) {
      case 'join': {
        state.members.set(senderId, {
          id: senderId,
          name: msg.name || 'Participante',
          isSharing: !!msg.isSharing,
          streamMode: msg.mode || 'turbo',
          lastSeen: Date.now()
        });
        updateParticipantsUI();
        showToast(`${msg.name || 'Participante'} entrou na sala`, 'info');

        sendDirectToPeer(senderId, 'welcome', {
          peerId: state.myPeerId,
          name: state.userName,
          isSharing: state.isSharingScreen,
          mode: state.currentSharingMode
        });

        if (msg.isSharing && msg.mode === 'turbo') {
          renderTurboViewerCard(senderId, msg.name);
        }
        break;
      }

      case 'welcome': {
        state.members.set(senderId, {
          id: senderId,
          name: msg.name || 'Participante',
          isSharing: !!msg.isSharing,
          streamMode: msg.mode || 'turbo',
          lastSeen: Date.now()
        });
        updateParticipantsUI();
        if (msg.isSharing && msg.mode === 'turbo') {
          renderTurboViewerCard(senderId, msg.name);
        }
        break;
      }

      case 'presence': {
        const member = state.members.get(senderId);
        if (!member) {
          state.members.set(senderId, {
            id: senderId,
            name: msg.name || 'Participante',
            isSharing: !!msg.isSharing,
            streamMode: msg.mode || 'turbo',
            lastSeen: Date.now()
          });
          updateParticipantsUI();
        } else {
          member.lastSeen = Date.now();
          if (member.isSharing !== !!msg.isSharing) {
            member.isSharing = !!msg.isSharing;
            member.streamMode = msg.mode || 'turbo';
            updateParticipantsUI();
          }
        }
        break;
      }

      case 'offer':
        await handleReceiveOffer(senderId, msg.sdp);
        break;

      case 'answer':
        await handleReceiveAnswer(senderId, msg.sdp);
        break;

      case 'candidate':
        if (msg.candidate) {
          await handleReceiveIceCandidate(senderId, msg.candidate);
        }
        break;

      case 'sharing-status': {
        const member = state.members.get(senderId);
        if (member) {
          member.isSharing = !!msg.isSharing;
          member.streamMode = msg.mode || 'turbo';
          updateParticipantsUI();
        }

        if (!msg.isSharing) {
          handleRemoteStreamEnded(senderId);
          showToast(`${msg.userName || 'Participante'} encerrou a transmissão.`, 'info');
        } else {
          showToast(`${msg.userName || 'Participante'} iniciou transmissão.`, 'info');
          if (msg.mode === 'turbo') {
            renderTurboViewerCard(senderId, msg.userName);
          } else {
            getOrCreatePeerConnection(senderId);
          }
        }
        break;
      }

      case 'chat':
        appendChatMessage(msg);
        break;

      case 'leave':
        handlePeerLeft(senderId);
        break;
    }
  }

  // =========================================================================
  // Modal de Seleção de Modo de Transmissão
  // =========================================================================

  function handleShareButtonClick() {
    if (state.isSharingScreen) {
      stopScreenSharing();
    } else {
      openShareModeModal();
    }
  }

  function openShareModeModal() {
    dom.shareModeModal.classList.remove('hidden');
    if (window.lucide) window.lucide.createIcons();
  }

  function closeShareModeModal() {
    dom.shareModeModal.classList.add('hidden');
  }

  function handleConfirmStartShare() {
    const selectedRadio = document.querySelector('input[name="sharing-engine"]:checked');
    const selectedMode = selectedRadio ? selectedRadio.value : 'turbo';
    const quality = dom.selectStreamQuality.value || '720p';
    const fps = parseInt(dom.selectStreamFps.value, 10) || 30;

    state.currentSharingMode = selectedMode;
    state.streamQuality = quality;
    state.streamFps = fps;

    closeShareModeModal();
    startScreenSharing();
  }

  // =========================================================================
  // Inicialização da Transmissão de Tela / Mídia
  // =========================================================================

  async function startScreenSharing() {
    try {
      let stream = null;

      // Compartilhamento de Tela (getDisplayMedia)
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        showToast('Seu navegador não suporta captura de tela.', 'danger');
        return;
      }

      const videoConstraints = {
        cursor: 'always',
        frameRate: { ideal: state.streamFps, max: state.streamFps }
      };

      if (state.streamQuality === '1080p') {
        videoConstraints.width = { ideal: 1920 };
        videoConstraints.height = { ideal: 1080 };
      } else if (state.streamQuality === '720p') {
        videoConstraints.width = { ideal: 1280 };
        videoConstraints.height = { ideal: 720 };
      } else {
        videoConstraints.width = { ideal: 854 };
        videoConstraints.height = { ideal: 480 };
      }

      try {
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: videoConstraints,
          audio: true
        });
      } catch (err) {
        // Fallback sem restrição de áudio
        stream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' }
        });
      }

      if (!stream) return;

      // Se o microfone local já estiver ligado, acopla a track
      if (state.isMicActive && state.localMicStream) {
        state.localMicStream.getAudioTracks().forEach(t => {
          if (!stream.getAudioTracks().some(st => st.id === t.id)) {
            stream.addTrack(t);
          }
        });
      }

      state.localScreenStream = stream;
      state.isSharingScreen = true;

      const myMember = state.members.get(state.myPeerId);
      if (myMember) {
        myMember.isSharing = true;
        myMember.streamMode = state.currentSharingMode;
      }
      updateParticipantsUI();

      updateShareButtonUI(true);
      renderLocalVideoCard(stream);
      updateVideoGridLayout();

      // Notifica todos na sala
      publishToRoom('sharing-status', {
        userName: state.userName,
        isSharing: true,
        mode: state.currentSharingMode,
        quality: state.streamQuality,
        fps: state.streamFps
      });

      // Inicializa o motor de streaming escolhido
      if (state.currentSharingMode === 'turbo') {
        startTurboCaptureLoop(stream);
      } else {
        // Modo WebRTC
        state.peerConnections.forEach(pc => {
          syncLocalTracksToPeer(pc);
        });
      }

      // Listener de encerramento pelo botão nativo do navegador
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          console.log('[Stream] Transmissão finalizada pelo controle nativo do navegador.');
          stopScreenSharing();
        };
      }

      const modeName = state.currentSharingMode === 'turbo' ? 'Modo Turbo WebSocket (100% Compatível)' : 'Modo WebRTC Direto';
      showToast(`Transmissão iniciada com sucesso no ${modeName}!`, 'success');

    } catch (err) {
      console.warn('[Stream] Erro ao iniciar captura:', err);
      if (err.name !== 'NotAllowedError') {
        showToast(`Erro ao compartilhar: ${err.message}`, 'danger');
      }
      stopScreenSharing();
    }
  }

  // =========================================================================
  // ENGINE TURBO: Captura de Frames e Transmissão WebSocket (Anti-Tela Preta)
  // =========================================================================

  function startTurboCaptureLoop(stream) {
    stopTurboCaptureLoop();

    const video = document.createElement('video');
    video.autoplay = true;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.play().catch(() => {});

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

    state.turboCaptureVideo = video;
    state.turboCaptureCanvas = canvas;
    state.turboCaptureCtx = ctx;

    const intervalMs = Math.round(1000 / state.streamFps);
    const jpegQuality = state.streamQuality === '1080p' ? 0.75 : (state.streamQuality === '720p' ? 0.68 : 0.60);

    let isCapturing = false;

    state.turboCaptureTimer = setInterval(() => {
      if (!state.isSharingScreen || !state.localScreenStream || isCapturing) return;
      if (video.readyState < 2) return;

      isCapturing = true;
      try {
        let width = video.videoWidth || 1280;
        let height = video.videoHeight || 720;

        // Escala para resolução selecionada
        let maxW = 1280;
        if (state.streamQuality === '1080p') maxW = 1920;
        if (state.streamQuality === '480p') maxW = 854;

        if (width > maxW) {
          const ratio = maxW / width;
          width = maxW;
          height = Math.round(height * ratio);
        }

        canvas.width = width;
        canvas.height = height;

        ctx.drawImage(video, 0, 0, width, height);

        const frameData = canvas.toDataURL('image/jpeg', jpegQuality);

        // Envia via Socket.IO ou MQTT
        if (state.transportType === 'socket.io' && state.socket && state.socket.connected) {
          state.socket.emit('stream-frame', {
            frame: frameData,
            width,
            height,
            fps: state.streamFps,
            mode: state.currentSharingMode,
            timestamp: Date.now()
          });
        } else if (state.mqttClient && state.mqttConnected) {
          const topic = `ssl_v3/${state.roomId}/frames`;
          state.mqttClient.publish(topic, JSON.stringify({
            type: 'turbo-frame',
            senderId: state.myPeerId,
            senderName: state.userName,
            frame: frameData,
            width,
            height,
            fps: state.streamFps,
            mode: state.currentSharingMode,
            timestamp: Date.now()
          }), { qos: 0 });
        }
      } catch (err) {
        console.warn('[Turbo Capture] Erro ao extrair quadro:', err);
      } finally {
        isCapturing = false;
      }
    }, intervalMs);

    // Captura e Transmissão de Áudio Turbo em tempo real
    startTurboAudioCapture(stream);
  }

  function captureAndSendTurboFrame(forceImmediate = false) {
    if (!state.turboCaptureVideo || !state.turboCaptureCanvas || !state.turboCaptureCtx) return;
    try {
      const video = state.turboCaptureVideo;
      const canvas = state.turboCaptureCanvas;
      const ctx = state.turboCaptureCtx;

      if (video.readyState >= 2) {
        let width = video.videoWidth || 1280;
        let height = video.videoHeight || 720;
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(video, 0, 0, width, height);
        const frameData = canvas.toDataURL('image/jpeg', 0.7);

        if (state.transportType === 'socket.io' && state.socket && state.socket.connected) {
          state.socket.emit('stream-frame', {
            frame: frameData,
            width,
            height,
            fps: state.streamFps,
            mode: state.currentSharingMode,
            timestamp: Date.now(),
            isKeyframe: true
          });
        }
      }
    } catch (e) {}
  }

  function startTurboAudioCapture(stream) {
    try {
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks || audioTracks.length === 0) return;

      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioCtx.createMediaStreamSource(stream);
      const processor = audioCtx.createScriptProcessor(2048, 1, 1);

      source.connect(processor);
      processor.connect(audioCtx.destination);

      processor.onaudioprocess = (e) => {
        if (!state.isSharingScreen) return;
        const inputData = e.inputBuffer.getChannelData(0);
        // Downsample / Compressão de array float32
        const pcmData = Array.from(inputData);

        if (state.transportType === 'socket.io' && state.socket && state.socket.connected) {
          state.socket.emit('stream-audio-chunk', {
            audio: pcmData,
            sampleRate: audioCtx.sampleRate
          });
        }
      };

      state.turboAudioRecorder = { audioCtx, source, processor };
    } catch (err) {
      console.warn('[Turbo Audio] Não foi possível capturar áudio bruto:', err);
    }
  }

  function stopTurboCaptureLoop() {
    if (state.turboCaptureTimer) {
      clearInterval(state.turboCaptureTimer);
      state.turboCaptureTimer = null;
    }
    if (state.turboCaptureVideo) {
      state.turboCaptureVideo.pause();
      state.turboCaptureVideo.srcObject = null;
      state.turboCaptureVideo = null;
    }
    if (state.turboAudioRecorder) {
      try {
        state.turboAudioRecorder.processor.disconnect();
        state.turboAudioRecorder.source.disconnect();
        state.turboAudioRecorder.audioCtx.close();
      } catch (e) {}
      state.turboAudioRecorder = null;
    }
    state.turboCaptureCanvas = null;
    state.turboCaptureCtx = null;
  }

  // =========================================================================
  // Visualizador Turbo Remoto (Renderização direta em Canvas)
  // =========================================================================

  function renderTurboViewerCard(peerId, peerName) {
    const cardId = `video-card-${peerId}`;
    let card = document.getElementById(cardId);
    const initials = peerName ? peerName.substring(0, 2).toUpperCase() : 'P2';

    if (!card) {
      card = document.createElement('div');
      card.id = cardId;
      card.className = 'video-card';
      card.innerHTML = `
        <canvas id="canvas-${peerId}" class="remote-canvas-viewport"></canvas>
        
        <div class="video-overlay-top">
          <div class="video-user-badge">
            <span class="user-avatar-initials">${initials}</span>
            <span class="video-user-name">${escapeHtml(peerName)}</span>
          </div>
          <div class="video-meta-badges">
            <span class="badge-live"><span class="pulse-dot"></span> AO VIVO</span>
            <span class="badge-mode-turbo"><i data-lucide="zap"></i> TURBO</span>
          </div>
        </div>

        <div class="video-overlay-bottom">
          <div class="video-card-volume-group" title="Volume da Transmissão">
            <button class="video-card-volume-btn" data-action="toggle-card-mute" title="Mutar/Desmutar som">
              <i data-lucide="volume-2"></i>
            </button>
            <input type="range" class="video-card-volume-slider" min="0" max="100" value="${Math.round(state.globalVolume * 100)}">
          </div>

          <button class="video-action-btn" title="Fixar Tela (Foco)" data-action="focus">
            <i data-lucide="pin"></i>
          </button>
          <button class="video-action-btn" title="Tela Cheia" data-action="fullscreen">
            <i data-lucide="maximize"></i>
          </button>
        </div>
      `;

      dom.videoGrid.appendChild(card);

      const canvas = card.querySelector(`#canvas-${peerId}`);
      const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });

      state.remoteTurboViewers.set(peerId, {
        canvas,
        ctx,
        lastFrameTime: Date.now(),
        imageObj: new Image(),
        audioCtx: null
      });

      // Controles do card
      const volBtn = card.querySelector('[data-action="toggle-card-mute"]');
      const volSlider = card.querySelector('.video-card-volume-slider');

      if (volBtn) {
        volBtn.addEventListener('click', () => {
          state.userHasInteracted = true;
          state.isRemoteAudioMuted = !state.isRemoteAudioMuted;
          const icon = volBtn.querySelector('i');
          if (icon) {
            icon.setAttribute('data-lucide', state.isRemoteAudioMuted ? 'volume-x' : 'volume-2');
            if (window.lucide) window.lucide.createIcons();
          }
        });
      }

      if (volSlider) {
        volSlider.addEventListener('input', (e) => {
          state.userHasInteracted = true;
          const val = parseInt(e.target.value, 10);
          state.globalVolume = val / 100;
          state.isRemoteAudioMuted = val === 0;
          const icon = volBtn ? volBtn.querySelector('i') : null;
          if (icon) {
            icon.setAttribute('data-lucide', val === 0 ? 'volume-x' : (val < 50 ? 'volume-1' : 'volume-2'));
            if (window.lucide) window.lucide.createIcons();
          }
        });
      }

      const focusBtn = card.querySelector('[data-action="focus"]');
      if (focusBtn) {
        focusBtn.addEventListener('click', () => toggleFocusStream(cardId));
      }

      const fsBtn = card.querySelector('[data-action="fullscreen"]');
      if (fsBtn) {
        fsBtn.addEventListener('click', () => {
          if (canvas.requestFullscreen) {
            canvas.requestFullscreen();
          } else if (card.requestFullscreen) {
            card.requestFullscreen();
          }
        });
      }
    }

    updateVideoGridLayout();
    if (window.lucide) window.lucide.createIcons();
  }

  function handleIncomingTurboFrame(data) {
    if (!data || !data.senderId || data.senderId === state.myPeerId) return;

    const senderId = data.senderId;
    let viewer = state.remoteTurboViewers.get(senderId);

    if (!viewer) {
      renderTurboViewerCard(senderId, data.senderName || 'Participante');
      viewer = state.remoteTurboViewers.get(senderId);
      if (!viewer) return;
    }

    viewer.lastFrameTime = Date.now();

    const img = viewer.imageObj || new Image();
    img.onload = () => {
      const canvas = viewer.canvas;
      const ctx = viewer.ctx;
      if (canvas.width !== img.width || canvas.height !== img.height) {
        canvas.width = img.width;
        canvas.height = img.height;
      }
      ctx.drawImage(img, 0, 0);
    };
    img.src = data.frame;
  }

  function handleIncomingTurboAudio(data) {
    if (!data || !data.audio || state.isRemoteAudioMuted || !state.userHasInteracted) return;

    try {
      let audioCtx = window._turboAudioContext;
      if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        window._turboAudioContext = audioCtx;
      }

      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const pcmData = data.audio;
      const buffer = audioCtx.createBuffer(1, pcmData.length, data.sampleRate || 44100);
      buffer.copyToChannel(new Float32Array(pcmData), 0);

      const source = audioCtx.createBufferSource();
      source.buffer = buffer;

      const gainNode = audioCtx.createGain();
      gainNode.gain.value = state.globalVolume;

      source.connect(gainNode);
      gainNode.connect(audioCtx.destination);
      source.start();
    } catch (e) {}
  }

  // =========================================================================
  // WebRTC Native Engine (Modo P2P Direto)
  // =========================================================================

  function getOrCreatePeerConnection(peerId) {
    if (state.peerConnections.has(peerId)) {
      const existing = state.peerConnections.get(peerId);
      if (existing.connectionState !== 'closed' && existing.connectionState !== 'failed') {
        return existing;
      }
    }

    console.log(`[WebRTC] Criando RTCPeerConnection para: ${peerId}`);
    const pc = new RTCPeerConnection(RTC_CONFIG);

    state.peerConnections.set(peerId, pc);
    state.makingOffer.set(peerId, false);
    state.ignoreOffer.set(peerId, false);
    state.pendingCandidates.set(peerId, []);

    syncLocalTracksToPeer(pc);

    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer.set(peerId, true);
        await pc.setLocalDescription();
        sendDirectToPeer(peerId, 'offer', { sdp: pc.localDescription });
      } catch (err) {
        console.error(`[WebRTC] Erro onnegotiationneeded com ${peerId}:`, err);
      } finally {
        state.makingOffer.set(peerId, false);
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendDirectToPeer(peerId, 'candidate', { candidate: event.candidate });
      }
    };

    pc.ontrack = (event) => {
      console.log('[WebRTC] Recebeu track remota de:', peerId, event.track.kind);
      let remoteStream = (event.streams && event.streams[0]) ? event.streams[0] : null;

      if (!remoteStream) {
        remoteStream = state.remoteStreams.get(peerId);
        if (!remoteStream) {
          remoteStream = new MediaStream();
          state.remoteStreams.set(peerId, remoteStream);
        }
        if (!remoteStream.getTracks().some(t => t.id === event.track.id)) {
          remoteStream.addTrack(event.track);
        }
      } else {
        state.remoteStreams.set(peerId, remoteStream);
      }

      const member = state.members.get(peerId);
      const peerName = member ? member.name : 'Participante Remoto';

      renderWebRtcVideoCard(peerId, peerName, remoteStream);
      updateVideoGridLayout();

      event.track.onended = () => {
        const curStream = state.remoteStreams.get(peerId);
        if (!curStream || curStream.getVideoTracks().length === 0 || curStream.getVideoTracks().every(t => t.readyState === 'ended')) {
          handleRemoteStreamEnded(peerId);
        }
      };
    };

    return pc;
  }

  function syncLocalTracksToPeer(pc) {
    if (!pc) return;
    const senders = pc.getSenders();

    const activeTracks = [];
    if (state.isSharingScreen && state.localScreenStream) {
      state.localScreenStream.getTracks().forEach(t => activeTracks.push(t));
    }
    if (state.isMicActive && state.localMicStream) {
      state.localMicStream.getTracks().forEach(t => {
        if (!activeTracks.some(at => at.id === t.id)) activeTracks.push(t);
      });
    }

    activeTracks.forEach(track => {
      const hasSender = senders.some(s => s.track && s.track.id === track.id);
      if (!hasSender) {
        const stream = state.localScreenStream || state.localMicStream;
        pc.addTrack(track, stream);
      }
    });

    senders.forEach(sender => {
      if (sender.track && !activeTracks.some(t => t.id === sender.track.id)) {
        try { pc.removeTrack(sender); } catch (e) {}
      }
    });
  }

  async function handleReceiveOffer(senderId, sdp) {
    const pc = getOrCreatePeerConnection(senderId);
    const isPolite = state.myPeerId > senderId;
    const isMakingOffer = state.makingOffer.get(senderId) || false;
    const offerCollision = isMakingOffer || pc.signalingState !== 'stable';
    const ignoreOffer = !isPolite && offerCollision;

    state.ignoreOffer.set(senderId, ignoreOffer);
    if (ignoreOffer) return;

    try {
      if (offerCollision) {
        await pc.setLocalDescription({ type: 'rollback' });
      }
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      flushPendingIceCandidates(senderId, pc);

      await pc.setLocalDescription(await pc.createAnswer());
      sendDirectToPeer(senderId, 'answer', { sdp: pc.localDescription });
    } catch (err) {
      console.error('[WebRTC] Erro ao responder SDP Offer:', err);
    }
  }

  async function handleReceiveAnswer(senderId, sdp) {
    const pc = state.peerConnections.get(senderId);
    if (!pc) return;
    try {
      if (pc.signalingState === 'have-local-offer') {
        await pc.setRemoteDescription(new RTCSessionDescription(sdp));
        flushPendingIceCandidates(senderId, pc);
      }
    } catch (err) {}
  }

  async function handleReceiveIceCandidate(senderId, candidate) {
    const pc = state.peerConnections.get(senderId);
    if (!pc || !pc.remoteDescription || !pc.remoteDescription.type) {
      const list = state.pendingCandidates.get(senderId) || [];
      list.push(candidate);
      state.pendingCandidates.set(senderId, list);
      return;
    }
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {}
  }

  function flushPendingIceCandidates(peerId, pc) {
    const list = state.pendingCandidates.get(peerId) || [];
    list.forEach(async (cand) => {
      try { await pc.addIceCandidate(new RTCIceCandidate(cand)); } catch (e) {}
    });
    state.pendingCandidates.set(peerId, []);
  }

  // =========================================================================
  // Renderização e Controles de Vídeo / Áudio
  // =========================================================================

  function renderLocalVideoCard(stream) {
    let card = document.getElementById('video-card-local');
    if (!card) {
      card = document.createElement('div');
      card.id = 'video-card-local';
      card.className = 'video-card local-user';
      card.innerHTML = `
        <video id="local-video" autoplay playsinline muted></video>
        
        <div class="video-overlay-top">
          <div class="video-user-badge">
            <span class="user-avatar-initials">VC</span>
            <span class="video-user-name">${escapeHtml(state.userName)} (Sua Transmissão)</span>
          </div>
          <div class="video-meta-badges">
            <span class="badge-live"><span class="pulse-dot"></span> AO VIVO</span>
            <span class="${state.currentSharingMode === 'turbo' ? 'badge-mode-turbo' : 'badge-mode-webrtc'}">
              <i data-lucide="${state.currentSharingMode === 'turbo' ? 'zap' : 'network'}"></i> 
              ${state.currentSharingMode.toUpperCase()}
            </span>
          </div>
        </div>

        <div class="video-overlay-bottom">
          <button class="video-action-btn btn-stop-local" title="Finalizar Transmissão" id="btn-card-stop-local">
            <i data-lucide="square"></i>
            <span>Finalizar Transmissão</span>
          </button>
          <button class="video-action-btn" title="Tela Cheia" data-action="fullscreen">
            <i data-lucide="maximize"></i>
          </button>
        </div>
      `;

      dom.videoGrid.appendChild(card);

      const stopBtn = card.querySelector('#btn-card-stop-local');
      if (stopBtn) stopBtn.addEventListener('click', stopScreenSharing);

      const fsBtn = card.querySelector('[data-action="fullscreen"]');
      if (fsBtn) {
        fsBtn.addEventListener('click', () => {
          const video = card.querySelector('video');
          if (video.requestFullscreen) video.requestFullscreen();
        });
      }
    }

    const videoEl = card.querySelector('#local-video');
    videoEl.srcObject = stream;
    videoEl.play().catch(() => {});

    if (window.lucide) window.lucide.createIcons();
  }

  function renderWebRtcVideoCard(peerId, peerName, stream) {
    const cardId = `video-card-${peerId}`;
    let card = document.getElementById(cardId);
    const initials = peerName ? peerName.substring(0, 2).toUpperCase() : 'P2';

    if (!card) {
      card = document.createElement('div');
      card.id = cardId;
      card.className = 'video-card';
      card.innerHTML = `
        <video id="video-${peerId}" autoplay playsinline muted></video>
        
        <div class="video-overlay-top">
          <div class="video-user-badge">
            <span class="user-avatar-initials">${initials}</span>
            <span class="video-user-name">${escapeHtml(peerName)}</span>
          </div>
          <div class="video-meta-badges">
            <span class="badge-live"><span class="pulse-dot"></span> AO VIVO</span>
            <span class="badge-mode-webrtc"><i data-lucide="network"></i> WEBRTC</span>
          </div>
        </div>

        <div class="video-overlay-bottom">
          <div class="video-card-volume-group" title="Volume da Transmissão">
            <button class="video-card-volume-btn" data-action="toggle-card-mute" title="Mutar/Desmutar som">
              <i data-lucide="volume-2"></i>
            </button>
            <input type="range" class="video-card-volume-slider" min="0" max="100" value="${Math.round(state.globalVolume * 100)}">
          </div>

          <button class="video-action-btn" title="Fixar Tela (Foco)" data-action="focus">
            <i data-lucide="pin"></i>
          </button>
          <button class="video-action-btn" title="Picture in Picture" data-action="pip">
            <i data-lucide="picture-in-picture-2"></i>
          </button>
          <button class="video-action-btn" title="Tela Cheia" data-action="fullscreen">
            <i data-lucide="maximize"></i>
          </button>
        </div>
      `;

      dom.videoGrid.appendChild(card);

      const video = card.querySelector('video');
      const cardVolBtn = card.querySelector('[data-action="toggle-card-mute"]');
      const cardVolSlider = card.querySelector('.video-card-volume-slider');

      if (cardVolBtn && video) {
        cardVolBtn.addEventListener('click', () => {
          state.userHasInteracted = true;
          video.muted = !video.muted;
          if (!video.muted) {
            video.volume = state.globalVolume;
            video.play().catch(() => {});
          }
          const icon = cardVolBtn.querySelector('i');
          if (icon) {
            icon.setAttribute('data-lucide', video.muted ? 'volume-x' : 'volume-2');
            if (window.lucide) window.lucide.createIcons();
          }
        });
      }

      if (cardVolSlider && video) {
        cardVolSlider.addEventListener('input', (e) => {
          state.userHasInteracted = true;
          const val = parseInt(e.target.value, 10);
          video.volume = val / 100;
          video.muted = val === 0;
          if (val > 0) video.play().catch(() => {});
          const icon = cardVolBtn ? cardVolBtn.querySelector('i') : null;
          if (icon) {
            icon.setAttribute('data-lucide', val === 0 ? 'volume-x' : (val < 50 ? 'volume-1' : 'volume-2'));
            if (window.lucide) window.lucide.createIcons();
          }
        });
      }

      const focusBtn = card.querySelector('[data-action="focus"]');
      if (focusBtn) {
        focusBtn.addEventListener('click', () => toggleFocusStream(cardId));
      }

      const pipBtn = card.querySelector('[data-action="pip"]');
      if (pipBtn) {
        pipBtn.addEventListener('click', async () => {
          try {
            if (document.pictureInPictureElement) {
              await document.exitPictureInPicture();
            } else if (video.requestPictureInPicture) {
              await video.requestPictureInPicture();
            }
          } catch (e) {}
        });
      }

      const fsBtn = card.querySelector('[data-action="fullscreen"]');
      if (fsBtn) {
        fsBtn.addEventListener('click', () => {
          if (video.requestFullscreen) video.requestFullscreen();
        });
      }
    }

    const videoEl = card.querySelector(`#video-${peerId}`);
    videoEl.srcObject = stream;
    videoEl.playsInline = true;
    videoEl.autoplay = true;

    if (state.userHasInteracted && !state.isRemoteAudioMuted) {
      videoEl.muted = false;
      videoEl.volume = state.globalVolume;
    } else {
      videoEl.muted = true;
    }

    videoEl.play().catch(() => {
      videoEl.muted = true;
      videoEl.play().catch(() => {});
    });

    if (window.lucide) window.lucide.createIcons();
  }

  function stopScreenSharing() {
    stopTurboCaptureLoop();

    if (state.localScreenStream) {
      state.localScreenStream.getTracks().forEach(track => {
        try { track.stop(); } catch (e) {}
      });
      state.localScreenStream = null;
    }

    state.isSharingScreen = false;

    const myMember = state.members.get(state.myPeerId);
    if (myMember) myMember.isSharing = false;
    updateParticipantsUI();

    updateShareButtonUI(false);

    publishToRoom('sharing-status', {
      userName: state.userName,
      isSharing: false
    });

    state.peerConnections.forEach(pc => {
      syncLocalTracksToPeer(pc);
    });

    const localCard = document.getElementById('video-card-local');
    if (localCard) localCard.remove();

    updateVideoGridLayout();
    showToast('Transmissão finalizada.', 'info');
  }

  function updateShareButtonUI(isSharing) {
    if (isSharing) {
      dom.btnToggleScreenShare.classList.add('sharing-active');
      dom.iconShare.setAttribute('data-lucide', 'square');
      dom.textShare.textContent = 'Finalizar Transmissão';

      if (dom.btnHeaderStopShare) dom.btnHeaderStopShare.classList.remove('hidden');
      if (dom.sharingActiveBar) dom.sharingActiveBar.classList.remove('hidden');
    } else {
      dom.btnToggleScreenShare.classList.remove('sharing-active');
      dom.iconShare.setAttribute('data-lucide', 'screen-share');
      dom.textShare.textContent = 'Compartilhar Tela';

      if (dom.btnHeaderStopShare) dom.btnHeaderStopShare.classList.add('hidden');
      if (dom.sharingActiveBar) dom.sharingActiveBar.classList.add('hidden');
    }
    if (window.lucide) window.lucide.createIcons();
  }

  function handleRemoteStreamEnded(peerId) {
    state.remoteStreams.delete(peerId);
    state.remoteTurboViewers.delete(peerId);

    const card = document.getElementById(`video-card-${peerId}`);
    if (card) card.remove();

    const member = state.members.get(peerId);
    if (member) member.isSharing = false;

    updateParticipantsUI();
    updateVideoGridLayout();
  }

  function handlePeerLeft(peerId) {
    const member = state.members.get(peerId);
    if (member) {
      showToast(`${member.name} saiu da sala`, 'info');
      state.members.delete(peerId);
    }

    if (state.peerConnections.has(peerId)) {
      try { state.peerConnections.get(peerId).close(); } catch (e) {}
      state.peerConnections.delete(peerId);
    }
    state.makingOffer.delete(peerId);
    state.ignoreOffer.delete(peerId);
    state.pendingCandidates.delete(peerId);

    handleRemoteStreamEnded(peerId);
  }

  function updateVideoGridLayout() {
    const cards = dom.videoGrid.querySelectorAll('.video-card');
    const count = cards.length;

    if (count === 0) {
      dom.emptyState.classList.remove('hidden');
      dom.videoGrid.classList.add('hidden');
    } else {
      dom.emptyState.classList.add('hidden');
      dom.videoGrid.classList.remove('hidden');
      dom.videoGrid.setAttribute('data-count', Math.min(count, 6).toString());
    }
  }

  function toggleFocusStream(cardId) {
    if (state.focusedStreamId === cardId) {
      state.focusedStreamId = null;
      dom.videoGrid.classList.remove('focused-mode');
      const allCards = dom.videoGrid.querySelectorAll('.video-card');
      allCards.forEach(c => c.classList.remove('is-focused'));
    } else {
      state.focusedStreamId = cardId;
      dom.videoGrid.classList.add('focused-mode');
      const allCards = dom.videoGrid.querySelectorAll('.video-card');
      allCards.forEach(c => {
        if (c.id === cardId) {
          c.classList.add('is-focused');
        } else {
          c.classList.remove('is-focused');
        }
      });
    }
  }

  function toggleGridLayout() {
    if (dom.videoGrid.classList.contains('focused-mode')) {
      dom.videoGrid.classList.remove('focused-mode');
      state.focusedStreamId = null;
      dom.videoGrid.querySelectorAll('.video-card').forEach(c => c.classList.remove('is-focused'));
    } else {
      const firstCard = dom.videoGrid.querySelector('.video-card');
      if (firstCard) toggleFocusStream(firstCard.id);
    }
  }

  function toggleFullScreen() {
    if (!document.fullscreenElement) {
      dom.roomContainer.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }

  // =========================================================================
  // Microfone e Controles de Som
  // =========================================================================

  async function toggleMicrophone() {
    if (state.isMicActive) {
      if (state.localMicStream) {
        state.localMicStream.getTracks().forEach(t => t.stop());
        state.localMicStream = null;
      }
      state.isMicActive = false;
      dom.btnToggleMic.classList.remove('active');
      dom.iconMic.setAttribute('data-lucide', 'mic-off');

      state.peerConnections.forEach(pc => syncLocalTracksToPeer(pc));
      showToast('Microfone desligado', 'info');
    } else {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        state.localMicStream = micStream;
        state.isMicActive = true;
        dom.btnToggleMic.classList.add('active');
        dom.iconMic.setAttribute('data-lucide', 'mic');

        state.peerConnections.forEach(pc => syncLocalTracksToPeer(pc));
        showToast('Microfone ativado', 'success');
      } catch (err) {
        showToast('Não foi possível acessar o microfone.', 'danger');
      }
    }
    if (window.lucide) window.lucide.createIcons();
  }

  function toggleRemoteAudioMute() {
    state.isRemoteAudioMuted = !state.isRemoteAudioMuted;

    const remoteVideos = dom.videoGrid.querySelectorAll('video:not(#local-video)');
    remoteVideos.forEach(video => {
      video.muted = state.isRemoteAudioMuted;
      if (!state.isRemoteAudioMuted) {
        video.volume = state.globalVolume;
        video.play().catch(() => {});
      }
    });

    if (state.isRemoteAudioMuted) {
      dom.btnToggleAudioMute.classList.add('active');
      dom.iconVolume.setAttribute('data-lucide', 'volume-x');
      showToast('Áudio de transmissões mutado.', 'info');
    } else {
      dom.btnToggleAudioMute.classList.remove('active');
      dom.iconVolume.setAttribute('data-lucide', state.globalVolume === 0 ? 'volume-x' : (state.globalVolume < 0.5 ? 'volume-1' : 'volume-2'));
      showToast('Áudio de transmissões desmutado.', 'info');
    }
    if (window.lucide) window.lucide.createIcons();
  }

  function handleGlobalVolumeChange(e) {
    const val = parseInt(e.target.value, 10);
    state.globalVolume = val / 100;

    if (dom.globalVolumeText) dom.globalVolumeText.textContent = `${val}%`;

    if (val === 0) {
      state.isRemoteAudioMuted = true;
      dom.btnToggleAudioMute.classList.add('active');
      dom.iconVolume.setAttribute('data-lucide', 'volume-x');
    } else {
      state.isRemoteAudioMuted = false;
      dom.btnToggleAudioMute.classList.remove('active');
      dom.iconVolume.setAttribute('data-lucide', val < 50 ? 'volume-1' : 'volume-2');
    }

    const remoteVideos = dom.videoGrid.querySelectorAll('video:not(#local-video)');
    remoteVideos.forEach(v => {
      v.volume = state.globalVolume;
      v.muted = state.isRemoteAudioMuted;
    });

    if (window.lucide) window.lucide.createIcons();
  }

  function tryUnmuteAllAudio() {
    if (state.isRemoteAudioMuted) return;
    const remoteVideos = dom.videoGrid.querySelectorAll('video:not(#local-video)');
    remoteVideos.forEach(v => {
      v.muted = false;
      v.volume = state.globalVolume;
      v.play().catch(() => {});
    });
  }

  // =========================================================================
  // Sidebar (Chat e Participantes)
  // =========================================================================

  function toggleSidebar(tab = 'chat') {
    if (state.isSidebarOpen && state.currentTab === tab) {
      closeSidebar();
    } else {
      openSidebar(tab);
    }
  }

  function openSidebar(tab = 'chat') {
    state.isSidebarOpen = true;
    dom.sidebar.classList.remove('hidden');
    switchSidebarTab(tab);
    if (tab === 'chat') {
      state.unreadMessages = 0;
      dom.chatUnreadBadge.classList.add('hidden');
      setTimeout(() => dom.chatInput.focus(), 150);
    }
  }

  function closeSidebar() {
    state.isSidebarOpen = false;
    dom.sidebar.classList.add('hidden');
  }

  function switchSidebarTab(tab) {
    state.currentTab = tab;
    if (tab === 'chat') {
      dom.tabChat.classList.add('active');
      dom.tabUsers.classList.remove('active');
      dom.panelChat.classList.add('active');
      dom.panelUsers.classList.remove('active');
      state.unreadMessages = 0;
      dom.chatUnreadBadge.classList.add('hidden');
    } else {
      dom.tabChat.classList.remove('active');
      dom.tabUsers.classList.add('active');
      dom.panelChat.classList.remove('active');
      dom.panelUsers.classList.add('active');
    }
  }

  function handleSendChatMessage(e) {
    e.preventDefault();
    const text = dom.chatInput.value.trim();
    if (!text) return;

    dom.chatInput.value = '';

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const msgData = {
      id: Math.random().toString(36).substring(2, 9),
      senderId: state.myPeerId,
      senderName: state.userName,
      text,
      time
    };

    appendChatMessage(msgData);
    publishToRoom('chat', msgData);
  }

  function appendChatMessage(msg) {
    const isSelf = msg.senderId === state.myPeerId;
    const msgEl = document.createElement('div');
    msgEl.className = `chat-bubble ${isSelf ? 'outgoing' : 'incoming'}`;
    msgEl.innerHTML = `
      <div class="chat-bubble-header">
        <span class="chat-sender-name">${escapeHtml(msg.senderName || 'Participante')}</span>
        <span class="chat-time">${escapeHtml(msg.time || '')}</span>
      </div>
      <div class="chat-bubble-text">${escapeHtml(msg.text)}</div>
    `;

    dom.chatMessages.appendChild(msgEl);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

    if (!state.isSidebarOpen || state.currentTab !== 'chat') {
      if (!isSelf) {
        state.unreadMessages++;
        dom.chatUnreadBadge.classList.remove('hidden');
      }
    }
  }

  function updateParticipantsUI() {
    const count = state.members.size;
    dom.participantCountBadge.textContent = count.toString();
    dom.tabUsersCount.textContent = count.toString();

    dom.participantsList.innerHTML = '';
    state.members.forEach((member, peerId) => {
      const isSelf = peerId === state.myPeerId;
      const initials = (member.name || 'P').substring(0, 2).toUpperCase();

      const li = document.createElement('li');
      li.className = 'participant-item';
      li.innerHTML = `
        <div class="participant-avatar">${initials}</div>
        <div class="participant-info">
          <span class="participant-name">${escapeHtml(member.name)} ${isSelf ? '(Você)' : ''}</span>
          <span class="participant-status">${member.isSharing ? `Transmitindo (${member.streamMode || 'turbo'})` : 'Ouvinte'}</span>
        </div>
        ${member.isSharing ? '<span class="sharing-badge-pill"><span class="pulse-dot"></span> AO VIVO</span>' : ''}
      `;
      dom.participantsList.appendChild(li);
    });
  }

  // =========================================================================
  // Saída da Sala
  // =========================================================================

  function leaveRoomSilently() {
    stopTurboCaptureLoop();

    if (state.localScreenStream) {
      state.localScreenStream.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
    }
    if (state.localMicStream) {
      state.localMicStream.getTracks().forEach(t => {
        try { t.stop(); } catch (e) {}
      });
    }

    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    if (state.cleanupTimer) clearInterval(state.cleanupTimer);

    publishToRoom('leave');

    state.peerConnections.forEach(pc => {
      try { pc.close(); } catch (e) {}
    });
    state.peerConnections.clear();

    if (state.socket) {
      try { state.socket.disconnect(); } catch (e) {}
      state.socket = null;
    }
    if (state.mqttClient) {
      try { state.mqttClient.end(true); } catch (e) {}
      state.mqttClient = null;
    }
  }

  function leaveRoom() {
    leaveRoomSilently();

    state.isSharingScreen = false;
    state.isMicActive = false;
    state.localScreenStream = null;
    state.localMicStream = null;
    state.remoteStreams.clear();
    state.remoteTurboViewers.clear();
    state.members.clear();

    updateShareButtonUI(false);
    if (dom.btnToggleMic) {
      dom.btnToggleMic.classList.remove('active');
      dom.iconMic.setAttribute('data-lucide', 'mic-off');
    }

    dom.videoGrid.innerHTML = '';
    updateVideoGridLayout();

    if (dom.sharingActiveBar) dom.sharingActiveBar.classList.add('hidden');
    if (dom.btnHeaderStopShare) dom.btnHeaderStopShare.classList.add('hidden');

    dom.roomContainer.classList.add('hidden');
    dom.lobbyModal.classList.remove('hidden');

    window.history.pushState({}, '', window.location.pathname);
    showToast('Você saiu da sala.', 'info');
  }

  function copyRoomLink() {
    const inviteUrl = `${window.location.origin}/?room=${encodeURIComponent(state.roomId)}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      showToast('Link copiado para a área de transferência!', 'success');
    }).catch(() => {
      prompt('Copie o link abaixo:', inviteUrl);
    });
  }

  // =========================================================================
  // Notificações Toast e Utilitários
  // =========================================================================

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'danger') iconName = 'alert-circle';

    toast.innerHTML = `
      <i data-lucide="${iconName}"></i>
      <span>${escapeHtml(message)}</span>
    `;

    dom.toastContainer.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(30px) scale(0.95)';
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Inicializa ao carregar a página
  document.addEventListener('DOMContentLoaded', init);

})();
