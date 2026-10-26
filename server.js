'use strict';
/**
 * ============================================================
 *  DR Leo Martin IDX — Server
 *  Aplikasi chart saham Indonesia (mirip TradingView)
 *
 *  - Proxy data Yahoo Finance untuk saham .JK & indeks ^JKSE
 *  - Static hosting untuk frontend (public/)
 *  - Tanpa dependency eksternal (Node.js >= 18, fetch bawaan)
 *  - Fallback data simulasi bila koneksi ke Yahoo Finance gagal
 * ============================================================
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
// Mesin teknikal bersama (sama persis dengan yang dipakai frontend)
const TALib = require('./public/ta-lib.js');

const PORT = Number(process.env.PORT || 3000);
const PUBLIC_DIR = path.join(__dirname, 'public');
const GMT_WIB = 7 * 3600; // detik

const YF_HOSTS = [
  'https://query1.finance.yahoo.com',
  'https://query2.finance.yahoo.com',
];
const UA = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  Accept: 'application/json,text/plain,*/*',
  'Accept-Language': 'id-ID,id;q=0.9,en;q=0.8',
};

/* ------------------------------------------------------------
 * Daftar indeks & saham populer BEI (LQ45 / blue chip)
 * ---------------------------------------------------------- */
const INDICES = [
  { symbol: '^JKSE', name: 'IHSG — Indeks Harga Saham Gabungan' },
  { symbol: '^JKLQ45', name: 'Indeks LQ45' },
];

const STOCKS = [
  { symbol: 'BBCA', name: 'Bank Central Asia Tbk' },
  { symbol: 'BBRI', name: 'Bank Rakyat Indonesia (Persero) Tbk' },
  { symbol: 'BMRI', name: 'Bank Mandiri (Persero) Tbk' },
  { symbol: 'BBNI', name: 'Bank Negara Indonesia (Persero) Tbk' },
  { symbol: 'BRIS', name: 'Bank Syariah Indonesia Tbk' },
  { symbol: 'ARTO', name: 'Bank Jago Tbk' },
  { symbol: 'BBYB', name: 'Bank Neo Commerce Tbk' },
  { symbol: 'TLKM', name: 'Telkom Indonesia (Persero) Tbk' },
  { symbol: 'ISAT', name: 'Indosat Tbk' },
  { symbol: 'EXCL', name: 'XLSMART Telecom Sejahtera Tbk' },
  { symbol: 'ASII', name: 'Astra International Tbk' },
  { symbol: 'UNVR', name: 'Unilever Indonesia Tbk' },
  { symbol: 'ICBP', name: 'Indofood CBP Sukses Makmur Tbk' },
  { symbol: 'INDF', name: 'Indofood Sukses Makmur Tbk' },
  { symbol: 'KLBF', name: 'Kalbe Farma Tbk' },
  { symbol: 'MYOR', name: 'Mayora Indah Tbk' },
  { symbol: 'GGRM', name: 'Gudang Garam Tbk' },
  { symbol: 'HMSP', name: 'H.M. Sampoerna Tbk' },
  { symbol: 'SMGR', name: 'Semen Indonesia (Persero) Tbk' },
  { symbol: 'INTP', name: 'Indocement Tunggal Prakarsa Tbk' },
  { symbol: 'ADRO', name: 'Alamtri Resources Indonesia Tbk' },
  { symbol: 'PTBA', name: 'Bukit Asam Tbk' },
  { symbol: 'ITMG', name: 'Indo Tambangraya Megah Tbk' },
  { symbol: 'UNTR', name: 'United Tractors Tbk' },
  { symbol: 'ANTM', name: 'Aneka Tambang Tbk' },
  { symbol: 'INCO', name: 'Vale Indonesia Tbk' },
  { symbol: 'MDKA', name: 'Merdeka Copper Gold Tbk' },
  { symbol: 'BRPT', name: 'Barito Pacific Tbk' },
  { symbol: 'BREN', name: 'Barito Renewables Energy Tbk' },
  { symbol: 'CUAN', name: 'Petrindo Jaya Kreasi Tbk' },
  { symbol: 'AMMN', name: 'Amman Mineral Internasional Tbk' },
  { symbol: 'TPIA', name: 'Chandra Asri Pacific Tbk' },
  { symbol: 'PGAS', name: 'Perusahaan Gas Negara Tbk' },
  { symbol: 'MEDC', name: 'Medco Energi Internasional Tbk' },
  { symbol: 'ESSA', name: 'ESSA Industries Indonesia Tbk' },
  { symbol: 'GOTO', name: 'GoTo Gojek Tokopedia Tbk' },
  { symbol: 'BUKA', name: 'Bukalapak.com Tbk' },
  { symbol: 'EMTK', name: 'Elang Mahkota Teknologi Tbk' },
  { symbol: 'AMRT', name: 'Sumber Alfaria Trijaya Tbk' },
  { symbol: 'ACES', name: 'Aspirasi Hidup Indonesia Tbk' },
  { symbol: 'CPIN', name: 'Charoen Pokphand Indonesia Tbk' },
  { symbol: 'JPFA', name: 'Japfa Comfeed Indonesia Tbk' },
  { symbol: 'SIDO', name: 'Industri Jamu & Farmasi Sido Muncul Tbk' },
  { symbol: 'TOWR', name: 'Sarana Menara Nusantara Tbk' },
  { symbol: 'TBIG', name: 'Tower Bersama Infrastructure Tbk' },
  { symbol: 'CTRA', name: 'Ciputra Development Tbk' },
  { symbol: 'PWON', name: 'Pakuwon Jati Tbk' },
  { symbol: 'SMRA', name: 'Summarecon Agung Tbk' },
  { symbol: 'JSMR', name: 'Jasa Marga (Persero) Tbk' },
  { symbol: 'GIAA', name: 'Garuda Indonesia (Persero) Tbk' },
];

