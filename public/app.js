/* ============================================================
   DR Leo Martin IDX — Frontend
   Chart saham Indonesia ala TradingView (Lightweight Charts v4)
   + Analisis Teknikal otomatis, Alert harga, Indikator teknikal
   ============================================================ */
(function () {
'use strict';

/* ---------------- util & format ---------------- */
const $ = (s) => document.querySelector(s);
const UP = '#26a69a', DOWN = '#ef5350';

const fmtNum = (n, d = 0) =>
  n == null || isNaN(n) ? '—' : Number(n).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d });
const fmtPrice = (n, isIndex) => fmtNum(n, isIndex ? 2 : 0);
const fmtVol = (n) => {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(2).replace('.', ',') + ' M';
  if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.', ',') + ' jt';
  if (n >= 1e3) return (n / 1e3).toFixed(1).replace('.', ',') + ' rb';
  return String(n);
};
const fmtPct = (n) => (n == null || isNaN(n) ? '—' : (n > 0 ? '+' : '') + n.toFixed(2).replace('.', ',') + '%');
const fmtSigned = (n, isIndex) => (n == null || isNaN(n) ? '—' : (n > 0 ? '+' : '') + fmtNum(n, isIndex ? 2 : 0));

function toast(msg, kind = 'err') {
  const t = $('#toast');
  t.textContent = msg;
  t.className = kind; // err | ok | ''
  t.classList.remove('hidden');
  clearTimeout(toast._h);
  toast._h = setTimeout(() => t.classList.add('hidden'), 4500);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- state ---------------- */
const TFS = {
  '1D':  { range: '1d',  interval: '5m' },
  '5D':  { range: '5d',  interval: '15m' },
  '1M':  { range: '1mo', interval: '30m' },
  '3M':  { range: '3mo', interval: '1d' },
  '6M':  { range: '6mo', interval: '1d' },
  'YTD': { range: 'ytd', interval: '1d' },
  '1Y':  { range: '1y',  interval: '1d' },
  '5Y':  { range: '5y',  interval: '1wk' },
};

const state = {
  symbol: 'BBCA',
  name: 'Bank Central Asia Tbk',
  tf: '6M',
  type: 'candles',
  bars: [],
  meta: {},
  synthetic: false,
  ind: { vol: true, ma: false, ema: false, emax: true, bb: false, vwap: false, ob: true, osc: 'none' },
};
let barsByTime = new Map();

/* Mesin TA bersama dari ta-lib.js (dipakai juga oleh server) */
const { rsiArr, macdArr, stochRaw, computeRatings, labelOf } = window.TALib;
const detectOrderBlocks = window.TALib.detectOrderBlocks;

const isIndex = () => state.symbol.startsWith('^');

/* ---------------- chart setup ---------------- */
const chartEl = $('#chart');
const chart = LightweightCharts.createChart(chartEl, {
  layout: { background: { type: 'solid', color: '#131722' }, textColor: '#d1d4dc', fontSize: 12, attributionLogo: false },
  grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
  crosshair: {
    mode: LightweightCharts.CrosshairMode.Normal,
    vertLine: { color: '#758696', width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: '#2a2e39' },
    horzLine: { color: '#758696', width: 1, style: LightweightCharts.LineStyle.Dashed, labelBackgroundColor: '#2a2e39' },
  },
  rightPriceScale: { borderColor: '#2a2e39' },
  timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false, rightOffset: 4 },
  localization: { locale: 'id-ID' },
  handleScroll: { mouseWheel: true, pressedMouseMove: true, horzTouchDrag: true, vertTouchDrag: false },
  handleScale: { mouseWheel: true, pinch: true, axisPressedMouseMove: true },
});

let mainSeries = null, volSeries = null, indSeries = [];

function priceFmtFor(sym) {
  return sym.startsWith('^')
    ? { type: 'price', precision: 2, minMove: 0.01 }
    : { type: 'price', precision: 0, minMove: 1 };
}
function resizeChart() {
  const r = chartEl.parentElement.getBoundingClientRect();
  chart.applyOptions({ width: Math.max(50, r.width), height: Math.max(50, r.height) });
}
new ResizeObserver(resizeChart).observe(chartEl.parentElement);

/* ---------------- parsing data ---------------- */
function parseChart(json) {
  const r = json && json.chart && json.chart.result && json.chart.result[0];
  if (!r) throw new Error((json && json.chart && json.chart.error && json.chart.error.description) || 'Data tidak tersedia');
  const ts = r.timestamp || [];
  const q = (r.indicators && r.indicators.quote && r.indicators.quote[0]) || {};
  const meta = r.meta || {};
  const gmt = meta.gmtoffset != null ? meta.gmtoffset : 25200;
  const intraday = /m$|h$/.test(meta.dataGranularity || '');
  const map = new Map();

  for (let i = 0; i < ts.length; i++) {
    const o = q.open && q.open[i], h = q.high && q.high[i],
          l = q.low && q.low[i], c = q.close && q.close[i];
    if (o == null || h == null || l == null || c == null) continue;
    const v = q.volume ? q.volume[i] : null;
    const time = intraday ? ts[i] + gmt : new Date((ts[i] + gmt) * 1000).toISOString().slice(0, 10);
    map.set(String(time), { time, open: o, high: h, low: l, close: c, volume: v });
  }
  const bars = [...map.values()].sort((a, b) => {
    const ta = typeof a.time === 'number' ? a.time : Date.parse(a.time + 'T00:00:00Z') / 1000;
    const tb = typeof b.time === 'number' ? b.time : Date.parse(b.time + 'T00:00:00Z') / 1000;
    return ta - tb;
  });
  return { bars, meta };
}

/* ============================================================
   PERHITUNGAN INDIKATOR
   ============================================================ */
const lastOf = (a) => (a && a.length ? a[a.length - 1].value : null);
const lastRaw = (a) => (a && a.length ? a[a.length - 1] : null);

/* --- berbasis bars → [{time, value}] (untuk series chart) --- */
function smaArr(bars, period, field = 'close') {
  const out = []; let sum = 0;
  for (let i = 0; i < bars.length; i++) {
    sum += bars[i][field];
    if (i >= period) sum -= bars[i - period][field];
    if (i >= period - 1) out.push({ time: bars[i].time, value: sum / period });
  }
  return out;
}
function emaArr(bars, period, field = 'close') {
  const k = 2 / (period + 1); const out = []; let e = null;
  for (let i = 0; i < bars.length; i++) {
    const v = bars[i][field];
    if (e == null) {
      if (i >= period - 1) {
        let s = 0; for (let j = i - period + 1; j <= i; j++) s += bars[j][field];
        e = s / period; out.push({ time: bars[i].time, value: e });
      }
    } else { e = v * k + e * (1 - k); out.push({ time: bars[i].time, value: e }); }
  }
  return out;
}
function bollingerArr(bars, p = 20, m = 2) {
  const up = [], mid = [], low = [];
  for (let i = p - 1; i < bars.length; i++) {
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) s += bars[j].close;
    const mean = s / p;
    let sq = 0;
    for (let j = i - p + 1; j <= i; j++) { const d = bars[j].close - mean; sq += d * d; }
    const sd = Math.sqrt(sq / p);
    const t = bars[i].time;
    mid.push({ time: t, value: mean });
    up.push({ time: t, value: mean + m * sd });
    low.push({ time: t, value: mean - m * sd });
  }
  return { up, mid, low };
}
function atrArr(bars, p = 14) {
  const n = bars.length;
  if (n <= p) return [];
  const tr = (i) => Math.max(
    bars[i].high - bars[i].low,
    Math.abs(bars[i].high - bars[i - 1].close),
    Math.abs(bars[i].low - bars[i - 1].close)
  );
  let a = 0;
  for (let i = 1; i <= p; i++) a += tr(i);
  a /= p;
  const out = [{ time: bars[p].time, value: a }];
  for (let i = p + 1; i < n; i++) { a = (a * (p - 1) + tr(i)) / p; out.push({ time: bars[i].time, value: a }); }
  return out;
}
function vwapPts(bars) {
  // VWAP sesi (reset harian) untuk data intraday; anchored untuk bar harian/mingguan
  if (!bars.length) return [];
  const intraday = typeof bars[0].time === 'number';
  const out = [];
  let cumPV = 0, cumV = 0, lastKey = null;
  for (const b of bars) {
    if (b.volume == null || b.volume === 0) continue;
    if (intraday) {
      const key = Math.floor(b.time / 86400);
      if (key !== lastKey) { cumPV = 0; cumV = 0; lastKey = key; }
    }
    const tp = (b.high + b.low + b.close) / 3;
    cumPV += tp * b.volume; cumV += b.volume;
    out.push({ time: b.time, value: cumPV / cumV });
  }
  return out;
}

/* ============================================================
   RENDER CHART
   ============================================================ */
function buildMain() {
  if (mainSeries) { try { chart.removeSeries(mainSeries); } catch (e) {} mainSeries = null; }
  const common = { priceFormat: priceFmtFor(state.symbol), priceLineVisible: true, priceLineColor: '#3d4354', lastValueVisible: true };
  const lineData = state.bars.map(b => ({ time: b.time, value: b.close }));
  if (state.type === 'candles') {
    mainSeries = chart.addCandlestickSeries({ upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN, ...common });
    mainSeries.setData(state.bars);
  } else if (state.type === 'bars') {
    mainSeries = chart.addBarSeries({ upColor: UP, downColor: DOWN, thinBars: false, ...common });
    mainSeries.setData(state.bars);
  } else if (state.type === 'area') {
    mainSeries = chart.addAreaSeries({ lineColor: '#2962ff', lineWidth: 2, topColor: 'rgba(41,98,255,.35)', bottomColor: 'rgba(41,98,255,.02)', ...common });
    mainSeries.setData(lineData);
  } else {
    mainSeries = chart.addLineSeries({ color: '#2962ff', lineWidth: 2, ...common });
    mainSeries.setData(lineData);
  }
}

function buildVolume() {
  if (volSeries) { try { chart.removeSeries(volSeries); } catch (e) {} volSeries = null; }
  if (!state.ind.vol) return;
  if (!state.bars.some(b => b.volume != null && b.volume > 0)) return;
  volSeries = chart.addHistogramSeries({ priceScaleId: 'vol', priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false });
  volSeries.setData(state.bars.filter(b => b.volume != null).map(b => ({
    time: b.time, value: b.volume,
    color: b.close >= b.open ? 'rgba(38,166,154,.55)' : 'rgba(239,83,80,.55)',
  })));
  try { chart.priceScale('vol').applyOptions({ visible: false }); } catch (e) {}
}

