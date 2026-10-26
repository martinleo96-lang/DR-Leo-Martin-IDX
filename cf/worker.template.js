/* ============================================================
   DR Leo Martin IDX — versi CLOUDFLARE WORKERS (cadangan)
   Satu file: UI statis + API + pemindai terjadwal (cron).
   Kuota gratis Cloudflare: 100rb req/hari (reset harian), cron
   minimal 1 menit, KV 1rb tulis/hari. JANGAN edit file ini
   langsung — dihasilkan oleh: node cf/build-worker.js
   ============================================================ */

const FILES = /*__FILES__*/;          // UI statis (teks/base64 + mime)
const UNI = /*__UNI__*/;              // [ [simbol, nama, sektor], ... ] — 845 saham
const LIQ = new Set(/*__LIQ__*/);     // daftar 174 saham likuid
const INDICES = [
  ['^JKSE', 'IDX Composite (IHSG)'], ['^JKLQ45', 'IDX LQ45'],
];

/* Kodifikasi mesin TA bersama (UMD → globalThis.TALib) */
/*__TALIB__*/
const TALib = globalThis.TALib;

const YF_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const UA = { 'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36', Accept: 'application/json' };
const GMT_WIB = 25200;
const toJakartaDate = (tsSec, gmt) => new Date((tsSec + (gmt ?? GMT_WIB)) * 1000).toISOString().slice(0, 10);
const normSymbol = (s) => { s = String(s).toUpperCase().trim(); return (s.startsWith('^') || s.includes('.')) ? s : s + '.JK'; };
const JLIVE = { '1d': 15, '5d': 60, '1mo': 300, '3mo': 300, '6mo': 300, 'ytd': 300, '1y': 900, '2y': 900, '5y': 1800 };

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const jres = (obj, code = 200) => new Response(JSON.stringify(obj), {
  status: code,
  headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders },
});

/* ---------- Yahoo fetcher ---------- */
const memCache = new Map(); // per isolate: tampung sebentar agar tidak boros subrequest
async function yahooJson(pathname, ttlSec = 0) {
  const now = Date.now();
  if (ttlSec) {
    const h = memCache.get(pathname);
    if (h && now - h.t < ttlSec * 1000) return h.d;
  }
  let lastErr = null;
  for (const host of YF_HOSTS) {
    try {
      const r = await fetch(host + pathname, {
        headers: UA, signal: AbortSignal.timeout(12000),
        cf: ttlSec ? { cacheTtl: ttlSec, cacheEverything: true } : undefined,
      });
      if (r.status === 429) { lastErr = new Error('Rate limit Yahoo (429)'); continue; }
      if (!r.ok) { lastErr = new Error('Yahoo HTTP ' + r.status); continue; }
      const d = await r.json();
      if (ttlSec) memCache.set(pathname, { t: now, d });
      return d;
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('Yahoo tidak menjawab');
}

/* ---------- bar harian 1 tahun ---------- */
async function getDailyBars(symInput) {
  const sym = normSymbol(symInput);
  const data = await yahooJson(`/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d&includePrePost=false`, 60);
  const r = data.chart && data.chart.result && data.chart.result[0];
  if (!r) throw new Error('data kosong');
  const meta = r.meta || {};
  const ts = r.timestamp || [];
  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const bars = [];
  for (let i = 0; i < ts.length; i++) {
    const o = q.open && q.open[i], h = q.high && q.high[i], l = q.low && q.low[i], c = q.close && q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    bars.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: (q.volume && q.volume[i]) || 0 });
  }
  if (!bars.length) throw new Error('bar kosong');
  return { bars, meta };
}

