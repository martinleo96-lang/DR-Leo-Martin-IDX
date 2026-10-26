/* ============================================================
   ta-lib.js — Mesin indikator & rating teknikal bersama
   Dipakai oleh browser (frontend) DAN Node.js (server /api/signals)
   UMD: window.TALib di browser, module.exports di Node.
   ============================================================ */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.TALib = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

/* ---------- seri berbasis bars → [{time, value}] ---------- */
function emaArr(bars, period, field = 'close') {
  const k = 2 / (period + 1); const out = []; let e = null;
  for (let i = 0; i < bars.length; i++) {
    const v = bars[i][field];
    if (e == null) {
      if (i >= period - 1) {
        let s = 0;
        for (let j = i - period + 1; j <= i; j++) s += bars[j][field];
        e = s / period;
        out.push({ time: bars[i].time, value: e });
      }
    } else {
      e = v * k + e * (1 - k);
      out.push({ time: bars[i].time, value: e });
    }
  }
  return out;
}
function rsiArr(bars, period = 14) {
  if (bars.length <= period) return [];
  const out = []; let g = 0, l = 0;
  for (let i = 1; i <= period; i++) { const d = bars[i].close - bars[i - 1].close; if (d >= 0) g += d; else l -= d; }
  let avgG = g / period, avgL = l / period;
  out.push({ time: bars[period].time, value: avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL) });
  for (let i = period + 1; i < bars.length; i++) {
    const d = bars[i].close - bars[i - 1].close;
    avgG = (avgG * (period - 1) + (d > 0 ? d : 0)) / period;
    avgL = (avgL * (period - 1) + (d < 0 ? -d : 0)) / period;
    out.push({ time: bars[i].time, value: avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL) });
  }
  return out;
}
function macdArr(bars, fast = 12, slow = 26, signal = 9) {
  const f = emaArr(bars, fast), s = emaArr(bars, slow);
  const fMap = new Map(f.map(x => [String(x.time), x.value]));
  const macdPts = [];
  for (const p of s) {
    const fv = fMap.get(String(p.time));
    if (fv != null) macdPts.push({ time: p.time, value: fv - p.value });
  }
  const k = 2 / (signal + 1);
  const sig = [], hist = [];
  let e = null, warm = [];
  for (const p of macdPts) {
    if (e == null) {
      warm.push(p.value);
      if (warm.length === signal) {
        e = warm.reduce((a, b) => a + b, 0) / signal;
        sig.push({ time: p.time, value: e });
        hist.push({ time: p.time, value: p.value - e });
      }
    } else {
      e = p.value * k + e * (1 - k);
      sig.push({ time: p.time, value: e });
      hist.push({ time: p.time, value: p.value - e });
    }
  }
  return { macd: macdPts.slice(macdPts.length - sig.length), signal: sig, hist };
}

