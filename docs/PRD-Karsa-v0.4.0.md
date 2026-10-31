# PRD — Karsa: Platform Presentasi Interaktif Berbahasa Indonesia

Versi: 0.4.0 • Tanggal: 10 Oktober 2026
Status: Disetujui — dasar implementasi mockup
Nama produk: Karsa
Konteks: INCEPTION 2026, subtema Inclusive Education and Future Skills

---

## CHANGELOG v0.3.1 → v0.4.0

| ID | Perubahan | Alasan |
|----|-----------|--------|
| CH01 | Arsitektur POV-first: tiga rute tetap `/session/[id]/presenter`, `/session/[id]/participant`, `/session/[id]/projector` | URL tidak boleh berubah saat sesi berlangsung; peran dikontrol oleh service, bukan rute |
| CH02 | Fungsi proyeksi state: `projectForPresenter`, `projectForParticipant(pid)`, `projectForProjector` digunakan oleh REST `/state` dan Socket.IO broadcast | Satu sumber kebenaran filtering; mencegah bocornya kunci/data privat ke klien yang salah |
| CH03 | Command hanya melalui Socket.IO; tidak ada `POST /sessions/:id/command` via REST | Satu jalur penanganan command, mencegah duplikasi aturan di controller |
| CH04 | Realtime simplified: setelah setiap command, server push snapshot penuh terproyeksi ke masing-masing room; klien replace state (tanpa patching); re-fetch hanya saat reconnect | Menghilangkan kompleksitas merge/patch di klien |
| CH05 | `contracts/` folder: PresenterView, ParticipantView, ProjectorView + tipe command/ack/event; salinan identik di kedua repo | Single contract sebagai boundary antara frontend dan backend |
| CH06 | `MockSessionService` menggunakan fungsi proyeksi yang sama; tidak ada kebocoran kunci jawaban di mode demo | Demo harus mensimulasikan perilaku produksi, bukan shortcut |
| CH07 | Flag tunggal: `NEXT_PUBLIC_DEMO_MODE` (frontend) dan `DEMO_MODE` (backend) | Menggantikan berbagai kondisional tersebar |
| CH08 | D1 — Timer tutup otomatis; tidak ada tombol tutup manual di UI presenter; manual close hanya di SimulationControls | Konsisten dengan §F10; mencegah kesalahan alur |
| CH09 | D2 — Leaderboard menampilkan maks 5 entri; peserta di luar top 5 melihat peringkat dan skor sendiri sebagai baris terpisah di bawah daftar | Menggantikan "usulan seri batas lima" yang ambigu di v0.3.1 |
| CH10 | D3 — "Buka Kembali" didukung per §F04; membuka kembali respons menyembunyikan hasil publik hingga respons ditutup lagi | Klarifikasi yang sudah ada di §F04 tapi tidak dinyatakan eksplisit sebagai keputusan |
| CH11 | D4 — Nama peserta demo: Alya, Bima, Citra, Dimas, Eka, Farah (dibekukan) | Konsistensi dengan fixtures.ts di ruang-rasa-prototype |
| CH12 | D5 — Token proyektor persisten sepanjang sesi, kedaluwarsa saat sesi berakhir; diperoleh via `GET /api/sessions/:id/projector-token` | Proyektor tidak perlu join ulang setiap kali; keamanan cukup via read-only token |
| CH13 | Stack frontend: Neobrutalism Components (Base UI, bukan Radix) sebagai pengganti shadcn/ui biasa; init via `pnpm dlx shadcn@latest init https://neobrutalism.dev/r/styling/blue.json` | Komponen siap pakai dengan hard shadow dan border neo-brutalism |
| CH14 | Dua repo terpisah: `MOCKUP/mockup-karsa-frontend/` dan `MOCKUP/mockup-karsa-backend/` | Memisahkan concern; backend NestJS tidak bercampur dengan Next.js |
| CH15 | Screens S04/S08–S16 bukan rute URL baru; semua adalah state/view di dalam tiga rute POV | Klarifikasi arsitektur routing |
| CH16 | OQ01 — Rumus skor disetujui: benar = 500 + round(500 × (1 − elapsed/duration)), klem [0,500]; salah/kosong = 0. elapsed = serverReceivedAt − openedAt | Formula sudah sesuai implementasi quiz.ts; `quiz-config.ts` {base:500,bonus:500} valid |
| CH17 | OQ02 — Durasi kuis: default 30 s, rentang 10–120 s, langkah 5 s | Diterapkan di editor kuis dan validasi slide |
| CH18 | OQ03 — Tiebreak leaderboard: total poin desc → jumlah benar desc → seri mendapat rank sama → urutan tampil dalam seri: abjad nama (nomor kelompok untuk kuis kelompok) | Menggantikan urutan join; diimplementasikan di `quizScores()` |
| CH19 | OQ04 — Timer kuis tetap berjalan meski presenter terputus; peserta tetap bisa submit sampai deadlineAt | Mengacu §F10: "Backend memakai openedAt, deadlineAt, dan receivedAt dari jam server" — jam server tidak bergantung status koneksi presenter |
| CH20 | OQ05 — Peserta terlambat dapat menjawab soal yang sedang terbuka (sampai deadline) dan semua soal berikutnya; soal yang terlewat skor 0; tidak ada posisi paksa terakhir. Mode kelompok: late joiner ditempatkan di kelompok sesuai aturan late-join yang sudah ada di engine.ts (kelompok dengan anggota paling sedikit) dan bertindak sebagai anggota biasa | Menggunakan aturan late-join engine.ts yang sudah ada; tidak perlu logika tambahan |
| CH21 | OQ06 — Ditangguhkan. Di luar scope mockup; perlu sebelum public launch | — |
| CH22 | OQ07 — Tidak ada batas agregat upload. Hanya batas per file: 5 MB (§19.8) | Menyederhanakan implementasi; batas agregat bukan kebutuhan mockup |
| CH23 | Autentikasi presenter: Bearer JWT di header Authorization (bukan HttpOnly cookie seperti §19.3) | Token disimpan di sessionStorage per tab sehingga presenter dan beberapa peserta dapat berjalan di tab terpisah dalam browser yang sama saat demo. Socket.IO menggunakan token yang sama di handshake auth. Revisi §19.3 untuk mockup. |
| CH24 | Visibilitas skor kuis: setelah soal ditutup (run.closed = true), peserta langsung melihat benar/salah dan poin untuk soal itu saja. Total poin akumulasi dan peringkat tetap tersembunyi sampai quiz.finished AND quiz.revealed. §F10 menyebut "Papan peringkat setelah seluruh kuis selesai" — CH24 mengklarifikasi bahwa umpan balik per soal (bukan total/peringkat) boleh langsung terlihat. |
| CH25 | AC16 — Peserta simulasi ditandai di model: `Participant.simulated?: boolean`. Backend menyetel `simulated: true` saat `DEMO_MODE=true`; `MockSessionService.joinSession` selalu menyetel `simulated: true`. Semua fungsi proyeksi mengekspos `hasSimulatedData: boolean` (true jika ada peserta `simulated=true`). `SummaryView` menampilkan "Berisi data simulasi — bukan hasil sesi nyata" saat `hasSimulatedData=true`. | Memenuhi §10 AC16 "Data ditandai simulasi" secara eksplisit pada halaman hasil; menghilangkan ketergantungan pada overlay SimulationControls yang tidak terlihat di layar ringkasan. |
| CH26 | A3 — Visibilitas pertanyaan Q&A dikoreksi: pertanyaan yang ditampilkan presenter (`q.visible=true` via `moderate`) hanya muncul di proyektor, **tidak** di perangkat peserta lain. Peserta hanya melihat pertanyaan yang mereka kirim sendiri. `projectForParticipant` diubah: filter `(q) => q.participantId === pid`; `projectForProjector` menampilkan pertanyaan visible tanpa gating `act.visible`. Perbarui §5 dan §7. | Perilaku sebelumnya memungkinkan peserta lain melihat pertanyaan yang ditampilkan, yang bukan tujuan moderasi Q&A. |
| CH27 | B9 — Tutup soal kuis otomatis lebih awal (early close): ketika semua pemilik yang *sedang online* telah menjawab, soal ditutup segera tanpa menunggu tenggat. "Online" = `p.online === true` atau `p.simulated === true`. Peserta terputus tidak memblokir early close. Bot demo (`simulated=true`) turut dihitung; jika belum menjawab saat semua peserta asli sudah menjawab, soal tetap menunggu tenggat. Bonus kecepatan tetap memakai durasi asli soal. | Mengurangi waktu tunggu yang tidak perlu ketika semua peserta sudah menjawab. |
| CH28 | B10 / D21 — Toggle "Sembunyikan konten dari peserta", default ON. Saat ON: peserta hanya melihat pertanyaan/opsi saat input terbuka; setelah kirim, mereka melihat layar konfirmasi ("Jawaban terkirim! Lihat hasilnya di layar depan.") bukan hasil/chart/kunci. Pengecualian: saat leaderboard kuis ditampilkan, peserta tetap melihat peringkat dan skor sendiri. Presenter dapat mematikan toggle (OFF) untuk mengembalikan perilaku lama (peserta melihat hasil di perangkat). Perbarui §5 matriks POV dan §6.2. | Secara default mendorong peserta memperhatikan proyektor, bukan perangkat masing-masing. |
| CH30 | B9 — Tombol "Tampilkan Hasil Soal" per pertanyaan kuis: presenter dapat menampilkan bar chart jawaban ke proyektor (dan ke peserta jika hideContent=OFF) setelah soal ditutup. Command `quiz.revealQuestion { questionRunId }` menyetel `QuizRun.resultsVisible=true` pada run yang sesuai. Proyektor dan peserta menerima `answerCounts: number[]` melalui snapshot berikutnya. | Memungkinkan pembahasan soal per soal tanpa harus selesai seluruh kuis terlebih dahulu. |
| CH31 | B8 — Proyeksi pertanyaan Q&A yang disematkan (pinned): `ProjectorView.pinnedQuestion: { text, questionId } | null`. Diisi saat ada `session.questions.find(q => q.visible)` dan slide aktif bukan tanya. Proyektor menampilkan overlay banner pada slide apapun. Peserta tidak melihat field ini. | Presenter dapat menampilkan pertanyaan peserta ke proyektor meski tidak sedang di slide tanya. |
| CH32 | B10 penegakan proyeksi — `effectiveVisible = act.visible && !session.hideContent` diterapkan di `projectForParticipant` agar `correct`, `revealedCounts`, `revealedWords`, dan `answerCounts` kuis tidak pernah mencapai klien peserta ketika hideContent=ON, bukan hanya disembunyikan di UI. | Mencegah kebocoran kunci melalui WebSocket bahkan jika UI tidak menyembunyikannya. |
| CH29 | C7 — Opsi benar ganda: `Slide.correct` berubah dari `number` (indeks tunggal) menjadi `number[]` (satu atau lebih indeks). Peserta tetap memilih tepat satu opsi; jawaban benar jika opsi yang dipilih termasuk dalam array kunci. Skor kuis tidak berubah. Parsing backward-compatible di skema Zod: nilai number lama dibaca sebagai `[number]`. Perbarui D11, tipe di `model.ts`, `quiz.ts`, `projection.ts`, `contracts/views.ts`, komponen UI, dan seed. | Mendukung pertanyaan "pilih yang benar" dengan lebih dari satu opsi benar, termasuk pertanyaan tanpa jawaban salah. |
| CH33 | C3 — Tombol "Slide Baru" di editor: satu tombol membuka popover dengan ikon dan nama setiap jenis slide (menggantikan deretan tombol teks). | Antarmuka lebih rapi dan konsisten; ikon membantu pengenalan cepat jenis slide. |
| CH34 | C5 — Menu tiga titik per slide di daftar slide: "Duplikat" (menyalin slide setelah posisi saat ini; kuis selalu ke posisi terakhir) dan "Hapus" (dengan konfirmasi satu klik). | Menggantikan ikon hapus langsung; Duplikat mengurangi pengulangan kerja untuk slide serupa. |
| CH35 | C4 — Drag-and-drop pengurutan slide di daftar slide (grip handle ≡); slide kuis tidak dapat diseret; tidak dapat didrop ke posisi setelah kuis. | Menggantikan tombol panah atas/bawah; lebih natural dan cepat untuk mengatur ulang banyak slide. |
| CH36 | C6 — Autosave draf (opsi b): editor menyimpan draf secara otomatis (debounce 1,5 s) bahkan saat slide belum valid; validasi konten penuh hanya diberlakukan di `POST /api/presentations/:id/sessions`. `PUT /api/presentations/:id/slides` menerima `expectedVersion` (optimistic locking): jika versi tidak cocok, respons 409 dengan pesan "Presentasi telah diubah di tab lain". Sebelumnya `putSlides` memvalidasi konten slide dan menolak draf tidak lengkap (misalnya durasi kuis di luar 10–120 s), yang mencegah penyimpanan sementara; perilaku ini dihapus. | Mencegah kehilangan data saat pengguna mengedit perlahan; lebih sesuai dengan pola editor modern. |
| CH37 | C1 — Upload gambar per file: `POST /api/assets` (multipart/form-data, field `file`; hanya gambar, maks 5 MB; 422 jika tipe/ukuran salah). URL dikembalikan menggunakan `req.protocol + '://' + req.get('host')` sehingga bekerja di LAN (tanpa localhost hardcode). File disajikan secara statis dari `/uploads`. | Memungkinkan presenter mengunggah gambar langsung dari perangkat tanpa URL eksternal. |
| CH38 | C2 — Edit WYSIWYG minimal: judul dan isi diedit langsung di kanvas slide di panel kanan editor; slot gambar di kanvas dapat diklik untuk mengunggah/mengganti. Pemformatan teks kaya di luar cakupan. | Menghilangkan pemisahan antara form sidebar dan tampilan slide; editing langsung lebih intuitif. |
| CH39 | C8 — Area hasil sesi: `GET /api/presentations/:id/results` mengembalikan daftar sesi lampau beserta ringkasan per slide (jumlah respons per opsi, kata, skor kuis, pertanyaan Q&A yang diterima). Hanya untuk pemilik presentasi. Tab baris per sesi ditampilkan di editor. | Memungkinkan presenter meninjau hasil setelah sesi berakhir tanpa harus membuka sesi aktif. |
| CH40 | C6 decision(b) — Tombol "Mulai Sesi" tidak lagi dinonaktifkan saat terdapat kesalahan validasi (mis. durasi kuis di luar rentang 10–120 detik). Sebaliknya, tombol tetap dapat diklik; saat diklik dengan validasi gagal, toast muncul yang menjelaskan alasan spesifik (mis. "Durasi kuis harus antara 10–120 detik."). A5 (validasi konten saat sesi dimulai) tetap berlaku di sisi server. Panel sidebar tetap menampilkan daftar kesalahan. | Tombol yang hanya dinonaktifkan tanpa keterangan membingungkan presenter yang mungkin tidak melihat pesan kesalahan di sidebar. |
| CH41 | §17.1–17.2, §17.6 — Desain visual: (a) Palet A "Siang Tropis" diterapkan menyeluruh: `--background: hsl(46, 88%, 93%)` (krem hangat), `--main: hsl(190, 100%, 45%)` (cyan), `--chart-1..6`, `--success`, `--error` di `globals.css`; warna aksen chart tersebar di badge tipe slide, leaderboard, dan elemen kunci. (b) Hanya tema terang: `color-scheme: light` di `:root` dan `body` memastikan tampilan tidak berubah meski OS dalam dark mode. (c) Kontras WCAG AA: semua teks `text-foreground/40` dan `/50` dinaikkan ke `/60` atau `/70`; `text-main` sebagai warna teks dihapus (diganti `text-foreground`); label penting menggunakan hitam. (d) Pemeriksaan otomatis: `contrast.spec.ts` menjalankan `axe color-contrast` di 4 layar kunci × 2 color scheme. (e) Gallery: `gallery.spec.ts` mengambil screenshot nyata dari app di 5 layar kunci × 2 color scheme. | Laptop proyektor sering dalam dark mode; kontras rendah menyebabkan teks sulit dibaca di ruangan terang. |
| CH43 | §17 — **Color roles, icon system, emoji elimination, styleguide**: (a) Setiap warna memiliki TEPAT SATU makna. Warna tipe slide diperbarui: materi `#60A5FA` (biru), pilihan `#A78BFA` (lavender), polling `#FB923C` (oranye), awan `#FFD93D` (kuning), tanya `#FF8FCB` (pink), kelompok `#2DD4BF` (teal), kuis `#B8F25B` (lime). Chart bar colors (chart-1..6) diperbarui ke palet berbeda: `#EF4444`, `#3B82F6`, `#22C55E`, `#F97316`, `#6366F1`, `#14B8A6` — tidak boleh digunakan sebagai type chips. `--success: #34D399` hanya untuk benar/sukses + ikon. Destructive/error: `#FF6B5B` coral saja. Medal leaderboard: emas `#FBBF24`, perak `#CBD5E1`, perunggu `#D97706` (tidak tumpang tindih dengan type palette). (b) Semua emoji dan glyph karakter (`✓`, `✗`, 🥇, 🎉, dll.) dihapus dari UI; diganti dengan lucide-react (strokeWidth 2.5): `Check`, `X`, `Trophy`, `Medal`, `UserPlus`, `MessageSquare`, `Mic2`, `Sparkles`, dll. (c) Emoji guard test `domain/emoji-check.spec.ts` gagal jika ada `\p{Extended_Pictographic}` atau glyph terlarang di `app/`, `features/`, `components/`. (d) `/styleguide` page menampilkan semua token, komponen dalam semua state. (e) Skala dan bobot: `font-weight-heading` 800, `border-3px` di card override, min-height button 40px, font-weight button 700. | Warna ganda (awan dan kuis sama; kelompok coral bertabrakan dengan destructive; cyan untuk materi DAN primary button) menimbulkan kebingungan visual. Emoji tidak konsisten lintas OS/browser. Tidak ada referensi terpusat untuk token dan state komponen. |
| CH42 | §17.1–17.2 — **Bold Neo-Brutalism overhaul**: menghilangkan "flat/pale" yang timbul saat Palette A pertama kali diterapkan. (a) Surface hierarchy tegas: Card component di-override menjadi `bg-secondary-background` (putih) via globals.css `[data-slot="card"]` sehingga kartu selalu putih di atas latar krem. (b) Disabled button override: `[data-slot="button"]:disabled` menggunakan `#e5e7eb` bg dan `#4b5563` text, bukan `opacity-50` yang menghasilkan cyan washed-out. (c) Slide type colors sebagai solid fill: `kindColors` di editor, presenter navigator, projector badge, participant badge semua menggunakan solid hex fill (bukan `/20` tint); left-bar 4px berwarna per tipe di daftar navigasi. (d) Token `--slide-*` ditambahkan ke globals.css. (e) `lib/slide-colors.ts` berisi peta `SLIDE_COLOR: Record<Kind, string>` yang diimpor oleh komponen presenter, projector, dan participant. (f) Leaderboard top-3 menggunakan solid fill gold/lavender/orange; baris lainnya putih. (g) Semua `bg-main/10` dan `bg-main/20` pada UI bermakna (konfirmasi, opsi terpilih, member chip) dinaikan ke solid `bg-main`. | UI terasa flat: kartu tidak tampak terpisah dari latar; tombol disabled tidak jelas statusnya; badge tipe slide tidak memiliki identitas visual yang kuat. |

