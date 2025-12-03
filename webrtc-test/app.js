// WebRTC Configuration
const ICE_CONFIGURATION = {
    iceServers: [
        // STUN server
        { urls: 'stun:turn.li1.nl:3478' },
        // TURN server (non-TLS) - turn.li1.nl:3478 with UDP and TCP transports
        {
            urls: [
                'turn:turn.li1.nl:3478?transport=udp',
                'turn:turn.li1.nl:3478?transport=tcp'
            ],
            username: 'peaceast',
            credential: 'endoplazmikretikulum'
        }
    ]
};

// Global variables
let peerConnection = null;
let dataChannel = null;
let localIceCandidates = [];
let isInitiator = false;

// DOM elements
const connectionStatus = document.getElementById('connectionStatus');
const iceConnectionStatus = document.getElementById('iceConnectionStatus');
const signalingStatus = document.getElementById('signalingStatus');
const createOfferBtn = document.getElementById('createOfferBtn');
const createAnswerBtn = document.getElementById('createAnswerBtn');
const remoteSdp = document.getElementById('remoteSdp');
const setRemoteSdpBtn = document.getElementById('setRemoteSdpBtn');
const localSdp = document.getElementById('localSdp');
const copySdpBtn = document.getElementById('copySdpBtn');
const localIceCandidatesText = document.getElementById('localIceCandidates');
const copyLocalIceBtn = document.getElementById('copyLocalIceBtn');
const remoteIceCandidates = document.getElementById('remoteIceCandidates');
const addRemoteIceBtn = document.getElementById('addRemoteIceBtn');
const messages = document.getElementById('messages');
const messageInput = document.getElementById('messageInput');
const sendBtn = document.getElementById('sendBtn');
const logs = document.getElementById('logs');
const clearLogsBtn = document.getElementById('clearLogsBtn');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    log('info', 'WebRTC Mesajlaşma Test Uygulaması hazır!');
});

function setupEventListeners() {
    createOfferBtn.addEventListener('click', createOffer);
    createAnswerBtn.addEventListener('click', createAnswer);
    setRemoteSdpBtn.addEventListener('click', setRemoteSdp);
    copySdpBtn.addEventListener('click', copyLocalSdp);
    copyLocalIceBtn.addEventListener('click', copyLocalIce);
    addRemoteIceBtn.addEventListener('click', addRemoteIceCandidates);
    sendBtn.addEventListener('click', sendMessage);
    messageInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !sendBtn.disabled) {
            sendMessage();
        }
    });
    clearLogsBtn.addEventListener('click', () => {
        logs.innerHTML = '';
    });
}

function createPeerConnection() {
    try {
        peerConnection = new RTCPeerConnection(ICE_CONFIGURATION);
        log('info', 'PeerConnection oluşturuldu');

        // ICE candidate events
        peerConnection.onicecandidate = (event) => {
            if (event.candidate) {
                log('info', 'Local ICE candidate alındı');
                localIceCandidates.push(event.candidate);
                updateLocalIceCandidatesDisplay();
            } else {
                log('info', 'Tüm ICE candidates toplandı');
            }
        };

        // ICE connection state changes
        peerConnection.oniceconnectionstatechange = () => {
            const state = peerConnection.iceConnectionState;
            iceConnectionStatus.textContent = state;
            iceConnectionStatus.className = 'status-value ' + (state === 'connected' || state === 'completed' ? 'connected' : 'disconnected');
            log('info', `ICE Connection State: ${state}`);
            
            if (state === 'connected' || state === 'completed') {
                connectionStatus.textContent = 'Bağlandı';
                connectionStatus.className = 'status-value connected';
            } else if (state === 'disconnected' || state === 'failed') {
                connectionStatus.textContent = 'Bağlantı Kesildi';
                connectionStatus.className = 'status-value disconnected';
            }
        };

        // Signaling state changes
        peerConnection.onsignalingstatechange = () => {
            const state = peerConnection.signalingState;
            signalingStatus.textContent = state;
            log('info', `Signaling State: ${state}`);
        };

        // Data channel events
        peerConnection.ondatachannel = (event) => {
            log('info', 'Data channel alındı (receiver tarafı)');
            setupDataChannel(event.channel);
        };

        return true;
    } catch (error) {
        log('error', `PeerConnection oluşturma hatası: ${error.message}`);
        return false;
    }
}

