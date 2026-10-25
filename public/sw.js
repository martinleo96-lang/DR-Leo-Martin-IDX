/* ============================================================
   IDX Terminal — Service Worker (PWA)
   - Cache app shell → aplikasi bisa dibuka offline
   - Periodic Background Sync (Chrome Android, best effort):
     memindai sinyal Strong Buy/Sell & Order Block baru di
     latar belakang lalu menampilkan notifikasi sistem
   ============================================================ */
const CACHE = 'idx-terminal-v4';
const SHELL = [
  '/', '/index.html', '/styles.css', '/app.js', '/ta-lib.js', '/manifest.webmanifest',
  '/vendor/lightweight-charts.js', '/icons/icon-192.png', '/icons/icon-512.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  if (url.pathname.startsWith('/api/')) {
    // data live: selalu dari jaringan (fallback cache bila offline)
    e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
    return;
  }
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((resp) => {
      if (resp.ok && url.origin === self.location.origin) {
        const cp = resp.clone();
        caches.open(CACHE).then((c) => c.put(e.request, cp));
      }
      return resp;
    }))
  );
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((cs) => {
      const c = cs.find(x => x.url.startsWith(self.location.origin));
      if (c) return c.focus();
      return clients.openWindow('/');
    })
  );
});

/* ---------- IndexedDB mini ---------- */
function idbOpen() {
  return new Promise((res, rej) => {
    const rq = indexedDB.open('idxsw', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function idbGet(k) {
  try {
    const db = await idbOpen();
    return await new Promise((res) => {
      const rq = db.transaction('kv', 'readonly').objectStore('kv').get(k);
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => res(null);
    });
  } catch (e) { return null; }
}
async function idbSet(k, v) {
  try {
    const db = await idbOpen();
    await new Promise((res) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch (e) {}
}

/* ---------- Periodic Background Sync ---------- */
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'idx-scan') e.waitUntil(bgScan());
});

async function bgScan() {
  try {
    const [sigRes, obRes] = await Promise.all([
      fetch('/api/signals', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/orderblocks', { cache: 'no-store' }).then(r => r.json()),
    ]);
    const snap = (await idbGet('snap')) || { labels: {}, obSeen: {}, init: false };
    const notes = [];

    for (const s of sigRes.data || []) {
      if (!s || s.error) continue;
      const sym = String(s.symbol);
      const prev = snap.labels[sym];
      snap.labels[sym] = s.label;
      const strong = s.label === 'Strong Buy' || s.label === 'Strong Sell';
      if (snap.init && prev && prev !== s.label && strong) {
        notes.push(`${s.label === 'Strong Buy' ? '🚀' : '🔻'} ${sym} kini ${s.label.toUpperCase()} (sebelumnya ${prev})`);
      }
    }
    for (const row of obRes.data || []) {
      const obs = row.obs || [];
      if (!obs.length) continue;
      const sym = String(row.symbol).replace(/\.JK$/, '');
      const newest = obs[0].formedTs || 0;
      const prev = snap.obSeen[sym] || 0;
      snap.obSeen[sym] = Math.max(prev, newest);
      if (snap.init && prev) {
        for (const ob of obs.filter(o => (o.formedTs || 0) > prev).slice(0, 2)) {
          notes.push(`🧱 OB ${ob.type === 'bull' ? 'BULLISH 🟢' : 'BEARISH 🔴'} baru terbentuk — ${sym} (${ob.bottom}–${ob.top})`);
        }
      }
    }
    snap.init = true;
    await idbSet('snap', snap);

    for (const body of notes.slice(0, 6)) {
      await self.registration.showNotification('IDX Terminal', {
        body,
        icon: '/icons/icon-192.png',
        badge: '/icons/icon-192.png',
        tag: 'idx-bg-' + Date.now(),
      });
    }
  } catch (e) {}
}
