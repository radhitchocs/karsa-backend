# mockup-karsa-backend

Backend NestJS untuk Karsa — platform presentasi interaktif berbahasa Indonesia.

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

`src/contracts/` harus identik dengan `../mockup-karsa-frontend/contracts/`.
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
  domain/        Domain logic (verbatim dari ruang-rasa-prototype)
  contracts/     View/command/ack/event types (identik dengan frontend)
  generated/     Prisma Client (auto-generated, di-gitignore)
```
test past
test future