/* ---------- seri berbasis array nilai ---------- */
function smaOn(v, p) {
  const o = new Array(v.length).fill(null); let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= p) s -= v[i - p];
    if (i >= p - 1) o[i] = s / p;
  }
  return o;
}
function emaOn(v, p) {
  const o = new Array(v.length).fill(null); const k = 2 / (p + 1); let e = null;
  for (let i = 0; i < v.length; i++) {
    if (e == null) {
      if (i === p - 1) { let s = 0; for (let j = 0; j < p; j++) s += v[j]; e = s / p; o[i] = e; }
    } else { e = v[i] * k + e * (1 - k); o[i] = e; }
  }
  return o;
}
function wmaOn(v, p) {
  const o = new Array(v.length).fill(null);
  const den = (p * (p + 1)) / 2;
  for (let i = p - 1; i < v.length; i++) {
    let num = 0;
    for (let j = 0; j < p; j++) num += v[i - j] * (p - j);
    o[i] = num / den;
  }
  return o;
}
function vwmaOn(c, v, p) {
  const o = new Array(c.length).fill(null);
  for (let i = p - 1; i < c.length; i++) {
    let n1 = 0, n2 = 0, sc = 0;
    for (let j = 0; j < p; j++) { n1 += c[i - j] * v[i - j]; n2 += v[i - j]; sc += c[i - j]; }
    o[i] = n2 > 0 ? n1 / n2 : sc / p;
  }
  return o;
}
function hullOn(c, p) {
  const n = c.length;
  const half = wmaOn(c, Math.max(1, Math.round(p / 2)));
  const full = wmaOn(c, p);
  const raw = new Array(n).fill(null);
  for (let i = 0; i < n; i++) if (half[i] != null && full[i] != null) raw[i] = 2 * half[i] - full[i];
  const s0 = raw.findIndex(x => x != null);
  if (s0 < 0) return new Array(n).fill(null);
  const sub = raw.slice(s0);
  const w = wmaOn(sub, Math.max(1, Math.round(Math.sqrt(p))));
  const o = new Array(n).fill(null);
  for (let i = 0; i < w.length; i++) o[s0 + i] = w[i];
  return o;
}
function stochRaw(h, l, c, k = 14, d = 3) {
  const n = c.length;
  const K = new Array(n).fill(null);
  for (let i = k - 1; i < n; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = 0; j < k; j++) { hh = Math.max(hh, h[i - j]); ll = Math.min(ll, l[i - j]); }
    K[i] = hh > ll ? (100 * (c[i] - ll)) / (hh - ll) : 50;
  }
  const D = new Array(n).fill(null);
  for (let i = k - 1 + d - 1; i < n; i++) {
    let s = 0;
    for (let j = 0; j < d; j++) s += K[i - j];
    D[i] = s / d;
  }
  return { k: K, d: D };
}
function cciRaw(bars, p = 20) {
  const n = bars.length;
  const tp = bars.map(b => (b.high + b.low + b.close) / 3);
  const s = smaOn(tp, p);
  const o = new Array(n).fill(null);
  for (let i = p - 1; i < n; i++) {
    let md = 0;
    for (let j = 0; j < p; j++) md += Math.abs(tp[i - j] - s[i]);
    md /= p;
    o[i] = md ? (tp[i] - s[i]) / (0.015 * md) : 0;
  }
  return o;
}
function aoRaw(h, l) {
  const n = h.length;
  const med = h.map((x, i) => (x + l[i]) / 2);
  const f = smaOn(med, 5), s = smaOn(med, 34);
  const o = new Array(n).fill(null);
  for (let i = 0; i < n; i++) if (f[i] != null && s[i] != null) o[i] = f[i] - s[i];
  return o;
}
function willrRaw(h, l, c, p = 14) {
  const o = new Array(c.length).fill(null);
  for (let i = p - 1; i < c.length; i++) {
    let hh = -Infinity, ll = Infinity;
    for (let j = 0; j < p; j++) { hh = Math.max(hh, h[i - j]); ll = Math.min(ll, l[i - j]); }
    o[i] = hh > ll ? (-100 * (hh - c[i])) / (hh - ll) : 0;
  }
  return o;
}
function bbpRaw(h, l, c) {
  const e = emaOn(c, 13);
  const o = new Array(c.length).fill(null);
  for (let i = 0; i < c.length; i++) if (e[i] != null) o[i] = h[i] - 2 * e[i] + l[i];
  return o;
}
function uoRaw(h, l, c, p1 = 7, p2 = 14, p3 = 28) {
  const n = c.length;
  if (n <= p3) return new Array(n).fill(null);
  const bp = new Array(n).fill(0), tr = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const pc = c[i - 1];
    bp[i] = c[i] - Math.min(l[i], pc);
    tr[i] = Math.max(h[i], pc) - Math.min(l[i], pc);
  }
  const avg = (p, i) => {
    let sb = 0, st = 0;
    for (let j = 0; j < p; j++) { sb += bp[i - j]; st += tr[i - j]; }
    return st ? sb / st : 0;
  };
  const o = new Array(n).fill(null);
  for (let i = p3; i < n; i++) o[i] = (100 * (4 * avg(p1, i) + 2 * avg(p2, i) + avg(p3, i))) / 7;
  return o;
}
function adxRaw(bars, p = 14) {
  const n = bars.length;
  const o = { adx: new Array(n).fill(null), plus: new Array(n).fill(null), minus: new Array(n).fill(null) };
  if (n < 2 * p + 1) return o;
  const tr = new Array(n).fill(0), pdm = new Array(n).fill(0), mdm = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    const up = bars[i].high - bars[i - 1].high;
    const dn = bars[i - 1].low - bars[i].low;
    pdm[i] = up > dn && up > 0 ? up : 0;
    mdm[i] = dn > up && dn > 0 ? dn : 0;
    tr[i] = Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
  }
  let sTr = 0, sP = 0, sM = 0;
  for (let i = 1; i <= p; i++) { sTr += tr[i]; sP += pdm[i]; sM += mdm[i]; }
  const dx = new Array(n).fill(null);
  let pd = sTr ? (100 * sP) / sTr : 0, md = sTr ? (100 * sM) / sTr : 0;
  o.plus[p] = pd; o.minus[p] = md;
  dx[p] = pd + md ? (100 * Math.abs(pd - md)) / (pd + md) : 0;
  for (let i = p + 1; i < n; i++) {
    sTr = sTr - sTr / p + tr[i];
    sP = sP - sP / p + pdm[i];
    sM = sM - sM / p + mdm[i];
    pd = sTr ? (100 * sP) / sTr : 0;
    md = sTr ? (100 * sM) / sTr : 0;
    o.plus[i] = pd; o.minus[i] = md;
    dx[i] = pd + md ? (100 * Math.abs(pd - md)) / (pd + md) : 0;
  }
  let s = 0;
  for (let i = p; i < 2 * p; i++) s += dx[i] || 0;
  o.adx[2 * p - 1] = s / p;
  for (let i = 2 * p; i < n; i++) o.adx[i] = (o.adx[i - 1] * (p - 1) + (dx[i] || 0)) / p;
  return o;
}

