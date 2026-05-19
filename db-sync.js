/* ==========================================================================
   AVIATOR CLOUD SYNCHRONIZATION ENGINE
   Provides seamless real-time database sharing between mobile & desktop.
   Uses kvdb.io public buckets with local storage transparent caching.
   ========================================================================== */

(function() {
    const BUCKET = "https://kvdb.io/FzP1mPNDw26xUq9tA4xG5k";
    
    // Inject custom animation styles for loader spinner
    const style = document.createElement('style');
    style.innerHTML = `
        @keyframes cloud-spin {
            to { transform: rotate(360deg); }
        }
        @keyframes cloud-fadeout {
            from { opacity: 1; }
            to { opacity: 0; }
        }
    `;
    document.head.appendChild(style);

    // Create loader overlay DOM element
    const loader = document.createElement('div');
    loader.id = 'cloud-sync-loader';
    loader.style = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100vw;
        height: 100vh;
        background: #090a0f;
        z-index: 100000;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        font-family: 'Outfit', sans-serif;
        color: #ffffff;
        transition: opacity 0.4s ease;
    `;
    loader.innerHTML = `
        <div style="width: 50px; height: 50px; border: 3px solid rgba(34, 197, 94, 0.1); border-top-color: #22c55e; border-radius: 50%; animation: cloud-spin 1s linear infinite; margin-bottom: 20px;"></div>
        <div style="font-weight: 800; font-size: 16px; letter-spacing: 1px; margin-bottom: 8px; text-transform: uppercase;">Connecting to Cloud Grid</div>
        <div style="font-size: 11px; color: rgba(255,255,255,0.5); text-align: center; max-width: 250px; line-height: 1.4;">Synchronizing mobile & desktop pilot registries...</div>
    `;

    // Append loader as soon as body is available
    if (document.body) {
        document.body.appendChild(loader);
    } else {
        document.addEventListener('DOMContentLoaded', () => {
            document.body.appendChild(loader);
        });
    }

    // Central cloud DB functions
    window.CloudDb = {
        async pull() {
            try {
                // Pull users database
                const resUsers = await fetch(`${BUCKET}/db_users`);
                if (resUsers.ok) {
                    const data = await resUsers.json();
                    if (data && Array.isArray(data) && data.length > 0) {
                        localStorage.setItem('aviator_db_users', JSON.stringify(data));
                    }
                }
                
                // Pull transactions database
                const resTxns = await fetch(`${BUCKET}/txns`);
                if (resTxns.ok) {
                    const data = await resTxns.json();
                    if (data && Array.isArray(data)) {
                        localStorage.setItem('aviator_txns', JSON.stringify(data));
                    }
                }
                
                // Pull tickets database
                const resTickets = await fetch(`${BUCKET}/tickets`);
                if (resTickets.ok) {
                    const data = await resTickets.json();
                    if (data && Array.isArray(data)) {
                        localStorage.setItem('aviator_tickets', JSON.stringify(data));
                    }
                }
                
                console.log("☁️ Central Cloud Database synchronized successfully.");
            } catch (err) {
                console.warn("☁️ Cloud database offline. Running on Local Cache fallback.", err);
            }
        },
        
        async push() {
            try {
                const users = localStorage.getItem('aviator_db_users') || "[]";
                const txns = localStorage.getItem('aviator_txns') || "[]";
                const tickets = localStorage.getItem('aviator_tickets') || "[]";
                
                await fetch(`${BUCKET}/db_users`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: users
                });
                
                await fetch(`${BUCKET}/txns`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: txns
                });
                
                await fetch(`${BUCKET}/tickets`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: tickets
                });
                
                console.log("☁️ Changes successfully uploaded to Central Cloud Database.");
            } catch (err) {
                console.error("☁️ Failed to push changes to cloud.", err);
            }
        }
    };

    // Auto-intercept localStorage changes to update the cloud in real-time
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = function(key, value) {
        originalSetItem.apply(this, arguments);
        
        if (key === 'aviator_db_users' || key === 'aviator_txns' || key === 'aviator_tickets') {
            const endpoint = key.replace('aviator_', '');
            fetch(`${BUCKET}/${endpoint}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: value
            }).catch(err => console.warn("☁️ Async Cloud sync failed:", err));
        }
    };

    // Initialize and pull on load
    async function initSync() {
        // Run cloud pull
        await window.CloudDb.pull();
        
        // Hide loader smoothly
        setTimeout(() => {
            loader.style.opacity = '0';
            setTimeout(() => {
                loader.remove();
                // Trigger global render updates if defined on page
                if (typeof renderAllData === 'function') renderAllData();
                if (typeof renderUsers === 'function') renderUsers();
                if (typeof initGame === 'function') initGame();
            }, 400);
        }, 1200);
    }

    initSync();
})();
