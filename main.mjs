// ============================================================
// DR Leo Martin IDX — entry untuk Deno Deploy (GRATIS, tanpa
// kartu, tanpa tidur). Pemindai dijalankan Deno.cron, hasil
// disimpan di Deno KV. Frontend & seluruh logika TA identik
// dengan server.js (versi Node untuk lokal).
// ============================================================
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url); // kompatibilitas modul CJS
const TALib = require('./public/ta-lib.js');    // mesin TA bersama (UMD)
const { UNIVERSE, LIQUID } = require('./symbols.js');
const GMT_WIB = 7 * 3600;

const YF_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const UA = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
};

const INDICES = [
  { symbol: '^JKSE', name: 'IHSG — Indeks Harga Saham Gabungan' },
  { symbol: '^JKLQ45', name: 'Indeks LQ45' },
];
const UNI_MAP = new Map(UNIVERSE.map(u => [u.symbol, u]));
const LIQUID_ENTRIES = UNIVERSE.filter(u => LIQUID.has(u.symbol));
const TIER_A = [...INDICES.map(i => ({ symbol: i.symbol, name: i.name, index: true })), ...LIQUID_ENTRIES];
const TIER_B = UNIVERSE.filter(u => !LIQUID.has(u.symbol));
// Watchlist default (saham populer) — simbol saja, nama diambil dari universe
const WATCHLIST = ['BBCA','BBRI','BMRI','BBNI','BRIS','ARTO','BBYB','TLKM','ISAT','EXCL','ASII','UNVR','ICBP','INDF','KLBF','MYOR','GGRM','HMSP','SMGR','INTP','ADRO','PTBA','ITMG','UNTR','ANTM','INCO','MDKA','BRPT','BREN','CUAN','AMMN','TPIA','PGAS','MEDC','ESSA','GOTO','BUKA','EMTK','AMRT','ACES','CPIN','JPFA','SIDO','TOWR','TBIG','CTRA','PWON','SMRA','JSMR','GIAA']
  .map(s => ({ symbol: s, name: (UNI_MAP.get(s) || {}).name || s }));

/* ---------------- cache memori per-isolate ---------------- */
const cache = new Map();
const cacheGet = (k, ttl) => { const h = cache.get(k); return h && Date.now() - h.t < ttl ? h.data : null; };
const cacheSet = (k, d) => { if (cache.size > 800) cache.delete(cache.keys().next().value); cache.set(k, { t: Date.now(), data: d }); };
const cacheStale = (k) => { const h = cache.get(k); return h ? h.data : null; };

/* ---------------- Yahoo Finance ---------------- */
async function yahooJson(pathname) {
  let lastErr = null;
  for (const host of YF_HOSTS) {
    try {
      const r = await fetch(host + pathname, { headers: UA, signal: AbortSignal.timeout(12000) });
      if (r.status === 429) { lastErr = new Error('Rate limit Yahoo (429)'); continue; }
      if (!r.ok) { lastErr = new Error('Yahoo HTTP ' + r.status); continue; }
      return await r.json();
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Gagal menghubungi Yahoo Finance');
}
async function yahooCached(key, ttlMs, pathname) {
  const hit = cacheGet(key, ttlMs);
  if (hit) return hit;
  try { const d = await yahooJson(pathname); cacheSet(key, d); return d; }
  catch (e) { const s = cacheStale(key); if (s) return s; throw e; }
}

/* ---------------- helper ---------------- */
function normSymbol(s) {
  s = String(s || '').trim().toUpperCase();
  if (!s) return '';
  if (s.startsWith('^') || s.includes('.')) return s;
  return s + '.JK';
}
const toJakartaDate = (tsSec, gmt) => new Date((tsSec + (gmt ?? GMT_WIB)) * 1000).toISOString().slice(0, 10);
async function mapLimit(arr, n, fn) {
  const out = new Array(arr.length); let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, arr.length) }, async () => {
    while (i < arr.length) { const k = i++; out[k] = await fn(arr[k], k); }
  }));
  return out;
}