/* ---------- rating gabungan (25 indikator) ---------- */
const lastOf = (a) => (a && a.length ? a[a.length - 1].value : null);
const lastRaw = (a) => (a && a.length ? a[a.length - 1] : null);

function computeRatings(bars) {
  const n = bars.length;
  if (!n) return null;
  const C = bars[n - 1].close;
  const c = bars.map(b => b.close), h = bars.map(b => b.high),
        l = bars.map(b => b.low), v = bars.map(b => b.volume || 0);
  const osc = [], ma = [];
  const add = (list, name, val, sig) => { if (val != null && !isNaN(val)) list.push({ name, val, sig }); };
  const s3 = (val, lo, hi) => (val == null ? 'neutral' : val < lo ? 'buy' : val > hi ? 'sell' : 'neutral');
  const sgn = (val) => (val == null ? 'neutral' : val > 0 ? 'buy' : val < 0 ? 'sell' : 'neutral');
  const cmp = (m) => (m == null ? 'neutral' : C > m ? 'buy' : C < m ? 'sell' : 'neutral');

  // Osilator
  const r = lastOf(rsiArr(bars, 14));
  add(osc, 'RSI (14)', r, s3(r, 30, 70));
  const sk = stochRaw(h, l, c, 14, 3);
  add(osc, 'Stoch. %K (14,3,3)', lastRaw(sk.k), s3(lastRaw(sk.k), 20, 80));
  const cc = lastRaw(cciRaw(bars, 20));
  add(osc, 'CCI (20)', cc, s3(cc, -100, 100));
  const ax = adxRaw(bars, 14);
  const a = lastRaw(ax.adx), pd = lastRaw(ax.plus), md = lastRaw(ax.minus);
  add(osc, 'ADX (14)', a, a == null ? 'neutral' : a < 25 ? 'neutral' : pd > md ? 'buy' : 'sell');
  const ao = lastRaw(aoRaw(h, l));
  add(osc, 'Awesome Oscillator', ao, sgn(ao));
  const mo = n > 10 ? c[n - 1] - c[n - 1 - 10] : null;
  add(osc, 'Momentum (10)', mo, sgn(mo));
  const mv = lastOf(macdArr(bars).macd);
  add(osc, 'MACD (12,26)', mv, sgn(mv));
  const wr = lastRaw(willrRaw(h, l, c, 14));
  add(osc, 'Williams %R (14)', wr, s3(wr, -80, -20));
  const bb2 = lastRaw(bbpRaw(h, l, c));
  add(osc, 'Bull Bear Power', bb2, sgn(bb2));
  const uo = lastRaw(uoRaw(h, l, c));
  add(osc, 'Ultimate Oscillator', uo, s3(uo, 30, 70));

  // Moving Average
  for (const p of [10, 20, 30, 50, 100, 200]) {
    const e = emaOn(c, p)[n - 1];
    if (e != null) add(ma, `EMA (${p})`, e, cmp(e));
    const s = smaOn(c, p)[n - 1];
    if (s != null) add(ma, `SMA (${p})`, s, cmp(s));
  }
  const vw = vwmaOn(c, v, 20)[n - 1];
  if (vw != null) add(ma, 'VWMA (20)', vw, cmp(vw));
  const hu = hullOn(c, 9)[n - 1];
  if (hu != null) add(ma, 'Hull MA (9)', hu, cmp(hu));
  if (n >= 26) {
    const base = (Math.max(...h.slice(-26)) + Math.min(...l.slice(-26))) / 2;
    add(ma, 'Ichimoku Base (9,26,52)', base, cmp(base));
  }

  const summ = (list) => {
    const b = list.filter(x => x.sig === 'buy').length;
    const s = list.filter(x => x.sig === 'sell').length;
    return { b, s, n: list.length - b - s, score: list.length ? (b - s) / list.length : 0 };
  };
  const all = [...osc, ...ma];
  const sm = summ(all);
  return { osc, ma, total: all.length, ...sm, oscS: summ(osc), maS: summ(ma), score: sm.score };
}