function buildIndicators() {
  for (const s of indSeries) { try { chart.removeSeries(s); } catch (e) {} }
  indSeries = [];
  const bars = state.bars;

  const addLine = (data, color, width = 1, scaleId = 'right', dashed = false) => {
    if (!data || !data.length) return null;
    const s = chart.addLineSeries({
      priceScaleId: scaleId, color, lineWidth: width,
      priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
      lineStyle: dashed ? LightweightCharts.LineStyle.Dotted : LightweightCharts.LineStyle.Solid,
    });
    s.setData(data);
    indSeries.push(s);
    return s;
  };

  if (state.ind.ma) {
    addLine(smaArr(bars, 20), '#2196f3', 1);
    addLine(smaArr(bars, 50), '#ff9800', 1);
  }
  if (state.ind.ema) addLine(emaArr(bars, 20), '#ab47bc', 1);
  if (state.ind.bb && bars.length > 20) {
    const bb = bollingerArr(bars);
    addLine(bb.up, '#5f6672', 1);
    addLine(bb.mid, '#5f6672', 1, 'right', true);
    addLine(bb.low, '#5f6672', 1);
  }
  if (state.ind.vwap) addLine(vwapPts(bars), '#00bcd4', 2);

  const hasOsc = state.ind.osc !== 'none';
  if (hasOsc) {
    try { chart.priceScale('osc').applyOptions({ visible: false }); } catch (e) {}
    if (state.ind.osc === 'RSI') {
      const s = addLine(rsiArr(bars, 14), '#b39ddb', 2, 'osc');
      if (s) {
        const pl = { color: '#787b86', lineWidth: 1, axisLabelVisible: false, title: '' };
        s.createPriceLine({ ...pl, price: 70, lineStyle: LightweightCharts.LineStyle.Dashed });
        s.createPriceLine({ ...pl, price: 30, lineStyle: LightweightCharts.LineStyle.Dashed });
        s.createPriceLine({ ...pl, price: 50, lineStyle: LightweightCharts.LineStyle.Dotted });
      }
    } else if (state.ind.osc === 'MACD') {
      const { macd, signal, hist } = macdArr(bars);
      const h = chart.addHistogramSeries({ priceScaleId: 'osc', priceLineVisible: false, lastValueVisible: false });
      h.setData(hist);
      indSeries.push(h);
      addLine(macd, '#2962ff', 1, 'osc');
      addLine(signal, '#ff9100', 1, 'osc');
    } else if (state.ind.osc === 'STOCH') {
      const h = bars.map(b => b.high), l = bars.map(b => b.low), c = bars.map(b => b.close);
      const { k, d } = stochRaw(h, l, c);
      const kp = [], dp = [];
      for (let i = 0; i < bars.length; i++) {
        if (k[i] != null) kp.push({ time: bars[i].time, value: k[i] });
        if (d[i] != null) dp.push({ time: bars[i].time, value: d[i] });
      }
      const sk = addLine(kp, '#2962ff', 1, 'osc');
      addLine(dp, '#ff9100', 1, 'osc');
      if (sk) {
        const pl = { color: '#787b86', lineWidth: 1, axisLabelVisible: false, title: '' };
        sk.createPriceLine({ ...pl, price: 80, lineStyle: LightweightCharts.LineStyle.Dashed });
        sk.createPriceLine({ ...pl, price: 20, lineStyle: LightweightCharts.LineStyle.Dashed });
      }
    } else if (state.ind.osc === 'ATR') {
      addLine(atrArr(bars, 14), '#7e57c2', 2, 'osc');
    }
  }

  try {
    chart.priceScale('right').applyOptions({
      scaleMargins: { top: 0.06, bottom: hasOsc ? 0.44 : state.ind.vol ? 0.18 : 0.02 },
    });
    if (volSeries) {
      chart.priceScale('vol').applyOptions({
        scaleMargins: hasOsc ? { top: 0.6, bottom: 0.24 } : { top: 0.84, bottom: 0 },
      });
    }
    if (hasOsc) chart.priceScale('osc').applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
  } catch (e) {}
  renderEmaXMarkers(); // tanda ▲BUY / ▼SELL pada chart
}

/* ---------------- legend ---------------- */
function legendHtml(bar) {
  if (!bar) return '';
  const idx = isIndex();
  const chg = bar.close - bar.open;
  const pct = bar.open ? (chg / bar.open) * 100 : 0;
  const cls = chg >= 0 ? 'up' : 'down';
  const tags = [];
  if (state.ind.ma) tags.push('MA20/50');
  if (state.ind.ema) tags.push('EMA20');
  if (state.ind.emax) tags.push('EMAx 3/7·2/6');
  if (state.ind.bb) tags.push('BB(20,2)');
  if (state.ind.vwap) tags.push('VWAP');
  if (state.ind.osc === 'RSI') tags.push('RSI(14)');
  if (state.ind.osc === 'MACD') tags.push('MACD(12,26,9)');
  if (state.ind.osc === 'STOCH') tags.push('Stoch(14,3,3)');
  if (state.ind.osc === 'ATR') tags.push('ATR(14)');
  return (
    `<span class="lg-sym">${escapeHtml(state.symbol)} · ${state.tf}</span>` +
    `<span class="lg-vals ${cls}">` +
    `<span>O <b>${fmtPrice(bar.open, idx)}</b></span>` +
    `<span>H <b>${fmtPrice(bar.high, idx)}</b></span>` +
    `<span>L <b>${fmtPrice(bar.low, idx)}</b></span>` +
    `<span>C <b>${fmtPrice(bar.close, idx)}</b></span>` +
    `<span>${fmtPct(pct)}</span>` +
    (bar.volume ? `<span>Vol <b>${fmtVol(bar.volume)}</b></span>` : '') +
    `</span>` +
    (tags.length ? `<span class="lg-tags">${tags.map(t => `<span class="tag">${t}</span>`).join('')}</span>` : '')
  );
}
function updateLegend(bar) {
  const el = $('#legend');
  el.innerHTML = legendHtml(bar || state.bars[state.bars.length - 1]);
  el.classList.remove('hidden');
}

chart.subscribeCrosshairMove((param) => {
  if (!param || param.time == null || !state.bars.length) return;
  const bar = barsByTime.get(String(param.time));
  if (bar) updateLegend(bar);
});

/* ---------------- header & detail ---------------- */
function computeHeaderQuote() {
  const meta = state.meta || {};
  const bars = state.bars;
  if (!bars.length) return null;
  const idx = isIndex();
  const price = meta.regularMarketPrice != null ? meta.regularMarketPrice : bars[bars.length - 1].close;
  let prev;
  if (state.tf === '1D' || state.tf === '5D' || state.tf === '1M') {
    prev = meta.chartPreviousClose != null ? meta.chartPreviousClose
         : bars.length > 1 ? bars[bars.length - 2].close : price;
  } else {
    prev = bars.length > 1 ? bars[bars.length - 2].close
         : meta.chartPreviousClose != null ? meta.chartPreviousClose : price;
  }
  const chg = price - prev;
  const pct = prev ? (chg / prev) * 100 : 0;
  return { price, chg, pct, idx };
}

function renderHeaderQuote() {
  const q = computeHeaderQuote();
  if (!q) return;
  $('#qSymbol').textContent = state.symbol;
  $('#qName').textContent = state.name || '';
  $('#qSynth').classList.toggle('hidden', !state.synthetic);
  $('#qPrice').textContent = fmtPrice(q.price, q.idx);
  const c = $('#qChange');
  c.textContent = `${fmtSigned(q.chg, q.idx)} (${fmtPct(q.pct)})`;
  c.className = 'q-change ' + (q.chg >= 0 ? 'up' : 'down');
  $('#quoteHead').classList.remove('hidden');
  document.title = `${state.symbol} ${fmtPrice(q.price, q.idx)} • DR Leo Martin IDX`;

  $('#dSymbol').textContent = state.symbol;
  $('#dName').textContent = state.name || '';
  $('#dPrice').textContent = fmtPrice(q.price, q.idx);
  const dc = $('#dChange');
  dc.textContent = `${fmtSigned(q.chg, q.idx)} (${fmtPct(q.pct)})`;
  dc.className = 'dt-chg ' + (q.chg >= 0 ? 'up' : 'down');
}

function renderDetailsExtra() {
  const meta = state.meta || {};
  const bars = state.bars;
  const idx = isIndex();
  const last = bars[bars.length - 1] || {};
  $('#dOpen').textContent = fmtPrice(last.open, idx);
  $('#dHigh').textContent = fmtPrice(last.high, idx);
  $('#dLow').textContent = fmtPrice(last.low, idx);
  $('#dClose').textContent = fmtPrice(last.close, idx);
  $('#dVol').textContent = fmtVol(last.volume);
  const vols = bars.slice(-20).map(b => b.volume || 0);
  const avg = vols.length ? vols.reduce((a, b) => a + b, 0) / vols.length : null;
  $('#dAvgVol').textContent = avg ? fmtVol(Math.round(avg)) : '—';
  const highs = bars.map(b => b.high), lows = bars.map(b => b.low);
  $('#dWkH').textContent = meta.fiftyTwoWeekHigh ? fmtPrice(meta.fiftyTwoWeekHigh, idx)
    : highs.length ? fmtPrice(Math.max(...highs), idx) : '—';
  $('#dWkL').textContent = meta.fiftyTwoWeekLow ? fmtPrice(meta.fiftyTwoWeekLow, idx)
    : lows.length ? fmtPrice(Math.min(...lows), idx) : '—';
  $('#dInterval').textContent = `${state.tf} (${TFS[state.tf].interval})`;
  $('#dBars').textContent = fmtNum(bars.length);
}

/* Statistik tambahan ala Google Finance: prev close, rentang hari ini, tautan referensi */
let quoteExtraTimer = 0;
function loadQuoteExtra() {
  const gf = $('#gfLink');
  if (gf) {
    const sym = state.symbol;
    const gfSym = sym === '^JKSE' ? 'COMPOSITE:IDX' : sym === '^JKLQ45' ? 'LQ45:IDX'
      : sym.startsWith('^') ? null : String(sym).replace(/\.JK$/, '') + ':IDX';
    gf.href = gfSym ? 'https://www.google.com/finance/quote/' + gfSym : 'https://www.google.com/finance/';
  }
  clearTimeout(quoteExtraTimer);
  quoteExtraTimer = setTimeout(() => {
    fetch('/api/quotes?symbols=' + encodeURIComponent(state.symbol))
      .then(r => r.json())
      .then(j => {
        const q = (j.data || [])[0];
        if (!q || q.error) return;
        const idx = isIndex();
        if (q.prevClose != null) $('#dPrev').textContent = fmtPrice(q.prevClose, idx);
        if (q.dayLow != null && q.dayHigh != null) {
          $('#dDayRange').textContent = fmtPrice(q.dayLow, idx) + ' – ' + fmtPrice(q.dayHigh, idx);
        }
      })
      .catch(() => {});
  }, 60);
}

/* ============================================================
   ANALISIS TEKNIKAL OTOMATIS (ala TradingView)
   ============================================================ */
function sigText(s) { return s === 'buy' ? 'Buy' : s === 'sell' ? 'Sell' : 'Neutral'; }

function drawGauge(score) {
  const svg = $('#taGauge');
  const cx = 85, cy = 88, r = 66, w = 13;
  const pt = (s, rr) => {
    const a = (Math.PI * (1 - s)) / 2; // s=-1 → kiri, s=1 → kanan
    return [cx + rr * Math.cos(a), cy - rr * Math.sin(a)];
  };
  const zones = [
    [-1, -0.5, '#ef5350'], [-0.5, -0.1, '#f57c00'], [-0.1, 0.1, '#5f6672'],
    [0.1, 0.5, '#9ccc65'], [0.5, 1, '#26a69a'],
  ];
  let out = '';
  for (const [s0, s1, color] of zones) {
    const [x0, y0] = pt(s0, r), [x1, y1] = pt(s1, r);
    out += `<path d="M ${x0.toFixed(1)} ${y0.toFixed(1)} A ${r} ${r} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}" stroke="${color}" stroke-width="${w}" fill="none"/>`;
  }
  // jarum
  const cl = Math.max(-1, Math.min(1, score));
  const [nx, ny] = pt(cl, r - 20), [tx, ty] = pt(cl, r + 6), [bx, by] = pt(cl, 14);
  out += `<line x1="${bx.toFixed(1)}" y1="${by.toFixed(1)}" x2="${nx.toFixed(1)}" y2="${ny.toFixed(1)}" stroke="#d1d4dc" stroke-width="2.5" stroke-linecap="round"/>`;
  out += `<circle cx="${cx}" cy="${cy}" r="5" fill="#d1d4dc"/>`;
  out += `<circle cx="${tx.toFixed(1)}" cy="${ty.toFixed(1)}" r="3" fill="#d1d4dc"/>`;
  out += `<text x="14" y="102" fill="#787b86" font-size="9">Sell</text>`;
  out += `<text x="140" y="102" fill="#787b86" font-size="9">Buy</text>`;
  svg.innerHTML = out;
}

function groupRowHtml(name, s) {
  const tot = Math.max(1, s.b + s.s + s.n);
  const lw = (x) => ((x / tot) * 100).toFixed(1) + '%';
  const lbl = labelOf(s.score);
  const scls = lbl.includes('Buy') ? 'buy' : lbl.includes('Sell') ? 'sell' : 'neutral';
  return (
    `<div class="ta-row">` +
    `<div class="ta-row-head"><span>${name}</span><span class="sig ${scls}">${lbl}</span></div>` +
    `<div class="ta-dist"><span style="width:${lw(s.s)}" class="d-sell"></span><span style="width:${lw(s.n)}" class="d-neut"></span><span style="width:${lw(s.b)}" class="d-buy"></span></div>` +
    `<div class="ta-counts"><span class="down">Jual ${s.s}</span><span>Netral ${s.n}</span><span class="up">Beli ${s.b}</span></div>` +
    `</div>`
  );
}

