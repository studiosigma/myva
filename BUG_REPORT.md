# NAIVA QA Report
> Generated after live inspection of https://suitable-marlena-studio6ma-29edebbb.koyeb.app/ and local code review (Projects/naiva)

## Ringkasan
Frontend NAIVA sudah merender dengan baik di halaman live. Saat ini tidak ada JS error yang terdeteksi di browser. Namun ditemukan beberapa potensi bug fungsional dan konsistensi UI Behaviour yang perlu diperbaiki untuk menghindarkan broken workflow di production.

---

## Bug & Masalah Utama

### 1. API base URL hardcoded ke `localhost` (blokir akses lewat Koyeb)
- **Lokasi**: `src/main.js` fetch override + semua `fetch('http://localhost:3000/...')`
- **Dampak**: API dari domain Koyeb akan gagal di semua flow yang butuh backend (login/signup/sync)
- **Kontradiksi**: Login Google di HTML mengarah ke `/api/auth/google` (bagus), tapi fetchOverride di `main.js` malah mencenderungi mismatch
- **Rekomendasi**: 
  - Gunakan path relatif (`/api/...`) atau env var `VITE_API_URL`
  - Hapus atau batasi `localhost` autoconvert agar ringkas dan dipastikan di environment yang sama

---

### 2. Route mismatch: global prefix `api` vs route kode
- **Bukti di kode**:
  - `src/main.ts`: `app.setGlobalPrefix('api')`
  - controller route asli biasanya tanpa prefix tambahan
- **Konsekuensi**: endpoint harus diakses via `/api/auth/login`, `/api/memory`, dst
- **Yang sekarang**: HTML login mengarah ke `/api/auth/google` (selaras), tapi `src/main.js` auto-prefix ke `http://localhost:3000/api/` — ini bisa crash jika backend dipindah ke domain lain
- **Rekomendasi**: Standardisasi prefix dan validasi base URL via environment

---

### 3. Tantangan Trust/UX: Generic empty profile info
- **Temuan**: Beberapa teks statis tampak seperti placeholder default (misal nama pengguna “Muis” hardcoded, bagian kontak/clients yang tampak seperti data dummy untuk display)
- **Risiko**: Nampak tidak personal ke end user saat pertama buka dashboard
- **Rekomendasi**: Tambahkan state "empty" yang menampilkan empty state dengan CTA "Connect WhatsApp / Import Data" saat belum ada data asli yang disync

---

### 4. Fitur “Connect Google/Gmail/Drive/Contacts” belum ada logic aktif terlihat
- **Temuan**: Kartu integrasi menampilkan “Disconnected” dan tombol Connect tanpa URL/flow aktual dari halaman depan
- **Risiko**: User mengklik Connect hanya memunculkan modal atau snapshot tanpa benar-benar menjalankan consent flow
- **Rekomendasi**: Tambahkan validasi tombol Connect (btn-connect-int) untuk memastikan redirect atau popup sesuai integrasi berjalan

---

### 5. Responsivitas mobile: Sidebar menutupi konten utama
- **Temuan**: Di halaman login (`#login`), sidebar desktop class terlihat turun juga walau belum login — menciptakan potensi overlap pada layar kecil
- **Rekomendasi**: Pastikan `sidebar` hanya tampil setelah login dan setelah view aktif. Berikan fallback layout khusus auth pages

---

### 6. Alternatif URL/Broken Image Assets
- **Temuan**: 
  - `src/main.ts` mengarah logo ke `/logo.png` dan `/favicon.png`
  - `index.html` juga mengarah ke `/logo.png` dan `/favicon.png`
- **Risiko**: Jika aset tersebut belum di-deploy, user akan melihat broken image / 404
- **Rekomendasi**: Validasi jalan path asset di Vite dan tambahkan placeholder image inline/base64 jika asset belum diset

---

### 7. Fitur “devLoginInstant” tidak ada UI trigger
- **Temuan**: Fungsi ada di AppState (`src/main.js`) tapi di frontend current view tidak ada tombol/tombot yang memanggilnya
- **Rekomendasi**: Jika fitur purposely disembunyikan untuk production, buatkan flag env; jika untuk QA, buatkan tombol shortcut tersembunyi/qa flag saja

---

### 8. Validation form patterns
- **Temuan**: Beberapa `input` seperti `signup-wa` tidak punya format validasi khusus ( bisa ambiguous )
- **Rekomendasi**: Gunakan `type="tel"` atau pattern validator untuk nomor Indonesia agar helper mobile bisa langsung membuka dialer

---

### 9. Naming inconsistency personilasi
- **Temuan**: 
  - Data attribute `data-personality="business_partner"` dan `data-personality="romantic_partner"` (snake_case)
  - UI di landing tab dan cards memakai label non-snake (Business Partner / Romantic Partner)
- **Risiko**: Mapping JS bisa ketergantungan pada string spesifik, membuat maintenance lebih rentan
- **Rekomendasi**: Gunakan enum/const mapping yang jelas, misal `business_partner` => `Business Partner`, dan pastikan konsisten di semua DOM reference

---

### 10. Loop “save” tanpa debounce
- **Temuan**: Method `save()` di AppState langsung `localStorage.setItem` tanpa throttling
- **Risiko**: Jika user menginput data cepat (misal onboarding), dapat membuat performance hit
- **Rekomendasi**: Tambahkan minimal debounce pada `save()` atau pagasi event update state

---

## Ringkasan Prioritas
1. Bug Blocker: API base URL hardcoded dan prefix mismatch (no. 1 + 2)
2. High: Empty state UX + Connect button yang belum jelas (no. 3 + 4 + 5)
3. Medium: Asset 404 + devLogin + validation format (no. 6 + 7 + 8)
4. Low: Personilasi naming + save debounce (no. 9 + 10)

---

## Check Skenario Berhasil
- Landing page home merender tanpa JS error
- Navigasi hash `#dashboard`, `#login`, `#signup` berfungsi
- Modal (memory, task, reminder, contact, event) tampil konsisten dan tak ada crash

---

## Rekomendasi Langkah Berikutnya
1. Buatkan env var dan helper `getApiBase()` di `src/main.js`
2. Audit setiap endpoint backend untuk memastikan base URL dan prefix cocok
3. Splitting auth layout tanpa sidebar agar tidak tertutup sidebar saat login
4. Tambahkan CTA empty state di dashboard untuk pengguna baru
5. Dokumentasikan flow integrasi Google (OAuth) dari backend agar tombol Connect benar-benar punya aksi nyata