function labelOf(score) {
  if (score >= 0.5) return 'Strong Buy';
  if (score >= 0.1) return 'Buy';
  if (score <= -0.5) return 'Strong Sell';
  if (score <= -0.1) return 'Sell';
  return 'Neutral';
}

/* ---------- Order Blocks (port of "Volumized Order Blocks | Flux Charts") ----------
   Deteksi swing (pivot) → pembentukan OB saat swing ditembus close,
   filter ukuran zona ≤ ATR(10) × atrMult, invalidasi berbasis wick
   (OB berubah menjadi "breaker" lalu dihapus bila tertembus penuh). */
function detectOrderBlocks(bars, opts) {
  const o = Object.assign({ swingLength: 10, atrPeriod: 10, atrMult: 3.5, maxOrderBlocks: 30 }, opts || {});
  const n = bars.length;
  const len = Math.max(3, o.swingLength | 0);
  const ap = Math.max(1, o.atrPeriod | 0);
  const res = { bullish: [], bearish: [] };
  if (!n || n < len + 5) return res;

  const high = bars.map(b => b.high), low = bars.map(b => b.low),
        close = bars.map(b => b.close), vol = bars.map(b => b.volume || 0);

  // ATR — ta.atr() memakai RMA (smoothing Wilder)
  const atr = new Array(n).fill(null);
  let a = 0, sum = 0;
  for (let i = 1; i < n; i++) {
    const tr = Math.max(high[i] - low[i], Math.abs(high[i] - close[i - 1]), Math.abs(low[i] - close[i - 1]));
    if (i <= ap) { sum += tr; if (i === ap) { a = sum / ap; atr[i] = a; } }
    else { a = (a * (ap - 1) + tr) / ap; atr[i] = a; }
  }

  let swingType = 0;
  let top = { x: -1, y: NaN, crossed: true };
  let btm = { x: -1, y: NaN, crossed: true };

  for (let i = 0; i < n; i++) {
    // ---- deteksi swing (findOBSwings) ----
    if (i >= len) {
      let upper = -Infinity, lower = Infinity;
      for (let j = i - len + 1; j <= i; j++) {
        if (high[j] > upper) upper = high[j];
        if (low[j] < lower) lower = low[j];
      }
      const prev = swingType;
      const hLen = high[i - len], lLen = low[i - len];
      // perhatian: kondisi Pine dievaluasi berurutan (bukan else-if)
      swingType = hLen > upper ? 0 : lLen < lower ? 1 : swingType;
      if (swingType === 0 && prev !== 0) top = { x: i - len, y: hLen, crossed: false };
      if (swingType === 1 && prev !== 1) btm = { x: i - len, y: lLen, crossed: false };
    }

    // ---- invalidasi bullish OB (Wick) ----
    for (let k = res.bullish.length - 1; k >= 0; k--) {
      const ob = res.bullish[k];
      if (!ob.breaker) {
        if (low[i] < ob.bottom) { ob.breaker = true; ob.breakIndex = i; ob.breakVolume = vol[i]; }
      } else if (high[i] > ob.top) res.bullish.splice(k, 1);
    }

    // ---- formasi bullish OB (close menembus swing high) ----
    if (!top.crossed && top.x >= 0 && close[i] > top.y && i - top.x >= 2 && i >= 2 && atr[i] != null) {
      top.crossed = true;
      let boxBtm = high[i - 1], boxTop = low[i - 1], boxLoc = i - 1;
      for (let k = 1; k <= i - top.x - 1; k++) {
        const ii = i - k;
        boxBtm = Math.min(low[ii], boxBtm);
        if (boxBtm === low[ii]) { boxTop = high[ii]; boxLoc = ii; }
      }
      const size = Math.abs(boxTop - boxBtm);
      if (size > 0 && size <= atr[i] * o.atrMult) {
        res.bullish.unshift({
          type: 'bull', top: boxTop, bottom: boxBtm,
          startIndex: boxLoc, formedIndex: i,
          volume: vol[i] + vol[i - 1] + vol[i - 2],
          volUp: vol[i] + vol[i - 1],
          volDown: vol[i - 2],
          breaker: false, breakIndex: null,
        });
        if (res.bullish.length > o.maxOrderBlocks) res.bullish.pop();
      }
    }

    // ---- invalidasi bearish OB (Wick) ----
    for (let k = res.bearish.length - 1; k >= 0; k--) {
      const ob = res.bearish[k];
      if (!ob.breaker) {
        if (high[i] > ob.top) { ob.breaker = true; ob.breakIndex = i; ob.breakVolume = vol[i]; }
      } else if (low[i] < ob.bottom) res.bearish.splice(k, 1);
    }

    // ---- formasi bearish OB (close menembus swing low) ----
    if (!btm.crossed && btm.x >= 0 && close[i] < btm.y && i - btm.x >= 2 && i >= 2 && atr[i] != null) {
      btm.crossed = true;
      let boxBtm = low[i - 1], boxTop = high[i - 1], boxLoc = i - 1;
      for (let k = 1; k <= i - btm.x - 1; k++) {
        const ii = i - k;
        boxTop = Math.max(high[ii], boxTop);
        if (boxTop === high[ii]) { boxBtm = low[ii]; boxLoc = ii; }
      }
      const size = Math.abs(boxTop - boxBtm);
      if (size > 0 && size <= atr[i] * o.atrMult) {
        res.bearish.unshift({
          type: 'bear', top: boxTop, bottom: boxBtm,
          startIndex: boxLoc, formedIndex: i,
          volume: vol[i] + vol[i - 1] + vol[i - 2],
          volUp: vol[i - 2],
          volDown: vol[i] + vol[i - 1],
          breaker: false, breakIndex: null,
        });
        if (res.bearish.length > o.maxOrderBlocks) res.bearish.pop();
      }
    }
  }
  return res;
}

