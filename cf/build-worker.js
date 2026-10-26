/* ============================================================
   build-worker.js — pengemas versi Cloudflare Workers
   Menghasilkan cf/worker-bundle.js: SATU file berisi seluruh app
   (UI statis + scanner terjadwal + API). Cara pakai:
     node cf/build-worker.js
   ============================================================ */
const fs = require('fs');
const path = require('path');

const PUB = path.join(__dirname, '..', 'public');
const out = path.join(__dirname, 'worker-bundle.js');

/* ---- simbol: ambil dari symbols.js (CJS) → array ringkas ---- */
const { UNIVERSE, LIQUID } = require('../symbols.js');
const UNI = UNIVERSE.map(u => [u.symbol, u.name, u.sector || null]);
const LIQ = [...LIQUID];

/* ---- file statis (teks + biner) ---- */
const textFiles = {
  '/': 'index.html', '/index.html': 'index.html',
  '/app.js': 'app.js', '/styles.css': 'styles.css',
  '/sw.js': 'sw.js', '/ta-lib.js': 'ta-lib.js',
  '/manifest.webmanifest': 'manifest.webmanifest',
  '/vendor/lightweight-charts.js': 'vendor/lightweight-charts.js',
};
const binFiles = {
  '/icons/icon-192.png': 'icons/icon-192.png',
  '/icons/icon-512.png': 'icons/icon-512.png',
  '/icons/icon-maskable.png': 'icons/icon-maskable.png',
};
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
};
const files = {};
for (const [urlp, rel] of Object.entries(textFiles)) {
  files[urlp] = { mime: MIME[path.extname(rel)] || 'text/plain', t: fs.readFileSync(path.join(PUB, rel), 'utf8') };
}
for (const [urlp, rel] of Object.entries(binFiles)) {
  files[urlp] = { mime: MIME['.png'], b: fs.readFileSync(path.join(PUB, rel)).toString('base64') };
}

let tmpl = fs.readFileSync(path.join(__dirname, 'worker.template.js'), 'utf8');
tmpl = tmpl
  .replace('/*__FILES__*/', JSON.stringify(files))
  .replace('/*__UNI__*/', JSON.stringify(UNI))
  .replace('/*__LIQ__*/', JSON.stringify(LIQ))
  .replace('/*__TALIB__*/', () => fs.readFileSync(path.join(PUB, 'ta-lib.js'), 'utf8'));

fs.writeFileSync(out, tmpl);
console.log('OK →', out, (tmpl.length / 1024).toFixed(0) + ' KB');