/* ---------- sinyal per simbol (identik versi Node/Deno) ---------- */
async function buildSignalRow(entry) {
  const { bars, meta } = await getDailyBars(entry.s);
  if (bars.length < 60) throw new Error('bar kurang dari 60');
  const rating = TALib.computeRatings(bars);
  if (!rating) throw new Error('rating kosong');
  const closes = bars.map(b => b.close);
  const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : closes[closes.length - 1];
  const prev = closes.length > 1 ? closes[closes.length - 2] : price;
  const isIdx = String(entry.s).startsWith('^');
  const risk = isIdx ? null : TALib.classifyRisk(bars, { liquid: LIQ.has(entry.s) });
  const emax = TALib.emaCrossNow(bars);
  const vfx = isIdx ? null : TALib.vixFix(bars);
  return {
    symbol: entry.s, name: entry.n, price,
    changePct: prev ? ((price - prev) / prev) * 100 : 0,
    score: +rating.score.toFixed(3), label: TALib.labelOf(rating.score),
    buys: rating.b, sells: rating.s, neutrals: rating.n, total: rating.total,
    oscScore: +rating.oscS.score.toFixed(3), maScore: +rating.maS.score.toFixed(3),
    sector: entry.sec || null,
    risk: risk ? risk.code : null, riskNote: risk ? risk.note : null,
    emaxBuy: emax.buy, emaxSell: emax.sell,
    vfxB: !!(vfx && vfx.bottom), vfxT: !!(vfx && vfx.top),
    vol: bars[bars.length - 1].volume || 0,
    val: Math.round(price * (bars[bars.length - 1].volume || 0)),
    synthetic: false,
  };
}
const mkEntry = (u) => ({ s: u[0], n: u[1], sec: u[2] || null });
const TIER_A = [...INDICES.map(i => ({ s: i[0], n: i[1] })), ...UNI.filter(u => LIQ.has(u[0])).map(mkEntry)];
const TIER_B = UNI.filter(u => !LIQ.has(u[0])).map(mkEntry);
const SCAN_ORDER = [...TIER_A, ...TIER_B]; // indeks+likuid di depan

/* ---------- Snapshot di KV (satu kunci, JSON) ---------- */
const SNAP_KEY = 'state';
async function loadSnap(env) {
  if (!env.SNAP) return { rows: {}, cursor: 0, tsA: 0, tsB: 0 };
  try { return (await env.SNAP.get(SNAP_KEY, 'json')) || { rows: {}, cursor: 0, tsA: 0, tsB: 0 }; }
  catch (e) { return { rows: {}, cursor: 0, tsA: 0, tsB: 0 }; }
}
async function saveSnap(env, snap) {
  if (!env.SNAP) return;
  try { await env.SNAP.put(SNAP_KEY, JSON.stringify(snap)); } catch (e) {}
}

/* Batch scan kecil per invokasi (CPU free 10ms, koneksi serentak 6,
   subrequest 50) — cursor berputar: indeks+likuid dulu, lalu sisanya. */
const BATCH = 5, CONCUR = 4;
async function scanBatch(env) {
  const snap = await loadSnap(env);
  const start = snap.cursor || 0;
  const batch = SCAN_ORDER.slice(start, start + BATCH);
  const reachedEnd = start + BATCH >= SCAN_ORDER.length;
  const rowsAtStartTierA = start < TIER_A.length; // batch ini masih bagian lapis likuid?

  const list = batch.length ? batch : SCAN_ORDER.slice(0, BATCH);
  const out = await Promise.all(list.map(async (entry) => {
    try { return await buildSignalRow(entry); }
    catch (e) { return { symbol: entry.s, name: entry.n, error: true, msg: String(e.message || e) }; }
  }));
  for (const r of out) snap.rows[r.symbol] = r;

  snap.cursor = reachedEnd ? 0 : start + BATCH;
  if (rowsAtStartTierA) snap.tsA = Date.now();         // tandai lapis likuid disegarkan
  if (reachedEnd) snap.tsB = Date.now();               // satu siklus penuh selesai
  if (!snap.ts) snap.ts = Date.now();
  await saveSnap(env, snap);
  return { done: list.map(r => r.s), cursor: snap.cursor };
}