function renderTA() {
  const note = $('#taNote');
  const bars = state.bars;
  if (!bars || bars.length < 30) {
    note.textContent = 'Data tidak cukup untuk analisis (butuh minimal ±30 bar).';
    $('#taGauge').innerHTML = '';
    $('#taLabel').textContent = '—';
    $('#taGroups').innerHTML = '';
    $('#taOsc').innerHTML = '';
    $('#taMA').innerHTML = '';
    return;
  }
  const res = computeRatings(bars);
  if (!res || res.total < 5) {
    note.textContent = 'Analisis belum tersedia untuk data ini.';
    return;
  }
  note.textContent = `Berdasarkan ${state.tf} • ${bars.length} bar • ${state.symbol} • ${wibNow()}`;
  drawGauge(res.score);
  const lbl = labelOf(res.score);
  const tl = $('#taLabel');
  tl.textContent = lbl;
  tl.className = 'ta-label ' + (lbl.includes('Buy') ? 'up' : lbl.includes('Sell') ? 'down' : '');
  $('#taGroups').innerHTML =
    groupRowHtml('Osilator', res.oscS) +
    groupRowHtml('Moving Average', res.maS) +
    groupRowHtml('Ringkasan', res);
  const idx = isIndex();
  const row = (x, isOsc) =>
    `<div class="ta-line"><span class="ta-n">${x.name}</span>` +
    `<span class="ta-v">${isOsc ? fmtNum(x.val, 2) : fmtPrice(x.val, idx)}</span>` +
    `<span class="sig ${x.sig}">${sigText(x.sig)}</span></div>`;
  $('#taOsc').innerHTML = res.osc.map(x => row(x, true)).join('');
  $('#taMA').innerHTML = res.ma.map(x => row(x, false)).join('');
}

/* ============================================================
   LOAD CHART
   ============================================================ */
let loadSeq = 0;
async function loadChart(symbol, opts = {}) {
  const mySeq = ++loadSeq;
  if (!opts.silent) $('#loading').classList.remove('hidden');
  const { range, interval } = TFS[state.tf];
  try {
    const r = await fetch(`/api/chart?symbol=${encodeURIComponent(symbol)}&range=${range}&interval=${interval}`);
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    if (mySeq !== loadSeq) return;
    const { bars, meta } = parseChart(j);
    if (!bars.length) throw new Error('Data kosong untuk simbol ini');

    state.symbol = (meta.symbol || symbol).replace(/\.JK$/, '');
    state.name = meta.longName || meta.shortName || state.name;
    state.bars = bars;
    state.meta = meta;
    state.synthetic = !!meta.synthetic;
    barsByTime = new Map(bars.map(b => [String(b.time), b]));

    const visRange = opts.silent ? safeVisibleRange() : null;
    buildMain();
    buildVolume();
    buildIndicators();
    if (!opts.silent) chart.timeScale().fitContent();
    else if (visRange) try { chart.timeScale().setVisibleRange(visRange); } catch (e) {}

    const __obList = renderOrderBlocks();
    obAlertFromChart(__obList);
    checkEmaXAlert();
    updateLegend();
    renderHeaderQuote();
    renderDetailsExtra();
    loadQuoteExtra();
    renderTA();
    setActiveRow();
    $('#sbSource').textContent = state.synthetic
      ? 'DATA SIMULASI — koneksi data live tidak tersedia'
      : 'Sumber: Yahoo Finance (delay ±15 menit)';
    $('#sbUpdated').textContent = 'Diperbarui ' + wibNow();
  } catch (e) {
    if (mySeq === loadSeq) toast(`Gagal memuat ${symbol}: ${e.message}`);
  } finally {
    if (mySeq === loadSeq) $('#loading').classList.add('hidden');
  }
}
function safeVisibleRange() {
  try { return chart.timeScale().getVisibleRange(); } catch (e) { return null; }
}

/* ============================================================
   EMA CROSS — 3/7 = BUY, 2/6 = SELL (tanda di chart)
   Mengikuti timeframe chart yang dipilih (1D=5m … 5Y=1wk).
   ============================================================ */
function barTimeVal(t) { return typeof t === 'number' ? t : Date.parse(t + 'T00:00:00Z') / 1000; }

/* EMA sebagai array sejajar bars (null sebelum seed) */
function emaRaw(bars, period, field = 'close') {
  const k = 2 / (period + 1);
  const out = new Array(bars.length).fill(null);
  let e = null;
  for (let i = 0; i < bars.length; i++) {
    const v = bars[i][field];
    if (e == null) {
      if (i >= period - 1) {
        let s = 0; for (let j = i - period + 1; j <= i; j++) s += bars[j][field];
        e = s / period; out[i] = e;
      }
    } else { e = v * k + e * (1 - k); out[i] = e; }
  }
  return out;
}

/* Semua titik cross pada bars saat ini */
function emaCrossSignals(bars) {
  const e3 = emaRaw(bars, 3), e7 = emaRaw(bars, 7);
  const e2 = emaRaw(bars, 2), e6 = emaRaw(bars, 6);
  const buys = [], sells = [];
  for (let i = 1; i < bars.length; i++) {
    if (e3[i] != null && e7[i] != null && e3[i - 1] != null && e7[i - 1] != null &&
        e3[i - 1] <= e7[i - 1] && e3[i] > e7[i]) buys.push({ time: bars[i].time, close: bars[i].close });
    if (e2[i] != null && e6[i] != null && e2[i - 1] != null && e6[i - 1] != null &&
        e2[i - 1] >= e6[i - 1] && e2[i] < e6[i]) sells.push({ time: bars[i].time, close: bars[i].close });
  }
  return { buys, sells };
}

/* Gambar tanda ▲BUY (bawah lilin) / ▼SELL (atas lilin) */
function renderEmaXMarkers() {
  if (!mainSeries) return;
  if (!state.ind.emax || state.type === 'area' || state.type === 'line' || state.bars.length < 8) {
    try { mainSeries.setMarkers([]); } catch (e) {}
    return;
  }
  const { buys, sells } = emaCrossSignals(state.bars);
  const ms = [
    ...buys.map(x => ({ time: x.time, position: 'belowBar', color: UP, shape: 'arrowUp', text: 'BUY' })),
    ...sells.map(x => ({ time: x.time, position: 'aboveBar', color: DOWN, shape: 'arrowDown', text: 'SELL' })),
  ].sort((a, b) => barTimeVal(a.time) - barTimeVal(b.time));
  try { mainSeries.setMarkers(ms); } catch (e) {}
}

/* ============================================================
   WATCHLIST
   ============================================================ */
const wlRows = new Map();

function wlRowEl(item) {
  let rec = wlRows.get(item.symbol);
  if (!rec) {
    const row = document.createElement('div');
    row.className = 'wl-row';
    row.innerHTML =
      `<div class="wl-l"><div class="wl-symrow"><span class="wl-sym"></span><span class="wl-sigdot hidden"></span></div><div class="wl-name"></div></div>` +
      `<svg class="wl-spark" viewBox="0 0 64 22" preserveAspectRatio="none"><polyline fill="none" stroke-width="1.2"/></svg>` +
      `<div class="wl-r"><div class="wl-price"></div><div class="wl-chg"></div></div>`;
    row.addEventListener('click', () => onSelectSymbol(item.symbol, item.name));
    rec = {
      row,
      symEl: row.querySelector('.wl-sym'),
      sigEl: row.querySelector('.wl-sigdot'),
      nameEl: row.querySelector('.wl-name'),
      sparkEl: row.querySelector('polyline'),
      priceEl: row.querySelector('.wl-price'),
      chgEl: row.querySelector('.wl-chg'),
    };
    wlRows.set(item.symbol, rec);
  }
  rec.row.dataset.name = item.name || '';
  rec.symEl.textContent = String(item.symbol).replace(/\.JK$/, '');
  rec.nameEl.textContent = item.name || '';
  const idxCls = String(item.symbol).startsWith('^');
  if (item.price != null) {
    rec.priceEl.textContent = fmtPrice(item.price, idxCls);
    const upCls = (item.change || 0) >= 0 ? 'up' : 'down';
    rec.chgEl.textContent = fmtPct(item.changePct);
    rec.chgEl.className = 'wl-chg ' + upCls;
    rec.priceEl.classList.remove('up', 'down');
    rec.priceEl.classList.add(upCls);
  } else {
    rec.priceEl.textContent = '—';
    rec.chgEl.textContent = '';
  }
  if (item.spark && item.spark.length > 1) {
    const min = Math.min(...item.spark), max = Math.max(...item.spark);
    const span = max - min || 1;
    const pts = item.spark.map((v, i) => {
      const x = (i / (item.spark.length - 1)) * 64;
      const y = 20 - ((v - min) / span) * 18;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');
    rec.sparkEl.setAttribute('points', pts);
    rec.sparkEl.setAttribute('stroke', (item.change || 0) >= 0 ? UP : DOWN);
  }
  return rec.row;
}

function setActiveRow() {
  for (const [sym, rec] of wlRows) rec.row.classList.toggle('active', sym === state.symbol);
}

async function loadWatchlist(first = false) {
  try {
    if (first) $('#wlList').innerHTML = '<div class="wl-skel">Memuat daftar saham…</div>';
    const r = await fetch('/api/watchlist');
    const j = await r.json();
    const rows = j.data || [];
    const idxWrap = $('#wlIndices'), listWrap = $('#wlList');
    if (first) { idxWrap.innerHTML = ''; listWrap.innerHTML = ''; }
    const fragIdx = document.createDocumentFragment();
    const fragList = document.createDocumentFragment();
    for (const item of rows) {
      const el = wlRowEl(item);
      if (String(item.symbol).startsWith('^')) fragIdx.appendChild(el);
      else fragList.appendChild(el);
    }
    idxWrap.appendChild(fragIdx);
    listWrap.appendChild(fragList);
    $('#wlUpdated').textContent = wibNow().slice(0, 8);
    setActiveRow();
  } catch (e) {
    if (first) $('#wlList').innerHTML = '<div class="wl-skel">Gagal memuat daftar. Coba lagi nanti.</div>';
  }
}

function onSelectSymbol(symbol, name) {
  state.symbol = String(symbol).replace(/\.JK$/, '');
  state.name = name || state.name;
  setActiveRow();
  loadChart(state.symbol);
}

/* ============================================================
   SEARCH
   ============================================================ */
const searchInput = $('#searchInput');
const searchResults = $('#searchResults');
let searchTimer = null;

searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  const q = searchInput.value.trim();
  if (q.length < 1) { searchResults.classList.add('hidden'); return; }
  searchTimer = setTimeout(() => doSearch(q), 250);
});
searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') { searchResults.classList.add('hidden'); searchInput.blur(); }
  if (e.key === 'Enter') {
    const first = searchResults.querySelector('.sr-item');
    if (first) first.dispatchEvent(new Event('mousedown'));
  }
});
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-box')) searchResults.classList.add('hidden');
  if (!e.target.closest('.menu-wrap')) $('#indMenu').classList.add('hidden');
});

async function doSearch(q) {
  try {
    const r = await fetch('/api/search?q=' + encodeURIComponent(q));
    const j = await r.json();
    const items = j.quotes || [];
    if (!items.length) {
      searchResults.innerHTML = '<div class="sr-empty">Tidak ditemukan. Coba kode saham (mis. BBCA).</div>';
    } else {
      searchResults.innerHTML = '';
      for (const it of items.slice(0, 12)) {
        const div = document.createElement('div');
        div.className = 'sr-item';
        div.innerHTML =
          `<span class="sr-sym">${escapeHtml(String(it.symbol).replace(/\.JK$/, ''))}</span>` +
          `<span class="sr-name">${escapeHtml(it.name)}</span>` +
          `<span class="sr-type">${escapeHtml(it.type || '')}</span>`;
        div.addEventListener('mousedown', () => {
          searchResults.classList.add('hidden');
          searchInput.value = '';
          onSelectSymbol(it.symbol, it.name);
        });
        searchResults.appendChild(div);
      }
    }
    searchResults.classList.remove('hidden');
  } catch (e) {
    searchResults.innerHTML = '<div class="sr-empty">Pencarian gagal.</div>';
    searchResults.classList.remove('hidden');
  }
}