function createDataChannel() {
    try {
        dataChannel = peerConnection.createDataChannel('messages', {
            ordered: true
        });
        log('info', 'Data channel oluşturuldu (initiator tarafı)');
        setupDataChannel(dataChannel);
        return true;
    } catch (error) {
        log('error', `Data channel oluşturma hatası: ${error.message}`);
        return false;
    }
}

function setupDataChannel(channel) {
    dataChannel = channel;

    dataChannel.onopen = () => {
        log('success', 'Data channel açıldı! Mesaj gönderebilirsiniz.');
        messageInput.disabled = false;
        sendBtn.disabled = false;
        connectionStatus.textContent = 'Bağlandı';
        connectionStatus.className = 'status-value connected';
    };

    dataChannel.onclose = () => {
        log('warning', 'Data channel kapandı');
        messageInput.disabled = true;
        sendBtn.disabled = true;
        connectionStatus.textContent = 'Bağlantı Kesildi';
        connectionStatus.className = 'status-value disconnected';
    };

    dataChannel.onerror = (error) => {
        log('error', `Data channel hatası: ${error}`);
    };

    dataChannel.onmessage = (event) => {
        log('info', `Mesaj alındı: ${event.data}`);
        addMessage(event.data, 'received');
    };
}

async function createOffer() {
    try {
        isInitiator = true;
        localIceCandidates = [];
        localIceCandidatesText.value = '';
        localSdp.value = '';

        if (!createPeerConnection()) {
            return;
        }

        if (!createDataChannel()) {
            return;
        }

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);
        
        log('success', 'Offer oluşturuldu');
        localSdp.value = JSON.stringify(offer);
        updateLocalIceCandidatesDisplay();
        
        createOfferBtn.disabled = true;
        createAnswerBtn.disabled = true;
    } catch (error) {
        log('error', `Offer oluşturma hatası: ${error.message}`);
    }
}

async function createAnswer() {
    try {
        isInitiator = false;
        localIceCandidates = [];
        localIceCandidatesText.value = '';
        localSdp.value = '';

        if (!createPeerConnection()) {
            return;
        }

        // Remote SDP'yi önce ayarlamalıyız
        if (!remoteSdp.value.trim()) {
            log('warning', 'Önce remote SDP\'yi (offer) ayarlayın!');
            return;
        }

        const remoteDesc = JSON.parse(remoteSdp.value);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteDesc));
        log('info', 'Remote description (offer) ayarlandı');

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        
        log('success', 'Answer oluşturuldu');
        localSdp.value = JSON.stringify(answer);
        updateLocalIceCandidatesDisplay();
        
        createOfferBtn.disabled = true;
        createAnswerBtn.disabled = true;
    } catch (error) {
        log('error', `Answer oluşturma hatası: ${error.message}`);
    }
}

async function setRemoteSdp() {
    try {
        if (!remoteSdp.value.trim()) {
            log('warning', 'SDP boş olamaz!');
            return;
        }

        if (!peerConnection) {
            log('warning', 'Önce PeerConnection oluşturun!');
            return;
        }

        const remoteDesc = JSON.parse(remoteSdp.value);
        await peerConnection.setRemoteDescription(new RTCSessionDescription(remoteDesc));
        log('success', 'Remote SDP ayarlandı');

        // Eğer answer oluşturmadıysak ve offer alındıysa, answer oluştur
        if (remoteDesc.type === 'offer' && peerConnection.signalingState === 'have-remote-offer') {
            const answer = await peerConnection.createAnswer();
            await peerConnection.setLocalDescription(answer);
            log('success', 'Answer otomatik oluşturuldu');
            localSdp.value = JSON.stringify(answer);
            updateLocalIceCandidatesDisplay();
        }
    } catch (error) {
        log('error', `Remote SDP ayarlama hatası: ${error.message}`);
    }
}

