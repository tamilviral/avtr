import { initializeApp } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-app.js";
import { getDatabase, ref, set, onValue } from "https://www.gstatic.com/firebasejs/12.13.0/firebase-database.js";

// Firebase Configuration provided by user
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
const syncKeys = ['aviator_db_users', 'aviator_txns', 'aviator_tickets', 'aviator_activity_logs', 'aviator_flight_rules'];

// 1. Listen to real-time changes from Firebase and pull them down
syncKeys.forEach(key => {
    onValue(ref(db, 'db_state/' + key), (snapshot) => {
        const data = snapshot.val();
        if (data) {
            // Use originalSetItem to avoid infinite sync loops
            originalSetItem.call(localStorage, key, JSON.stringify(data));
            
            // Re-render admin dashboard if active
            if (typeof window.renderAllData === 'function') {
                window.renderAllData();
            }
        }
    });
});

// 2. Override localStorage.setItem to auto-push changes to Firebase
let syncTimeout = null;
localStorage.setItem = function(key, value) {
    originalSetItem.call(localStorage, key, value);
    
    if (syncKeys.includes(key)) {
        // Debounce push to avoid spamming the Firebase API
        if (syncTimeout) clearTimeout(syncTimeout);
        syncTimeout = setTimeout(() => {
            // Push all sync keys to keep state consistent
            syncKeys.forEach(k => {
                const localData = JSON.parse(localStorage.getItem(k) || '[]');
                set(ref(db, 'db_state/' + k), localData).catch(err => {
                    console.warn("Failed to sync to Firebase", err);
                });
            });
        }, 500);
    }
};

window.forceCloudSync = () => {
    syncKeys.forEach(k => {
        const localData = JSON.parse(localStorage.getItem(k) || '[]');
        set(ref(db, 'db_state/' + k), localData);
    });
};
