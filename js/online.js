/* ============================================
   星河之旅 · 七夕特典 — 联机客户端 v2
   双通道：BroadcastChannel(同设备) + PeerJS(跨设备)
   修复：页面跳转不断连、消息可靠投递
   ============================================ */

(function() {
    'use strict';

    // ====== 工具函数 ======
    function getRoomId() {
        const params = new URLSearchParams(window.location.search);
        return params.get('room');
    }
    function generateRoomId() {
        return 'qixi-' + Math.random().toString(36).substring(2, 8);
    }
    function generatePasscode() {
        return Math.floor(1000 + Math.random() * 9000).toString();
    }
    function getPageName() {
        const path = window.location.pathname;
        const name = path.split('/').pop().replace('.html', '');
        const pageMap = {
            'index': '星河入口', 'meet': '初见馆', 'memories': '回忆册',
            'love': '告白屋', 'wish': '心愿星', 'secret': '秘密匣'
        };
        return pageMap[name] || name;
    }

    // ====== 状态 ======
    let peer = null;
    let conn = null;       // Guest→Host 的 DataConnection
    let incomingConn = null; // Host←Guest 的 DataConnection
    let isConnected = false;
    let roomId = null;
    let passcode = null;
    let isHost = false;
    let channel = null;   // BroadcastChannel
    let peerReady = false; // PeerJS 是否已 open

    // 消息处理器
    const messageHandlers = {};
    function onMessage(type, handler) {
        if (!messageHandlers[type]) messageHandlers[type] = [];
        messageHandlers[type].push(handler);
    }

    function handleMessage(data) {
        // 系统消息
        if (data.type === 'sys') {
            if (data.action === 'user_join') {
                updateOnlineIndicator(2);
                showFloatTip('💕 TA 来了');
            }
            return;
        }
        // 认证
        if (data.type === 'auth' && isHost) {
            if (data.passcode !== passcode) {
                showFloatTip('⚠️ 邀请码错误');
                if (incomingConn) { try { incomingConn.close(); } catch {} }
                return;
            }
            if (incomingConn && incomingConn.open) {
                incomingConn.send(JSON.stringify({ type: 'sys', action: 'user_join' }));
            }
            updateOnlineIndicator(2);
            showFloatTip('💕 TA 来了');
            return;
        }
        // 调用注册处理器
        if (messageHandlers[data.type]) {
            messageHandlers[data.type].forEach(h => h(data));
        }
        // 全局事件
        window.dispatchEvent(new CustomEvent('online-message', { detail: data }));
    }

    // ====== BroadcastChannel（同设备双标签页） ======
    function initBroadcast() {
        try {
            channel = new BroadcastChannel('qixi-room');
            channel.onmessage = (e) => {
                const data = e.data;
                if (!data || !data.type) return;
                handleMessage(data);
            };
        } catch {
            // 不支持 BroadcastChannel 的浏览器降级
            channel = null;
        }
    }

    // ====== 动态加载脚本 ======
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    // ====== 创建房间（Host） ======
    async function createRoom(room, code) {
        roomId = room;
        passcode = code;
        isHost = true;

        initBroadcast();

        // 先用 BroadcastChannel 通知同设备
        if (channel) {
            channel.postMessage({ type: 'sys', action: 'host_ready', roomId: room });
        }

        try {
            if (!window.Peer) {
                await loadScript('https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js');
            }

            peer = new Peer(room, {
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.google.com:19302' }
                    ]
                },
                debug: 1
            });

            peer.on('open', () => {
                peerReady = true;
                updateOnlineIndicator(1);
            });

            peer.on('connection', (connection) => {
                incomingConn = connection;
                connection.on('open', () => {
                    updateOnlineIndicator(2);
                });
                connection.on('data', (data) => {
                    try {
                        if (typeof data === 'string') {
                            handleMessage(JSON.parse(data));
                        }
                    } catch {}
                });
                connection.on('close', () => {
                    updateOnlineIndicator(1);
                    showFloatTip('👋 TA 离开了');
                });
                connection.on('error', () => {});
            });

            peer.on('error', (err) => {
                console.error('[online] Peer error:', err.type, err.message);
                if (err.type === 'unavailable-id') {
                    showFloatTip('⚠️ 房间号被占用，请重新创建');
                } else if (err.type === 'network' || err.type === 'server-error') {
                    showFloatTip('⚠️ 网络不稳，跨设备联机可能受影响');
                    // 仍然可以通过 BroadcastChannel 同设备联机
                    peerReady = false;
                }
            });

            return true;
        } catch (err) {
            console.error('[online] 创建房间失败:', err);
            // PeerJS 加载失败，仍然可以用 BroadcastChannel
            return true;
        }
    }

    // ====== 加入房间（Guest） ======
    async function joinRoom(room, code) {
        roomId = room;
        passcode = code;
        isHost = false;

        initBroadcast();

        // 先通过 BroadcastChannel 尝试连接同设备 Host
        if (channel) {
            channel.postMessage({
                type: 'auth',
                passcode: code,
                _via: 'broadcast'
            });
            // 通知 Host 我来了
            channel.postMessage({
                type: 'page_change',
                page: getPageName(),
                timestamp: Date.now()
            });
        }

        try {
            if (!window.Peer) {
                await loadScript('https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js');
            }

            peer = new Peer({
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' },
                        { urls: 'stun:stun2.google.com:19302' }
                    ]
                },
                debug: 1
            });

            peer.on('open', () => {
                peerReady = true;
                conn = peer.connect(room, { reliable: true });

                conn.on('open', () => {
                    isConnected = true;
                    conn.send(JSON.stringify({ type: 'auth', passcode: code }));
                    conn.send(JSON.stringify({
                        type: 'page_change',
                        page: getPageName(),
                        timestamp: Date.now()
                    }));
                    updateOnlineIndicator(2);
                    showFloatTip('💕 已连接到房间');
                });

                conn.on('data', (data) => {
                    try {
                        if (typeof data === 'string') {
                            handleMessage(JSON.parse(data));
                        }
                    } catch {}
                });

                conn.on('close', () => {
                    isConnected = false;
                    updateOnlineIndicator(1);
                    showFloatTip('👋 连接断开');
                });

                conn.on('error', () => {
                    isConnected = false;
                    updateOnlineIndicator(1);
                });

                // 超时检测：5 秒内没连上则提示
                setTimeout(() => {
                    if (!isConnected) {
                        showFloatTip('⏳ 跨设备连接中...同设备可直接用');
                        // 尝试通过 BroadcastChannel 确认
                        if (channel) {
                            channel.postMessage({ type: 'sys', action: 'guest_waiting' });
                        }
                    }
                }, 5000);
            });

            peer.on('error', (err) => {
                console.error('[online] Peer error:', err.type, err.message);
                if (err.type === 'peer-unavailable') {
                    showFloatTip('⚠️ 对方不在线或网络不通');
                } else if (err.type === 'network' || err.type === 'server-error') {
                    showFloatTip('⚠️ 跨设备网络受限，同设备仍可用');
                    peerReady = false;
                }
            });

            return true;
        } catch (err) {
            console.error('[online] 加入失败:', err);
            // PeerJS 加载失败，仍可用 BroadcastChannel
            return true;
        }
    }

    // ====== 统一连接入口 ======
    async function connect(room, code) {
        return joinRoom(room, code);
    }

    // ====== 发送消息 ======
    function send(data) {
        const payload = (typeof data === 'string') ? data : JSON.stringify(data);
        // 优先 PeerJS
        const target = conn || incomingConn;
        if (target && target.open) {
            try { target.send(payload); } catch {}
        }
        // 同时通过 BroadcastChannel（同设备双开时兜底）
        if (channel) {
            try {
                channel.postMessage(typeof data === 'string' ? data : data);
            } catch {}
        }
    }

    // ====== 状态回调 ======
    const statusCallbacks = [];
    function onStatusChange(cb) { statusCallbacks.push(cb); }
    function notifyStatus(online, count) {
        statusCallbacks.forEach(cb => cb(online, count));
    }

    // ====== UI：在线指示器 ======
    function updateOnlineIndicator(count) {
        const indicator = document.getElementById('onlineIndicator');
        if (!indicator) return;
        const dot = indicator.querySelector('.online-dot');
        const text = indicator.querySelector('.online-text');
        if (count >= 2) {
            dot.style.background = '#ff6b9d';
            dot.style.boxShadow = '0 0 10px #ff6b9d';
            text.textContent = '双人在线';
            text.style.color = '#ff6b9d';
        } else if (count === 1) {
            dot.style.background = '#ffd700';
            dot.style.boxShadow = '0 0 10px #ffd700';
            text.textContent = isHost ? '等待TA' : '连接中';
            text.style.color = '#ffd700';
        }
    }

    function createOnlineIndicator() {
        const indicator = document.createElement('div');
        indicator.id = 'onlineIndicator';
        indicator.style.cssText = 'position:fixed;bottom:20px;right:20px;display:flex;align-items:center;gap:6px;background:rgba(10,10,40,0.7);padding:6px 14px;border-radius:20px;z-index:50;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);border:1px solid rgba(255,255,255,0.2);font-size:0.75rem;';
        indicator.innerHTML = '<span class="online-dot" style="width:8px;height:8px;border-radius:50%;background:#666;transition:all 0.3s;"></span><span class="online-text" style="color:rgba(255,255,255,0.7);">未连接</span>';
        document.body.appendChild(indicator);
        if (window.innerWidth <= 768) {
            indicator.style.bottom = '70px';
        }
    }

    // ====== UI：浮动提示 ======
    function showFloatTip(text) {
        // 避免重复提示
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

    // ====== 页面通知 ======
    function notifyPageChange() {
        send({ type: 'page_change', page: getPageName(), timestamp: Date.now() });
    }

    // ====== 暴露 API ======
    window.Online = {
        connect, createRoom, joinRoom, send, onMessage, onStatusChange,
        notifyPageChange, getRoomId, generateRoomId, generatePasscode,
        getPageName, isConnected: () => isConnected, isHost: () => isHost
    };

    // ====== 初始化 ======
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createOnlineIndicator);
    } else {
        createOnlineIndicator();
    }

    const style = document.createElement('style');
    style.textContent = '@keyframes tipSlide{from{opacity:0;transform:translateX(-50%) translateY(-15px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
    document.head.appendChild(style);

    // ====== 页面卸载时通知对方 ======
    window.addEventListener('beforeunload', () => {
        send({ type: 'sys', action: 'user_leave' });
    });
})();