/* Bars harian 1 tahun (dipakai sinyal, OB, risiko, EMA cross) */
async function getDailyBars(symInput) {
  const sym = normSymbol(symInput);
  const data = await yahooCached('sig:' + sym, 5 * 60000,
    `/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d&includePrePost=false`);
  const r = data.chart && data.chart.result && data.chart.result[0];
  if (!r) throw new Error('data kosong');
  const ts = r.timestamp || [];
  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const bars = [], validTs = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open && q.open[i], h = q.high && q.high[i], l = q.low && q.low[i], c = q.close && q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    bars.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: (q.volume && q.volume[i]) || 0 });
    validTs.push(ts[i]);
  }
  const meta = r.meta || {};
  if (bars.length >= 60) BARS_DB.set(sym, bars); // simpan utk kotak alert EMA cross kustom
  return { bars, validTs, meta };
}

/* BARS_DB: bar harian hasil pindai (memori) + /api/emax —
   BUY pakai pasangan sendiri (bawaan 3×7 naik), SELL pakai pasangan sendiri
   (bawaan 2×6 turun) — sesuai skema awal app, bisa diubah pengguna */
const BARS_DB = new Map();
function computeEmaxCross(bars, fast, slow) {
  if (!bars || bars.length < Math.max(slow + 3, fast * 2 + 1)) return { buy: null, sell: null };
  const c = bars.map(b => b.close);
  const A = TALib.emaOn(c, fast), B = TALib.emaOn(c, slow);
  let buyAt = -1, sellAt = -1;
  for (let i = 1; i < c.length; i++) {
    const fa = A[i], fb = B[i], pa = A[i - 1], pb = B[i - 1];
    if (![fa, fb, pa, pb].every(Number.isFinite)) continue;
    if (pa <= pb && fa > fb) buyAt = i;
    else if (pa >= pb && fa < fb) sellAt = i;
  }
  const lastIdx = bars.length - 1;
  const mk = (at) => {
    if (at < 0) return null;
    const age = lastIdx - at;
    return age <= 5 ? { age, t: bars[at].time || null } : null;
  };
  return { buy: mk(buyAt), sell: mk(sellAt) };
}
function apiEmax(u) {
  const p = (k, d, lo, hi) => Math.min(hi, Math.max(lo, parseInt(u.searchParams.get(k), 10) || d));
  const fastB = p('fastB', p('fast', 3, 2, 200), 2, 200);
  const slowB = p('slowB', p('slow', 7, 3, 300), 3, 300);
  const fastS = p('fastS', 2, 2, 200);
  const slowS = p('slowS', 6, 3, 300);
  if (fastB >= slowB) return sendJson({ error: 'BUY: EMA cepat harus lebih kecil dari EMA lambat.' }, 400);
  if (fastS >= slowS) return sendJson({ error: 'SELL: EMA cepat harus lebih kecil dari EMA lambat.' }, 400);
  const out = [];
  for (const [sym, bars] of BARS_DB) {
    if (sym.startsWith('^') || !bars || bars.length < 10) continue;
    const rB = computeEmaxCross(bars, fastB, slowB).buy;
    const rS = computeEmaxCross(bars, fastS, slowS).sell;
    if (!rB && !rS) continue;
    const entry = UNI_MAP.get(sym);
    const last = bars[bars.length - 1], prv = bars.length > 1 ? bars[bars.length - 2].close : last.close;
    const base = {
      symbol: sym, name: entry ? entry.name : sym,
      sector: entry && entry.sector ? entry.sector : null,
      price: last.close,
      changePct: prv ? ((last.close - prv) / prv) * 100 : 0,
    };
    if (rB) out.push({ ...base, dir: 'BUY', age: rB.age, t: rB.t });
    if (rS) out.push({ ...base, dir: 'SELL', age: rS.age, t: rS.t });
  }
  const rank = { BUY: 0, SELL: 1 };
  out.sort((a, b) => rank[a.dir] - rank[b.dir] || a.age - b.age || (b.changePct - a.changePct));
  return sendJson({
    data: out, total: out.length, coverage: BARS_DB.size, ts: Date.now(),
    buy: { fast: fastB, slow: slowB }, sell: { fast: fastS, slow: slowS },
  });
}