/* ============================================================
   TOOLBAR & MENU INDIKATOR
   ============================================================ */
$('#tfGroup').addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-tf]');
  if (!btn || btn.classList.contains('active')) return;
  document.querySelectorAll('#tfGroup button').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  state.tf = btn.dataset.tf;
  loadChart(state.symbol);
});
$('#chartType').addEventListener('change', (e) => {
  state.type = e.target.value;
  buildMain();
  updateLegend();
});
$('#btnFs').addEventListener('click', () => {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});

$('#indMenuBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  $('#indMenu').classList.toggle('hidden');
});
$('#indMenu').addEventListener('change', () => {
  state.ind.vol = document.querySelector('[data-ind="vol"]').checked;
  state.ind.ma = document.querySelector('[data-ind="ma"]').checked;
  state.ind.ema = document.querySelector('[data-ind="ema"]').checked;
  state.ind.emax = document.querySelector('[data-ind="emax"]').checked;
  state.ind.bb = document.querySelector('[data-ind="bb"]').checked;
  state.ind.vwap = document.querySelector('[data-ind="vwap"]').checked;
  state.ind.ob = document.querySelector('[data-ind="ob"]').checked;
  state.ind.osc = document.querySelector('input[name="osc"]:checked').value;
  buildVolume();
  buildIndicators();
  renderOrderBlocks();
  updateLegend();
  updateIndCount();
});
function updateIndCount() {
  const n = ['ma', 'ema', 'emax', 'bb', 'vwap', 'ob'].filter(k => state.ind[k]).length + (state.ind.osc !== 'none' ? 1 : 0);
  const el = $('#indCount');
  el.textContent = n;
  el.classList.toggle('hidden', n === 0);
}

/* ============================================================
   TAB PANEL KANAN
   ============================================================ */
function showTab(name) {
  document.querySelectorAll('.dt-tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  $('#tabDetail').classList.toggle('hidden', name !== 'Detail');
  $('#tabTeknikal').classList.toggle('hidden', name !== 'Teknikal');
  $('#tabAlert').classList.toggle('hidden', name !== 'Alert');
  if (name === 'Teknikal') renderTA();
  if (name === 'Alert') renderAlerts();
}
document.querySelectorAll('.dt-tabs button').forEach(b =>
  b.addEventListener('click', () => showTab(b.dataset.tab))
);
$('#btnAlertBell').addEventListener('click', () => {
  showTab('Alert');
  const det = $('#details');
  if (det && det.scrollIntoView) det.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});

/* ============================================================
   ALERT HARGA
   ============================================================ */
const ALERT_KEY = 'idx-terminal-alerts-v1';
let alerts = [];
try { alerts = JSON.parse(localStorage.getItem(ALERT_KEY) || '[]'); } catch (e) { alerts = []; }
function saveAlerts() { try { localStorage.setItem(ALERT_KEY, JSON.stringify(alerts)); } catch (e) {} }

function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = beep._c || (beep._c = new AC());
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    const t = ctx.currentTime;
    [880, 1318.5].forEach((f, i) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.22, t + i * 0.18 + 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.18 + 0.28);
      o.connect(g).connect(ctx.destination);
      o.start(t + i * 0.18);
      o.stop(t + i * 0.18 + 0.3);
    });
  } catch (e) {}
}
function notifyUser(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  // Lewat Service Worker agar notifikasi tetap muncul dari aplikasi terinstal (Android)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.ready
      .then(reg => reg.showNotification(title, { body, silent: true, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', tag: 'idx-' + Date.now() }))
      .catch(() => { try { new Notification(title, { body, silent: true }); } catch (e) {} });
    return;
  }
  try { new Notification(title, { body, silent: true }); } catch (e) {}
}

function renderAlerts() {
  const list = $('#alertList');
  const activeCount = alerts.filter(a => a.status === 'active').length;
  const badge = $('#alertBadge');
  badge.textContent = activeCount;
  badge.classList.toggle('hidden', activeCount === 0);
  const cnt = $('#alertCnt');
  cnt.textContent = activeCount;
  cnt.classList.toggle('hidden', activeCount === 0);

  if (!alerts.length) {
    list.innerHTML = '<div class="al-empty">Belum ada alert.<br/>Buat alert pertama Anda di atas. ☝️</div>';
    return;
  }
  const sorted = [...alerts].sort((a, b) => (a.status === b.status ? b.createdAt - a.createdAt : a.status === 'active' ? -1 : 1));
  list.innerHTML = '';
  for (const a of sorted) {
    const idxCls = String(a.symbol).startsWith('^');
    const div = document.createElement('div');
    div.className = 'al-item ' + a.status;
    const trigInfo =
      a.status === 'done'
        ? `Terpicu ${a.triggeredPrice != null ? '@ ' + fmtPrice(a.triggeredPrice, idxCls) : ''} • ${a.triggeredAt ? new Date(a.triggeredAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) : ''}`
        : 'Dibuat ' + new Date(a.createdAt).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' });
    const condTxt = a.type === 'ob'
      ? '🧱 OB baru'
      : `${a.cond === 'gte' ? '≥' : '≤'} ${fmtPrice(a.price, idxCls)}`;
    const statTxt = a.type === 'ob'
      ? (a.triggerCount ? `AKTIF • ${a.triggerCount}×` : 'AKTIF')
      : (a.status === 'active' ? 'AKTIF' : 'TERPICU');
    div.innerHTML =
      `<div class="al-top">` +
      `<span class="al-sym">${escapeHtml(a.symbol)}</span>` +
      `<span class="al-cond">${condTxt}</span>` +
      `<span class="al-status ${a.status}">${statTxt}</span>` +
      `<button class="al-del" data-id="${a.id}" title="Hapus alert">✕</button>` +
      `</div>` +
      `<div class="al-sub">${a.note ? `<span class="al-note">📝 ${escapeHtml(a.note)}</span><br/>` : ''}${trigInfo}</div>`;
    list.appendChild(div);
  }
}

$('#alertList').addEventListener('click', (e) => {
  const btn = e.target.closest('.al-del');
  if (!btn) return;
  alerts = alerts.filter(a => String(a.id) !== String(btn.dataset.id));
  saveAlerts();
  renderAlerts();
  toast('Alert dihapus.', 'ok');
});

$('#aUseCur').addEventListener('click', () => {
  const q = computeHeaderQuote();
  $('#aSymbol').value = state.symbol;
  if (q) $('#aPrice').value = q.idx ? q.price.toFixed(2) : Math.round(q.price);
});

$('#aType').addEventListener('change', () => {
  $('#priceFields').classList.toggle('hidden', $('#aType').value === 'ob');
});

$('#alertForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const type = $('#aType').value === 'ob' ? 'ob' : 'price';
  const sym = ($('#aSymbol').value.trim() || state.symbol).toUpperCase().replace(/\.JK$/, '');
  const note = $('#aNote').value.trim();
  if (!sym) { toast('Isi simbol dengan benar.'); return; }
  const id = Date.now() + '' + Math.floor(Math.random() * 1e4);

  if (type === 'ob') {
    alerts.unshift({
      id, type: 'ob', symbol: sym, cond: 'ob', price: 0, note,
      createdAt: Date.now(), status: 'active',
      notified: [], triggerCount: 0,
    });
    saveAlerts();
    renderAlerts();
    $('#aNote').value = '';
    toast(`🧱 Alert OB dibuat: ${sym} — setiap Order Block baru memicu notifikasi`, 'ok');
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
    checkObAlerts();
    obAlertNowForCurrent(sym);
    return;
  }

  const cond = $('#aCond').value === 'lte' ? 'lte' : 'gte';
  const price = Number($('#aPrice').value);
  if (!isFinite(price) || price <= 0) {
    toast('Isi harga target dengan benar.');
    return;
  }
  alerts.unshift({
    id, type: 'price', symbol: sym, cond, price, note,
    createdAt: Date.now(), status: 'active',
    triggeredAt: null, triggeredPrice: null,
  });
  saveAlerts();
  renderAlerts();
  $('#aNote').value = '';
  toast(`🔔 Alert dibuat: ${sym} ${cond === 'gte' ? '≥' : '≤'} ${fmtPrice(price, sym.startsWith('^'))}`, 'ok');
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission().catch(() => {});
  }
  // cek langsung (siapa tahu kondisi sudah terpenuhi)
  checkAlerts();
});

function fireAlert(a, px) {
  const idxCls = String(a.symbol).startsWith('^');
  const msg = `🔔 ${a.symbol} ${a.cond === 'gte' ? 'naik menembus' : 'turun menembus'} ${fmtPrice(a.price, idxCls)} — harga kini ${fmtPrice(px, idxCls)}${a.note ? ' • ' + a.note : ''}`;
  toast(msg, 'ok');
  beep();
  notifyUser(`DR Leo Martin IDX — Alert ${a.symbol}`, msg);
  pushHistory('harga', msg, a.symbol);
}

let alertCheckRunning = false;
async function checkAlerts() {
  if (alertCheckRunning) return;
  const active = alerts.filter(a => a.status === 'active');
  if (!active.length) return;
  alertCheckRunning = true;
  try {
    const uniq = [...new Set(active.map(a => a.symbol))];
    const prices = {};
    const others = uniq.filter(s => s !== state.symbol);
    if (others.length) {
      try {
        const r = await fetch('/api/quotes?symbols=' + others.map(encodeURIComponent).join(','));
        const j = await r.json();
        for (const q of j.data || []) {
          const key = String(q.symbol).replace(/\.JK$/, '');
          if (q.price != null) prices[key] = q.price;
        }
      } catch (e) {}
    }
    if (uniq.includes(state.symbol)) {
      const q = computeHeaderQuote();
      if (q) prices[state.symbol] = q.price;
    }
    let changed = false;
    for (const a of active) {
      const px = prices[a.symbol];
      if (a.type === 'ob' || px == null) continue;
      const hit = a.cond === 'gte' ? px >= a.price : px <= a.price;
      if (hit) {
        a.status = 'done';
        a.triggeredAt = Date.now();
        a.triggeredPrice = px;
        changed = true;
        fireAlert(a, px);
      }
    }
    if (changed) { saveAlerts(); renderAlerts(); }
  } finally {
    alertCheckRunning = false;
  }
}

/* ============================================================
   ORDER BLOCKS (SMC) — zona di chart + alert OB baru
   Port: "Volumized Order Blocks | Flux Charts" (Pine v5)
   ============================================================ */
let obZones = [];

function obTimeStr(t) {
  if (typeof t === 'number') {
    try {
      return new Intl.DateTimeFormat('id-ID', {
        timeZone: 'Asia/Jakarta', dateStyle: 'medium', timeStyle: 'short',
      }).format(new Date(t * 1000));
    } catch (e) { return String(t); }
  }
  return String(t);
}

function renderOrderBlocks() {
  const layer = $('#obLayer');
  layer.innerHTML = '';
  obZones = [];
  if (!state.ind.ob || !state.bars.length || !mainSeries) return [];
  const det = TALib.detectOrderBlocks(state.bars);
  const list = [...det.bullish.slice(0, 5), ...det.bearish.slice(0, 5)];
  const idxCls = isIndex();
  for (const ob of list) {
    if (!state.bars[ob.startIndex] || !state.bars[ob.formedIndex]) continue;
    const div = document.createElement('div');
    div.className = 'ob-zone ' + (ob.type === 'bull' ? 'ob-bull' : 'ob-bear') + (ob.breaker ? ' ob-breaker' : '');
    const totV = (ob.volUp || 0) + (ob.volDown || 0);
    const pctUp = totV > 0 ? Math.round((ob.volUp / totV) * 100) : 50;
    const pct = totV > 0 ? Math.round((Math.min(ob.volUp, ob.volDown) / Math.max(ob.volUp, ob.volDown)) * 100) : null;
    div.innerHTML =
      `<div class="ob-vol"><div class="up" style="width:${pctUp}%"></div><div class="dn" style="width:${100 - pctUp}%"></div></div>` +
      `<div class="ob-label">${ob.volume ? fmtVol(ob.volume) : ''}${pct != null ? ` (${pct}%)` : ''} OB</div>`;
    const bt = ob.breakIndex != null && state.bars[ob.breakIndex] ? state.bars[ob.breakIndex] : null;
    div.title =
      `${ob.type === 'bull' ? 'Bullish' : 'Bearish'} Order Block\n` +
      `Zona ${fmtPrice(ob.bottom, idxCls)} – ${fmtPrice(ob.top, idxCls)}\n` +
      `Terbentuk: ${obTimeStr(state.bars[ob.formedIndex].time)}` +
      (bt ? `\nTertembus: ${obTimeStr(bt.time)}` : '') +
      (ob.volume ? `\nVolume: ${fmtVol(ob.volume)}` : '');
    layer.appendChild(div);
    obZones.push({ ob, div });
  }
  positionOBZones();
  return list;
}