---

## Pertanyaan Terbuka (Open Questions)

| ID | Pertanyaan | Dampak | Status |
|----|-----------|--------|--------|
| OQ01 | Rumus skor kuis: bobot ketepatan vs kecepatan, pembulatan, batas poin per soal | Formula skor di `quiz-config.ts` masih placeholder `base:500 + bonus:500` | ✅ Selesai — lihat CH16 |
| OQ02 | Default durasi kuis dan rentang yang diperbolehkan | Editor kuis memerlukan nilai dan validasi | ✅ Selesai — lihat CH17 |
| OQ03 | Review usulan seri persis di batas 5: urutan tampil menggunakan stable sort berdasarkan apa? | §F10 menyebut "urutan peserta/kelompok stabil" tapi belum didefinisikan | ✅ Selesai — lihat CH18 |
| OQ04 | Kebijakan jeda detail: jika presenter terputus saat soal kuis berjalan, apakah timer tetap berjalan atau ditunda? | §F10: "Backend memakai openedAt, deadlineAt, dan receivedAt dari jam server" | ✅ Selesai — lihat CH19 |
| OQ05 | Late join ke kelompok: apakah peserta yang bergabung setelah kuis dimulai boleh menjawab soal yang masih terbuka sebagai individu jika tidak masuk kelompok manapun? | Jarang terjadi tapi perlu policy eksplisit | ✅ Selesai — lihat CH20 |
| OQ06 | Kebijakan retensi data produksi: berapa lama sesi/hasil disimpan setelah presenter menghapus? | Tidak blocking untuk mockup; perlu sebelum public launch | 🔲 Ditangguhkan — lihat CH21 |
| OQ07 | Maksimum upload gambar per akun/sesi | §19.8 menyebut 5 MB per file; belum ada batas agregat | ✅ Selesai — lihat CH22 |