/* ---------------- sinyal per simbol ---------------- */
async function getSignal(entry) {
  try {
    const { bars, meta } = await getDailyBars(entry.symbol);
    if (bars.length < 60) throw new Error('bar kurang dari 60');
    const rating = TALib.computeRatings(bars);
    if (!rating) throw new Error('rating kosong');
    const closes = bars.map(b => b.close);
    const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : closes[closes.length - 1];
    const prev = closes.length > 1 ? closes[closes.length - 2] : price;
    const isIdx = String(entry.symbol).startsWith('^');
    const risk = isIdx ? null : TALib.classifyRisk(bars, { liquid: LIQUID.has(entry.symbol) });
    const emax = TALib.emaCrossNow(bars);
    const vfx = isIdx ? null : TALib.vixFix(bars);
    return {
      symbol: entry.symbol, name: entry.name, price,
      changePct: prev ? ((price - prev) / prev) * 100 : 0,
      score: +rating.score.toFixed(3), label: TALib.labelOf(rating.score),
      buys: rating.b, sells: rating.s, neutrals: rating.n, total: rating.total,
      oscScore: +rating.oscS.score.toFixed(3), maScore: +rating.maS.score.toFixed(3),
      sector: entry.sector || null,
      risk: risk ? risk.code : null, riskNote: risk ? risk.note : null,
      emaxBuy: emax.buy, emaxSell: emax.sell,
      vfxB: !!(vfx && vfx.bottom), vfxT: !!(vfx && vfx.top),
      vol: (bars.length ? bars[bars.length - 1].volume : 0) || 0,
      val: Math.round(price * ((bars.length ? bars[bars.length - 1].volume : 0) || 0)),
      synthetic: false,
    };
  } catch (e) {
    return { symbol: entry.symbol, name: entry.name, error: true };
  }
}

/* ---------------- snapshot di Deno KV ---------------- */
async function packObj(obj) {
  const cs = new CompressionStream('gzip');
  const buf = new Uint8Array(await new Response(
    new Blob([new TextEncoder().encode(JSON.stringify(obj))]).stream().pipeThrough(cs)
  ).arrayBuffer());
  return buf;
}
async function unpackObj(buf) {
  const ds = new DecompressionStream('gzip');
  const text = await new Response(new Blob([buf]).stream().pipeThrough(ds)).text();
  return JSON.parse(text);
}
let kv = null;
let SNAP_MEM = null; // cermin in-memory (cadangan kalau KV tidak/lambat tersedia)
try { kv = await Deno.openKv(); } catch (e) { console.log('KV tidak tersedia:', e.message); }

async function loadSnap() {
  if (kv) {
    try {
      const r = await kv.get(['sig', 'snap']);
      if (r.value) { SNAP_MEM = await unpackObj(r.value); return SNAP_MEM; }
    } catch (e) {}
  }
  return SNAP_MEM || { rows: {}, A: { ts: 0, done: 0 }, B: { ts: 0, done: 0 } };
}
async function saveSnap(snap) {
  SNAP_MEM = snap;
  if (!kv) return;
  try { await kv.set(['sig', 'snap'], await packObj(snap)); } catch (e) {}
}

/* ---------------- pemindai 2 lapis ---------------- */
const SCAN = { runningA: false, runningB: false };
// TTL snapshot — hemat kuota CPU gratis Deno: lapis likuid 30 mnt, seluruh pasar 6 jam
const TTL_A = 30 * 60000, TTL_B = 6 * 60 * 60000;

