// cloud-sync.js - Global Cloud Synchronization for Multi-Device Aviator Game
(function() {
    const BUCKET_ID = "kv_aviator_db_824a9c0b_42a8"; // Unique bucket ID for this game instance
    const KVDB_BASE_URL = `https://kvdb.io/${BUCKET_ID}/`;

    const SYNC_KEYS = ["aviator_db_users", "aviator_txns", "aviator_support_tickets"];
    let isSyncing = false;

    // Helper to fetch value from KVdb
    async function cloudGet(key) {
        try {
            const res = await fetch(KVDB_BASE_URL + key);
            if (res.status === 404) return null;
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.json();
        } catch (e) {
            console.warn(`[CloudSync] Failed to fetch ${key}:`, e);
            return null;
        }
    }

    // Helper to save value to KVdb
    async function cloudPut(key, val) {
        try {
            const res = await fetch(KVDB_BASE_URL + key, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(val)
            });
            return res.ok;
        } catch (e) {
            console.warn(`[CloudSync] Failed to save ${key}:`, e);
            return false;
        }
    }

    // Pull from cloud and update local storage
    async function syncPull() {
        if (isSyncing) return;
        isSyncing = true;
        let updated = false;

        for (const key of SYNC_KEYS) {
            const cloudVal = await cloudGet(key);
            if (cloudVal !== null) {
                const localStr = localStorage.getItem(key);
                const cloudStr = JSON.stringify(cloudVal);
                if (localStr !== cloudStr) {
                    localStorage.setItem(key, cloudStr);
                    updated = true;
                    console.log(`[CloudSync] Key ${key} updated from cloud`);

                    // Dispatch StorageEvent locally to notify any listeners on this page
                    const storageEvent = new StorageEvent('storage', {
                        key: key,
                        newValue: cloudStr
                    });
                    window.dispatchEvent(storageEvent);
                }
            } else {
                // If cloud is empty but local has data, upload local data to seed the cloud
                const localStr = localStorage.getItem(key);
                if (localStr) {
                    try {
                        const localVal = JSON.parse(localStr);
                        await cloudPut(key, localVal);
                        console.log(`[CloudSync] Seeded key ${key} from local to cloud`);
                    } catch(e) {}
                }
            }
        }

        if (updated) {
            // Sync active user session object if their details changed in db_users
            const savedUser = localStorage.getItem("aviator_user");
            const dbStr = localStorage.getItem("aviator_db_users");
            if (savedUser && dbStr) {
                try {
                    const user = JSON.parse(savedUser);
                    const db = JSON.parse(dbStr);
                    const fresh = db.find(u => String(u.email).toLowerCase().trim() === String(user.email).toLowerCase().trim());
                    if (fresh) {
                        localStorage.setItem("aviator_user", JSON.stringify(fresh));
                        
                        // Fire storage event for aviator_user
                        window.dispatchEvent(new StorageEvent('storage', {
                            key: 'aviator_user',
                            newValue: JSON.stringify(fresh)
                        }));
                    }
                } catch(e) {}
            }

            // Call internal reload functions if they exist on the page
            if (typeof window.loadFromLocalStorage === 'function') {
                try { window.loadFromLocalStorage(); } catch(e) {}
            }
            if (typeof window.loadSession === 'function') {
                try { window.loadSession(); } catch(e) {}
            }
            if (typeof window.updateUI === 'function') {
                try { window.updateUI(); } catch(e) {}
            }
            if (typeof window.renderTickets === 'function') {
                try { window.renderTickets(); } catch(e) {}
            }
            if (typeof window.updateWalletDisplay === 'function') {
                try { window.updateWalletDisplay(); } catch(e) {}
            }
            if (typeof window.updateProfileStatsUI === 'function') {
                try { window.updateProfileStatsUI(); } catch(e) {}
            }
            if (typeof window.updateTransactionsUI === 'function') {
                try { window.updateTransactionsUI(); } catch(e) {}
            }
        }
        isSyncing = false;
    }

    // Push local state of key to the cloud
    async function syncPushKey(key, value) {
        console.log(`[CloudSync] Pushing key ${key} to cloud...`);
        await cloudPut(key, value);
    }

    // Intercept localStorage.setItem to automatically trigger cloud push
    const originalSetItem = localStorage.setItem;
    localStorage.setItem = function(key, value) {
        originalSetItem.apply(this, arguments);
        if (SYNC_KEYS.includes(key) && !isSyncing) {
            try {
                const parsedVal = JSON.parse(value);
                // Run in background to avoid blocking main thread
                setTimeout(() => syncPushKey(key, parsedVal), 10);
            } catch(e) {}
        }
    };

    // Auto-run Sync on load
    window.addEventListener("load", () => {
        syncPull();
        // Periodically poll the cloud every 6 seconds to keep screens in sync
        setInterval(syncPull, 6000);
    });

    // Expose sync trigger globally
    window.triggerCloudSync = syncPull;

})();
