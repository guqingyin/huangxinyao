/* ============================================
   星河之旅 · 七夕特典 — 联机客户端 (PeerJS)
   基于 WebRTC P2P，无需服务端部署
   ============================================ */

(function() {
    'use strict';

    // 从 URL 获取房间号
    function getRoomId() {
        const params = new URLSearchParams(window.location.search);
        return params.get('room');
    }

    // 生成随机房间号
    function generateRoomId() {
        return 'qixi-' + Math.random().toString(36).substring(2, 8);
    }

    // 生成 4 位邀请码
    function generatePasscode() {
        return Math.floor(1000 + Math.random() * 9000).toString();
    }

    // 获取页面名
    function getPageName() {
        const path = window.location.pathname;
        const name = path.split('/').pop().replace('.html', '');
        const pageMap = {
            'index': '星河入口',
            'meet': '初见馆',
            'memories': '回忆册',
            'love': '告白屋',
            'wish': '心愿星',
            'secret': '秘密匣'
        };
        return pageMap[name] || name;
    }

    // PeerJS 连接对象
    let peer = null;
    let conn = null;   // 主动连接对方的 DataConnection
    let incomingConn = null; // 对方连过来的 DataConnection
    let isConnected = false;
    let roomId = null;
    let passcode = null;
    let isHost = false;

    // 状态回调
    const statusCallbacks = [];
    function onStatusChange(cb) { statusCallbacks.push(cb); }
    function notifyStatus(online, count) {
        statusCallbacks.forEach(cb => cb(online, count));
    }

    // 动态加载脚本
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const s = document.createElement('script');
            s.src = src;
            s.onload = resolve;
            s.onerror = reject;
            document.head.appendChild(s);
        });
    }

    // 创建房间（作为 Host）
    async function createRoom(room, code) {
        roomId = room;
        passcode = code;
        isHost = true;

        try {
            if (!window.Peer) {
                await loadScript('https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js');
            }

            peer = new Peer(room, {
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                }
            });

            peer.on('open', () => {
                isConnected = true;
                notifyStatus(true, 1);
                updateOnlineIndicator(1);
            });

            // 监听对方连入
            peer.on('connection', (connection) => {
                incomingConn = connection;
                setupConnection(connection);
            });

            peer.on('error', (err) => {
                console.error('[online] Peer error:', err);
                if (err.type === 'unavailable-id') {
                    showFloatTip('⚠️ 房间号已被占用，请重新创建');
                }
            });

            return true;
        } catch (err) {
            console.error('[online] 创建房间失败:', err);
            return false;
        }
    }

    // 加入房间（作为 Guest）
    async function joinRoom(room, code) {
        roomId = room;
        passcode = code;
        isHost = false;

        try {
            if (!window.Peer) {
                await loadScript('https://cdn.jsdelivr.net/npm/peerjs@1.5.4/dist/peerjs.min.js');
            }

            // Guest 用随机 ID
            peer = new Peer({
                config: {
                    iceServers: [
                        { urls: 'stun:stun.l.google.com:19302' },
                        { urls: 'stun:stun1.l.google.com:19302' }
                    ]
                }
            });

            peer.on('open', () => {
                // 主动连接 Host
                conn = peer.connect(room, { reliable: true });

                conn.on('open', () => {
                    isConnected = true;
                    // 验证邀请码
                    conn.send(JSON.stringify({
                        type: 'auth',
                        passcode: code
                    }));
                    // 通知当前页面
                    conn.send(JSON.stringify({
                        type: 'page_change',
                        page: getPageName(),
                        timestamp: Date.now()
                    }));
                    notifyStatus(true, 2);
                    updateOnlineIndicator(2);
                    showFloatTip('💕 已连接到房间');
                });

                setupConnection(conn);
            });

            peer.on('error', (err) => {
                console.error('[online] Peer error:', err);
                if (err.type === 'peer-unavailable') {
                    showFloatTip('⚠️ 房间不存在或对方未上线');
                    notifyStatus(false, 0);
                }
            });

            return true;
        } catch (err) {
            console.error('[online] 加入房间失败:', err);
            return false;
        }
    }

    // 设置 DataConnection 事件
    function setupConnection(connection) {
        connection.on('data', (data) => {
            try {
                if (typeof data === 'string') {
                    const msg = JSON.parse(data);
                    handleMessage(msg);
                }
            } catch {}
        });

        connection.on('close', () => {
            isConnected = false;
            updateOnlineIndicator(1);
            showFloatTip('👋 TA 离开了');
            notifyStatus(false, 0);
        });

        connection.on('error', (err) => {
            console.error('[online] Connection error:', err);
        });
    }

    // 统一连接入口
    async function connect(room, code) {
        if (isHost || (code && code.length === 4)) {
            // 有邀请码 → 可能是 join，但我们也支持 create
            // 实际上：如果 peer 已存在就是 host 模式，否则 join
            // 这里简化：如果 peer 不存在就创建，否则就加入
        }
        // 默认：创建房间用 createRoom，加入用 joinRoom
        // 外部调用者应该明确调用 createRoom 或 joinRoom
        // 这里为兼容旧接口，默认走 joinRoom
        return joinRoom(room, code);
    }

    // 消息处理
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

        // 认证验证（Host 端）
        if (data.type === 'auth' && isHost) {
            if (data.passcode !== passcode) {
                showFloatTip('⚠️ 邀请码错误');
                if (incomingConn) incomingConn.close();
                return;
            }
            // 验证通过，通知对方
            if (incomingConn) {
                incomingConn.send(JSON.stringify({
                    type: 'sys',
                    action: 'user_join'
                }));
            }
            updateOnlineIndicator(2);
            showFloatTip('💕 TA 来了');
            return;
        }

        // 调用注册的处理器
        if (messageHandlers[data.type]) {
            messageHandlers[data.type].forEach(h => h(data));
        }

        // 全局事件分发
        window.dispatchEvent(new CustomEvent('online-message', { detail: data }));
    }

    // 发送消息
    function send(data) {
        const target = conn || incomingConn;
        if (target && isConnected) {
            target.send(JSON.stringify(data));
        }
    }

    // 更新在线指示器
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
            text.textContent = '等待TA';
            text.style.color = '#ffd700';
        }
    }

    // 浮动提示
    function showFloatTip(text) {
        const tip = document.createElement('div');
        tip.style.cssText = 'position:fixed;top:60px;left:50%;transform:translateX(-50%);background:rgba(10,10,40,0.9);color:#fff;padding:8px 20px;border-radius:20px;font-size:0.85rem;z-index:9999;backdrop-filter:blur(10px);border:1px solid rgba(255,107,157,0.4);animation:tipSlide 0.5s ease;';
        tip.textContent = text;
        document.body.appendChild(tip);
        setTimeout(() => {
            tip.style.transition = 'opacity 0.5s, transform 0.5s';
            tip.style.opacity = '0';
            tip.style.transform = 'translateX(-50%) translateY(-20px)';
            setTimeout(() => tip.remove(), 500);
        }, 2500);
    }

    // 创建在线指示器 UI
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

    // 当前页面通知对方
    function notifyPageChange() {
        send({
            type: 'page_change',
            page: getPageName(),
            timestamp: Date.now()
        });
    }

    // 暴露 API
    window.Online = {
        connect,
        createRoom,
        joinRoom,
        send,
        onMessage,
        onStatusChange,
        notifyPageChange,
        getRoomId,
        generateRoomId,
        generatePasscode,
        getPageName,
        isConnected: () => isConnected,
        isHost: () => isHost
    };

    // 页面加载后创建指示器
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', createOnlineIndicator);
    } else {
        createOnlineIndicator();
    }

    // 添加提示动画样式
    const style = document.createElement('style');
    style.textContent = '@keyframes tipSlide{from{opacity:0;transform:translateX(-50%) translateY(-15px)}to{opacity:1;transform:translateX(-50%) translateY(0)}}';
    document.head.appendChild(style);
})();
