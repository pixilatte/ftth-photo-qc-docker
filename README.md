# FTTH Photo QC — Aplikasi Dokumentasi Foto Proyek (PWA)

Aplikasi web progresif (**Offline-First PWA**) untuk memudahkan pengambilan foto di lapangan serta penyusunan laporan PDF dokumentasi proyek FTTH. Watermark timestamp & geolokasi bersifat opsional dan nonaktif secara default:

- **FOTO CW** (halaman `Implementasi` 10 kotak, `FDT` 6 kotak, & `FAT` 6 kotak dalam satu dokumen)
- **FOTO CW SF** (Implementasi 10 kotak, FDT 6 kotak, & Pole SF 4 kotak sesuai contoh)
- **FOTO EL** (`Input Splitter` 4 kotak, `Output Splitter` 8 kotak, & `OPM FAT` 8 kotak untuk 1310nm & 1550nm)
- Halaman `Implementasi` berisi 10 kotak tahapan `Digging Pole`, `Instal Pole`, `Pulling Cable`, `Instal Accessories`, dan `Concrete Pole` (Grid 2x5), menjadi halaman pertama dokumen FOTO CW.

---

## Cara Menjalankan dengan Docker (Ubuntu 24.04 / Server)

Aplikasi ini sudah dilengkapi dengan server Node.js, database SQLite terpusat untuk **kolaborasi multi-device antar laptop/HP**, dan backup penyimpanan otomatis ke **Nextcloud WebDAV** di port **3137**.

### Fitur Kolaborasi Multi-Device (Real-time Sync)
- **Database Terpusat**: Dokumen dan foto tersimpan di server (`/app/data`), sehingga siapapun yang membuka website (misal via domain `https://fotoqc.gciconnect.my.id/`) dapat melihat, mengedit, dan melanjutkan pekerjaan teknisi lainnya secara bersamaan.
- **Dukungan Offline Tetap Aktif**: Jika teknisi di lapangan kehilangan sinyal, aplikasi tetap dapat mengambil foto dan menyimpan ke memori lokal HP (IndexedDB). Begitu tersambung kembali, data otomatis tersinkronisasi ke server dan Nextcloud.

### Konfigurasi Nextcloud & Volume
Data dokumen dan foto disimpan di volume Docker `qc_data` agar data tidak hilang saat container di-restart/rebuild. Konfigurasi diatur di `docker-compose.yml`:
- `DATA_DIR`: `/app/data` (disimpan permanen di volume `qc_data`)
- `NEXTCLOUD_URL`: `https://drive.gciconnect.my.id`
- `NEXTCLOUD_USER`: `gcibot`
- `NEXTCLOUD_PASSWORD`: `Gcidesign#1`
- `NEXTCLOUD_DIR`: `ftth-photo-qc`

Seluruh foto yang diambil atau di-upload otomatis ditampung ke Nextcloud dengan struktur folder rapi:
`ftth-photo-qc/<ClusterID - ClusterName>/<Nama Halaman - FAT>/<No>_<Deskripsi>.jpg`

### 1. Menggunakan Docker Compose (Direkomendasikan)
Jalankan perintah berikut di direktori proyek:
```bash
docker compose up -d --build
```
Aplikasi langsung dapat diakses di:
```text
http://<IP-SERVER>:3137
# Contoh lokal: http://localhost:3137
```

Untuk melihat status atau log:
```bash
docker compose ps
docker compose logs -f
```

Untuk mematikan container:
```bash
docker compose down
```

### 2. Menggunakan Docker CLI Manual
```bash
# Build image
docker build -t ftth-photo-qc .

# Jalankan container
docker run -d --name ftth-photo-qc \
  --restart unless-stopped \
  -p 3137:3137 \
  -e NEXTCLOUD_URL="https://drive.gciconnect.my.id" \
  -e NEXTCLOUD_USER="gcibot" \
  -e NEXTCLOUD_PASSWORD="Gcidesign#1" \
  -e NEXTCLOUD_DIR="ftth-photo-qc" \
  ftth-photo-qc
```

---

## Cara Menjalankan di Laptop / PC (Lokal Dev)

1. Buka terminal di folder proyek ini, lalu jalankan:
   ```bash
   npm run dev
   ```
2. Buka alamat `http://localhost:5173` di browser (Chrome / Edge).

---

## Cara Pakai di HP saat di Lapangan (Gratis dengan HTTPS & Offline Mode)

Browser HP mewajibkan koneksi **HTTPS** untuk mengizinkan akses **Kamera** dan **GPS**. Karena seluruh data foto disimpan 100% lokal di memori perangkat Anda (**IndexedDB**) tanpa server database, Anda bisa memasang aplikasi ini secara **gratis selamanya** melalui salah satu cara berikut:

### Opsi 1: Cloudflare Pages / Netlify Drop (Paling Cepat — Tanpa Coding, 1 Menit)
1. Jalankan perintah build di Laptop:
   ```bash
   npm run build
   ```
2. Akan muncul folder `dist/`.
3. Buka **Cloudflare Pages** atau **app.netlify.com/drop**, lalu tarik (*drag & drop*) folder `dist/` ke halaman tersebut.
4. Anda langsung mendapatkan link `https://...` yang bisa dibuka di HP, di-**Install ke Layar Utama HP (Add to Home Screen)**, dan tetap berjalan **Offline** meskipun sinyal hilang di lapangan!

### Opsi 2: Vercel / GitHub Pages (Otomatis dari Git)
- Push proyek ini ke repository GitHub Anda:
  - Hubungkan ke **Vercel** (`vercel.json` sudah tersedia), **atau**
  - Aktifkan menu **Settings -> Pages -> Source: GitHub Actions** (`.github/workflows/deploy-pages.yml` sudah tersedia).

---

## Fitur Utama
1. **Mode Kamera Beruntun di HP**: Sekali buka kamera langsung memandu jepret urut dari Kotak #1 sampai selesai beserta indikator akurasi GPS live.
2. **Watermark Non-Destruktif**: Watermark otomatis untuk kamera dan upload nonaktif secara default dan dapat diaktifkan manual. Tersedia pembaca EXIF serta fitur edit manual jam, koordinat, dan alamat untuk 1 foto maupun seluruh foto se-halaman.
3. **Upload Massal & Auto-Buat Halaman**: Tarik puluhan foto sekaligus untuk otomatis dipecah menjadi halaman-halaman baru sesuai template.
4. **3 Pilihan Kualitas PDF**: *Ringan*, *Standar Jernih* (angka layar OPM tajam saat di-zoom), dan *Kualitas Tinggi*.
5. **Backup & Pindah Perangkat (`.photoqc.zip`)**: Ekspor dan impor paket proyek utuh antara HP dan Laptop tanpa butuh akun cloud.
