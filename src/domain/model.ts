import { QUIZ_DEFAULT_DURATION } from "./quiz-config";
import { z } from "zod";
export const kinds = [
  "materi",
  "pilihan",
  "polling",
  "awan",
  "tanya",
  "kelompok",
  "kuis",
  "pancing",
] as const;
export type Kind = (typeof kinds)[number];
export const labels: Record<Kind, string> = {
  kuis: "Kuis",
  materi: "Materi",
  pilihan: "Pilihan ganda",
  polling: "Polling",
  awan: "Awan kata",
  tanya: "Q&A",
  kelompok: "Pembagian Kelompok",
  pancing: "Pancing Peserta",
};
export type Slide = {
  id: string;
  type: Kind;
  title: string;
  body: string;
  options: string[];
  correct: number[];
  explanation: string;
  image: string;
  groups: number;
  layout?: "teks" | "teks-gambar" | "dua-gambar" | "dua-gambar-lr" | "dua-gambar-tb";
  image2?: string;
  imageFit?: "contain" | "cover";
  textStyle?: "normal" | "bold";
  textAlign?: "left" | "center";
  quizQuestions?: QuizQuestion[];
  duration?: number;
};
export type QuizQuestion = {
  id: string;
  title: string;
  options: string[];
  correct: number[];
};
export type QuizAnswer = {
  ownerId: string;
  submittedBy: string;
  option: number;
  requestId: string;
  receivedAt: number;
  correct: boolean;
  score: number;
};
export type QuizRun = {
  questionId: string;
  openedAt: number;
  deadlineAt: number;
  closed: boolean;
  answers: QuizAnswer[];
  resultsVisible?: boolean;
};
export type QuizState = {
  slideId: string;
  ownerType: "individu" | "kelompok";
  runs: QuizRun[];
  finished: boolean;
  revealed: boolean;
  config: { version: string; base: number; bonus: number };
};
export type Presentation = {
  id: string;
  title: string;
  slides: Slide[];
  updated: string;
};
export type Participant = { id: string; name: string; online: boolean; simulated?: boolean };
export type Group = {
  id: string;
  number: number;
  members: string[];
  responder: string;
};
export type Response = {
  id: string;
  slideId: string;
  ownerType: "individu" | "kelompok";
  ownerId: string;
  submittedBy: string;
  value: string[];
  updated: string;
};
export type Question = {
  id: string;
  slideId: string;
  participantId: string;
  text: string;
  visible: boolean;
  answered: boolean;
};
export type Activity = {
  status: "belum" | "buka" | "tutup";
  visible: boolean;
  hiddenWords: string[];
};
export type PancingPick = {
  slideId: string;
  participantId: string;
  participantName: string;
  timestamp: number;
};
export type Session = {
  id: string;
  presentationId: string;
  title: string;
  slides: Slide[];
  code: string;
  status: "lobi" | "aktif" | "selesai";
  active: number;
  division: number;
  participants: Participant[];
  groups: Group[];
  responses: Response[];
  questions: Question[];
  activities: Record<string, Activity>;
  picks?: PancingPick[];
  paused: boolean;
  presenterOnline: boolean;
  hideContent: boolean;
  created: string;
  quiz?: QuizState;
  clockOffset?: number;
};
export type Data = {
  schemaVersion: 1 | 2;
  presentations: Presentation[];
  sessions: Session[];
};
export const uid = (): string => {
  if (typeof (crypto as Crypto).randomUUID === 'function') return (crypto as Crypto).randomUUID();
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (n) => n.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

export const slideSchema = z.object({
  id: z.string(),
  type: z.enum(kinds),
  title: z.string(),
  body: z.string(),
  options: z.array(z.string()),
  correct: z.union([z.number(), z.array(z.number())]).transform((v) =>
    typeof v === "number" ? [v] : v,
  ),
  explanation: z.string(),
  image: z.string(),
  groups: z.number(),
  layout: z.enum(["teks", "teks-gambar", "dua-gambar", "dua-gambar-lr", "dua-gambar-tb"]).optional(),
  image2: z.string().optional(),
  imageFit: z.enum(["contain", "cover"]).optional(),
  textStyle: z.enum(["normal", "bold"]).optional(),
  textAlign: z.enum(["left", "center"]).optional(),
  quizQuestions: z.array(z.object({
    id: z.string(),
    title: z.string(),
    options: z.array(z.string()),
    correct: z.union([z.number(), z.array(z.number())]).transform((v) =>
      typeof v === "number" ? [v] : v,
    ),
  })).optional(),
  duration: z.number().optional(),
});
export const slidesSchema = z.array(slideSchema);

export const joinSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "Masukkan kode sesi 6 digit."),
  name: z
    .string()
    .trim()
    .min(1, "Nama wajib diisi.")
    .max(40, "Nama maksimal 40 karakter."),
});
export function newSlide(type: Kind): Slide {
  return {
    id: uid(),
    type,
    title: labels[type],
    body: "",
    options: ["", ""],
    correct: [],
    explanation: "",
    image: "",
    groups: 3,
    layout: "teks",
    image2: "",
    imageFit: "contain",
    quizQuestions: [],
    duration: QUIZ_DEFAULT_DURATION,
  };
}
export function validate(p: Presentation): string[] {
  const errors: string[] = [];
  if (!p.title.trim()) errors.push("Judul presentasi wajib diisi.");
  if (!p.slides.length) errors.push("Tambahkan setidaknya satu slide.");
  if (p.slides.filter((s) => s.type === "kelompok").length > 1)
    errors.push("Maksimal satu slide pembagian kelompok.");
  errors.push(...quizOrderErrors(p.slides));
  p.slides.forEach((s, i) => {
    if (s.type === "kuis") {
      if (!s.quizQuestions?.length)
        errors.push("Kuis membutuhkan minimal satu pertanyaan.");
      if (!Number.isFinite(s.duration) || s.duration! < 10 || s.duration! > 120)
        errors.push("Durasi kuis harus antara 10–120 detik.");
      s.quizQuestions?.forEach((q, j) => {
        if (
          !q.title.trim() ||
          q.options.length < 2 ||
          q.options.length > 6 ||
          q.options.some((o) => !o.trim()) ||
          new Set(q.options.map(normalize)).size !== q.options.length ||
          q.correct.length === 0 ||
          q.correct.some((c) => !Number.isInteger(c) || c < 0 || c >= q.options.length)
        )
          errors.push(
            `Soal ${j + 1}: isi pertanyaan, 2–6 opsi berbeda, dan setidaknya satu kunci.`,
          );
      });
    }
    if (!s.title.trim()) errors.push(`Slide ${i + 1}: judul wajib diisi.`);
    if (
      ["pilihan", "polling"].includes(s.type) &&
      (s.options.length < 2 ||
        s.options.length > 6 ||
        s.options.some((o) => !o.trim()) ||
        new Set(s.options.map((o) => o.trim().toLowerCase())).size !==
          s.options.length)
    )
      errors.push(`Slide ${i + 1}: isi 2–6 opsi yang berbeda.`);
    if (
      s.type === "pilihan" &&
      (s.correct.length === 0 ||
        s.correct.some((c) => !Number.isInteger(c) || c < 0 || c >= s.options.length))
    )
      errors.push(`Slide ${i + 1}: pilih setidaknya satu kunci jawaban.`);
  });
  return errors;
}
export const normalize = (s: string) =>
  s.trim().replace(/\s+/g, " ").toLocaleLowerCase("id");