/* ============================================================
   KLASIFIKASI RISIKO SAHAM INDONESIA (dari bar harian 1 tahun)
     💎 unggulan : likuid & stabil (anggota daftar likuid kurasi)
     ⚠️ high risk: volatilitas tinggi (ATR% besar / sering ARA-ARB)
     🔥 gorengan : harga rendah, tipis, atau lonjakan volume tak wajar
     ✅ reguler  : di luar kriteria di atas
   ============================================================ */
function medianOf(arr) {
  const a = arr.filter(v => isFinite(v)).sort((x, y) => x - y);
  const n = a.length;
  return n ? (n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2) : 0;
}
function classifyRisk(bars, opts = {}) {
  if (!bars || bars.length < 20) return { code: 'reguler', note: 'Data terbatas' };
  const n = bars.length;
  const closes = bars.map(b => b.close);
  const price = closes[n - 1];
  // ATR% Wilder 14
  let atr = 0;
  if (n > 15) {
    const tr = (i) => Math.max(
      bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i - 1].close),
      Math.abs(bars[i].low - bars[i - 1].close)
    );
    for (let i = n - 14; i < n; i++) atr += tr(i);
    atr /= 14;
  }
  const atrPct = price ? (atr / price) * 100 : 0;
  // median nilai transaksi harian (Rp) 20 hari terakhir
  const avgVal = medianOf(bars.slice(-20).map(b => b.close * (b.volume || 0)));
  // hari tanpa volume dalam 90 hari terakhir
  const last90 = bars.slice(-90);
  const zeroVolPct = (last90.filter(b => !b.volume).length / last90.length) * 100;
  // rasio lonjakan volume (maks vs median) 60 hari terakhir
  const last60 = bars.slice(-60);
  const medV = Math.max(1, medianOf(last60.map(b => b.volume || 0)));
  const spike = Math.max(...last60.map(b => b.volume || 0)) / medV;
  // jumlah hari ARA/ARB (|perubahan| >= 12%) dalam setahun data
  let ara = 0;
  for (let i = 1; i < n; i++) {
    const chg = ((closes[i] - closes[i - 1]) / closes[i - 1]) * 100;
    if (Math.abs(chg) >= 12) ara++;
  }
  const m = {
    price,
    avgVal: Math.round(avgVal),
    atrPct: +atrPct.toFixed(2),
    zeroVolPct: +zeroVolPct.toFixed(1),
    ara,
    spike: +spike.toFixed(1),
  };
  // Saham dengan nilai transaksi ≥ Rp 5 M/hari terlalu likuid untuk disebut gorengan
  const sangatLikuid = avgVal >= 5e9;
  if (!sangatLikuid && (
    price <= 100 ||                      // saham sen/receh
    avgVal < 1e8 ||                      // nilai transaksi < Rp 100 jt/hari (saham tidur)
    zeroVolPct >= 25 ||                  // sering tidak ada transaksi sama sekali
    (price <= 200 && avgVal < 5e8) ||    // murah + tipis
    (spike >= 20 && price <= 300)        // lonjakan volume tak wajar pada saham kecil
  ))
    return { code: 'gorengan', note: 'Harga rendah / likuiditas tipis / lonjakan volume tak wajar', ...m };
  if (atrPct >= 6 || ara >= 6)
    return { code: 'highrisk', note: `Volatilitas tinggi (ATR ${m.atrPct}%, ARA/ARB ${ara}×)`, ...m };
  if (opts.liquid && sangatLikuid && atrPct <= 5.5)
    return { code: 'unggulan', note: 'Saham likuid & mapan (kelompok unggulan)', ...m };
  return { code: 'reguler', note: 'Saham reguler', ...m };
}