/* Watchlist 50 populer (identik server.js) */
const WATCHLIST = [
  ['BBCA', 'Bank Central Asia'], ['BBRI', 'Bank Rakyat Indonesia'], ['BMRI', 'Bank Mandiri'],
  ['BBNI', 'Bank Negara Indonesia'], ['BRIS', 'Bank Syariah Indonesia'], ['BNGA', 'Bank CIMB Niaga'],
  ['BBTN', 'Bank Tabungan Negara'], ['NISP', 'Bank OCBC NISP'], ['BFIN', 'BFI Finance Indonesia'],
  ['TLKM', 'Telkom Indonesia'], ['EXCL', 'XL Axiata'], ['ISAT', 'Indosat Ooredoo Hutchison'],
  ['GOTO', 'GoTo Gojek Tokopedia'], ['ARTO', 'Bank Jago'], ['BUKA', 'Bukalapak'],
  ['ASII', 'Astra International'], ['UNVR', 'Unilever Indonesia'], ['ICBP', 'Indofood CBP'],
  ['INDF', 'Indofood'], ['KLBF', 'Kalbe Farma'], ['DNET', 'Indoritel Makmur'],
  ['AMMN', 'Amman Mineral Internasional'], ['TPIA', 'Chandra Asri Pacific'],
  ['BRPT', 'Barito Pacific'], ['CPIN', 'Charoen Pokphand Indonesia'], ['JPFA', 'Japfa Comfeed'],
  ['PGAS', 'Perusahaan Gas Negara'], ['ACES', 'Aspirasi Hidup Indonesia (ACE)'],
  ['AMRT', 'Sumber Alfaria Trijaya'], ['MAPI', 'Mitra Adiperkasa'], ['ANTM', 'Aneka Tambang'],
  ['ADRO', 'Adaro Energy Indonesia'], ['ITMG', 'Indo Tambangraya Megah'], ['PTBA', 'Bukit Asam'],
  ['UNTR', 'United Tractors'], ['ADHI', 'Adhi Karya'], ['WSKT', 'Waskita Karya'],
  ['WIKA', 'Wijaya Karya'], ['JSMR', 'Jasa Marga'], ['CPRA', 'Coalindo Perkasa Raya'],
  ['SILO', 'Siloam International Hospitals'], ['MIKA', 'Mitra Keluarga Karyasehat'],
  ['ERAA', 'Erajaya Swasembada'], ['BFIN', 'BFI Finance Indonesia'], ['SIDO', 'Industri Jamu Sido Muncul'],
  ['HUMI', 'Humpuss Maritim Internasional'], ['ESSA', 'ESSA Industries Indonesia'],
  ['MYOR', 'Mayora Indah'], ['ROTI', 'Nippon Indosari Corpindo'], ['DSNG', 'Dharma Satya Nusantara'],
];
const uniqWl = (() => {
  const seen = new Set();
  return WATCHLIST.filter((w) => { if (seen.has(w[0])) return false; seen.add(w[0]); return true; });
})();

async function quoteOf(sym) {
  const data = await yahooJson(`/v8/finance/chart/${encodeURIComponent(sym)}?range=5d&interval=1d`, 45);
  const r = data.chart && data.chart.result && data.chart.result[0];
  if (!r) throw new Error('kosong');
  const meta = r.meta || {};
  const closes = ((r.indicators.quote[0].close) || []).filter(x => x != null);
  const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : closes.pop();
  const prev = meta.chartPreviousClose != null ? meta.chartPreviousClose : closes[closes.length - 1];
  return {
    price, prevClose: prev != null ? prev : price,
    spark: closes.slice(-40),
    dayHigh: meta.regularMarketDayHigh ?? null, dayLow: meta.regularMarketDayLow ?? null,
    volume: meta.regularMarketVolume ?? null,
  };
}
async function chartToQuote(sym, name, extra = {}) {
  try {
    const q = await quoteOf(sym);
    const chg = q.prevClose ? ((q.price - q.prevClose) / q.prevClose) * 100 : 0;
    return { symbol: sym.replace('.JK', ''), name, price: q.price, changePct: chg, spark: q.spark, ...extra };
  } catch (e) { return { symbol: sym, name, error: true }; }
}

