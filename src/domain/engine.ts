import { Session, Response, PancingPick, uid, activity, grouped, normalize } from "./model";
import { QuizCommand, quizExecute, reconcileQuiz } from "./quiz";
export type Command =
  | QuizCommand
  | {
      type:
        | "start"
        | "end"
        | "open"
        | "close"
        | "reveal"
        | "resume"
        | "presenterDisconnect"
        | "presenterReconnect"
        | "simulate"
        | "toggleHideContent";
    }
  | { type: "navigate"; index: number }
  | { type: "assign"; count: number }
  | { type: "replace"; groupId: string }
  | { type: "connection"; participantId: string }
  | { type: "submit"; participantId: string; value: string[]; slideId: string }
  | { type: "moderate"; questionId: string; action: "visible" | "answered" }
  | { type: "hideWord"; word: string }
  | { type: "pick"; participantId: string };
export function fail(message: string): never {
  throw new Error(message);
}
export const shuffled = <T>(a: T[]) => {
  const result = [...a];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
export function execute(s: Session, c: Command, now = Date.now()) {
  reconcileQuiz(s, now);
  if (c.type.startsWith("quiz")) {
    quizExecute(s, c as QuizCommand, now);
    return;
  }
  const slide = s.slides[s.active];
  const a = activity(s, slide.id);
  s.activities[slide.id] = a;
  if (s.status === "selesai") fail("Sesi sudah berakhir.");
  if (c.type === "start") {
    if (s.status !== "lobi") fail("Sesi sudah dimulai.");
    s.status = "aktif";
    return;
  }
  if (c.type === "connection") {
    const p = s.participants.find((p) => p.id === c.participantId);
    if (!p) fail("Peserta tidak ditemukan.");
    p.online = !p.online;
    // A participant offline during assignment joins an existing group on reconnect.
    if (
      p.online &&
      s.groups.length &&
      !s.groups.some((g) => g.members.includes(p.id))
    ) {
      const min = Math.min(...s.groups.map((g) => g.members.length));
      shuffled(
        s.groups.filter((g) => g.members.length === min),
      )[0].members.push(p.id);
    }
    return;
  }
  if (c.type === "presenterDisconnect") {
    s.presenterOnline = false;
    s.paused = true;
    return;
  }
  if (c.type === "presenterReconnect") {
    s.presenterOnline = true;
    return;
  }
  if (c.type === "toggleHideContent") {
    s.hideContent = !s.hideContent;
    return;
  }
  if (c.type === "resume") {
    if (!s.presenterOnline) fail("Hubungkan presenter terlebih dahulu.");
    s.paused = false;
    return;
  }
  if (c.type === "end") {
    s.status = "selesai";
    Object.values(s.activities).forEach((x) => {
      if (x.status === "buka") x.status = "tutup";
    });
    return;
  }
  if (s.status !== "aktif") fail("Sesi belum dimulai.");
  if (s.paused || !s.presenterOnline)
    fail("Sesi dijeda. Tunggu presenter melanjutkan.");
  switch (c.type) {
    case "navigate": {
      if (s.quiz?.runs.some((r) => !r.closed))
        fail("Tunggu pertanyaan kuis ditutup sebelum berpindah.");
      if (
        !Number.isInteger(c.index) ||
        c.index < 0 ||
        c.index >= s.slides.length
      )
        fail("Slide tidak tersedia.");
      const division = s.slides.findIndex((x) => x.type === "kelompok");
      if (!s.groups.length && division >= 0 && c.index > division)
        fail("Bagikan kelompok sebelum melanjutkan.");
      if (a.status === "buka") fail("Tutup aktivitas sebelum berpindah slide.");
      s.active = c.index;
      break;
    }
    case "assign": {
      if (slide.type !== "kelompok") fail("Aktifkan slide Pembagian Kelompok.");
      if (s.groups.length) fail("Kelompok sudah dibagikan.");
      const ps = shuffled(s.participants.filter((p) => p.online || p.simulated === true));
      if (
        ps.length < 2 ||
        !Number.isInteger(c.count) ||
        c.count < 1 ||
        c.count > ps.length
      )
        fail(
          "Gunakan minimal 2 peserta dan jumlah kelompok 1 hingga jumlah peserta terhubung.",
        );
      s.groups = Array.from({ length: c.count }, (_, i) => ({
        id: uid(),
        number: i + 1,
        members: [],
        responder: "",
      }));
      ps.forEach((p, i) => s.groups[i % c.count].members.push(p.id));
      s.groups.forEach((g) => {
        const realMembers = g.members.filter(
          (id) => s.participants.some((p) => p.id === id && !p.simulated),
        );
        g.responder = shuffled(realMembers.length > 0 ? realMembers : g.members)[0];
      });
      s.division = s.active;
      break;
    }
    case "replace": {
      const g = s.groups.find((g) => g.id === c.groupId);
      if (!g) fail("Kelompok tidak ditemukan.");
      const candidates = g.members.filter(
        (id) =>
          id !== g.responder &&
          s.participants.some((p) => p.id === id && p.online),
      );
      if (!candidates.length)
        fail("Tidak ada anggota lain yang terhubung. Penjawab tetap.");
      g.responder = shuffled(candidates)[0];
      break;
    }
    case "open": {
      if (["materi", "kelompok", "kuis", "pancing"].includes(slide.type))
        fail("Slide ini tidak menerima respons.");
      if (s.groups.length && s.active < s.division)
        fail("Aktivitas individu hanya dapat ditinjau setelah pembagian.");
      a.status = "buka";
      a.visible = false;
      break;
    }
    case "close":
      a.status = "tutup";
      break;
    case "reveal":
      if (a.status !== "tutup")
        fail("Tutup respons sebelum menampilkan hasil.");
      a.visible = true;
      break;
    case "hideWord":
      if (a.hiddenWords.includes(c.word))
        a.hiddenWords = a.hiddenWords.filter((w) => w !== c.word);
      else a.hiddenWords.push(c.word);
      break;
    case "moderate": {
      const q = s.questions.find((q) => q.id === c.questionId);
      if (!q) fail("Pertanyaan tidak ditemukan.");
      q[c.action] = !q[c.action];
      // Only one question per Q&A slide can be shown at a time
      if (c.action === "visible" && q.visible)
        for (const o of s.questions)
          if (o.slideId === q.slideId && o.id !== q.id) o.visible = false;
      break;
    }
    case "submit": {
      if (c.slideId !== slide.id)
        fail("Slide telah berubah. Jawaban belum dikirim.");
      if (a.status !== "buka") fail("Respons belum dibuka atau sudah ditutup.");
      if (s.groups.length && s.active < s.division)
        fail("Aktivitas individu hanya untuk tinjauan.");
      const p = s.participants.find((p) => p.id === c.participantId);
      if (!p?.online && !p?.simulated)
        fail("Koneksi terputus. Hubungkan kembali untuk mengirim.");
      if (slide.type === "tanya") {
        const text = c.value[0]?.trim();
        if (!text || text.length > 300)
          fail("Pertanyaan harus berisi 1–300 karakter.");
        s.questions.push({
          id: uid(),
          slideId: slide.id,
          participantId: p.id,
          text,
          visible: false,
          answered: false,
        });
        break;
      }
      let ownerType: Response["ownerType"] = "individu",
        ownerId = p.id;
      if (grouped(s)) {
        const g = s.groups.find((g) => g.members.includes(p.id));
        if (!g || g.responder !== p.id)
          fail("Hanya penjawab kelompok yang dapat mengirim.");
        ownerType = "kelompok";
        ownerId = g.id;
      }
      let value = c.value;
      if (["pilihan", "polling"].includes(slide.type)) {
        if (
          value.length !== 1 ||
          !/^\d+$/.test(value[0]) ||
          Number(value[0]) >= slide.options.length
        )
          fail("Pilih satu opsi yang tersedia.");
      } else if (slide.type === "awan") {
        if (
          value.length < 1 ||
          value.length > 3 ||
          value.some((v) => !v.trim() || v.trim().length > 40)
        )
          fail("Isi 1–3 frasa, masing-masing maksimal 40 karakter.");
        value = [...new Set(value.map(normalize))];
      } else fail("Slide ini tidak menerima jawaban.");
      const old = s.responses.find(
        (r) =>
          r.slideId === slide.id &&
          r.ownerId === ownerId &&
          r.ownerType === ownerType,
      );
      const r = {
        id: old?.id ?? uid(),
        slideId: slide.id,
        ownerId,
        ownerType,
        submittedBy: p.id,
        value,
        updated: new Date().toISOString(),
      };
      if (old) Object.assign(old, r);
      else s.responses.push(r);
      break;
    }
    case "pick": {
      if (slide.type !== "pancing") fail("Aktifkan slide Pancing Peserta.");
      const p = s.participants.find((p) => p.id === c.participantId);
      if (!p) fail("Peserta tidak ditemukan.");
      const pick: PancingPick = {
        slideId: slide.id,
        participantId: p.id,
        participantName: p.name,
        timestamp: now,
      };
      if (!s.picks) s.picks = [];
      s.picks.push(pick);
      break;
    }
    case "simulate": {
      if (["materi", "kelompok", "kuis", "pancing"].includes(slide.type)) break;
      const ps =
        grouped(s) && slide.type !== "tanya"
          ? s.groups
              .map((g) => s.participants.find((p) => p.id === g.responder)!)
              .filter(Boolean)
          : s.participants;
      for (const p of ps.filter((p) => p.online || p.simulated === true)) {
        execute(s, {
          type: "submit",
          participantId: p.id,
          slideId: slide.id,
          value:
            slide.type === "tanya"
              ? ["Bagaimana kita menerapkan kolaborasi yang inklusif?"]
              : slide.type === "awan"
                ? ["Saling mendengar", "Aman", "Kolaborasi"]
                : [String(Math.floor(Math.random() * slide.options.length))],
        });
      }
      break;
    }
  }
}
