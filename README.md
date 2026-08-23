# 🖥️ ScreenShare Live - WebRTC Serverless Edition

Aplicação web moderna de compartilhamento de tela colaborativo em tempo real com **WebRTC P2P mesh nativo** e **sinalização serverless em nuvem** (MQTT/WSS com fallback automático).

---

## 🚀 Como Hospedar no Vercel (100% Grátis & 1 Clique)

Esta versão foi desenvolvida especificamente para rodar como **Frontend Estático Serverless**. Isso significa que ela **não precisa de nenhum servidor Node.js ou VPS pago rodando 24 horas**.

### Passo a Passo para Deploy no Vercel:

1. Salve e suba as alterações no seu repositório do **GitHub**:
   ```bash
   git add .
   git commit -m "fix: decentralized WebRTC signaling mesh"
   git push origin main
   ```

2. Na **Vercel**, o deploy será acionado automaticamente em poucos segundos.

---

## ⚡ Como Funciona a Conexão P2P Serverless

- **Sinalização em Nuvem Global**: Utiliza brokers WebSocket de alta disponibilidade (`wss://broker.hivemq.com:8884/mqtt` e `wss://broker.emqx.io:8084/mqtt`) para descoberta instantânea de participantes na mesma sala (`/?room=nome-da-sala`).
- **WebRTC Nativo (`RTCPeerConnection`)**: O vídeo, áudio da tela e microfone trafegam diretamente entre os navegadores (P2P), garantindo baixíssima latência e resolução Ultra HD (60 FPS).
- **Controle de Som Integrado**: Controle de volume individual por tela assistida (0-100%) e volume geral no dock inferior.
- **Chat e Presença em Tempo Real**: Mensagens e lista de participantes sincronizadas instantaneamente.