function positionOBZones() {
  if (!obZones.length || !mainSeries) return;
  const tsc = chart.timeScale();
  const spacing = tsc.options().barSpacing || 6;
  const layerW = $('#obLayer').clientWidth || 1;
  const lastT = state.bars[state.bars.length - 1].time;
  for (const { ob, div } of obZones) {
    const st = state.bars[ob.startIndex];
    let x1 = tsc.timeToCoordinate(st.time);
    let x2;
    if (ob.breakIndex != null && state.bars[ob.breakIndex]) {
      x2 = tsc.timeToCoordinate(state.bars[ob.breakIndex].time);
    } else {
      const xl = tsc.timeToCoordinate(lastT);
      x2 = (xl == null ? layerW : xl) + spacing * 12;
    }
    if (x1 == null) x1 = 0;
    if (x2 == null) x2 = layerW;
    const y1 = mainSeries.priceToCoordinate(ob.top);
    const y2 = mainSeries.priceToCoordinate(ob.bottom);
    if (y1 == null || y2 == null || x2 < x1 || x2 < 0 || x1 > layerW) { div.style.display = 'none'; continue; }
    div.style.display = 'block';
    div.style.left = x1 + 'px';
    div.style.width = Math.max(3, x2 - x1) + 'px';
    div.style.top = y1 + 'px';
    div.style.height = Math.max(3, y2 - y1) + 'px';
  }
}
chart.timeScale().subscribeVisibleLogicalRangeChange(() => {
  if (obZones.length) requestAnimationFrame(positionOBZones);
});

/* ---- alert Order Block ---- */
function fireObAlert(a, ob) {
  const idxCls = String(a.symbol).startsWith('^');
  const dir = ob.type === 'bull' ? 'BULLISH 🟢' : 'BEARISH 🔴';
  const msg = `🧱 OB ${dir} — ${a.symbol} • zona ${fmtPrice(ob.bottom, idxCls)}–${fmtPrice(ob.top, idxCls)} (${ob.formedTime || ''})${a.note ? ' • ' + a.note : ''}`;
  toast(msg, 'ok');
  beep();
  notifyUser(`DR Leo Martin IDX — Order Block ${a.symbol}`, msg);
  pushHistory('ob', msg, a.symbol, ob.type === 'bull' ? 'Bullish' : 'Bearish');
}

function obAlertFromChart(list) {
  if (!list || !list.length) return;
  const act = alerts.filter(a => a.status === 'active' && a.type === 'ob' && a.symbol === state.symbol);
  if (!act.length) return;
  let changed = false;
  for (const a of act) {
    a.notified = a.notified || [];
    for (const ob of list) {
      const ft = state.bars[ob.formedIndex] && state.bars[ob.formedIndex].time;
      if (ft == null) continue;
      const dateStr = typeof ft === 'number' ? new Date(ft * 1000).toISOString().slice(0, 10) : ft;
      const key = ob.type + '|' + dateStr + '|' + Math.round(ob.bottom * 100) + '|' + Math.round(ob.top * 100);
      if (a.notified.includes(key)) continue;
      const fts = typeof ft === 'number' ? ft : Date.parse(ft + 'T00:00:00Z') / 1000;
      if (fts * 1000 <= a.createdAt) continue;
      const obObj = { type: ob.type, formedTime: dateStr, bottom: ob.bottom, top: ob.top };
      if (obAlreadyFired(a.symbol, obObj)) { // sudah di-notify scan global
        a.notified.push(key);
        if (a.notified.length > 30) a.notified.shift();
        continue;
      }
      a.notified.push(key);
      if (a.notified.length > 30) a.notified.shift();
      a.triggerCount = (a.triggerCount || 0) + 1;
      changed = true;
      fireObAlert(a, obObj);
      obMarkFired(a.symbol, obObj);
    }
  }
  if (changed) { saveAlerts(); renderAlerts(); }
}

let obCheckRunning = false;
async function checkObAlerts() {
  if (obCheckRunning) return;
  const act = alerts.filter(a => a.status === 'active' && a.type === 'ob');
  if (!act.length) return;
  obCheckRunning = true;
  try {
    const syms = [...new Set(act.map(a => a.symbol))];
    const r = await fetch('/api/orderblocks?symbols=' + syms.map(encodeURIComponent).join(','));
    const j = await r.json();
    const bySym = {};
    for (const row of j.data || []) bySym[String(row.symbol).replace(/\.JK$/, '')] = row.obs || [];
    let changed = false;
    for (const a of act) {
      const obs = bySym[a.symbol] || [];
      a.notified = a.notified || [];
      for (const ob of obs) {
        const key = ob.type + '|' + ob.formedTime + '|' + Math.round(ob.bottom * 100) + '|' + Math.round(ob.top * 100);
        if (a.notified.includes(key)) continue;
        if ((ob.formedTs || 0) * 1000 <= a.createdAt) continue;
        if (obAlreadyFired(a.symbol, ob)) { // sudah di-notify scan global
          a.notified.push(key);
          if (a.notified.length > 30) a.notified.shift();
          continue;
        }
        a.notified.push(key);
        if (a.notified.length > 30) a.notified.shift();
        a.triggerCount = (a.triggerCount || 0) + 1;
        changed = true;
        fireObAlert(a, ob);
        obMarkFired(a.symbol, ob);
      }
    }
    if (changed) { saveAlerts(); renderAlerts(); }
  } catch (e) {}
  obCheckRunning = false;
}

function obAlertNowForCurrent(sym) {
  if (sym !== state.symbol || !state.bars.length) return;
  const det = TALib.detectOrderBlocks(state.bars);
  obAlertFromChart([...det.bullish.slice(0, 5), ...det.bearish.slice(0, 5)]);
}

/* ============================================================
   JAM & STATUS PASAR
   ============================================================ */
function wibNow() {
  try {
    return new Intl.DateTimeFormat('id-ID', {
      timeZone: 'Asia/Jakarta', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    }).format(new Date()).replace(/\./g, ':') + ' WIB';
  } catch (e) {
    return new Date().toLocaleTimeString();
  }
}
function marketStatus() {
  let now;
  try { now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })); }
  catch (e) { now = new Date(); }
  const d = now.getDay();
  const mins = now.getHours() * 60 + now.getMinutes();
  if (d === 0 || d === 6) return { open: false, label: 'Pasar Tutup' };
  const fri = d === 5;
  const s1 = fri ? [9 * 60, 11 * 60 + 30] : [9 * 60, 12 * 60];
  const s2 = fri ? [14 * 60, 15 * 60] : [13 * 60 + 30, 15 * 60];
  const inSess = (mins >= s1[0] && mins < s1[1]) || (mins >= s2[0] && mins < s2[1]);
  if (mins >= 8 * 60 + 45 && mins < 9 * 60) return { open: false, label: 'Pra-Pembukaan' };
  return { open: inSess, label: inSess ? 'Pasar Buka' : 'Pasar Tutup' };
}
function tickClock() {
  $('#clock').textContent = wibNow();
  const st = marketStatus();
  const badge = $('#marketBadge');
  badge.className = 'market-badge ' + (st.open ? 'open' : 'closed');
  $('#marketLabel').textContent = st.label;
}

/* ============================================================
   SINYAL TEKNIKAL — pemindai Strong Buy / Strong Sell
   (dihitung server: /api/signals, 25 indikator, data harian)
   ============================================================ */
let signals = [];
let sigFilter = 'Semua';
let riskFilter = 'Semua';
const SIG_ORDER = ['Strong Buy', 'Buy', 'Neutral', 'Sell', 'Strong Sell'];
const SIG_ABBR = { 'Strong Buy': 'SB', 'Buy': 'B', 'Neutral': 'N', 'Sell': 'S', 'Strong Sell': 'SS' };
const SIG_CLS = {
  'Strong Buy': 'sg-strong-buy', 'Buy': 'sg-buy', 'Neutral': 'sg-neutral',
  'Sell': 'sg-sell', 'Strong Sell': 'sg-strong-sell',
};
const RK_ORDER = ['unggulan', 'reguler', 'highrisk', 'gorengan'];
const RK_META = {
  unggulan: { icon: '💎', label: 'Unggulan', cls: 'rk-ung' },
  reguler: { icon: '✅', label: 'Reguler', cls: 'rk-reg' },
  highrisk: { icon: '⚠️', label: 'High Risk', cls: 'rk-hi' },
  gorengan: { icon: '🔥', label: 'Gorengan', cls: 'rk-gor' },
};
function rkIcon(sym) {
  const s = signals.find(x => String(x.symbol) === String(sym));
  return s && s.risk && RK_META[s.risk] ? RK_META[s.risk].icon : '';
}

function showWlTab(name) {
  document.querySelectorAll('.wl-tabs button').forEach(b => b.classList.toggle('active', b.dataset.wl === name));
  $('#wlPanePantau').classList.toggle('hidden', name !== 'pantau');
  $('#wlPaneSinyal').classList.toggle('hidden', name !== 'sinyal');
  if (name === 'sinyal' && !signals.length) loadSignals(false);
}
document.querySelectorAll('.wl-tabs button').forEach(b =>
  b.addEventListener('click', () => showWlTab(b.dataset.wl))
);
$('#sigRefresh').addEventListener('click', () => loadSignals(true));
$('#sigSummary').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  sigFilter = chip.dataset.f;
  renderSignals();
});
$('#sigRisk').addEventListener('click', (e) => {
  const chip = e.target.closest('.chip');
  if (!chip) return;
  riskFilter = chip.dataset.r;
  renderSignals();
});
$('#sigList').addEventListener('click', (e) => {
  const row = e.target.closest('.sg-row');  if (row) onSelectSymbol(row.dataset.sym, row.dataset.name);
});
$('#mvWrap').addEventListener('click', (e) => {
  const it = e.target.closest('.mv-item');
  if (it) onSelectSymbol(it.dataset.sym, it.dataset.name);
});

/* ---- GERAK PASAR (ala Google Finance: movers seluruh IDX) ---- */
function renderMovers() {
  const el = $('#mvWrap');
  if (!el) return;
  const stocks = signals.filter(s => !String(s.symbol).startsWith('^') && s.price != null);
  if (!stocks.length) { el.innerHTML = ''; return; }
  const topGainers = [...stocks].sort((a, b) => (b.changePct || 0) - (a.changePct || 0)).slice(0, 5);
  const topLosers = [...stocks].sort((a, b) => (a.changePct || 0) - (b.changePct || 0)).slice(0, 5);
  const mostActive = [...stocks].sort((a, b) => (b.val || 0) - (a.val || 0)).slice(0, 5);
  const fmtVal = (v) => v >= 1e12 ? (v / 1e12).toFixed(2).replace('.', ',') + ' T'
    : v >= 1e9 ? (v / 1e9).toFixed(1).replace('.', ',') + ' M' : (v / 1e6).toFixed(0) + ' jt';
  const col = (title, cls, arr, valFn) =>
    `<div class="mv-col"><div class="mv-head ${cls}">${title}</div>` +
    arr.map(s =>
      `<div class="mv-item" data-sym="${escapeHtml(s.symbol)}" data-name="${escapeHtml(s.name || '')}">` +
      `<b>${rkIcon(s.symbol)}${escapeHtml(s.symbol)}</b><span class="${cls}">${valFn(s)}</span></div>`
    ).join('') + '</div>';
  el.innerHTML =
    col('▲ Penguat', 'up', topGainers, s => fmtPct(s.changePct)) +
    col('▼ Pelemah', 'down', topLosers, s => fmtPct(s.changePct)) +
    col('💰 Teraktif', 'act', mostActive, s => 'Rp ' + fmtVal(s.val || 0));
}