async function scanTier(tier) {
  const isA = tier === 'A';
  if (isA ? SCAN.runningA : SCAN.runningB) return;
  if (isA) SCAN.runningA = true; else SCAN.runningB = true;
  const list = isA ? TIER_A : TIER_B;
  try {
    const fresh = new Map(); // hasil tier ini saja
    let done = 0;
    const flush = async (final) => {
      const snap = await loadSnap();           // baca terbaru → hindari timpa tier lain
      for (const [k, v] of fresh) snap.rows[k] = v;
      snap[tier] = { ts: final ? Date.now() : (snap[tier] || {}).ts || 0, done };
      await saveSnap(snap);
      fresh.clear();
    };
    await mapLimit(list, 6, async (entry) => {
      const row = await getSignal(entry);
      fresh.set(entry.symbol, row);
      done++;
      if (done % 40 === 0) await flush(false);
    });
    await flush(true);
    console.log(`Scan tier ${tier} selesai: ${done}/${list.length}`);
  } catch (e) { console.log('scan error', e); }
  finally { if (isA) SCAN.runningA = false; else SCAN.runningB = false; }
}
async function ensureScans() {
  const snap = await loadSnap();
  const now = Date.now();
  if (now - (snap.A.ts || 0) > TTL_A && !SCAN.runningA) scanTier('A');
  if (now - (snap.B.ts || 0) > TTL_B && !SCAN.runningB) scanTier('B');
  return snap;
}
// Jadwal latar belakang — hemat CPU free tier (riwayat: */10+hourly menghabiskan kuota bulanan)
try {
  Deno.cron('scan-tier-a', '*/30 * * * *', () => scanTier('A'));   // 174 likuid tiap 30 menit
  Deno.cron('scan-tier-b', '7 */6 * * *', () => scanTier('B'));    // seluruh pasar tiap 6 jam (±02,08,14,20 WIB)
} catch (e) { console.log('cron tidak tersedia di lingkungan ini:', e.message); }

// Kick pemindaian segera saat isolate menyala (tidak menunggu request pertama)
ensureScans().catch(() => {});

/* ---------------- handler API ---------------- */
const VALID_RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', 'ytd', '1y', '2y', '5y', 'max']);
const VALID_INTERVALS = new Set(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo']);

function sendJson(obj, code = 200) {
  return new Response(JSON.stringify(obj), {
    status: code,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
    },
  });
}

async function apiChart(u) {
  const symbol = normSymbol(u.searchParams.get('symbol'));
  const range = VALID_RANGES.has(u.searchParams.get('range')) ? u.searchParams.get('range') : '6mo';
  const interval = VALID_INTERVALS.has(u.searchParams.get('interval')) ? u.searchParams.get('interval') : '1d';
  if (!symbol) return sendJson({ error: 'Parameter symbol wajib diisi' }, 400);
  const data = await yahooCached(`c:${symbol}:${range}:${interval}`, 60000,
    `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`);
  return sendJson(data);
}

async function apiSearch(u) {
  const q = String(u.searchParams.get('q') || '').trim();
  if (!q) return sendJson({ quotes: [] });
  try {
    const data = await yahooCached('s:' + q.toLowerCase(), 5 * 60000,
      `/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0&lang=id-ID&region=ID`);
    const quotes = (data.quotes || [])
      .filter(x => x.exchange === 'JKT' || String(x.symbol).endsWith('.JK') || String(x.symbol).startsWith('^JK'))
      .map(x => {
        const uni = UNI_MAP.get(String(x.symbol).replace(/\.JK$/, ''));
        return {
          symbol: x.symbol,
          name: uni ? uni.name : (x.longname || x.shortname || x.symbol),
          type: x.quoteType === 'INDEX' ? 'Indeks' : x.quoteType === 'ETF' ? 'ETF' : 'Saham',
          exchange: x.exchDisp || x.exchange || 'IDX',
          sector: uni ? uni.sector : null,
        };
      });
    if (quotes.length) return sendJson({ quotes });
    throw new Error('kosong');
  } catch (e) {
    const ql = q.toLowerCase();
    const local = [...INDICES.map(i => ({ ...i, sector: null })), ...UNIVERSE]
      .filter(s => s.symbol.toLowerCase().includes(ql) || s.name.toLowerCase().includes(ql))
      .slice(0, 20)
      .map(s => ({ symbol: s.symbol, name: s.name, type: s.symbol.startsWith('^') ? 'Indeks' : 'Saham', exchange: 'IDX (lokal)', sector: s.sector || null }));
    return sendJson({ quotes: local });
  }
}

