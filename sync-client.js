// Vercel Serverless Sync Client
// This script intercepts localStorage and syncs it with the cloud (/api/sync)
// to fix cross-device data syncing issues for registered users.

(function() {
    const API_URL = '/api/sync';
    
    // Original localStorage methods
    const originalSetItem = localStorage.setItem;
    
    // Keys we want to sync to cloud
    const syncKeys = ['aviator_db_users', 'aviator_txns', 'aviator_tickets', 'aviator_activity_logs'];

    // 1. Pull from cloud on load
    async function pullFromCloud() {
        try {
            const res = await fetch(API_URL);
            if (!res.ok) return;
            const data = await res.json();
            
            let didUpdate = false;
            if (data.users && data.users.length > 0) {
                originalSetItem.call(localStorage, 'aviator_db_users', JSON.stringify(data.users));
                didUpdate = true;
            }
            if (data.txns && data.txns.length > 0) {
                originalSetItem.call(localStorage, 'aviator_txns', JSON.stringify(data.txns));
                didUpdate = true;
            }
            if (data.tickets && data.tickets.length > 0) {
                originalSetItem.call(localStorage, 'aviator_tickets', JSON.stringify(data.tickets));
                didUpdate = true;
            }
            if (data.activity_logs && data.activity_logs.length > 0) {
                originalSetItem.call(localStorage, 'aviator_activity_logs', JSON.stringify(data.activity_logs));
                didUpdate = true;
            }

            // If we are on flight-control.html and data updated, re-render
            if (didUpdate && typeof renderAllData === 'function') {
                renderAllData();
            }
            
        } catch (err) {
            console.warn("Failed to sync from cloud", err);
        }
    }

    // 2. Push to cloud
    async function pushToCloud() {
        try {
            const payload = {
                users: JSON.parse(localStorage.getItem('aviator_db_users') || '[]'),
                txns: JSON.parse(localStorage.getItem('aviator_txns') || '[]'),
                tickets: JSON.parse(localStorage.getItem('aviator_tickets') || '[]'),
                activity_logs: JSON.parse(localStorage.getItem('aviator_activity_logs') || '[]')
            };
            
            await fetch(API_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
        } catch (err) {
            console.warn("Failed to sync to cloud", err);
        }
    }

    // 3. Override localStorage.setItem to auto-push
    let syncTimeout = null;
    localStorage.setItem = function(key, value) {
        originalSetItem.call(localStorage, key, value);
        
        if (syncKeys.includes(key)) {
            // Debounce push to avoid spamming the API
            if (syncTimeout) clearTimeout(syncTimeout);
            syncTimeout = setTimeout(() => {
                pushToCloud();
            }, 500);
        }
    };

    // Initialize
    pullFromCloud();
    
    // Expose for manual triggering
    window.forceCloudSync = pushToCloud;
})();