export const grouped = (s: Session, index = s.active) =>
  s.groups.length > 0 && index > s.division;
export const activity = (s: Session, id: string): Activity =>
  s.activities[id] ?? { status: "belum", visible: false, hiddenWords: [] };
export function publicResults(s: Session, slide: Slide) {
  if (!activity(s, slide.id).visible) return null;
  return aggregate(s, slide);
}
export function aggregate(s: Session, slide: Slide) {
  const rs = s.responses.filter((r) => r.slideId === slide.id);
  const words: Record<string, number> = {};
  rs.forEach((r) =>
    r.value.forEach((v) => {
      const n = normalize(v);
      if (!activity(s, slide.id).hiddenWords.includes(n))
        words[n] = (words[n] ?? 0) + 1;
    }),
  );
  return {
    total: rs.length,
    options: slide.options.map((label, i) => ({
      label,
      count: rs.filter((r) => r.value[0] === String(i)).length,
    })),
    words: Object.entries(words).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0]),
    ),
  };
}

export function quizOrderErrors(slides: Slide[]) {
  const quizzes = slides.filter((s) => s.type === "kuis");
  return quizzes.length > 1 ||
    (quizzes.length === 1 && slides.at(-1)?.type !== "kuis")
    ? ["Maksimal satu slide Kuis dan harus selalu terakhir."]
    : [];
}
export function insertSlide(slides: Slide[], slide: Slide) {
  if (slide.type === "kuis" && slides.some((s) => s.type === "kuis"))
    throw new Error("Maksimal satu slide Kuis.");
  const next = [...slides];
  const index =
    slide.type === "kuis" ? -1 : next.findIndex((s) => s.type === "kuis");
  next.splice(index < 0 ? next.length : index, 0, slide);
  return next;
}
