/* ==========================================================================
   AVIATOR GAME ENGINE - MASTERSCRIPT
   Architecture: Modular sub-engines with custom render loops and procedural sound
   ========================================================================== */

(function () {
    'use strict';

    // ==========================================================================
    // 1. STATE & STORAGE MANAGEMENT
    // ==========================================================================
    const DEFAULT_USER = {
        nickname: "LuckyPilot",
        email: "pilot@aviator.com",
        isLoggedIn: true,
        balance: 10000.00,
        stats: {
            totalGames: 0,
            winRate: 0,
            netProfit: 0.00,
            winsCount: 0
        },
        seed: "9a2c3f8e6b1d4c2a8f"
    };

    let state = {
        user: null,
        gameState: "LOBBY", // LOBBY, FLYING, CRASHED
        activeMultiplier: 1.00,
        crashMultiplier: 1.00,
        countdownTime: 5.0, // 5s lobby phase
        elapsedSeconds: 0,
        lastFrameTime: 0,
        
        // Dual Betting Panels config
        panels: {
            1: {
                isPlaced: false,
                amount: 100.00,
                isCashedOut: false,
                winAmount: 0.00,
                cashOutMult: 0.00,
                isAutoBet: false,
                isAutoCash: false,
                autoCashMult: 2.00,
                isPlacedForNextRound: false
            },
            2: {
                isPlaced: false,
                amount: 200.00,
                isCashedOut: false,
                winAmount: 0.00,
                cashOutMult: 0.00,
                isAutoBet: false,
                isAutoCash: false,
                autoCashMult: 2.00,
                isPlacedForNextRound: false
            }
        },
        
        roundHistory: [1.25, 2.50, 1.08, 12.45, 1.54, 42.10, 1.12, 1.95, 8.44, 1.01, 3.15, 1.62],
        simulatedBets: [],
        transactions: [],
        chatLogs: []
    };

    function seedRandom(seedStr) {
        let h = 0;
        for (let i = 0; i < seedStr.length; i++) {
            h = Math.imul(31, h) + seedStr.charCodeAt(i) | 0;
        }
        let a = h;
        return function() {
            a = (Math.imul(1664525, a) + 1013904223) | 0;
            return (a >>> 0) / 4294967296;
        };
    }

    function getActiveRoundState(T) {
        const ONE_HOUR = 3600000;
        const hourStart = T - (T % ONE_HOUR);
        
        let t = hourStart;
        
        while (true) {
            const lobbyDurationMs = 5000; // 5 seconds lobby countdown
            const crashFreezeDurationMs = 3500; // 3.5 seconds crash display
            
            // Generate crash multiplier deterministically for round starting at t
            const seedStr = "aviator_round_" + t;
            const rand = seedRandom(seedStr);
            let randomPercent = rand() * 99;
            let crashMultiplier = 1.01 + 0.99 * (99 / (100 - randomPercent));
            if (crashMultiplier > 5000) crashMultiplier = 5000;
            if (rand() < 0.03) {
                crashMultiplier = 1.00;
            }
            
            const flightDurationMs = (Math.log(crashMultiplier) / 0.065) * 1000;
            
            const lobbyEnd = t + lobbyDurationMs;
            const flightEnd = lobbyEnd + flightDurationMs;
            const roundEnd = flightEnd + crashFreezeDurationMs;
            
            if (T >= t && T < roundEnd) {
                return {
                    roundStart: t,
                    lobbyEnd: lobbyEnd,
                    flightEnd: flightEnd,
                    roundEnd: roundEnd,
                    crashMultiplier: crashMultiplier,
                    seed: seedStr.substring(14)
                };
            }
            
            t = roundEnd;
        }
    }

    function getRecentHistory(T, count = 20) {
        const history = [];
        let rState = getActiveRoundState(T);
        let t = rState.roundStart;
        
        for (let i = 0; i < count; i++) {
            const prevT = t - 1000; // go back 1 second before this round started
            rState = getActiveRoundState(prevT);
            history.push(rState.crashMultiplier);
            t = rState.roundStart;
        }
        return history;
    }

    // Initialize LocalStorage and user profiles
    function loadSession() {
        try {
            const savedUser = localStorage.getItem("aviator_user");
            const savedTxns = localStorage.getItem("aviator_txns");
            const savedHistory = localStorage.getItem("aviator_history");

            if (savedUser) {
                state.user = JSON.parse(savedUser);
                if (!state.user.isLoggedIn) {
                    window.location.href = "login.html";
                    return;
                }

                // Check active status in central database
                const dbStr = localStorage.getItem("aviator_db_users");
                if (dbStr) {
                    const dbUsers = JSON.parse(dbStr);
                    const freshest = dbUsers.find(u => String(u.email).toLowerCase().trim() === String(state.user.email).toLowerCase().trim());
                    if (freshest && freshest.status === "BANNED") {
                        localStorage.removeItem("aviator_user");
                        alert("🚨 ACCESS DENIED: Your pilot account has been banned by Flight Control.");
                        window.location.href = "login.html";
                        return;
                    }
                }
            } else {
                window.location.href = "login.html";
                return;
            }

            if (savedTxns) {
                state.transactions = JSON.parse(savedTxns);
            } else {
                state.transactions = [
                    { id: "TXN1001", date: new Date().toLocaleString(), desc: "Welcome Bonus Balance", type: "DEPOSIT", amount: 10000.00, status: "SUCCESS" }
                ];
                localStorage.setItem("aviator_txns", JSON.stringify(state.transactions));
            }

            if (savedHistory) {
                state.roundHistory = JSON.parse(savedHistory);
            } else {
                localStorage.setItem("aviator_history", JSON.stringify(state.roundHistory));
            }
        } catch (e) {
            console.error("Local storage error, using fallbacks:", e);
            state.user = JSON.parse(JSON.stringify(DEFAULT_USER));
        }
    }

    function saveUserSession() {
        localStorage.setItem("aviator_user", JSON.stringify(state.user));
        
        // Sync user modifications back to our global user database
        try {
            const dbStr = localStorage.getItem("aviator_db_users");
            if (dbStr && state.user) {
                const db = JSON.parse(dbStr);
                const idx = db.findIndex(u => u.email === state.user.email);
                if (idx !== -1) {
                    db[idx] = JSON.parse(JSON.stringify(state.user));
                    localStorage.setItem("aviator_db_users", JSON.stringify(db));
                }
            }
        } catch (e) {
            console.error("Central user database synchronization failed:", e);
        }
    }

    function saveTransactions() {
        localStorage.setItem("aviator_txns", JSON.stringify(state.transactions));
    }

    function syncUserBalanceFromStorage() {
        try {
            const savedUser = localStorage.getItem("aviator_user");
            if (savedUser) {
                const latestUser = JSON.parse(savedUser);
                if (latestUser && typeof latestUser.balance === "number") {
                    state.user.balance = latestUser.balance;
                    updateWalletDisplay();
                }
            }
        } catch (e) {
            console.error("Balance sync failed:", e);
        }
    }

    function savePanelsState() {
        const panelsData = {
            1: {
                amount: state.panels[1].amount,
                isPlaced: state.panels[1].isPlaced,
                isCashedOut: state.panels[1].isCashedOut,
                winAmount: state.panels[1].winAmount,
                cashOutMult: state.panels[1].cashOutMult,
                isPlacedForNextRound: state.panels[1].isPlacedForNextRound,
                isAutoBet: state.panels[1].isAutoBet,
                isAutoCash: state.panels[1].isAutoCash,
                autoCashMult: state.panels[1].autoCashMult
            },
            2: {
                amount: state.panels[2].amount,
                isPlaced: state.panels[2].isPlaced,
                isCashedOut: state.panels[2].isCashedOut,
                winAmount: state.panels[2].winAmount,
                cashOutMult: state.panels[2].cashOutMult,
                isPlacedForNextRound: state.panels[2].isPlacedForNextRound,
                isAutoBet: state.panels[2].isAutoBet,
                isAutoCash: state.panels[2].isAutoCash,
                autoCashMult: state.panels[2].autoCashMult
            }
        };
        localStorage.setItem("aviator_panels_state", JSON.stringify(panelsData));
    }

    function loadPanelsState() {
        const panelsStr = localStorage.getItem("aviator_panels_state");
        if (panelsStr) {
            try {
                const savedPanels = JSON.parse(panelsStr);
                for (let panelId = 1; panelId <= 2; panelId++) {
                    if (savedPanels[panelId]) {
                        Object.assign(state.panels[panelId], savedPanels[panelId]);
                        
                        // Sync visual UI elements
                        const card = document.getElementById(`betCard${panelId}`);
                        if (card) {
                            card.querySelector(".amount-input").value = state.panels[panelId].amount;
                            card.querySelector(".auto-bet-switch").checked = state.panels[panelId].isAutoBet;
                            card.querySelector(".auto-cashout-switch").checked = state.panels[panelId].isAutoCash;
                            card.querySelector(".auto-mult-input").value = state.panels[panelId].autoCashMult;
                            
                            // Set Auto Tab active if configured
                            if (state.panels[panelId].isAutoBet || state.panels[panelId].isAutoCash) {
                                card.querySelectorAll(".bet-tab").forEach(t => t.classList.remove("active"));
                                const autoTab = Array.from(card.querySelectorAll(".bet-tab")).find(t => t.dataset.tab === "auto");
                                if (autoTab) {
                                    autoTab.classList.add("active");
                                    card.querySelector(".auto-drawer").classList.add("open");
                                }
                            }
                            
                            // Restore classes
                            const btn = card.querySelector(".main-bet-btn");
                            if (state.gameState === "LOBBY") {
                                if (state.panels[panelId].isPlaced) {
                                    btn.className = "main-bet-btn bet-state-placed";
                                    btn.querySelector(".btn-subtext").innerText = "CANCEL BET";
                                    btn.querySelector(".btn-amount-label").innerText = "₹" + state.panels[panelId].amount.toFixed(2);
                                    card.classList.add("active-bet");
                                } else if (state.panels[panelId].isPlacedForNextRound) {
                                    btn.className = "main-bet-btn bet-state-placed";
                                    btn.querySelector(".btn-subtext").innerText = "QUEUED FOR NEXT";
                                    btn.querySelector(".btn-amount-label").innerText = "₹" + state.panels[panelId].amount.toFixed(2);
                                }
                            } else if (state.gameState === "FLYING") {
                                if (state.panels[panelId].isPlaced) {
                                    if (state.panels[panelId].isCashedOut) {
                                        btn.className = "main-bet-btn bet-state-cashed";
                                        btn.disabled = true;
                                        btn.querySelector(".btn-subtext").innerText = "CASHED OUT";
                                        btn.querySelector(".btn-amount-label").innerText = "₹" + state.panels[panelId].winAmount.toFixed(2);
                                    } else {
                                        btn.className = "main-bet-btn bet-state-cashout";
                                        btn.querySelector(".btn-subtext").innerText = "CASH OUT";
                                        btn.querySelector(".btn-amount-label").innerText = "₹" + (state.panels[panelId].amount * state.activeMultiplier).toFixed(2);
                                        card.classList.add("active-bet");
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (e) {
                console.error("Failed to restore panels state:", e);
            }
        }
    }

    function restoreGameState() {
        // Load persisted panel bet details
        loadPanelsState();

        // Populate deterministic history ribbon so all devices start in sync
        state.roundHistory = getRecentHistory(Date.now(), 24);
        updateMultiplierRibbon();
    }

    function addTransaction(desc, type, amount, status = "SUCCESS") {
        const id = "TXN" + Math.floor(100000 + Math.random() * 900000);
        state.transactions.unshift({
            id: id,
            userEmail: state.user ? state.user.email : "pilot@aviator.com",
            date: new Date().toLocaleString(),
            desc: desc,
            type: type,
            amount: amount,
            status: status
        });
        if (state.transactions.length > 50) state.transactions.pop();
        saveTransactions();
        updateTransactionsUI();
    }

    function showNotification(message, type = 'info', duration = 4000) {
        let styles = document.getElementById("toastStyles");
        if (!styles) {
            styles = document.createElement("style");
            styles.id = "toastStyles";
            styles.innerHTML = `
                .toast-container {
                    position: fixed;
                    top: 24px;
                    right: 24px;
                    z-index: 99999;
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                    pointer-events: none;
                    max-width: 380px;
                    width: calc(100vw - 48px);
                    font-family: var(--font-sans), sans-serif;
                }
                .toast-card {
                    pointer-events: auto;
                    background: rgba(27, 30, 48, 0.9);
                    backdrop-filter: blur(20px) saturate(180%);
                    -webkit-backdrop-filter: blur(20px) saturate(180%);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 12px;
                    padding: 14px 18px;
                    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.55);
                    display: flex;
                    align-items: flex-start;
                    gap: 12px;
                    position: relative;
                    overflow: hidden;
                    animation: toast-spring-in 0.45s cubic-bezier(0.175, 0.885, 0.32, 1.275) forwards;
                    transition: all 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.275);
                }
                .toast-card.success {
                    border-left: 4px solid var(--success-green);
                    box-shadow: 0 8px 30px rgba(0, 230, 118, 0.2), 0 12px 40px rgba(0, 0, 0, 0.5);
                }
                .toast-card.error {
                    border-left: 4px solid var(--primary-red);
                    box-shadow: 0 8px 30px rgba(226, 27, 60, 0.2), 0 12px 40px rgba(0, 0, 0, 0.5);
                }
                .toast-card.info {
                    border-left: 4px solid var(--purple-neon, #af52de);
                    box-shadow: 0 8px 30px rgba(175, 82, 222, 0.2), 0 12px 40px rgba(0, 0, 0, 0.5);
                }
                .toast-card.warning {
                    border-left: 4px solid var(--orange-cashout);
                    box-shadow: 0 8px 30px rgba(255, 145, 0, 0.2), 0 12px 40px rgba(0, 0, 0, 0.5);
                }
                .toast-card.leaving {
                    opacity: 0;
                    transform: translateX(120%) scale(0.9);
                    filter: blur(4px);
                }
                .toast-progress {
                    position: absolute;
                    bottom: 0;
                    left: 0;
                    height: 3px;
                    background: rgba(255, 255, 255, 0.15);
                    width: 100%;
                    transform-origin: left;
                    animation: toast-timer linear forwards;
                }
                .toast-card.success .toast-progress { background: var(--success-green); }
                .toast-card.error .toast-progress { background: var(--primary-red); }
                .toast-card.info .toast-progress { background: var(--purple-neon, #af52de); }
                .toast-card.warning .toast-progress { background: var(--orange-cashout); }
                
                .toast-icon-wrapper {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 28px;
                    height: 28px;
                    border-radius: 50%;
                    font-size: 16px;
                    flex-shrink: 0;
                }
                .toast-card.success .toast-icon-wrapper { background: rgba(0, 230, 118, 0.12); color: var(--success-green); }
                .toast-card.error .toast-icon-wrapper { background: rgba(226, 27, 60, 0.12); color: var(--primary-red); }
                .toast-card.info .toast-icon-wrapper { background: rgba(175, 82, 222, 0.12); color: var(--purple-neon, #af52de); }
                .toast-card.warning .toast-icon-wrapper { background: rgba(255, 145, 0, 0.12); color: var(--orange-cashout); }
                
                .toast-content-wrapper {
                    flex-grow: 1;
                }
                .toast-title {
                    font-size: 13px;
                    font-weight: 700;
                    margin-bottom: 2px;
                    color: #ffffff;
                }
                .toast-message {
                    font-size: 11px;
                    color: var(--text-secondary);
                    line-height: 1.4;
                }
                .toast-close-btn {
                    background: none;
                    border: none;
                    color: var(--text-muted);
                    cursor: pointer;
                    font-size: 16px;
                    padding: 0;
                    transition: all 0.15s ease;
                    line-height: 1;
                    margin-left: 6px;
                    flex-shrink: 0;
                }
                .toast-close-btn:hover {
                    color: #ffffff;
                    transform: scale(1.1);
                }
                @keyframes toast-spring-in {
                    0% {
                        opacity: 0;
                        transform: translateX(100%) translateY(-10px) scale(0.85);
                        filter: blur(4px);
                    }
                    70% {
                        transform: translateX(-10px) scale(1.02);
                    }
                    100% {
                        opacity: 1;
                        transform: translateX(0) scale(1);
                        filter: none;
                    }
                }
                @keyframes toast-timer {
                    from { transform: scaleX(1); }
                    to { transform: scaleX(0); }
                }
            `;
            document.head.appendChild(styles);
        }

        let container = document.getElementById("toastContainer");
        if (!container) {
            container = document.createElement("div");
            container.id = "toastContainer";
            container.className = "toast-container";
            document.body.appendChild(container);
        }

        const toast = document.createElement("div");
        toast.className = `toast-card ${type}`;

        let icon = "⚡";
        let title = "Info";
        if (type === "success") {
            icon = "🏆";
            title = "Success";
        } else if (type === "error") {
            icon = "⚠️";
            title = "Alert Rejected";
        } else if (type === "warning") {
            icon = "🚨";
            title = "Warning";
        }

        toast.innerHTML = `
            <div class="toast-icon-wrapper">${icon}</div>
            <div class="toast-content-wrapper">
                <div class="toast-title">${title}</div>
                <div class="toast-message">${message}</div>
            </div>
            <button class="toast-close-btn">&times;</button>
            <div class="toast-progress" style="animation-duration: ${duration}ms"></div>
        `;

        container.appendChild(toast);

        const closeBtn = toast.querySelector(".toast-close-btn");
        closeBtn.addEventListener("click", () => {
            dismissToast(toast);
        });

        const timer = setTimeout(() => {
            dismissToast(toast);
        }, duration);

        toast.dataset.timerId = timer;
    }

    function dismissToast(toast) {
        if (toast.classList.contains("leaving")) return;
        toast.classList.add("leaving");
        clearTimeout(parseInt(toast.dataset.timerId));
        setTimeout(() => {
            toast.remove();
            const container = document.getElementById("toastContainer");
            if (container && container.childElementCount === 0) {
                container.remove();
            }
        }, 400);
    }

    // Expose globally so external pages/modals can call it
    window.showNotification = showNotification;

    // ==========================================================================
    // 2. PROCEDURAL SOUND FX SYNTHESISER (Web Audio API)
    // ==========================================================================
    let audioCtx = null;
    let soundEnabled = true;

    function initAudio() {
        if (!audioCtx) {
            audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioCtx.state === 'suspended') {
            audioCtx.resume();
        }
    }

    function playSound(type, pitchModifier = 1.0) {
        if (!soundEnabled) return;
        try {
            initAudio();
            if (!audioCtx) return;

            const now = audioCtx.currentTime;

            if (type === "engine") {
                // Synthesize the rising pitch sound of the jet engine
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                
                osc.type = "sawtooth";
                // Engine pitch scales exponentially from 80Hz up to 350Hz depending on modifier
                const baseFreq = 70;
                osc.frequency.setValueAtTime(baseFreq + (pitchModifier * 55), now);
                
                // Add low pass filter to make it sound muffled like inside a cockpit
                const filter = audioCtx.createBiquadFilter();
                filter.type = "lowpass";
                filter.frequency.setValueAtTime(280 + (pitchModifier * 100), now);
                
                gain.gain.setValueAtTime(0.04, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

                osc.connect(filter);
                filter.connect(gain);
                gain.connect(audioCtx.destination);
                
                osc.start(now);
                osc.stop(now + 0.15);

            } else if (type === "cashout") {
                // Synthesize a satisfying high-frequency cash out bell chime
                const osc1 = audioCtx.createOscillator();
                const osc2 = audioCtx.createOscillator();
                const gain = audioCtx.createGain();

                osc1.type = "sine";
                osc1.frequency.setValueAtTime(523.25, now); // C5 chord
                osc1.frequency.exponentialRampToValueAtTime(880.00, now + 0.15); // Ramp to A5

                osc2.type = "sine";
                osc2.frequency.setValueAtTime(659.25, now); // E5 chord
                osc2.frequency.exponentialRampToValueAtTime(1046.50, now + 0.2); // Ramp to C6

                gain.gain.setValueAtTime(0.08, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);

                osc1.connect(gain);
                osc2.connect(gain);
                gain.connect(audioCtx.destination);

                osc1.start(now);
                osc2.start(now);
                osc1.stop(now + 0.65);
                osc2.stop(now + 0.65);

            } else if (type === "crash") {
                // Synthesize a deep filtered white noise whoosh representing game crash
                const bufferSize = audioCtx.sampleRate * 0.5; // Half second crash explosion
                const buffer = audioCtx.createBuffer(1, bufferSize, audioCtx.sampleRate);
                const data = buffer.getChannelData(0);
                
                // Fill with random noise values
                for (let i = 0; i < bufferSize; i++) {
                    data[i] = Math.random() * 2 - 1;
                }

                const noiseNode = audioCtx.createBufferSource();
                noiseNode.buffer = buffer;

                const filter = audioCtx.createBiquadFilter();
                filter.type = "lowpass";
                filter.frequency.setValueAtTime(450, now);
                filter.frequency.exponentialRampToValueAtTime(40, now + 0.45);

                const gain = audioCtx.createGain();
                gain.gain.setValueAtTime(0.12, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.48);

                noiseNode.connect(filter);
                filter.connect(gain);
                gain.connect(audioCtx.destination);

                noiseNode.start(now);
                noiseNode.stop(now + 0.5);
            }
        } catch (e) {
            console.error("Synthesizer audio blocked or failed:", e);
        }
    }

    // ==========================================================================
    // 3. CANVAS HIGH-PERFORMANCE FLIGHT RENDER ENGINE
    // ==========================================================================
    const canvas = document.getElementById("flightCanvas");
    const ctx = canvas.getContext("2d");
    const container = document.getElementById("flightContainer");

    let particles = [];
    let scaleX = 5.0; // Seconds visible on X axis
    let scaleY = 2.0; // Multipliers visible on Y axis
    let planeX = 0;
    let planeY = 0;
    let gridOffset = 0;

    function resizeCanvas() {
        const dpr = window.devicePixelRatio || 1;
        const rect = container.getBoundingClientRect();
        canvas.width = rect.width * dpr;
        canvas.height = rect.height * dpr;
        canvas.style.width = rect.width + 'px';
        canvas.style.height = rect.height + 'px';
        ctx.scale(dpr, dpr);
    }
    window.addEventListener("resize", resizeCanvas);
    resizeCanvas();

    // Spawns physical vapor trail particles behind the jet
    function addParticle(x, y) {
        particles.push({
            x: x,
            y: y,
            vx: -2 - Math.random() * 2, // Spit particles backwards
            vy: (Math.random() * 2 - 1) * 0.8,
            size: 6 + Math.random() * 6,
            alpha: 0.8,
            life: 1.0,
            decay: 0.02 + Math.random() * 0.02,
            color: Math.random() > 0.45 ? 'rgba(226, 27, 60, alpha)' : 'rgba(255, 145, 0, alpha)'
        });
    }

    // Renders the sleek vector fighter jet
    function drawVectorPlane(x, y, angle) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(angle);

        // Core Glowing Shadow effect
        ctx.shadowBlur = 20;
        ctx.shadowColor = '#e21b3c';
        ctx.fillStyle = '#e21b3c';

        ctx.beginPath();
        ctx.moveTo(18, 0);         // Jet Nose
        ctx.lineTo(-3, -7);        // Wing join
        ctx.lineTo(-10, -20);      // Left wingtip
        ctx.lineTo(-8, -5);        // Left body line
        ctx.lineTo(-18, -5);       // Left tail join
        ctx.lineTo(-22, -11);      // Left rear fin
        ctx.lineTo(-20, 0);        // Centered tail end
        ctx.lineTo(-22, 11);       // Right rear fin
        ctx.lineTo(-18, 5);        // Right tail join
        ctx.lineTo(-8, 5);         // Right body line
        ctx.lineTo(-10, 20);       // Right wingtip
        ctx.lineTo(-3, 7);         // Wing join
        ctx.closePath();
        ctx.fill();

        // Cockpit canopy window glass
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.ellipse(3, 0, 6, 2.5, 0, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }

    function syncGameLifecycle() {
        const T = Date.now();
        const active = getActiveRoundState(T);
        
        // Update provably fair seed display
        const serverSeedInput = document.getElementById("fairServerSeed");
        if (serverSeedInput) {
            serverSeedInput.value = active.seed;
        }
        
        if (T < active.lobbyEnd) {
            // Target state: LOBBY
            state.countdownTime = (active.lobbyEnd - T) / 1000;
            state.activeMultiplier = 1.00;
            state.elapsedSeconds = 0;
            state.crashMultiplier = active.crashMultiplier;
            
            if (state.gameState !== "LOBBY") {
                state.gameState = "LOBBY";
                
                // Reset inputs and values
                document.getElementById("liveMultiplier").innerText = "1.00x";
                document.getElementById("liveMultiplier").style.color = "#ffffff";
                document.getElementById("flightSubtext").innerText = "Waiting for next round";
                document.getElementById("flightSubtext").style.color = "var(--text-secondary)";
                
                document.getElementById("timerOverlay").style.display = "flex";
                document.getElementById("multiplierOverlay").style.display = "none";
                
                // Place auto-bets if configured
                processAutoBets();
                
                // Save panels state
                savePanelsState();
                
                // Regenerate simulated players in Lobby
                simulateLobbyBets();
            }
            
            // Continuous UI updates
            document.getElementById("timerSeconds").innerText = state.countdownTime.toFixed(1) + "s";
            
            // Sync timer circular progress bar ring
            const circleBar = document.getElementById("timerBar");
            if (circleBar) {
                const strokeOffset = 251.2 * (state.countdownTime / 5.0);
                circleBar.style.strokeDashoffset = 251.2 - strokeOffset;
            }
            
        } else if (T >= active.lobbyEnd && T < active.flightEnd) {
            // Target state: FLYING
            state.elapsedSeconds = (T - active.lobbyEnd) / 1000;
            state.activeMultiplier = Math.pow(Math.E, 0.065 * state.elapsedSeconds);
            state.crashMultiplier = active.crashMultiplier;
            
            if (state.gameState !== "FLYING") {
                state.gameState = "FLYING";
                
                document.getElementById("timerOverlay").style.display = "none";
                document.getElementById("multiplierOverlay").style.display = "block";
                document.getElementById("flightSubtext").innerText = "Keep climbing!";
                document.getElementById("flightSubtext").style.color = "var(--success-green)";
                
                // Sync panel buttons to active cashout cards
                syncActiveBetPanels();
                
                // Save panels state
                savePanelsState();
                
                // Let the simulation loop drive player cashouts
                triggerSimulatedCashouts();
            }
            
            // Continuous check of Auto-Cashouts
            checkAutoCashouts();
            
            // Engine sound tick
            playSound("engine", state.activeMultiplier);
            
            // Live HUD text update
            document.getElementById("liveMultiplier").innerText = state.activeMultiplier.toFixed(2) + "x";
            
        } else {
            // Target state: CRASHED
            state.activeMultiplier = active.crashMultiplier;
            state.crashMultiplier = active.crashMultiplier;
            
            if (state.gameState !== "CRASHED") {
                state.gameState = "CRASHED";
                playSound("crash");
                
                document.getElementById("liveMultiplier").innerText = "FLEW AWAY!";
                document.getElementById("liveMultiplier").style.color = "var(--primary-red)";
                document.getElementById("liveMultiplier").classList.add("flew-away");
                document.getElementById("flightSubtext").innerText = `@ ${state.activeMultiplier.toFixed(2)}x`;
                document.getElementById("flightSubtext").style.color = "var(--primary-red)";
                
                setTimeout(() => {
                    const lm = document.getElementById("liveMultiplier");
                    if (lm) lm.classList.remove("flew-away");
                }, 500);
                
                // Process personal round losses/credits
                processRoundResults();
                
                // Save panels state after clearing
                savePanelsState();
                
                // Log results into recent multiplier track
                state.roundHistory.unshift(state.activeMultiplier);
                if (state.roundHistory.length > 24) state.roundHistory.pop();
                localStorage.setItem("aviator_history", JSON.stringify(state.roundHistory));
                updateMultiplierRibbon();
                
                // Feed context comments to simulated chat
                simulatedChatReaction(state.activeMultiplier);
            }
        }
    }

    function renderFlightLoop(timestamp) {
        syncGameLifecycle();
        if (!state.lastFrameTime) state.lastFrameTime = timestamp;
        const dt = (timestamp - state.lastFrameTime) / 1000;
        state.lastFrameTime = timestamp;

        const w = canvas.width / (window.devicePixelRatio || 1);
        const h = canvas.height / (window.devicePixelRatio || 1);

        // Standard screen padding
        const paddingLeft = 50;
        const paddingBottom = 40;
        const paddingRight = 40;
        const paddingTop = 40;

        const chartW = w - paddingLeft - paddingRight;
        const chartH = h - paddingBottom - paddingTop;

        // Clear Viewport
        ctx.clearRect(0, 0, w, h);

        // 1. Draw Grid Lines
        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(255, 255, 255, 0.035)";
        ctx.fillStyle = "rgba(255, 255, 255, 0.25)";
        ctx.font = "11px 'Roboto Mono', monospace";
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";

        const numGridLines = 5;
        
        // Moving/Sliding Grid logic during flight
        if (state.gameState === "FLYING") {
            gridOffset = (gridOffset - dt * 45) % 60;
        } else {
            gridOffset = 0;
        }

        // Draw Y Axis gridlines (Multiplier thresholds)
        for (let i = 0; i <= numGridLines; i++) {
            const ratio = i / numGridLines;
            const yPos = paddingTop + chartH * (1 - ratio);
            
            ctx.beginPath();
            ctx.moveTo(paddingLeft, yPos);
            ctx.lineTo(w - paddingRight, yPos);
            ctx.stroke();

            // Label
            const gridVal = 1.0 + (scaleY - 1.0) * ratio;
            ctx.fillText(gridVal.toFixed(1) + "x", paddingLeft - 10, yPos);
        }

        // Draw X Axis gridlines (Time scales)
        ctx.textAlign = "center";
        ctx.textBaseline = "top";
        for (let i = 0; i <= numGridLines; i++) {
            const ratio = i / numGridLines;
            let xPos = paddingLeft + chartW * ratio;
            
            // Slide grid lines slightly to the left during active flight to give speed feeling
            if (state.gameState === "FLYING") {
                xPos += gridOffset * (chartW / w);
            }

            if (xPos >= paddingLeft && xPos <= w - paddingRight) {
                ctx.beginPath();
                ctx.moveTo(xPos, paddingTop);
                ctx.lineTo(xPos, h - paddingBottom);
                ctx.stroke();

                const gridTime = scaleX * ratio;
                ctx.fillText(gridTime.toFixed(1) + "s", xPos, h - paddingBottom + 10);
            }
        }

        // 2. State Specific Drawings
        if (state.gameState === "LOBBY") {
            // Draw static zero line
            ctx.beginPath();
            ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
            ctx.lineWidth = 2;
            ctx.moveTo(paddingLeft, h - paddingBottom);
            ctx.lineTo(paddingLeft + 50, h - paddingBottom - 8);
            ctx.stroke();

            // Reset curves
            particles = [];
            scaleX = 5.0;
            scaleY = 2.0;

        } else if (state.gameState === "FLYING") {
            // (State variables are precisely synced by clock in syncGameLifecycle)

            // Dynamic Axis Scaling
            if (state.elapsedSeconds > scaleX * 0.7) {
                scaleX = state.elapsedSeconds / 0.7;
            }
            if (state.activeMultiplier > scaleY * 0.7) {
                scaleY = state.activeMultiplier / 0.7;
            }

            // Map flight point to physical pixels
            const currentRatioX = state.elapsedSeconds / scaleX;
            const currentRatioY = (state.activeMultiplier - 1.0) / (scaleY - 1.0);

            planeX = paddingLeft + chartW * currentRatioX;
            planeY = paddingTop + chartH * (1 - currentRatioY);

            // Bounds protection
            planeX = Math.min(planeX, w - paddingRight);
            planeY = Math.max(planeY, paddingTop);

            // Engine sound tick
            playSound("engine", state.activeMultiplier);

            // Generate thrust particles
            if (Math.random() > 0.2) {
                addParticle(planeX - 10, planeY);
            }

            // Update & Render Particles
            particles.forEach((p, idx) => {
                p.x += p.vx * dt * 60;
                p.y += p.vy * dt * 60;
                p.life -= p.decay;
                p.alpha = Math.max(0, p.life);

                if (p.life <= 0) {
                    particles.splice(idx, 1);
                } else {
                    ctx.fillStyle = p.color.replace('alpha', p.alpha.toFixed(2));
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size * p.life, 0, Math.PI * 2);
                    ctx.fill();
                }
            });

            // Draw glowing flight ribbon path
            ctx.save();
            ctx.lineWidth = 4;
            ctx.strokeStyle = "var(--primary-red)";
            ctx.shadowBlur = 12;
            ctx.shadowColor = "var(--primary-red-glow)";
            
            ctx.beginPath();
            ctx.moveTo(paddingLeft, h - paddingBottom);
            
            // Plot exponential curve history on screen
            const segments = 40;
            for (let i = 0; i <= segments; i++) {
                const segT = (state.elapsedSeconds * (i / segments));
                const segVal = Math.pow(Math.E, 0.065 * segT);
                
                const segX = paddingLeft + chartW * (segT / scaleX);
                const segY = paddingTop + chartH * (1 - (segVal - 1.0) / (scaleY - 1.0));
                
                if (segX <= planeX) {
                    ctx.lineTo(segX, segY);
                }
            }
            ctx.stroke();
            ctx.restore();

            // Gradient filling under curve
            const fillGrad = ctx.createLinearGradient(paddingLeft, h - paddingBottom, paddingLeft, paddingTop);
            fillGrad.addColorStop(0, "rgba(226, 27, 60, 0.0)");
            fillGrad.addColorStop(1, "rgba(226, 27, 60, 0.15)");
            ctx.fillStyle = fillGrad;
            
            ctx.beginPath();
            ctx.moveTo(paddingLeft, h - paddingBottom);
            for (let i = 0; i <= segments; i++) {
                const segT = (state.elapsedSeconds * (i / segments));
                const segVal = Math.pow(Math.E, 0.065 * segT);
                const segX = paddingLeft + chartW * (segT / scaleX);
                const segY = paddingTop + chartH * (1 - (segVal - 1.0) / (scaleY - 1.0));
                if (segX <= planeX) {
                    ctx.lineTo(segX, segY);
                }
            }
            ctx.lineTo(planeX, h - paddingBottom);
            ctx.closePath();
            ctx.fill();

            // Render vector airplane
            // Calculate incline angle based on curve slope
            const nextT = state.elapsedSeconds + 0.1;
            const nextVal = Math.pow(Math.E, 0.065 * nextT);
            const nextX = paddingLeft + chartW * (nextT / scaleX);
            const nextY = paddingTop + chartH * (1 - (nextVal - 1.0) / (scaleY - 1.0));
            const angle = Math.atan2(nextY - planeY, nextX - planeX);

            // Add slight hover/wobble displacement so plane looks like it is riding wind turbulence
            const turbulenceY = Math.sin(timestamp / 80) * 2;
            drawVectorPlane(planeX, planeY + turbulenceY, angle);

            // Live HUD text update
            document.getElementById("liveMultiplier").innerText = state.activeMultiplier.toFixed(2) + "x";



        } else if (state.gameState === "CRASHED") {
            // Draw frozen red line
            ctx.lineWidth = 3;
            ctx.strokeStyle = "rgba(226, 27, 60, 0.3)";
            ctx.beginPath();
            ctx.moveTo(paddingLeft, h - paddingBottom);
            
            const segments = 40;
            const flightTime = Math.log(state.crashMultiplier) / 0.065;
            for (let i = 0; i <= segments; i++) {
                const segT = (flightTime * (i / segments));
                const segVal = Math.pow(Math.E, 0.065 * segT);
                const segX = paddingLeft + chartW * (segT / scaleX);
                const segY = paddingTop + chartH * (1 - (segVal - 1.0) / (scaleY - 1.0));
                ctx.lineTo(segX, segY);
            }
            ctx.stroke();

            // Animate plane blasting away off coordinates
            gridOffset = 0;
            planeX += dt * 350;
            planeY -= dt * 250;
            
            if (planeX < w && planeY > 0) {
                drawVectorPlane(planeX, planeY, -Math.PI / 8);
            }
        }

        requestAnimationFrame(renderFlightLoop);
    }

    // Initialize core animation frames
    requestAnimationFrame(renderFlightLoop);

    // ==========================================================================
    // 4. GAME SYSTEM LIFECYCLE CONTROLLER
    // ==========================================================================
    
    // Calculates authentic crash multipliers using a provably fair formula
    function generateCrashPoint() {
        // Check Admin panel rigging override
        const adminOverride = localStorage.getItem("aviator_next_crash");
        if (adminOverride) {
            const overrideVal = parseFloat(adminOverride);
            localStorage.removeItem("aviator_next_crash"); // Clear override so it is a one-shot cheat/test
            if (!isNaN(overrideVal) && overrideVal >= 1.00) {
                console.log(`[ADMIN RIGGING] Overriding next crash point to: ${overrideVal.toFixed(2)}x`);
                const serverSeed = "ADMIN_SECURE_OVERRIDE_SEED";
                document.getElementById("fairServerSeed").value = serverSeed;
                return overrideVal;
            }
        }

        const serverSeed = Math.random().toString(16).substring(2, 18);
        const clientSeed = state.user.seed;
        
        // Generate cryptographic percentages
        // Formula: 1.01 + 0.99 * (99 / (100 - X))
        const randomPercent = Math.random() * 99; // Yields a value between 0 and 99
        let result = 1.01 + 0.99 * (99 / (100 - randomPercent));
        
        // Max cap
        if (result > 5000) result = 5000;
        
        // 3% chance of instant crash at exactly 1.00x
        if (Math.random() < 0.03) {
            result = 1.00;
        }

        console.log(`[CRYPTO] ServerSeed: ${serverSeed} | Outcome: ${result.toFixed(2)}x`);
        document.getElementById("fairServerSeed").value = serverSeed;
        return result;
    }

    function startLobbyPhase() {}
    function startFlightPhase() {}
    function triggerCrash() {}

    // ==========================================================================
    // 5. DOUBLE BETTING ACTION PORTALS
    // ==========================================================================
    
    // Bind panels interactions
    function setupBettingHandlers() {
        document.querySelectorAll(".bet-card").forEach(card => {
            const panelId = parseInt(card.dataset.panelId);
            const btn = card.querySelector(".main-bet-btn");
            const amtInput = card.querySelector(".amount-input");
            const decBtn = card.querySelector(".dec-btn");
            const incBtn = card.querySelector(".inc-btn");

            // Direct Tab selection (Bet / Auto)
            card.querySelectorAll(".bet-tab").forEach(tab => {
                tab.addEventListener("click", () => {
                    card.querySelectorAll(".bet-tab").forEach(t => t.classList.remove("active"));
                    tab.classList.add("active");

                    const drawer = card.querySelector(".auto-drawer");
                    if (tab.dataset.tab === "auto") {
                        drawer.classList.add("open");
                    } else {
                        drawer.classList.remove("open");
                    }
                });
            });

            // Fast Incrementers
            decBtn.addEventListener("click", () => {
                let val = parseFloat(amtInput.value) - 1;
                if (val < 1) val = 1;
                amtInput.value = val.toFixed(0);
                updateBetCardLabels(card);
            });
            incBtn.addEventListener("click", () => {
                let val = parseFloat(amtInput.value) + 1;
                amtInput.value = val.toFixed(0);
                updateBetCardLabels(card);
            });
            amtInput.addEventListener("input", () => {
                if (parseFloat(amtInput.value) < 1) amtInput.value = 1;
                updateBetCardLabels(card);
            });

            // Quick select bets ($10, $50, $100, $200)
            card.querySelectorAll(".quick-btn").forEach(quick => {
                quick.addEventListener("click", () => {
                    amtInput.value = quick.dataset.val;
                    updateBetCardLabels(card);
                });
            });

            // Principal Big Action Bet Button
            btn.addEventListener("click", () => {
                triggerPanelPrimaryAction(panelId);
            });

            // Auto Play checkboxes
            const autoBetSwitch = card.querySelector(".auto-bet-switch");
            autoBetSwitch.addEventListener("change", (e) => {
                state.panels[panelId].isAutoBet = e.target.checked;
            });

            const autoCashSwitch = card.querySelector(".auto-cashout-switch");
            autoCashSwitch.addEventListener("change", (e) => {
                state.panels[panelId].isAutoCash = e.target.checked;
            });

            const autoMultInput = card.querySelector(".auto-mult-input");
            autoMultInput.addEventListener("input", (e) => {
                let val = parseFloat(e.target.value);
                if (val < 1.01) val = 1.01;
                state.panels[panelId].autoCashMult = val;
            });
        });
    }

    function updateBetCardLabels(card) {
        const panelId = parseInt(card.dataset.panelId);
        const inputVal = parseFloat(card.querySelector(".amount-input").value) || 100;
        state.panels[panelId].amount = inputVal;
        
        const btn = card.querySelector(".main-bet-btn");
        if (btn.classList.contains("bet-state-ready")) {
            btn.querySelector(".btn-amount-label").innerText = "₹" + inputVal.toFixed(2);
        }
    }

    function triggerPanelPrimaryAction(panelId) {
        syncUserBalanceFromStorage();
        const panel = state.panels[panelId];
        const card = document.getElementById(`betCard${panelId}`);
        const btn = card.querySelector(".main-bet-btn");

        if (state.gameState === "LOBBY") {
            // Placing/Cancelling Bet during Lobby Countdown
            if (!panel.isPlaced) {
                // Verify Wallet balance
                if (state.user.balance < panel.amount) {
                    showNotification("Insufficient balance! Please deposit to play real money.", "error");
                    return;
                }
                
                // Deduct Balance
                state.user.balance -= panel.amount;
                panel.isPlaced = true;
                panel.isCashedOut = false;
                panel.winAmount = 0.00;
                panel.cashOutMult = 0.00;

                updateWalletDisplay();
                saveUserSession();

                btn.className = "main-bet-btn bet-state-placed";
                btn.querySelector(".btn-subtext").innerText = "CANCEL BET";
                btn.querySelector(".btn-amount-label").innerText = "₹" + panel.amount.toFixed(2);
                card.classList.add("active-bet");
                
                addTransaction(`Aviator Bet Placed (Panel ${panelId})`, "BET", -panel.amount);
            } else {
                // Cancel Bet
                state.user.balance += panel.amount;
                panel.isPlaced = false;

                updateWalletDisplay();
                saveUserSession();

                btn.className = "main-bet-btn bet-state-ready";
                btn.querySelector(".btn-subtext").innerText = "BET";
                btn.querySelector(".btn-amount-label").innerText = "₹" + panel.amount.toFixed(2);
                card.classList.remove("active-bet");

                addTransaction(`Aviator Bet Cancelled (Panel ${panelId})`, "CANCEL", panel.amount);
            }

        } else if (state.gameState === "FLYING") {
            // Cashout or Queue bet for Next Round
            if (panel.isPlaced && !panel.isCashedOut) {
                // TRIGGER CASH OUT!
                panel.isCashedOut = true;
                panel.cashOutMult = state.activeMultiplier;
                panel.winAmount = panel.amount * panel.cashOutMult;
                
                // Add balance
                state.user.balance += panel.winAmount;
                updateWalletDisplay();
                
                // Save Statistics
                state.user.stats.winsCount++;
                state.user.stats.totalGames++;
                state.user.stats.netProfit += (panel.winAmount - panel.amount);
                saveUserSession();

                playSound("cashout");

                btn.className = "main-bet-btn bet-state-cashed";
                btn.disabled = true;
                btn.querySelector(".btn-subtext").innerText = "CASHED OUT";
                btn.querySelector(".btn-amount-label").innerText = "₹" + panel.winAmount.toFixed(2);
                card.classList.remove("active-bet");

                // Dynamic Flash Alert inside card
                const flash = document.createElement("div");
                flash.style.position = "absolute";
                flash.style.top = "0";
                flash.style.left = "0";
                flash.style.width = "100%";
                flash.style.height = "100%";
                flash.style.background = "rgba(0, 230, 118, 0.15)";
                flash.style.borderRadius = "20px";
                flash.style.pointerEvents = "none";
                flash.style.transition = "opacity 0.6s ease";
                card.appendChild(flash);
                setTimeout(() => { flash.style.opacity = "0"; setTimeout(() => flash.remove(), 600); }, 50);

                addTransaction(`Aviator Cash Out (Panel ${panelId} @ ${panel.cashOutMult.toFixed(2)}x)`, "WIN", panel.winAmount);
                syncMyHistoryPanel();

            } else {
                // Queue bet for next round
                if (!panel.isPlacedForNextRound) {
                    if (state.user.balance < panel.amount) {
                        showNotification("Insufficient balance to queue next bet!", "error");
                        return;
                    }
                    panel.isPlacedForNextRound = true;
                    btn.className = "main-bet-btn bet-state-placed";
                    btn.querySelector(".btn-subtext").innerText = "QUEUED FOR NEXT";
                    btn.querySelector(".btn-amount-label").innerText = "₹" + panel.amount.toFixed(2);
                } else {
                    panel.isPlacedForNextRound = false;
                    btn.className = "main-bet-btn bet-state-ready";
                    btn.querySelector(".btn-subtext").innerText = "BET";
                    btn.querySelector(".btn-amount-label").innerText = "₹" + panel.amount.toFixed(2);
                }
            }
        }
        savePanelsState();
    }

    function processAutoBets() {
        syncUserBalanceFromStorage();
        for (let panelId = 1; panelId <= 2; panelId++) {
            const panel = state.panels[panelId];
            const card = document.getElementById(`betCard${panelId}`);
            const btn = card.querySelector(".main-bet-btn");

            // Reset disables
            btn.disabled = false;

            if (panel.isPlacedForNextRound || (panel.isAutoBet && !panel.isPlaced)) {
                // Auto Bet Triggered
                if (state.user.balance >= panel.amount) {
                    state.user.balance -= panel.amount;
                    panel.isPlaced = true;
                    panel.isCashedOut = false;
                    panel.winAmount = 0.00;
                    panel.cashOutMult = 0.00;
                    panel.isPlacedForNextRound = false;

                    updateWalletDisplay();
                    saveUserSession();

                    btn.className = "main-bet-btn bet-state-placed";
                    btn.querySelector(".btn-subtext").innerText = "CANCEL AUTO";
                    btn.querySelector(".btn-amount-label").innerText = "₹" + panel.amount.toFixed(2);
                    card.classList.add("active-bet");

                    addTransaction(`Auto-Bet Placed (Panel ${panelId})`, "BET", -panel.amount);
                } else {
                    panel.isPlaced = false;
                    panel.isPlacedForNextRound = false;
                    btn.className = "main-bet-btn bet-state-ready";
                    btn.querySelector(".btn-subtext").innerText = "INSUFFICIENT BAL";
                    card.classList.remove("active-bet");
                }
            } else {
                panel.isPlaced = false;
                btn.className = "main-bet-btn bet-state-ready";
                btn.querySelector(".btn-subtext").innerText = "BET";
                btn.querySelector(".btn-amount-label").innerText = "₹" + panel.amount.toFixed(2);
                card.classList.remove("active-bet");
            }
        }
    }

    function syncActiveBetPanels() {
        for (let panelId = 1; panelId <= 2; panelId++) {
            const panel = state.panels[panelId];
            const card = document.getElementById(`betCard${panelId}`);
            const btn = card.querySelector(".main-bet-btn");

            if (panel.isPlaced) {
                btn.className = "main-bet-btn bet-state-cashout";
                btn.querySelector(".btn-subtext").innerText = "CASH OUT";
                btn.querySelector(".btn-amount-label").innerText = "₹" + (panel.amount * state.activeMultiplier).toFixed(2);
            } else {
                btn.className = "main-bet-btn bet-state-ready";
                btn.querySelector(".btn-subtext").innerText = "BET";
                btn.querySelector(".btn-amount-label").innerText = "₹" + panel.amount.toFixed(2);
            }
        }
    }

    function checkAutoCashouts() {
        for (let panelId = 1; panelId <= 2; panelId++) {
            const panel = state.panels[panelId];
            if (panel.isPlaced && !panel.isCashedOut) {
                
                // Display Live Cashout values on active buttons
                const btn = document.getElementById(`betCard${panelId}`).querySelector(".main-bet-btn");
                btn.querySelector(".btn-amount-label").innerText = "₹" + (panel.amount * state.activeMultiplier).toFixed(2);

                if (panel.isAutoCash && state.activeMultiplier >= panel.autoCashMult) {
                    // Trigger instant Auto cashout
                    triggerPanelPrimaryAction(panelId);
                }
            }
        }
    }

    function processRoundResults() {
        for (let panelId = 1; panelId <= 2; panelId++) {
            const panel = state.panels[panelId];
            const card = document.getElementById(`betCard${panelId}`);
            const btn = card.querySelector(".main-bet-btn");

            if (panel.isPlaced) {
                if (!panel.isCashedOut) {
                    // LOSS! Plane Flew Away before cash out
                    state.user.stats.totalGames++;
                    state.user.stats.netProfit -= panel.amount;
                    saveUserSession();

                    btn.className = "main-bet-btn bet-state-ready";
                    btn.querySelector(".btn-subtext").innerText = "LOST BET";
                    btn.querySelector(".btn-amount-label").innerText = "-₹" + panel.amount.toFixed(2);
                    card.classList.remove("active-bet");
                    
                    addTransaction(`Aviator Bet Loss (Panel ${panelId})`, "LOSS", -panel.amount);
                }
                
                panel.isPlaced = false;
                panel.isCashedOut = false;
            }
            
            // Clear queued states
            btn.disabled = false;
        }

        // Sync statistics
        if (state.user.stats.totalGames > 0) {
            state.user.stats.winRate = Math.round((state.user.stats.winsCount / state.user.stats.totalGames) * 100);
        } else {
            state.user.stats.winRate = 0;
        }
        saveUserSession();
        updateProfileStatsUI();
        syncMyHistoryPanel();
    }

    // ==========================================================================
    // 6. MULTIPLAYER LOBBY SIMULATOR
    // ==========================================================================
    const BOT_USERNAMES = [
        "CryptoKing", "SkyQueen", "AviatorMax", "WinZilla", "LuckyDigger",
        "Rider99", "AlphaPilot", "RocketMan", "GoldMiner", "MoonShot",
        "TurboX", "Crasher", "JetSetter", "CloudRider", "SpinBoss",
        "ZeusX", "VegasTiger", "Nirvana", "AceFlyer", "BetMonster",
        "ApexPredator", "RedBull", "Stargazer", "Meteor", "BulletJet",
        "GamerPro", "DoubleWin", "NeonFlyer", "AeroPilot", "HighClimber"
    ];

    function simulateLobbyBets() {
        state.simulatedBets = [];
        const numBots = 12 + Math.floor(Math.random() * 12); // Spawns 12 to 24 bots
        
        for (let i = 0; i < numBots; i++) {
            const name = BOT_USERNAMES[Math.floor(Math.random() * BOT_USERNAMES.length)] + "_" + Math.floor(10 + Math.random() * 90);
            const betVal = (Math.random() > 0.6 ? (10 + Math.floor(Math.random() * 9) * 10) : (5 + Math.floor(Math.random() * 5) * 5)) * 10;
            
            // Random crash multipliers targeted by bots
            const targetMult = 1.10 + Math.pow(Math.random(), 2.2) * 8; // bots cash out mostly between 1.1x and 9x
            
            state.simulatedBets.push({
                username: name,
                avatar: `https://api.dicebear.com/7.x/bottts/svg?seed=${name}`,
                betAmount: betVal,
                targetMult: parseFloat(targetMult.toFixed(2)),
                isCashedOut: false,
                winAmount: 0.00,
                cashOutMult: 0.00
            });
        }

        updateLobbyBetsUI();
    }

    function triggerSimulatedCashouts() {
        // Repeated check during FLYING to see if bots reached cashout limits
        const botTimer = setInterval(() => {
            if (state.gameState !== "FLYING") {
                clearInterval(botTimer);
                return;
            }

            let updated = false;
            state.simulatedBets.forEach(bot => {
                if (!bot.isCashedOut && state.activeMultiplier >= bot.targetMult && bot.targetMult < state.crashMultiplier) {
                    bot.isCashedOut = true;
                    bot.cashOutMult = bot.targetMult;
                    bot.winAmount = bot.betAmount * bot.cashOutMult;
                    updated = true;
                }
            });

            if (updated) {
                updateLobbyBetsUI();
            }
        }, 100);
    }

    // ==========================================================================
    // 7. INTERACTIVE CHAT ROOM SIMULATOR (Reacting Bots!)
    // ==========================================================================
    const CHAT_BOTS = [
        { name: "SkyQueen_44", avatar: "SkyQueen" },
        { name: "CryptoKing_99", avatar: "CryptoKing" },
        { name: "RocketMan_77", avatar: "RocketMan" },
        { name: "JetSetter_07", avatar: "JetSetter" },
        { name: "NeonFlyer_12", avatar: "NeonFlyer" }
    ];

    const EARLY_CRASH_COMMENTS = [
        "ugh instant crash again...",
        "wtf 1.05x really?",
        "unbelievable, was waiting for at least 2x",
        "crashed at 1.00x how is that fair lol",
        "this plane has zero fuel today",
        "next one is going higher, bet on it!",
        "placed a double bet and lost both instantly fml"
    ];

    const LARGE_WIN_COMMENTS = [
        "OMG held till 12x!",
        "holy cow 25x payout!",
        "to the moon!!!",
        "i cashed out way too early at 1.5x :(",
        "who holds to 10x? absolute legends",
        "this is massive, best crash run today!",
        "insane multiplier, pocketed ₹50,000!"
    ];

    const GENERAL_COMMENTS = [
        "any big strategies?",
        "auto cashout at 1.50x is saving me",
        "what's the next target fellas?",
        "provably fair is green, verified seeds look good",
        "good luck everyone this round!",
        "deposited ₹15,000, aiming for ₹80,000 today"
    ];

    function simulatedChatReaction(crashMult) {
        // Spawn reactions randomly
        setTimeout(() => {
            const bot = CHAT_BOTS[Math.floor(Math.random() * CHAT_BOTS.length)];
            let msg = "";

            if (crashMult < 1.20) {
                msg = EARLY_CRASH_COMMENTS[Math.floor(Math.random() * EARLY_CRASH_COMMENTS.length)];
            } else if (crashMult > 8.0) {
                msg = LARGE_WIN_COMMENTS[Math.floor(Math.random() * LARGE_WIN_COMMENTS.length)];
            } else {
                msg = GENERAL_COMMENTS[Math.floor(Math.random() * GENERAL_COMMENTS.length)];
            }

            appendChatMessage(bot.name, msg, false, bot.avatar);
        }, 1500 + Math.random() * 2000);
    }

    function appendChatMessage(username, text, isMyself = false, avatarSeed = "LuckyPilot") {
        const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const container = document.getElementById("chatContainer");

        const msgNode = document.createElement("div");
        msgNode.className = "chat-msg";
        
        let userClass = "chat-user";
        if (isMyself) userClass += " is-myself";
        else if (username.includes("Mod_")) userClass += " is-moderator";

        msgNode.innerHTML = `
            <img src="https://api.dicebear.com/7.x/bottts/svg?seed=${avatarSeed}" alt="Avatar" class="user-avatar-small">
            <div class="chat-bubble">
                <div class="msg-header">
                    <span class="${userClass}">${username}</span>
                    <span class="chat-time">${time}</span>
                </div>
                <div class="msg-text">${text}</div>
            </div>
        `;

        container.appendChild(msgNode);
        container.scrollTop = container.scrollHeight;
    }

    // Handles user typed chat message submission + triggers automated response bots!
    document.getElementById("chatForm").addEventListener("submit", (e) => {
        e.preventDefault();
        const input = document.getElementById("chatInput");
        const msgText = input.value.trim();
        if (!msgText) return;

        appendChatMessage(state.user.nickname, msgText, true, state.user.nickname);
        input.value = "";

        // Trigger bot reply
        setTimeout(() => {
            const bot = CHAT_BOTS[Math.floor(Math.random() * CHAT_BOTS.length)];
            const replies = [
                `nice one @${state.user.nickname}`,
                `true that!`,
                `what's your target multiplier next round @${state.user.nickname}?`,
                `agreed! let's secure some cash.`,
                `lol let's go!!`
            ];
            appendChatMessage(bot.name, replies[Math.floor(Math.random() * replies.length)], false, bot.avatar);
        }, 1000 + Math.random() * 1500);
    });

    // ==========================================================================
    // 8. INTERACTIVE DYNAMIC UI SYNCHRONISERS
    // ==========================================================================
    
    function updateWalletDisplay() {
        const formatted = "₹" + state.user.balance.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        document.getElementById("topbarBalance").innerText = formatted;
        document.getElementById("withdrawAvailable").innerText = formatted;
    }

    function updateProfileStatsUI() {
        document.getElementById("profileNickname").innerText = state.user.nickname;
        document.getElementById("editNickname").value = state.user.nickname;
        document.getElementById("profileEmailVal").value = state.user.email;
        
        // Metrics
        document.getElementById("statNetProfit").innerText = (state.user.stats.netProfit >= 0 ? "+" : "") + "₹" + state.user.stats.netProfit.toFixed(2);
        document.getElementById("statNetProfit").className = "metric-value " + (state.user.stats.netProfit >= 0 ? "green" : "red");
        document.getElementById("statWinRate").innerText = state.user.stats.winRate + "%";
        document.getElementById("statTotalGames").innerText = state.user.stats.totalGames;
    }

    function updateTransactionsUI() {
        const tbody = document.getElementById("txnTableBody");
        tbody.innerHTML = "";

        if (state.transactions.length === 0) {
            tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color:var(--text-muted);">No transaction logs available.</td></tr>`;
            return;
        }

        state.transactions.forEach(t => {
            const tr = document.createElement("tr");
            let amtClass = "txn-amount";
            if (t.type === "DEPOSIT" || t.type === "WIN" || t.type === "CANCEL") amtClass += " in";
            else amtClass += " out";

            let statusClass = "success";
            if (t.status === "PENDING") statusClass = "pending";
            else if (t.status === "REJECTED") statusClass = "rejected";

            tr.innerHTML = `
                <td style="color:var(--text-secondary);">${t.date}</td>
                <td style="font-weight:600;">${t.desc}</td>
                <td style="color:var(--text-muted); font-weight:700;">${t.type}</td>
                <td class="${amtClass}">${t.amount >= 0 ? "+" : ""}₹${Math.abs(t.amount).toFixed(2)}</td>
                <td><span class="txn-status ${statusClass}">${t.status}</span></td>
            `;
            tbody.appendChild(tr);
        });
    }

    function updateMultiplierRibbon() {
        const track = document.getElementById("multiplierHistory");
        track.innerHTML = "";

        state.roundHistory.forEach(mult => {
            const badge = document.createElement("div");
            
            // Assign Tier classes based on multiplier sizing
            let tier = "low";
            if (mult >= 10.00) tier = "gold";
            else if (mult >= 2.00) tier = "high";
            else if (mult >= 1.20) tier = "mid";

            badge.className = `mult-badge ${tier}`;
            badge.innerText = mult.toFixed(2) + "x";

            // Click multiplier badge to verify seeds
            badge.addEventListener("click", () => {
                const seedHash = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
                alert(`Round Multiplier: ${mult.toFixed(2)}x\nProvably Fair SHA-256 Hash:\n${seedHash.toUpperCase()}`);
            });

            track.appendChild(badge);
        });
    }

    function updateLobbyBetsUI() {
        const container = document.getElementById("betsListContainer");
        container.innerHTML = "";

        let totalBetsVal = 0;
        let activeCount = 0;

        // Render simulated bets
        state.simulatedBets.forEach(bot => {
            totalBetsVal += bot.betAmount;
            activeCount++;

            const row = document.createElement("div");
            row.className = "bet-row-item";
            
            let payoutHtml = `<span style="color:var(--text-muted); font-family:var(--font-mono);">-</span>`;
            let profitHtml = `<span style="color:var(--text-muted); font-family:var(--font-mono);">-</span>`;
            
            if (bot.isCashedOut) {
                payoutHtml = `<span class="payout-pill">${bot.cashOutMult.toFixed(2)}x</span>`;
                profitHtml = `+₹${bot.winAmount.toFixed(2)}`;
            }

            row.innerHTML = `
                <div class="user-cell">
                    <img src="${bot.avatar}" class="user-avatar-small">
                    <span class="user-name-label">${bot.username}</span>
                </div>
                <div class="bet-amount-cell">₹${bot.betAmount.toFixed(2)}</div>
                <div class="cashout-mult-cell">${payoutHtml}</div>
                <div class="payout-profit-cell">${profitHtml}</div>
            `;
            container.appendChild(row);
        });

        // Add standard User bet row if placed
        for (let panelId = 1; panelId <= 2; panelId++) {
            const panel = state.panels[panelId];
            if (panel.isPlaced) {
                totalBetsVal += panel.amount;
                activeCount++;

                const row = document.createElement("div");
                row.className = "bet-row-item user-bet-row";
                
                let payoutHtml = `<span style="color:var(--text-muted); font-family:var(--font-mono);">Active...</span>`;
                let profitHtml = `<span style="color:var(--text-muted); font-family:var(--font-mono);">-</span>`;

                if (panel.isCashedOut) {
                    payoutHtml = `<span class="payout-pill" style="background:var(--success-green); color:var(--bg-darker);">${panel.cashOutMult.toFixed(2)}x</span>`;
                    profitHtml = `+₹${panel.winAmount.toFixed(2)}`;
                }

                row.innerHTML = `
                    <div class="user-cell">
                        <img src="https://api.dicebear.com/7.x/bottts/svg?seed=${state.user.nickname}" class="user-avatar-small">
                        <span class="user-name-label" style="color:var(--success-green); font-weight:700;">${state.user.nickname} (P${panelId})</span>
                    </div>
                    <div class="bet-amount-cell" style="font-weight:700;">₹${panel.amount.toFixed(2)}</div>
                    <div class="cashout-mult-cell">${payoutHtml}</div>
                    <div class="payout-profit-cell" style="color:var(--success-green);">${profitHtml}</div>
                `;
                // Add to start of bet list
                container.insertBefore(row, container.firstChild);
            }
        }

        document.getElementById("activeBetsCount").innerText = `${activeCount} Bets (₹${totalBetsVal.toFixed(2)})`;
    }

    function syncMyHistoryPanel() {
        const container = document.getElementById("myBetsContainer");
        container.innerHTML = "";
        
        let personalWins = state.transactions.filter(t => t.desc.includes("Cash Out") || t.desc.includes("Loss"));
        document.getElementById("myBetsSummary").innerText = `${personalWins.length} Games`;

        if (personalWins.length === 0) {
            container.innerHTML = `<div style="padding: 30px; text-align:center; color:var(--text-muted); font-size:12px;">No historical games played.</div>`;
            return;
        }

        // List user recent historical rounds
        personalWins.slice(0, 15).forEach(txn => {
            const row = document.createElement("div");
            row.className = "bet-row-item";
            
            const isLoss = txn.type === "LOSS";
            const amtDisplay = isLoss ? `-₹${Math.abs(txn.amount).toFixed(2)}` : `+₹${txn.amount.toFixed(2)}`;
            const colorClass = isLoss ? `color:var(--primary-red);` : `color:var(--success-green); font-weight:700;`;

            row.innerHTML = `
                <div class="user-cell">
                    <span style="font-size:14px;">✈️</span>
                    <span class="user-name-label" style="font-weight:600;">${txn.desc.split(" (")[0]}</span>
                </div>
                <div style="font-size:10px; color:var(--text-muted);">${txn.date.split(", ")[1]}</div>
                <div style="font-family:var(--font-mono); font-weight:700; font-size:11px; text-align:right; width:90px; ${colorClass}">${amtDisplay}</div>
            `;
            container.appendChild(row);
        });
    }

    // ==========================================================================
    // 9. MODALS DIALOGS TRIGGERS Setup
    // ==========================================================================
    function setupModals() {
        // Profile Modal triggers
        const profileModal = document.getElementById("profileModal");
        const userBtn = document.getElementById("userMenuBtn");
        const closeProfileBtn = document.getElementById("profileCloseBtn");

        userBtn.addEventListener("click", () => {
            initAudio();
            updateProfileStatsUI();
            updateTransactionsUI();
            profileModal.classList.add("open");
        });
        closeProfileBtn.addEventListener("click", () => {
            profileModal.classList.remove("open");
        });

        // Sign Out trigger
        document.getElementById("logoutBtn").addEventListener("click", () => {
            if (confirm("Are you sure you want to sign out of your account session?")) {
                if (state.user) {
                    state.user.isLoggedIn = false;
                    saveUserSession();
                }
                localStorage.removeItem("aviator_user"); // Clear active user session

                // Create a premium, beautiful fullscreen logout transition overlay
                const logoutOverlay = document.createElement("div");
                logoutOverlay.style.position = "fixed";
                logoutOverlay.style.top = "0";
                logoutOverlay.style.left = "0";
                logoutOverlay.style.width = "100vw";
                logoutOverlay.style.height = "100vh";
                logoutOverlay.style.background = "radial-gradient(circle at center, #1b1e2e 0%, #0c0d12 100%)";
                logoutOverlay.style.color = "#ffffff";
                logoutOverlay.style.display = "flex";
                logoutOverlay.style.flexDirection = "column";
                logoutOverlay.style.alignItems = "center";
                logoutOverlay.style.justifyContent = "center";
                logoutOverlay.style.zIndex = "999999";
                logoutOverlay.style.opacity = "0";
                logoutOverlay.style.transition = "opacity 0.6s ease, transform 0.6s cubic-bezier(0.16, 1, 0.3, 1)";
                logoutOverlay.style.transform = "scale(1.1)";
                logoutOverlay.style.backdropFilter = "blur(12px)";

                logoutOverlay.innerHTML = `
                    <div style="text-align: center; display: flex; flex-direction: column; align-items: center; gap: 24px;">
                        <!-- Spinning Flight Radar Icon -->
                        <div style="position: relative; width: 80px; height: 80px; display: flex; align-items: center; justify-content: center;">
                            <div style="position: absolute; width: 100%; height: 100%; border: 3px dashed var(--primary-red); border-radius: 50%; animation: spin 4s linear infinite; opacity: 0.8;"></div>
                            <div style="position: absolute; width: 80%; height: 80%; border: 2px solid var(--info-cyan); border-radius: 50%; opacity: 0.3;"></div>
                            <span style="font-size: 32px; filter: drop-shadow(0 0 10px var(--primary-red)); transform: rotate(-45deg);">✈️</span>
                        </div>
                        
                        <!-- Beautiful Animated Message -->
                        <div style="opacity: 0; transform: translateY(20px); animation: fadeInUp 0.8s forwards 0.3s;">
                            <h2 style="font-size: 22px; font-weight: 700; letter-spacing: 1px; color: #ffffff; margin-bottom: 8px;">
                                Disconnecting from Flight Control
                            </h2>
                            <p style="font-size: 14px; color: var(--text-secondary);">
                                🔒 Wiping session keys safely... Clear skies, Pilot!
                            </p>
                        </div>
                    </div>
                    
                    <!-- Inline keyframes -->
                    <style>
                        @keyframes spin {
                            0% { transform: rotate(0deg); }
                            100% { transform: rotate(360deg); }
                        }
                        @keyframes fadeInUp {
                            to {
                                opacity: 1;
                                transform: translateY(0);
                            }
                        }
                    </style>
                `;

                document.body.appendChild(logoutOverlay);

                // Trigger smooth slide-in/fade-in animation
                requestAnimationFrame(() => {
                    logoutOverlay.style.opacity = "1";
                    logoutOverlay.style.transform = "scale(1)";
                });

                // Wait 1.8 seconds, then trigger fade out and redirect
                setTimeout(() => {
                    logoutOverlay.style.opacity = "0";
                    logoutOverlay.style.transform = "scale(0.9)";
                    setTimeout(() => {
                        window.location.href = "login.html";
                    }, 500);
                }, 1800);
            }
        });

        // Deposit Header buttons
        document.getElementById("headerDepositBtn").addEventListener("click", () => {
            initAudio();
            document.querySelectorAll(".profile-side-btn").forEach(btn => {
                btn.classList.remove("active");
                if (btn.dataset.tabPane === "paneDeposit") btn.classList.add("active");
            });
            document.querySelectorAll(".profile-pane").forEach(pane => {
                pane.classList.remove("active");
                if (pane.id === "paneDeposit") pane.classList.add("active");
            });
            profileModal.classList.add("open");
        });

        // Provably Fair Info triggers
        const fairModal = document.getElementById("fairModal");
        document.getElementById("provablyFairBtn").addEventListener("click", () => {
            initAudio();
            fairModal.classList.add("open");
        });
        document.getElementById("fairCloseBtn").addEventListener("click", () => {
            fairModal.classList.remove("open");
        });

        // Authentication Modal triggers (if logged out or clicking user avatar when logged out)
        const authModal = document.getElementById("authModal");
        document.getElementById("authCloseBtn").addEventListener("click", () => {
            authModal.classList.remove("open");
        });

        // Modal Auth Tabs setup
        authModal.querySelectorAll(".auth-tab-btn").forEach(tab => {
            tab.addEventListener("click", () => {
                authModal.querySelectorAll(".auth-tab-btn").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");

                authModal.querySelectorAll(".auth-form-pane").forEach(pane => pane.classList.remove("active"));
                document.getElementById(tab.dataset.target).classList.add("active");
            });
        });

        // Modals Side Menu triggers in Profile
        profileModal.querySelectorAll(".profile-side-btn").forEach(btn => {
            btn.addEventListener("click", () => {
                profileModal.querySelectorAll(".profile-side-btn").forEach(b => b.classList.remove("active"));
                btn.classList.add("active");

                profileModal.querySelectorAll(".profile-pane").forEach(pane => pane.classList.remove("active"));
                document.getElementById(btn.dataset.tabPane).classList.add("active");
            });
        });

        // Multi-Tab Sidebar panel selectors
        document.querySelectorAll(".sidebar-tab").forEach(tab => {
            tab.addEventListener("click", () => {
                document.querySelectorAll(".sidebar-tab").forEach(t => t.classList.remove("active"));
                tab.classList.add("active");

                document.querySelectorAll(".sidebar-pane").forEach(pane => pane.classList.remove("active"));
                document.getElementById(tab.dataset.pane).classList.add("active");
            });
        });

        // Closing modals on dim overlay clicking
        window.addEventListener("click", (e) => {
            if (e.target.classList.contains("modal-overlay")) {
                e.target.classList.remove("open");
            }
        });
    }

    // ==========================================================================
    // 10. REAL MONEY PORTAL FLOWS SETUP (UPI, Credit Cards, withdrawals)
    // ==========================================================================
    function setupRealMoneyFlows() {
        // Helper to draw procedural high-fidelity QR Mock on Canvas
        function drawProceduralQr(canvas, upiLink) {
            const ctx = canvas.getContext("2d");
            const size = canvas.width;
            ctx.fillStyle = "#ffffff";
            ctx.fillRect(0, 0, size, size);
            
            // Draw standard QR Finder Squares in 3 corners
            const drawFinder = (cx, cy, s) => {
                ctx.fillStyle = "#0c0d12";
                ctx.fillRect(cx, cy, s, s);
                ctx.fillStyle = "#ffffff";
                ctx.fillRect(cx + 4, cy + 4, s - 8, s - 8);
                ctx.fillStyle = "#0c0d12";
                ctx.fillRect(cx + 8, cy + 8, s - 16, s - 16);
            };

            drawFinder(10, 10, 32);
            drawFinder(size - 42, 10, 32);
            drawFinder(10, size - 42, 32);
            
            // Draw simulated high-density data modules
            ctx.fillStyle = "#0c0d12";
            for (let x = 8; x < size - 8; x += 4) {
                for (let y = 8; y < size - 8; y += 4) {
                    // Skip finder zones to preserve visual scan integrity
                    if ((x < 46 && y < 46) || (x > size - 46 && y < 46) || (x < 46 && y > size - 46)) continue;
                    if (Math.random() > 0.45) {
                        ctx.fillRect(x, y, 3, 3);
                    }
                }
            }
        }

        // Process Simulated Deposits & Redirect to dedicated checkout gateway
        document.getElementById("depositForm").addEventListener("submit", (e) => {
            e.preventDefault();
            const amt = parseFloat(document.getElementById("depositAmount").value) || 0;
            const upiId = document.getElementById("upiVal").value.trim();

            if (amt < 100 || amt > 150000) {
                showNotification("Deposit limits: Min. ₹100 - Max. ₹1,50,000", "error");
                return;
            }

            if (!upiId || !upiId.includes("@")) {
                showNotification("Please enter a valid UPI ID (e.g. pilot@okaxis) to complete deposit.", "warning");
                return;
            }

            // Redirect directly to the standalone checkout gateway page
            window.location.href = `gateway.html?amount=${amt}&upi=${encodeURIComponent(upiId)}`;
        });

        // Process Simulated Withdrawals
        document.getElementById("withdrawForm").addEventListener("submit", (e) => {
            e.preventDefault();
            syncUserBalanceFromStorage();
            const amt = parseFloat(document.getElementById("withdrawAmount").value) || 0;
            const target = document.getElementById("withdrawTarget").value.trim();

            if (amt < 100) {
                showNotification("Minimum withdrawal limit is ₹100.", "error");
                return;
            }

            if (!target || !target.includes("@")) {
                showNotification("Please enter a valid target UPI ID (e.g. name@paytm) to request withdrawal.", "warning");
                return;
            }

            if (state.user.balance < amt) {
                showNotification("Withdrawal request rejected: Insufficient wallet balance!", "error");
                return;
            }

            // Deduct balance
            state.user.balance -= amt;
            updateWalletDisplay();
            saveUserSession();

            addTransaction(`UPI Withdraw: ${target}`, "WITHDRAW", -amt, "PENDING");
            showNotification(`UPI Withdrawal request of ₹${amt.toLocaleString("en-IN", { minimumFractionDigits: 2 })} submitted successfully! Payout will be sent to ${target} after Admin approval.`, "success");

            // Clean inputs
            document.getElementById("withdrawAmount").value = "1000";
            document.getElementById("withdrawTarget").value = "";
        });

        // Process profile editing forms
        document.getElementById("profileEditForm").addEventListener("submit", (e) => {
            e.preventDefault();
            const nick = document.getElementById("editNickname").value.trim();
            if (!nick) return;

            state.user.nickname = nick;
            saveUserSession();
            updateProfileStatsUI();

            // Sync top bar avatar seed
            const currentSeed = document.querySelector(".avatar-option.selected").dataset.seed;
            document.getElementById("headerAvatar").src = `https://api.dicebear.com/7.x/bottts/svg?seed=${currentSeed}`;
            document.getElementById("profileAvatarBig").src = `https://api.dicebear.com/7.x/bottts/svg?seed=${currentSeed}`;

            showNotification("Profile settings saved successfully!", "success");
        });

        // Avatar Robot selection setup
        document.querySelectorAll(".avatar-option").forEach(opt => {
            opt.addEventListener("click", () => {
                document.querySelectorAll(".avatar-option").forEach(o => o.classList.remove("selected"));
                opt.classList.add("selected");
                
                const seed = opt.dataset.seed;
                document.getElementById("profileAvatarBig").src = `https://api.dicebear.com/7.x/bottts/svg?seed=${seed}`;
            });
        });
    }

    // ==========================================================================
    // 11. BOOTSTRAP INITIALIZER
    // ==========================================================================
    function init() {
        // Load configurations
        loadSession();

        // Start UI feeds
        updateWalletDisplay();
        updateProfileStatsUI();
        updateTransactionsUI();
        updateMultiplierRibbon();
        syncMyHistoryPanel();

        // Connect Handlers
        setupBettingHandlers();
        setupModals();
        setupRealMoneyFlows();

        // Spawn mock live chat lines to populate room
        appendChatMessage("SkyQueen_44", "damn held till 3.5x just now", false, "SkyQueen");
        appendChatMessage("CryptoKing_99", "lets go aviators! next one to 10x", false, "CryptoKing");
        appendChatMessage("Mod_Zeus", "Please gamble responsibly. Provably Fair verification is fully active.", false, "ZeusX");

        // Restore game loop state across refreshes!
        restoreGameState();

        // Secret gates to Admin Panel (Double-clicking the Aviator logo, or Ctrl+Shift+A)
        const logoBtn = document.getElementById("headerLogoBtn");
        if (logoBtn) {
            logoBtn.addEventListener("dblclick", () => {
                window.location.href = "flight-control.html";
            });
        }
        document.addEventListener("keydown", (e) => {
            if (e.ctrlKey && e.shiftKey && e.code === "KeyA") {
                e.preventDefault();
                window.location.href = "flight-control.html";
            }
        });

        // HTML5 Storage Listener to sync balance, bans, and transactions live across active tabs
        window.addEventListener("storage", (e) => {
            if (e.key === "aviator_user" || e.key === "aviator_db_users") {
                loadSession();
                updateWalletDisplay();
                updateProfileStatsUI();
            }
            if (e.key === "aviator_txns") {
                loadSession();
                updateTransactionsUI();
            }
        });
    }

    // Start!
    document.addEventListener("DOMContentLoaded", init);

})();
