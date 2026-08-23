/**
 * ScreenShare Live - WebRTC Multi-Peer Screen Sharing Engine
 * Serverless Client Edition (Vanilla JS + PeerJS Cloud + WebRTC Mesh)
 * 100% Compatível com Vercel / GitHub Pages / Servidores Estáticos
 */

(function () {
  'use strict';

  // =========================================================================
  // Configurações e Estado Global
  // =========================================================================

  // STUN Servers públicos do Google
  const ICE_CONFIG = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      { urls: 'stun:stun2.l.google.com:19302' },
      { urls: 'stun:stun3.l.google.com:19302' },
      { urls: 'stun:stun4.l.google.com:19302' }
    ]
  };

  const state = {
    peer: null,              // Instância do PeerJS
    myPeerId: null,          // ID único gerado no formato: room_ROOMID_UUID
    roomId: null,            // ID da sala (ex: dev-team-123)
    userName: '',            // Nome do usuário
    isHost: false,           // Se é quem iniciou ou primeiro participante
    isSharingScreen: false,  // Se está transmitindo tela
    isMicActive: false,      // Se microfone está ativo
    isRemoteAudioMuted: false,
    globalVolume: 1.0,       // Nível de volume geral (0.0 a 1.0)
    focusedStreamId: null,

    // Mídias Locais
    localScreenStream: null,
    localMicStream: null,

    // Conexões Ativas:
    // dataConns: Map<peerId, DataConnection>
    dataConns: new Map(),
    // mediaCalls: Map<peerId, MediaConnection> (chamadas que enviamos ou recebemos)
    mediaCalls: new Map(),
    // remoteStreams: Map<peerId, { stream, userName, isSharing }>
    remoteStreams: new Map(),

    // Lista de membros conhecidos na sala: Map<peerId, { id, name, isSharing }>
    members: new Map(),

    // UI State
    isSidebarOpen: false,
    currentTab: 'chat',
    unreadMessages: 0,
    roomPrefix: 'ssl_' // ScreenShare Live room prefix
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

    // Verificar room ID na URL
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

    // Encerramento garantido ao sair da página
    window.addEventListener('beforeunload', () => {
      leaveRoomSilently();
    });

    window.addEventListener('pagehide', () => {
      leaveRoomSilently();
    });
  }

  // =========================================================================
  // Gerenciamento de Salas (PeerJS Mesh)
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

    // Aceita tanto código simples quanto URL completa colada pelo usuário
    let roomId = rawCode;
    try {
      if (rawCode.includes('?room=')) {
        const parsed = new URL(rawCode);
        roomId = parsed.searchParams.get('room') || rawCode;
      }
    } catch (e) {
      // continua com rawCode
    }

    localStorage.setItem('screenshare_username', userName);
    joinRoom(roomId, userName);
  }

  function joinRoom(roomId, userName) {
    state.roomId = sanitizeRoomId(roomId);
    state.userName = userName;

    // Atualiza a URL sem recarregar a página
    const newUrl = `${window.location.origin}/?room=${encodeURIComponent(state.roomId)}`;
    window.history.pushState({ path: newUrl }, '', newUrl);

    dom.headerRoomId.textContent = state.roomId;
    dom.lobbyModal.classList.add('hidden');
    dom.roomContainer.classList.remove('hidden');

    // Inicializa a conexão PeerJS Serverless
    initPeerJS();

    showToast(`Conectando à sala: ${state.roomId}`, 'info');
  }

  function sanitizeRoomId(id) {
    return id.toLowerCase().replace(/[^a-z0-9_-]/g, '-').substring(0, 30);
  }

  // Gera o ID fixo do Host da sala
  function getHostPeerId(roomId) {
    return `${state.roomPrefix}${roomId}_host`;
  }

  // Gera ID aleatório para participantes
  function generateMemberPeerId(roomId) {
    const rand = Math.random().toString(36).substring(2, 8);
    return `${state.roomPrefix}${roomId}_peer_${rand}`;
  }

  // =========================================================================
  // Inicialização do PeerJS Client (Serverless Cloud)
  // =========================================================================

  function initPeerJS() {
    dom.connectionStatusText.textContent = 'Conectando PeerJS...';

    // Primeiro, tentamos nos conectar como Host da sala (ID fixo)
    const targetHostId = getHostPeerId(state.roomId);

    // Se a instância anterior existir, destruímos
    if (state.peer) {
      try { state.peer.destroy(); } catch (e) {}
      state.peer = null;
    }

    // Tentar criar com ID de Host
    createPeerInstance(targetHostId, true);
  }

  function createPeerInstance(desiredId, isAttemptingHost) {
    const peerOptions = {
      config: ICE_CONFIG,
      debug: 1
    };

    const peer = new Peer(desiredId, peerOptions);

    peer.on('open', (id) => {
      state.myPeerId = id;
      state.isHost = isAttemptingHost;
      console.log(`[PeerJS] Conectado com sucesso como ${isAttemptingHost ? 'HOST' : 'MEMBRO'}. ID:`, id);

      dom.connectionStatusText.textContent = 'Conectado P2P';
      showToast('Conectado à rede P2P com sucesso!', 'success');

      // Adiciona a si mesmo na lista de membros
      state.members.set(state.myPeerId, {
        id: state.myPeerId,
        name: state.userName,
        isSharing: false
      });
      updateParticipantsUI();

      if (!isAttemptingHost) {
        // Como membro, conecta imediatamente ao Host da sala
        const hostId = getHostPeerId(state.roomId);
        connectToPeer(hostId);
      }
    });

    // Se o ID já estiver em uso (o Host já existe), conectamos como participante normal
    peer.on('error', (err) => {
      console.warn('[PeerJS] Erro:', err.type, err);

      if (isAttemptingHost && (err.type === 'unavailable-id' || err.type === 'invalid-id')) {
        console.log('[PeerJS] Sala já possui Host ativo. Conectando como participante...');
        peer.destroy();
        const memberId = generateMemberPeerId(state.roomId);
        createPeerInstance(memberId, false);
        return;
      }

      if (err.type === 'peer-unavailable') {
        console.log('[PeerJS] Peer indisponível:', err);
      } else {
        dom.connectionStatusText.textContent = 'Erro P2P';
        showToast(`Aviso P2P: ${err.message || err.type}`, 'info');
      }
    });

    // =======================================================================
    // Recebimento de Conexões de Dados (Chat, Handshake, Membros)
    // =======================================================================
    peer.on('connection', (conn) => {
      setupDataConnection(conn);
    });

    // =======================================================================
    // Recebimento de Chamadas de Mídia (Transmissão de Tela)
    // =======================================================================
    peer.on('call', (call) => {
      console.log('[PeerJS] 📞 Recebeu chamada de vídeo de:', call.peer);

      // Respondemos com stream vazio se não estivermos transmitindo, ou com nosso stream se estivermos
      const answerStream = state.localScreenStream || createSilentMediaStream();
      call.answer(answerStream);

      state.mediaCalls.set(call.peer, call);

      call.on('stream', (remoteStream) => {
        console.log('[PeerJS] 🎥 Recebeu stream de tela de:', call.peer);
        
        // Obter nome do participante
        const member = state.members.get(call.peer);
        const peerName = member ? member.name : 'Participante Remoto';

        state.remoteStreams.set(call.peer, {
          stream: remoteStream,
          userName: peerName,
          isSharing: true
        });

        if (member) member.isSharing = true;
        updateParticipantsUI();

        renderRemoteVideoCard(call.peer, peerName, remoteStream);
        updateVideoGridLayout();
      });

      call.on('close', () => {
        console.log('[PeerJS] Chamada encerrada por:', call.peer);
        handleRemoteStreamEnded(call.peer);
      });

      call.on('error', (err) => {
        console.warn('[PeerJS] Erro na chamada com:', call.peer, err);
      });
    });

    peer.on('disconnected', () => {
      console.warn('[PeerJS] Desconectado da nuvem de sinalização. Tentando reconectar...');
      dom.connectionStatusText.textContent = 'Reconectando...';
      try {
        peer.reconnect();
      } catch (e) {}
    });

    peer.on('close', () => {
      console.log('[PeerJS] Conexão destruída.');
    });

    state.peer = peer;
  }

  // Cria um stream vazio para responder chamadas quando só estamos assistindo
  function createSilentMediaStream() {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 2;
      canvas.height = 2;
      return canvas.captureStream ? canvas.captureStream(1) : new MediaStream();
    } catch (e) {
      return new MediaStream();
    }
  }

  // =========================================================================
  // Gerenciamento de Canais de Dados (Mesh de Sincronização)
  // =========================================================================

  function connectToPeer(targetPeerId) {
    if (!state.peer || state.dataConns.has(targetPeerId) || targetPeerId === state.myPeerId) {
      return;
    }

    console.log('[PeerJS] Conectando data channel com:', targetPeerId);
    const conn = state.peer.connect(targetPeerId, {
      reliable: true,
      metadata: { name: state.userName, isSharing: state.isSharingScreen }
    });

    setupDataConnection(conn);
  }

  function setupDataConnection(conn) {
    conn.on('open', () => {
      console.log('[PeerJS] Canal de dados aberto com:', conn.peer);
      state.dataConns.set(conn.peer, conn);

      // Envia nosso handshake de entrada
      sendToPeer(conn, {
        type: 'handshake',
        senderId: state.myPeerId,
        name: state.userName,
        isSharing: state.isSharingScreen
      });

      // Se nós somos o Host, enviamos a lista completa de membros para que a malha (mesh) se forme
      if (state.isHost) {
        const memberList = Array.from(state.members.values());
        sendToPeer(conn, {
          type: 'member-list',
          members: memberList
        });
      }

      // Se já estamos transmitindo tela, iniciamos a chamada de mídia para ele
      if (state.isSharingScreen && state.localScreenStream) {
        callPeerWithScreen(conn.peer);
      }
    });

    conn.on('data', (data) => {
      handleIncomingData(conn.peer, data);
    });

    conn.on('close', () => {
      console.log('[PeerJS] Canal de dados fechado com:', conn.peer);
      handlePeerLeft(conn.peer);
    });

    conn.on('error', (err) => {
      console.warn('[PeerJS] Erro no canal de dados:', err);
    });
  }

  function handleIncomingData(senderPeerId, data) {
    if (!data || !data.type) return;

    switch (data.type) {
      case 'handshake': {
        const isNew = !state.members.has(senderPeerId);
        state.members.set(senderPeerId, {
          id: senderPeerId,
          name: data.name || 'Participante',
          isSharing: !!data.isSharing
        });

        updateParticipantsUI();

        if (isNew) {
          showToast(`${data.name || 'Novo participante'} entrou na sala`, 'info');
        }

        // Se somos o host, propagamos para os outros participantes para que todos se conectem entre si
        if (state.isHost) {
          broadcastData({
            type: 'member-joined',
            member: { id: senderPeerId, name: data.name, isSharing: data.isSharing }
          }, senderPeerId);
        }
        break;
      }

      case 'member-list': {
        if (Array.isArray(data.members)) {
          data.members.forEach(member => {
            if (member.id !== state.myPeerId) {
              state.members.set(member.id, member);
              // Conecta aos outros membros da sala para formar o mesh completo
              if (!state.dataConns.has(member.id)) {
                connectToPeer(member.id);
              }
            }
          });
          updateParticipantsUI();
        }
        break;
      }

      case 'member-joined': {
        if (data.member && data.member.id !== state.myPeerId) {
          state.members.set(data.member.id, data.member);
          updateParticipantsUI();
          showToast(`${data.member.name} entrou na sala`, 'info');

          // Conecta ao novo membro para fechar a malha P2P
          if (!state.dataConns.has(data.member.id)) {
            connectToPeer(data.member.id);
          }
        }
        break;
      }

      case 'sharing-status': {
        const member = state.members.get(senderPeerId);
        if (member) {
          member.isSharing = data.isSharing;
          updateParticipantsUI();
        }

        if (!data.isSharing) {
          handleRemoteStreamEnded(senderPeerId);
          showToast(`${data.userName || 'Participante'} finalizou a transmissão.`, 'info');
        } else {
          showToast(`${data.userName || 'Participante'} iniciou compartilhamento de tela.`, 'info');
        }
        break;
      }

      case 'chat': {
        appendChatMessage({
          senderId: senderPeerId,
          senderName: data.senderName,
          text: data.text,
          time: data.time
        });
        break;
      }

      case 'leave': {
        handlePeerLeft(senderPeerId);
        break;
      }
    }
  }

  function broadcastData(payload, excludePeerId = null) {
    state.dataConns.forEach((conn, peerId) => {
      if (peerId !== excludePeerId && conn.open) {
        try {
          conn.send(payload);
        } catch (e) {
          console.warn('Erro ao enviar dados para peer:', peerId, e);
        }
      }
    });
  }

  function sendToPeer(conn, payload) {
    if (conn && conn.open) {
      try {
        conn.send(payload);
      } catch (e) {
        console.warn('Erro ao enviar dados para peer:', e);
      }
    }
  }

  function handlePeerLeft(peerId) {
    const member = state.members.get(peerId);
    if (member) {
      showToast(`${member.name} saiu da sala`, 'info');
      state.members.delete(peerId);
    }

    state.dataConns.delete(peerId);
    
    if (state.mediaCalls.has(peerId)) {
      try { state.mediaCalls.get(peerId).close(); } catch (e) {}
      state.mediaCalls.delete(peerId);
    }

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
  // Transmissão de Tela (Screen Sharing via PeerJS MediaCalls)
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

      // Se o microfone local estiver ativo, junta as tracks de áudio
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
      broadcastData({
        type: 'sharing-status',
        senderId: state.myPeerId,
        userName: state.userName,
        isSharing: true
      });

      // Liga chamada de vídeo com cada participante conectado
      state.dataConns.forEach((_, peerId) => {
        callPeerWithScreen(peerId);
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

  function callPeerWithScreen(targetPeerId) {
    if (!state.peer || !state.localScreenStream || targetPeerId === state.myPeerId) return;

    console.log('[PeerJS] Chamando peer com transmissão de tela:', targetPeerId);
    const call = state.peer.call(targetPeerId, state.localScreenStream);
    if (call) {
      state.mediaCalls.set(targetPeerId, call);
      call.on('error', (err) => {
        console.warn('[PeerJS] Erro na chamada com:', targetPeerId, err);
      });
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
    broadcastData({
      type: 'sharing-status',
      senderId: state.myPeerId,
      userName: state.userName,
      isSharing: false
    });

    // Fecha as chamadas de mídia ativas
    state.mediaCalls.forEach(call => {
      try { call.close(); } catch (e) {}
    });
    state.mediaCalls.clear();

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
    broadcastData({ type: 'leave', senderId: state.myPeerId });
    if (state.peer) {
      try { state.peer.destroy(); } catch (e) {}
    }
  }

  function leaveRoom() {
    leaveRoomSilently();

    state.isSharingScreen = false;
    state.isMicActive = false;
    state.localScreenStream = null;
    state.localMicStream = null;
    state.peer = null;
    state.myPeerId = null;
    state.dataConns.clear();
    state.mediaCalls.clear();
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
  // Microfone Auxiliar
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
      showToast('Microfone desligado', 'info');
    } else {
      try {
        const micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        state.localMicStream = micStream;
        state.isMicActive = true;
        dom.btnToggleMic.classList.add('active');
        dom.iconMic.setAttribute('data-lucide', 'mic');

        // Se já estiver transmitindo tela, acopla o áudio
        if (state.isSharingScreen && state.localScreenStream) {
          micStream.getAudioTracks().forEach(t => state.localScreenStream.addTrack(t));
        }

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

    // Atualiza todos os botões e sliders dos cards individuais
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

    // Aplica o volume em todos os vídeos remotos
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
  // Renderização da Grade de Vídeo
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
    if (videoEl) {
      videoEl.srcObject = stream;
    }

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
          <!-- Controle de Volume da Transmissão -->
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
    if (videoEl) {
      videoEl.srcObject = stream;
      videoEl.volume = state.globalVolume;
      videoEl.muted = state.isRemoteAudioMuted;
    }

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
  // Chat da Sala (P2P Mesh)
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

    // Envia para todos os outros
    broadcastData(messageData);

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