/* ------------------------------------------------------------
 * SELURUH SAHAM IDX (845 emiten) + subset likuid (174)
 * Sumber daftar: symbols.js (kurasi dari github.com/sendiptjr/idx-screener)
 *  - TIER_A: indeks + 174 saham likuid → dipindai tiap 10 menit
 *  - TIER_B: sisa seluruh emiten     → dipindai tiap 60 menit
 * ---------------------------------------------------------- */
const { UNIVERSE, LIQUID } = require('./symbols.js');
const UNI_MAP = new Map(UNIVERSE.map(u => [u.symbol, u]));
const LIQUID_ENTRIES = UNIVERSE.filter(u => LIQUID.has(u.symbol));
const TIER_A = [...INDICES.map(i => ({ symbol: i.symbol, name: i.name, index: true })), ...LIQUID_ENTRIES];
const TIER_B = UNIVERSE.filter(u => !LIQUID.has(u.symbol));

/* Harga dasar untuk mode simulasi (hanya dipakai bila Yahoo Finance tidak bisa dihubungi) */
const BASE_PRICE = {
  BBCA: 10100, BBRI: 4550, BMRI: 6900, BBNI: 5100, BRIS: 2800, ARTO: 2900, BBYB: 1500,
  TLKM: 3050, ISAT: 2300, EXCL: 2150, ASII: 5200, UNVR: 2750, ICBP: 10900, INDF: 7300,
  KLBF: 1400, MYOR: 2350, GGRM: 13300, HMSP: 640, SMGR: 3500, INTP: 7500, ADRO: 2400,
  PTBA: 2700, ITMG: 25000, UNTR: 24000, ANTM: 1650, INCO: 3800, MDKA: 2500, BRPT: 1400,
  BREN: 9000, CUAN: 11000, AMMN: 9500, TPIA: 8800, PGAS: 1550, MEDC: 1200, ESSA: 850,
  GOTO: 70, BUKA: 130, EMTK: 550, AMRT: 2550, ACES: 750, CPIN: 4900, JPFA: 1500,
  SIDO: 700, TOWR: 690, TBIG: 1950, CTRA: 990, PWON: 400, SMRA: 950, JSMR: 4200, GIAA: 75,
  '^JKSE': 7300, '^JKLQ45': 850,
};

/* ------------------------------------------------------------
 * Cache sederhana (in-memory, TTL per key)
 * ---------------------------------------------------------- */
const cache = new Map(); // key -> { t, data }
function cacheGet(key, ttlMs) {
  const h = cache.get(key);
  return h && Date.now() - h.t < ttlMs ? h.data : null;
}
function cacheSet(key, data) {
  if (cache.size > 800) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
  cache.set(key, { t: Date.now(), data });
}
function cacheStale(key) {
  const h = cache.get(key);
  return h ? h.data : null;
}

/* ------------------------------------------------------------
 * Fetch ke Yahoo Finance dengan retry antar-host
 * ---------------------------------------------------------- */