function addRemoteIceCandidates() {
    try {
        if (!remoteIceCandidates.value.trim()) {
            log('warning', 'ICE candidates boş olamaz!');
            return;
        }

        if (!peerConnection) {
            log('warning', 'Önce PeerConnection oluşturun!');
            return;
        }

        const candidates = JSON.parse(remoteIceCandidates.value);
        if (!Array.isArray(candidates)) {
            log('error', 'ICE candidates bir array olmalı!');
            return;
        }

        candidates.forEach(async (candidate) => {
            try {
                await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
                log('info', 'Remote ICE candidate eklendi');
            } catch (error) {
                log('error', `ICE candidate ekleme hatası: ${error.message}`);
            }
        });

        log('success', `${candidates.length} remote ICE candidate eklendi`);
    } catch (error) {
        log('error', `ICE candidates ekleme hatası: ${error.message}`);
    }
}

function updateLocalIceCandidatesDisplay() {
    if (localIceCandidates.length > 0) {
        localIceCandidatesText.value = JSON.stringify(localIceCandidates, null, 2);
    }
}

function sendMessage() {
    if (!dataChannel || dataChannel.readyState !== 'open') {
        log('warning', 'Data channel açık değil!');
        return;
    }

    const message = messageInput.value.trim();
    if (!message) {
        return;
    }

    try {
        dataChannel.send(message);
        addMessage(message, 'sent');
        messageInput.value = '';
        log('info', `Mesaj gönderildi: ${message}`);
    } catch (error) {
        log('error', `Mesaj gönderme hatası: ${error.message}`);
    }
}

function addMessage(text, type) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    
    const messageText = document.createElement('div');
    messageText.textContent = text;
    
    const messageInfo = document.createElement('div');
    messageInfo.className = 'message-info';
    messageInfo.textContent = `${type === 'sent' ? 'Gönderildi' : 'Alındı'} - ${new Date().toLocaleTimeString()}`;
    
    messageDiv.appendChild(messageText);
    messageDiv.appendChild(messageInfo);
    messages.appendChild(messageDiv);
    
    // Scroll to bottom
    messages.parentElement.scrollTop = messages.parentElement.scrollHeight;
}

async function copyLocalSdp() {
    if (!localSdp.value.trim()) {
        log('warning', 'Kopyalanacak SDP yok!');
        return;
    }

    try {
        await navigator.clipboard.writeText(localSdp.value);
        log('success', 'SDP kopyalandı!');
    } catch (error) {
        log('error', `SDP kopyalama hatası: ${error.message}`);
    }
}

async function copyLocalIce() {
    if (!localIceCandidatesText.value.trim()) {
        log('warning', 'Kopyalanacak ICE candidates yok!');
        return;
    }

    try {
        await navigator.clipboard.writeText(localIceCandidatesText.value);
        log('success', 'ICE candidates kopyalandı!');
    } catch (error) {
        log('error', `ICE candidates kopyalama hatası: ${error.message}`);
    }
}

function log(level, message) {
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry ${level}`;
    
    const time = new Date().toLocaleTimeString();
    const timeSpan = document.createElement('span');
    timeSpan.className = 'log-time';
    timeSpan.textContent = `[${time}]`;
    
    const messageSpan = document.createElement('span');
    messageSpan.textContent = message;
    
    logEntry.appendChild(timeSpan);
    logEntry.appendChild(messageSpan);
    logs.appendChild(logEntry);
    
    // Scroll to bottom
    logs.scrollTop = logs.scrollHeight;
    
    // Also log to console
    console.log(`[${level.toUpperCase()}] ${message}`);
}