---

## 1. Ringkasan produk

Karsa adalah platform web presentasi interaktif berbahasa Indonesia yang memudahkan presenter melibatkan audiens dan membangun komunikasi dua arah, dari kelas dan lokakarya hingga seminar. Penggunaan pada audiens besar merupakan sasaran pengembangan, belum kemampuan yang telah diuji. Presenter menyusun slide, mengundang peserta melalui kode atau QR, mengendalikan presentasi, dan menampilkan respons peserta secara langsung. Interaksi utama adalah pilihan ganda, polling, awan kata, dan tanya jawab (Q&A).

Presentasi selalu dimulai dengan partisipasi individu. Presenter dapat menempatkan slide **Pembagian Kelompok** di awal, tengah, atau akhir. Saat pembagian dijalankan, sistem membentuk kelompok dan memilih satu peserta beserta perangkat sesinya sebagai penjawab setiap kelompok. Aktivitas berikutnya menggunakan kelompok tersebut sampai sesi selesai. Tidak ada pengaturan pilih mode saat membuat presentasi.

Presenter juga dapat menambahkan satu sesi kuis opsional pada slide terakhir. Sesi kuis memuat pertanyaan sebanyak yang ditambahkan presenter, dengan timer per pertanyaan, poin berdasarkan ketepatan dan kecepatan, serta papan peringkat maksimal lima entri setelah kuis selesai. Kuis mengikuti partisipasi individu atau kelompok yang berlaku saat dimulai. Editor WYSIWYG menggunakan pilihan tata letak tetap: teks, teks dengan satu gambar, atau dua gambar berdampingan.

Deliverable tahap ini adalah **mockup interaktif** dengan data simulasi dan dua repo terpisah (frontend + backend) untuk menguji alur, tampilan, dan kontrak API. Mockup bukan bukti bahwa koneksi real-time antarpiranti, autentikasi, atau backend produksi telah berfungsi.

---

## 2. Status keputusan

**Disepakati** berasal dari keputusan pengguna. **Usulan v0.1** adalah default rancangan; belum merupakan persetujuan. Perubahan usulan tidak memerlukan perubahan konsep inti.

| ID | Keputusan | Status |
|----|-----------|--------|
| D01 | Platform seperti Mentimeter dengan antarmuka bahasa Indonesia | Disepakati |
| D02 | Pilihan ganda, polling, awan kata, dan Q&A sebagai interaksi awal | Disepakati |
| D03 | Peserta masuk melalui kode/QR tanpa akun | Disepakati dalam scope percakapan |
| D04 | Tidak ada pilihan mode presentasi | Disepakati |
| D05 | Slide pembagian boleh ditempatkan di awal, tengah, atau akhir | Disepakati |
| D06 | Sebelum pembagian: individu; setelah pembagian: kelompok | Disepakati |
| D07 | Satu perangkat penjawab tiap kelompok dipilih sistem | Disepakati |
| D08 | Mockup menggunakan data simulasi | Disepakati |
| D09 | Tanpa AI, analisis pemahaman, dan tingkat keyakinan dalam scope awal | Disepakati dalam scope percakapan |
| U01 | Presenter punya akun; peserta mengisi nama tampilan | Usulan v0.1; login hanya simulasi pada mockup |
| U02 | Editor WYSIWYG dengan tata letak tetap: teks, teks + satu gambar, atau dua gambar berdampingan | Disepakati v0.3 |
| U03 | Pilihan ganda punya satu jawaban benar; polling tidak memiliki kunci | Usulan v0.1 |
| U04 | Timer, skor ketepatan + kecepatan, dan papan peringkat hanya untuk sesi kuis; pilihan ganda biasa tetap tanpa skor kompetitif | Disepakati v0.3 |
| U05 | Maksimal satu slide pembagian kelompok per presentasi | Usulan v0.1 |
| U06 | Semua anggota boleh mengirim Q&A; pilihan ganda, polling, awan kata, dan kuis hanya penjawab | Usulan v0.1 |
| U07 | Perwakilan tetap sepanjang sesi, dapat diganti oleh presenter | Usulan v0.1 |
| U08 | Respons biasa boleh diperbarui sampai ditutup; jawaban kuis final sekali kirim; hasil dibuka presenter | Usulan v0.1 |
| U09 | Riwayat hasil per sesi disimpan; presentasi dapat digunakan kembali | Usulan v0.1; penyimpanan lokal pada mockup |
| D10 | Maksimal satu sesi kuis opsional, ditempatkan sebagai slide terakhir; jumlah pertanyaan ditentukan presenter tanpa batas maksimum produk | Disepakati v0.3 |
| D11 | Kuis pilihan ganda; satu durasi pilihan presenter berlaku untuk setiap pertanyaan. **Direvisi CH29:** kunci jawaban dapat berisi satu atau lebih opsi (`correct: number[]`); peserta tetap memilih tepat satu opsi | Disepakati v0.3; direvisi v0.4.1 |
| D12 | Jawaban benar memperoleh poin berdasarkan kecepatan; salah/tidak menjawab bernilai nol; rumus numerik belum ditetapkan | Disepakati v0.3 |
| D13 | Kuis kelompok memakai satu jawaban final penjawab; skor milik kelompok, waktu acuan penerimaan server | Disepakati v0.3 |
| D14 | Papan peringkat setelah kuis selesai, maksimal lima entri; urutan total poin, jumlah benar, lalu peringkat bersama | Disepakati v0.3 |
| D15 | Neo-brutalism yang konsisten dan terbaca; editor bebas menjadi stretch goal jika inti sprint selesai dan stabil | Disepakati v0.3 |
| D16 | Timer kuis menutup otomatis saat tenggat; tidak ada tombol tutup manual di UI presenter; SimulationControls boleh menyediakan shortcut close untuk demo | Disepakati v0.4 |
| D17 | Peserta di luar top 5 leaderboard melihat peringkat dan skor sendiri sebagai baris terpisah di bawah daftar utama | Disepakati v0.4 |
| D18 | "Buka Kembali" (reopen) didukung untuk respons biasa; membuka kembali menyembunyikan hasil publik sampai ditutup lagi | Disepakati v0.4 (klarifikasi F04) |
| D19 | Nama peserta demo dibekukan: Alya, Bima, Citra, Dimas, Eka, Farah | Disepakati v0.4 |
| D20 | Token proyektor persisten sepanjang sesi, kedaluwarsa saat sesi berakhir | Disepakati v0.4 |
| D21 | Toggle "Sembunyikan konten dari peserta" per sesi, default ON. Saat ON peserta hanya melihat soal/opsi saat input terbuka; setelah kirim → layar konfirmasi. Saat OFF → perilaku lama (peserta lihat hasil di perangkat). Pengecualian: leaderboard kuis selalu tampil ke peserta yang bersangkutan | Disepakati v0.4.1 — lihat CH28 |