async function yahooJson(pathname) {
  let lastErr = null;
  for (const host of YF_HOSTS) {
    try {
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), 12000);
      const r = await fetch(host + pathname, { headers: UA, signal: ctrl.signal });
      clearTimeout(to);
      if (r.status === 429) { lastErr = new Error('Rate limit Yahoo Finance (429)'); continue; }
      if (!r.ok) { lastErr = new Error('Yahoo Finance HTTP ' + r.status); continue; }
      return await r.json();
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('Gagal menghubungi Yahoo Finance');
}

async function yahooCached(key, ttlMs, pathname) {
  const hit = cacheGet(key, ttlMs);
  if (hit) return hit;
  try {
    const d = await yahooJson(pathname);
    cacheSet(key, d);
    return d;
  } catch (e) {
    const stale = cacheStale(key);
    if (stale) return stale;
    throw e;
  }
}

/* ------------------------------------------------------------
 * Helper simbol
 * ---------------------------------------------------------- */
function normSymbol(s) {
  s = String(s || '').trim().toUpperCase();
  if (!s) return '';
  if (s.startsWith('^') || s.includes('.')) return s;
  return s + '.JK';
}
function toJakartaDate(tsSec, gmtOffset) {
  return new Date((tsSec + (gmtOffset ?? GMT_WIB)) * 1000).toISOString().slice(0, 10);
}
function todayJakarta() {
  return new Date(Date.now() + GMT_WIB * 1000).toISOString().slice(0, 10);
}

/* ------------------------------------------------------------
 * Generator data simulasi (fallback bila Yahoo tidak terjangkau)
 * Deterministik per simbol+tanggal supaya stabil saat refresh.
 * ---------------------------------------------------------- */
