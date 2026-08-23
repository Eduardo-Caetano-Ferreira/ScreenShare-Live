/**
 * ScreenShare Live - WebRTC Multi-Peer Screen Sharing Engine
 * Serverless Edition (MQTT Cloud Signaling + Perfect Negotiation WebRTC Mesh)
 * 100% Compatível com Vercel / Servidores Estáticos / Sem Node.js
 */

(function () {
  'use strict';

  // =========================================================================
  // Configurações e Estado Global
  // =========================================================================

  // STUN + TURN Servers públicos de alta disponibilidade e bypass de NAT restritivo
  const RTC_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' },
      { urls: 'stun:stun.cloudflare.com:3478' },
      { urls: 'stun:global.stun.twilio.com:3478' },
      // OpenRelay Public TURN Server (Gratuito para conexões com firewall/NAT simétrico)
      {
        urls: 'turn:openrelay.metered.ca:80',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      },
      {
        urls: 'turn:openrelay.metered.ca:443?transport=tcp',
        username: 'openrelayproject',
        credential: 'openrelayproject'
      }
    ],
    iceCandidatePoolSize: 10
  };

  // Lista de Brokers MQTT WebSocket Públicos e Gratuitos com failover
  const MQTT_BROKERS = [
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://broker.emqx.io:8084/mqtt',
    'wss://test.mosquitto.org:8081'
  ];

  const state = {
    myPeerId: null,          // ID único gerado para esta sessão
    roomId: null,            // ID da sala (ex: dev-team-123)
    userName: '',            // Nome do usuário
    isSharingScreen: false,  // Se está transmitindo tela
    isMicActive: false,      // Se microfone local está ativo
    isRemoteAudioMuted: false, // Se mutou o áudio remoto geral
    globalVolume: 1.0,       // Nível de volume geral (0.0 a 1.0)
    focusedStreamId: null,

    // Mídias Locais
    localScreenStream: null,
    localMicStream: null,

    // Conexões WebRTC Nativas
    peerConnections: new Map(),   // Map<peerId, RTCPeerConnection>
    makingOffer: new Map(),       // Map<peerId, boolean>
    ignoreOffer: new Map(),       // Map<peerId, boolean>
    pendingCandidates: new Map(), // Map<peerId, RTCIceCandidateInit[]>
    remoteStreams: new Map(),      // Map<peerId, MediaStream>

    // Sinalização MQTT
    mqttClient: null,
    mqttConnected: false,
    currentBrokerIndex: 0,
    heartbeatTimer: null,
    cleanupTimer: null,

    // Lista de membros conhecidos na sala: Map<peerId, { id, name, isSharing, lastSeen }>
    members: new Map(),

    // UI State
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

    // Video Section
    emptyState: document.getElementById('empty-state'),
    btnEmptyStartShare: document.getElementById('btn-empty-start-share'),
    btnEmptyCopy: document.getElementById('btn-empty-copy'),
    videoGrid: document.getElementById('video-grid'),

    // Controls Bar
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
  // Inicialização e Verificação de URL
  // =========================================================================

  function init() {
    if (window.lucide) {
      window.lucide.createIcons();
    }

    const savedName = localStorage.getItem('screenshare_username');
    if (savedName) {
      dom.userNameInput.value = savedName;
    }

    // Verificar se existe room ID na URL
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
  // Event Listeners da UI
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
    dom.btnEmptyStartShare.addEventListener('click', toggleScreenSharing);
    dom.btnLeaveRoom.addEventListener('click', leaveRoom);

    if (dom.btnHeaderStopShare) {
      dom.btnHeaderStopShare.addEventListener('click', stopScreenSharing);
    }
    if (dom.btnBannerStopShare) {
      dom.btnBannerStopShare.addEventListener('click', stopScreenSharing);
    }

    dom.btnToggleScreenShare.addEventListener('click', toggleScreenSharing);
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

    // Encerramento limpo ao fechar ou atualizar aba
    window.addEventListener('beforeunload', () => {
      leaveRoomSilently();
    });

    window.addEventListener('pagehide', () => {
      leaveRoomSilently();
    });
  }

  // =========================================================================
  // Gerenciamento de Salas
  // =========================================================================

  function generateRoomId() {
    const adjectives = ['live', 'screen', 'stream', 'fast', 'pro', 'nexus', 'hd', 'cyber'];
    const nouns = ['hub', 'room', 'space', 'cast', 'flow', 'grid', 'zone', 'view'];
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

    // Atualiza a URL sem recarregar a página
    const newUrl = `${window.location.origin}/?room=${encodeURIComponent(state.roomId)}`;
    window.history.pushState({ path: newUrl }, '', newUrl);

    dom.headerRoomId.textContent = state.roomId;
    dom.lobbyModal.classList.add('hidden');
    dom.roomContainer.classList.remove('hidden');

    // Registra a si mesmo na lista de membros locais
    state.members.set(state.myPeerId, {
      id: state.myPeerId,
      name: state.userName,
      isSharing: false,
      lastSeen: Date.now()
    });
    updateParticipantsUI();

    // Inicializa a sinalização WebRTC Serverless via MQTT
    initMqttSignaling();

    showToast(`Entrando na sala: ${state.roomId}`, 'info');
  }

  function sanitizeRoomId(id) {
    return id.toLowerCase().replace(/[^a-z0-9_-]/g, '-').substring(0, 30);
  }

  // =========================================================================
  // Sinalização Serverless via MQTT (Nuvem Pública Resiliente)
  // =========================================================================

  function getTopics(roomId, peerId) {
    return {
      broadcast: `screenshare_live/v1/${roomId}/broadcast`,
      direct: `screenshare_live/v1/${roomId}/peer/${peerId}`
    };
  }

  function initMqttSignaling() {
    dom.connectionStatusText.textContent = 'Conectando rede P2P...';

    if (state.mqttClient) {
      try { state.mqttClient.end(true); } catch (e) {}
      state.mqttClient = null;
    }

    const brokerUrl = MQTT_BROKERS[state.currentBrokerIndex % MQTT_BROKERS.length];
    console.log(`[Signaling] Conectando ao broker MQTT (${brokerUrl})...`);

    if (!window.mqtt) {
      dom.connectionStatusText.textContent = 'Erro de Biblioteca';
      showToast('Erro ao carregar módulo de conexão. Verifique sua internet.', 'danger');
      return;
    }

    const clientId = `ssl_${state.myPeerId}_${Math.random().toString(16).substring(2, 8)}`;
    const client = window.mqtt.connect(brokerUrl, {
      clientId,
      clean: true,
      connectTimeout: 8000,
      reconnectPeriod: 3000,
      keepalive: 30
    });

    const topics = getTopics(state.roomId, state.myPeerId);

    client.on('connect', () => {
      state.mqttConnected = true;
      dom.connectionStatusText.textContent = 'Conectado P2P';
      console.log('[Signaling] Conectado ao broker MQTT com sucesso!');

      // Inscreve no canal de broadcast da sala e no canal direto deste usuário
      client.subscribe([topics.broadcast, topics.direct], { qos: 0 }, (err) => {
        if (!err) {
          console.log('[Signaling] Inscrito nos tópicos da sala:', topics);
          
          // Anuncia entrada para todos na sala
          publishToRoom('join', {
            peerId: state.myPeerId,
            name: state.userName,
            isSharing: state.isSharingScreen
          });

          startHeartbeat();
        }
      });
    });

    client.on('message', (topic, message) => {
      try {
        const payload = JSON.parse(message.toString());
        handleSignalingMessage(payload);
      } catch (err) {
        console.warn('[Signaling] Mensagem com formato inválido recebida:', err);
      }
    });

    client.on('error', (err) => {
      console.warn('[Signaling] Erro no broker MQTT:', err);
      tryFallbackBroker();
    });

    client.on('close', () => {
      state.mqttConnected = false;
      dom.connectionStatusText.textContent = 'Reconectando...';
    });

    state.mqttClient = client;
  }

  function tryFallbackBroker() {
    if (state.currentBrokerIndex < MQTT_BROKERS.length - 1) {
      state.currentBrokerIndex++;
      console.log('[Signaling] Tentando broker alternativo:', MQTT_BROKERS[state.currentBrokerIndex]);
      setTimeout(() => initMqttSignaling(), 1000);
    }
  }

  function publishToRoom(type, data = {}) {
    if (!state.mqttClient || !state.mqttConnected) return;

    const topics = getTopics(state.roomId, state.myPeerId);
    const message = JSON.stringify({
      type,
      senderId: state.myPeerId,
      senderName: state.userName,
      ...data
    });

    state.mqttClient.publish(topics.broadcast, message, { qos: 0 });
  }

  function sendDirectToPeer(targetPeerId, type, data = {}) {
    if (!state.mqttClient || !state.mqttConnected) return;

    const topics = getTopics(state.roomId, targetPeerId);
    const message = JSON.stringify({
      type,
      senderId: state.myPeerId,
      senderName: state.userName,
      targetPeerId,
      ...data
    });

    state.mqttClient.publish(topics.direct, message, { qos: 0 });
  }

  function startHeartbeat() {
    if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
    if (state.cleanupTimer) clearInterval(state.cleanupTimer);

    // Envia presença a cada 6 segundos
    state.heartbeatTimer = setInterval(() => {
      if (state.mqttConnected) {
        publishToRoom('presence', {
          peerId: state.myPeerId,
          name: state.userName,
          isSharing: state.isSharingScreen
        });
      }
    }, 6000);

    // Limpa membros que não enviam ping há mais de 18 segundos
    state.cleanupTimer = setInterval(() => {
      const now = Date.now();
      state.members.forEach((member, peerId) => {
        if (peerId !== state.myPeerId && now - (member.lastSeen || 0) > 18000) {
          console.log('[Signaling] Membro inativo removido:', member.name, peerId);
          handlePeerLeft(peerId);
        }
      });
    }, 10000);
  }

  // =========================================================================
  // Processamento de Mensagens de Sinalização
  // =========================================================================

  async function handleSignalingMessage(msg) {
    if (!msg || !msg.type || msg.senderId === state.myPeerId) return;

    const senderId = msg.senderId;

    switch (msg.type) {
      case 'join': {
        const isNew = !state.members.has(senderId);
        state.members.set(senderId, {
          id: senderId,
          name: msg.name || 'Participante',
          isSharing: !!msg.isSharing,
          lastSeen: Date.now()
        });
        updateParticipantsUI();

        if (isNew) {
          showToast(`${msg.name || 'Novo participante'} entrou na sala`, 'info');
        }

        // Responde de volta para o novo membro com nossos dados
        sendDirectToPeer(senderId, 'welcome', {
          peerId: state.myPeerId,
          name: state.userName,
          isSharing: state.isSharingScreen
        });

        // Garante a criação da conexão WebRTC
        getOrCreatePeerConnection(senderId);
        break;
      }

      case 'welcome': {
        const isNew = !state.members.has(senderId);
        state.members.set(senderId, {
          id: senderId,
          name: msg.name || 'Participante',
          isSharing: !!msg.isSharing,
          lastSeen: Date.now()
        });
        updateParticipantsUI();

        if (isNew) {
          showToast(`${msg.name || 'Participante'} conectado`, 'info');
        }

        // Garante a conexão WebRTC
        getOrCreatePeerConnection(senderId);
        break;
      }

      case 'presence': {
        const existing = state.members.get(senderId);
        if (!existing) {
          state.members.set(senderId, {
            id: senderId,
            name: msg.name || 'Participante',
            isSharing: !!msg.isSharing,
            lastSeen: Date.now()
          });
          updateParticipantsUI();
          getOrCreatePeerConnection(senderId);
        } else {
          existing.lastSeen = Date.now();
          if (existing.isSharing !== !!msg.isSharing) {
            existing.isSharing = !!msg.isSharing;
            updateParticipantsUI();
          }
        }
        break;
      }

      case 'offer': {
        console.log('[WebRTC] Recebeu SDP Offer de:', senderId);
        await handleReceiveOffer(senderId, msg.sdp);
        break;
      }

      case 'answer': {
        console.log('[WebRTC] Recebeu SDP Answer de:', senderId);
        await handleReceiveAnswer(senderId, msg.sdp);
        break;
      }

      case 'candidate': {
        if (msg.candidate) {
          await handleReceiveIceCandidate(senderId, msg.candidate);
        }
        break;
      }

      case 'sharing-status': {
        const member = state.members.get(senderId);
        if (member) {
          member.isSharing = !!msg.isSharing;
          updateParticipantsUI();
        }

        if (!msg.isSharing) {
          handleRemoteStreamEnded(senderId);
          showToast(`${msg.userName || 'Participante'} finalizou a transmissão.`, 'info');
        } else {
          showToast(`${msg.userName || 'Participante'} iniciou compartilhamento de tela.`, 'info');
        }
        break;
      }

      case 'chat': {
        appendChatMessage({
          senderId,
          senderName: msg.senderName,
          text: msg.text,
          time: msg.time
        });
        break;
      }

      case 'leave': {
        handlePeerLeft(senderId);
        break;
      }
    }
  }

  // =========================================================================
  // Gerenciamento de Conexões WebRTC P2P (Perfect Negotiation Pattern)
  // =========================================================================

  function getOrCreatePeerConnection(peerId) {
    if (state.peerConnections.has(peerId)) {
      const existing = state.peerConnections.get(peerId);
      if (existing.connectionState !== 'closed' && existing.connectionState !== 'failed') {
        return existing;
      }
    }

    console.log(`[WebRTC] Criando RTCPeerConnection para peer: ${peerId}`);

    const pc = new RTCPeerConnection(RTC_CONFIG);
    state.peerConnections.set(peerId, pc);
    state.makingOffer.set(peerId, false);
    state.ignoreOffer.set(peerId, false);
    state.pendingCandidates.set(peerId, []);

    // Determina se este peer é "polite" (reversível) com base na ordem dos IDs
    const isPolite = state.myPeerId > peerId;

    // Se já estivermos transmitindo tela ou mic, adiciona as tracks imediatamente
    syncLocalTracksToPeer(pc);

    // Negociação Perfeita: Triggers automáticos quando tracks são adicionadas ou modificadas
    pc.onnegotiationneeded = async () => {
      try {
        state.makingOffer.set(peerId, true);
        console.log(`[WebRTC] onnegotiationneeded disparado para ${peerId}`);
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        sendDirectToPeer(peerId, 'offer', { sdp: pc.localDescription });
      } catch (err) {
        console.error(`[WebRTC] Erro no onnegotiationneeded com ${peerId}:`, err);
      } finally {
        state.makingOffer.set(peerId, false);
      }
    };

    // Candidatos ICE locais
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        sendDirectToPeer(peerId, 'candidate', { candidate: event.candidate });
      }
    };

    // Recebimento de Mídia Remota (Áudio e Vídeo)
    pc.ontrack = (event) => {
      console.log('[WebRTC] 🎥 Recebeu track remota de:', peerId, event.track.kind);
      
      let remoteStream = state.remoteStreams.get(peerId);
      if (!remoteStream) {
        remoteStream = new MediaStream();
        state.remoteStreams.set(peerId, remoteStream);
      }

      // Adiciona track se ainda não estiver na MediaStream
      if (!remoteStream.getTracks().some(t => t.id === event.track.id)) {
        remoteStream.addTrack(event.track);
      }

      const member = state.members.get(peerId);
      const peerName = member ? member.name : 'Participante Remoto';

      if (member) member.isSharing = true;
      updateParticipantsUI();

      renderRemoteVideoCard(peerId, peerName, remoteStream);
      updateVideoGridLayout();

      event.track.onended = () => {
        console.log('[WebRTC] Track remota finalizada:', event.track.kind);
        if (remoteStream.getVideoTracks().length === 0) {
          handleRemoteStreamEnded(peerId);
        }
      };
    };

    pc.onconnectionstatechange = () => {
      console.log(`[WebRTC] Status da conexão com ${peerId}:`, pc.connectionState);
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        console.warn(`[WebRTC] Conexão com ${peerId} desconectada.`);
      }
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
        if (!activeTracks.some(at => at.id === t.id)) {
          activeTracks.push(t);
        }
      });
    }

    // Adiciona tracks ausentes
    activeTracks.forEach(track => {
      const hasSender = senders.some(s => s.track && s.track.id === track.id);
      if (!hasSender) {
        console.log('[WebRTC] Adicionando track local ao peer:', track.kind);
        const stream = state.localScreenStream || state.localMicStream;
        pc.addTrack(track, stream);
      }
    });

    // Remove tracks que não estão mais ativas
    senders.forEach(sender => {
      if (sender.track && !activeTracks.some(t => t.id === sender.track.id)) {
        console.log('[WebRTC] Removendo track local inativa do peer:', sender.track.kind);
        try { pc.removeTrack(sender); } catch (e) {}
      }
    });
  }

  async function handleReceiveOffer(senderId, sdp) {
    const pc = getOrCreatePeerConnection(senderId);
    const isPolite = state.myPeerId > senderId;
    const isMakingOffer = state.makingOffer.get(senderId) || false;

    // Resolução de colisão de ofertas (Glare)
    const offerCollision = isMakingOffer || pc.signalingState !== 'stable';
    const ignoreOffer = !isPolite && offerCollision;
    state.ignoreOffer.set(senderId, ignoreOffer);

    if (ignoreOffer) {
      console.log(`[WebRTC] Ignorando oferta concorrente de ${senderId} (Impolite Peer)`);
      return;
    }

    try {
      if (offerCollision) {
        console.log(`[WebRTC] Revertendo estado para aceitar oferta remota de ${senderId} (Polite Peer)`);
        await pc.setLocalDescription({ type: 'rollback' });
      }

      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      flushPendingIceCandidates(senderId, pc);

      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      sendDirectToPeer(senderId, 'answer', { sdp: pc.localDescription });
    } catch (err) {
      console.error('[WebRTC] Erro ao responder SDP Offer:', err);
    }
  }

  async function handleReceiveAnswer(senderId, sdp) {
    const pc = state.peerConnections.get(senderId);
    if (!pc) return;

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      flushPendingIceCandidates(senderId, pc);
    } catch (err) {
      console.error('[WebRTC] Erro ao processar SDP Answer:', err);
    }
  }

  async function handleReceiveIceCandidate(senderId, candidate) {
    const pc = state.peerConnections.get(senderId);
    if (!pc || !pc.remoteDescription) {
      const list = state.pendingCandidates.get(senderId) || [];
      list.push(candidate);
      state.pendingCandidates.set(senderId, list);
      return;
    }

    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      if (!state.ignoreOffer.get(senderId)) {
        console.warn('[WebRTC] Erro ao adicionar ICE Candidate:', err);
      }
    }
  }

  function flushPendingIceCandidates(peerId, pc) {
    const list = state.pendingCandidates.get(peerId) || [];
    list.forEach(async (cand) => {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(cand));
      } catch (e) {}
    });
    state.pendingCandidates.set(peerId, []);
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
    updateParticipantsUI();
  }

  function handleRemoteStreamEnded(peerId) {
    state.remoteStreams.delete(peerId);
    removeRemoteVideoCard(peerId);
    updateVideoGridLayout();

    const member = state.members.get(peerId);
    if (member) member.isSharing = false;
    updateParticipantsUI();
  }

  // =========================================================================
  // Transmissão de Tela (Screen Sharing)
  // =========================================================================

  async function toggleScreenSharing() {
    if (state.isSharingScreen) {
      stopScreenSharing();
    } else {
      await startScreenSharing();
    }
  }

  async function startScreenSharing() {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        showToast('Seu navegador não suporta a API de compartilhamento de tela.', 'danger');
        return;
      }

      // Captura da tela em alta resolução e taxa de quadros
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          cursor: 'always',
          displaySurface: 'monitor',
          frameRate: { ideal: 60, max: 60 },
          width: { ideal: 1920 },
          height: { ideal: 1080 }
        },
        audio: true
      });

      // Se o microfone local estiver ativo, acopla a track de áudio
      if (state.isMicActive && state.localMicStream) {
        state.localMicStream.getAudioTracks().forEach(t => stream.addTrack(t));
      }

      state.localScreenStream = stream;
      state.isSharingScreen = true;

      // Atualiza o estado do usuário local
      const myMember = state.members.get(state.myPeerId);
      if (myMember) myMember.isSharing = true;
      updateParticipantsUI();

      updateShareButtonUI(true);
      renderLocalVideoCard(stream);
      updateVideoGridLayout();

      // Notifica todos na sala que estamos transmitindo
      publishToRoom('sharing-status', {
        userName: state.userName,
        isSharing: true
      });

      // Sincroniza tracks locais com todas as conexões WebRTC ativas
      state.peerConnections.forEach(pc => {
        syncLocalTracksToPeer(pc);
      });

      // Detecta encerramento pelo botão nativo do navegador
      const videoTrack = stream.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.onended = () => {
          console.log('[WebRTC] Transmissão finalizada pelo controle nativo do navegador.');
          stopScreenSharing();
        };
      }

      showToast('Transmissão de tela iniciada com sucesso!', 'success');

    } catch (err) {
      console.warn('[WebRTC] Erro ou cancelamento ao compartilhar tela:', err);
      if (err.name !== 'NotAllowedError') {
        showToast(`Erro ao compartilhar tela: ${err.message}`, 'danger');
      }
      stopScreenSharing();
    }
  }

  function stopScreenSharing() {
    if (state.localScreenStream) {
      state.localScreenStream.getTracks().forEach(track => {
        try {
          track.stop();
        } catch (e) {
          console.warn('Erro ao interromper track:', e);
        }
      });
      state.localScreenStream = null;
    }

    state.isSharingScreen = false;

    const myMember = state.members.get(state.myPeerId);
    if (myMember) myMember.isSharing = false;
    updateParticipantsUI();

    updateShareButtonUI(false);

    // Notifica todos os participantes para remover a visualização
    publishToRoom('sharing-status', {
      userName: state.userName,
      isSharing: false
    });

    // Remove tracks locais das conexões ativas
    state.peerConnections.forEach(pc => {
      syncLocalTracksToPeer(pc);
    });

    const localCard = document.getElementById('video-card-local');
    if (localCard) localCard.remove();

    updateVideoGridLayout();
    showToast('Transmissão de tela finalizada.', 'info');
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

  // =========================================================================
  // Saída da Sala
  // =========================================================================

  function leaveRoomSilently() {
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
    state.myPeerId = null;
    state.remoteStreams.clear();
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
    showToast('Você saiu da sala. A transmissão foi encerrada.', 'info');
  }

  function copyRoomLink() {
    const inviteUrl = `${window.location.origin}/?room=${encodeURIComponent(state.roomId)}`;
    navigator.clipboard.writeText(inviteUrl).then(() => {
      showToast('Link de convite copiado para a área de transferência!', 'success');
    }).catch(() => {
      prompt('Copie o link abaixo:', inviteUrl);
    });
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

      state.peerConnections.forEach(pc => {
        syncLocalTracksToPeer(pc);
      });

      showToast('Microfone desligado', 'info');
    } else {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        state.localMicStream = micStream;
        state.isMicActive = true;
        dom.btnToggleMic.classList.add('active');
        dom.iconMic.setAttribute('data-lucide', 'mic');

        state.peerConnections.forEach(pc => {
          syncLocalTracksToPeer(pc);
        });

        showToast('Microfone ativado', 'success');
      } catch (err) {
        console.error('Erro ao acessar microfone:', err);
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
    });

    const cardVolBtns = dom.videoGrid.querySelectorAll('.video-card-volume-btn');
    cardVolBtns.forEach(btn => {
      const icon = btn.querySelector('i');
      if (icon) {
        icon.setAttribute('data-lucide', state.isRemoteAudioMuted ? 'volume-x' : (state.globalVolume === 0 ? 'volume-x' : (state.globalVolume < 0.5 ? 'volume-1' : 'volume-2')));
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
    const volumeFraction = val / 100;
    state.globalVolume = volumeFraction;

    if (dom.globalVolumeText) {
      dom.globalVolumeText.textContent = `${val}%`;
    }

    if (val === 0) {
      state.isRemoteAudioMuted = true;
      dom.btnToggleAudioMute.classList.add('active');
      dom.iconVolume.setAttribute('data-lucide', 'volume-x');
    } else {
      state.isRemoteAudioMuted = false;
      dom.btnToggleAudioMute.classList.remove('active');
      dom.iconVolume.setAttribute('data-lucide', val < 50 ? 'volume-1' : 'volume-2');
    }

    const remoteCards = dom.videoGrid.querySelectorAll('.video-card:not(.local-user)');
    remoteCards.forEach(card => {
      const video = card.querySelector('video');
      const slider = card.querySelector('.video-card-volume-slider');
      const volBtn = card.querySelector('.video-card-volume-btn i');

      if (video) {
        video.volume = volumeFraction;
        video.muted = state.isRemoteAudioMuted;
      }
      if (slider) {
        slider.value = val;
      }
      if (volBtn) {
        volBtn.setAttribute('data-lucide', state.isRemoteAudioMuted || val === 0 ? 'volume-x' : (val < 50 ? 'volume-1' : 'volume-2'));
      }
    });

    if (window.lucide) window.lucide.createIcons();
  }

  // =========================================================================
  // Reprodução de Vídeo e Renderização da Grade
  // =========================================================================

  function attachStreamToVideo(videoEl, stream, isLocal = false) {
    if (!videoEl || !stream) return;

    if (videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
    }

    videoEl.playsInline = true;
    videoEl.autoplay = true;

    if (isLocal) {
      videoEl.muted = true;
    } else {
      videoEl.volume = state.globalVolume;
      videoEl.muted = state.isRemoteAudioMuted;
    }

    const startPlayback = () => {
      const playPromise = videoEl.play();
      if (playPromise !== undefined) {
        playPromise.catch(err => {
          console.warn('[Video] Play automático com som bloqueado, tentando com áudio mutado:', err);
          videoEl.muted = true;
          videoEl.play().catch(e => console.error('[Video] Erro na reprodução do vídeo:', e));
        });
      }
    };

    if (videoEl.readyState >= 2) {
      startPlayback();
    } else {
      videoEl.onloadedmetadata = () => startPlayback();
    }
  }

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
            <span class="video-user-name">${escapeHtml(state.userName)} (Sua Tela)</span>
          </div>
          <div class="video-meta-badges">
            <span class="badge-live"><span class="pulse-dot"></span> AO VIVO</span>
            <span class="badge-hd">60 FPS</span>
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
    attachStreamToVideo(videoEl, stream, true);

    if (window.lucide) window.lucide.createIcons();
  }

  function renderRemoteVideoCard(peerId, peerName, stream) {
    const cardId = `video-card-${peerId}`;
    let card = document.getElementById(cardId);
    const initials = peerName ? peerName.substring(0, 2).toUpperCase() : 'P2';

    if (!card) {
      card = document.createElement('div');
      card.id = cardId;
      card.className = 'video-card';
      card.innerHTML = `
        <video id="video-${peerId}" autoplay playsinline></video>
        
        <div class="video-overlay-top">
          <div class="video-user-badge">
            <span class="user-avatar-initials">${initials}</span>
            <span class="video-user-name">${escapeHtml(peerName)}</span>
          </div>
          <div class="video-meta-badges">
            <span class="badge-live"><span class="pulse-dot"></span> AO VIVO</span>
            <span class="badge-hd">HD</span>
          </div>
        </div>

        <div class="video-overlay-bottom">
          <!-- Controle de Volume da Transmissão Remota -->
          <div class="video-card-volume-group" title="Volume da Transmissão">
            <button class="video-card-volume-btn" data-action="toggle-card-mute" title="Mutar/Desmutar som desta tela">
              <i data-lucide="volume-2"></i>
            </button>
            <input type="range" class="video-card-volume-slider" min="0" max="100" value="${Math.round(state.globalVolume * 100)}" title="Ajustar volume desta transmissão">
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
          video.muted = !video.muted;
          const icon = cardVolBtn.querySelector('i');
          if (icon) {
            if (video.muted) {
              icon.setAttribute('data-lucide', 'volume-x');
            } else {
              const currentVol = video.volume;
              icon.setAttribute('data-lucide', currentVol === 0 ? 'volume-x' : (currentVol < 0.5 ? 'volume-1' : 'volume-2'));
            }
            if (window.lucide) window.lucide.createIcons();
          }
        });
      }

      if (cardVolSlider && video) {
        cardVolSlider.addEventListener('input', (e) => {
          const val = parseInt(e.target.value, 10);
          const fraction = val / 100;
          video.volume = fraction;
          video.muted = val === 0;

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
          } catch (e) {
            console.warn('PiP não suportado:', e);
          }
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
    attachStreamToVideo(videoEl, stream, false);

    if (window.lucide) window.lucide.createIcons();
  }

  function removeRemoteVideoCard(peerId) {
    const card = document.getElementById(`video-card-${peerId}`);
    if (card) {
      card.remove();
    }
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
      showToast('Layout: Grade Padrão', 'info');
    } else {
      const firstCard = dom.videoGrid.querySelector('.video-card');
      if (firstCard) {
        toggleFocusStream(firstCard.id);
        showToast('Layout: Destaque Principal', 'info');
      }
    }
  }

  function toggleFullScreen() {
    if (!document.fullscreenElement) {
      dom.roomContainer.requestFullscreen().catch(err => console.warn(err));
    } else {
      document.exitFullscreen().catch(err => console.warn(err));
    }
  }

  // =========================================================================
  // Chat da Sala
  // =========================================================================

  function handleSendChatMessage(e) {
    e.preventDefault();
    const text = dom.chatInput.value.trim();
    if (!text) return;

    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    const messageData = {
      type: 'chat',
      senderId: state.myPeerId,
      senderName: state.userName,
      text,
      time
    };

    // Exibe localmente
    appendChatMessage(messageData);

    // Envia para todos na sala
    publishToRoom('chat', messageData);

    dom.chatInput.value = '';
    dom.chatInput.focus();
  }

  function appendChatMessage({ senderId, senderName, text, time }) {
    const isSelf = senderId === state.myPeerId;

    const bubble = document.createElement('div');
    bubble.className = `chat-bubble ${isSelf ? 'self' : 'other'}`;
    bubble.innerHTML = `
      <div class="chat-bubble-header">
        <span class="chat-sender-name">${escapeHtml(senderName)}</span>
        <span class="chat-time">${time || ''}</span>
      </div>
      <div class="chat-bubble-content">${escapeHtml(text)}</div>
    `;

    dom.chatMessages.appendChild(bubble);
    dom.chatMessages.scrollTop = dom.chatMessages.scrollHeight;

    if (!state.isSidebarOpen && !isSelf) {
      state.unreadMessages++;
      dom.chatUnreadBadge.classList.remove('hidden');
    }
  }

  // =========================================================================
  // Lista de Participantes
  // =========================================================================

  function updateParticipantsUI() {
    const users = Array.from(state.members.values());
    dom.participantCountBadge.textContent = users.length;
    dom.tabUsersCount.textContent = users.length;

    dom.participantsList.innerHTML = '';

    users.forEach(user => {
      const isSelf = user.id === state.myPeerId;
      const initials = user.name ? user.name.substring(0, 2).toUpperCase() : 'PA';

      const li = document.createElement('li');
      li.className = 'participant-item';
      li.innerHTML = `
        <div class="participant-info">
          <div class="participant-avatar">${initials}</div>
          <span class="participant-name">${escapeHtml(user.name)}${isSelf ? ' (Você)' : ''}</span>
        </div>
        <div>
          ${user.isSharing ? `
            <span class="participant-status-badge sharing">
              <i data-lucide="cast" style="width:12px;height:12px;"></i> Transmitindo
            </span>
          ` : `
            <span class="participant-status-badge watching">Assistindo</span>
          `}
        </div>
      `;

      dom.participantsList.appendChild(li);
    });

    if (window.lucide) window.lucide.createIcons();
  }

  // =========================================================================
  // Sidebar (Chat / Participantes)
  // =========================================================================

  function toggleSidebar(tab) {
    if (state.isSidebarOpen && state.currentTab === tab) {
      closeSidebar();
    } else {
      openSidebar(tab);
    }
  }

  function openSidebar(tab) {
    state.isSidebarOpen = true;
    dom.sidebar.classList.remove('hidden');
    switchSidebarTab(tab);

    if (tab === 'chat') {
      state.unreadMessages = 0;
      dom.chatUnreadBadge.classList.add('hidden');
      setTimeout(() => dom.chatInput.focus(), 100);
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
      dom.tabUsers.classList.add('active');
      dom.tabChat.classList.remove('active');
      dom.panelUsers.classList.add('active');
      dom.panelChat.classList.remove('active');
    }
  }

  // =========================================================================
  // Utilitários
  // =========================================================================

  function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;

    let iconName = 'info';
    if (type === 'success') iconName = 'check-circle';
    if (type === 'danger') iconName = 'alert-circle';

    toast.innerHTML = `
      <i data-lucide="${iconName}" style="width: 18px; height: 18px;"></i>
      <span>${escapeHtml(message)}</span>
    `;

    dom.toastContainer.appendChild(toast);
    if (window.lucide) window.lucide.createIcons();

    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(40px)';
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

})();
