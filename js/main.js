/* ============================================
   星河之旅 · 七夕特典 — 公共脚本
   模块：星空背景、流星、粒子效果、光标、音乐
   适用于所有一级/二级页面
   ============================================ */

(function() {
    'use strict';

    /* ---------- 模块：基础工具函数 ---------- */
    const DPR = Math.min(window.devicePixelRatio || 1, 2);
    const TAU = Math.PI * 2;
    const W = () => window.innerWidth;
    const H = () => window.innerHeight;
    const rand = (a, b) => a + Math.random() * (b - a);
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

    /* ---------- 模块：Canvas 初始化 ---------- */
    function setupCanvas(cv) {
        const ctx = cv.getContext('2d');
        const resize = () => {
            cv.width = W() * DPR;
            cv.height = H() * DPR;
            cv.style.width = W() + 'px';
            cv.style.height = H() + 'px';
            ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
        };
        resize();
        return { ctx, resize };
    }

    const bgCv = setupCanvas(document.getElementById('bg-canvas'));
    const particleCv = setupCanvas(document.getElementById('particle-canvas'));
    const fxCv = setupCanvas(document.getElementById('fx-canvas'));

    /* ---------- 模块：过渡粒子数组 ---------- */
    const particles = [];

    /* ---------- 模块：星空背景星星 ---------- */
    const stars = [];
    const STAR_COUNT = 120;

    class Star {
        constructor() { this.reset(); }
        reset() {
            this.x = rand(0, W());
            this.y = rand(0, H());
            this.s = rand(0.4, 2);
            this.a = rand(0.2, 0.9);
            this.spd = rand(0.3, 2);
            this.off = rand(0, TAU);
            this.twinkleSpd = rand(0.5, 2.5);
        }
        draw(ctx, t) {
            const tw = 0.6 + 0.4 * Math.sin(t * this.twinkleSpd + this.off);
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.s, 0, TAU);
            ctx.fillStyle = `rgba(255,255,255,${this.a * tw})`;
            ctx.fill();
        }
    }
    for (let i = 0; i < STAR_COUNT; i++) stars.push(new Star());

    /* ---------- 模块：星云光斑 ---------- */
    const nebulas = [];
    for (let i = 0; i < 4; i++) {
        nebulas.push({
            x: rand(0, W()), y: rand(0, H()),
            r: rand(150, 300), hue: rand(260, 340),
            alpha: rand(0.04, 0.12),
            vx: rand(-0.3, 0.3), vy: rand(-0.2, 0.2)
        });
    }

    /* ---------- 模块：流星 ---------- */
    const meteors = [];
    let meteorTimer = 2;

    class Meteor {
        constructor() {
            this.x = rand(W() * 0.2, W() * 1.1);
            this.y = rand(-50, H() * 0.15);
            this.vx = rand(-6, -3);
            this.vy = rand(3, 6);
            this.life = 0;
            this.maxLife = rand(25, 40);
            this.size = rand(1.2, 2.8);
            this.trail = [];
            this.hue = rand(200, 280);
        }
        update() {
            this.life++;
            this.x += this.vx;
            this.y += this.vy;
            this.trail.push({ x: this.x, y: this.y, a: 1 });
            if (this.trail.length > 12) this.trail.shift();
            for (let i = 0; i < this.trail.length; i++) this.trail[i].a = i / this.trail.length;
            return this.life > this.maxLife || this.y > H() + 20 || this.x < -20;
        }
        draw(ctx) {
            for (let i = 0; i < this.trail.length - 1; i++) {
                const p = this.trail[i];
                ctx.beginPath();
                ctx.arc(p.x, p.y, this.size * (i / this.trail.length) * 1.4, 0, TAU);
                ctx.fillStyle = `hsla(${this.hue},80%,90%,${p.a * 0.5})`;
                ctx.fill();
            }
            const g = ctx.createRadialGradient(this.x, this.y, 0, this.x, this.y, this.size * 4);
            g.addColorStop(0, `hsla(${this.hue},60%,95%,0.8)`);
            g.addColorStop(0.3, `hsla(${this.hue},50%,80%,0.4)`);
            g.addColorStop(1, 'transparent');
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size * 4, 0, TAU);
            ctx.fillStyle = g;
            ctx.fill();
        }
    }

    /* ---------- 模块：背景绘制 ---------- */
    function drawBackground(t) {
        const ctx = bgCv.ctx, w = W(), h = H();
        ctx.clearRect(0, 0, w, h);

        // 渐变底色
        const grad = ctx.createLinearGradient(0, 0, w, h);
        grad.addColorStop(0, '#05051f');
        grad.addColorStop(0.4, '#0a0a30');
        grad.addColorStop(0.7, '#0f0f3a');
        grad.addColorStop(1, '#151540');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, w, h);

        // 星云光斑
        for (const n of nebulas) {
            n.x += n.vx;
            n.y += n.vy;
            if (n.x < -n.r) n.x = w + n.r;
            if (n.x > w + n.r) n.x = -n.r;
            if (n.y < -n.r) n.y = h + n.r;
            if (n.y > h + n.r) n.y = -n.r;
            const g = ctx.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r);
            g.addColorStop(0, `hsla(${n.hue},80%,70%,${n.alpha})`);
            g.addColorStop(0.5, `hsla(${n.hue},60%,50%,${n.alpha * 0.5})`);
            g.addColorStop(1, 'transparent');
            ctx.beginPath();
            ctx.arc(n.x, n.y, n.r, 0, TAU);
            ctx.fillStyle = g;
            ctx.fill();
        }

        // 星星
        for (const s of stars) s.draw(ctx, t);
    }

    /* ---------- 模块：粒子与流星绘制 ---------- */
    function drawParticles(t) {
        const ctx = particleCv.ctx, w = W(), h = H();
        ctx.clearRect(0, 0, w, h);

        // 流星生成
        meteorTimer -= 0.016;
        if (meteorTimer <= 0 && meteors.length < 2) {
            meteors.push(new Meteor());
            meteorTimer = rand(1.5, 4);
        }
        for (let i = meteors.length - 1; i >= 0; i--) {
            if (meteors[i].update()) meteors.splice(i, 1);
            else meteors[i].draw(ctx);
        }

        // 过渡粒子
        for (let i = particles.length - 1; i >= 0; i--) {
            const p = particles[i];
            p.life++;
            p.x += p.vx;
            p.y += p.vy;
            p.vy += 0.03;
            const a = 1 - p.life / p.maxLife;
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.size, 0, TAU);
            ctx.fillStyle = `hsla(${p.hue},90%,80%,${a})`;
            ctx.fill();
            if (p.life > p.maxLife) particles.splice(i, 1);
        }
    }

    /* ---------- 模块：音乐系统 ---------- */
    let audioCtx = null;
    let musicOn = false;
    let musicTimer = null;

    function initAudio() {
        if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        if (audioCtx.state === 'suspended') audioCtx.resume();
    }

    function playChord(freq, duration, delay, type = 'sine', vol = 0.15) {
        if (!audioCtx || !musicOn) return;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = type;
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, audioCtx.currentTime + delay);
        gain.gain.linearRampToValueAtTime(vol, audioCtx.currentTime + delay + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + delay + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(audioCtx.currentTime + delay);
        osc.stop(audioCtx.currentTime + delay + duration);
    }

    function startMusic() {
        if (musicOn) return;
        initAudio();
        musicOn = true;
        const btn = document.getElementById('musicToggle');
        if (btn) btn.textContent = '♪';
        function playMelody() {
            if (!musicOn) return;
            const chords = [
                [261.63, 329.63, 392.00],
                [293.66, 369.99, 440.00],
                [329.63, 415.30, 493.88],
                [392.00, 493.88, 587.33]
            ];
            const idx = Math.floor(Math.random() * chords.length);
            const chord = chords[idx];
            chord.forEach((freq, i) => {
                playChord(freq, 1.5, i * 0.3, 'sine', 0.08);
            });
            musicTimer = setTimeout(playMelody, 2400);
        }
        playMelody();
    }

    function stopMusic() {
        musicOn = false;
        if (musicTimer) clearTimeout(musicTimer);
        const btn = document.getElementById('musicToggle');
        if (btn) btn.textContent = '♩';
    }

    /* ---------- 模块：音乐按钮绑定 ---------- */
    const musicBtn = document.getElementById('musicToggle');
    if (musicBtn) {
        musicBtn.addEventListener('click', () => {
            if (musicOn) stopMusic();
            else startMusic();
        });
    }

    /* ---------- 模块：桌面光标效果 ---------- */
    const cursorGlow = document.getElementById('cursorGlow');
    const cursorRing = document.getElementById('cursorRing');

    if (window.innerWidth > 768 && cursorGlow && cursorRing) {
        document.addEventListener('mousemove', (e) => {
            const mouseX = e.clientX;
            const mouseY = e.clientY;
            cursorGlow.style.left = mouseX + 'px';
            cursorGlow.style.top = mouseY + 'px';
            cursorRing.style.left = mouseX + 'px';
            cursorRing.style.top = mouseY + 'px';
            if (Math.random() < 0.3) {
                particles.push({
                    x: mouseX + rand(-5, 5), y: mouseY + rand(-5, 5),
                    vx: rand(-0.5, 0.5), vy: rand(-0.5, 0.5),
                    life: 0, maxLife: rand(15, 30), size: rand(0.5, 1.5),
                    hue: rand(280, 340)
                });
            }
        });
        document.addEventListener('mouseleave', () => {
            cursorGlow.style.opacity = '0';
            cursorRing.style.opacity = '0';
        });
        document.addEventListener('mouseenter', () => {
            cursorGlow.style.opacity = '1';
            cursorRing.style.opacity = '1';
        });
    }

    /* ---------- 模块：触摸产生粒子 ---------- */
    document.addEventListener('touchstart', (e) => {
        for (const touch of e.touches) {
            const x = touch.clientX, y = touch.clientY;
            for (let i = 0; i < 8; i++) {
                particles.push({
                    x, y,
                    vx: rand(-2, 2), vy: rand(-3, -0.5),
                    life: 0, maxLife: rand(20, 40), size: rand(1, 2.5),
                    hue: rand(330, 360)
                });
            }
        }
    }, { passive: true });

    /* ---------- 模块：过渡粒子生成（供二级页面调用） ---------- */
    window.spawnTransitionParticles = function() {
        const w = W(), h = H();
        for (let i = 0; i < 30; i++) {
            const x = rand(0, w), y = rand(0, h);
            const angle = rand(0, TAU);
            const spd = rand(2, 8);
            particles.push({
                x, y, vx: Math.cos(angle) * spd, vy: Math.sin(angle) * spd,
                life: 0, maxLife: rand(40, 80), size: rand(1, 3),
                hue: rand(300, 360)
            });
        }
    };

    // 页面加载时生成过渡粒子
    spawnTransitionParticles();

    /* ---------- 模块：主循环 ---------- */
    function animate(ts) {
        const t = ts / 1000;
        drawBackground(t);
        drawParticles(t);
        requestAnimationFrame(animate);
    }

    /* ---------- 模块：窗口调整 ---------- */
    function handleResize() {
        bgCv.resize();
        particleCv.resize();
        fxCv.resize();
        for (const s of stars) s.reset();
        for (const n of nebulas) {
            n.x = rand(0, W());
            n.y = rand(0, H());
            n.r = rand(150, 300);
        }
    }
    let resizeT;
    window.addEventListener('resize', () => {
        clearTimeout(resizeT);
        resizeT = setTimeout(handleResize, 150);
    });

    /* ---------- 模块：启动 ---------- */
    handleResize();
    requestAnimationFrame(animate);

    console.log('%c💖 星河之旅 · 七夕特典 💖', 'font-size:24px;color:#ff6b9d;text-shadow:0 0 20px #ff6b9d;');
    console.log('%c✨ 点击星星探索属于你们的浪漫 ✨', 'font-size:14px;color:#ffd700;');
})();