function hash32(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function tickRound(p) {
  if (p < 200) return Math.max(1, Math.round(p));
  if (p < 500) return Math.round(p / 2) * 2;
  if (p < 2000) return Math.round(p / 5) * 5;
  if (p < 5000) return Math.round(p / 10) * 10;
  return Math.round(p / 25) * 25;
}

function synthChart(symbol, range, interval) {
  const isIndex = symbol.startsWith('^');
  const disp = symbol.replace(/\.JK$/, '');
  const base = BASE_PRICE[disp] || BASE_PRICE[symbol] || (isIndex ? 7300 : 1000);
  const rnd = mulberry32(hash32(symbol + '|' + range + '|' + interval + '|' + todayJakarta()));

  const intraday = /m$|h$/.test(interval);
  const times = [];
  const nowUtc = Math.floor(Date.now() / 1000);
  const nowWib = nowUtc + GMT_WIB;

  if (intraday) {
    let mins = parseInt(interval, 10);
    if (interval === '1h') mins = 60;
    if (interval === '90m') mins = 90;
    if (!isFinite(mins) || mins <= 0) mins = 15;
    const nDays = range === '1d' ? 1 : range === '5d' ? 5 : 22;
    const step = mins * 60;
    const todayWibMid = nowWib - (nowWib % 86400);
    outer:
    for (let d = nDays - 1; d >= 0; d--) {
      let dayMid = todayWibMid - d * 86400;
      const wd = new Date(dayMid * 1000).getUTCDay();
      if (wd === 0 || wd === 6) continue;
      const open = dayMid + 9 * 3600;
      const close = dayMid + 15 * 3600;
      for (let t = open; t < close; t += step) {
        const tsUtc = t - GMT_WIB;
        if (tsUtc > nowUtc && d === 0) break outer;
        times.push(tsUtc);
      }
    }
  } else {
    const perDay = interval === '1wk' ? 7 : interval === '1mo' ? 30 : 1;
    const count =
      range === '5d' ? 5 : range === '1mo' ? 22 : range === '3mo' ? 66 :
      range === '6mo' ? 130 : range === '1y' ? 252 : range === '2y' ? 504 :
      range === 'ytd' ? 200 : range === '5y' ? 260 : 500;
    let t = nowWib - (nowWib % 86400) + 9 * 3600;
    let added = 0;
    while (added < count && times.length < 2000) {
      const wd = new Date((t - (t % 86400)) * 1000).getUTCDay();
      if (wd !== 0 && wd !== 6) { times.unshift(t - GMT_WIB); added++; }
      t -= perDay * 86400;
    }
  }

  // random walk
  let price = base * (0.82 + rnd() * 0.1);
  const open = [], high = [], low = [], close = [], volume = [];
  const volBase = isIndex ? 0 : 5e6 + rnd() * 4e7;
  const vola = intraday ? 0.0035 : 0.016;
  for (let i = 0; i < times.length; i++) {
    const drift = (rnd() - 0.5) * 2 * vola;
    const o = price;
    let c = o * (1 + drift);
    const h = Math.max(o, c) * (1 + rnd() * vola * 0.6);
    const l = Math.min(o, c) * (1 - rnd() * vola * 0.6);
    if (isIndex) {
      open.push(+o.toFixed(2)); close.push(+c.toFixed(2));
      high.push(+h.toFixed(2)); low.push(+l.toFixed(2));
    } else {
      open.push(tickRound(o)); close.push(tickRound(c));
      high.push(tickRound(h)); low.push(tickRound(l));
    }
    volume.push(isIndex ? null : Math.round(volBase * (0.4 + rnd() * 1.6)));
    price = c;
  }

  const lastClose = close[close.length - 1] || base;
  const prevClose = close.length > 1 ? close[close.length - 2] : lastClose;
  const entry = STOCKS.find(s => s.symbol === disp);
  const idxEntry = INDICES.find(s => s.symbol === symbol);
  return {
    chart: {
      result: [{
        meta: {
          currency: 'IDR',
          symbol,
          exchangeName: isIndex ? 'SNP' : 'JKT',
          fullExchangeName: isIndex ? 'Jakarta' : 'Jakarta',
          instrumentType: isIndex ? 'INDEX' : 'EQUITY',
          regularMarketPrice: lastClose,
          chartPreviousClose: prevClose,
          gmtoffset: GMT_WIB,
          timezone: 'WIB',
          exchangeTimezoneName: 'Asia/Jakarta',
          longName: entry ? entry.name : idxEntry ? idxEntry.name : disp,
          shortName: disp,
          regularMarketDayHigh: Math.max(...high),
          regularMarketDayLow: Math.min(...low),
          regularMarketVolume: volume[volume.length - 1] || 0,
          dataGranularity: interval,
          range,
          synthetic: true,
        },
        timestamp: times,
        indicators: { quote: [{ open, high, low, close, volume }] },
      }],
      error: null,
    },
  };
}

/* ------------------------------------------------------------
 * Handler API
 * ---------------------------------------------------------- */
const VALID_RANGES = new Set(['1d', '5d', '1mo', '3mo', '6mo', 'ytd', '1y', '2y', '5y', 'max']);
const VALID_INTERVALS = new Set(['1m', '2m', '5m', '15m', '30m', '60m', '90m', '1h', '1d', '5d', '1wk', '1mo']);

async function handleChart(u, res) {
  const symbol = normSymbol(u.searchParams.get('symbol'));
  const range = VALID_RANGES.has(u.searchParams.get('range')) ? u.searchParams.get('range') : '6mo';
  const interval = VALID_INTERVALS.has(u.searchParams.get('interval')) ? u.searchParams.get('interval') : '1d';
  if (!symbol) return sendJson(res, 400, { error: 'Parameter symbol wajib diisi' });

  try {
    const data = await yahooCached(
      `c:${symbol}:${range}:${interval}`,
      60000,
      `/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false&events=div%2Csplit`
    );
    if (data.chart && data.chart.error) throw new Error(data.chart.error.description || 'Simbol tidak ditemukan');
    sendJson(res, 200, data);
  } catch (e) {
    // Fallback simulasi supaya aplikasi tetap bisa dipakai
    const syn = synthChart(symbol, range, interval);
    syn.chart.result[0].meta.fallbackReason = String(e.message || e);
    sendJson(res, 200, syn);
  }
}

async function handleSearch(u, res) {
  const q = String(u.searchParams.get('q') || '').trim();
  if (!q) return sendJson(res, 200, { quotes: [] });
  try {
    const data = await yahooCached(
      's:' + q.toLowerCase(), 5 * 60000,
      `/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=15&newsCount=0&lang=id-ID&region=ID`
    );
    const quotes = (data.quotes || [])
      .filter(x => x.exchange === 'JKT' || String(x.symbol).endsWith('.JK') || String(x.symbol).startsWith('^JK'))
      .map(x => {
        const bare = String(x.symbol).replace(/\.JK$/, '');
        const uni = UNI_MAP.get(bare);
        return {
          symbol: x.symbol,
          name: uni ? uni.name : (x.longname || x.shortname || x.symbol),
          type: x.quoteType === 'INDEX' ? 'Indeks' : x.quoteType === 'ETF' ? 'ETF' : 'Saham',
          exchange: x.exchDisp || x.exchange || 'IDX',
          sector: uni ? uni.sector : null,
        };
      });
    if (quotes.length) return sendJson(res, 200, { quotes });
    throw new Error('kosong');
  } catch (e) {
    // Fallback: cari di daftar lokal (seluruh 845 emiten IDX)
    const ql = q.toLowerCase();
    const local = [
      ...INDICES.map(i => ({ symbol: i.symbol, name: i.name, sector: null })),
      ...UNIVERSE,
    ]
      .filter(s => s.symbol.toLowerCase().includes(ql) || s.name.toLowerCase().includes(ql))
      .slice(0, 20)
      .map(s => ({ symbol: s.symbol, name: s.name, type: s.symbol.startsWith('^') ? 'Indeks' : 'Saham', exchange: 'IDX (lokal)', sector: s.sector || null }));
    sendJson(res, 200, { quotes: local });
  }
}

/* Konkurensi terbatas untuk mengambil banyak quote sekaligus */
async function mapLimit(arr, n, fn) {
  const out = new Array(arr.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(n, arr.length) }, async () => {
    while (i < arr.length) {
      const k = i++;
      out[k] = await fn(arr[k], k);
    }
  });
  await Promise.all(workers);
  return out;
}