---

## 3. Pengguna, masalah, dan tujuan

*(Tidak berubah dari v0.3.1 §3)*

Pengguna sasaran: presenter dan audiens pada kelas, lokakarya, serta seminar. Masalah utama yang ingin divalidasi adalah komunikasi presentasi yang cenderung satu arah: peserta membutuhkan cara mudah menyampaikan tanggapan, sementara presenter membutuhkan gambaran respons selama sesi. Diskusi kelompok menjadi kelanjutan opsional ketika kegiatan memerlukan kolaborasi. Peserta perlu mengetahui kapan menjawab sendiri, dengan siapa berdiskusi, dan siapa yang mengirim hasil kelompok.

Hipotesis yang perlu diuji: bergabung tanpa akun dan interaksi dari HP memudahkan partisipasi; respons langsung membantu presenter menanggapi audiens; bahasa Indonesia mempermudah pemahaman kontrol; pembagian kelompok dan pemilihan penjawab mengurangi kebingungan koordinasi. Belum ada klaim keunggulan kompetitif, validasi pasar, atau peningkatan hasil belajar.

Tujuan mockup:

- Membuktikan alur membuat presentasi sampai melihat hasil bisa dipahami.
- Memperlihatkan transisi individu ke kelompok dengan jelas.
- Membuat peserta memahami peran anggota dan penjawab tanpa penjelasan lisan tambahan.
- Menguji representasi respons yang masuk secara langsung melalui simulasi.

---

## 4. Scope

### Masuk mockup

- Daftar presentasi, editor WYSIWYG dengan tiga tata letak tetap, pengurutan dan pratinjau slide.
- Slide materi, pilihan ganda, polling, awan kata, Q&A, Pembagian Kelompok, dan satu slide Kuis terakhir.
- Kuis beberapa pertanyaan dengan timer, simulasi skor ketepatan/kecepatan, dan papan peringkat maksimal lima entri.
- Lobi, kode sesi dan QR menuju rute demo, jumlah peserta simulasi.
- Tampilan presenter, proyektor, peserta individu, anggota kelompok, dan penjawab — semua melalui tiga rute POV.
- Simulasi respons, pengacakan kelompok, penggantian penjawab, dan hasil sesi.
- Skenario kosong, validasi, belum merespons, respons ditutup, serta koneksi terputus simulasi.
- Penyimpanan lokal untuk draft dan sesi demo; tombol reset data demo.
- `contracts/` folder dengan tipe proyeksi dan command yang digunakan oleh kedua repo.
- `MockSessionService` yang menggunakan fungsi proyeksi — tidak ada bocoran data privat.

### Di luar mockup

- Backend produksi, akun sungguhan, email login, dan sinkronisasi lintas perangkat.
- Jaminan keamanan, anti-kecurangan, uji beban, atau klaim latensi real-time.
- Import PowerPoint/PDF, editor desain bebas, kolaborasi editor.
- AI, penilaian otomatis esai, dan analisis miskonsepsi.
- Pembayaran, paket berlangganan, integrasi LMS, dan aplikasi native.
- Pengacakan kelompok berkali-kali atau kembali ke individu setelah pembagian.

---

## 5. Peran dan hak akses

| Aksi | Presenter | Peserta individu | Anggota kelompok | Penjawab kelompok |
|------|-----------|-----------------|-----------------|------------------|
| Membuat dan menyusun slide | Ya | Tidak | Tidak | Tidak |
| Mengendalikan slide/respons/hasil | Ya | Tidak | Tidak | Tidak |
| Menjawab pilihan ganda/polling/awan kata | Tidak | Ya saat dibuka | Tidak | Ya saat dibuka |
| Menjawab kuis | Mengendalikan soal | Satu jawaban final/soal | Melihat dan berdiskusi | Satu jawaban final/soal untuk kelompok |
| Mengirim Q&A | Mengelola | Ya saat dibuka | Ya saat dibuka | Ya saat dibuka |
| Melihat pertanyaan Q&A yang ditampilkan | Semua (panel moderasi) | **Tidak** (hanya pertanyaan sendiri) | **Tidak** (hanya pertanyaan sendiri) | **Tidak** (hanya pertanyaan sendiri) |
| Melihat jawaban kelompok sendiri | Semua di dashboard | Tidak berlaku | Ya | Ya |
| Membagi kelompok/mengganti penjawab | Ya | Tidak | Tidak | Tidak |

Proyektor hanya menampilkan konten publik: slide aktif, petunjuk, jumlah respons, dan hasil yang telah dibuka. Kontrol presenter, daftar identitas individu tidak tampil di proyektor. **Q&A: pertanyaan yang ditampilkan presenter (`q.visible=true`) tampil di proyektor; peserta hanya melihat pertanyaan yang mereka kirim sendiri, tidak melihat pertanyaan orang lain walau sudah ditampilkan (CH26).** Pengecualian kuis: setelah selesai, papan peringkat menampilkan maksimal lima nama tampilan peserta atau label kelompok beserta poin. Peserta yang tidak masuk top 5 melihat peringkat dan skor sendiri sebagai baris terpisah di bawah daftar utama — termasuk di tampilan proyektor jika yang menonton adalah peserta.

---

## 6. Arsitektur POV (v0.4 baru)

### 6.1 Tiga rute tetap

```
/session/[id]/presenter   — Presenter: kontrol penuh
/session/[id]/participant — Peserta: individu / anggota / penjawab
/session/[id]/projector   — Proyektor: tampilan publik, read-only
```

URL **tidak berubah** selama sesi berlangsung. Peran peserta (individu → anggota → penjawab) dikontrol oleh service, bukan rute.

### 6.2 Fungsi proyeksi state

Setiap command yang di-commit menghasilkan push snapshot ke tiga room:

```typescript
projectForPresenter(session)        → PresenterView  // semua data, kunci, Q&A privat
projectForParticipant(session, pid) → ParticipantView // data milik sendiri, tanpa kunci tersembunyi
projectForProjector(session)        → ProjectorView  // publik saja, tanpa kontrol admin
```

Fungsi ini digunakan oleh:
- `GET /api/sessions/:id/state` (REST snapshot saat join/reconnect)
- Socket.IO broadcast setelah setiap command di-commit

### 6.3 Kontrak bersama (contracts/)

Folder `contracts/` disalin identik ke kedua repo:

```
contracts/
  views.ts        PresenterView, ParticipantView, ProjectorView
  commands.ts     tipe union command klien → server
  acks.ts         CommandAck (requestId, ok, code, message, entityVersion)
  events.ts       tipe union event server → klien
  index.ts        re-export semua
```

Frontend dan backend **tidak boleh mendefinisikan tipe ini secara terpisah**.

### 6.4 MockSessionService (mode demo)

Di frontend, `MockSessionService` berjalan ketika `NEXT_PUBLIC_DEMO_MODE=true`:

- Menjalankan `execute()` dari `domain/engine.ts` dan `quizExecute()` dari `domain/quiz.ts`
- Memanggil `projectForPresenter`, `projectForParticipant`, `projectForProjector` sebelum push ke subscriber
- Tidak ada kunci jawaban yang bocor ke ParticipantView atau ProjectorView
- `SimulationControls` (hanya terlihat di demo) memungkinkan: pindah peran, tambah respons simulasi, putuskan peserta, manual close soal kuis

Di backend, `DEMO_MODE=true` mengaktifkan seed otomatis dan mock clock.

### 6.5 Realtime simplified

Setelah setiap command berhasil di-commit:

1. Server memanggil ketiga fungsi proyeksi
2. Emit `session.snapshot` ke room `presenter-{sessionId}` dengan `PresenterView`
3. Emit `session.snapshot` ke room `projector-{sessionId}` dengan `ProjectorView`
4. Untuk setiap peserta, emit `session.snapshot` ke room `participant-{pid}` dengan `ParticipantView`

Klien **replace** state lokal dengan snapshot baru. Tidak ada patching/merging.

Re-fetch via `GET /api/sessions/:id/state` hanya saat reconnect.

---

## 7. Alur utama

### Presenter

Daftar presentasi → Buat Presentasi → isi judul → tambah dan susun slide → pratinjau → Mulai Sesi → lobi/kode/QR → jalankan aktivitas individu → jalankan Pembagian Kelompok → jalankan aktivitas kelompok → jalankan kuis terakhir jika ada → tampilkan papan peringkat → Akhiri Sesi → ringkasan hasil.

### Peserta

Gabung Sesi → isi kode atau buka QR → isi nama → ruang tunggu → mengikuti slide aktif → kirim jawaban individu → menerima nomor kelompok dan peran → berdiskusi/menjawab sesuai peran → sesi selesai.

### Penjawab kelompok

Melihat label penjawab → berdiskusi → memilih/mengisi respons → Kirim Jawaban Kelompok → semua anggota melihat respons terkirim → dapat memperbarui sebelum ditutup untuk interaksi biasa. Pada kuis, kiriman final dan tidak dapat diperbarui.

---

## 8. Kebutuhan fungsional

### F01 — Presentasi dan editor

*(Tidak berubah dari v0.3.1 §F01)*

Presenter dapat membuat, memberi judul, membuka kembali, menambah, menghapus, dan mengurutkan slide. Setiap tipe slide memiliki kontrol penyuntingan yang sesuai dengan pratinjau WYSIWYG. Slide kosong/tidak valid ditandai sebelum sesi dimulai. Editor menampilkan penanda "Individu" sebelum slide pembagian dan "Kelompok" sesudahnya sebagai informasi, bukan pilihan mode.

Editor WYSIWYG memperlihatkan teks dan gambar sesuai tata letak hasil tampilannya. Presenter memilih varian teks, teks + satu gambar, atau dua gambar berdampingan; posisi elemen mengikuti template, bukan canvas bebas. Gunakan renderer yang sama untuk editor, pratinjau, dan proyektor. Kedua slot gambar dapat diisi/diganti secara independen.

Slide Kuis hanya boleh satu dan selalu terakhir. Slide lain yang ditambahkan setelah kuis secara visual disisipkan sebelum kuis. Pengurutan tidak boleh menempatkan slide di belakang kuis; tampilkan alasan yang jelas.

### F02 — Tipe slide

*(Tidak berubah dari v0.3.1 §F02)*

| Tipe | Isi editor | Perilaku peserta | Hasil |
|------|-----------|-----------------|-------|
| Materi | Judul, teks WYSIWYG, varian teks/teks + satu gambar/dua gambar berdampingan | Membaca mengikuti presenter | Tidak ada respons |
| Pilihan ganda | Pertanyaan, 2–6 opsi, satu kunci, pembahasan opsional | Memilih satu opsi | Jumlah/persentase per opsi; kunci dibuka presenter |
| Polling | Pertanyaan, 2–6 opsi | Memilih satu opsi | Jumlah/persentase, tanpa penilaian benar/salah |
| Awan kata | Pertanyaan/petunjuk | Maksimal tiga frasa, masing-masing maksimal 40 karakter | Frasa sama digabung; ukuran mengikuti frekuensi |
| Q&A | Judul/topik diskusi | Pertanyaan maksimal 300 karakter | Presenter memilih pertanyaan untuk ditampilkan |
| Pembagian Kelompok | Jumlah kelompok atau isi saat sesi | Melihat kelompok dan penjawab setelah dibagikan | Daftar kelompok dan jumlah anggota |
| Kuis | Daftar pertanyaan pilihan ganda, opsi, satu kunci/soal, satu durasi per pertanyaan | Satu kiriman final/soal oleh individu atau penjawab kelompok | Akumulasi poin dan maksimal lima entri peringkat setelah seluruh kuis selesai |

### F03 — Lobi dan identitas

*(Tidak berubah dari v0.3.1 §F03)*

Lobi menampilkan kode, QR, jumlah peserta terhubung, dan daftar nama untuk presenter. Kode enam digit. Peserta wajib mengisi nama tampilan; nama bukan verifikasi identitas.

Mockup menggunakan kode/rute demo dan identitas lokal. Peserta demo menggunakan nama yang dibekukan: **Alya, Bima, Citra, Dimas, Eka, Farah** (D19).

### F04 — Kendali aktivitas dan hasil

Interaksi biasa memiliki status **Belum Dibuka → Menerima Jawaban → Ditutup → (Buka Kembali) → Menerima Jawaban → Ditutup**.

Presenter membuka respons secara eksplisit. Hasil memiliki visibilitas terpisah: Tersembunyi atau Ditampilkan. Default hasil tersembunyi dan baru dapat dibuka setelah respons ditutup.

**Buka Kembali (D18):** Presenter dapat membuka kembali respons yang sudah ditutup. Saat dibuka kembali, hasil publik otomatis tersembunyi sampai respons ditutup lagi. Ini berlaku untuk interaksi biasa (pilihan ganda, polling, awan kata). Kuis tidak memiliki Buka Kembali.

Pilihan ganda/polling menerima satu respons aktif per peserta atau kelompok per slide; pembaruan mengganti respons sebelumnya. Persentase dihitung dari respons valid yang terkirim, bukan seluruh peserta. Tampilkan jumlah respons dan jumlah yang belum menjawab secara terpisah.

Ketika berkelompok, penghitung memakai kelompok: "2 dari 3 kelompok menjawab". Q&A tetap menghitung jumlah pertanyaan.

### F05 — Pembagian kelompok

*(Tidak berubah dari v0.3.1 §F05)*

1. Pembagian terjadi hanya ketika presenter menekan **Bagikan Kelompok** pada slide tersebut.
2. Gunakan peserta yang terhubung saat pembagian. Untuk n peserta dan k kelompok: n minimal 2 dan 1 ≤ k ≤ n.
3. Sistem mengacak urutan peserta dan membagi secara seimbang; selisih anggota paling banyak satu.
4. Pilih satu peserta terhubung secara acak dari setiap kelompok sebagai penjawab.
5. Tampilkan nomor kelompok, anggota, nama penjawab, dan instruksi berkumpul pada HP peserta.
6. Setelah dibagikan, tombol Selanjutnya tersedia.
7. Kelompok tetap sama sampai sesi berakhir.

### F06 — Penjawab kelompok

*(Tidak berubah dari v0.3.1 §F06)*

Penjawab melihat label **Kamu penjawab kelompok** dan tombol **Kirim Jawaban Kelompok**. Anggota lain melihat **Diskusikan bersama. [Nama] akan mengirim jawaban.**

Presenter dapat mengganti penjawab. Hak lama dicabut, respons terdahulu tetap ada. Pada kuis, jawaban yang sudah diterima tetap final.

### F07 — Navigasi dan transisi

*(Tidak berubah dari v0.3.1 §F07)*

Berpindah dari slide biasa yang masih menerima respons menutup respons slide itu. Navigasi kuis mengikuti F10.

### F08 — Peserta terlambat dan gangguan

*(Tidak berubah dari v0.3.1 §F08)*

### F09 — Hasil sesi

*(Tidak berubah dari v0.3.1 §F09)*

### F10 — Sesi kuis dan penilaian

Perubahan dari v0.3.1: **timer menutup otomatis tanpa tombol tutup manual di UI presenter (D16). SimulationControls boleh menyediakan shortcut "Tutup Paksa" untuk keperluan demo.**

Alur: Siap → pertanyaan dibuka oleh presenter → menerima jawaban → **timer menutup otomatis saat tenggat** → pertanyaan berikutnya dibuka presenter → kuis selesai → papan peringkat.

- Satu sesi kuis opsional per presentasi, slide terakhir.
- Minimal satu pertanyaan valid; tidak ada batas maksimum jumlah pertanyaan produk.
- Jawaban bersifat final sekali kirim per pemilik per pertanyaan. Retry identik mengembalikan hasil lama.
- Jika kelompok telah dibentuk, pemilik skor adalah kelompok dan hanya penjawab aktif boleh mengirim.
- Jawaban benar mendapat poin dengan komponen ketepatan dan bonus kecepatan (rumus lihat OQ01).
- Total poin dijumlahkan sepanjang sesi kuis. Urutan peringkat: total poin → jumlah benar → peringkat bersama.
- **Papan peringkat (D14 + D17):** menampilkan maksimal lima entri setelah seluruh kuis selesai. Peserta di luar top 5 melihat peringkat dan skor sendiri sebagai baris terpisah di bawah daftar utama.
- Meninjau soal lama tidak membuka ulang soal, mengganti jawaban, mereset timer, atau menghitung skor kembali.
- Mengakhiri sesi lebih awal menandai kuis tidak selesai.

