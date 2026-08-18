/* ============================================
   星河之旅 · 七夕特典 — 联机客户端 v3
   双通道：BroadcastChannel(同设备) + PeerJS(跨设备)
   修复 v3：
   - Host 收到任何通道的 auth 都验证并回确认（用对应通道回信）
   - Guest 收到任何通道的 user_join 都视为已连接
   - 双向状态实时同步（任何消息都刷新对端活跃时间戳）
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
        let name = path.split('/').filter(Boolean).pop() || 'index';
        name = name.replace('.html', '');
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
    let peerOpen = false;  // PeerJS 是否已 open
    let roomId = null;
    let passcode = null;
    let isHost = false;
    let channel = null;    // BroadcastChannel
    let lastPeerActivity = 0; // 对端最后活跃时间
    let peerPresenceTimer = null;

    // 消息处理器
    const messageHandlers = {};
    function onMessage(type, handler) {
        if (!messageHandlers[type]) messageHandlers[type] = [];
        messageHandlers[type].push(handler);
    }

    // 通用回信：能走 PeerJS 走 PeerJS，否则走 broadcast
    function replyToSender(payload, viaBroadcast) {
        const text = JSON.stringify(payload);
        if (viaBroadcast) {
            if (channel) { try { channel.postMessage(payload); } catch {} }
        } else {
            const target = (isHost ? incomingConn : conn);
            if (target && target.open) {
                try { target.send(text); } catch {}
            }
            // 兜底也走 broadcast
            if (channel) { try { channel.postMessage(payload); } catch {} }
        }
    }

    function markPeerActive() {
        lastPeerActivity = Date.now();
    }

    function handleMessage(data, viaBroadcast) {
        if (!data || !data.type) return;
        // 通过任一通道收到对端消息都视为活跃
        markPeerActive();
        // 系统消息
        if (data.type === 'sys') {
            if (data.action === 'user_join') {
                if (!isConnected) {
                    isConnected = true;
                    updateOnlineIndicator(2);
                    if (isHost) showFloatTip('💕 TA 来了');
                    else showFloatTip('💕 已连接到房间');
                }
                return;
            }
            if (data.action === 'user_leave') {
                if (isConnected) {
                    isConnected = false;
                    updateOnlineIndicator(1);
                    showFloatTip('👋 TA 离开了');
                }
                return;
            }
            if (data.action === 'pong') {
                if (!isConnected) {
                    isConnected = true;
                    updateOnlineIndicator(2);
                }
                return;
            }
            if (data.action === 'ping') {
                replyToSender({ type: 'sys', action: 'pong' }, viaBroadcast);
                if (!isConnected) {
                    isConnected = true;
                    updateOnlineIndicator(2);
                }
                return;
            }
            return;
        }
        // 认证
        if (data.type === 'auth') {
            if (isHost) {
                if (data.passcode !== passcode) {
                    showFloatTip('⚠️ 邀请码错误');
                    return;
                }
                // 验证通过
                if (!isConnected) {
                    isConnected = true;
                    updateOnlineIndicator(2);
                    showFloatTip('💕 TA 来了');
                }
                // 回信（用对应通道）
                replyToSender({ type: 'sys', action: 'user_join' }, viaBroadcast);
                // 主动通知对方我现在所在页面
                replyToSender({ type: 'page_change', page: getPageName(), timestamp: Date.now() }, viaBroadcast);
                // 再 ping 一次让对方也 set isConnected
                setTimeout(() => {
                    replyToSender({ type: 'sys', action: 'ping' }, viaBroadcast);
                }, 300);
            } else {
                // Guest 收到 auth 回应（理论上不会）
            }
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
            if (channel) return;
            channel = new BroadcastChannel('qixi-room');
            channel.onmessage = (e) => {
                const data = e.data;
                if (!data) return;
                handleMessage(data, true);
            };
        } catch {
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
        isConnected = false;

        initBroadcast();

        // 用 BroadcastChannel 通知同设备（如果对方已经 postMessage auth 过了就太迟，
        // 但 Host 创建后 Guest 才能 join，所以这条主要是给已经在等待的 Guest 触发）
        if (channel) {
            channel.postMessage({ type: 'sys', action: 'host_ready', roomId: room, timestamp: Date.now() });
        }

        // 启动 PeerJS（异步，不阻塞）
        tryPeerJSAsHost();

        // 启动对端活跃检测
        startPresenceTimer();

        return true;
    }

    function tryPeerJSAsHost() {
        // 异步加载 PeerJS，不阻塞 UI
        (async () => {
            try {
                if (!window.Peer) {
                    await loadScript('https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js');
                }
                peer = new Peer(roomId, {
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
                });

                peer.on('connection', (connection) => {
                    incomingConn = connection;
                    connection.on('open', () => {
                        // 等对方发 auth
                    });
                    connection.on('data', (data) => {
                        try {
                            if (typeof data === 'string') handleMessage(JSON.parse(data), false);
                        } catch {}
                    });
                    connection.on('close', () => {
                        if (isConnected) {
                            isConnected = false;
                            updateOnlineIndicator(1);
                            showFloatTip('👋 TA 离开了');
                        }
                        incomingConn = null;
                    });
                    connection.on('error', () => {});
                });

                peer.on('error', (err) => {
                    console.warn('[online] Peer error:', err.type);
                });
            } catch (err) {
                console.warn('[online] PeerJS init failed, BroadcastChannel only:', err.message);
            }
        })();
    }

    // ====== 加入房间（Guest） ======
    async function joinRoom(room, code) {
        roomId = room;
        passcode = code;
        isHost = false;
        isConnected = false;

        initBroadcast();

        // 通过 BroadcastChannel 尝试（最关键，同设备方案）
        if (channel) {
            channel.postMessage({
                type: 'auth',
                passcode: code,
                timestamp: Date.now()
            });
            // 3秒后没收到回信则重试一次
            setTimeout(() => {
                if (!isConnected) {
                    channel.postMessage({ type: 'auth', passcode: code, timestamp: Date.now() });
                }
            }, 3000);
        }

        // 同时启动 PeerJS 尝试跨设备连接
        tryPeerJSAsGuest();

        // 启动对端活跃检测
        startPresenceTimer();

        return true;
    }

    function tryPeerJSAsGuest() {
        (async () => {
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
                    }
                });

                peer.on('open', () => {
                    peerOpen = true;
                    conn = peer.connect(roomId, { reliable: true });
                    conn.on('open', () => {
                        // 发送 auth
                        try { conn.send(JSON.stringify({ type: 'auth', passcode: passcode })); } catch {}
                        try { conn.send(JSON.stringify({ type: 'page_change', page: getPageName(), timestamp: Date.now() })); } catch {}
                    });
                    conn.on('data', (data) => {
                        try {
                            if (typeof data === 'string') handleMessage(JSON.parse(data), false);
                        } catch {}
                    });
                    conn.on('close', () => {
                        if (isConnected) {
                            isConnected = false;
                            updateOnlineIndicator(1);
                            showFloatTip('👋 连接断开');
                        }
                        conn = null;
                    });
                    conn.on('error', () => {});
                });

                peer.on('error', (err) => {
                    console.warn('[online] Peer error:', err.type);
                });
            } catch (err) {
                console.warn('[online] PeerJS init failed:', err.message);
            }
        })();
    }

    // ====== 对端活跃检测（任意通道收到消息都会刷新，超时则视为离开） ======
    function startPresenceTimer() {
        if (peerPresenceTimer) clearInterval(peerPresenceTimer);
        peerPresenceTimer = setInterval(() => {
            if (!isConnected) return;
            const idle = Date.now() - lastPeerActivity;
            if (idle > 15000) { // 15 秒无消息视为掉线
                isConnected = false;
                updateOnlineIndicator(1);
                showFloatTip('👋 TA 离开了');
            }
        }, 5000);
    }

    // ====== 统一连接入口 ======
    async function connect(room, code) {
        return joinRoom(room, code);
    }

    // ====== 发送消息 ======
    function send(data) {
        // 通过 PeerJS
        const target = (isHost ? incomingConn : conn);
        if (target && target.open) {
            try { target.send(typeof data === 'string' ? data : JSON.stringify(data)); } catch {}
        }
        // 同时通过 BroadcastChannel
        if (channel) {
            try { channel.postMessage(typeof data === 'string' ? JSON.parse(data) : data); } catch {}
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
        } else {
            dot.style.background = '#666';
            dot.style.boxShadow = 'none';
            text.textContent = '未连接';
            text.style.color = 'rgba(255,255,255,0.7)';
        }
    }

    function createOnlineIndicator() {
        // 避免重复创建
        if (document.getElementById('onlineIndicator')) return;
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
        getPageName,
        isConnected: () => isConnected,
        isHost: () => isHost,
        getRoomId: () => roomId,
        _debug: () => ({ isHost, isConnected, roomId, peerOpen, hasChannel: !!channel, lastPeerActivity })
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