async function getQuote(entry) {
  const sym = normSymbol(entry.symbol);
  try {
    const data = await yahooCached(
      'q:' + sym, 25000,
      `/v8/finance/chart/${encodeURIComponent(sym)}?range=3mo&interval=1d&includePrePost=false`
    );
    const r = data.chart && data.chart.result && data.chart.result[0];
    if (!r) throw new Error('data kosong');
    const meta = r.meta || {};
    const ts = r.timestamp || [];
    const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
    const closes = (q.close || []).filter(v => v != null);
    if (!closes.length) throw new Error('close kosong');
    const price = meta.regularMarketPrice ?? closes[closes.length - 1];
    // Perubahan harian = harga terkini vs penutupan hari perdagangan sebelumnya
    let prev = closes.length > 1 ? closes[closes.length - 2]
      : meta.chartPreviousClose != null ? meta.chartPreviousClose : price;
    if (prev == null || prev === 0) prev = price;
    const vols = (q.volume || []).filter(v => v != null);
    return {
      symbol: entry.symbol,
      name: entry.name || meta.shortName || entry.symbol,
      price,
      prevClose: prev,
      change: price - prev,
      changePct: prev ? ((price - prev) / prev) * 100 : 0,
      volume: vols.length ? vols[vols.length - 1] : null,
      spark: closes.slice(-30),
      dayHigh: meta.regularMarketDayHigh ?? null,
      dayLow: meta.regularMarketDayLow ?? null,
      wk52High: meta.fiftyTwoWeekHigh ?? null,
      wk52Low: meta.fiftyTwoWeekLow ?? null,
      longName: meta.longName || entry.name,
      time: meta.regularMarketTime || null,
      synthetic: false,
    };
  } catch (e) {
    // Fallback simulasi untuk satu quote
    const disp = entry.symbol.replace(/\.JK$/, '');
    const base = BASE_PRICE[disp] || BASE_PRICE[entry.symbol] || 1000;
    const rnd = mulberry32(hash32(entry.symbol + '|' + todayJakarta()));
    const prev = tickRound(base * (0.97 + rnd() * 0.06));
    const price = tickRound(prev * (0.985 + rnd() * 0.03));
    const spark = [];
    let p = prev;
    for (let i = 0; i < 30; i++) { spark.unshift(tickRound(p)); p = p * (0.99 + rnd() * 0.02); }
    return {
      symbol: entry.symbol, name: entry.name, price, prevClose: prev,
      change: price - prev, changePct: prev ? ((price - prev) / prev) * 100 : 0,
      volume: Math.round(5e6 + rnd() * 3e7), spark, synthetic: true,
    };
  }
}

async function handleWatchlist(u, res) {
  const list = [...INDICES, ...STOCKS];
  const rows = await mapLimit(list, 6, getQuote);
  sendJson(res, 200, { data: rows, ts: Date.now() });
}

async function handleQuotes(u, res) {
  const raw = String(u.searchParams.get('symbols') || '');
  const syms = raw.split(',').map(s => s.trim()).filter(Boolean).slice(0, 60);
  if (!syms.length) return sendJson(res, 400, { error: 'Parameter symbols wajib diisi' });
  const known = new Map([...INDICES, ...STOCKS].map(s => [s.symbol, s]));
  const rows = await mapLimit(syms, 6, s => getQuote(known.get(s) || { symbol: s, name: s }));
  sendJson(res, 200, { data: rows, ts: Date.now() });
}

