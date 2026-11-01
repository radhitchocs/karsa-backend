# KARSA Backend

Backend NestJS untuk **KARSA** — platform presentasi interaktif berbahasa Indonesia.

KARSA memungkinkan peserta masuk ke sesi via kode atau QR tanpa perlu membuat akun.
Respons dikumpulkan secara real-time via Socket.IO. Pada slide kelompok, server membagi
peserta ke dalam grup dan memvalidasi satu penjawab per kelompok. Tersedia kuis berskor
dengan timer dan leaderboard, serta fitur **Pancing Peserta** — presenter memilih satu
peserta secara acak dari yang sedang online, divalidasi server, dengan opsi exclude
peserta yang sudah pernah dipilih di slide yang sama.

- **Repo pasangan (frontend):** https://github.com/radhitchocs/karsa-frontend
- **Live product (frontend):** https://karsa-frontend.vercel.app/
- **Live backend:** https://ey3fd1lp8646-production-2ljnp1e5.australia-southeast1.suga.run
- **Demo video:** https://drive.google.com/file/d/1qA4C-z70lP5itGz-peg7jnSw5VpOgZ5T/view?usp=sharing

---

## Package manager

**npm** (pnpm v12 memblokir native builds seperti argon2 dan @prisma/engines)

```bash
npm install
```

## Setup

```bash
# 1. Salin env
cp .env.example .env
# Edit .env sesuai kebutuhan

# 2. Jalankan PostgreSQL via Docker
docker compose up -d

# 3. Jalankan migrasi Prisma
npx prisma migrate dev

# 4. Generate Prisma Client
npx prisma generate

# 5. Seed data demo (opsional)
npm run prisma:seed

# 6. Jalankan server
npm run start:dev
```

## Environment variables

| Variable | Default | Keterangan |
|----------|---------|-----------|
| `DATABASE_URL` | `postgresql://postgres:postgres@localhost:5432/karsa` | Koneksi PostgreSQL |
| `DEMO_MODE` | `true` | Aktifkan seed demo dan mock clock |
| `JWT_SECRET` | `dev-secret-change-in-production` | Secret JWT (ganti di produksi) |
| `PORT` | `3001` | Port server |

## Scripts

```bash
npm run start:dev       # Dev server dengan watch mode
npm run build           # Production build (output: dist/)
npm run start:prod      # node dist/main.js
npm run test            # Vitest unit tests
npx prisma migrate dev  # Buat migrasi baru
npx prisma generate     # Regenerate Prisma Client
npm run prisma:seed     # Seed data demo (4 presentasi, 6 peserta)
bash scripts/check-contracts.sh  # Verifikasi contracts/ identik dengan frontend
```

## Health endpoint

```
GET http://localhost:3001/health
→ {"status":"ok","timestamp":"..."}
```

## Contracts sync

`src/contracts/` harus identik dengan `../karsa-frontend/contracts/`.
Jalankan `bash scripts/check-contracts.sh` sebelum commit jika mengubah contracts.

## Struktur src/

```
src/
  auth/          Autentikasi presenter (Argon2id)
  presentations/ CRUD presentasi dan slide
  sessions/      Manajemen sesi dan snapshot
  participants/  Join, identitas, presence
  groups/        Pembagian kelompok dan penjawab
  responses/     Submit dan agregasi respons
  questions/     Q&A dan moderasi
  quiz/          Timer, penilaian, leaderboard
  realtime/      Socket.IO gateway
  assets/        Upload gambar (≤5 MB)
  prisma/        PrismaService (singleton, global)
  domain/        Domain logic (engine, quiz, projection)
  contracts/     View/command/ack/event types (identik dengan frontend)
  generated/     Prisma Client (auto-generated, di-gitignore)
```

---

## AI Use and Third-Party Declaration

### AI dalam produk

AI **tidak** digunakan di dalam produk. Tidak ada API AI, model, atau inferensi yang
dipanggil saat runtime.

Selama pengembangan, tim menggunakan asisten pengodean berbasis AI (Claude).

### Library dan framework pihak ketiga (dari `package.json`)

Lisensi diverifikasi dari `node_modules/<paket>/package.json`.

**Dependencies (runtime):**

| Package | Versi | Lisensi |
|---------|-------|---------|
| `@nestjs/common` | ^12.0.1 | MIT |
| `@nestjs/core` | ^12.0.1 | MIT |
| `@nestjs/config` | ^12.0.1 | MIT |
| `@nestjs/jwt` | ^12.0.2 | MIT |
| `@nestjs/platform-express` | ^12.0.1 | MIT |
| `@nestjs/platform-socket.io` | ^12.1.2 | MIT |
| `@nestjs/serve-static` | ^12.0.0 | MIT |
| `@nestjs/websockets` | ^12.1.2 | MIT |
| `@prisma/adapter-pg` | ^7.10.0 | Apache-2.0 |
| `@prisma/client` | ^7.10.0 | Apache-2.0 |
| `socket.io` | ^4.8.4 | MIT |
| `zod` | ^4.6.5 | MIT |
| `argon2` | ^0.45.1 | MIT |
| `class-transformer` | ^0.5.1 | MIT |
| `class-validator` | ^0.15.1 | MIT |
| `dotenv` | ^18.0.7 | BSD-2-Clause |
| `multer` | 2.4.0 | MIT |
| `pg` | ^8.23.1 | MIT |
| `reflect-metadata` | ^0.2.2 | Apache-2.0 |
| `rxjs` | ^7.8.1 | Apache-2.0 |

**DevDependencies:**

| Package | Versi | Lisensi |
|---------|-------|---------|
| `@nestjs/cli` | ^12.0.0 | MIT |
| `@nestjs/schematics` | ^12.0.0 | MIT |
| `@nestjs/testing` | ^12.0.1 | MIT |
| `prisma` | ^7.10.0 | Apache-2.0 |
| `typescript` | ^6.0.2 | Apache-2.0 |
| `vitest` | ^4.1.2 | MIT |
| `oxlint` | ^1.58.0 | MIT |
| `prettier` | ^3.4.2 | MIT |
| `tsx` | ^4.19.4 | MIT |

### Aset eksternal

Tidak ditemukan aset gambar, font, atau ikon pihak ketiga yang disertakan langsung di repo
backend.
