# 🚀 Deploy IDX Terminal

Aplikasi ini **zero-dependency** (Node.js bawaan saja, tanpa `npm install`).
Syarat hosting: **Node.js ≥ 18**.

---

## 1️⃣ Taruh kode di GitHub Anda

### Cara A — lewat web GitHub (termudah, tanpa install apa pun)
1. Buat repo baru di <https://github.com/new> → nama misal `idx-terminal` → **Public/Private** → *Create repository*.
2. Di halaman repo kosong, klik **"uploading an existing file"**.
3. Ekstrak file **`idx-terminal.zip`** dari paket ini, lalu **drag-drop semua file & folder** (`server.js`, `public/`, `package.json`, `README.md`, dst).
4. Klik **Commit changes**. Selesai ✅

### Cara B — lewat git (di komputer Anda)
```bash
git clone https://github.com/USERNAME/idx-terminal.git
cd idx-terminal
# salin semua isi paket ini ke folder repo, lalu:
git add -A
git commit -m "IDX Terminal: rilis awal"
git push origin main
```

> 💡 Kalau Anda punya **Personal Access Token** GitHub
> (<https://github.com/settings/tokens> → *Generate new token (classic)* → centang `repo`),
> kirim token + nama repo ke asisten — kode bisa **langsung di-push dari sini**.

---

## 2️⃣ Hidupkan 24/7 (agar link & alert jalan terus)

⚠️ **GitHub Pages TIDAK bisa** menjalankan aplikasi ini — Pages hanya untuk situs statis,
sedangkan IDX Terminal punya backend Node.js (proxy data Yahoo Finance + API).
Solusinya: hosting Node gratis yang mengambil kode langsung dari repo GitHub Anda.

### Render.com (gratis, direkomendasikan)
1. Daftar/login di <https://render.com> (bisa via akun GitHub).
2. **New → Web Service → Connect** repo `idx-terminal`.
3. Isi:
   - **Build Command:** *(kosongkan)* — tidak ada dependency
   - **Start Command:** `node server.js`
4. **Create Web Service** → tunggu ±2 menit.
5. Anda dapat URL permanen, misal `https://idx-terminal.onrender.com` 🎉

Server otomatis membaca `PORT` dari lingkungan Render — tidak ada yang perlu diubah.

> Catatan: paket gratis Render "tidur" setelah ±15 menit tanpa kunjungan; kunjungan
> pertama butuh ±30 detik untuk bangun. Untuk alert latar belakang tiap 6 jam, cukup
> install PWA di HP dari URL Render — Chrome akan membangunkan aplikasi saat sync.

### Alternatif lain (juga gratis & mudah)
- **Railway** (<https://railway.app>) — New Project → Deploy from GitHub repo.
- **VPS sendiri** — `git clone` repo, lalu `PORT=80 node server.js` (pakai pm2/systemd agar awet).

---

## 3️⃣ Install di HP Android
Setelah URL permanen aktif: buka di **Chrome Android** → izinkan notifikasi →
menu ⋮ → **Instal aplikasi**. (Detail: lihat README, bagian "Pasang di Android").
