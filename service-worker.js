/* ═══════════════════════════════════════════════════
   SERVICE WORKER — MonBudget PWA
   Stratégie : Cache First pour les assets statiques
               Network First pour les ressources CDN
═══════════════════════════════════════════════════ */

const CACHE_NAME = 'monbudget-v1';
const CACHE_CDN  = 'monbudget-cdn-v1';

/* Assets locaux à mettre en cache immédiatement */
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

/* Assets CDN (Chart.js + XLSX) */
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

/* ── INSTALL : mise en cache des assets statiques ── */
self.addEventListener('install', event => {
  event.waitUntil(
    Promise.all([
      caches.open(CACHE_NAME).then(cache => {
        return cache.addAll(STATIC_ASSETS).catch(err => {
          console.warn('[SW] Certains assets statiques non mis en cache:', err);
        });
      }),
      caches.open(CACHE_CDN).then(cache => {
        return cache.addAll(CDN_ASSETS).catch(err => {
          console.warn('[SW] CDN assets non mis en cache (mode offline limité):', err);
        });
      })
    ]).then(() => {
      console.log('[SW] Installation terminée — cache prêt');
      return self.skipWaiting();
    })
  );
});

/* ── ACTIVATE : nettoyage des anciens caches ── */
self.addEventListener('activate', event => {
  const validCaches = [CACHE_NAME, CACHE_CDN];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => !validCaches.includes(name))
          .map(name => {
            console.log('[SW] Suppression ancien cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => {
      console.log('[SW] Activation — contrôle de toutes les pages');
      return self.clients.claim();
    })
  );
});

/* ── FETCH : stratégie de récupération ── */
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  /* Ignorer les requêtes non-GET */
  if (event.request.method !== 'GET') return;

  /* CDN : Cache First (Chart.js, XLSX doivent être stables) */
  if (url.origin === 'https://cdnjs.cloudflare.com') {
    event.respondWith(
      caches.open(CACHE_CDN).then(cache => {
        return cache.match(event.request).then(cached => {
          if (cached) return cached;
          return fetch(event.request).then(response => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => cached); /* offline : retourne le cache même périmé */
        });
      })
    );
    return;
  }

  /* Assets locaux : Cache First puis Network fallback */
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache => {
        return cache.match(event.request).then(cached => {
          if (cached) {
            /* Rafraîchissement en arrière-plan (stale-while-revalidate) */
            fetch(event.request).then(response => {
              if (response && response.status === 200) {
                cache.put(event.request, response.clone());
              }
            }).catch(() => {});
            return cached;
          }
          /* Pas en cache : réseau puis mise en cache */
          return fetch(event.request).then(response => {
            if (response && response.status === 200) {
              cache.put(event.request, response.clone());
            }
            return response;
          }).catch(() => {
            /* Offline fallback : retourne index.html pour les navigations */
            if (event.request.mode === 'navigate') {
              return caches.match('./index.html');
            }
          });
        });
      })
    );
    return;
  }
});

/* ── MESSAGE : forcer la mise à jour ── */
self.addEventListener('message', event => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
