/* ============================================
   星河之旅 · 七夕特典 — 联机客户端 v4
   双固定身份：芽芽 / 瑶瑶，密码 1234
   永久联机：登录一次，自动连接 / 自动重连
   ============================================ */

(function() {
    'use strict';

    // ====== 常量 ======
    const YAYA_PEER_ID = 'qixi-yaya';
    const YAOYAO_PEER_ID = 'qixi-yaoyao';
    const PASSWORD = '1234';
    let initDone = false;
    const readyCallbacks = [];

    // ====== 状态 ======
    let currentIdentity = null;   // 'yaya' | 'yaoyao' | null
    let peer = null;
    let conn = null;              // 与对方的 DataConnection
    let isConnected = false;
    let peerOpen = false;
    let lastPeerActivity = 0;
    let peerPresenceTimer = null;
    let reconnectTimer = null;
    let channel = null;
    const STORAGE_KEY = 'qixi_identity';

    // 消息处理器
    const messageHandlers = {};
    function onMessage(type, handler) {
        if (!messageHandlers[type]) messageHandlers[type] = [];
        messageHandlers[type].push(handler);
    }

    // ====== 工具 ======
    function escapeHtml(s) {
        if (typeof s !== 'string') return '';
        return s.replace(/[<>&"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
    }
    function getPageName() {
        const path = window.location.pathname;
        let name = path.split('/').filter(Boolean).pop() || 'index';
        name = name.replace('.html', '');
        const pageMap = {
            'index': '星河入口', 'meet': '初见馆', 'memories': '回忆册',
            'love': '告白屋', 'wish': '心愿星', 'secret': '秘密匣'
        };
        return pageMap[name] || name;
    }
    function getPeerId() {
        return currentIdentity === 'yaya' ? YAYA_PEER_ID : YAOYAO_PEER_ID;
    }
    function getOtherPeerId() {
        return currentIdentity === 'yaya' ? YAOYAO_PEER_ID : YAYA_PEER_ID;
    }
    function getOtherName() {
        return currentIdentity === 'yaya' ? '瑶瑶' : '芽芽';
    }

    // ====== 持久化 ======
    function loadIdentity() {
        try {
            const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
            if (data && (data.identity === 'yaya' || data.identity === 'yaoyao')) {
                return data.identity;
            }
        } catch {}
        return null;
    }
    function saveIdentity(identity) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            identity: identity,
            savedAt: Date.now()
        }));
    }
    function clearIdentity() {
        localStorage.removeItem(STORAGE_KEY);
    }

    // ====== 登录 ======
    function login(identity, password) {
        if (password !== PASSWORD) {
            return { ok: false, error: '密码错误' };
        }
        if (identity !== 'yaya' && identity !== 'yaoyao') {
            return { ok: false, error: '身份错误' };
        }
        currentIdentity = identity;
        saveIdentity(identity);
        startConnection();
        return { ok: true };
    }
    function logout() {
        clearIdentity();
        currentIdentity = null;
        cleanup();
        if (peer) {
            try { peer.destroy(); } catch {}
            peer = null;
        }
        peerOpen = false;
        isConnected = false;
        updateOnlineIndicator(0);
    }
    function isLoggedIn() {
        return currentIdentity !== null;
    }
    function getIdentity() {
        return currentIdentity;
    }

    // ====== 启动连接 ======
    function startConnection() {
        cleanup();
        initBroadcast();
        startPeerJS();
        startPresenceTimer();
    }
    function cleanup() {
        if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
        if (peerPresenceTimer) { clearInterval(peerPresenceTimer); peerPresenceTimer = null; }
        if (conn) {
            try { conn.close(); } catch {}
            conn = null;
        }
        isConnected = false;
    }

    // ====== BroadcastChannel ======
    function initBroadcast() {
        try {
            if (channel) return;
            channel = new BroadcastChannel(BROADCAST_NAME);
            channel.onmessage = (e) => {
                if (e.data) handleMessage(e.data, true);
            };
        } catch { channel = null; }
    }

    // ====== 加载脚本 ======
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    // ====== PeerJS ======
    function startPeerJS() {
        (async () => {
            try {
                if (!window.Peer) {
                    await loadScript('https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js');
                }
                // 用固定 ID 注册
                peer = new Peer(getPeerId(), {
                    config: {
                        iceServers: [
                            { urls: 'stun:stun.l.google.com:19302' },
                            { urls: 'stun:stun1.l.google.com:19302' },
                            { urls: 'stun:stun2.google.com:19302' }
                        ]
                    }
                });
                peer.on('open', () => {
                    peerOpen = true;
                    updateOnlineIndicator(isConnected ? 2 : 1);
                    // 尝试连接对方
                    tryConnectToOther();
                    // 同时通过 broadcast 通知一下
                    if (channel) {
                        try {
                            channel.postMessage({ type: 'sys', action: 'presence', identity: currentIdentity, peerId: getPeerId(), timestamp: Date.now() });
                        } catch {}
                    }
                });
                peer.on('connection', (connection) => {
                    // 对方连接过来
                    if (conn) {
                        // 已有连接，关闭旧的
                        try { conn.close(); } catch {}
                    }
                    conn = connection;
                    setupConnection(conn, false);
                });
                peer.on('disconnected', () => {
                    // PeerJS 与信令服务器断开，尝试重连
                    if (peer && !peer.destroyed) {
                        try { peer.reconnect(); } catch {}
                    }
                });
                peer.on('error', (err) => {
                    console.warn('[online] Peer error:', err.type, err.message || '');
                    if (err.type === 'unavailable-id') {
                        showFloatTip('⚠️ ' + (currentIdentity === 'yaya' ? '芽芽' : '瑶瑶') + ' 已在线，正在加入...');
                    } else if (err.type === 'network' || err.type === 'server-error') {
                        // 网络问题，10 秒后重试
                        scheduleReconnect();
                    }
                });
                peer.on('close', () => {
                    peerOpen = false;
                    updateOnlineIndicator(0);
                    scheduleReconnect();
                });
            } catch (err) {
                console.warn('[online] PeerJS init failed:', err.message);
            }
        })();
    }
    function setupConnection(connection, isInitiator) {
        connection.on('open', () => {
            // 连接建立，发送自己的 identity + page
            try {
                connection.send(JSON.stringify({ type: 'sys', action: 'identify', identity: currentIdentity, peerId: getPeerId(), timestamp: Date.now() }));
                connection.send(JSON.stringify({ type: 'page_change', page: getPageName(), timestamp: Date.now() }));
                isConnected = true;
                lastPeerActivity = Date.now();
                updateOnlineIndicator(2);
                showFloatTip('💕 已连接 ' + getOtherName());
            } catch (e) { console.warn('[online] send identify failed', e); }
        });
        connection.on('data', (data) => {
            try {
                if (typeof data === 'string') handleMessage(JSON.parse(data), false);
            } catch (e) { /* ignore non-JSON */ }
        });
        connection.on('close', () => {
            if (isConnected) {
                isConnected = false;
                updateOnlineIndicator(1);
                showFloatTip('👋 ' + getOtherName() + ' 离开了');
            }
            if (conn === connection) conn = null;
            scheduleReconnect();
        });
        connection.on('error', (err) => {
            console.warn('[online] conn error', err.type || err);
        });
    }
    function tryConnectToOther() {
        if (!peer || !peerOpen) return;
        if (conn && conn.open) return; // 已有连接
        const other = getOtherPeerId();
        try {
            const c = peer.connect(other, { reliable: true });
            // 临时挂着，等 open 后接管
            c.on('open', () => {
                if (conn && conn.open && conn !== c) {
                    try { c.close(); } catch {}
                    return;
                }
                conn = c;
                setupConnection(c, true);
            });
            c.on('error', (err) => {
                // 对方不在线或连接失败，10 秒后重试
                scheduleReconnect();
            });
        } catch (e) {
            scheduleReconnect();
        }
    }
    function scheduleReconnect() {
        if (reconnectTimer) return;
        if (!currentIdentity) return;
        reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            tryConnectToOther();
        }, 10000);
    }

    // ====== 对端活跃检测 ======
    function startPresenceTimer() {
        if (peerPresenceTimer) clearInterval(peerPresenceTimer);
        peerPresenceTimer = setInterval(() => {
            if (!isConnected || !currentIdentity) return;
            const idle = Date.now() - lastPeerActivity;
            if (idle > 20000) {
                // 20 秒没动静，可能是对方断网
                isConnected = false;
                updateOnlineIndicator(1);
                showFloatTip('👋 ' + getOtherName() + ' 离开了');
                if (conn) { try { conn.close(); } catch {} conn = null; }
                tryConnectToOther();
            }
        }, 5000);
    }

    // ====== 消息分发 ======
    function handleMessage(data, viaBroadcast) {
        if (!data || !data.type) return;
        if (data.identity && data.identity === currentIdentity) return; // 忽略自己
        lastPeerActivity = Date.now();
        if (data.type === 'sys') {
            if (data.action === 'identify') {
                // 对方标识自己，确认连接
                isConnected = true;
                updateOnlineIndicator(2);
                showFloatTip('💕 ' + getOtherName() + ' 已连接');
            } else if (data.action === 'presence') {
                // 对方在 broadcast 说自己在线
                isConnected = true;
                updateOnlineIndicator(2);
                showFloatTip('💕 ' + getOtherName() + ' 在附近');
            } else if (data.action === 'ping') {
                replyToSender({ type: 'sys', action: 'pong' }, viaBroadcast);
                isConnected = true;
                updateOnlineIndicator(2);
            } else if (data.action === 'pong') {
                isConnected = true;
                updateOnlineIndicator(2);
            } else if (data.action === 'user_leave') {
                if (isConnected) {
                    isConnected = false;
                    updateOnlineIndicator(1);
                    showFloatTip('👋 ' + getOtherName() + ' 离开了');
                }
            }
        }
        if (messageHandlers[data.type]) {
            messageHandlers[data.type].forEach(h => h(data));
        }
        window.dispatchEvent(new CustomEvent('online-message', { detail: data }));
    }
    function replyToSender(payload, viaBroadcast) {
        const text = JSON.stringify(payload);
        if (viaBroadcast) {
            if (channel) { try { channel.postMessage(payload); } catch {} }
        } else {
            if (conn && conn.open) { try { conn.send(text); } catch {} }
            if (channel) { try { channel.postMessage(payload); } catch {} }
        }
    }
    function send(data) {
        const text = typeof data === 'string' ? data : JSON.stringify(data);
        if (conn && conn.open) {
            try { conn.send(text); } catch {}
        }
        if (channel) {
            try { channel.postMessage(typeof data === 'string' ? JSON.parse(text) : data); } catch {}
        }
    }

    // ====== 状态回调 ======
    const statusCallbacks = [];
    function onStatusChange(cb) { statusCallbacks.push(cb); }

    // ====== UI ======
    function updateOnlineIndicator(count) {
        const indicator = document.getElementById('onlineIndicator');
        if (!indicator) return;
        const dot = indicator.querySelector('.online-dot');
        const text = indicator.querySelector('.online-text');
        if (count >= 2) {
            dot.style.background = '#ff6b9d';
            dot.style.boxShadow = '0 0 10px #ff6b9d';
            text.textContent = (currentIdentity === 'yaya' ? '芽芽' : '瑶瑶') + ' · 已连接 ' + getOtherName();
            text.style.color = '#ff6b9d';
        } else if (count === 1) {
            dot.style.background = '#ffd700';
            dot.style.boxShadow = '0 0 10px #ffd700';
            text.textContent = (currentIdentity === 'yaya' ? '芽芽' : '瑶瑶') + ' · 等待 ' + getOtherName();
            text.style.color = '#ffd700';
        } else {
            dot.style.background = '#666';
            dot.style.boxShadow = 'none';
            text.textContent = currentIdentity ? ((currentIdentity === 'yaya' ? '芽芽' : '瑶瑶') + ' · 离线') : '未登录';
            text.style.color = 'rgba(255,255,255,0.7)';
        }
    }
    function createOnlineIndicator() {
        if (document.getElementById('onlineIndicator')) return;
        const indicator = document.createElement('div');
        indicator.id = 'onlineIndicator';
        indicator.style.cssText = 'position:fixed;bottom:20px;right:20px;display:flex;align-items:center;gap:6px;background:rgba(10,10,40,0.7);padding:6px 14px;border-radius:20px;z-index:50;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.2);font-size:0.75rem;cursor:pointer;';
        indicator.innerHTML = '<span class="online-dot" style="width:8px;height:8px;border-radius:50%;background:#666;transition:all 0.3s;"></span><span class="online-text" style="color:rgba(255,255,255,0.7);">未登录</span>';
        document.body.appendChild(indicator);
        if (window.innerWidth <= 768) {
            indicator.style.bottom = '70px';
        }
        // 点击切换身份
        indicator.addEventListener('click', () => {
            if (confirm('要切换身份吗？')) {
                logout();
                window.location.reload();
            }
        });
    }
    function showFloatTip(text) {
        const existing = document.querySelector('.float-tip');
        if (existing) existing.remove();
        const tip = document.createElement('div');
        tip.className = 'float-tip';
        tip.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:rgba(10,10,40,0.9);color:#fff;padding:8px 20px;border-radius:20px;font-size:0.85rem;z-index:9999;backdrop-filter:blur(10px);border:1px solid rgba(255,107,157,0.4);animation:tipSlide 0.5s ease;white-space:nowrap;';
        tip.textContent = text;
        document.body.appendChild(tip);
        setTimeout(() => {
            tip.style.transition = 'opacity 0.5s, transform 0.5s';
            tip.style.opacity = '0';
            tip.style.transform = 'translateX(-50%) translateY(-20px)';
            setTimeout(() => tip.remove(), 500);
        }, 3000);
    }
    function notifyPageChange() {
        send({ type: 'page_change', page: getPageName(), timestamp: Date.now() });
    }

    // ====== 登录界面 ======
    function showLoginScreen() {
        if (document.getElementById('loginScreen')) return;
        const screen = document.createElement('div');
        screen.id = 'loginScreen';
        screen.style.cssText = 'position:fixed;inset:0;z-index:10000;background:radial-gradient(ellipse at center, #1a0a3e 0%, #05051f 60%, #000 100%);display:flex;align-items:center;justify-content:center;flex-direction:column;padding:20px;backdrop-filter:blur(20px);';
        screen.innerHTML = `
            <div style="text-align:center;max-width:360px;width:100%;">
                <div style="font-size:2.5rem;background:linear-gradient(90deg,#ff6b9d,#c44dff,#ffd700);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;margin-bottom:8px;font-weight:bold;">七 夕 快 乐</div>
                <div style="color:rgba(255,255,255,0.6);font-size:0.85rem;margin-bottom:40px;">✨ 选择你的身份进入星河 ✨</div>
                <div style="display:flex;gap:16px;justify-content:center;margin-bottom:24px;">
                    <div class="login-identity" data-id="yaya" style="flex:1;padding:24px 12px;background:rgba(255,107,157,0.1);border:2px solid rgba(255,107,157,0.3);border-radius:20px;cursor:pointer;transition:all 0.3s;text-align:center;">
                        <div style="font-size:3rem;margin-bottom:8px;">🌸</div>
                        <div style="color:#ff6b9d;font-size:1.2rem;font-weight:bold;">芽 芽</div>
                    </div>
                    <div class="login-identity" data-id="yaoyao" style="flex:1;padding:24px 12px;background:rgba(196,77,255,0.1);border:2px solid rgba(196,77,255,0.3);border-radius:20px;cursor:pointer;transition:all 0.3s;text-align:center;">
                        <div style="font-size:3rem;margin-bottom:8px;">🌙</div>
                        <div style="color:#c44dff;font-size:1.2rem;font-weight:bold;">瑶 瑶</div>
                    </div>
                </div>
                <input type="password" id="loginPassword" placeholder="输入密码" maxlength="4" style="width:100%;padding:14px;background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.2);border-radius:12px;color:#fff;font-size:1rem;text-align:center;letter-spacing:8px;outline:none;margin-bottom:16px;box-sizing:border-box;">
                <button id="loginSubmit" style="width:100%;padding:14px;background:linear-gradient(90deg,#ff6b9d,#c44dff);border:none;border-radius:12px;color:#fff;font-size:1.05rem;font-weight:bold;cursor:pointer;letter-spacing:4px;transition:transform 0.2s;">进入星河</button>
                <div id="loginError" style="color:#ff6b9d;font-size:0.85rem;margin-top:12px;min-height:20px;"></div>
            </div>
        `;
        document.body.appendChild(screen);
        let chosen = 'yaya';
        function pick(id) {
            chosen = id;
            document.querySelectorAll('.login-identity').forEach(el => {
                const isMe = el.dataset.id === id;
                el.style.background = isMe ? (id === 'yaya' ? 'rgba(255,107,157,0.3)' : 'rgba(196,77,255,0.3)') : (id === 'yaya' ? 'rgba(196,77,255,0.05)' : 'rgba(255,107,157,0.05)');
                el.style.borderColor = isMe ? (id === 'yaya' ? '#ff6b9d' : '#c44dff') : 'rgba(255,255,255,0.1)';
                el.style.transform = isMe ? 'scale(1.05)' : 'scale(1)';
            });
        }
        pick('yaya');
        document.querySelectorAll('.login-identity').forEach(el => {
            el.addEventListener('click', () => pick(el.dataset.id));
        });
        const pwdInput = document.getElementById('loginPassword');
        const submit = document.getElementById('loginSubmit');
        function doLogin() {
            const pwd = pwdInput.value.trim();
            const result = login(chosen, pwd);
            if (result.ok) {
                document.getElementById('loginError').textContent = '';
                screen.style.transition = 'opacity 0.5s';
                screen.style.opacity = '0';
                setTimeout(() => screen.remove(), 500);
            } else {
                document.getElementById('loginError').textContent = result.error || '登录失败';
                pwdInput.value = '';
                pwdInput.focus();
            }
        }
        submit.addEventListener('click', doLogin);
        pwdInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') doLogin(); });
        setTimeout(() => pwdInput.focus(), 300);
    }

    // ====== 暴露 API ======
    window.Online = {
        // 登录相关
        login, logout, isLoggedIn, getIdentity,
        // 兼容旧 API（不再使用，但保留以防页面出错）
        connect: async (room, code) => false,
        createRoom: async (room, code) => false,
        joinRoom: async (room, code) => false,
        send, onMessage, onStatusChange,
        notifyPageChange,
        getRoomId: () => null,        // 永久房间，无 URL 参数
        generateRoomId: () => null,
        generatePasscode: () => null,
        getPageName,
        isConnected: () => isConnected,
        isHost: () => false,           // 兼容
        getOtherName,
        onReady: (cb) => { readyCallbacks.push(cb); if (initDone) cb(); },
        _debug: () => ({
            identity: currentIdentity,
            isConnected, peerOpen, hasChannel: !!channel,
            peerId: currentIdentity ? getPeerId() : null,
            otherPeerId: currentIdentity ? getOtherPeerId() : null,
            lastPeerActivity
        })
    };

    // ====== 初始化 ======
    function init() {
        createOnlineIndicator();
        // 尝试从 localStorage 恢复身份
        const saved = loadIdentity();
        if (saved) {
            currentIdentity = saved;
            updateOnlineIndicator(1);
            startConnection();
        } else {
            // 显示登录界面
            showLoginScreen();
        }
        initDone = true;
        readyCallbacks.forEach(cb => { try { cb(); } catch(e){} });
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    const style = document.createElement('style');
    style.textContent = '@keyframes tipSlide{from{opacity:0;transform:translateX(-50%) translateY(-15px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
    document.head.appendChild(style);

    window.addEventListener('beforeunload', () => {
        send({ type: 'sys', action: 'user_leave' });
    });
})();