Backend memakai openedAt, deadlineAt, dan receivedAt dari jam server. Waktu menjawab dihitung dari penerimaan jawaban di server dikurangi waktu soal dibuka.

---

## 9. Daftar layar dan rute (v0.4)

Layar S04 dan S08–S16 **bukan rute URL baru**. Semua adalah state/view di dalam tiga rute POV.

| ID | Layar | Rute | Elemen wajib |
|----|-------|------|--------------|
| S01 | Daftar presentasi | `/` | Buat, buka, pratinjau, riwayat demo |
| S02 | Editor | `/presentations/[id]/edit` | Daftar slide, tambah tipe, ubah urutan, formulir, penanda transisi |
| S03 | Gabung sesi | `/join` | Kode, nama, kesalahan input |
| S04 | Lobi presenter/proyektor | `/session/[id]/presenter` (state: lobby) | Kode, QR, jumlah peserta, mulai |
| S05 | Dashboard presenter | `/session/[id]/presenter` (state: active) | Navigasi, buka/tutup respons, tampilkan hasil, status peserta |
| S06 | Proyektor | `/session/[id]/projector` | Pertanyaan/materi, kemajuan respons, hasil agregat |
| S07 | Peserta individu | `/session/[id]/participant` (sub-peran: individual) | Slide aktif, input respons, status terkirim/ditutup |
| S08 | Pembagian kelompok | `/session/[id]/presenter` (state: grouping) | Jumlah kelompok, Bagikan Kelompok, daftar hasil |
| S09 | Anggota kelompok | `/session/[id]/participant` (sub-peran: member) | Nomor kelompok, anggota, penjawab, respons kelompok baca-saja |
| S10 | Penjawab kelompok | `/session/[id]/participant` (sub-peran: responder) | Identitas kelompok, input aktif, kirim/perbarui |
| S11 | Pengelolaan Q&A | `/session/[id]/presenter` (panel Q&A) | Daftar pertanyaan, tampilkan, sembunyikan, tandai terjawab |
| S12 | Sesi selesai dan ringkasan | `/session/[id]/presenter` (state: ended) | Hasil per slide, label individu/kelompok, ringkasan kuis |
| S13 | Editor kuis | `/presentations/[id]/edit` (panel kuis) | Tambah/urut/hapus soal, satu kunci, durasi bersama, validasi |
| S14 | Kuis presenter | `/session/[id]/presenter` (state: quiz) | Soal aktif, nomor soal, timer, jumlah kiriman, buka soal berikutnya |
| S15 | Kuis peserta/proyektor | `/session/[id]/participant` dan `/session/[id]/projector` (state: quiz) | Timer, status, varian peran |
| S16 | Papan peringkat | `/session/[id]/presenter`, `/session/[id]/participant`, `/session/[id]/projector` (state: leaderboard) | Maks 5 entri + baris sendiri jika di luar top 5 |

**SimulationControls** — komponen overlay berlabel **Kontrol Simulasi**, hanya tampil saat `NEXT_PUBLIC_DEMO_MODE=true`. Menyediakan: pindah peran, tambah respons simulasi, putuskan peserta simulasi, manual close soal kuis (D16), reset demo.

---

## 10. Skenario demo acuan

Gunakan topik netral **Kolaborasi dan Literasi Digital**, enam peserta simulasi (Alya, Bima, Citra, Dimas, Eka, Farah — D19), dan tiga kelompok berisi dua orang.

1. Slide materi pengantar.
2. Pilihan ganda individu: enam peserta dapat menjawab sendiri.
3. Polling individu: tampilkan hasil setelah ditutup.
4. Pembagian Kelompok: tiga kelompok berisi dua orang, satu penjawab per kelompok.
5. Materi diskusi kelompok.
6. Pilihan ganda kelompok: tiga respons maksimum; anggota melihat kiriman penjawab.
7. Awan kata kelompok: setiap penjawab mengirim maksimal tiga frasa.
8. Polling kelompok.
9. Q&A: anggota biasa dapat bertanya; presenter memilih pertanyaan publik.
10. Slide Kuis terakhir dengan tiga pertanyaan; timer menutup otomatis. Simulasikan jawaban benar cepat/lambat, salah, dan tidak menjawab.
11. Papan peringkat kelompok setelah semua soal selesai; peserta di luar top 5 melihat baris sendiri.
12. Akhiri sesi dan buka ringkasan individu, kelompok, serta kuis.

Skenario tambahan: presentasi tanpa pembagian; kuis individu; kuis lebih dari sepuluh pertanyaan; penggantian penjawab; peserta terlambat; Buka Kembali respons.

---

## 11. Kriteria penerimaan

*(AC01–AC29 dari v0.3.1 tidak berubah kecuali yang dicatat di bawah)*

| ID | Kondisi uji | Hasil yang wajib terlihat |
|----|-------------|--------------------------|
| AC01–AC16 | Lihat v0.3.1 §10 | Tidak berubah |
| AC17–AC29 | Lihat v0.3.1 §10 | Tidak berubah kecuali AC24 di bawah |
| AC24 | Membuka peringkat sebelum/selepas selesai | Sebelum selesai tidak tersedia; setelah selesai maks 5 entri; peserta di luar top 5 melihat baris sendiri |
| AC30 | Timer kuis habis tanpa interaksi presenter | Soal menutup otomatis; tidak ada tombol tutup di UI presenter |
| AC31 | SimulationControls close paksa soal kuis | Soal menutup; tombol hanya muncul di mode demo |
| AC32 | Presenter Buka Kembali respons yang sudah ditutup | Respons kembali ke status Menerima Jawaban; hasil publik tersembunyi hingga ditutup lagi |
| AC33 | Peserta peserta ke-6 bergabung dengan sesi yang leaderboard-nya sudah terisi top 5 | Peserta melihat baris peringkat sendiri di bawah daftar utama |
| AC34 | Proyektor di-load satu kali; sesi berlanjut 30 menit | Token proyektor masih valid; tidak perlu join ulang |

---

## 12. Prinsip antarmuka dan aksesibilitas

*(Tidak berubah dari v0.3.1 §11)*

---

## 13. Model data konseptual

*(Tidak berubah dari v0.3.1 §12)*

Tambahan v0.4: `ProjectorToken` — `{ tokenHash, sessionId, createdAt, expiresWhen: 'session_end' }`.

---

## 14. Pemisahan mockup dan build nyata

*(Tidak berubah dari v0.3.1 §13)*

---

## 15. Validasi mockup dan definisi selesai

*(Tidak berubah dari v0.3.1 §14)*

---

## 16. Risiko dan keputusan terbuka

*(Dari v0.3.1 §15, ditambah entri v0.4)*

| Risiko/keputusan | Penanganan |
|-----------------|-----------|
| Pilihan ganda biasa tertukar dengan kuis | Label dan editor terpisah; hanya sesi Kuis memiliki timer/poin/peringkat |
| Skor kecepatan sensitif terhadap jaringan | Gunakan waktu server, receipt idempoten, konfigurasi skor tersimpan |
| Kuis memperbesar scope sprint | Alokasikan blok implementasi khusus; selesaikan inti sebelum editor bebas |
| Anggota salah memahami siapa penjawab | Label peran permanen, nama penjawab, dan respons baca-saja |
| Mockup dianggap real-time nyata | Label simulator dan pemisahan eksplisit pada demo/dokumentasi |
| contracts/ diverge antara dua repo | Salin dari sumber tunggal; jangan edit di masing-masing repo secara terpisah |
| MockSessionService bocorkan kunci jawaban | Gunakan fungsi proyeksi yang sama dengan produksi; uji ParticipantView tidak berisi correctOptionId |

Lihat §"Pertanyaan Terbuka" untuk OQ01–OQ07.

---

## 17. Design system dan interaksi — spesifikasi v0.4

### 17.1 Arah visual

Neo-brutalism tegas dan kontras. **Palet A "Siang Tropis"**: `--main: hsl(190, 100%, 45%)` (cyan), `--background: hsl(46, 88%, 93%)` (krem hangat). Kartu putih (`--secondary-background: #fff`), teks/border/shadow hitam. Warna aksen chart-1–6 digunakan sebagai **solid fill** (bukan tint) di badge tipe slide, leaderboard, dan elemen UI kunci.

**Aturan surface hierarchy — tidak ada dua lapisan dengan warna sama:**
- Page background: krem `hsl(46, 88%, 93%)`
- Card/panel di atasnya: putih `#fff`, border 2–3px hitam, hard shadow 4–6px
- Header/sidebar: `bg-secondary-background` (putih) dengan border bawah 2px tebal

**Setiap warna memiliki TEPAT SATU makna. Tidak ada warna yang digunakan untuk dua tujuan berbeda.**