/* Cross EMA pada BAR TERAKHIR (yang sedang berjalan/terbaru):
     BUY  = EMA 3 cross NAIK  EMA 7
     SELL = EMA 2 cross TURUN EMA 6                                    */
function emaCrossNow(bars) {
  const n = bars ? bars.length : 0;
  if (n < 9) return { buy: false, sell: false };
  const closes = bars.map(b => b.close);
  const e3 = emaOn(closes, 3), e7 = emaOn(closes, 7);
  const e2 = emaOn(closes, 2), e6 = emaOn(closes, 6);
  const i = n - 1;
  const buy = e3[i] != null && e3[i - 1] != null && e7[i] != null && e7[i - 1] != null &&
              e3[i - 1] <= e7[i - 1] && e3[i] > e7[i];
  const sell = e2[i] != null && e2[i - 1] != null && e6[i] != null && e6[i - 1] != null &&
               e2[i - 1] >= e6[i - 1] && e2[i] < e6[i];
  return { buy, sell };
}

/* Williams Vix Fix (port Pine "Williams Vix Fix Bottoms & Tops", bar harian):
   bottom = wvfLow menyentuh upper band / persentil-90 → harga di titik TERENDAH ekstrem (kandidat pantul)
   top    = wvfHigh menyentuh lower band / persentil-90 terbalik → harga di titik TERTINGGI ekstrem (waspada puncak) */
