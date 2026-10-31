/**
 * C8 results — exact per-slide and quiz data.
 *
 * Creates a full session with pilihan / awan / tanya / kuis slides, runs the
 * complete flow (responses, Q&A question, quiz answer + timer), then asserts
 * exact values from GET /api/presentations/:id/results.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { io, Socket } from 'socket.io-client';
import supertest from 'supertest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/zod-exception.filter';
import type { CommandEnvelope, SessionCommandPayload } from '../contracts/commands';

vi.setConfig({ testTimeout: 60_000 });

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function waitFor<T>(socket: Socket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (data: T) => {
      clearTimeout(t);
      resolve(data);
    });
  });
}

function waitForMatching<T>(
  socket: Socket,
  event: string,
  match: (data: T) => boolean,
  timeoutMs = 15_000,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      socket.off(event, handler);
      reject(new Error(`Timeout waiting for matching "${event}"`));
    }, timeoutMs);
    function handler(data: T) {
      if (match(data)) {
        clearTimeout(t);
        socket.off(event, handler);
        resolve(data);
      }
    }
    socket.on(event, handler);
  });
}

async function cmd(
  socket: Socket,
  sessionId: string,
  payload: SessionCommandPayload,
): Promise<{ ok: boolean }> {
  const envelope: CommandEnvelope = {
    requestId: `req-${Date.now()}-${Math.random()}`,
    sessionId,
    payload,
  };
  return socket.timeout(8000).emitWithAck('command', envelope) as Promise<{ ok: boolean }>;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

let app: INestApplication;
let serverUrl: string;
let request: ReturnType<typeof supertest>;

let presenterToken: string;
let presentationId: string;
let sessionId: string;

const P1_NAME = 'Hasil-P1';
const P2_NAME = 'Hasil-P2';

const PILIHAN_ID = 'res-pilihan-1';
const AWAN_ID = 'res-awan-1';
const TANYA_ID = 'res-tanya-1';
const KUIS_ID = 'res-kuis-1';
const QUIZ_Q1_ID = 'res-qq-1';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(0);

  const addr = app.getHttpServer().address() as { port: number };
  serverUrl = `http://127.0.0.1:${addr.port}`;
  request = supertest(app.getHttpServer());

  // Presenter account
  const suffix = Date.now();
  await request
    .post('/api/auth/register')
    .send({ email: `res-${suffix}@test.id`, password: 'pass123' });
  const login = await request
    .post('/api/auth/login')
    .send({ email: `res-${suffix}@test.id`, password: 'pass123' });
  presenterToken = login.body.accessToken;

  // Presentation: pilihan, awan, tanya, kuis (last — required)
  const pres = await request
    .post('/api/presentations')
    .auth(presenterToken, { type: 'bearer' })
    .send({ title: 'Results Test' });
  presentationId = pres.body.id;

  await request
    .put(`/api/presentations/${presentationId}/slides`)
    .auth(presenterToken, { type: 'bearer' })
    .send({
      slides: [
        {
          id: PILIHAN_ID, type: 'pilihan', title: 'P Pilihan', body: '',
          options: ['A', 'B', 'C'], correct: [0], explanation: '', image: '', groups: 2,
        },
        {
          id: AWAN_ID, type: 'awan', title: 'P Awan', body: '',
          options: [], correct: [], explanation: '', image: '', groups: 2,
        },
        {
          id: TANYA_ID, type: 'tanya', title: 'P Tanya', body: '',
          options: [], correct: [], explanation: '', image: '', groups: 2,
        },
        {
          id: KUIS_ID, type: 'kuis', title: 'P Kuis', body: '',
          options: [], correct: [], explanation: '', image: '', groups: 2,
          duration: 10,
          quizQuestions: [{ id: QUIZ_Q1_ID, title: 'Q?', options: ['X', 'Y'], correct: [0] }],
        },
      ],
    });

  // Start session
  const sess = await request
    .post(`/api/presentations/${presentationId}/sessions`)
    .auth(presenterToken, { type: 'bearer' });
  sessionId = sess.body.sessionId;
  const code: string = sess.body.code;

  // Connect sockets
  const presSocket = io(serverUrl, { auth: { token: presenterToken, sessionId }, reconnection: false });
  await waitFor(presSocket, 'session.snapshot');

  const startAck = await cmd(presSocket, sessionId, { type: 'session.start' });
  expect(startAck.ok).toBe(true);

  // Two participants join
  const j1 = await request.post('/api/sessions/join').send({ code, name: P1_NAME });
  const j2 = await request.post('/api/sessions/join').send({ code, name: P2_NAME });

  const p1Socket = io(serverUrl, { auth: { token: j1.body.token }, reconnection: false });
  const p2Socket = io(serverUrl, { auth: { token: j2.body.token }, reconnection: false });
  await Promise.all([
    waitFor(p1Socket, 'session.snapshot'),
    waitFor(p2Socket, 'session.snapshot'),
  ]);

  // --- Pilihan (index 0, active after session.start) ---
  let ack = await cmd(presSocket, sessionId, { type: 'activity.open', slideId: PILIHAN_ID });
  expect(ack.ok, `activity.open→pilihan: ${JSON.stringify(ack)}`).toBe(true);
  ack = await cmd(p1Socket, sessionId, { type: 'response.submit', slideId: PILIHAN_ID, value: ['0'] });
  expect(ack.ok, `response.submit→pilihan P1: ${JSON.stringify(ack)}`).toBe(true);
  ack = await cmd(p2Socket, sessionId, { type: 'response.submit', slideId: PILIHAN_ID, value: ['1'] });
  expect(ack.ok, `response.submit→pilihan P2: ${JSON.stringify(ack)}`).toBe(true);
  await cmd(presSocket, sessionId, { type: 'activity.close', slideId: PILIHAN_ID });

  // --- Awan (index 1) ---
  ack = await cmd(presSocket, sessionId, { type: 'slide.activate', slideIndex: 1 });
  expect(ack.ok, `slide.activate→awan: ${JSON.stringify(ack)}`).toBe(true);
  ack = await cmd(presSocket, sessionId, { type: 'activity.open', slideId: AWAN_ID });
  expect(ack.ok, `activity.open→awan: ${JSON.stringify(ack)}`).toBe(true);
  ack = await cmd(p1Socket, sessionId, {
    type: 'response.submit', slideId: AWAN_ID, value: ['kata-satu', 'kata-dua'],
  });
  expect(ack.ok, `response.submit→awan: ${JSON.stringify(ack)}`).toBe(true);
  await cmd(presSocket, sessionId, { type: 'activity.close', slideId: AWAN_ID });

  // --- Tanya (index 2) ---
  ack = await cmd(presSocket, sessionId, { type: 'slide.activate', slideIndex: 2 });
  expect(ack.ok, `slide.activate→tanya: ${JSON.stringify(ack)}`).toBe(true);
  ack = await cmd(presSocket, sessionId, { type: 'activity.open', slideId: TANYA_ID });
  expect(ack.ok, `activity.open→tanya: ${JSON.stringify(ack)}`).toBe(true);
  ack = await cmd(p1Socket, sessionId, {
    type: 'question.submit', slideId: TANYA_ID, text: 'Pertanyaan Q&A?',
  });
  expect(ack.ok, `question.submit→tanya: ${JSON.stringify(ack)}`).toBe(true);
  await cmd(presSocket, sessionId, { type: 'activity.close', slideId: TANYA_ID });

  // --- Kuis (index 3) ---
  ack = await cmd(presSocket, sessionId, { type: 'slide.activate', slideIndex: 3 });
  expect(ack.ok, `slide.activate→kuis: ${JSON.stringify(ack)}`).toBe(true);

  // Set up listener BEFORE opening question so the event is never missed
  const closedSnapP = waitForMatching<{ pov: string; view: Record<string, unknown> }>(
    presSocket,
    'session.snapshot',
    (s) => {
      const q = (s.view as Record<string, unknown>)['quiz'] as Record<string, unknown> | null;
      const runs = q?.['runs'] as Array<Record<string, unknown>> | undefined;
      const last = runs?.at(-1);
      return last?.['closed'] === true;
    },
    30_000,
  );

  const openAck = await cmd(presSocket, sessionId, {
    type: 'quiz.openQuestion', questionId: QUIZ_Q1_ID,
  });
  expect(openAck.ok, `quiz.openQuestion: ${JSON.stringify(openAck)}`).toBe(true);

  const answerAck = await cmd(p1Socket, sessionId, {
    type: 'quiz.answerSubmit', questionRunId: QUIZ_Q1_ID, optionIndex: 0,
  });
  expect(answerAck.ok, `quiz.answerSubmit: ${JSON.stringify(answerAck)}`).toBe(true);

  // Wait for server-side auto-close broadcast (10s quiz duration)
  await closedSnapP;

  await cmd(presSocket, sessionId, { type: 'quiz.finish' });
  await cmd(presSocket, sessionId, { type: 'session.end' });

  presSocket.disconnect();
  p1Socket.disconnect();
  p2Socket.disconnect();
}, 90_000);

afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// Type helpers
// ---------------------------------------------------------------------------

type SlideResult = {
  id: string;
  type: string;
  responseCount: number;
  responses: Array<{ value: unknown; ownerLabel: string | null }>;
  questions: Array<{ text: string; visible: boolean; answered: boolean }>;
};

type SessionResultDto = {
  id: string;
  slides: SlideResult[];
  quizScores: Array<{
    ownerLabel: string | null;
    optionIndex: number;
    isCorrect: boolean;
    score: number;
  }>;
};

async function getResults(): Promise<SessionResultDto[]> {
  const res = await request
    .get(`/api/presentations/${presentationId}/results`)
    .auth(presenterToken, { type: 'bearer' })
    .expect(200);
  return res.body as SessionResultDto[];
}

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------

describe('C8 results — pilihan', () => {
  it('option 0 count=1 and option 1 count=1', async () => {
    const [session] = await getResults();
    const slide = session.slides.find((s) => s.id === PILIHAN_ID)!;
    expect(slide.responseCount).toBe(2);
    const counts = slide.responses.reduce<Record<number, number>>((acc, r) => {
      const idx = Number((r.value as string[])[0]);
      acc[idx] = (acc[idx] ?? 0) + 1;
      return acc;
    }, {});
    expect(counts[0]).toBe(1);
    expect(counts[1]).toBe(1);
  });
});

describe('C8 results — awan', () => {
  it('words contain kata-satu and kata-dua', async () => {
    const [session] = await getResults();
    const slide = session.slides.find((s) => s.id === AWAN_ID)!;
    const words = slide.responses.flatMap((r) => r.value as string[]);
    expect(words).toContain('kata-satu');
    expect(words).toContain('kata-dua');
  });
});

describe('C8 results — tanya', () => {
  it('question text matches submitted text', async () => {
    const [session] = await getResults();
    const slide = session.slides.find((s) => s.id === TANYA_ID)!;
    expect(slide.questions).toHaveLength(1);
    expect(slide.questions[0].text).toBe('Pertanyaan Q&A?');
  });
});

describe('C8 results — kuis', () => {
  it('Hasil-P1 has isCorrect=true and optionIndex=0', async () => {
    const [session] = await getResults();
    const p1Score = session.quizScores.find((s) => s.ownerLabel === P1_NAME)!;
    expect(p1Score).toBeDefined();
    expect(p1Score.isCorrect).toBe(true);
    expect(p1Score.optionIndex).toBe(0);
  });
});