async function loadSignals(force) {
  const list = $('#sigList');
  if (!signals.length) {
    list.innerHTML = '<div class="wl-skel">Menganalisis 845+ simbol dengan 25 indikator…<br/>(lapis likuid ±1 menit saat pertama kali)</div>';
  }
  try {
    const r = await fetch(force ? '/api/signals?force=1' : '/api/signals');
    const j = await r.json();
    if (j.error) throw new Error(j.error);
    signals = (j.data || []).filter(x => !x.error && x.label);
    checkSignalChanges(signals);
    checkMarketEmaX(signals);
    autoObScan();
    renderSignals();
    updateWlSigDots();
    const el = $('#sigUpdated');
    if (el) el.textContent = wibNow().slice(0, 8);
    // Info progres pemindaian seluruh pasar + jadwalkan refresh cepat selama scan berjalan
    const inf = $('#sigScanInfo');
    const scanning = (j.tierA && j.tierA.running) || (j.tierB && j.tierB.running);
    if (inf) {
      inf.textContent = j.total
        ? `📡 Terpindai ${j.scanned}/${j.total} simbol • likuid ${j.tierA.done}/${j.tierA.total} • semua saham ${j.tierB.done}/${j.tierB.total}${scanning ? ' — memindai…' : ''}`
        : '';
    }
    clearTimeout(loadSignals._scanT);
    if (scanning && document.visibilityState === 'visible') {
      loadSignals._scanT = setTimeout(() => loadSignals(false), 15000);
    }
    if (!signals.length && scanning) {
      list.innerHTML = `<div class="wl-skel">Memindai pasar… ${j.scanned}/${j.total} simbol<br/>(hasil muncul bertahap)</div>`;
    }
  } catch (e) {
    if (!signals.length) list.innerHTML = '<div class="wl-skel">Gagal memuat sinyal. ' + escapeHtml(e.message || '') + '</div>';
  }
}

function updateWlSigDots() {
  const m = new Map(signals.map(s => [String(s.symbol), s]));
  for (const [sym, rec] of wlRows) {
    if (!rec.sigEl) continue;
    const s = m.get(sym);
    if (!s) continue;
    rec.sigEl.textContent = SIG_ABBR[s.label] || 'N';
    rec.sigEl.className = 'wl-sigdot ' + (SIG_CLS[s.label] || 'sg-neutral');
    rec.sigEl.title = 'Sinyal teknikal harian: ' + s.label;
  }
}

function renderSignals() {
  renderMovers();
  // --- chip kelas risiko ---
  const riskEl = $('#sigRisk');
  if (riskEl) {
    const rkCounts = Object.fromEntries(RK_ORDER.map(k => [k, 0]));
    for (const s of signals) if (s.risk && rkCounts[s.risk] != null) rkCounts[s.risk]++;
    riskEl.innerHTML =
      [`<button class="chip all ${riskFilter === 'Semua' ? 'active' : ''}" data-r="Semua">Semua kelas</button>`]
        .concat(RK_ORDER.map(k =>
          `<button class="chip ${RK_META[k].cls} ${riskFilter === k ? 'active' : ''}" data-r="${k}" title="${RK_META[k].label}">${RK_META[k].icon} ${RK_META[k].label} <b>${rkCounts[k]}</b></button>`
        )).join('');
  }

  // --- kelompokkan per label, saring kelas risiko bila dipilih ---
  const pool = riskFilter === 'Semua' ? signals : signals.filter(s => s.risk === riskFilter);
  const groups = { 'Strong Buy': [], 'Buy': [], 'Neutral': [], 'Sell': [], 'Strong Sell': [] };
  for (const s of pool) (groups[s.label] || groups['Neutral']).push(s);
  for (const k of SIG_ORDER) {
    groups[k].sort((a, b) => (k === 'Sell' || k === 'Strong Sell' ? a.score - b.score : b.score - a.score));
  }

  const counts = Object.fromEntries(SIG_ORDER.map(k => [k, groups[k].length]));
  $('#sigSummary').innerHTML =
    [`<button class="chip all ${sigFilter === 'Semua' ? 'active' : ''}" data-f="Semua">Semua <b>${pool.length}</b></button>`]
      .concat(SIG_ORDER.map(k =>
        `<button class="chip ${SIG_CLS[k]} ${sigFilter === k ? 'active' : ''}" data-f="${k}">${k} <b>${counts[k]}</b></button>`
      )).join('');
  const badge = $('#sigBadge');
  const nSB = counts['Strong Buy'] + counts['Strong Sell'];
  if (badge) {
    badge.textContent = nSB;
    badge.classList.toggle('hidden', nSB === 0);
  }

  const shown = sigFilter === 'Semua' ? SIG_ORDER : SIG_ORDER.filter(k => k === sigFilter);
  let html = '';
  for (const k of shown) {
    const arr = groups[k];
    if (!arr.length && sigFilter === 'Semua') continue;
    html += `<div class="sg-head ${SIG_CLS[k]}"><span class="dot"></span>${k.toUpperCase()} <span class="n">${arr.length}</span></div>`;
    if (!arr.length) { html += '<div class="al-empty">Tidak ada saham pada kategori ini.</div>'; continue; }
    for (const s of arr) {
      const idxCls = String(s.symbol).startsWith('^');
      const up = (s.changePct || 0) >= 0;
      const w = Math.round(((s.score + 1) / 2) * 100);
      const rk = s.risk && RK_META[s.risk];
      const rkBadge = rk
        ? `<span class="rk ${rk.cls}" title="${rk.icon} ${rk.label}${s.riskNote ? ' — ' + escapeHtml(s.riskNote) : ''}${s.sector ? ' • ' + escapeHtml(s.sector) : ''}">${rk.icon}</span>`
        : (idxCls ? '<span class="rk rk-idx" title="Indeks">📊</span>' : '');
      html +=
        `<div class="sg-row" data-sym="${escapeHtml(s.symbol)}" data-name="${escapeHtml(s.name || '')}">` +
        `<div class="sg-l"><b>${rkBadge}${escapeHtml(s.symbol)}${recentMark(s.symbol)}</b><span>${escapeHtml(s.name || '')}</span></div>` +
        `<div class="sg-bar" title="Skor ${fmtNum(s.score, 2)} • Beli ${s.buys} / Jual ${s.sells} / Netral ${s.neutrals}${s.sector ? ' • ' + escapeHtml(s.sector) : ''}"><i class="${SIG_CLS[k]}" style="width:${w}%"></i></div>` +
        `<div class="sg-r"><div class="sg-price">${s.price != null ? fmtPrice(s.price, idxCls) : '—'}</div>` +
        `<div class="sg-chg ${up ? 'up' : 'down'}">${fmtPct(s.changePct)}</div></div>` +
        `</div>`;
    }
  }
  $('#sigList').innerHTML = html || '<div class="al-empty">Tidak ada data.</div>';
}

/* ============================================================
   AUTO-ALERT SINYAL + RIWAYAT NOTIFIKASI
   Setiap poll sinyal (5 mnt) membandingkan label tiap simbol;
   bila berubah menjadi Strong Buy / Strong Sell → alert.
   ============================================================ */
const SIG_LB_KEY = 'idx-terminal-siglabels-v1';
const SIG_FIRED_KEY = 'idx-terminal-sigalert-fired-v1';
const HIST_KEY = 'idx-terminal-alert-history-v1';
const PREF_SIGALERT = 'idx-terminal-pref-sigalert';

let sigAlertOn = (() => {
  try { const v = localStorage.getItem(PREF_SIGALERT); return v == null ? true : v === '1'; }
  catch (e) { return true; }
})();
let alertHistory = [];
try { alertHistory = JSON.parse(localStorage.getItem(HIST_KEY) || '[]'); } catch (e) { alertHistory = []; }

let recentSigChanges = new Map(); // sym -> {ts, label}

function pushHistory(kind, text, sym, toLabel) {
  alertHistory.unshift({ ts: Date.now(), kind, text, sym, toLabel: toLabel || null });
  if (alertHistory.length > 100) alertHistory.length = 100;
  try { localStorage.setItem(HIST_KEY, JSON.stringify(alertHistory)); } catch (e) {}
  renderHistory();
}
function histIcon(h) {
  if (h.kind === 'ob') return '🧱';
  if (h.kind === 'zona') return '🎯';
  if (h.kind === 'konflu') return '💎';
  if (h.kind === 'emax') return '⚡';
  if (h.kind === 'rekap') return '📋';
  if (h.kind === 'sinyal') {
    if (h.toLabel === 'Strong Buy') return '🚀';
    if (h.toLabel === 'Strong Sell') return '🔻';
    return '🔄';
  }
  return '🔔';
}
function renderHistory() {
  const el = $('#alertHistory');
  if (!el) return;
  if (!alertHistory.length) {
    el.innerHTML = '<div class="al-empty">Belum ada notifikasi. Alert harga, Order Block, dan perubahan sinyal akan tercatat di sini.</div>';
    return;
  }
  el.innerHTML = alertHistory.slice(0, 50).map(h =>
    `<div class="hist-item"><span class="hist-ico">${histIcon(h)}</span>` +
    `<div class="hist-body"><div class="hist-text">${escapeHtml(h.text)}</div>` +
    `<div class="hist-meta">${h.sym ? escapeHtml(h.sym) + ' • ' : ''}${new Date(h.ts).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta', dateStyle: 'short', timeStyle: 'short' })} WIB</div></div></div>`
  ).join('');
}

function sigMarkChanged(sym, label) { recentSigChanges.set(sym, { ts: Date.now(), label }); }

function fireSignalAlert(sym, fromLabel, toLabel) {
  const up = toLabel === 'Strong Buy';
  const rk = rkIcon(sym);
  const msg = `${up ? '🚀' : '🔻'} ${sym} kini ${toLabel.toUpperCase()} (sebelumnya ${fromLabel})${rk ? ' • ' + rk : ''}`;
  toast(msg, 'ok');
  beep();
  notifyUser('DR Leo Martin IDX — Sinyal ' + toLabel, msg);
  pushHistory('sinyal', msg, sym, toLabel);
}

function checkSignalChanges(newSignals) {
  const cur = new Map(newSignals.map(s => [String(s.symbol), s.label]));
  let prev = null;
  try { prev = JSON.parse(localStorage.getItem(SIG_LB_KEY) || 'null'); } catch (e) {}
  try { localStorage.setItem(SIG_LB_KEY, JSON.stringify([...cur])); } catch (e) {}
  if (!prev || !Array.isArray(prev)) return; // baseline pertama → tanpa alert
  const prevMap = new Map(prev);
  if (!sigAlertOn) return;

  let fired = {};
  try { fired = JSON.parse(localStorage.getItem(SIG_FIRED_KEY) || '{}'); } catch (e) {}
  const now = Date.now();
  let firedChanged = false;

  for (const [sym, label] of cur) {
    const old = prevMap.get(sym);
    if (!old || old === label) continue;
    const toStrong = label === 'Strong Buy' || label === 'Strong Sell';
    const fromStrong = (old === 'Strong Buy' || old === 'Strong Sell') && !toStrong;
    if (toStrong) {
      const key = sym + '|' + label;
      if (fired[key] && now - fired[key] < 6 * 3600e3) continue; // anti-spam 6 jam
      fired[key] = now;
      firedChanged = true;
      fireSignalAlert(sym, old, label);
      sigMarkChanged(sym, label);
    } else if (fromStrong) {
      pushHistory('sinyal', `${sym} keluar dari ${old} → kini ${label}`, sym, label);
      sigMarkChanged(sym, label);
    }
  }
  for (const k of Object.keys(fired)) {
    if (now - fired[k] > 24 * 3600e3) { delete fired[k]; firedChanged = true; }
  }
  if (firedChanged) { try { localStorage.setItem(SIG_FIRED_KEY, JSON.stringify(fired)); } catch (e) {} }
}

function recentMark(sym) {
  const r = recentSigChanges.get(String(sym));
  return r && Date.now() - r.ts < 24 * 3600e3 ? ' <span class="sg-new" title="Sinyal baru berubah (<24 jam)">🆕</span>' : '';
}

