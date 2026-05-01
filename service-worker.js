/* ═══════════════════════════════════════════════════════════════
   SERVICE WORKER — MonBudget PWA
   ─────────────────────────────────────────────────────────────
   ▸ Pour déployer une mise à jour : incrémenter APP_VERSION
     ex : '2.0.0' → '2.1.0'
   ▸ Le navigateur détecte le changement, installe le nouveau SW,
     supprime les anciens caches, et recharge l'app automatiquement.
═══════════════════════════════════════════════════════════════ */

/* ── VERSIONNING ─────────────────────────────────────────────
   ⚠️  INCRÉMENTER À CHAQUE DÉPLOIEMENT pour forcer la mise à jour
   Les noms de caches sont dérivés automatiquement.
──────────────────────────────────────────────────────────────*/
const APP_VERSION  = '2.0.0';
const CACHE_STATIC = `monbudget-static-v${APP_VERSION}`;
const CACHE_CDN    = `monbudget-cdn-v${APP_VERSION}`;

/* ── ASSETS STATIQUES (pré-cachés à l'installation) ─────────*/
const STATIC_ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './icons/icon-72.png',
  './icons/icon-96.png',
  './icons/icon-128.png',
  './icons/icon-144.png',
  './icons/icon-152.png',
  './icons/icon-192.png',
  './icons/icon-384.png',
  './icons/icon-512.png'
];

/* ── ASSETS CDN (Chart.js + XLSX) ───────────────────────────*/
const CDN_ASSETS = [
  'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js',
  'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'
];

/* ═══════════════════════════════════════════════════════════
   INSTALL — pré-cache + skipWaiting immédiat
════════════════════════════════════════════════════════════ */
self.addEventListener('install', event => {
  console.log(`[SW v${APP_VERSION}] Installation...`);

  event.waitUntil(
    Promise.all([

      caches.open(CACHE_STATIC).then(cache =>
        cache.addAll(STATIC_ASSETS)
          .then(()  => console.log(`[SW v${APP_VERSION}] Assets statiques cachés`))
          .catch(err => console.warn(`[SW v${APP_VERSION}] Assets partiels :`, err))
      ),

      caches.open(CACHE_CDN).then(cache =>
        cache.addAll(CDN_ASSETS)
          .then(()  => console.log(`[SW v${APP_VERSION}] CDN caché`))
          .catch(err => console.warn(`[SW v${APP_VERSION}] CDN non caché :`, err))
      )

    ]).then(() => {
      console.log(`[SW v${APP_VERSION}] Prêt — skipWaiting`);
      return self.skipWaiting();          // Actif immédiatement, sans attendre la fermeture des onglets
    })
  );
});

/* ═══════════════════════════════════════════════════════════
   ACTIVATE — nettoyage + prise de contrôle + notification
════════════════════════════════════════════════════════════ */
self.addEventListener('activate', event => {
  console.log(`[SW v${APP_VERSION}] Activation...`);

  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        const toDelete = cacheNames.filter(name =>
          name.startsWith('monbudget-') &&
          name !== CACHE_STATIC &&
          name !== CACHE_CDN
        );
        if (toDelete.length) console.log(`[SW v${APP_VERSION}] Suppression :`, toDelete);
        return Promise.all(toDelete.map(n => caches.delete(n)));
      })
      .then(() => self.clients.claim())   // Prend le contrôle de TOUS les onglets ouverts
      .then(() => self.clients.matchAll({ type: 'window', includeUncontrolled: true }))
      .then(clients => {
        console.log(`[SW v${APP_VERSION}] Notification de ${clients.length} client(s)`);
        clients.forEach(client =>
          client.postMessage({ type: 'SW_UPDATED', version: APP_VERSION })
        );
      })
  );
});

/* ═══════════════════════════════════════════════════════════
   FETCH — stratégies par type de ressource

   HTML / manifest → Network First  (toujours la dernière version)
   CDN             → Cache First    (URLs déjà versionées)
   Autres locaux   → Stale-While-Revalidate
════════════════════════════════════════════════════════════ */
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (url.pathname.includes('hot-update')) return;

  /* CDN — Cache First */
  if (url.origin === 'https://cdnjs.cloudflare.com') {
    event.respondWith(cacheFirst(req, CACHE_CDN));
    return;
  }

  if (url.origin === self.location.origin) {
    /* HTML et manifest — Network First */
    const isNavigation = req.mode === 'navigate';
    const isHtml = url.pathname.endsWith('.html') || url.pathname === '/' || url.pathname === '';
    const isManifest = url.pathname.endsWith('manifest.json');

    if (isNavigation || isHtml || isManifest) {
      event.respondWith(networkFirst(req, CACHE_STATIC));
      return;
    }

    /* Icônes et autres — Stale-While-Revalidate */
    event.respondWith(staleWhileRevalidate(req, CACHE_STATIC));
  }
});

/* ═══════════════════════════════════════════════════════════
   STRATÉGIES
════════════════════════════════════════════════════════════ */

/** Network First : réseau → cache offline */
async function networkFirst(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res?.status === 200) cache.put(req, res.clone());
    return res;
  } catch {
    const cached = await cache.match(req);
    if (cached) return cached;
    return cache.match('./index.html');   // Fallback ultime
  }
}

/** Cache First : cache → réseau si absent */
async function cacheFirst(req, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res?.status === 200) cache.put(req, res.clone());
    return res;
  } catch {
    return new Response('', { status: 503, statusText: 'Offline' });
  }
}

/** Stale-While-Revalidate : cache immédiat + update en arrière-plan */
async function staleWhileRevalidate(req, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);

  const networkPromise = fetch(req).then(res => {
    if (res?.status === 200) cache.put(req, res.clone());
    return res;
  }).catch(() => null);

  return cached || networkPromise;
}

/* ═══════════════════════════════════════════════════════════
   MESSAGE — canal de communication avec l'app
════════════════════════════════════════════════════════════ */
self.addEventListener('message', event => {
  if (!event.data?.type) return;

  switch (event.data.type) {

    case 'SKIP_WAITING':
      /* Demande explicite de l'app → forcer la mise à jour */
      console.log(`[SW v${APP_VERSION}] SKIP_WAITING reçu`);
      self.skipWaiting();
      break;

    case 'GET_VERSION':
      /* L'app demande la version du SW actif */
      event.source?.postMessage({
        type: 'SW_VERSION',
        version: APP_VERSION,
        caches: [CACHE_STATIC, CACHE_CDN]
      });
      break;

    case 'CLEAR_CACHE':
      /* Vidage total des caches (ex: bouton reset) */
      caches.keys()
        .then(keys => Promise.all(keys.map(k => caches.delete(k))))
        .then(() => {
          console.log(`[SW v${APP_VERSION}] Caches vidés`);
          event.source?.postMessage({ type: 'CACHE_CLEARED' });
        });
      break;
  }
});
