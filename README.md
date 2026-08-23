# 🖥️ ScreenShare Live - WebRTC (Serverless Edition)

Aplicação web moderna de compartilhamento de tela em tempo real com **WebRTC P2P mesh** utilizando **PeerJS Cloud** para sinalização 100% serverless.

---

## 🚀 Como Hospedar no Vercel (100% Grátis & 1 Clique)

Esta versão foi convertida para **Frontend Estático Serverless**. Isso significa que ela **não precisa de servidor Node.js/Socket.io ligado 24h**. Ela se conecta diretamente à infraestrutura em nuvem global do PeerJS e troca o vídeo ponto a ponto (P2P) entre os navegadores.

### Passo a Passo para Deploy no Vercel:

1. Suba este projeto no seu repositório no **GitHub**:
   ```bash
   git init
   git add .
   git commit -m "feat: initial commit screenshare live"
   git branch -M main
   git remote add origin https://github.com/SEU_USUARIO/SEU_REPOSITORIO.git
   git push -u origin main
   ```

2. Acesse [vercel.com](https://vercel.com) e clique em **"Add New Project"**.
3. Selecione o repositório do GitHub.
4. **Root Directory**: Deixe padrão ou `./`.
5. Clique em **"Deploy"**.
6. Pronto! Em 10 segundos seu site estará no ar em `https://seu-projeto.vercel.app`.

---

## ⚡ Como Rodar Localmente

Basta abrir `public/index.html` em qualquer servidor HTTP estático, ou rodar:

```bash
npm start
```
Acesse [http://localhost:3000](http://localhost:3000)

---

## ✨ Recursos

- 🖥️ **Compartilhamento de Tela Ultra HD (60 FPS)**: Captura de tela inteira, janela ou aba do navegador.
- 👥 **Multi-Telas Simultâneas**: Múltiplos participantes podem transmitir suas telas ao mesmo tempo na mesma sala.
- ⚡ **WebRTC P2P Mesh**: Transmissão direta de navegador para navegador com baixíssima latência.
- 🔒 **Encerramento Automático & Seguro**: Botões destacados no topo, na barra de controles e no card de vídeo para finalizar transmissão a qualquer momento.
- 💬 **Chat da Sala em Tempo Real**: Mensagens sincronizadas via Data Channels P2P.
- 🎙️ **Microfone de Apoio Integrado**: Transmita sua voz junto com a tela.
- 📱 **Interface Responsiva**: Suporte a modo foco/grade, tela cheia e Picture-in-Picture.