/* ------------------------------------------------------------
 * BARS_DB: bar harian hasil pindai (di memori) + /api/emax —
 * alert EMA cross dengan periode yang BISA DIUBAH pengguna.
 * ---------------------------------------------------------- */
const BARS_DB = new Map(); // symbol -> [{time,open,high,low,close,volume}]

/* Cross EMA satu pasang (kedua arah) pada bar harian */
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
    return age <= 5 ? { age, t: bars[at].time || null } : null; // segar ≤ 5 hari bursa
  };
  return { buy: mk(buyAt), sell: mk(sellAt) };
}

/* /api/emax — BUY memakai pasangan EMA-nya sendiri (bawaan 3×7 cross NAIK),
   SELL memakai pasangan sendiri (bawaan 2×6 cross TURUN) — sesuai skema awal app */
async function handleEmax(u, res) {
  const p = (k, d, lo, hi) => Math.min(hi, Math.max(lo, parseInt(u.searchParams.get(k), 10) || d));
  const fastB = p('fastB', p('fast', 3, 2, 200), 2, 200);
  const slowB = p('slowB', p('slow', 7, 3, 300), 3, 300);
  const fastS = p('fastS', 2, 2, 200);
  const slowS = p('slowS', 6, 3, 300);
  if (fastB >= slowB) return sendJson(res, 400, { error: 'BUY: EMA cepat harus lebih kecil dari EMA lambat.' });
  if (fastS >= slowS) return sendJson(res, 400, { error: 'SELL: EMA cepat harus lebih kecil dari EMA lambat.' });
  const out = [];
  for (const [sym, bars] of BARS_DB) {
    if (sym.startsWith('^')) continue;
    const closesReady = bars && bars.length >= 10;
    if (!closesReady) continue;
    const rB = computeEmaxCross(bars, fastB, slowB).buy;
    const rS = computeEmaxCross(bars, fastS, slowS).sell;
    if (!rB && !rS) continue;
    const entry = UNI_MAP.get(sym);
    const last = bars[bars.length - 1], prv = bars.length > 1 ? bars[bars.length - 2].close : last.close;
    const base = {
      symbol: sym,
      name: entry ? entry.name : sym,
      sector: entry && entry.sector ? entry.sector : null,
      price: last.close,
      changePct: prv ? ((last.close - prv) / prv) * 100 : 0,
    };
    if (rB) out.push({ ...base, dir: 'BUY', age: rB.age, t: rB.t });
    if (rS) out.push({ ...base, dir: 'SELL', age: rS.age, t: rS.t });
  }
  const rank = { BUY: 0, SELL: 1 };
  out.sort((a, b) => rank[a.dir] - rank[b.dir] || a.age - b.age || (b.changePct - a.changePct));
  sendJson(res, 200, {
    data: out, total: out.length, coverage: BARS_DB.size, ts: Date.now(),
    buy: { fast: fastB, slow: slowB }, sell: { fast: fastS, slow: slowS },
  });
}

/* ------------------------------------------------------------
 * Sinyal teknikal (Strong Buy … Strong Sell) untuk semua simbol
 * Rating dihitung dari data harian 1 tahun, cache 5 menit.
 * ---------------------------------------------------------- */
