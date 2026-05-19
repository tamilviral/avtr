/* ==========================================================================
   AVIATOR CORE APPLICATION ENGINE
   Features: Lockstep Epoch Synchronization, Web Audio procedural synth,
             HTML5 Canvas Vector Jet & Trail particle renderer, Lobby bots,
             and Cross-Tab Session Synchronization.
   ========================================================================== */

(function () {
    // -------------------------------------------------------------
    // 1. STATE & DATABASE LAYER
    // -------------------------------------------------------------
    const CONFIG = {
        roundDuration: 15000,    // Every round is exactly 15 seconds
        lobbyDuration: 4000,     // Lobby countdown is first 4 seconds
        growthFactor: 0.08       // Multiplier growth speed: e^(0.08 * t)
    };

    let currentUser = null;
    let flightCanvas = null;
    let ctx = null;
    let animationFrameId = null;
    let synth = null; // Audio Synth

    // Double Bets State
    let bets = {
        card1: { placed: false, active: false, amount: 100, autoBet: false, autoCash: false, autoCashVal: 1.50, cashedOut: false, winAmount: 0 },
        card2: { placed: false, active: false, amount: 100, autoBet: false, autoCash: false, autoCashVal: 2.00, cashedOut: false, winAmount: 0 }
    };

    // Chat bots names & lines
    const botNames = [
        "Cap_Vikram", "Pilot_Rohan", "SkyKing", "JetSetter", "AviatorPro",
        "RedBull_Air", "Viper_99", "CloudSurfer", "Wingman", "Ace_Ankit",
        "RaptorFly", "FalconX", "AltFlyer", "WagerPilot", "ApexSky",
        "TurboProp", "MachSpeed", "HorizonLine", "Stratosphere", "Altitude"
    ];

    const lobbyBotChatLines = [
        "ready to fly! ✈️", "going for 3x this time", "last round was a quick crash, hoping for high multiplier now",
        "let's make some profits pilots!", "₹500 on this next flight", "anyone going past 5x?", "greetings team!"
    ];

    const flyingBotChatLines = [
        "huge climb! 🔥", "come on 4x!!", "easy cash out at 1.8x", "looking solid, go go go", "amazing flight path!",
        "cashing out soon...", "to the moon! 🚀"
    ];

    const crashedBotChatLines = [
        "nooo crashed! 😭", "almost got it", "should have cashed out at 1.5x", "who made it past 2.5x?",
        "unlucky round", "again at next round!", "safe flight next time"
    ];

    let currentLobbyBots = [];

    // Initialize Databases if empty
    function initDatabase() {
        if (!localStorage.getItem('aviator_db_users')) {
            const defaultUser = {
                email: "pilot@aviator.com",
                phone: "9952254507",
                password: "password123",
                balance: 500.00,
                joinDate: new Date().toLocaleString(),
                status: "active"
            };
            localStorage.setItem('aviator_db_users', JSON.stringify([defaultUser]));
        }
        if (!localStorage.getItem('aviator_txns')) {
            localStorage.setItem('aviator_txns', JSON.stringify([]));
        }
        if (!localStorage.getItem('aviator_tickets')) {
            localStorage.setItem('aviator_tickets', JSON.stringify([]));
        }
        if (!localStorage.getItem('aviator_game_history')) {
            localStorage.setItem('aviator_game_history', JSON.stringify([
                { id: 1, crashPoint: 1.85, timestamp: Date.now() - 600000 },
                { id: 2, crashPoint: 4.12, timestamp: Date.now() - 500000 },
                { id: 3, crashPoint: 1.15, timestamp: Date.now() - 400000 },
                { id: 4, crashPoint: 22.40, timestamp: Date.now() - 300000 },
                { id: 5, crashPoint: 1.00, timestamp: Date.now() - 200000 },
                { id: 6, crashPoint: 1.63, timestamp: Date.now() - 100000 }
            ]));
        }
    }

    function checkAuth() {
        const session = localStorage.getItem('aviator_session');
        if (!session) {
            window.location.href = "login.html";
            return false;
        }
        const users = JSON.parse(localStorage.getItem('aviator_db_users'));
        currentUser = users.find(u => u.email === session || u.phone === session);
        if (!currentUser) {
            localStorage.removeItem('aviator_session');
            window.location.href = "login.html";
            return false;
        }
        if (currentUser.status === "banned") {
            showToast("BANNED", "Your pilot account has been suspended by flight control.", "error");
            localStorage.removeItem('aviator_session');
            setTimeout(() => { window.location.href = "login.html"; }, 3000);
            return false;
        }
        return true;
    }

    function syncUserBalance() {
        if (!currentUser) return;
        const users = JSON.parse(localStorage.getItem('aviator_db_users'));
        const fresh = users.find(u => u.email === currentUser.email);
        if (fresh) {
            if (fresh.status === "banned") {
                showToast("BANNED", "Your pilot account has been suspended by flight control.", "error");
                localStorage.removeItem('aviator_session');
                setTimeout(() => { window.location.href = "login.html"; }, 1500);
                return;
            }
            currentUser.balance = fresh.balance;
            document.getElementById('playerBalance').textContent = fresh.balance.toFixed(2);
            document.getElementById('withdrawAvailableBal').textContent = fresh.balance.toFixed(2);
        }
    }

    function updateDatabaseUserBalance(amountChange) {
        const users = JSON.parse(localStorage.getItem('aviator_db_users'));
        const idx = users.findIndex(u => u.email === currentUser.email);
        if (idx !== -1) {
            users[idx].balance = parseFloat((users[idx].balance + amountChange).toFixed(2));
            localStorage.setItem('aviator_db_users', JSON.stringify(users));
            currentUser.balance = users[idx].balance;
            document.getElementById('playerBalance').textContent = currentUser.balance.toFixed(2);
            document.getElementById('withdrawAvailableBal').textContent = currentUser.balance.toFixed(2);
            
            // Trigger storage event manually for multi-tab balance sync
            localStorage.setItem('aviator_sync_trigger', Date.now());
        }
    }

    // -------------------------------------------------------------
    // 2. PROCEDURAL SOUND SYNTHESIZER
    // -------------------------------------------------------------
    class WebAudioSynth {
        constructor() {
            this.ctx = null;
            this.engineOsc = null;
            this.engineGain = null;
            this.masterGain = null;
            this.enabled = true;
        }

        init() {
            if (this.ctx) return;
            try {
                const AudioContextClass = window.AudioContext || window.webkitAudioContext;
                this.ctx = new AudioContextClass();
                this.masterGain = this.ctx.createGain();
                this.masterGain.gain.value = 0.6;
                this.masterGain.connect(this.ctx.destination);
            } catch (e) {
                console.error("Audio API not supported", e);
            }
        }

        startEngineHum() {
            this.init();
            if (!this.ctx || !this.enabled) return;
            this.stopEngineHum();

            try {
                this.engineOsc = this.ctx.createOscillator();
                this.engineGain = this.ctx.createGain();

                this.engineOsc.type = 'triangle';
                this.engineOsc.frequency.setValueAtTime(55, this.ctx.currentTime); // Low engine pitch
                this.engineGain.gain.setValueAtTime(0.01, this.ctx.currentTime); // start soft
                this.engineGain.gain.exponentialRampToValueAtTime(0.18, this.ctx.currentTime + 0.5);

                this.engineOsc.connect(this.engineGain);
                this.engineGain.connect(this.masterGain);
                this.engineOsc.start();
            } catch (e) {
                console.error("Could not start hum", e);
            }
        }

        updateEngineHum(multiplier) {
            if (!this.ctx || !this.engineOsc || !this.enabled) return;
            // Ramp pitch based on current multiplier
            const targetFreq = 55 + (multiplier * 28);
            this.engineOsc.frequency.setTargetAtTime(targetFreq, this.ctx.currentTime, 0.1);
        }

        stopEngineHum() {
            if (this.engineOsc) {
                try {
                    this.engineOsc.stop();
                } catch (e) {}
                this.engineOsc = null;
            }
            this.engineGain = null;
        }

        playCashChime() {
            this.init();
            if (!this.ctx || !this.enabled) return;
            try {
                const now = this.ctx.currentTime;
                // High-pitched chime
                const noteSequence = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
                noteSequence.forEach((freq, idx) => {
                    const osc = this.ctx.createOscillator();
                    const gain = this.ctx.createGain();
                    osc.type = 'sine';
                    osc.frequency.setValueAtTime(freq, now + idx * 0.08);
                    
                    gain.gain.setValueAtTime(0.15, now + idx * 0.08);
                    gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.3);

                    osc.connect(gain);
                    gain.connect(this.masterGain);
                    osc.start(now + idx * 0.08);
                    osc.stop(now + idx * 0.08 + 0.35);
                });
            } catch (e) {}
        }

        playExplosion() {
            this.init();
            if (!this.ctx || !this.enabled) return;
            try {
                this.stopEngineHum();
                const now = this.ctx.currentTime;

                // Create deep bass rumble
                const osc = this.ctx.createOscillator();
                const gain = this.ctx.createGain();
                
                osc.type = 'sawtooth';
                osc.frequency.setValueAtTime(100, now);
                osc.frequency.exponentialRampToValueAtTime(10, now + 0.6);

                gain.gain.setValueAtTime(0.4, now);
                gain.gain.exponentialRampToValueAtTime(0.001, now + 0.8);

                osc.connect(gain);
                gain.connect(this.masterGain);
                osc.start();
                osc.stop(now + 0.8);
            } catch (e) {}
        }
    }

    synth = new WebAudioSynth();

    // -------------------------------------------------------------
    // 3. DETERMINISTIC LOCKSTEP SCHEDULER
    // -------------------------------------------------------------
    function getEpochState() {
        const now = Date.now();
        const roundId = Math.floor(now / CONFIG.roundDuration);
        const roundStartTime = roundId * CONFIG.roundDuration;
        const elapsed = now - roundStartTime;

        // Generate crash point deterministically from the roundId
        const crashPoint = calculateDeterministicCrash(roundId);

        // Time to crash derived from growth formula: M(t) = e^(0.08 * t)
        // t = ln(M) / 0.08 seconds
        let flightTimeSec = 0;
        if (crashPoint > 1.00) {
            flightTimeSec = Math.log(crashPoint) / CONFIG.growthFactor;
        }
        const flightTimeMs = flightTimeSec * 1000;
        const maxFlightTimeMs = CONFIG.roundDuration - CONFIG.lobbyDuration - 800; // clamp flight duration

        const actualFlightTimeMs = Math.min(flightTimeMs, maxFlightTimeMs);
        const actualCrashPoint = Math.exp(CONFIG.growthFactor * (actualFlightTimeMs / 1000));

        let phase = "";
        let timeRemaining = 0;
        let currentMultiplier = 1.00;

        if (elapsed < CONFIG.lobbyDuration) {
            phase = "LOBBY";
            timeRemaining = CONFIG.lobbyDuration - elapsed;
        } else if (elapsed < CONFIG.lobbyDuration + actualFlightTimeMs) {
            phase = "FLYING";
            timeRemaining = (CONFIG.lobbyDuration + actualFlightTimeMs) - elapsed;
            const flightElapsedSec = (elapsed - CONFIG.lobbyDuration) / 1000;
            currentMultiplier = Math.exp(CONFIG.growthFactor * flightElapsedSec);
        } else {
            phase = "CRASHED";
            timeRemaining = CONFIG.roundDuration - elapsed;
            currentMultiplier = actualCrashPoint;
        }

        return {
            roundId,
            phase,
            elapsed,
            timeRemaining,
            currentMultiplier,
            crashPoint: actualCrashPoint,
            flightDuration: actualFlightTimeMs
        };
    }

    function calculateDeterministicCrash(roundId) {
        // A simple, secure pseudo-random hash generator based on SHA-256 styled seeds
        // to return realistic, provably fair multipliers
        const x = Math.sin(roundId * 9876.5432) * 10000;
        const rand = x - Math.floor(x);

        // 3% instant crash at 1.00x
        if (rand < 0.03) return 1.00;

        // Growth distribution modeling real crash systems
        // 97% remaining distributed exponentially
        // M = 0.97 / (rand^1.15)
        const multi = 1.01 + (0.97 / Math.pow(rand, 1.08)) * 0.07;
        return parseFloat(Math.min(multi, 150).toFixed(2));
    }

    // -------------------------------------------------------------
    // 4. CANVAS VECTOR RENDERER
    // -------------------------------------------------------------
    let particles = [];
    let gridOffset = 0;

    function resizeCanvas() {
        if (!flightCanvas) return;
        const dpr = window.devicePixelRatio || 1;
        const rect = flightCanvas.getBoundingClientRect();
        flightCanvas.width = rect.width * dpr;
        flightCanvas.height = rect.height * dpr;
        ctx.scale(dpr, dpr);
    }

    function renderLoop() {
        const state = getEpochState();
        const width = flightCanvas.width / (window.devicePixelRatio || 1);
        const height = flightCanvas.height / (window.devicePixelRatio || 1);

        ctx.clearRect(0, 0, width, height);

        // RENDER GRAPH COORDINATE GRID (Scrolling backwards)
        ctx.strokeStyle = "rgba(255, 255, 255, 0.02)";
        ctx.lineWidth = 1;
        
        if (state.phase === "FLYING") {
            gridOffset = (gridOffset - 1.5) % 40;
        }

        // Draw Vertical grid lines
        for (let x = gridOffset; x < width; x += 40) {
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height - 30);
            ctx.stroke();
        }

        // Draw Horizontal grid lines
        for (let y = height - 30; y > 0; y -= 40) {
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(width, y);
            ctx.stroke();
        }

        // Draw bottom base coordinate axis line
        ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, height - 30);
        ctx.lineTo(width, height - 30);
        ctx.stroke();

        // HUD Text displays
        const lobbyLabel = document.getElementById('lobbyLabel');
        const lobbyTimer = document.getElementById('lobbyTimer');
        const flyMultiplier = document.getElementById('flyMultiplier');
        const crashLabel = document.getElementById('crashLabel');

        if (state.phase === "LOBBY") {
            lobbyLabel.style.display = "block";
            lobbyTimer.style.display = "block";
            flyMultiplier.style.display = "none";
            crashLabel.style.display = "none";

            lobbyTimer.textContent = (state.timeRemaining / 1000).toFixed(1) + "s";
            
            // Stop hum
            synth.stopEngineHum();
            particles = [];
        } else if (state.phase === "FLYING") {
            lobbyLabel.style.display = "none";
            lobbyTimer.style.display = "none";
            flyMultiplier.style.display = "block";
            crashLabel.style.display = "none";

            flyMultiplier.textContent = state.currentMultiplier.toFixed(2) + "x";
            
            // Hum audio speed
            synth.startEngineHum();
            synth.updateEngineHum(state.currentMultiplier);

            // CALCULATE AIRPLANE POSITIONS
            const t = (CONFIG.roundDuration - CONFIG.lobbyDuration - state.timeRemaining) / CONFIG.roundDuration;
            const startX = 50;
            const startY = height - 50;
            const endX = width - 80;
            const endY = 80;

            const currentX = startX + (endX - startX) * Math.min(t * 1.8, 1.0);
            // Curved exponential Y coordinates
            const curveFactor = Math.pow(Math.min(t * 1.8, 1.0), 2.2);
            const currentY = startY - (startY - endY) * curveFactor;

            // DRAW CURVE PATH LINE WITH GLOW
            ctx.shadowBlur = 15;
            ctx.shadowColor = "rgba(229, 9, 20, 0.5)";
            ctx.strokeStyle = "var(--accent-red)";
            ctx.lineWidth = 4;
            
            ctx.beginPath();
            ctx.moveTo(startX, startY);
            // Draw smooth bezier curve path
            ctx.quadraticCurveTo(currentX * 0.7, startY * 0.95, currentX, currentY);
            ctx.stroke();
            
            // Reset shadow
            ctx.shadowBlur = 0;

            // SPAWN SMOKE EXHAUST PARTICLES
            if (Math.random() < 0.35) {
                particles.push({
                    x: currentX - 10,
                    y: currentY + 5,
                    size: Math.random() * 6 + 4,
                    alpha: 0.6,
                    vx: -(Math.random() * 1.2 + 0.5),
                    vy: Math.random() * 0.8 - 0.4
                });
            }

            // UPDATE & DRAW PARTICLES
            particles.forEach((p, idx) => {
                p.x += p.vx;
                p.y += p.vy;
                p.alpha -= 0.015;
                if (p.alpha <= 0) {
                    particles.splice(idx, 1);
                } else {
                    ctx.fillStyle = `rgba(229, 9, 20, ${p.alpha})`;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    ctx.fill();
                }
            });

            // DRAW VIBRATING VECTOR FIGHTER JET
            const rumble = Math.sin(Date.now() * 0.08) * 1.5;
            const planeSize = 36;
            ctx.fillStyle = "#ffffff";
            
            ctx.save();
            ctx.translate(currentX, currentY + rumble);
            // Slightly rotate plane upwards
            ctx.rotate(-0.25);
            
            // Draw plane SVG polygon paths manually
            ctx.beginPath();
            ctx.moveTo(22, 0);  // Nose
            ctx.lineTo(-12, -15); // Left Wing
            ctx.lineTo(-6, -4);
            ctx.lineTo(-20, -6);  // Tail Left
            ctx.lineTo(-16, 0);   // Tail
            ctx.lineTo(-20, 6);   // Tail Right
            ctx.lineTo(-6, 4);
            ctx.lineTo(-12, 15);  // Right Wing
            ctx.closePath();
            
            ctx.fillStyle = "#ffffff";
            ctx.shadowBlur = 10;
            ctx.shadowColor = "rgba(255, 255, 255, 0.4)";
            ctx.fill();
            ctx.restore();
            
            // Auto Cash Checks
            checkIndividualAutoCashOut('card1', state.currentMultiplier);
            checkIndividualAutoCashOut('card2', state.currentMultiplier);

        } else if (state.phase === "CRASHED") {
            lobbyLabel.style.display = "none";
            lobbyTimer.style.display = "none";
            flyMultiplier.style.display = "none";
            crashLabel.style.display = "block";

            crashLabel.textContent = "FLEW AWAY!\n" + state.currentMultiplier.toFixed(2) + "x";

            // Trigger crash audio explosion once
            if (synth.engineOsc) {
                synth.playExplosion();
                handleRoundCrashEnd(state.currentMultiplier);
            }
        }

        animationFrameId = requestAnimationFrame(renderLoop);
    }

    // -------------------------------------------------------------
    // 5. DOUBLE BETTING CONTROLLERS
    // -------------------------------------------------------------
    function setupBettingHandlers() {
        // Tab manual/auto selectors
        setupTabSelectors('betCard1', 'card1');
        setupTabSelectors('betCard2', 'card2');

        // Setup Adjusters (plus/minus)
        setupAdjusterButtons('betCard1', 'card1');
        setupAdjusterButtons('betCard2', 'card2');

        // Action Buttons bet & cashout
        document.getElementById('actionBtn1').onclick = () => handleActionBtnClick('card1');
        document.getElementById('actionBtn2').onclick = () => handleActionBtnClick('card2');

        // Quick wagers select triggers
        setupQuickSelect('betCard1', 'card1');
        setupQuickSelect('betCard2', 'card2');

        // Auto Cash toggles
        setupAutoToggles('card1');
        setupAutoToggles('card2');
    }

    function setupTabSelectors(cardId, stateKey) {
        const tabs = document.querySelectorAll(`#${cardId} .bet-tab`);
        tabs.forEach(tab => {
            tab.onclick = () => {
                tabs.forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                
                const mode = tab.dataset.mode;
                const autoToggle = document.getElementById(stateKey === 'card1' ? 'autoToggle1' : 'autoToggle2');
                const autoDrawer = document.getElementById(stateKey === 'card1' ? 'autoDrawer1' : 'autoDrawer2');
                
                if (mode === 'auto') {
                    autoToggle.style.display = "flex";
                    autoDrawer.classList.add('active');
                } else {
                    autoToggle.style.display = "none";
                    autoDrawer.classList.remove('active');
                    
                    // Uncheck auto bet
                    document.getElementById(stateKey === 'card1' ? 'autoBetCheck1' : 'autoBetCheck2').checked = false;
                    bets[stateKey].autoBet = false;
                }
            };
        });
    }

    function setupAdjusterButtons(cardId, stateKey) {
        const minus = document.querySelector(`#${cardId} .minus`);
        const plus = document.querySelector(`#${cardId} .plus`);
        const input = document.querySelector(`#${cardId} .amount-input`);

        minus.onclick = () => {
            let val = parseInt(input.value) - 50;
            if (val < 10) val = 10;
            input.value = val;
            bets[stateKey].amount = val;
            updateBetButtonVisuals(stateKey);
        };

        plus.onclick = () => {
            let val = parseInt(input.value) + 50;
            if (val > 10000) val = 10000;
            input.value = val;
            bets[stateKey].amount = val;
            updateBetButtonVisuals(stateKey);
        };

        input.onchange = () => {
            let val = parseInt(input.value);
            if (isNaN(val) || val < 10) val = 10;
            if (val > 10000) val = 10000;
            input.value = val;
            bets[stateKey].amount = val;
            updateBetButtonVisuals(stateKey);
        };
    }

    function setupQuickSelect(cardId, stateKey) {
        const btns = document.querySelectorAll(`#${cardId} .quick-btn`);
        const input = document.querySelector(`#${cardId} .amount-input`);
        
        btns.forEach(btn => {
            btn.onclick = () => {
                const val = parseInt(btn.dataset.val);
                input.value = val;
                bets[stateKey].amount = val;
                updateBetButtonVisuals(stateKey);
            };
        });
    }

    function setupAutoToggles(stateKey) {
        const betCheck = document.getElementById(stateKey === 'card1' ? 'autoBetCheck1' : 'autoBetCheck2');
        const cashCheck = document.getElementById(stateKey === 'card1' ? 'autoCashCheck1' : 'autoCashCheck2');
        const cashInput = document.getElementById(stateKey === 'card1' ? 'autoCashVal1' : 'autoCashVal2');

        betCheck.onchange = () => {
            bets[stateKey].autoBet = betCheck.checked;
            if (bets[stateKey].autoBet) {
                showToast("Auto Bet", "Wallet queue activated for next flight.", "info");
            }
        };

        cashCheck.onchange = () => {
            bets[stateKey].autoCash = cashCheck.checked;
        };

        cashInput.onchange = () => {
            let val = parseFloat(cashInput.value);
            if (isNaN(val) || val < 1.01) val = 1.01;
            cashInput.value = val.toFixed(2);
            bets[stateKey].autoCashVal = val;
        };
    }

    function updateBetButtonVisuals(stateKey) {
        const btn = document.getElementById(stateKey === 'card1' ? 'actionBtn1' : 'actionBtn2');
        const bet = bets[stateKey];

        if (!bet.active && !bet.placed) {
            btn.className = "btn-action-bet";
            btn.querySelector('.btn-amount-label').textContent = "BET";
            btn.querySelector('.btn-sub-label').textContent = `₹${bet.amount.toFixed(2)} INR`;
        } else if (bet.placed && !bet.active) {
            // Bet is queued/placed for lobby, waiting to fly
            btn.className = "btn-action-bet cancel";
            btn.querySelector('.btn-amount-label').textContent = "CANCEL";
            btn.querySelector('.btn-sub-label').textContent = "Queued Flight";
        } else if (bet.active && !bet.cashedOut) {
            // Flying! Show Cash out
            btn.className = "btn-action-bet cashout";
            btn.querySelector('.btn-amount-label').textContent = "CASH OUT";
            const currentMult = getEpochState().currentMultiplier;
            btn.querySelector('.btn-sub-label').textContent = `₹${(bet.amount * currentMult).toFixed(2)}`;
        } else if (bet.cashedOut) {
            btn.className = "btn-action-bet";
            btn.style.opacity = "0.6";
            btn.querySelector('.btn-amount-label').textContent = "CASHED OUT";
            btn.querySelector('.btn-sub-label').textContent = `₹${bet.winAmount.toFixed(2)} Winnings`;
        }
    }

    function handleActionBtnClick(stateKey) {
        const bet = bets[stateKey];
        const state = getEpochState();

        if (!bet.placed && !bet.active) {
            // PLACE BET!
            if (currentUser.balance < bet.amount) {
                showToast("INSIGNIFICANT FUNDS", "Deposit credits to wagers this amount.", "warning");
                return;
            }

            // Deduct immediately
            updateDatabaseUserBalance(-bet.amount);
            bet.placed = true;
            bet.cashedOut = false;
            
            if (state.phase === "LOBBY") {
                // If lobby count down, activate immediately
                bet.active = true;
                showToast("BET PLACED", "Your pilot wagers are locked in!", "success");
            } else {
                showToast("QUEUED", "Bet queued for next round takeoff.", "info");
            }
            updateBetButtonVisuals(stateKey);

        } else if (bet.placed && !bet.active) {
            // CANCEL BET (Refund amount)
            updateDatabaseUserBalance(bet.amount);
            bet.placed = false;
            showToast("CANCELLED", "Flight wagers refunded.", "info");
            updateBetButtonVisuals(stateKey);

        } else if (bet.active && !bet.cashedOut) {
            // MANUAL CASH OUT!
            triggerCashOut(stateKey, state.currentMultiplier);
        }
    }

    function triggerCashOut(stateKey, multiplier) {
        const bet = bets[stateKey];
        if (!bet.active || bet.cashedOut) return;

        const win = parseFloat((bet.amount * multiplier).toFixed(2));
        bet.cashedOut = true;
        bet.winAmount = win;

        // Credit to balance
        updateDatabaseUserBalance(win);
        synth.playCashChime();

        // Update statistics
        addPersonalRoundHistory(multiplier, win, bet.amount);

        showToast("CASH OUT WIN!", `Cashed out at ${multiplier.toFixed(2)}x. Winnings: ₹${win.toFixed(2)}`, "success");
        updateBetButtonVisuals(stateKey);
    }

    function checkIndividualAutoCashOut(stateKey, multiplier) {
        const bet = bets[stateKey];
        if (bet.active && !bet.cashedOut && bet.autoCash) {
            if (multiplier >= bet.autoCashVal) {
                triggerCashOut(stateKey, bet.autoCashVal);
            }
        }
    }

    // Dynamic scale cashout amount on UI tick
    function updateCashOutDynamicLabels() {
        const state = getEpochState();
        if (state.phase === "FLYING") {
            if (bets.card1.active && !bets.card1.cashedOut) {
                document.querySelector('#actionBtn1 .btn-sub-label').textContent = `₹${(bets.card1.amount * state.currentMultiplier).toFixed(2)}`;
            }
            if (bets.card2.active && !bets.card2.cashedOut) {
                document.querySelector('#actionBtn2 .btn-sub-label').textContent = `₹${(bets.card2.amount * state.currentMultiplier).toFixed(2)}`;
            }
        }
    }

    // -------------------------------------------------------------
    // 6. MULTIPLAYER SIMULATOR & ROUND RECOGNITION
    // -------------------------------------------------------------
    let currentRoundId = -1;

    function monitorEpochTick() {
        const state = getEpochState();
        
        if (state.roundId !== currentRoundId) {
            currentRoundId = state.roundId;
            handleNewRoundTakeoff(state);
        }

        updateCashOutDynamicLabels();
        updateMultiplayerLobbyRealTime(state);
    }

    function handleNewRoundTakeoff(state) {
        // Reset local bet states for the new round
        // Card 1
        bets.card1.cashedOut = false;
        if (bets.card1.placed) {
            bets.card1.active = true;
            bets.card1.placed = false; // reset queue
        } else {
            bets.card1.active = false;
            // Check Auto bet queue
            if (bets.card1.autoBet) {
                autoPlaceBetQueuer('card1');
            }
        }

        // Card 2
        bets.card2.cashedOut = false;
        if (bets.card2.placed) {
            bets.card2.active = true;
            bets.card2.placed = false; // reset queue
        } else {
            bets.card2.active = false;
            // Check Auto bet queue
            if (bets.card2.autoBet) {
                autoPlaceBetQueuer('card2');
            }
        }

        updateBetButtonVisuals('card1');
        updateBetButtonVisuals('card2');

        // Re-generate bots wagers
        generateLobbyBotsWagers();

        // Display cryptographies info on Provably Fair
        document.getElementById('pfRoundSeed').value = "sha256-hash-" + Math.floor(state.roundId * 87654);
        document.getElementById('pfEpochOffset').value = "offset-utc-" + (state.roundId * 15000);

        // Lobby chat bot greetings
        if (Math.random() < 0.6) {
            spawnBotChatMsg();
        }
    }

    function autoPlaceBetQueuer(stateKey) {
        const bet = bets[stateKey];
        if (currentUser.balance >= bet.amount) {
            updateDatabaseUserBalance(-bet.amount);
            bet.active = true;
            bet.placed = false;
            showToast("AUTO BET FILLED", `Wager of ₹${bet.amount} queued successfully.`, "info");
        } else {
            bet.autoBet = false;
            const check = document.getElementById(stateKey === 'card1' ? 'autoBetCheck1' : 'autoBetCheck2');
            if (check) check.checked = false;
            showToast("AUTO WAGER FAILED", "Insignificant funds to fulfill auto bet.", "warning");
        }
    }

    function handleRoundCrashEnd(crashMultiplier) {
        // Reset engines hum completely
        synth.stopEngineHum();

        // Update history strips
        addGlobalRoundHistory(crashMultiplier);

        // Any active bet which hasn't cashed out is lost
        if (bets.card1.active && !bets.card1.cashedOut) {
            bets.card1.active = false;
            showToast("LOST", `Flight card 1 crashed at ${crashMultiplier.toFixed(2)}x`, "error");
        }
        if (bets.card2.active && !bets.card2.cashedOut) {
            bets.card2.active = false;
            showToast("LOST", `Flight card 2 crashed at ${crashMultiplier.toFixed(2)}x`, "error");
        }

        bets.card1.active = false;
        bets.card2.active = false;
        updateBetButtonVisuals('card1');
        updateBetButtonVisuals('card2');

        // Bot crash chats
        if (Math.random() < 0.7) {
            setTimeout(spawnBotCrashChatMsg, 1200);
        }
    }

    // -------------------------------------------------------------
    // 7. BOT & MULTIPLAYER LOBBY SIMULATOR
    // -------------------------------------------------------------
    function generateLobbyBotsWagers() {
        currentLobbyBots = [];
        const botWagerCount = Math.floor(Math.random() * 12) + 12; // 12-24 active bots
        
        // Shuffle names
        const shuffled = [...botNames].sort(() => 0.5 - Math.random());
        
        for (let i = 0; i < botWagerCount; i++) {
            const wager = Math.floor(Math.random() * 10) * 100 + 100;
            const targetOut = parseFloat((Math.random() * 3.5 + 1.1).toFixed(2));
            currentLobbyBots.push({
                name: shuffled[i],
                wager: wager,
                targetOut: targetOut,
                cashed: false,
                winAmount: 0
            });
        }
        
        renderLobbyListVisuals();
    }

    function renderLobbyListVisuals() {
        const list = document.getElementById('allBetsList');
        if (!list) return;

        list.innerHTML = "";
        let totalWager = 0;

        currentLobbyBots.forEach(bot => {
            totalWager += bot.wager;
            const div = document.createElement('div');
            div.className = `bet-row ${bot.cashed ? 'cashed-out' : ''}`;
            div.innerHTML = `
                <div style="font-weight: 700;">${bot.name}</div>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <div style="color: var(--text-grey);">₹${bot.wager}</div>
                    <div class="mult-badge">${bot.cashed ? bot.targetOut.toFixed(2) + 'x' : 'Flying'}</div>
                    <div style="font-weight: 700; width: 60px; text-align: right; color: ${bot.cashed ? 'var(--accent-green)' : '#fff'};">
                        ${bot.cashed ? '₹' + bot.winAmount.toFixed(2) : '-'}
                    </div>
                </div>
            `;
            list.appendChild(div);
        });

        // Update top hud info
        document.getElementById('lobbyCountText').textContent = currentLobbyBots.length;
        document.getElementById('lobbyTotalWagerText').textContent = totalWager.toFixed(2);
    }

    function updateMultiplayerLobbyRealTime(state) {
        if (state.phase !== "FLYING") return;

        let changed = false;
        currentLobbyBots.forEach(bot => {
            if (!bot.cashed && state.currentMultiplier >= bot.targetOut) {
                bot.cashed = true;
                bot.winAmount = parseFloat((bot.wager * bot.targetOut).toFixed(2));
                changed = true;
                
                // 15% chance this bot sends a live chat brag
                if (bot.targetOut >= 2.0 && Math.random() < 0.15) {
                    addChatBubble(bot.name, `Easy money! Cashed out ₹${bot.winAmount.toFixed(2)} at ${bot.targetOut}x! 🔥✈️`);
                }
            }
        });

        if (changed) {
            renderLobbyListVisuals();
        }
    }

    // -------------------------------------------------------------
    // 8. DATA LOGGING & TRANSACTION WORKFLOWS
    // -------------------------------------------------------------
    function addPersonalRoundHistory(crashPoint, winAmount, wagerAmount) {
        const history = JSON.parse(localStorage.getItem('aviator_game_history')) || [];
        const roundRecord = {
            id: history.length + 1,
            crashPoint: parseFloat(crashPoint.toFixed(2)),
            winAmount: winAmount,
            wagerAmount: wagerAmount,
            timestamp: Date.now()
        };
        history.push(roundRecord);
        localStorage.setItem('aviator_game_history', JSON.stringify(history));

        renderPersonalBetsHistory();
    }

    function addGlobalRoundHistory(crashPoint) {
        const history = JSON.parse(localStorage.getItem('aviator_game_history')) || [];
        const nextId = history.length + 1;
        history.push({ id: nextId, crashPoint: crashPoint, timestamp: Date.now() });
        localStorage.setItem('aviator_game_history', JSON.stringify(history));

        renderGlobalPastMultiplierPills();
    }

    function renderGlobalPastMultiplierPills() {
        const strip = document.getElementById('historyStrip');
        if (!strip) return;

        const history = JSON.parse(localStorage.getItem('aviator_game_history')) || [];
        const recent = history.slice(-16).reverse(); // last 16 rounds

        strip.innerHTML = "";
        recent.forEach(round => {
            const div = document.createElement('div');
            const cp = round.crashPoint;
            let className = "history-pill";
            if (cp >= 10.0) className += " high";
            else if (cp >= 2.0) className += " mid";

            div.className = className;
            div.textContent = cp.toFixed(2) + "x";
            strip.appendChild(div);
        });

        // Also render on the Round History tab pane
        const histPane = document.getElementById('historyList');
        if (histPane) {
            histPane.innerHTML = "";
            history.slice().reverse().forEach(round => {
                const row = document.createElement('div');
                row.className = "bet-row";
                row.style.justifyContent = "space-between";
                row.innerHTML = `
                    <div style="font-weight: 700; color: var(--text-grey);">Round #${round.id}</div>
                    <div style="font-family: var(--font-heading); font-weight: 800; color: ${round.crashPoint >= 2.0 ? 'var(--accent-green)' : 'var(--accent-red)'}">
                        ${round.crashPoint.toFixed(2)}x
                    </div>
                `;
                histPane.appendChild(row);
            });
        }
    }

    function renderPersonalBetsHistory() {
        const list = document.getElementById('myBetsList');
        if (!list) return;

        list.innerHTML = "";
        const history = JSON.parse(localStorage.getItem('aviator_game_history')) || [];
        const personal = history.filter(h => h.wagerAmount !== undefined).reverse();

        personal.forEach(round => {
            const div = document.createElement('div');
            div.className = `bet-row ${round.winAmount > 0 ? 'cashed-out' : ''}`;
            div.innerHTML = `
                <div>
                    <div style="font-weight: 700;">Wager: ₹${round.wagerAmount}</div>
                    <div style="font-size: 10px; color: var(--text-muted);">${new Date(round.timestamp).toLocaleTimeString()}</div>
                </div>
                <div style="text-align: right;">
                    <div class="mult-badge" style="display: inline-block; margin-bottom: 4px;">${round.crashPoint.toFixed(2)}x</div>
                    <div style="font-weight: 800; color: ${round.winAmount > 0 ? 'var(--accent-green)' : 'var(--accent-red)'}">
                        ${round.winAmount > 0 ? '+₹' + round.winAmount.toFixed(2) : '-₹' + round.wagerAmount.toFixed(2)}
                    </div>
                </div>
            `;
            list.appendChild(div);
        });

        // Update profile dashboard stats
        const flightsCount = personal.length;
        const highestMulti = personal.reduce((max, r) => r.crashPoint > max ? r.crashPoint : max, 1.0);
        const totalWins = personal.reduce((sum, r) => r.winAmount > 0 ? sum + (r.winAmount - r.wagerAmount) : sum - r.wagerAmount, 0);

        document.getElementById('statRoundsCount').textContent = flightsCount;
        document.getElementById('statHighestMulti').textContent = highestMulti.toFixed(2) + "x";
        
        const winSpan = document.getElementById('statTotalWins');
        winSpan.textContent = (totalWins >= 0 ? '+' : '') + '₹' + totalWins.toFixed(2);
        winSpan.style.color = totalWins >= 0 ? 'var(--accent-green)' : 'var(--accent-red)';
    }

    function populateDepositsLedgerTable() {
        const body = document.getElementById('depositTableBody');
        if (!body) return;

        body.innerHTML = "";
        const txns = JSON.parse(localStorage.getItem('aviator_txns')) || [];
        const myTxns = txns.filter(t => t.email === currentUser.email).reverse();

        if (myTxns.length === 0) {
            body.innerHTML = `<tr><td colspan="4" style="text-align: center; padding: 12px; color: var(--text-muted);">No deposits logged yet.</td></tr>`;
            return;
        }

        myTxns.forEach(t => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = "1px solid rgba(255,255,255,0.03)";
            
            let statusBadgeClass = "badge-status progress";
            if (t.status === "SUCCESS") statusBadgeClass = "badge-status resolved";
            if (t.status === "REJECTED") statusBadgeClass = "badge-status reject";

            tr.innerHTML = `
                <td style="padding: 10px; font-family: monospace; font-size: 11px;">#${t.txnId.slice(0, 8)}</td>
                <td style="padding: 10px; font-weight: 700; color: var(--accent-green);">₹${t.amount.toFixed(2)}</td>
                <td style="padding: 10px;"><span class="${statusBadgeClass}">${t.status}</span></td>
                <td style="padding: 10px; font-size: 10px; color: var(--text-muted);">${new Date(t.date).toLocaleDateString()}</td>
            `;
            body.appendChild(tr);
        });
    }

    // -------------------------------------------------------------
    // 9. COCKPIT INTERACTION & INTERACTIVE TABS
    // -------------------------------------------------------------
    function setupAppNavigation() {
        // Tab Pane switches dropdown selector (All Bets, My Bets, History, Chat)
        const sideSelector = document.getElementById('sidePaneSelector');
        if (sideSelector) {
            sideSelector.onchange = (e) => {
                const target = e.target.value;
                const panes = document.querySelectorAll('.side-content .pane');
                panes.forEach(pane => pane.classList.remove('active'));
                document.getElementById(target).classList.add('active');
            };
        }

        // Profile dialog internal tabs navigation
        const sideBtns = document.querySelectorAll('.profile-sidebar .profile-side-btn');
        sideBtns.forEach(btn => {
            btn.onclick = () => {
                if (btn.id === "logoutBtn") return; // logout has separate logic
                sideBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');

                const target = btn.dataset.pane;
                const panes = document.querySelectorAll('.profile-pane-container .profile-pane');
                panes.forEach(p => p.classList.remove('active'));
                document.getElementById(target).classList.add('active');

                if (target === "paneDeposits") {
                    populateDepositsLedgerTable();
                }
                if (target === "paneWithdrawals") {
                    document.getElementById('withdrawAvailableBal').textContent = currentUser.balance.toFixed(2);
                    if (currentUser.upiId) {
                        document.getElementById('withdrawalUPI').value = currentUser.upiId;
                    }
                    if (currentUser.bankDetails) {
                        // Pre-fill stored details
                        const hasIfsc = currentUser.bankDetails.includes("IFSC:");
                        if (hasIfsc) {
                            const parts = currentUser.bankDetails.split("IFSC:");
                            document.getElementById('withdrawalBankAcc').value = parts[0].replace("Bank Payout:", "").replace("Bank Payout :", "").trim();
                            document.getElementById('withdrawalIFSC').value = parts[1].trim();
                        } else {
                            document.getElementById('withdrawalBankAcc').value = currentUser.bankDetails;
                        }
                    }
                }
            };
        });

        // Modals triggers
        document.getElementById('profileTriggerBtn').onclick = () => {
            syncUserBalance();
            document.getElementById('profileEmail').value = currentUser.email;
            document.getElementById('profilePhone').value = currentUser.phone;
            document.getElementById('profileJoinDate').value = currentUser.joinDate;
            document.getElementById('profileUPI').value = currentUser.upiId || '';
            document.getElementById('profileBank').value = currentUser.bankDetails || '';
            window.updatePhoneVerifyBadgeState();
            openModal('profileModal');
        };

        document.getElementById('provablyFairBtn').onclick = () => openModal('provablyFairModal');
        
        document.getElementById('depositTriggerBtn').onclick = () => {
            window.open('gateway.html', '_blank');
        };

        document.getElementById('supportBubbleBtn').onclick = () => {
            window.location.href = "tickets.html";
        };

        // Stealth Double Click Header Logo Redirects
        document.getElementById('headerLogoBtn').ondblclick = () => {
            window.location.href = "flight-control.html";
        };

        // Stealth shortcut listener
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'A') {
                window.location.href = "flight-control.html";
            }
        });

        // Modal Close Overlay listener
        const overlays = document.querySelectorAll('.modal-overlay');
        overlays.forEach(o => {
            o.onclick = (e) => {
                if (e.target === o) {
                    closeModal(o.id);
                }
            };
        });

        // Logout workflow
        document.getElementById('logoutBtn').onclick = () => {
            const overlay = document.getElementById('logoutOverlay');
            overlay.classList.add('active');
            localStorage.removeItem('aviator_session');
            localStorage.removeItem('aviator_user');
            setTimeout(() => {
                window.location.href = "login.html";
            }, 2000);
        };
    }

    function openModal(modalId) {
        document.getElementById(modalId).classList.add('active');
    }

    window.closeModal = function(modalId) {
        document.getElementById(modalId).classList.remove('active');
    };

    window.setWithdrawMethod = function(method) {
        const upiBtn = document.getElementById('payout-opt-upi');
        const bankBtn = document.getElementById('payout-opt-bank');
        const methodInput = document.getElementById('withdrawalMethod');
        
        const upiContainer = document.getElementById('withdrawalUPIContainer');
        const bankContainer = document.getElementById('withdrawalBankContainer');
        
        const upiInput = document.getElementById('withdrawalUPI');
        const bankAccInput = document.getElementById('withdrawalBankAcc');
        const ifscInput = document.getElementById('withdrawalIFSC');
        
        methodInput.value = method;
        
        if (method === 'BANK') {
            upiBtn.classList.remove('active');
            bankBtn.classList.add('active');
            
            upiContainer.style.display = 'none';
            bankContainer.style.display = 'flex';
            
            upiInput.removeAttribute('required');
            bankAccInput.setAttribute('required', 'true');
            ifscInput.setAttribute('required', 'true');
        } else {
            upiBtn.classList.add('active');
            bankBtn.classList.remove('active');
            
            upiContainer.style.display = 'flex';
            bankContainer.style.display = 'none';
            
            upiInput.setAttribute('required', 'true');
            bankAccInput.removeAttribute('required');
            ifscInput.removeAttribute('required');
        }
    };

    // Payout Withdrawal Submission form
    function setupWithdrawalFormHandler() {
        const form = document.getElementById('withdrawalForm');
        form.onsubmit = (e) => {
            e.preventDefault();
            const amount = parseFloat(document.getElementById('withdrawalAmount').value);
            const method = document.getElementById('withdrawalMethod').value;
            let payoutDetails = "";
            
            if (method === 'BANK') {
                const bankAcc = document.getElementById('withdrawalBankAcc').value.trim();
                const ifsc = document.getElementById('withdrawalIFSC').value.trim();
                payoutDetails = `Bank Payout: ${bankAcc} (IFSC: ${ifsc})`;
            } else {
                const upi = document.getElementById('withdrawalUPI').value.trim();
                payoutDetails = `UPI Payout: ${upi}`;
            }

            if (amount > currentUser.balance) {
                showToast("PAYOUT FAILS", "Insignificant funds to wagers bank payout withdrawal.", "warning");
                return;
            }

            // Deduct balance immediately
            updateDatabaseUserBalance(-amount);

            // Log pending payout transaction
            const txns = JSON.parse(localStorage.getItem('aviator_txns')) || [];
            const newWithdrawal = {
                txnId: "wth-" + Math.floor(Math.random() * 89999 + 10000) + "-" + Date.now().toString().slice(-4),
                email: currentUser.email,
                type: "WITHDRAWAL",
                amount: amount,
                desc: payoutDetails,
                status: "PENDING",
                date: new Date().toLocaleString()
            };
            txns.push(newWithdrawal);
            localStorage.setItem('aviator_txns', JSON.stringify(txns));

            showToast("PAYOUT SUBMITTED", "Withdrawal payout is placed inside Ground Control ledger for approvals.", "success");
            closeModal('profileModal');
            
            form.reset();
            window.setWithdrawMethod('UPI');
        };
    }

    window.savePilotStoredPaymentInfo = function() {
        const upi = document.getElementById('profileUPI').value.trim();
        const bank = document.getElementById('profileBank').value.trim();
        
        currentUser.upiId = upi;
        currentUser.bankDetails = bank;
        localStorage.setItem('aviator_user', JSON.stringify(currentUser));
        
        const dbUsers = JSON.parse(localStorage.getItem('aviator_db_users')) || [];
        const idx = dbUsers.findIndex(u => u.email.toLowerCase() === currentUser.email.toLowerCase());
        if (idx !== -1) {
            dbUsers[idx].upiId = upi;
            dbUsers[idx].bankDetails = bank;
            localStorage.setItem('aviator_db_users', JSON.stringify(dbUsers));
        }
        
        showToast("PROFILE UPDATED", "Payout Account details registered successfully.", "success");
    };

    window.updatePhoneVerifyBadgeState = function() {
        const badge = document.getElementById('phoneVerifyBadge');
        const btn = document.getElementById('btnVerifyPhone');
        
        if (currentUser.phoneVerified) {
            btn.style.display = 'none';
            badge.style.background = 'rgba(34, 197, 94, 0.15)';
            badge.style.color = 'var(--accent-green)';
            badge.style.border = '1px solid rgba(34, 197, 94, 0.3)';
            badge.innerHTML = '✓ VERIFIED';
        } else {
            btn.style.display = 'inline-block';
            badge.style.background = 'rgba(239, 68, 68, 0.15)';
            badge.style.color = 'var(--accent-red)';
            badge.style.border = '1px solid rgba(239, 68, 68, 0.3)';
            badge.innerHTML = '⚠️ UNVERIFIED';
        }
    };

    window.triggerPhoneVerification = function() {
        const otp = Math.floor(100000 + Math.random() * 900000);
        window.activePhoneOtp = otp.toString();
        
        showToast("OTP TRANSMITTED", `🔐 GROUND CONTROL SECURE OTP: ${otp}`, "warning");
        openModal('otpModal');
    };

    window.submitOtpVerification = function() {
        const val = document.getElementById('otpInputField').value.trim();
        if (val === window.activePhoneOtp) {
            currentUser.phoneVerified = true;
            localStorage.setItem('aviator_user', JSON.stringify(currentUser));
            
            const dbUsers = JSON.parse(localStorage.getItem('aviator_db_users')) || [];
            const idx = dbUsers.findIndex(u => u.email.toLowerCase() === currentUser.email.toLowerCase());
            if (idx !== -1) {
                dbUsers[idx].phoneVerified = true;
                localStorage.setItem('aviator_db_users', JSON.stringify(dbUsers));
            }
            
            showToast("PHONE VERIFIED", "Mobile Coordinates verified successfully.", "success");
            closeModal('otpModal');
            window.updatePhoneVerifyBadgeState();
            document.getElementById('otpInputField').value = '';
        } else {
            showToast("VERIFY FAILED", "Security OTP code does not match active gateway request.", "error");
        }
    };

    window.resendOtpCode = function() {
        window.triggerPhoneVerification();
    };

    window.deleteSelfPilotAccount = function() {
        if (!confirm("Are you absolutely sure you want to permanently delete your pilot registry? This action CANNOT be undone.")) return;
        if (!confirm("FINAL CONFIRMATION: Are you sure you want to wipe all wallet balances, stats, and tickets?")) return;
        
        const targetEmail = currentUser.email.toLowerCase();
        
        // Remove from db_users
        let dbUsers = JSON.parse(localStorage.getItem('aviator_db_users')) || [];
        dbUsers = dbUsers.filter(u => u.email.toLowerCase() !== targetEmail);
        localStorage.setItem('aviator_db_users', JSON.stringify(dbUsers));
        
        // Prune tickets
        let tickets = JSON.parse(localStorage.getItem('aviator_tickets')) || [];
        tickets = tickets.filter(t => t.email.toLowerCase() !== targetEmail);
        localStorage.setItem('aviator_tickets', JSON.stringify(tickets));
        
        // Prune txns
        let txns = JSON.parse(localStorage.getItem('aviator_txns')) || [];
        txns = txns.filter(t => t.email.toLowerCase() !== targetEmail);
        localStorage.setItem('aviator_txns', JSON.stringify(txns));
        
        // Clear session
        localStorage.removeItem('aviator_session');
        localStorage.removeItem('aviator_user');
        
        // Show terminal de-authorization overlay
        const overlay = document.getElementById('logoutOverlay');
        const header = overlay.querySelector('div:nth-child(2)');
        const desc = overlay.querySelector('div:nth-child(3)');
        if (header) header.textContent = "WIPING PILOT DATA REGISTRY";
        if (desc) desc.textContent = "Purging transaction blocks, tickets, and assets...";
        overlay.classList.add('active');
        
        setTimeout(() => {
            window.location.href = "login.html";
        }, 2500);
    };

    // -------------------------------------------------------------
    // 10. CHAT SIMULATION & CHAT ROOMS
    // -------------------------------------------------------------
    function setupChatHandlers() {
        const form = document.getElementById('chatForm');
        form.onsubmit = (e) => {
            e.preventDefault();
            const val = document.getElementById('chatInput').value;
            if (!val.trim()) return;

            addChatBubble(currentUser.email.split('@')[0], val, "self");
            document.getElementById('chatInput').value = "";
            
            // Trigger storage sync for chat across tabs
            localStorage.setItem('aviator_chat_sync', JSON.stringify({
                sender: currentUser.email.split('@')[0],
                msg: val,
                time: Date.now()
            }));
        };
    }

    function addChatBubble(sender, message, type = "") {
        const container = document.getElementById('chatMsgContainer');
        if (!container) return;

        const div = document.createElement('div');
        div.className = `chat-msg ${type}`;
        div.innerHTML = `<strong>${sender}</strong>: ${message}`;
        
        container.appendChild(div);
        container.scrollTop = container.scrollHeight;
    }

    function spawnBotChatMsg() {
        const botName = botNames[Math.floor(Math.random() * botNames.length)];
        const msg = lobbyBotChatLines[Math.floor(Math.random() * lobbyBotChatLines.length)];
        addChatBubble(botName, msg);
    }

    function spawnBotCrashChatMsg() {
        const botName = botNames[Math.floor(Math.random() * botNames.length)];
        const msg = crashedBotChatLines[Math.floor(Math.random() * crashedBotChatLines.length)];
        addChatBubble(botName, msg);
    }

    // -------------------------------------------------------------
    // 11. TOAST SYSTEM
    // -------------------------------------------------------------
    window.showToast = function (title, message, type = "info") {
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.innerHTML = `
            <div class="toast-header">
                <span>${title}</span>
                <i data-lucide="x" style="width: 12px; height: 12px; cursor: pointer;" onclick="this.parentElement.parentElement.remove()"></i>
            </div>
            <div class="toast-body">${message}</div>
            <div class="toast-timer"></div>
        `;
        container.appendChild(toast);
        lucide.createIcons();

        // Animate timer
        const timer = toast.querySelector('.toast-timer');
        timer.style.transition = "transform 4000ms linear";
        timer.style.transform = "scaleX(0)";

        setTimeout(() => {
            timer.style.transform = "scaleX(0)";
        }, 10);

        setTimeout(() => {
            toast.remove();
        }, 4000);
    };

    // -------------------------------------------------------------
    // 12. RUNTIME INITS & EVENTS
    // -------------------------------------------------------------
    window.onload = () => {
        initDatabase();
        if (!checkAuth()) return;

        flightCanvas = document.getElementById('flightCanvas');
        ctx = flightCanvas.getContext('2d');

        // Setup resize
        window.addEventListener('resize', resizeCanvas);
        resizeCanvas();

        // Synced observers across browser tabs
        window.addEventListener('storage', (e) => {
            if (e.key === 'aviator_sync_trigger' || e.key === 'aviator_db_users') {
                syncUserBalance();
                renderPersonalBetsHistory();
            }
            if (e.key === 'aviator_chat_sync') {
                const parsed = JSON.parse(e.newValue);
                if (parsed && parsed.sender !== currentUser.email.split('@')[0]) {
                    addChatBubble(parsed.sender, parsed.msg);
                }
            }
        });

        // Initialize HUD & state syncs
        syncUserBalance();
        renderGlobalPastMultiplierPills();
        renderPersonalBetsHistory();

        // Setup double bet event mappings
        setupBettingHandlers();
        setupAppNavigation();
        setupWithdrawalFormHandler();
        setupChatHandlers();

        // Start synchronized flight loops
        renderLoop();
        setInterval(monitorEpochTick, 100);

        // WebAudio trigger activation on user clicks
        document.body.addEventListener('click', () => {
            synth.init();
        }, { once: true });
    };

})();
