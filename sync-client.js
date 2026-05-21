// Firebase Sync Client
// This script intercepts localStorage and syncs it with Firebase Realtime Database

import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getDatabase, ref, set, get, onValue } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-database.js";

const firebaseConfig = {
    apiKey: "AIzaSyAamiz5i_njeSZ9LaAXedxtMMlDVm2Mw0w",
    authDomain: "avtr-7a851.firebaseapp.com",
    projectId: "avtr-7a851",
    storageBucket: "avtr-7a851.firebasestorage.app",
    messagingSenderId: "216465267194",
    appId: "1:216465267194:web:15b44acd48242b71bb6c43"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

// Original localStorage methods
const originalSetItem = localStorage.setItem;

// Keys we want to sync to cloud
const syncKeys = ['aviator_db_users', 'aviator_txns', 'aviator_tickets', 'aviator_activity_logs'];
let isSyncingFromCloud = false;

// 1. Listen for real-time updates from Firebase
function setupRealtimeListeners() {
    const dbRef = ref(db, 'avtrDataStore');
    
    onValue(dbRef, (snapshot) => {
        const data = snapshot.val();
        if (!data) return;
        
        isSyncingFromCloud = true;
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

        isSyncingFromCloud = false;

        // If we are on flight-control.html and data updated, re-render
        if (didUpdate && typeof window.renderAllData === 'function') {
            window.renderAllData();
        }
    }, (error) => {
        console.warn("Firebase read failed:", error);
    });
}

// 2. Push to cloud
async function pushToCloud() {
    if (isSyncingFromCloud) return; // Prevent infinite loops
    
    try {
        const payload = {
            users: JSON.parse(localStorage.getItem('aviator_db_users') || '[]'),
            txns: JSON.parse(localStorage.getItem('aviator_txns') || '[]'),
            tickets: JSON.parse(localStorage.getItem('aviator_tickets') || '[]'),
            activity_logs: JSON.parse(localStorage.getItem('aviator_activity_logs') || '[]'),
            lastUpdated: Date.now()
        };
        
        await set(ref(db, 'avtrDataStore'), payload);
    } catch (err) {
        console.warn("Failed to sync to Firebase", err);
    }
}

// 3. Override localStorage.setItem to auto-push
let syncTimeout = null;
localStorage.setItem = function(key, value) {
    originalSetItem.call(localStorage, key, value);
    
    if (syncKeys.includes(key) && !isSyncingFromCloud) {
        // Debounce push to avoid spamming Firebase
        if (syncTimeout) clearTimeout(syncTimeout);
        syncTimeout = setTimeout(() => {
            pushToCloud();
        }, 500);
    }
};

// Initialize
setupRealtimeListeners();
window.forceCloudSync = pushToCloud;
