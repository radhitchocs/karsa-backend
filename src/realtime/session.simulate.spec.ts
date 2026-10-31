/**
 * AC16 — session.simulate / session.simulateQuiz integration tests
 *
 * Tests:
 *  - DEMO_MODE=true: session.simulate fills bot responses for current activity
 *  - DEMO_MODE=true: session.simulateQuiz fills mixed-outcome quiz answers for bots
 *  - DEMO_MODE=false: both commands return UNAUTHORIZED
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { io, Socket } from 'socket.io-client';
import supertest from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import type { CommandEnvelope } from '../contracts/commands';
import type { CommandAck } from '../contracts/acks';

function waitFor<T>(socket: Socket, event: string, timeoutMs = 5000): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`Timeout waiting for "${event}"`)), timeoutMs);
    socket.once(event, (data: T) => { clearTimeout(t); resolve(data); });
  });
}

function sleep(ms: number) { return new Promise<void>((r) => setTimeout(r, ms)); }

let app: INestApplication;
let prisma: PrismaService;
let serverUrl: string;
let request: ReturnType<typeof supertest>;
let presenterToken: string;

const PILIHAN_ID = 'sim-pilihan-1';
const KUIS_ID = 'sim-kuis-1';
const Q1_ID = 'sim-kuis-q1';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(0);

  const addr = app.getHttpServer().address() as { port: number };
  serverUrl = `http://127.0.0.1:${addr.port}`;
  request = supertest(app.getHttpServer());
  prisma = moduleRef.get(PrismaService);

  const suffix = Date.now();
  await request.post('/api/auth/register').send({ email: `simcmd-${suffix}@test.id`, password: 'pass123' });
  presenterToken = (
    await request.post('/api/auth/login').send({ email: `simcmd-${suffix}@test.id`, password: 'pass123' })
  ).body.accessToken;
}, 30_000);

afterAll(async () => { await app.close(); });

// ---------------------------------------------------------------------------
// DEMO_MODE=true
// ---------------------------------------------------------------------------
describe('DEMO_MODE=true — simulate commands work', () => {
  let sessionId: string;
  let sessionCode: string;
  let presSocket: Socket;

  beforeAll(async () => {
    process.env['DEMO_MODE'] = 'true';

    const pres = await request.post('/api/presentations').auth(presenterToken, { type: 'bearer' })
      .send({ title: 'SimCmd Test' });
    const presId: string = pres.body.id;

    await request.put(`/api/presentations/${presId}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send({
        slides: [
          { id: PILIHAN_ID, type: 'pilihan', title: 'Pilihan?', body: '', options: ['A', 'B'], correct: [0], explanation: '', image: '', groups: 3 },
          { id: KUIS_ID, type: 'kuis', title: 'Kuis', body: '', options: [], correct: [], explanation: '', image: '', groups: 3,
            duration: 30, quizQuestions: [{ id: Q1_ID, title: 'Q1', options: ['Benar', 'Salah'], correct: [0] }] },
        ],
      });

    const sess = await request.post(`/api/presentations/${presId}/sessions`)
      .auth(presenterToken, { type: 'bearer' });
    sessionId = sess.body.sessionId;
    sessionCode = sess.body.code;

    presSocket = io(serverUrl, { auth: { token: presenterToken, sessionId }, reconnection: false });
    await waitFor(presSocket, 'session.snapshot');

    // Start session → navigate to pilihan
    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `start-${Date.now()}`, sessionId,
      payload: { type: 'session.start' },
    } as CommandEnvelope);
  }, 30_000);

  afterAll(async () => {
    presSocket?.disconnect();
    delete process.env['DEMO_MODE'];
  });

  it('session.simulate creates bot responses for pilihan slide', async () => {
    // Open activity
    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `open-${Date.now()}`, sessionId,
      payload: { type: 'activity.open', slideId: PILIHAN_ID },
    } as CommandEnvelope);

    // Simulate
    const ack = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `sim-${Date.now()}`, sessionId,
      payload: { type: 'session.simulate' },
    } as CommandEnvelope) as CommandAck;

    expect(ack.ok).toBe(true);

    // Expect 6 responses (one per bot)
    const responses = await prisma.response.findMany({ where: { sessionId, slideId: PILIHAN_ID } });
    expect(responses.length).toBe(6);
  });

  it('session.simulateQuiz creates bot answers with mixed outcomes', async () => {
    // Close activity on pilihan slide before navigating (A6: cannot navigate while open)
    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `close-pil-${Date.now()}`, sessionId,
      payload: { type: 'activity.close', slideId: PILIHAN_ID },
    } as CommandEnvelope);

    // Navigate to kuis slide
    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `nav-kuis-${Date.now()}`, sessionId,
      payload: { type: 'slide.activate', slideIndex: 1 },
    } as CommandEnvelope);

    // Open first question
    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `open-q-${Date.now()}`, sessionId,
      payload: { type: 'quiz.openQuestion', questionId: Q1_ID },
    } as CommandEnvelope);

    // Simulate quiz
    const ack = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `simq-${Date.now()}`, sessionId,
      payload: { type: 'session.simulateQuiz' },
    } as CommandEnvelope) as CommandAck;

    expect(ack.ok).toBe(true);

    // Expect 6 answers (one per bot)
    const qs = await prisma.quizSession.findUnique({ where: { sessionId }, select: { id: true } });
    expect(qs).toBeTruthy();
    const run = await prisma.quizQuestionRun.findFirst({
      where: { quizSessionId: qs!.id, questionId: Q1_ID },
      select: { id: true },
    });
    expect(run).toBeTruthy();
    const answers = await prisma.quizAnswer.findMany({ where: { questionRunId: run!.id } });
    expect(answers.length).toBe(6);

    // Mixed outcomes: not all correct, not all wrong (cepat/lambat/salah cycle)
    const correctCount = answers.filter((a) => a.isCorrect).length;
    const wrongCount = answers.filter((a) => !a.isCorrect).length;
    expect(correctCount).toBeGreaterThan(0); // cepat + lambat correct
    expect(wrongCount).toBeGreaterThan(0);   // salah wrong
  });
});

// ---------------------------------------------------------------------------
// DEMO_MODE=false
// ---------------------------------------------------------------------------
describe('DEMO_MODE=false — simulate commands rejected', () => {
  let sessionId: string;
  let presSocket: Socket;

  beforeAll(async () => {
    delete process.env['DEMO_MODE'];

    const pres = await request.post('/api/presentations').auth(presenterToken, { type: 'bearer' })
      .send({ title: 'SimCmd No-Demo' });
    const presId: string = pres.body.id;

    await request.put(`/api/presentations/${presId}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send({
        slides: [
          { id: 'nd-pilihan', type: 'pilihan', title: 'Pilihan?', body: '', options: ['A', 'B'], correct: [0], explanation: '', image: '', groups: 3 },
        ],
      });

    const sess = await request.post(`/api/presentations/${presId}/sessions`)
      .auth(presenterToken, { type: 'bearer' });
    sessionId = sess.body.sessionId;

    presSocket = io(serverUrl, { auth: { token: presenterToken, sessionId }, reconnection: false });
    await waitFor(presSocket, 'session.snapshot');

    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `start-nd-${Date.now()}`, sessionId,
      payload: { type: 'session.start' },
    } as CommandEnvelope);
    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `open-nd-${Date.now()}`, sessionId,
      payload: { type: 'activity.open', slideId: 'nd-pilihan' },
    } as CommandEnvelope);
  }, 30_000);

  afterAll(() => { presSocket?.disconnect(); });

  it('session.simulate returns UNAUTHORIZED when DEMO_MODE=false', async () => {
    const ack = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `sim-nd-${Date.now()}`, sessionId,
      payload: { type: 'session.simulate' },
    } as CommandEnvelope) as CommandAck;
    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('UNAUTHORIZED');
  });

  it('session.simulateQuiz returns UNAUTHORIZED when DEMO_MODE=false', async () => {
    const ack = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `simq-nd-${Date.now()}`, sessionId,
      payload: { type: 'session.simulateQuiz' },
    } as CommandEnvelope) as CommandAck;
    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('UNAUTHORIZED');
  });
});
