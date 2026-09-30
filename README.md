# SPS Auto Grader

Aplikasi web untuk membantu asisten praktikum menilai tugas mahasiswa secara otomatis dengan **Gemini AI**,
berdasarkan **materi kuliah** dan **rubrik** yang ditentukan. Tugas dan submission diambil langsung dari
**Google Classroom**, lalu hasil nilainya direkap ke spreadsheet SPS.

```
Google Classroom ──► Daftar tugas ──► Submission mahasiswa ──► SPS Auto Grader
                                                                   │
                         Materi acuan + rubrik ──► Gemini AI ◄─────┘
                                                      │
                                                      ▼
                                          Nilai + feedback ──► Spreadsheet SPS
```

---

## Ringkasan Singkat

**Apa ini?** Web app untuk menilai tugas mahasiswa otomatis dengan Gemini AI, berbasis materi kuliah & rubrik, dengan sumber tugas dari Google Classroom dan rekap nilai ke spreadsheet SPS.

**SKPL singkat:**
- **Input:** kelas/tugas/submission dari Google Classroom (read-only) + materi acuan + rubrik.
- **Proses:** Gemini meringkas materi, menyusun rubrik, dan menilai submission.
- **Output:** nilai + feedback yang ditinjau asisten, lalu diekspor ke Google Sheets SPS.
- **Batasan:** akses Classroom hanya-baca, login terbatas email di `ALLOWED_EMAILS`, tidak menyimpan password. Detail lengkap ada di [bagian SKPL](#spesifikasi-kebutuhan-perangkat-lunak-skpl) di bawah.

**Setup singkat:**

```bash
git clone <url-repo> && cd sps-auto-grader
npm install
cp .env.example .env     # isi DATABASE_URL, NEXTAUTH_*, GOOGLE_*, GEMINI_*, ALLOWED_EMAILS
npx prisma db push
npm run dev              # http://localhost:3000
```

Butuh: Node.js 20+, OAuth client Google (Classroom API aktif, status *Testing* + test user), dan Gemini API key. Langkah rinci di [Menjalankan secara lokal](#menjalankan-secara-lokal) & [Setup Google Cloud](#setup-google-cloud).

---

## Spesifikasi Kebutuhan Perangkat Lunak (SKPL)

### 1. Pendahuluan

**1.1 Tujuan.** Dokumen ini menjelaskan kebutuhan perangkat lunak SPS Auto Grader, yaitu sistem penilaian
tugas otomatis untuk mata kuliah praktikum (awalnya *Dasar Teknologi Digital* / DTD, ITERA).

**1.2 Lingkup.** Sistem ini:
- membaca kelas, tugas, dan submission dari Google Classroom (hanya-baca, lewat API resmi);
- menyimpan materi kuliah sebagai acuan penilaian;
- menyusun rubrik penilaian (manual atau dibantu AI);
- menilai submission mahasiswa dengan Gemini berdasarkan materi dan rubrik;
- mengekspor nilai ke spreadsheet SPS.

Sistem **tidak** membuat tugas, tidak mengubah data di Google Classroom, dan tidak meminta password pengguna.

**1.3 Definisi.**

| Istilah | Arti |
|---|---|
| SPS | Spreadsheet rekap nilai praktikum |
| GCR | Google Classroom |
| Materi acuan | Bahan kuliah (per pertemuan) yang menjadi patokan AI saat menilai |
| Rubrik | Daftar kriteria penilaian beserta bobotnya |
| Provider | Sumber tugas (GCR; ke depan e-learning ITERA, Google Form) |

### 2. Deskripsi Umum

**2.1 Perspektif produk.** Aplikasi web mandiri (Next.js) yang terhubung ke Google Classroom API dan
Gemini API. Data disimpan di database lokal milik aplikasi.

**2.2 Pengguna.**

| Pengguna | Deskripsi | Hak akses |
|---|---|---|
| Asisten / pemilik | Pengguna tunggal yang emailnya terdaftar di `ALLOWED_EMAILS` | Semua fitur |
| Pengguna lain | Siapa pun di luar daftar | Ditolak saat login |

**2.3 Lingkungan operasi.** Browser modern; server Node.js 20+ (lokal atau Vercel); database SQLite
(pengembangan) atau PostgreSQL (produksi).

**2.4 Batasan.**
- Akses Google Classroom bersifat *read-only* (OAuth scope `*.readonly`).
- OAuth app berstatus *Testing*, sehingga hanya test user terdaftar yang bisa login dan token login
  kedaluwarsa kira-kira setiap 7 hari.
- Kualitas penilaian bergantung pada kelengkapan materi acuan dan rubrik; nilai AI tetap perlu ditinjau asisten.

### 3. Kebutuhan Fungsional

| Kode | Kebutuhan | Status |
|---|---|---|
| F-01 | Login dengan akun Google (OAuth), hanya untuk email yang diizinkan | ✅ |
| F-02 | Menyimpan dan me-refresh token Google otomatis | ✅ |
| F-03 | Menampilkan daftar kelas GCR (nama, kode, dosen, jumlah mahasiswa) | ✅ |
| F-04 | Sinkron daftar tugas (courseWork) dari kelas yang dipilih | ✅ |
| F-05 | Memilih tugas lalu mengimpornya ke SPS | ✅ |
| F-06 | Mengatur tugas: judul, deskripsi, instruksi, nilai maksimum, catatan untuk AI | ✅ |
| F-07 | Menambah materi acuan dari URL (dengan crawl per pertemuan) atau file (PDF/DOCX/HTML/TXT/kode) | ✅ |
| F-08 | Gemini meringkas materi dan mengekstrak konsep kunci | ✅ |
| F-09 | Menghubungkan materi acuan ke tugas | ✅ |
| F-10 | Menyusun rubrik secara manual atau dibuatkan AI | ✅ |
| F-11 | Mengambil submission mahasiswa (teks, lampiran Drive) | 🔜 |
| F-12 | Menilai submission dengan Gemini: skor per kriteria + feedback | 🔜 |
| F-13 | Meninjau dan mengoreksi nilai hasil AI | 🔜 |
| F-14 | Ekspor nilai ke Google Sheets SPS | 🔜 |
| F-15 | Provider tambahan: kuliah2.itera.ac.id, Google Form | 🔜 |

### 4. Kebutuhan Non-Fungsional

| Kode | Kategori | Kebutuhan |
|---|---|---|
| NF-01 | Keamanan | Hanya email di allowlist yang bisa masuk; dicek saat login dan di setiap halaman |
| NF-02 | Keamanan | Tidak menyimpan password; kredensial Google hanya lewat OAuth |
| NF-03 | Keamanan | Rahasia (`.env`) tidak ikut masuk repositori |
| NF-04 | Privasi | Akses Classroom hanya-baca |
| NF-05 | Ketersediaan | Dapat dijalankan lokal maupun di Vercel |
| NF-06 | Kemudahan pengembangan | Sumber tugas baru cukup menambah implementasi `TaskSourceProvider` |
| NF-07 | Antarmuka | Responsif, mendukung mode terang dan gelap |

### 5. Model Data

```
User ─┬─ Account / Session          (NextAuth)
      └─ Course ── Assignment ─┬─ AssignmentMaterial ── Material ── MaterialPage
                               └─ rubric (JSON), gradingNotes
```

- **Course / Assignment**: salinan kelas dan tugas dari provider (`provider` + `externalId`).
- **Material / MaterialPage**: materi acuan beserta teks lengkap per halaman, ringkasan, dan konsep kunci.
- **AssignmentMaterial**: relasi banyak-ke-banyak antara tugas dan materi.

### 6. Alur Utama

1. Asisten login dengan Google.
2. Membuka **Classroom** lalu sinkron kelas, memilih kelas, sinkron tugas, dan mengimpor tugas yang akan dinilai.
3. Membuka **Materi**, lalu menambahkan materi pertemuan (URL/file). Gemini meringkasnya.
4. Membuka tugas, memilih materi acuan, lalu membuat atau menyusun rubrik.
5. *(Berikutnya)* Mengambil submission, menilai dengan Gemini, meninjau, dan mengekspor ke SPS.

---

## Teknologi

Next.js 15 (App Router, Server Actions) · React 19 · TypeScript · NextAuth v4 · Prisma ·
Google Classroom API (`googleapis`) · Gemini (`@google/genai`) · cheerio, pdf-parse, mammoth (ekstraksi materi).

## Menjalankan secara lokal

```bash
npm install
cp .env.example .env     # lalu isi nilainya
npx prisma db push
npm run dev              # http://localhost:3000
```

Isi `.env`:

| Variabel | Keterangan |
|---|---|
| `DATABASE_URL` | `file:./dev.db` (SQLite) atau connection string PostgreSQL |
| `NEXTAUTH_URL` | `http://localhost:3000` (produksi: URL Vercel) |
| `NEXTAUTH_SECRET` | String acak, misalnya dari `openssl rand -base64 32` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth client dari Google Cloud |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Dari https://aistudio.google.com/apikey |
| `ALLOWED_EMAILS` | Email yang boleh login, dipisah koma |

### Setup Google Cloud

1. Aktifkan **Google Classroom API**.
2. **Google Auth Platform**, lalu *Get started*: audience **External**, biarkan status **Testing**.
3. **Audience → Test users**: tambahkan email yang akan login.
4. **Data access**: tambahkan scope
   `classroom.courses.readonly`, `classroom.coursework.students.readonly`,
   `classroom.rosters.readonly`, `classroom.profile.emails`.
5. **Clients → Create client** (*Web application*):
   - Origin: `http://localhost:3000`
   - Redirect URI: `http://localhost:3000/api/auth/callback/google`

Saat login akan muncul "Google hasn't verified this app". Itu normal untuk app berstatus Testing; klik **Continue**.

## Deploy ke Vercel

1. Ganti database ke PostgreSQL (mis. Neon): di `prisma/schema.prisma` ubah `provider = "postgresql"`.
   SQLite tidak bisa dipakai di Vercel.
2. Import repo di Vercel, lalu isi semua environment variable di atas (`NEXTAUTH_URL` = URL Vercel).
3. Di OAuth client Google, tambahkan origin `https://<app>.vercel.app` dan redirect URI
   `https://<app>.vercel.app/api/auth/callback/google`.

## Struktur kode

| Path | Isi |
|---|---|
| `src/app/` | Halaman: `login`, `classroom`, `assignments/[id]`, `materials` |
| `src/app/actions.ts` | Server actions: sinkron, impor, setup tugas, rubrik, materi |
| `src/lib/auth.ts` | Konfigurasi NextAuth + allowlist email |
| `src/lib/providers/` | Kontrak `TaskSourceProvider` + implementasi Google Classroom (`gcr.ts`) |
| `src/lib/materials.ts` | Ekstraksi materi (URL/crawl/file) dan pemrosesan oleh Gemini |
| `src/lib/gemini.ts`, `rubric.ts` | Klien Gemini dan pembuatan rubrik |
| `prisma/schema.prisma` | Skema database |