async function getSignal(entry) {
  const sym = normSymbol(entry.symbol);
  try {
    const data = await yahooCached(
      'sig:' + sym, 5 * 60000,
      `/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d&includePrePost=false`
    );
    const r = data.chart && data.chart.result && data.chart.result[0];
    if (!r) throw new Error('data kosong');
    const meta = r.meta || {};
    const ts = r.timestamp || [];
    const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
    const bars = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open && q.open[i], h = q.high && q.high[i],
            l = q.low && q.low[i], c = q.close && q.close[i];
      if (o == null || h == null || l == null || c == null) continue;
      bars.push({ time: ts[i], open: o, high: h, low: l, close: c, volume: (q.volume && q.volume[i]) || 0 });
    }
    if (bars.length < 60) throw new Error('bar kurang dari 60');
    BARS_DB.set(entry.symbol, bars); // simpan bar harian utk kotak alert EMA cross kustom
    const rating = TALib.computeRatings(bars);
    if (!rating) throw new Error('rating kosong');
    const closes = bars.map(b => b.close);
    const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : closes[closes.length - 1];
    const prev = closes.length > 1 ? closes[closes.length - 2] : price;
    // Klasifikasi risiko (indeks tidak diklasifikasikan)
    const isIdx = String(entry.symbol).startsWith('^');
    const risk = isIdx ? null : TALib.classifyRisk(bars, { liquid: LIQUID.has(entry.symbol) });
    // Cross EMA pada bar harian terbaru: 3↑7 BUY, 2↓6 SELL
    const emax = TALib.emaCrossNow(bars);
    const kal = TALib.kalmanTrend(bars);
    const vfx = isIdx ? null : TALib.vixFix(bars); // Williams Vix Fix: titik terendah/tertinggi ekstrem
    return {
      symbol: entry.symbol,
      name: entry.name,
      price,
      changePct: prev ? ((price - prev) / prev) * 100 : 0,
      score: +rating.score.toFixed(3),
      label: TALib.labelOf(rating.score),
      buys: rating.b, sells: rating.s, neutrals: rating.n, total: rating.total,
      oscScore: +rating.oscS.score.toFixed(3),
      maScore: +rating.maS.score.toFixed(3),
      sector: entry.sector || null,
      risk: risk ? risk.code : null,
      riskNote: risk ? risk.note : null,
      emaxBuy: emax.buy,
      emaxSell: emax.sell,
      kDir: kal ? kal.dir : null, kFlip: !!(kal && kal.flip),
      kStr: kal ? +kal.strength.toFixed(1) : null,
      vfxB: !!(vfx && vfx.bottom),
      vfxT: !!(vfx && vfx.top),
      vol: (bars.length ? bars[bars.length - 1].volume : 0) || 0,
      val: Math.round(price * ((bars.length ? bars[bars.length - 1].volume : 0) || 0)),
      synthetic: false,
    };
  } catch (e) {
    return { symbol: entry.symbol, name: entry.name, error: true };
  }
}

/* ------------------------------------------------------------
 * Pemindai dua lapis (berjalan di latar belakang):
 *   Tier A (indeks + 174 likuid) tiap 10 menit
 *   Tier B (±671 emiten lainnya) tiap 60 menit
 * /api/signals melayani hasil terakhir secara instan dari cache.
 * ---------------------------------------------------------- */
const SCAN = {
  rows: new Map(), // symbol -> row hasil getSignal
  A: { ts: 0, done: 0, total: TIER_A.length, running: false, ttl: 10 * 60000 },
  B: { ts: 0, done: 0, total: TIER_B.length, running: false, ttl: 60 * 60000 },
};
function scanTier(key, list) {
  const t = SCAN[key];
  if (t.running) return;
  t.running = true;
  t.done = 0;
  mapLimit(list, 6, async (entry) => {
    try {
      const row = await getSignal(entry);
      SCAN.rows.set(entry.symbol, row);
    } catch (e) {}
    t.done++;
  }).catch(() => {}).then(() => {
    t.running = false;
    t.ts = Date.now();
  });
}
function ensureScans() {
  const now = Date.now();
  if (now - SCAN.A.ts > SCAN.A.ttl) scanTier('A', TIER_A);
  if (now - SCAN.B.ts > SCAN.B.ttl) scanTier('B', TIER_B);
}

async function handleSignals(u, res) {
  if (u.searchParams.get('force') === '1') {
    for (const k of [...cache.keys()]) if (k.startsWith('sig:')) cache.delete(k);
    SCAN.A.ts = 0; SCAN.B.ts = 0;
  }
  const tierParam = String(u.searchParams.get('tier') || '').toLowerCase();
  ensureScans();
  let rows = [...SCAN.rows.values()];
  if (tierParam === 'a') rows = rows.filter(r => r.symbol.startsWith('^') || LIQUID.has(r.symbol.replace(/\.JK$/, '')));
  sendJson(res, 200, {
    data: rows,
    ts: Date.now(),
    total: TIER_A.length + TIER_B.length,
    scanned: SCAN.rows.size,
    tierA: { done: SCAN.A.done, total: SCAN.A.total, running: SCAN.A.running, ts: SCAN.A.ts },
    tierB: { done: SCAN.B.done, total: SCAN.B.total, running: SCAN.B.running, ts: SCAN.B.ts },
  });
}

/* ------------------------------------------------------------
 * Order Blocks (SMC) per simbol — data harian 1 tahun
 * Memakai cache 'sig:' yang sama dengan /api/signals.
 * ---------------------------------------------------------- */