function vixFix(bars, pd = 22, bbl = 20, mult = 2.0, lb = 50, ph = 0.85) {
  const n = bars ? bars.length : 0;
  if (n < lb + 3) return null;
  const closes = bars.map(b => b.close), highs = bars.map(b => b.high), lows = bars.map(b => b.low);
  const rollMax = (arr, i, p) => { let m = -Infinity; for (let j = Math.max(0, i - p + 1); j <= i; j++) m = Math.max(m, arr[j]); return m; };
  const rollMin = (arr, i, p) => { let m = Infinity; for (let j = Math.max(0, i - p + 1); j <= i; j++) m = Math.min(m, arr[j]); return m; };
  const wL = new Array(n).fill(null), wH = new Array(n).fill(null);
  for (let i = pd - 1; i < n; i++) {
    const hiC = rollMax(closes, i, pd);
    wL[i] = (hiC - lows[i]) / hiC * 100;
    const loC = rollMin(closes, i, pd);
    wH[i] = (loC - highs[i]) / loC * 100; // selalu negatif (mirip gaya "Highs" di Pine)
  }
  const stats = (arr, i, p) => {
    let s = 0, cnt = 0;
    for (let j = i - p + 1; j <= i; j++) { if (arr[j] != null) { s += arr[j]; cnt++; } }
    if (!cnt) return { mean: 0, sd: 0 };
    const mean = s / cnt;
    let v = 0; for (let j = i - p + 1; j <= i; j++) { if (arr[j] != null) v += (arr[j] - mean) * (arr[j] - mean); }
    return { mean, sd: Math.sqrt(v / cnt) };
  };
  const i = n - 1;

  const stL = stats(wL, i, bbl);
  const upL = stL.mean + mult * stL.sd;
  const rHi = rollMax(wL, i, lb) * ph;
  const bottom = wL[i] >= upL || wL[i] >= rHi;

  const stH = stats(wH, i, bbl);
  const loH = stH.mean - mult * stH.sd;
  const rLo = rollMin(wH, i, lb) * ph; // wH negatif → ×0.85 = kurang negatif (persentil terbalik)
  const top = wH[i] <= loH || wH[i] <= rLo;

  return { bottom, top, bVal: +wL[i].toFixed(1), tVal: +wH[i].toFixed(2) };
}

/* ============================================================
   Adaptive Kalman Filter — Trend Strength Oscillator
   Port setia Pine "Kalman Trend Strength Oscillator (Zeiierman)",
   model PARKINSON-ADJUSTED (noise adaptif dari rentang High–Low;
   aman untuk IDX: volume sering 0 pada saham tidur & indeks).
   Mengembalikan arah tren terkini + apakah arah BERBALIK (flip)
   pada bar terakhir. Parameter = default script asli.
   ============================================================ */