function wirePrefChk(id, get, set, msgOn, msgOff, onEnable) {
  const el = $(id);
  if (!el) return;
  el.checked = get();
  el.addEventListener('change', () => {
    set(el.checked);
    toast(el.checked ? msgOn : msgOff, 'ok');
    if (el.checked && onEnable) onEnable();
  });
}
function initSignalAlertPref() {
  wirePrefChk('#sigAlertChk', () => sigAlertOn, v => { sigAlertOn = v; prefSet(PREF_SIGALERT, v); },
    '🔔 Alert sinyal otomatis AKTIF — diberi tahu saat ada saham jadi Strong Buy/Sell',
    '🔕 Alert sinyal otomatis dinonaktifkan');
  wirePrefChk('#obAlertChk', () => obAlertOn, v => { obAlertOn = v; prefSet(PREF_OBALERT, v); },
    '🧱 Alert Order Block AKTIF — setiap OB baru (52 simbol, harian)',
    '🔕 Alert Order Block dinonaktifkan', () => autoObScan());
  wirePrefChk('#zoneAlertChk', () => zoneAlertOn, v => { zoneAlertOn = v; prefSet(PREF_ZONEALERT, v); },
    '🎯 Alert zona entry AKTIF — diberi tahu saat harga memasuki zona OB aktif',
    '🔕 Alert zona entry dinonaktifkan', () => autoObScan());
  wirePrefChk('#confAlertChk', () => confAlertOn, v => { confAlertOn = v; prefSet(PREF_CONFALERT, v); },
    '💎 Alert konfluensi AKTIF — Strong Buy/Sell + OB segar selaras',
    '🔕 Alert konfluensi dinonaktifkan', () => autoObScan());
  wirePrefChk('#emaxAlertChk', () => emaxAlertOn, v => { emaxAlertOn = v; prefSet(PREF_EMAXALERT, v); },
    '⚡ Alert EMA cross AKTIF — 3/7 BUY · 2/6 SELL mengikuti timeframe chart',
    '🔕 Alert EMA cross dinonaktifkan', () => checkEmaXAlert());
  wirePrefChk('#emaxAllChk', () => mxAlertOn, v => { mxAlertOn = v; prefSet(PREF_MXALERT, v); },
    '⚡ Alert EMA cross seluruh pasar AKTIF — setiap cross harian 3/7 & 2/6 di 845 saham',
    '🔕 Alert EMA cross seluruh pasar dinonaktifkan', () => checkMarketEmaX(signals));
  wirePrefChk('#recapChk', () => recapOn, v => { recapOn = v; prefSet(PREF_RECAP, v); },
    '📋 Rekap harian 09.00 WIB AKTIF', '🔕 Rekap harian dinonaktifkan', () => checkDailyRecap());
  // pulihkan penanda 🆕 dari riwayat (<24 jam)
  for (const h of alertHistory) {
    if (h.kind === 'sinyal' && h.sym && Date.now() - h.ts < 24 * 3600e3) recentSigChanges.set(h.sym, { ts: h.ts, label: h.toLabel });
  }
}
$('#histClear').addEventListener('click', () => {
  alertHistory = [];
  try { localStorage.removeItem(HIST_KEY); } catch (e) {}
  renderHistory();
  toast('Riwayat notifikasi dihapus.', 'ok');
});

/* ============================================================
   AUTO-ALERT ORDER BLOCK — scan semua simbol (harian)
   Tiap siklus sinyal (5 mnt) server mengirim OB terbaru;
   OB dengan formedTs lebih baru dari yang tersimpan → alert.
   ============================================================ */
const OB_SEEN_KEY = 'idx-terminal-obscan-seen-v1';
const OB_FIRED_KEY = 'idx-terminal-ob-fired-v1';
const PREF_OBALERT = 'idx-terminal-pref-obalert';

let obAlertOn = (() => {
  try { const v = localStorage.getItem(PREF_OBALERT); return v == null ? true : v === '1'; }
  catch (e) { return true; }
})();
let obScanSeen = {};
try { obScanSeen = JSON.parse(localStorage.getItem(OB_SEEN_KEY) || '{}'); } catch (e) {}
let obFired = {};
try { obFired = JSON.parse(localStorage.getItem(OB_FIRED_KEY) || '{}'); } catch (e) {}

function obKeyOf(sym, ob) {
  return sym + '|' + ob.type + '|' + (ob.formedTime || '') + '|' + Math.round(ob.bottom * 100) + '|' + Math.round(ob.top * 100);
}
function obAlreadyFired(sym, ob) {
  const t = obFired[obKeyOf(sym, ob)];
  return t != null && Date.now() - t < 7 * 24 * 3600e3;
}
function obMarkFired(sym, ob) {
  obFired[obKeyOf(sym, ob)] = Date.now();
  const now = Date.now();
  for (const k of Object.keys(obFired)) if (now - obFired[k] > 7 * 24 * 3600e3) delete obFired[k];
  try { localStorage.setItem(OB_FIRED_KEY, JSON.stringify(obFired)); } catch (e) {}
}

let obScanRunning = false;
async function autoObScan() {
  if (obScanRunning) return;
  const syms = [...wlRows.keys()];
  if (!syms.length) return;
  obScanRunning = true;
  try {
    const r = await fetch('/api/orderblocks?symbols=' + syms.map(encodeURIComponent).join(','));
    const j = await r.json();
    const rows = j.data || [];
    const isBaseline = Object.keys(obScanSeen).length === 0;
    let firedCount = 0;
    for (const row of rows) {
      const sym = String(row.symbol).replace(/\.JK$/, '');
      const obs = row.obs || [];
      if (!obs.length) continue;
      const newest = obs[0].formedTs || 0;
      const prevTs = obScanSeen[sym] || 0;
      const newObs = obs.filter(o => (o.formedTs || 0) > prevTs && (o.formedTs || 0) > 0);
      obScanSeen[sym] = Math.max(prevTs, newest);
      if (isBaseline || !obAlertOn || !newObs.length) continue;
      for (const ob of newObs) {
        if (obAlreadyFired(sym, ob)) continue;
        obMarkFired(sym, ob);
        firedCount = fireObScan(sym, ob, firedCount);
      }
    }
    try { localStorage.setItem(OB_SEEN_KEY, JSON.stringify(obScanSeen)); } catch (e) {}
    if (firedCount > 5) toast(`🧱 +${firedCount - 5} Order Block lainnya juga terbentuk — lihat Riwayat Notifikasi.`, 'ok');
    checkEntryZones(rows);
    checkConfluence(rows);
  } catch (e) {}
  obScanRunning = false;
}

function fireObScan(sym, ob, count) {
  const idxCls = String(sym).startsWith('^');
  const dir = ob.type === 'bull' ? 'BULLISH 🟢' : 'BEARISH 🔴';
  const msg = `🧱 OB ${dir} baru terbentuk — ${sym} • zona ${fmtPrice(ob.bottom, idxCls)}–${fmtPrice(ob.top, idxCls)} (${ob.formedTime})`;
  pushHistory('ob', msg, sym, ob.type === 'bull' ? 'Bullish' : 'Bearish');
  if (count < 5) { // batasi 5 notifikasi penuh per siklus
    toast(msg, 'ok');
    beep();
    notifyUser(`DR Leo Martin IDX — Order Block ${sym}`, msg);
  }
  return count + 1;
}

/* ============================================================
   AUTO-ALERT LANJUTAN
   🎯 zona entry — harga memasuki zona OB aktif (out→in)
   💎 konfluensi — Strong Buy/Sell + OB segar (<5 hari) searah
   📋 rekap harian — ringkasan pasar pukul 09.00 WIB
   ============================================================ */
const PREF_ZONEALERT = 'idx-terminal-pref-zonealert';
const PREF_CONFALERT = 'idx-terminal-pref-confalert';
const PREF_RECAP = 'idx-terminal-pref-recap';
const ZONE_ST_KEY = 'idx-terminal-zonestate-v1';
const ZONE_FIRED_KEY = 'idx-terminal-zonefired-v1';
const CONF_FIRED_KEY = 'idx-terminal-conffired-v1';
const CONF_INIT_KEY = 'idx-terminal-conf-init-v1';
const RECAP_DAY_KEY = 'idx-terminal-recapday-v1';

function prefGet(key, def) {
  try { const v = localStorage.getItem(key); return v == null ? def : v === '1'; } catch (e) { return def; }
}
function prefSet(key, on) { try { localStorage.setItem(key, on ? '1' : '0'); } catch (e) {} }
function lsGet(key, def) {
  try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v == null ? def : v; } catch (e) { return def; }
}
function lsSet(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
function dayKeyJakarta(d) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d || new Date());
}

let zoneAlertOn = prefGet(PREF_ZONEALERT, true);
let confAlertOn = prefGet(PREF_CONFALERT, true);
let recapOn = prefGet(PREF_RECAP, true);
let zoneState = lsGet(ZONE_ST_KEY, {});
let zoneFired = lsGet(ZONE_FIRED_KEY, {});
let confFired = lsGet(CONF_FIRED_KEY, {});

function sigPrice(sym) {
  const s = signals.find(x => String(x.symbol) === sym || String(x.symbol).replace(/\.JK$/, '') === String(sym).replace(/\.JK$/, ''));
  return s && s.price != null ? s.price : null;
}

/* 🎯 Harga memasuki zona OB aktif (belum broken) → area entry */
function checkEntryZones(rows) {
  if (!signals.length) return;
  const now = Date.now();
  const firstRun = Object.keys(zoneState).length === 0; // baseline pertama → diam
  const events = [];
  for (const row of rows) {
    const sym = String(row.symbol).replace(/\.JK$/, '');
    const price = sigPrice(row.symbol);
    if (price == null || String(row.symbol).startsWith('^')) continue;
    const zone = (row.obs || []).find(o => !o.broken && price >= o.bottom && price <= o.top);
    const prev = zoneState[sym] || { st: 'out' };
    const next = zone
      ? { st: zone.type === 'bull' ? 'in-bull' : 'in-bear', bottom: zone.bottom, top: zone.top, formedTime: zone.formedTime }
      : { st: 'out' };
    zoneState[sym] = next;
    if (firstRun || prev.st !== 'out' || next.st === 'out') continue; // hanya transisi keluar→masuk
    const key = sym + '|' + next.st + '|' + Math.round(next.bottom * 100) + '|' + Math.round(next.top * 100);
    if (now - (zoneFired[key] || 0) < 12 * 3600e3) continue; // anti-spam 12 jam per zona
    zoneFired[key] = now;
    events.push({ sym, ...next });
  }
  for (const k of Object.keys(zoneFired)) if (now - zoneFired[k] > 7 * 864e5) delete zoneFired[k];
  lsSet(ZONE_ST_KEY, zoneState);
  lsSet(ZONE_FIRED_KEY, zoneFired);
  if (!zoneAlertOn || !events.length) return;
  events.slice(0, 5).forEach((ev, i) => fireZoneEntry(ev, i));
  if (events.length > 5) toast(`🎯 +${events.length - 5} saham lain juga memasuki zona OB — lihat Riwayat Notifikasi.`, 'ok');
}
function fireZoneEntry(ev, i) {
  const idxCls = String(ev.sym).startsWith('^');
  const bull = ev.st === 'in-bull';
  const msg = `🎯 ${ev.sym} memasuki zona OB ${bull ? 'BULLISH 🟢' : 'BEARISH 🔴'} (${fmtPrice(ev.bottom, idxCls)}–${fmtPrice(ev.top, idxCls)}) — area ${bull ? 'entry BUY' : 'entry SELL'}`;
  pushHistory('zona', msg, ev.sym, bull ? 'Bullish' : 'Bearish');
  if (i < 5) setTimeout(() => { toast(msg, 'ok'); beep(); notifyUser('DR Leo Martin IDX — Zona Entry ' + ev.sym, msg); }, i * 650);
}

