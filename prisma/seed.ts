/**
 * Demo seed — inserts 4 presentations and 1 demo user.
 * Idempotent: skips if demo user already exists.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client';
import * as argon2 from 'argon2';
import { uid, newSlide } from '../src/domain/model';
import type { Slide } from '../src/domain/model';

const adapter = new PrismaPg({ connectionString: process.env['DATABASE_URL']! });
const prisma = new PrismaClient({ adapter } as ConstructorParameters<typeof PrismaClient>[0]);

const slide = (type: Slide['type'], title: string, extra: Partial<Slide> = {}): Slide =>
  ({ ...newSlide(type), title, ...extra });

async function main() {
  // Idempotency guard
  const existing = await prisma.user.findUnique({ where: { email: 'demo@karsa.id' } });
  if (existing) {
    console.log('Seed already applied. Skipping.');
    await prisma.$disconnect();
    return;
  }

  const passwordHash = await argon2.hash('demo1234');
  const user = await prisma.user.create({
    data: { email: 'demo@karsa.id', passwordHash },
  });

  const slides = [
    slide('materi', 'Ide hebat dimulai dari percakapan.', {
      body: 'Kolaborasi dan Literasi Digital\nMari belajar, berbagi sudut pandang, dan menemukan jawaban bersama.',
      layout: 'teks-gambar',
    }),
    slide('pilihan', 'Apa langkah pertama saat menerima informasi baru?', {
      options: ['Langsung membagikannya', 'Memeriksa sumber informasi', 'Melihat jumlah suka', 'Mengikuti pendapat terbanyak'],
      correct: 1,
      explanation: 'Periksa sumber dan konteks sebelum menyebarkan informasi.',
    }),
    slide('polling', 'Bagaimana kamu paling nyaman berbagi ide?', {
      options: ['Berdiskusi berdua', 'Bicara dalam kelompok', 'Menulis lebih dulu', 'Langsung di forum'],
    }),
    slide('kelompok', 'Saatnya bertukar sudut pandang.'),
    slide('materi', 'Berbeda perspektif, satu tujuan.', {
      body: 'Diskusikan bersama kelompokmu: bagaimana menciptakan ruang digital yang aman dan inklusif?',
    }),
    slide('pilihan', 'Apa yang membuat kolaborasi digital lebih inklusif?', {
      options: ['Semua harus selalu daring', 'Memberi ruang untuk beragam cara berkontribusi', 'Satu orang mengambil semua keputusan'],
      correct: 1,
    }),
    slide('awan', 'Tiga kata untuk ruang digital yang lebih baik.'),
    slide('polling', 'Kebiasaan mana yang ingin kelompokmu mulai?', {
      options: ['Memeriksa sumber', 'Mendengarkan lebih aktif', 'Berbagi sumber belajar', 'Memberi umpan balik'],
    }),
    slide('tanya', 'Apa yang masih ingin kamu tanyakan?'),
    slide('kuis', 'Tantangan kolaborasi digital', {
      quizQuestions: [
        { id: uid(), title: 'Sebelum membagikan berita, kita…', options: ['Memeriksa sumber', 'Meneruskan langsung'], correct: 0 },
        { id: uid(), title: 'Kolaborasi inklusif memberi ruang untuk…', options: ['Satu suara', 'Semua anggota'], correct: 1 },
        { id: uid(), title: 'Saat berbeda pendapat, kita…', options: ['Saling mendengarkan', 'Mengabaikan orang lain'], correct: 0 },
      ],
    }),
  ];

  const make = (title: string, ss: Slide[]) =>
    prisma.presentation.create({
      data: { ownerId: user.id, title, slidesJson: JSON.parse(JSON.stringify(ss)) },
    });

  await Promise.all([
    make('Kolaborasi dan Literasi Digital', slides),
    make('Bersama sejak awal', [slides[3], slides[4], slides[5], slides[8]]),
    make('Diskusi setelah presentasi', [slides[0], slides[1], slides[3]]),
    make('Belajar dengan suara sendiri', [slides[0], slides[1], slides[2], slides[6], slides[8], slides[9]]),
  ]);

  console.log(`Seeded: user demo@karsa.id, 4 presentations`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
