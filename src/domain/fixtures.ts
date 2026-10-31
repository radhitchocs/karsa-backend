import { Data, Presentation, Slide, newSlide, uid } from "./model";
const slide = (
  type: Slide["type"],
  title: string,
  extra: Partial<Slide> = {},
): Slide => ({ ...newSlide(type), title, ...extra });
export function fixtures(): Data {
  const slides = [
    slide("materi", "Ide hebat dimulai dari percakapan.", {
      body: "Kolaborasi dan Literasi Digital\nMari belajar, berbagi sudut pandang, dan menemukan jawaban bersama.",
      image: "/collaboration.svg",
      layout: "teks-gambar",
    }),
    slide("pilihan", "Apa langkah pertama saat menerima informasi baru?", {
      options: [
        "Langsung membagikannya",
        "Memeriksa sumber informasi",
        "Melihat jumlah suka",
        "Mengikuti pendapat terbanyak",
      ],
      correct: [1],
      explanation: "Periksa sumber dan konteks sebelum menyebarkan informasi.",
    }),
    slide("polling", "Bagaimana kamu paling nyaman berbagi ide?", {
      options: [
        "Berdiskusi berdua",
        "Bicara dalam kelompok",
        "Menulis lebih dulu",
        "Langsung di forum",
      ],
    }),
    slide("kelompok", "Saatnya bertukar sudut pandang."),
    slide("materi", "Berbeda perspektif, satu tujuan.", {
      body: "Diskusikan bersama kelompokmu: bagaimana menciptakan ruang digital yang aman dan inklusif?\nPastikan setiap anggota mendapat kesempatan berbicara.",
    }),
    slide("pilihan", "Apa yang membuat kolaborasi digital lebih inklusif?", {
      options: [
        "Semua harus selalu daring",
        "Memberi ruang untuk beragam cara berkontribusi",
        "Satu orang mengambil semua keputusan",
      ],
      correct: [1],
    }),
    slide("awan", "Tiga kata untuk ruang digital yang lebih baik."),
    slide("polling", "Kebiasaan mana yang ingin kelompokmu mulai?", {
      options: [
        "Memeriksa sumber",
        "Mendengarkan lebih aktif",
        "Berbagi sumber belajar",
        "Memberi umpan balik",
      ],
    }),
    slide("tanya", "Apa yang masih ingin kamu tanyakan?"),
    slide("kuis", "Tantangan kolaborasi digital", {
      duration: 10,
      quizQuestions: [
        {
          id: uid(),
          title: "Sebelum membagikan berita, kita…",
          options: ["Memeriksa sumber", "Meneruskan langsung"],
          correct: [0],
        },
        {
          id: uid(),
          title: "Kolaborasi inklusif memberi ruang untuk…",
          options: ["Satu suara", "Semua anggota"],
          correct: [1],
        },
        {
          id: uid(),
          title: "Saat berbeda pendapat, kita…",
          options: ["Saling mendengarkan", "Mengabaikan orang lain"],
          correct: [0],
        },
      ],
    }),
  ];
  const make = (title: string, ss: Slide[]): Presentation => ({
    id: uid(),
    title,
    slides: structuredClone(ss),
    updated: new Date().toISOString(),
  });
  return {
    schemaVersion: 2,
    presentations: [
      make("Kolaborasi dan Literasi Digital", slides),
      make("Bersama sejak awal", [slides[3], slides[4], slides[5], slides[8]]),
      make("Diskusi setelah presentasi", [slides[0], slides[1], slides[3]]),
      make("Belajar dengan suara sendiri", [
        slides[0],
        slides[1],
        slides[2],
        slides[6],
        slides[8],
        slides[9],
      ]),
    ],
    sessions: [],
  };
}