async function getQuote(entry) {
  const sym = normSymbol(entry.symbol);
  const data = await yahooCached('q:' + sym, 25000,
    `/v8/finance/chart/${encodeURIComponent(sym)}?range=3mo&interval=1d&includePrePost=false`);
  const r = data.chart && data.chart.result && data.chart.result[0];
  if (!r) throw new Error('data kosong');
  const meta = r.meta || {};
  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const closes = (q.close || []).filter(v => v != null);
  if (!closes.length) throw new Error('close kosong');
  const price = meta.regularMarketPrice ?? closes[closes.length - 1];
  let prev = closes.length > 1 ? closes[closes.length - 2] : (meta.chartPreviousClose ?? price);
  if (prev == null || prev === 0) prev = price;
  const vols = (q.volume || []).filter(v => v != null);
  return {
    symbol: entry.symbol, name: entry.name || meta.shortName || entry.symbol,
    price, prevClose: prev, change: price - prev,
    changePct: prev ? ((price - prev) / prev) * 100 : 0,
    volume: vols.length ? vols[vols.length - 1] : null,
    spark: closes.slice(-30),
    dayHigh: meta.regularMarketDayHigh ?? null, dayLow: meta.regularMarketDayLow ?? null,
    wk52High: meta.fiftyTwoWeekHigh ?? null, wk52Low: meta.fiftyTwoWeekLow ?? null,
    longName: meta.longName || entry.name, time: meta.regularMarketTime || null, synthetic: false,
  };
}

async function apiWatchlist() {
  const rows = await mapLimit([...INDICES.map(i => ({ ...i })), ...WATCHLIST], 6, async (e) => {
    try { return await getQuote(e); }
    catch (err) { return { symbol: e.symbol, name: e.name, error: true }; }
  });
  return sendJson({ data: rows, ts: Date.now() });
}

async function apiQuotes(u) {
  const syms = String(u.searchParams.get('symbols') || '').split(',').map(s => s.trim()).filter(Boolean).slice(0, 60);
  if (!syms.length) return sendJson({ error: 'Parameter symbols wajib diisi' }, 400);
  const known = new Map([...INDICES.map(i => ({ ...i })), ...WATCHLIST, ...UNIVERSE].map(s => [s.symbol, s]));
  const rows = await mapLimit(syms, 6, async (s) => {
    const e = known.get(s) || known.get(s.replace(/\.JK$/, '')) || { symbol: s, name: s };
    try { return await getQuote(e); } catch (err) { return { symbol: e.symbol, name: e.name, error: true }; }
  });
  return sendJson({ data: rows, ts: Date.now() });
}

async function apiSignals(u, force) {
  let kick = false;
  if (force === '1') { // paksa scan ulang
    if (!SCAN.runningA) scanTier('A');
    if (!SCAN.runningB) scanTier('B');
    kick = true;
  } else {
    ensureScans(); // fire-and-forget; cron tetap tulang punggung jadwal
  }
  const snap = await loadSnap();
  const rows = Object.values(snap.rows);
  return sendJson({
    data: rows,
    ts: Date.now(),
    total: TIER_A.length + TIER_B.length,
    scanned: rows.length,
    tierA: { done: snap.A.done || 0, total: TIER_A.length, running: SCAN.runningA, ts: snap.A.ts || 0 },
    tierB: { done: snap.B.done || 0, total: TIER_B.length, running: SCAN.runningB, ts: snap.B.ts || 0 },
    kick,
  });
}