function kalmanTrend(bars, p1 = 0.01, p2 = 0.01, mNoise = 500, n2 = 10, r1 = 10, r2 = 10) {
  const n = bars ? bars.length : 0;
  if (n < n2 + r2 + r1 + 2) return null;

  // State X = [level, velocity]; F = [[1,1],[1,0]] (persis script asli)
  let X0 = bars[0].close, X1 = bars[0].close;
  let P00 = 1, P01 = 0, P10 = 0, P11 = 1;          // P = I
  const norm = [];                                  // seri oscillator/A*100
  const tsSeries = [];                              // trend_strength (WMA r2)
  const oscLine = [];                               // final: WMA r1
  const buf = [];

  const wmaLast = (arr, p) => {
    if (arr.length < p) return null;
    let num = 0, den = 0;
    for (let k = 0; k < p; k++) { const w = k + 1; num += arr[arr.length - p + k] * w; den += w; }
    return num / den;
  };

  for (let i = 0; i < n; i++) {
    const src = bars[i].close;
    if (src == null || !isFinite(src)) continue;

    // --- predict ---
    X0 = X0 + X1; X1 = 0;                           // F[1,1]=0 → vel diprediksi 0 (quirk setia)
    const q01 = p1 * p2;
    const tP00 = P00 + P01 + P10 + P11 + p1;        // F·P·Fᵀ + Q
    const tP01 = P00 + P10 + q01;
    const tP10 = P00 + P01 + q01;
    const tP11 = P00 + p2;
    P00 = tP00; P01 = tP01; P10 = tP10; P11 = tP11;

    // --- noise adaptif Parkinson: R *= (1 + range/prevRange) ---
    let rAdj = mNoise;
    if (i > 2) {
      const cur = bars[i].high - bars[i].low;
      const prev = Math.max(bars[i - 1].high - bars[i - 1].low, 1);
      rAdj = mNoise * (1 + cur / prev);
    }

    // --- update ---
    const S = P00 + rAdj;                           // H·P·Hᵀ + R
    const K0 = P00 / S, K1 = P10 / S;
    const y = src - X0;                             // innovation
    X0 += K0 * y; X1 += K1 * y;
    const uP00 = (1 - K0) * P00, uP01 = (1 - K0) * P01;   // P=(I−K·H)·P
    const uP10 = -K1 * P00 + P10, uP11 = -K1 * P01 + P11;
    P00 = uP00; P01 = uP01; P10 = uP10; P11 = uP11;

    const osc = X1;                                 // velocity = kekuatan tren mentah
    buf.push(osc);
    if (buf.length >= n2) {
      let A = 0; for (const v of buf) A = Math.max(A, Math.abs(v));
      if (A > 0) {
        norm.push((osc / A) * 100);
        const ts = wmaLast(norm, r2);
        if (ts != null) {
          tsSeries.push(ts);
          const line = wmaLast(tsSeries, r1);
          if (line != null) oscLine.push(line);
        }
      }
      buf.shift();
    }
  }
  if (oscLine.length < 2) return null;
  const cur = oscLine[oscLine.length - 1], prev = oscLine[oscLine.length - 2];
  const dir = cur > 0 ? 1 : cur < 0 ? -1 : 0;
  const prevDir = prev > 0 ? 1 : prev < 0 ? -1 : 0;
  return {
    dir, prevDir,
    flip: dir !== 0 && prevDir !== 0 && dir !== prevDir,   // arah berbalik bar terakhir
    osc: cur, strength: tsSeries[tsSeries.length - 1] || 0,
    time: bars[n - 1] && bars[n - 1].time,
  };
}

return {
  emaArr, rsiArr, macdArr,
  smaOn, emaOn, wmaOn, vwmaOn, hullOn,
  stochRaw, cciRaw, aoRaw, willrRaw, bbpRaw, uoRaw, adxRaw,
  computeRatings, labelOf, detectOrderBlocks, classifyRisk, emaCrossNow, vixFix, kalmanTrend,
};
});
