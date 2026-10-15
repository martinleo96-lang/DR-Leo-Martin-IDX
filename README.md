# IDX Terminal — Chart Saham Indonesia ala TradingView

Aplikasi web untuk memantau & menganalisis saham Bursa Efek Indonesia (BEI/IDX)
dengan tampilan dan fitur mirip TradingView.

## Fitur

- **Chart interaktif** (Lightweight Charts™ dari TradingView): geser, zoom, crosshair
- **Jenis chart**: Lilin (Candlestick), Batang (OHLC), Garis, Area
- **Rentang waktu**: 1D (5 mnt), 5D (15 mnt), 1M (30 mnt), 3M–1Y (harian), 5Y (mingguan)
- **Indikator teknikal** (menu ƒx Indikator): Volume, MA 20/50, EMA 20, Bollinger Bands (20,2),
  **VWAP**, RSI (14), MACD (12,26,9), **Stochastic (14,3,3)**, **ATR (14)**
- **EMA Cross marker** (menu ƒx Indikator, aktif bawaan): tanda **▲ BUY** di bawah lilin saat
  **EMA 3 cross naik EMA 7**, dan tanda **▼ SELL** di atas lilin saat **EMA 2 cross turun EMA 6** —
  dihitung pada **timeframe chart yang sedang dipilih** (1D/5m … 5Y/1wk), dengan **alert otomatis
  ⚡** untuk cross terbaru (toast + bunyi + notifikasi, anti-spam per simbol+TF)
- **Analisis Teknikal otomatis** ala TradingView (tab *Teknikal*): gauge ringkasan
  **Strong Sell → Strong Buy** + tabel sinyal dari 25 indikator —
  10 osilator (RSI, Stochastic, CCI, ADX, Awesome Osc, Momentum, MACD, Williams %R,
  Bull Bear Power, Ultimate Osc) + 15 moving average (EMA/SMA 10–200, VWMA, Hull MA, Ichimoku Base)
- **Pemindai Sinyal / Signal Scanner** (tab *Sinyal* di watchlist): seluruh 52 simbol
  (saham + indeks) dianalisis otomatis dan dikelompokkan menjadi **Strong Buy / Buy /
  Neutral / Sell / Strong Sell** — lengkap dengan skor, bar kekuatan sinyal, harga &
  perubahan, chip filter, dan badge SB/B/N/S/SS di setiap baris watchlist
  (dihitung server via `GET /api/signals`, cache 5 menit)
- **Alert sinyal otomatis (rutin tiap 5 menit)**: setiap kali ada saham yang *berubah menjadi*
  **Strong Buy / Strong Sell**, aplikasi langsung memberi notifikasi (bunyi + toast + notifikasi
  browser) — bisa dimatikan lewat checkbox di tab Sinyal, anti-spam 6 jam, dan saham yang
  keluar dari zona Strong juga dicatat
- **Riwayat Notifikasi** (tab *Alert*): semua kejadian (alert harga, Order Block, perubahan
  sinyal) tercatat dengan ikon & waktu WIB — penanda 🆕 muncul di daftar Sinyal untuk saham
  yang sinyalnya baru berubah (<24 jam)
- **Alert harga** (tab *Alert*): kondisi naik-menembus (≥) / turun-menembus (≤),
  dicek setiap 30 detik, notifikasi browser + bunyi + toast, tersimpan permanen di browser
  (localStorage), badge jumlah alert aktif di lonceng topbar
- **Alert Order Block (SMC)** — port indikator *"Volumized Order Blocks | Flux Charts"* (Pine v5):
  zona Order Block bullish (hijau) / bearish (merah) **digambar langsung di chart**
  (swing length 10, filter 3,5×ATR(10), invalidasi wick → breaker putus-putus, volume split
  up/down di dalam zona)
- **Auto-alert Order Block global (rutin tiap 5 menit)**: seluruh 52 simbol dipindai;
  setiap OB baru terbentuk (harian) langsung memicu notifikasi — baseline awal tanpa spam,
  anti-duplikat lintas jalur (scan global ↔ alert per-simbol ↔ deteksi chart), maks 5
  notifikasi per siklus, bisa dimatikan lewat checkbox di tab Sinyal
- **Alert OB per-simbol**: jenis alert *"Order Block baru terbentuk"* untuk pantauan khusus
  (termasuk timeframe intraday saat chart terbuka), via `GET /api/orderblocks?symbols=...`
- **Watchlist 50+ saham** populer/LQ45 + indeks **IHSG** dan **LQ45**, lengkap dengan harga,
  perubahan %, dan mini sparkline — diperbarui otomatis tiap 30 detik
- **Pencarian saham** seluruh BEI (kode atau nama perusahaan)
- **Panel detail**: OHLC, volume, rata-rata volume, tertinggi/terendah 52 minggu
- **Status pasar & jam WIB** sesuai jam perdagangan BEI (termasuk jadwal Jumat)
- **Data live** dari Yahoo Finance (simbol `.JK`, delay ±15 menit), dengan
  fallback **mode simulasi** otomatis bila koneksi data tidak tersedia (ditandai badge SIMULASI)