**Warna tipe slide — solid fill, bukan tint; HANYA untuk type chips, list markers, dan slide header strips:**

| Tipe | Hex | WCAG dengan teks hitam |
|------|-----|------------------------|
| Materi | `#60A5FA` (biru) | 8.3:1 ✓ AA |
| Pilihan Ganda | `#A78BFA` (lavender) | 7.8:1 ✓ AA |
| Polling | `#FB923C` (oranye) | 9.3:1 ✓ AA |
| Awan Kata | `#FFD93D` (kuning) | 15.2:1 ✓ AA |
| Q&A | `#FF8FCB` (pink) | 10.1:1 ✓ AA |
| Pembagian Kelompok | `#2DD4BF` (teal) | 11.2:1 ✓ AA |
| Kuis | `#B8F25B` (lime) | 16.0:1 ✓ AA |

**Warna chart bar (HANYA untuk bar chart bars, tidak pernah untuk type chips):**
`--chart-1: #00C6D6` (cyan), `--chart-2: #FFD93D` (kuning), `--chart-3: #FF8FCB` (pink), `--chart-4: #A78BFA` (lavender), `--chart-5: #FB923C` (oranye), `--chart-6: #60A5FA` (biru).
Palet Siang Tropis cerah; tidak ada merah (berarti salah), tidak ada hijau (berarti benar), tidak ada abu-abu (mati). Berbagi rona dengan type chip diizinkan (hanya satu tipe terlihat per tampilan). Markah jawaban benar: ikon + mint, TIDAK pernah warna bar.

**Warna semantic (makna tunggal):**
- `--main: hsl(190,100%,45%)` (cyan): HANYA aksi utama (primary button)
- `--success: #34D399` (mint): HANYA benar/sukses; selalu disertai ikon Check, tidak mengandalkan warna saja
- `--error: hsl(8,88%,50%)` = `#FF6B5B` (coral): HANYA destructive/error; tidak digunakan sebagai warna tipe slide
- Medal leaderboard: emas `#FBBF24`, perak `#CBD5E1`, perunggu `#D97706` — TIDAK tumpang tindih dengan tipe slide

**Aturan aksi tombol:**
- Aksi utama (Buka Aktivitas, Kirim Jawaban, Mulai Sesi): `bg-main` cyan solid
- Destructive/akhiri sesi: `#FF6B5B` coral
- Teks di atas isian aksen selalu hitam
- Disabled: `#e5e7eb` bg + `#4b5563` text (tidak pernah warna aksen washed-out)

**Ikon:** Semua ikon dari lucide-react, strokeWidth 2.5. Tidak ada emoji, ✓, ✗, ★, atau glyph non-alfabet di UI. Test `domain/emoji-check.spec.ts` menegakkan aturan ini secara otomatis.

**States:**
- Selected/active: solid accent fill + black border + hard shadow (bukan pale tint)
- Disabled: `#e5e7eb` bg, `#4b5563` text, no shadow — jelas disabled, bukan washed-out accent
- Hover: neo-brutalism shift (translate-x-[2px] translate-y-[2px] + shadow menghilang)

**Tidak ada** `bg-*/10`, `bg-*/20`, atau tint opacity rendah pada elemen UI bermakna.

**Hanya tema terang.** Karsa tidak mendukung dark mode. Atur `color-scheme: light` di `:root` dan `body`. Tidak ada `@media (prefers-color-scheme: dark)` di codebase.

### 17.2 Token visual

Token warna utama (palette A): `--background: hsl(46, 88%, 93%)` (krem hangat), `--main: hsl(190, 100%, 45%)` (cyan), `--secondary-background: #fff` (kartu).

Token warna chart bar (HANYA bar charts, palet Siang Tropis, tanpa merah/hijau/abu-abu): `--chart-1: #00C6D6`, `--chart-2: #FFD93D`, `--chart-3: #FF8FCB`, `--chart-4: #A78BFA`, `--chart-5: #FB923C`, `--chart-6: #60A5FA`.

Token tipe slide (HANYA type chips/markers): `--slide-materi: #60A5FA`, `--slide-pilihan: #A78BFA`, `--slide-polling: #FB923C`, `--slide-awan: #FFD93D`, `--slide-tanya: #FF8FCB`, `--slide-kelompok: #2DD4BF`, `--slide-kuis: #B8F25B`. Implementasi di `lib/slide-colors.ts` (SLIDE_COLOR map).

Token status: `--success: #34D399`, `--success-foreground: #000`, `--error: hsl(8, 88%, 50%)`.

Skala (CH43): `font-weight-heading: 800`, card border: 3px (override globals.css), button min-height: 40px (48px mobile), button font-weight: 700.

Override globals.css: `[data-slot="card"] { background-color: var(--secondary-background); border-width: 3px; }` · `[data-slot="button"] { min-height: 40px; font-weight: 700; }` · `[data-slot="button"]:disabled { opacity:1; background:#e5e7eb; color:#4b5563; box-shadow:none; border-color:#9ca3af; }`

Override globals.css: `[data-slot="card"] { background-color: var(--secondary-background); }` (kartu selalu putih). `[data-slot="button"]:disabled { opacity:1; background:#e5e7eb; color:#4b5563; box-shadow:none; border-color:#9ca3af; }` (disabled selalu abu-abu, bukan accent washed-out).

### 17.3 Komponen bersama

*(Tidak berubah dari v0.3.1 §17.3)*

Gunakan **Neobrutalism Components** (shadcn/ui-based, Base UI) sebagai fondasi. Override token `--main` dan `--background` di `globals.css`. Shadow `4px 4px 0px 0px var(--border)` sudah benar di paket blue.json.

Init: `pnpm dlx shadcn@latest init https://neobrutalism.dev/r/styling/blue.json`

Instalasi komponen: `pnpm dlx shadcn@latest add https://neobrutalism.dev/r/[component].json`

### 17.4 Tata letak per perangkat

*(Tidak berubah dari v0.3.1 §17.4)*

### 17.5 Perilaku interaktif

*(Tidak berubah dari v0.3.1 §17.5)*

### 17.6 Pemeriksaan desain

**Kontras WCAG AA wajib:** semua teks harus memenuhi rasio kontras minimal 4.5:1 (teks normal) atau 3:1 (teks besar ≥18pt). Label penting dan kode sesi menggunakan hitam atau mendekati hitam (`--foreground`), bukan abu-abu opacity rendah. Pemeriksaan otomatis dengan `axe color-contrast` dijalankan sebagai bagian dari e2e suite (`contrast.spec.ts`) pada layar: projector join, projector bar chart, presenter dashboard, participant phone 360 px — dalam emulasi OS light dan dark.

---

## 18. Tech stack dan struktur (v0.4)

### 18.1 Frontend — mockup-karsa-frontend

| Lapisan | Pilihan | Alasan |
|---------|---------|--------|
| Framework | Next.js App Router + TypeScript | Presenter/participant/projector dalam satu aplikasi |
| UI | Neobrutalism Components (Base UI) | Komponen neo-brutalism siap pakai |
| Ikon | Lucide React | Satu gaya ikon |
| State mockup | Zustand | State sesi simulasi dan perpindahan peran |
| Form/kontrak | React Hook Form + Zod | Validasi input dan skema payload |
| Persistensi demo | localStorage dengan schemaVersion | Draft dan fixture; tidak untuk token produksi |
| Animasi | CSS transitions | Cukup untuk MVP |
| Realtime nanti | socket.io-client | Terpisah dari state UI lokal |

Font: **Plus Jakarta Sans**, weights 400/500/600/700.

Struktur:

```
mockup-karsa-frontend/
  app/
    (public)/join/            → S03
    presentations/[id]/edit/  → S02, S13
    session/[id]/
      presenter/              → S04, S05, S08, S11, S12, S14, S16
      participant/            → S07, S09, S10, S15, S16
      projector/              → S06, S15, S16
  contracts/                  ← salinan identik dari contracts/ bersama
  domain/                     ← model.ts, engine.ts, quiz.ts, quiz-config.ts (dari ruang-rasa-prototype)
  services/
    mock-session-service.ts   ← menggunakan fungsi proyeksi
    api-session-service.ts    ← implementasi nyata (stub)
  components/
    ui/                       ← Neobrutalism Components
    session/                  ← SessionCard, SlideRenderer, dll
  lib/
    demo-fixtures.ts          ← dari fixtures.ts (Alya, Bima, Citra, Dimas, Eka, Farah)
```

### 18.2 Backend — mockup-karsa-backend

| Lapisan | Pilihan | Alasan |
|---------|---------|--------|
| Framework | NestJS + TypeScript | Modul terpisah, gateway real-time |
| ORM | Prisma + PostgreSQL | Tipe-safe schema, migrasi |
| Realtime | Socket.IO | Gateway NestJS native |
| Auth | Argon2id (hash password presenter) | §19.3 |
| Upload | Multer + validasi tipe | §19.5, §19.8; 5MB limit |

Struktur:

```
mockup-karsa-backend/
  contracts/                  ← salinan identik dari contracts/ bersama
  domain/                     ← model.ts, engine.ts, quiz.ts, quiz-config.ts (dari ruang-rasa-prototype)
  src/
    auth/
    presentations/
    sessions/
    participants/
    groups/
    responses/
    questions/
    quiz/
    realtime/
    assets/
  prisma/
    schema.prisma
    seed.ts                   ← 4 presentasi demo, 6 peserta (Alya, Bima, Citra, Dimas, Eka, Farah)
```

---

## 19. Kontrak REST minimum

*(Tidak berubah dari v0.3.1 §19.5, ditambah endpoint proyektor)*

| Method dan rute | Fungsi | Akses |
|----------------|---------|-------|
| POST /api/auth/register, /login, /logout | Akun/sesi presenter | Publik atau sesi terkait |
| GET/POST /api/presentations | Daftar/buat | Presenter |
| GET/PATCH/DELETE /api/presentations/:id | Baca/ubah/hapus draft | Pemilik |
| PUT /api/presentations/:id/slides | Simpan susunan tervalidasi | Pemilik |
| POST /api/presentations/:id/sessions | Buat sesi dan snapshot | Pemilik |
| POST /api/sessions/join | Kode + nama; keluarkan identitas peserta | Publik dengan rate limit |
| GET /api/sessions/:id/state | Snapshot terproyeksi menurut peran | Anggota/presenter/proyektor berizin |
| GET /api/sessions/:id/projector-token | Token proyektor read-only; persisten per sesi (D20) | Pemilik sesi |
| GET /api/sessions/:id/results | Ringkasan | Pemilik |
| POST /api/assets | Upload gambar ≤5 MB, cek tipe | Presenter |

**Tidak ada** `POST /api/sessions/:id/command`. Semua mutasi sesi live melalui Socket.IO.

---

## 20. Command dan event real-time

*(Tidak berubah dari v0.3.1 §19.6)*

Envelope command: requestId, sessionId, slideId bila relevan, expectedVersion, responderVersion, dan payload. Identitas actor diturunkan dari kredensial server.

Ack: requestId, ok, code, message berbahasa Indonesia, entityVersion.

Setelah setiap command di-commit, server memanggil fungsi proyeksi dan emit `session.snapshot` ke room yang sesuai (§6.5).

---

## 21. Pengiriman ulang, konflik, dan pemulihan

*(Tidak berubah dari v0.3.1 §19.7)*

---

## 22. Keamanan dasar, pengujian, dan operasi

*(Tidak berubah dari v0.3.1 §19.8)*

---

## 23. Rencana implementasi mockup — fase dan estimasi

| Fase | Isi | Prioritas |
|------|-----|-----------|
| **Phase 0** | Scaffold kedua repo; contracts/; salin domain files; Neobrutalism init + 15 komponen; typecheck hijau | Wajib |
| **Phase 1** | S01 Daftar presentasi + S02 Editor (semua tipe slide) + S13 Editor kuis; simpan ke localStorage; validasi posisi kuis | Wajib |
| **Phase 2** | S03 Join + S04 Lobi; MockSessionService + Zustand store; SimulationControls; 6 peserta auto-join | Wajib |
| **Phase 3** | S05 Presenter dashboard + S06 Proyektor; semua tipe slide live; buka/tutup/tampilkan hasil; S08 Pembagian Kelompok | Wajib |
| **Phase 4** | S07 Individu + S09 Anggota + S10 Penjawab; S14–S15 Kuis (timer auto-close, D16); S16 Leaderboard (D17) | Wajib (alokasi 5h) |
| **Phase 5** | S11 Q&A; S12 Ringkasan; Buka Kembali (D18); token proyektor (D20); aksesibilitas; uji lebar 360px | Wajib |
| **Phase 6** | Backend NestJS: Prisma schema, modul auth/sessions/groups/responses/quiz, Socket.IO gateway, seed | Bonus |

Kuis dan leaderboard diselesaikan **sebelum** polish aksesibilitas (Phase 4 lebih awal dari Phase 5).

---

## CHANGELOG IMPLEMENTASI MOCKUP

### Stop 1 fix (2026-10-17)

#### Fixed
- **Card backgrounds**: `Card`, `Dialog`, `Popover`, `DropdownMenu`, `Select`, `Drawer`, `Toast`
  all use `bg-secondary-background` (white). The previous `@layer base` override in `globals.css`
  was ineffective; fix moved to component level.
- **Chart bar colors**: replaced old palette (included `#EF4444` red — reads as "wrong answer",
  `#16A34A` green — reads as "correct", `#475569` dead gray) with bright Siang Tropis set:
  `#00C6D6` cyan, `#FFD93D` yellow, `#FF8FCB` pink, `#A78BFA` lavender, `#FB923C` orange,
  `#60A5FA` blue. No red, no green, no gray. Correct-answer marking: icon + mint only.

#### Added
- **Dot-grid page background**: subtle cream dot-grid on `body` via `radial-gradient`.
- **Card contrast Playwright spec** (`e2e/card-contrast.spec.ts`): runs inside main e2e config
  (ports 3100/3101). Asserts every visible `[data-slot="card"]` differs from body background.
- **Screenshot Playwright spec** (`e2e/ui-screenshots.spec.ts`): regenerates screenshots with
  `pnpm test:e2e:screenshots`. Config `playwright.screenshots.config.ts` overrides
  `NEXT_PUBLIC_API_URL` (bypasses stale IP in `.env.local`).
- `uploads/` added to backend `.gitignore`.

#### Config disclosure
`.env.local` must have `NEXT_PUBLIC_API_URL=http://localhost:3001` (not the LAN IP).

---

### Stop 2 (2026-10-17)

#### C1 — Two-image Materi layout
- `Slide.layout` type extended: `"dua-gambar-lr"` (kiri–kanan, side-by-side) and
  `"dua-gambar-tb"` (atas–bawah, stacked). Backward-compatible: `"dua-gambar"` accepted and
  treated as `"dua-gambar-lr"`. Updated in `domain/model.ts` (TS type + Zod enum) in both repos.
  Tests in `domain/c1-layout.spec.ts` (both repos).
- Editor layout chips: "Dua Gambar (Sejajar)" and "Dua Gambar (Bertumpuk)" with filled selected
  state. Canvas image slots stack for `dua-gambar-tb`.
- `MateriSlide` shared component: dua-gambar-tb image column is `w-1/2` with `items-stretch` so
  images fill the full slide height. Same proportions on all variants.

#### C2 — BarChart
- `BarChart` accepts `size?: 'sm' | 'md' | 'lg'` (default `'md'`).
  - `'lg'` (projector): bar area `flex-1 min-h-0`, count/% ≥40px/28px, labels 24px, check `size-8`.
  - `'md'` (presenter/participant): bar area `h-56`, count `text-xl` (20px), % `text-base` (16px),
    labels `text-sm` (14px). Satisfies ≥20px presenter and ≥16px at 360px phone.
- Projector passes `size="lg"` to all charts. Container switches from `justify-center` to top-align.

#### MateriSlide shared component (`features/shared/MateriSlide.tsx`)
- Renders all layouts for all variants. Wired into `ProjectorActiveView`, `MateriPanel`, `MateriView`.

#### ResponsePanel correct/wrong styling
- Correct: `border-4 border-[#34D399]` + Check icon. No fill color.
- Wrong-selected: `border-4 border-black` + X icon + "Jawabanmu" label. No opacity reduction.

#### Login + Register pages
- `KarsaWordmark size="md"` above card on both pages.
- Error messages: `border-2 border-[var(--error)] bg-secondary-background text-foreground` (no tint).
- Register page created (`app/register/page.tsx`): email + password + confirm, auto-login after
  registration, same error pattern.

#### Presentation list
- `KarsaWordmark size="sm"` in header.
- Backend list API includes `slideCount` and `slideKinds[]` (computed from `slidesJson`).
  Test: `src/presentations/presentations.list.spec.ts`.
- Cards show slide count and per-type color chips.

#### Editor improvements
- Slide list: full-width type chips (14px bold, `kindColors` fill, border, rounded-base) with
  clear selected state (filled foreground border + shadow). Slide title below chip in muted text.
- Save status: `text-success` (saved) and `text-[var(--error)]` (conflict/error), no hardcoded green/red.
- Validation error strip: `border-[var(--error)]` instead of `border-red-400`.
- Results tab badge: uses `bg-[#34D399]` for active and neutral for ended.

#### Awan kata moderation
- Hidden words use `border-[var(--error)]` + `line-through opacity-60` instead of red fill.

#### domain/model.ts — newSlide default title (2026-10-18)
- `newSlide(type)` now sets `title: labels[type]` instead of `title: ""`.
  Synced identically in both repos (frontend `domain/model.ts` and backend `src/domain/model.ts`).
  Rationale: the editor C3 test expects the new slide title to include the type label so it can be
  found in the slide list; an empty title displayed as "(tanpa judul)" was not useful as a default.
