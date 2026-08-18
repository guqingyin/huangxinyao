/* ============================================
   星河之旅 · 七夕特典 — 联机客户端
   功能：WebSocket 连接、房间管理、实时同步
   依赖：PartyKit client SDK
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
        return Math.random().toString(36).substring(2, 8);
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

    // PartyKit 连接对象
    let connection = null;
    let isConnected = false;
    let roomId = null;
    let passcode = null;

    // PartyKit 房间密码验证（前端校验，服务端 KV 存储）
    const PARTYKIT_HOST = 'huangxinyao.partykit.dev';

    // 连接状态回调
    const statusCallbacks = [];

    function onStatusChange(cb) {
        statusCallbacks.push(cb);
    }

    function notifyStatus(online, count) {
        statusCallbacks.forEach(cb => cb(online, count));
    }

    // 连接房间
    async function connect(room, code) {
        roomId = room;
        passcode = code;

        try {
            // 动态加载 PartyKit SDK
            if (!window.PartySocket) {
                await loadScript('https://cdn.jsdelivr.net/npm/partysocket@1.0.0/bundle.js');
            }

            connection = new PartySocket({
                host: PARTYKIT_HOST,
                room: room
            });

            connection.addEventListener('open', () => {
                isConnected = true;
                // 验证邀请码
                connection.send(JSON.stringify({
                    type: 'auth',
                    passcode: code
                }));
                // 通知当前页面
                connection.send(JSON.stringify({
                    type: 'page_change',
                    page: getPageName(),
                    timestamp: Date.now()
                }));
                // 加载持久化数据
                connection.send(JSON.stringify({
                    type: 'load',
                    store: 'wishes'
                }));
                connection.send(JSON.stringify({
                    type: 'load',
                    store: 'love_notes'
                }));
                connection.send(JSON.stringify({
                    type: 'load',
                    store: 'timeline'
                }));
                notifyStatus(true, 2);
            });

            connection.addEventListener('message', (e) => {
                try {
                    const data = JSON.parse(e.data);
                    handleMessage(data);
                } catch {}
            });

            connection.addEventListener('close', () => {
                isConnected = false;
                notifyStatus(false, 0);
            });

            return true;
        } catch (err) {
            console.error('[online] 连接失败:', err);
            return false;
        }
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

    // 消息处理
    const messageHandlers = {};

    function onMessage(type, handler) {
        if (!messageHandlers[type]) messageHandlers[type] = [];
        messageHandlers[type].push(handler);
    }

    function handleMessage(data) {
        // 系统消息
        if (data.type === 'sys') {
            if (data.action === 'joined') {
                updateOnlineIndicator(data.onlineCount);
            } else if (data.action === 'user_join') {
                updateOnlineIndicator(data.onlineCount);
                showFloatTip('💕 TA 来了');
            } else if (data.action === 'user_leave') {
                updateOnlineIndicator(data.onlineCount || 1);
                showFloatTip('👋 TA 离开了');
            }
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
        if (connection && isConnected) {
            connection.send(JSON.stringify(data));
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

        // 移动端位置调整
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
        send,
        onMessage,
        onStatusChange,
        notifyPageChange,
        getRoomId,
        generateRoomId,
        generatePasscode,
        getPageName,
        isConnected: () => isConnected
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
