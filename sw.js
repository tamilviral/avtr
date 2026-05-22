/* ==========================================================================
   AVIATOR COCKPIT - SERVICE WORKER
   Strategy: Stale-While-Revalidate Caching Model
   ========================================================================== */

const CACHE_NAME = 'aviator-cockpit-v4'; // Bumped: forces mobile cache refresh
const STATIC_ASSETS = [
    './',
    './index.html',
    './styles.css',
    './app.js',
    './login.html',
    './gateway.html',
    './tickets.html',
    './manifest.json',
    './payout-qr.png',
    './firebase-config.js'
];

// Installation: Cache initial offline resources
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Pre-caching static assets');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    // Force active state
    self.skipWaiting();
});

// Activation: Clear legacy structures
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) => {
            return Promise.all(
                keys.map((key) => {
                    if (key !== CACHE_NAME) {
                        console.log('[SW] Clearing old cache', key);
                        return caches.delete(key);
                    }
                })
            );
        })
    );
    self.clients.claim();
});

// Intercept requests: Stale-While-Revalidate Model
self.addEventListener('fetch', (event) => {
    // Only cache GET requests
    if (event.request.method !== 'GET') return;

    const url = event.request.url;

    // NEVER intercept Firebase / Google API requests — always fetch live
    if (
        url.includes('firebaseio.com') ||
        url.includes('firestore.googleapis.com') ||
        url.includes('firebase.googleapis.com') ||
        url.includes('gstatic.com/firebasejs') ||
        url.includes('googleapis.com')
    ) {
        event.respondWith(fetch(event.request));
        return;
    }

    event.respondWith(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.match(event.request).then((cachedResponse) => {
                const fetchPromise = fetch(event.request).then((networkResponse) => {
                    // Update cache with the fresh response
                    cache.put(event.request, networkResponse.clone());
                    return networkResponse;
                }).catch(() => {
                    console.log('[SW] Offline fetch fallback trigger');
                });

                // Return cached version immediately if available, otherwise wait for network fetch
                return cachedResponse || fetchPromise;
            });
        })
    );
});