async function apiOrderBlocks(u) {
  let syms = String(u.searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 60);
  if (!syms.length) syms = TIER_A.map(s => s.symbol);
  const known = new Map(TIER_A.map(s => [s.symbol, s]));
  const rows = await mapLimit(syms, 6, async (s) => {
    const e = known.get(s) || { symbol: s, name: (UNI_MAP.get(s.replace(/\.JK$/, '')) || {}).name || s };
    try {
      const { bars, validTs, meta } = await getDailyBars(e.symbol);
      const gmt = meta.gmtoffset != null ? meta.gmtoffset : GMT_WIB;
      const det = TALib.detectOrderBlocks(bars);
      const map = (ob) => ({
        type: ob.type, top: ob.top, bottom: ob.bottom,
        formedTs: validTs[ob.formedIndex] != null ? validTs[ob.formedIndex] : null,
        formedTime: validTs[ob.formedIndex] != null ? toJakartaDate(validTs[ob.formedIndex], gmt) : null,
        broken: !!ob.breaker,
        breakTime: ob.breaker && validTs[ob.breakIndex] != null ? toJakartaDate(validTs[ob.breakIndex], gmt) : null,
        volume: ob.volume || null,
      });
      const obs = [...det.bullish.map(map), ...det.bearish.map(map)]
        .filter(x => x.formedTs != null).sort((a, b) => b.formedTs - a.formedTs).slice(0, 12);
      return { symbol: e.symbol.replace(/\.JK$/, ''), name: e.name, obs };
    } catch (err) {
      return { symbol: e.symbol.replace(/\.JK$/, ''), name: e.name, obs: [], error: String(err.message || err) };
    }
  });
  return sendJson({ data: rows, ts: Date.now() });
}

/* ---------------- static & SPA fallback ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const pubRoot = new URL('./public/', import.meta.url);
async function serveStatic(p) {
  if (p === '/') p = '/index.html';
  if (p.includes('..')) return new Response('Forbidden', { status: 403 });
  const tryRead = async (rel) => {
    try { return await Deno.readFile(new URL(rel.slice(1), pubRoot)); } catch (e) { return null; }
  };
  let buf = await tryRead(p);
  if (!buf) { p = '/index.html'; buf = await tryRead(p); } // SPA fallback
  if (!buf) return new Response('Not Found', { status: 404 });
  const ext = p.slice(p.lastIndexOf('.')).toLowerCase();
  const cc = (ext === '.html' || ext === '.js' || ext === '.webmanifest') ? 'no-store' : 'public, max-age=3600';
  return new Response(buf, { headers: { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cc } });
}

/* ---------------- router utama ---------------- */
Deno.serve(async (req) => {
  const u = new URL(req.url);
  try {
    switch (u.pathname) {
      case '/api/chart': return await apiChart(u);
      case '/api/search': return await apiSearch(u);
      case '/api/watchlist': return await apiWatchlist();
      case '/api/quotes': return await apiQuotes(u);
      case '/api/signals': return await apiSignals(u, u.searchParams.get('force'));
      case '/api/emax': return apiEmax(u);
      case '/api/orderblocks': return await apiOrderBlocks(u);
      case '/api/health': ensureScans(); return sendJson({ ok: true, ts: Date.now() });
      default:
        if (u.pathname.startsWith('/api/')) return sendJson({ error: 'Endpoint tidak ditemukan' }, 404);
        return await serveStatic(u.pathname);
    }
  } catch (e) {
    return sendJson({ error: String(e.message || e) }, 500);
  }
});
console.log('DR Leo Martin IDX (Deno Deploy) siap.');