/* 💎 Konfluensi: Strong Buy/Sell + OB segar (<5 hari) searah */
function checkConfluence(rows) {
  if (!signals.length) return;
  const now = Date.now();
  const dk = dayKeyJakarta();
  const fresh = [];
  for (const row of rows) {
    const sym = String(row.symbol).replace(/\.JK$/, '');
    for (const ob of row.obs || []) {
      if (ob.broken) continue;
      if (now - (ob.formedTs || 0) * 1000 < 5 * 864e5) fresh.push({ sym, type: ob.type, ob });
    }
  }
  const initDone = prefGetRaw(CONF_INIT_KEY);
  const toFire = [];
  for (const s of signals) {
    if (String(s.symbol).startsWith('^')) continue;
    if (s.label !== 'Strong Buy' && s.label !== 'Strong Sell') continue;
    const sym = String(s.symbol).replace(/\.JK$/, '');
    const want = s.label === 'Strong Buy' ? 'bull' : 'bear';
    const hit = fresh.find(f => f.sym === sym && f.type === want);
    if (!hit) continue;
    const key = sym + '|' + want + '|' + dk;
    if (confFired[key]) continue;
    confFired[key] = now;
    toFire.push({ sym, label: s.label, ob: hit.ob });
  }
  for (const k of Object.keys(confFired)) if (now - confFired[k] > 3 * 864e5) delete confFired[k];
  lsSet(CONF_FIRED_KEY, confFired);
  try { localStorage.setItem(CONF_INIT_KEY, '1'); } catch (e) {}
  if (!initDone) return; // baseline pertama → tandai tanpa notifikasi
  if (!confAlertOn || !toFire.length) return;
  toFire.slice(0, 3).forEach((ev, i) => fireConfluence(ev, i));
  if (toFire.length > 3) toast(`💎 +${toFire.length - 3} konfluensi lain — lihat Riwayat Notifikasi.`, 'ok');
}
function prefGetRaw(key) { try { return localStorage.getItem(key) != null; } catch (e) { return false; } }
function fireConfluence(ev, i) {
  const up = ev.label === 'Strong Buy';
  const msg = `💎 KONFLUENSI ${up ? 'BULLISH' : 'BEARISH'} — ${ev.sym} ${ev.label.toUpperCase()} + OB ${up ? 'bullish' : 'bearish'} segar ${ev.ob.formedTime} (zona ${fmtPrice(ev.ob.bottom)}–${fmtPrice(ev.ob.top)})`;
  pushHistory('konflu', msg, ev.sym, ev.label);
  if (i < 3) setTimeout(() => { toast(msg, 'ok'); beep(); setTimeout(beep, 350); notifyUser('DR Leo Martin IDX — Konfluensi ' + ev.sym, msg); }, i * 700);
}

/* ⚡ EMA cross 3/7 BUY · 2/6 SELL — mengikuti timeframe chart */
const PREF_EMAXALERT = 'idx-terminal-pref-emaxalert';
const EMAX_SEEN_KEY = 'idx-terminal-emax-seen-v1';
const EMAX_FIRED_KEY = 'idx-terminal-emax-fired-v1';
let emaxAlertOn = prefGet(PREF_EMAXALERT, true);
let emaxSeen = lsGet(EMAX_SEEN_KEY, {});
let emaxFired = lsGet(EMAX_FIRED_KEY, {});

function checkEmaXAlert() {
  if (!state.bars.length) return;
  const sym = state.symbol;
  const tfI = TFS[state.tf].interval;
  const scope = sym + '|' + tfI;
  const lastBarT = barTimeVal(state.bars[state.bars.length - 1].time);
  const prevT = emaxSeen[scope];
  emaxSeen[scope] = lastBarT; // tandai bar terakhir yang sudah diproses
  lsSet(EMAX_SEEN_KEY, emaxSeen);
  if (prevT == null) return; // baseline pertama untuk simbol+TF ini → diam
  if (!emaxAlertOn) return;

  const { buys, sells } = emaCrossSignals(state.bars);
  const fresh = [
    ...buys.map(x => ({ dir: 'BUY', ...x })),
    ...sells.map(x => ({ dir: 'SELL', ...x })),
  ].filter(x => barTimeVal(x.time) > prevT && barTimeVal(x.time) <= lastBarT);
  if (!fresh.length) return;

  const now = Date.now();
  let changed = false;
  for (const k of Object.keys(emaxFired)) if (now - emaxFired[k] > 7 * 864e5) { delete emaxFired[k]; changed = true; }
  fresh.slice(0, 3).forEach((x, i) => {
    const key = scope + '|' + x.dir + '|' + String(x.time);
    if (emaxFired[key]) return;
    emaxFired[key] = now;
    changed = true;
    fireEmaX(x.dir, x.time, x.close, tfI, i);
  });
  if (changed) lsSet(EMAX_FIRED_KEY, emaxFired);
}
function fireEmaX(dir, time, close, tfI, i) {
  const buy = dir === 'BUY';
  const idxCls = String(state.symbol).startsWith('^');
  const msg = `⚡ ${state.symbol} — EMA ${buy ? '3 cross NAIK 7' : '2 cross TURUN 6'} → ${dir} @ ${fmtPrice(close, idxCls)} (TF ${tfI})`;
  pushHistory('emax', msg, state.symbol, dir);
  setTimeout(() => { toast(msg, 'ok'); beep(); notifyUser(`DR Leo Martin IDX — EMA Cross ${dir} ${state.symbol}`, msg); }, i * 600);
}

/* ⚡ EMA cross harian SELURUH PASAR — dari pemindai server (/api/signals)
   Setiap cross 3/7 (BUY) / 2/6 (SELL) pada bar harian terbaru → alert. */
const PREF_MXALERT = 'idx-terminal-pref-mxalert';
const MX_FIRED_KEY = 'idx-terminal-mxfired-v1';
const MX_INIT_KEY = 'idx-terminal-mxinit-v1';
let mxAlertOn = prefGet(PREF_MXALERT, true);
let mxFired = lsGet(MX_FIRED_KEY, {});

function checkMarketEmaX(rows) {
  const now = Date.now();
  const dk = dayKeyJakarta();
  const hits = [];
  for (const s of rows) {
    if (String(s.symbol).startsWith('^')) continue;
    if (s.emaxBuy) {
      const key = s.symbol + '|BUY|' + dk;
      if (!mxFired[key]) { mxFired[key] = now; hits.push({ sym: s.symbol, dir: 'BUY', price: s.price, risk: s.risk }); }
    }
    if (s.emaxSell) {
      const key = s.symbol + '|SELL|' + dk;
      if (!mxFired[key]) { mxFired[key] = now; hits.push({ sym: s.symbol, dir: 'SELL', price: s.price, risk: s.risk }); }
    }
  }
  for (const k of Object.keys(mxFired)) if (now - mxFired[k] > 14 * 864e5) { delete mxFired[k]; }
  lsSet(MX_FIRED_KEY, mxFired);
  const initDone = prefGetRaw(MX_INIT_KEY);
  try { localStorage.setItem(MX_INIT_KEY, '1'); } catch (e) {}
  if (!initDone) return; // baseline pertama → tandai semua tanpa notifikasi
  if (!mxAlertOn || !hits.length) return;
  hits.slice(0, 5).forEach((h, i) => fireMx(h, i));
  if (hits.length > 5) toast(`⚡ +${hits.length - 5} EMA cross lain — lihat Riwayat Notifikasi.`, 'ok');
}
function fireMx(h, i) {
  const buy = h.dir === 'BUY';
  const rk = h.risk && RK_META[h.risk] ? ' • ' + RK_META[h.risk].icon : '';
  const idxCls = String(h.sym).startsWith('^');
  const msg = `⚡ ${h.sym}${rk} — EMA ${buy ? '3 cross NAIK 7' : '2 cross TURUN 6'} → ${h.dir} @ ${fmtPrice(h.price, idxCls)} (harian)`;
  pushHistory('emax', msg, h.sym, h.dir);
  if (i < 5) setTimeout(() => { toast(msg, 'ok'); beep(); notifyUser(`DR Leo Martin IDX — EMA Cross ${h.dir} ${h.sym}`, msg); }, i * 600);
}

/* 📋 Rekap harian 09.00 WIB (jendela 08:55–09:30, sekali sehari) */
function checkDailyRecap() {
  if (!recapOn || !signals.length) return;
  let wib;
  try { wib = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Jakarta' })); } catch (e) { return; }
  const mins = wib.getHours() * 60 + wib.getMinutes();
  if (mins < 8 * 60 + 55 || mins > 9 * 60 + 30) return;
  const dk = dayKeyJakarta();
  try { if (localStorage.getItem(RECAP_DAY_KEY) === dk) return; localStorage.setItem(RECAP_DAY_KEY, dk); } catch (e) {}
  sendDailyRecap();
}
function sendDailyRecap() {
  const stocks = signals.filter(s => !String(s.symbol).startsWith('^'));
  const ihsg = signals.find(s => String(s.symbol) === '^JKSE');
  const sb = stocks.filter(s => s.label === 'Strong Buy');
  const ss = stocks.filter(s => s.label === 'Strong Sell');
  const names = arr => arr.slice(0, 5).map(s => String(s.symbol).replace(/\.JK$/, '')).join(', ');
  const plus = n => (n > 5 ? ` +${n - 5} lainnya` : '');
  const ob24 = alertHistory.filter(h => h.kind === 'ob' && Date.now() - h.ts < 864e5).length;
  const x24 = alertHistory.filter(h => h.kind === 'emax' && Date.now() - h.ts < 864e5).length;
  const lines = [
    ihsg ? `📊 IHSG ${fmtPrice(ihsg.price, true)} (${fmtPct(ihsg.changePct)})` : null,
    `🚀 Strong Buy: ${sb.length} saham${sb.length ? ' — ' + names(sb) + plus(sb.length) : ''}`,
    `🔻 Strong Sell: ${ss.length} saham${ss.length ? ' — ' + names(ss) + plus(ss.length) : ''}`,
    `🧱 OB baru 24 jam: ${ob24}`,
    `⚡ EMA cross 24 jam: ${x24}`,
  ].filter(Boolean);
  const body = lines.join('\n');
  pushHistory('rekap', '📋 Rekap harian: ' + body.replace(/\n/g, ' • '), null, null);
  toast('📋 Rekap harian 09.00 WIB terkirim — buka Riwayat Notifikasi.', 'ok');
  beep();
  notifyUser('DR Leo Martin IDX — Rekap Harian 09.00 WIB', body);
}

/* ============================================================
   PWA — izin notifikasi, instalasi Android, background sync
   ============================================================ */
let deferredInstall = null;
function initPwa() {
  const installBtn = $('#btnInstall');
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        // Periodic Background Sync (Chrome Android, best effort)
        if ('periodicSync' in reg && navigator.permissions && navigator.permissions.query) {
          navigator.permissions.query({ name: 'periodic-background-sync' }).then((st) => {
            if (st.state === 'granted') reg.periodicSync.register('idx-scan', { minInterval: 6 * 3600e3 }).catch(() => {});
          }).catch(() => {});
        }
      }).catch(() => {});
    });
  }
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredInstall = e;
    const b = $('#btnInstall');
    if (b) b.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    deferredInstall = null;
    const b = $('#btnInstall');
    if (b) b.classList.add('hidden');
    toast('✅ DR Leo Martin IDX terpasang — buka dari layar utama Anda.', 'ok');
  });
  if (installBtn) installBtn.addEventListener('click', async () => {
    if (!deferredInstall) {
      toast('Di Chrome Android: menu ⋮ → "Instal aplikasi" / "Add to Home screen".', 'ok');
      return;
    }
    deferredInstall.prompt();
    try { await deferredInstall.userChoice; } catch (e) {}
    deferredInstall = null;
    installBtn.classList.add('hidden');
  });
}

/* ============================================================
   POLLING & INIT
   ============================================================ */
setInterval(tickClock, 1000);
setInterval(() => { if (document.visibilityState === 'visible') loadWatchlist(false); }, 30000);
setInterval(() => { if (document.visibilityState === 'visible') loadChart(state.symbol, { silent: true }); }, 60000);
setInterval(() => { if (document.visibilityState === 'visible') checkAlerts(); }, 30000);
setInterval(() => { if (document.visibilityState === 'visible') checkObAlerts(); }, 300000);

resizeChart();
tickClock();
renderAlerts();
renderHistory();
initSignalAlertPref();
initPwa();
updateIndCount();
loadWatchlist(true);
loadChart('BBCA');
setTimeout(checkAlerts, 8000);
setTimeout(() => loadSignals(false), 3000);
setTimeout(checkDailyRecap, 20000);
setInterval(() => { if (document.visibilityState === 'visible') loadSignals(false); }, 300000);
setInterval(checkDailyRecap, 60000);

})();