async function getOrderBlocksFor(entry) {
  const sym = normSymbol(entry.symbol);
  try {
    const data = await yahooCached(
      'sig:' + sym, 5 * 60000,
      `/v8/finance/chart/${encodeURIComponent(sym)}?range=1y&interval=1d&includePrePost=false`
    );
    const r = data.chart && data.chart.result && data.chart.result[0];
    if (!r) throw new Error('data kosong');
    const meta = r.meta || {};
    const ts = r.timestamp || [];
    const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
    const gmt = meta.gmtoffset != null ? meta.gmtoffset : GMT_WIB;
    const bars = [];
    for (let i = 0; i < ts.length; i++) {
      const o = q.open && q.open[i], h = q.high && q.high[i],
            l = q.low && q.low[i], c = q.close && q.close[i];
      if (o == null || h == null || l == null || c == null) continue;
      bars.push({ open: o, high: h, low: l, close: c, volume: (q.volume && q.volume[i]) || 0 });
    }
    // ts[] tetap sejajar dengan bars[] (hanya bar ber-null OHLC yang dibuang)
    const validTs = ts.filter((_, i) => {
      const o = q.open && q.open[i], h = q.high && q.high[i],
            l = q.low && q.low[i], c = q.close && q.close[i];
      return !(o == null || h == null || l == null || c == null);
    });
    const det = TALib.detectOrderBlocks(bars);
    const map = (ob) => ({
      type: ob.type,
      top: ob.top,
      bottom: ob.bottom,
      formedTs: validTs[ob.formedIndex] != null ? validTs[ob.formedIndex] : null,
      formedTime: validTs[ob.formedIndex] != null ? toJakartaDate(validTs[ob.formedIndex], gmt) : null,
      broken: !!ob.breaker,
      breakTime: ob.breaker && validTs[ob.breakIndex] != null ? toJakartaDate(validTs[ob.breakIndex], gmt) : null,
      volume: ob.volume || null,
    });
    const obs = [...det.bullish.map(map), ...det.bearish.map(map)]
      .filter(x => x.formedTs != null)
      .sort((a, b) => b.formedTs - a.formedTs)
      .slice(0, 12);
    return { symbol: entry.symbol.replace(/\.JK$/, ''), name: entry.name, obs };
  } catch (e) {
    return { symbol: entry.symbol.replace(/\.JK$/, ''), name: entry.name, obs: [], error: String(e.message || e) };
  }
}

async function handleOrderBlocks(u, res) {
  let syms = String(u.searchParams.get('symbols') || '')
    .split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 60);
  // Tanpa param → indeks + 174 saham likuid (dipakai PWA background sync)
  if (!syms.length) syms = TIER_A.map(s => s.symbol);
  const known = new Map(TIER_A.map(s => [s.symbol, s]));
  const rows = await mapLimit(syms, 6, s => getOrderBlocksFor(known.get(s) || { symbol: s, name: UNI_MAP.get(s.replace(/\.JK$/, ''))?.name || s }));
  sendJson(res, 200, { data: rows, ts: Date.now() });
}

/* ------------------------------------------------------------
 * Util HTTP
 * ---------------------------------------------------------- */
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(body);
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function serveStatic(u, res) {
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const norm = path.normalize(p).replace(/^(\.\.[/\\])+/, '');
  let file = path.join(PUBLIC_DIR, norm);
  if (!file.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) {
      // SPA fallback ke index.html untuk path non-file
      file = path.join(PUBLIC_DIR, 'index.html');
    }
    const ext = path.extname(file).toLowerCase();
    fs.readFile(file, (e, buf) => {
      if (e) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, {
        'Content-Type': MIME[ext] || 'application/octet-stream',
        'Cache-Control': ext === '.html' || ext === '.js' || ext === '.webmanifest' ? 'no-store' : 'public, max-age=3600',
      });
      res.end(buf);
    });
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost');
  try {
    if (u.pathname === '/api/chart') return await handleChart(u, res);
    if (u.pathname === '/api/search') return await handleSearch(u, res);
    if (u.pathname === '/api/watchlist') return await handleWatchlist(u, res);
    if (u.pathname === '/api/quotes') return await handleQuotes(u, res);
    if (u.pathname === '/api/signals') return await handleSignals(u, res);
    if (u.pathname === '/api/emax') return await handleEmax(u, res);
    if (u.pathname === '/api/orderblocks') return await handleOrderBlocks(u, res);
    if (u.pathname === '/api/health') return sendJson(res, 200, { ok: true, ts: Date.now() });
    if (u.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Endpoint tidak ditemukan' });
    return serveStatic(u, res);
  } catch (e) {
    sendJson(res, 500, { error: String(e.message || e) });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`DR Leo Martin IDX berjalan di http://0.0.0.0:${PORT}`);
  // Mulai memindai seluruh pasar di latar belakang
  ensureScans();
  setInterval(ensureScans, 30000);
});