/* ============================================================ */
export default {
  async fetch(req, env, ctx) {
    const u = new URL(req.url);
    const p = u.pathname;

    if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

    try {
      if (p === '/api/health') {
        const snap = await loadSnap(env);
        return jres({ ok: true, ts: Date.now(), coverage: Object.keys(snap.rows || {}).length, kv: !!env.SNAP });
      }
      if (p === '/api/search') {
        const q = (u.searchParams.get('q') || '').toUpperCase();
        if (!q) return jres({ quotes: [] });
        const match = UNI.filter(x => x[0].includes(q) || String(x[1]).toUpperCase().includes(q)).slice(0, 12);
        return jres({ quotes: match.map(x => ({ symbol: x[0] + '.JK', name: x[1], type: 'Saham', exchange: 'Jakarta', sector: x[2] || null })) });
      }
      if (p === '/api/watchlist') {
        const idxRows = await Promise.all(INDICES.map(i => chartToQuote(i[0], i[1], { index: true })));
        const out = [...idxRows];
        const chunk = 40; // batas subrequest Cloudflare (50) per batch
        for (let i = 0; i < uniqWl.length; i += chunk) {
          const part = await Promise.all(uniqWl.slice(i, i + chunk).map(w => chartToQuote(w[0], w[1])));
          out.push(...part);
        }
        return jres({ data: out, ts: Date.now() });
      }
      if (p === '/api/quotes') {
        const syms = String(u.searchParams.get('symbols') || '').split(/[,\s]+/).filter(Boolean).slice(0, 40);
        if (!syms.length) return jres({ error: 'Parameter symbols wajib diisi' }, 400);
        const rows = await Promise.all(syms.map(async (s0) => {
          const s = normSymbol(s0);
          try {
            const q = await quoteOf(s);
            return { symbol: s.replace('.JK', ''), price: q.price, prevClose: q.prevClose, dayHigh: q.dayHigh, dayLow: q.dayLow, volume: q.volume, spark: q.spark };
          } catch (e) { return { symbol: s.replace('.JK', ''), error: true }; }
        }));
        return jres({ data: rows, ts: Date.now() });
      }
      if (p === '/api/chart') {
        const sym = u.searchParams.get('symbol') || '';
        if (!sym) return jres({ error: 'Parameter symbol wajib diisi' }, 400);
        const range = u.searchParams.get('range') || '6mo';
        const interval = u.searchParams.get('interval') || '1d';
        if (!JLIVE[range] && !['1d','5d'].includes(range)) return jres({ error: 'Range tidak dikenal' }, 400);
        const ttl = JLIVE[range] || 120;
        const data = await yahooJson(`/v8/finance/chart/${encodeURIComponent(normSymbol(sym))}?range=${range}&interval=${interval}&includePrePost=false`, ttl);
        return new Response(JSON.stringify(data), {
          headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...corsHeaders },
        });
      }
      if (p === '/api/signals') {
        const snap = await loadSnap(env);
        const rows = Object.values(snap.rows || {});
        // Segarkan di latar saat ku nampak basi (>25 mnt) — waitUntil hitung di luar respons
        const stale = !snap.tsA || (Date.now() - snap.tsA > 25 * 60000);
        if (stale && env.SNAP) ctx.waitUntil(scanBatch(env).catch(() => {}));
        return jres({
          data: rows, ts: snap.tsB || snap.tsA || 0,
          total: SCAN_ORDER.length, scanned: rows.length,
          tierA: { done: Math.min(snap.cursor || 0, TIER_A.length), total: TIER_A.length, running: false, ts: snap.tsA || 0 },
          tierB: { done: Math.max(0, (snap.cursor || 0) - TIER_A.length), total: TIER_B.length, running: false, ts: snap.tsB || 0 },
          kick: stale,
        });
      }
      if (p === '/api/orderblocks') {
        const sym = u.searchParams.get('symbol') || '';
        if (!sym) return jres({ error: 'Parameter symbol wajib diisi' }, 400);
        try {
          const { bars } = await getDailyBars(sym);
          const obs = TALib.detectOrderBlocks(bars);
          const isIdx = sym.startsWith('^');
          const risk = isIdx ? null : TALib.classifyRisk(bars, { liquid: LIQ.has(sym.replace('.JK', '')) });
          return jres({ data: [{ symbol: sym.replace('.JK', ''), obs, risk: risk ? risk.code : null, riskNote: risk ? risk.note : null, bars: bars.length }], ts: Date.now() });
        } catch (e) { return jres({ data: [], error: String(e.message || e) }, 200); }
      }

      /* ---- file statis / SPA ---- */
      let f = FILES[p] || FILES['/index.html']; // SPA fallback
      const noStore = /\.(html|js|webmanifest)$/.test(p) || p === '/';
      const base = { 'Content-Type': f.mime, 'Cache-Control': noStore ? 'no-store' : 'public, max-age=3600', ...corsHeaders };
      if (f.b) {
        const bin = Uint8Array.from(atob(f.b), c => c.charCodeAt(0));
        return new Response(bin, { headers: base });
      }
      return new Response(f.t, { headers: base });
    } catch (e) {
      return jres({ error: String(e.message || e) }, 500);
    }
  },

  /* Cron: per batch kecil tiap 2 menit (atur di dashboard Triggers) */
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scanBatch(env).catch(() => {}));
  },
};