- Auto-refresh chart tiap 60 detik

## Menjalankan

Butuh Node.js ≥ 18 (tanpa dependency npm apa pun):

```bash
node server.js
# buka http://localhost:3000
```

Port bisa diubah: `PORT=8080 node server.js`

## Struktur

```
idx-terminal/
├── server.js                 # backend: proxy Yahoo Finance + static host + fallback simulasi
├── public/
│   ├── index.html            # layout aplikasi (+ meta PWA)
│   ├── styles.css            # tema gelap ala TradingView
│   ├── app.js                # logika chart, indikator, watchlist, auto-alert dsb.
│   ├── manifest.webmanifest  # manifest PWA (installable)
│   ├── sw.js                 # Service Worker: offline shell + Periodic Background Sync
│   ├── icons/                # ikon PWA 192/512/maskable
│   └── vendor/
│       └── lightweight-charts.js   # TradingView Lightweight Charts v4.2.3 (Apache-2.0)
└── README.md
```

## 📲 Pasang di Android (PWA)

Aplikasi ini adalah **PWA** — bisa dipasang ke layar utama dan tampil fullscreen seperti aplikasi native:

1. Buka aplikasi di **Chrome Android** (gunakan HTTPS = URL preview, bukan `http://` bare IP).
2. Ketuk ikon **⬇️ di toolbar** aplikasi, atau menu **⋮ → "Instal aplikasi" / "Add to Home screen"**.
3. **Izinkan notifikasi** saat diminta (cek site settings bila sebelumnya diblok).
4. Selesai — buka dari ikon **IDX Terminal** di home screen.

Cara kerja alert otomatis setelah terinstal:

| Mekanisme | Keterangan |
| --- | --- |
| **App terbuka / PWA berjalan** | Semua alert aktif penuh: sinyal (5 mnt), OB, zona entry, konfluensi, rekap 09.00 WIB — dengan toast + bunyi + notifikasi sistem via Service Worker. |
| **App ditutup (latar belakang)** | **Periodic Background Sync** (`idx-scan`, tiap ±6 jam, Chrome Android, *best effort*) — Service Worker memindai 52 simbol dan menampilkan notifikasi sistem bila ada saham baru Strong Buy/Sell atau OB baru. Jadwal pasti ditentukan OS (penggunaan baterai, dsb.). |
| **Offline** | App shell ter-cache — aplikasi tetap terbuka; data live membutuhkan koneksi. |

> ⚠️ Jujur soal batasan: tidak ada Web Push server (butuh server push + berlangganan VAPID), jadi pemindaian latar belakang bersifat *best effort* ala Chrome. Untuk alert seketika (5 menit), biarkan PWA terbuka di latar belakang.

## 🔔 Alert otomatis (semua bisa dimatikan di tab Sinyal)

1. **🔔 Sinyal** — saham menjadi Strong Buy / Strong Sell (dipindai tiap 5 mnt, anti-spam 6 jam).
2. **🧱 Order Block** — OB bullish/bearish baru terbentuk (52 simbol, data harian, maks 5 notif/siklus).
3. **🎯 Zona entry** — harga **memasuki** zona OB aktif (belum broken) → area entry BUY/SELL (transisi keluar→masuk, anti-spam 12 jam per zona).
4. **💎 Konfluensi** — Strong Buy/Sell **+** OB segar (<5 hari) selaras (double beep, sekali per saham per hari).
5. **⚡ EMA cross** — 3/7 ↑ BUY / 2/6 ↓ SELL pada saham yang sedang dibuka, **mengikuti timeframe chart** (5m/15m/30m/1d/1wk); cross terbaru terdeteksi tiap refresh chart 60 detik.
6. **📋 Rekap harian 09.00 WIB** — ringkasan pasar: IHSG, jumlah+nama Strong Buy/Sell, OB baru 24 jam, EMA cross 24 jam.

Semua notifikasi tercatat di **Riwayat Notifikasi** (ikon 🔔 → tab Alert), 100 entri terakhir.

## API internal

| Endpoint | Keterangan |
| --- | --- |
| `GET /api/chart?symbol=BBCA&range=6mo&interval=1d` | Data OHLCV (format Yahoo Finance) |
| `GET /api/search?q=telkom` | Cari saham/indeks BEI |
| `GET /api/watchlist` | Harga terkini seluruh daftar pantau |
| `GET /api/quotes?symbols=BBCA,TLKM` | Harga terkini simbol tertentu |
| `GET /api/signals` | Sinyal teknikal (Strong Buy…Strong Sell) 52 simbol |
| `GET /api/orderblocks?symbols=BBCA,TLKM` | Order Blocks (SMC) terbaru per simbol (tanpa `symbols` = semua 52 simbol) |

## Catatan

Data bersumber dari Yahoo Finance dan dapat tertunda ±15 menit. Aplikasi ini hanya untuk
keperluan informasi/edukasi — **bukan rekomendasi investasi**.
