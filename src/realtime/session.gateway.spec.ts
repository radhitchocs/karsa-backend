/**
 * SessionGateway integration tests.
 *
 * Uses real socket.io-client connections against a live NestJS test server
 * (with real PostgreSQL DB). Covers every Phase 2 acceptance criterion:
 *
 *   AC01  invalid token rejected at handshake
 *   AC02  presenter command produces correct snapshot in every room
 *   AC03  participant/projector snapshots never contain hidden data
 *   AC04  duplicate requestId returns same ack without re-executing
 *   AC05  quiz question closes automatically at deadline (timer)
 *   AC06  presenter disconnect pauses after grace period; quiz answers still accepted
 *   AC07  reconnect (new socket) receives current snapshot
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { SessionCommandService } from './session-command.service';
import { SessionGateway } from './session.gateway';
vi.setConfig({ testTimeout: 15_000 }); // individual tests may override with 30_000
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { io, Socket } from 'socket.io-client';
import supertest from 'supertest';
import { AppModule } from '../app.module';
import { AllExceptionsFilter } from '../common/zod-exception.filter';

// Short grace period so disconnect tests finish quickly
process.env['PRESENTER_GRACE_MS'] = '300';

// ---------------------------------------------------------------------------
// Test helpers
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

/** Like waitFor but keeps consuming events until predicate returns true. */
function waitForMatching<T>(
  socket: Socket,
  event: string,
  match: (data: T) => boolean,
  timeoutMs = 5000,
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

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let app: INestApplication;
let serverUrl: string;
let request: ReturnType<typeof supertest>;

let presenterToken: string;
let sessionId: string;
let projectorToken: string;
let participantIds: string[] = [];
let participantTokens: string[] = [];

// Slides used across tests
const MATERI_SLIDE_ID = 'slide-materi-1';
const PILIHAN_SLIDE_ID = 'slide-pilihan-1';
const KUIS_SLIDE_ID = 'slide-kuis-1';
const QUIZ_Q1_ID = 'qz-q1';
const QUIZ_Q2_ID = 'qz-q2';

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useWebSocketAdapter(new IoAdapter(app));
  await app.listen(0); // random port

  const addr = app.getHttpServer().address() as { port: number };
  serverUrl = `http://127.0.0.1:${addr.port}`;
  request = supertest(app.getHttpServer());

  // Register + login presenter
  const suffix = Date.now();
  await request
    .post('/api/auth/register')
    .send({ email: `gw-${suffix}@test.id`, password: 'pass123' });
  const loginRes = await request
    .post('/api/auth/login')
    .send({ email: `gw-${suffix}@test.id`, password: 'pass123' });
  presenterToken = loginRes.body.accessToken;

  // Create presentation with materi + pilihan + kuis slides
  const presRes = await request
    .post('/api/presentations')
    .auth(presenterToken, { type: 'bearer' })
    .send({ title: 'GW Test Pres' });
  const presentationId: string = presRes.body.id;

  await request
    .put(`/api/presentations/${presentationId}/slides`)
    .auth(presenterToken, { type: 'bearer' })
    .send({
      slides: [
        {
          id: MATERI_SLIDE_ID,
          type: 'materi',
          title: 'Intro',
          body: '',
          options: [],
          correct: [],
          explanation: '',
          image: '',
          groups: 3,
        },
        {
          id: PILIHAN_SLIDE_ID,
          type: 'pilihan',
          title: 'Pilihan?',
          body: '',
          options: ['A', 'B', 'C'],
          correct: [1],
          explanation: 'B benar.',
          image: '',
          groups: 3,
        },
        {
          id: KUIS_SLIDE_ID,
          type: 'kuis',
          title: 'Kuis',
          body: '',
          options: [],
          correct: [],
          explanation: '',
          image: '',
          groups: 3,
          duration: 10, // minimum valid; AC05 uses vi.useFakeTimers() to avoid 10 s real wait
          quizQuestions: [
            { id: QUIZ_Q1_ID, title: 'Q1?', options: ['A', 'B'], correct: [0] },
            { id: QUIZ_Q2_ID, title: 'Q2?', options: ['X', 'Y'], correct: [1] },
          ],
        },
      ],
    });

  // Create session
  const sessRes = await request
    .post(`/api/presentations/${presentationId}/sessions`)
    .auth(presenterToken, { type: 'bearer' });
  sessionId = sessRes.body.sessionId;

  // Join 2 participants
  for (const name of ['Alya', 'Bima']) {
    const joinRes = await request
      .post('/api/sessions/join')
      .send({ code: sessRes.body.code, name });
    participantIds.push(joinRes.body.participantId);
    participantTokens.push(joinRes.body.token);
  }

  // Get projector token
  const projRes = await request
    .get(`/api/sessions/${sessionId}/projector-token`)
    .auth(presenterToken, { type: 'bearer' });
  projectorToken = projRes.body.token;
}, 30_000);

afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// AC01 — invalid token rejected at handshake
// ---------------------------------------------------------------------------
describe('AC01 — invalid token rejected at handshake', () => {
  it('garbage token causes disconnect with error', async () => {
    const badSocket = io(serverUrl, {
      auth: { token: 'not-a-valid-jwt', sessionId },
      reconnection: false,
    });
    const err = await waitFor<{ message: string }>(badSocket, 'error');
    expect(err.message).toMatch(/Token tidak valid|kadaluarsa/);
    badSocket.disconnect();
  });

  it('no token causes disconnect with error', async () => {
    const noToken = io(serverUrl, {
      auth: { sessionId },
      reconnection: false,
    });
    const err = await waitFor<{ message: string }>(noToken, 'error');
    expect(err.message).toContain('Token tidak ditemukan');
    noToken.disconnect();
  });
});

// ---------------------------------------------------------------------------
// AC02 — presenter command produces right snapshot in every room
// AC03 — participant/projector snapshots never contain hidden data
// ---------------------------------------------------------------------------
describe('AC02 + AC03 — command broadcast and privacy', () => {
  it('session.start reaches all rooms; participant view has no answer key', async () => {
    const presSocket = io(serverUrl, {
      auth: { token: presenterToken, sessionId },
      reconnection: false,
    });
    const partSocket = io(serverUrl, {
      auth: { token: participantTokens[0] },
      reconnection: false,
    });
    const projSocket = io(serverUrl, {
      auth: { projectorToken, sessionId },
      reconnection: false,
    });

    // Wait for initial snapshots on all three
    await Promise.all([
      waitFor(presSocket, 'session.snapshot'),
      waitFor(partSocket, 'session.snapshot'),
      waitFor(projSocket, 'session.snapshot'),
    ]);

    // Set up predicate-based listeners BEFORE sending session.start.
    // Extra snapshots may arrive from participant socket connection broadcasts (A1),
    // so we wait for the one where status === 'aktif'.
    const presSnapP = waitForMatching<{ pov: string; view: Record<string, unknown> }>(
      presSocket, 'session.snapshot', (s) => (s.view['status'] as string) === 'aktif',
    );
    const partSnapP = waitForMatching<{ pov: string; view: Record<string, unknown> }>(
      partSocket, 'session.snapshot', (s) => (s.view['status'] as string) === 'aktif',
    );
    const projSnapP = waitForMatching<{ pov: string; view: Record<string, unknown> }>(
      projSocket, 'session.snapshot', (s) => ((s as Record<string, unknown>)['view'] as Record<string, unknown>)['status'] === 'aktif',
    );

    const ack = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `req-start-${Date.now()}`,
      sessionId,
      payload: { type: 'session.start' },
    } as import('../contracts/commands').CommandEnvelope);

    expect(ack.ok).toBe(true);
    expect(ack.entityVersion).toBeGreaterThan(0);

    const [presSnap, partSnap, projSnap] = await Promise.all([presSnapP, partSnapP, projSnapP]);

    // Presenter view has full data
    expect(presSnap.view['status']).toBe('aktif');
    expect((presSnap.view['slides'] as unknown[]).length).toBeGreaterThan(0);

    // Participant view has no `correct` key on pilihan slide before reveal
    expect(partSnap.view['status']).toBe('aktif');
    // (slide is materi so no correct key at all)

    // Projector view has no `participants` field and no `responses` field
    const projView = projSnap as unknown as { view: Record<string, unknown> };
    expect(projView.view['participants']).toBeUndefined();
    expect(projView.view['responses']).toBeUndefined();

    presSocket.disconnect();
    partSocket.disconnect();
    projSocket.disconnect();
  });

  it('pilihan slide: after navigate+open, participant never sees correct key; projector never sees explanation', async () => {
    const presSocket = io(serverUrl, {
      auth: { token: presenterToken, sessionId },
      reconnection: false,
    });
    await waitFor(presSocket, 'session.snapshot');

    // Navigate to pilihan slide (index 1)
    const nav = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `req-nav-${Date.now()}`,
      sessionId,
      payload: { type: 'slide.activate', slideIndex: 1 },
    } as import('../contracts/commands').CommandEnvelope);
    expect(nav.ok).toBe(true);

    // Open activity
    const openAck = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `req-open-${Date.now()}`,
      sessionId,
      payload: { type: 'activity.open', slideId: PILIHAN_SLIDE_ID },
    } as import('../contracts/commands').CommandEnvelope);
    expect(openAck.ok).toBe(true);

    // Connect participant and get their snapshot
    const partSocket = io(serverUrl, {
      auth: { token: participantTokens[0] },
      reconnection: false,
    });
    const partSnap = await waitFor<{ pov: string; view: Record<string, unknown> }>(
      partSocket,
      'session.snapshot',
    );
    const activeSlide = partSnap.view['activeSlide'] as Record<string, unknown>;
    expect(activeSlide['correct']).toBeUndefined(); // no key before reveal
    expect(activeSlide['explanation']).toBe(''); // stripped

    // Connect projector and get snapshot
    const projSocket = io(serverUrl, {
      auth: { projectorToken, sessionId },
      reconnection: false,
    });
    const projSnap = await waitFor<{ pov: string; view: Record<string, unknown> }>(
      projSocket,
      'session.snapshot',
    );
    const projSlide = (projSnap.view as Record<string, unknown>)['activeSlide'] as Record<string, unknown>;
    expect(projSlide['explanation']).toBeUndefined(); // always stripped on projector
    expect(projSlide['correct']).toBeUndefined(); // not revealed yet

    // Close activity before disconnect so subsequent tests can navigate (A6)
    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `req-close-${Date.now()}`,
      sessionId,
      payload: { type: 'activity.close', slideId: PILIHAN_SLIDE_ID },
    } as import('../contracts/commands').CommandEnvelope);

    presSocket.disconnect();
    partSocket.disconnect();
    projSocket.disconnect();
  });
});

// ---------------------------------------------------------------------------
// AC04 — duplicate requestId returns same ack without re-executing
// ---------------------------------------------------------------------------
describe('AC04 — idempotency', () => {
  it('same requestId returns identical ack without double-applying', async () => {
    const presSocket = io(serverUrl, {
      auth: { token: presenterToken, sessionId },
      reconnection: false,
    });
    await waitFor(presSocket, 'session.snapshot');

    const envelope = {
      requestId: `req-idem-${Date.now()}`,
      sessionId,
      payload: { type: 'slide.activate', slideIndex: 0 },
    } as import('../contracts/commands').CommandEnvelope;

    const ack1 = await presSocket.timeout(5000).emitWithAck('command', envelope);
    const ack2 = await presSocket.timeout(5000).emitWithAck('command', envelope);

    expect(ack1.ok).toBe(true);
    expect(ack2.ok).toBe(true);
    // Same entityVersion (no second increment)
    expect(ack1.entityVersion).toBe(ack2.entityVersion);
    expect(ack1.requestId).toBe(ack2.requestId);

    presSocket.disconnect();
  });
});

// ---------------------------------------------------------------------------
// AC05 — quiz question closes automatically at deadline
// ---------------------------------------------------------------------------
describe('AC05 — quiz auto-close timer', () => {
  it('question with 10s duration closes by itself; participant snapshot shows closed=true', async () => {
    const presSocket = io(serverUrl, {
      auth: { token: presenterToken, sessionId },
      reconnection: false,
    });
    const partSocket = io(serverUrl, {
      auth: { token: participantTokens[0] },
      reconnection: false,
    });

    try {
      await Promise.all([
        waitFor(presSocket, 'session.snapshot'),
        waitFor(partSocket, 'session.snapshot'),
      ]);

      // Navigate to kuis slide (index 2) — with real timers
      await presSocket.timeout(5000).emitWithAck('command', {
        requestId: `req-nav-kuis-${Date.now()}`,
        sessionId,
        payload: { type: 'slide.activate', slideIndex: 2 },
      } as import('../contracts/commands').CommandEnvelope);

      // Enable fake timers right before openQuestion so the server schedules a fake setTimeout
      vi.useFakeTimers();

      // Set up closed-state listener (predicate: closed===true)
      const closedSnapP = waitForMatching<{ pov: string; view: Record<string, unknown> }>(
        partSocket,
        'session.snapshot',
        (s) => {
          const q = s.view['quiz'] as Record<string, unknown> | null;
          const aq = q?.['activeQuestion'] as Record<string, unknown> | null;
          return aq?.['closed'] === true;
        },
        15_000,
      );

      // Open Q1 — server schedules fake timer (delay = 10 s from fake now)
      const startAck = await presSocket.timeout(5000).emitWithAck('command', {
        requestId: `req-quiz-start-${Date.now()}`,
        sessionId,
        payload: { type: 'quiz.openQuestion', questionId: QUIZ_Q1_ID },
      } as import('../contracts/commands').CommandEnvelope);
      expect(startAck.ok).toBe(true);

      // Advance fake time past the 10s deadline to fire the quiz timer
      await vi.advanceTimersByTimeAsync(11_000);

      // Await the closed snapshot (broadcast triggered by timer)
      const closedSnap = await closedSnapP;

      const quiz = closedSnap.view['quiz'] as Record<string, unknown> | null;
      const aq = quiz?.['activeQuestion'] as Record<string, unknown> | null;
      expect(aq?.['closed']).toBe(true);
    } finally {
      vi.useRealTimers();
      presSocket.disconnect();
      partSocket.disconnect();
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// AC06 — presenter disconnect pauses after grace; quiz answers still accepted
// ---------------------------------------------------------------------------
describe('AC06 — presenter disconnect grace period', () => {
  it('session pauses after grace period; participant can still submit quiz answer', async () => {
    // 1. Reconnect presenter and navigate to kuis slide, ensure quiz is on Q2
    //    (Q1 was closed in AC05 test above — open Q2 for this test)
    const presSocket = io(serverUrl, {
      auth: { token: presenterToken, sessionId },
      reconnection: false,
    });
    const partSocket = io(serverUrl, {
      auth: { token: participantTokens[0] },
      reconnection: false,
    });

    await Promise.all([
      waitFor(presSocket, 'session.snapshot'),
      waitFor(partSocket, 'session.snapshot'),
    ]);

    // Make sure we're on kuis slide
    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `req-nav-kuis2-${Date.now()}`,
      sessionId,
      payload: { type: 'slide.activate', slideIndex: 2 },
    } as import('../contracts/commands').CommandEnvelope);

    // Open Q2 (Q1 already closed from AC05)
    const openQ2Ack = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `req-open-q2-${Date.now()}`,
      sessionId,
      payload: { type: 'quiz.openQuestion', questionId: QUIZ_Q2_ID },
    } as import('../contracts/commands').CommandEnvelope);
    expect(openQ2Ack.ok).toBe(true);

    // 2. Disconnect presenter — grace timer starts (300ms in tests)
    presSocket.disconnect();

    // 3. Wait for grace to expire and paused=true broadcast
    const pausedSnap = await waitFor<{ pov: string; view: Record<string, unknown> }>(
      partSocket,
      'session.snapshot',
      1500,
    );
    expect(pausedSnap.view['paused']).toBe(true);

    // 4. Participant submits quiz answer — still accepted despite paused
    //    (quizSubmit bypasses the paused check in domain engine per CH19)
    const answerAck = await partSocket.timeout(5000).emitWithAck('command', {
      requestId: `req-answer-q2-${Date.now()}`,
      sessionId,
      payload: {
        type: 'quiz.answerSubmit',
        questionRunId: QUIZ_Q2_ID,
        optionIndex: 1,
      },
    } as import('../contracts/commands').CommandEnvelope);
    expect(answerAck.ok).toBe(true);

    partSocket.disconnect();
  });
});

// ---------------------------------------------------------------------------
// AC07 — reconnect returns current snapshot
// ---------------------------------------------------------------------------
describe('AC07 — reconnect snapshot', () => {
  it('new socket connection immediately receives current session state', async () => {
    const socket1 = io(serverUrl, {
      auth: { token: participantTokens[1] },
      reconnection: false,
    });
    const snap1 = await waitFor<{ pov: string; view: Record<string, unknown> }>(
      socket1,
      'session.snapshot',
    );
    socket1.disconnect();
    await sleep(100);

    // Re-connect — should get same/updated snapshot
    const socket2 = io(serverUrl, {
      auth: { token: participantTokens[1] },
      reconnection: false,
    });
    const snap2 = await waitFor<{ pov: string; view: Record<string, unknown> }>(
      socket2,
      'session.snapshot',
    );

    // Both snapshots are for the same session
    expect(snap1.view['sessionId']).toBe(sessionId);
    expect(snap2.view['sessionId']).toBe(sessionId);
    expect(snap2.pov).toBe('participant');
    socket2.disconnect();
  });
});

// ---------------------------------------------------------------------------
// AC08 — participant socket: every presenter-only command type rejected
// ---------------------------------------------------------------------------
describe('AC08 — participant: all non-participant command types rejected (allowlist)', () => {
  it('every command type in contracts except response.submit / question.submit / quiz.answerSubmit returns UNAUTHORIZED; entity version unchanged', async () => {
    const partSocket = io(serverUrl, {
      auth: { token: participantTokens[0] },
      reconnection: false,
    });
    await waitFor(partSocket, 'session.snapshot');

    // Record session version before the test
    const stateBefore = await request.get(`/api/sessions/${sessionId}/state`).auth(presenterToken, { type: 'bearer' });
    const versionBefore: number = stateBefore.body.sessionVersion;

    // All command types defined in contracts/commands.ts that are NOT in the participant allowlist.
    // This list is exhaustive — update it whenever contracts/commands.ts adds a new type.
    const rejectedPayloads = [
      { type: 'session.start' },
      { type: 'slide.activate', slideIndex: 0 },
      { type: 'activity.open', slideId: PILIHAN_SLIDE_ID },
      { type: 'activity.close', slideId: PILIHAN_SLIDE_ID },
      { type: 'activity.reopen', slideId: PILIHAN_SLIDE_ID },
      { type: 'activity.hideWord', slideId: PILIHAN_SLIDE_ID, word: 'test' },
      { type: 'results.reveal', slideId: PILIHAN_SLIDE_ID },
      { type: 'groups.assign', groupCount: 2 },
      { type: 'group.replaceResponder', groupId: 'fake-group-id' },
      { type: 'question.moderate', questionId: 'fake-q-id', visible: true },
      { type: 'quiz.openQuestion', questionId: QUIZ_Q1_ID },
      { type: 'quiz.finish' },
      { type: 'quiz.revealLeaderboard' },
      { type: 'session.resume' },
      { type: 'session.end' },
    ] as import('../contracts/commands').SessionCommandPayload[];

    for (const payload of rejectedPayloads) {
      const ack = await partSocket.timeout(5000).emitWithAck('command', {
        requestId: `ac08-${payload.type}-${Date.now()}`,
        sessionId,
        payload,
      } as import('../contracts/commands').CommandEnvelope);
      expect(ack.ok, `expected ok:false for ${payload.type}`).toBe(false);
      expect(ack.code, `expected UNAUTHORIZED for ${payload.type}`).toBe('UNAUTHORIZED');
    }

    // Session version must not have changed — no state mutation from any rejected command
    const stateAfter = await request.get(`/api/sessions/${sessionId}/state`).auth(presenterToken, { type: 'bearer' });
    expect(stateAfter.body.sessionVersion, 'session version unchanged after all rejections').toBe(versionBefore);

    partSocket.disconnect();
  });
});

// ---------------------------------------------------------------------------
// AC09 — projector socket: any command rejected
// ---------------------------------------------------------------------------
describe('AC09 — projector: any command rejected', () => {
  it('projector socket sending a command returns UNAUTHORIZED', async () => {
    const projSocket = io(serverUrl, {
      auth: { projectorToken, sessionId },
      reconnection: false,
    });
    await waitFor(projSocket, 'session.snapshot');

    const ack = await projSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac09-${Date.now()}`,
      sessionId,
      payload: { type: 'slide.activate', slideIndex: 0 },
    } as import('../contracts/commands').CommandEnvelope);

    expect(ack.ok).toBe(false);
    expect(ack.code).toBe('UNAUTHORIZED');
    projSocket.disconnect();
  });
});

// ---------------------------------------------------------------------------
// AC10 + AC11 — cross-session rejection; token identity controls session
// ---------------------------------------------------------------------------
describe('AC10 + AC11 — cross-session rejection and token identity', () => {
  let sessionBId: string;

  beforeAll(async () => {
    // Presenter B: different account, different session
    const suffix = `pB-${Date.now()}`;
    await request
      .post('/api/auth/register')
      .send({ email: `${suffix}@test.id`, password: 'pass123' });
    const loginB = await request
      .post('/api/auth/login')
      .send({ email: `${suffix}@test.id`, password: 'pass123' });
    const tokenB = loginB.body.accessToken as string;

    const presB = await request
      .post('/api/presentations')
      .auth(tokenB, { type: 'bearer' })
      .send({ title: 'PresB-CrossSession' });
    await request
      .put(`/api/presentations/${presB.body.id}/slides`)
      .auth(tokenB, { type: 'bearer' })
      .send({
        slides: [{ id: 'sb-slide', type: 'materi', title: 'M', body: '', options: [], correct: [], explanation: '', image: '', groups: 3 }],
      });
    const sessB = await request
      .post(`/api/presentations/${presB.body.id}/sessions`)
      .auth(tokenB, { type: 'bearer' });
    sessionBId = sessB.body.sessionId;
  }, 30_000);

  it('presenterA token + sessionB id → handshake error (Akses ditolak)', async () => {
    const badSocket = io(serverUrl, {
      auth: { token: presenterToken, sessionId: sessionBId },
      reconnection: false,
    });
    const err = await waitFor<{ message: string }>(badSocket, 'error', 4000);
    expect(err.message).toMatch(/Akses ditolak/);
    badSocket.disconnect();
  });

  it('participant token carries sessionId; handshake sessionId is ignored', async () => {
    // Supply a different sessionId in the handshake auth — server must use the one from the JWT
    const socket = io(serverUrl, {
      auth: { token: participantTokens[0], sessionId: sessionBId },
      reconnection: false,
    });
    const snap = await waitFor<{ view: { sessionId: string } }>(socket, 'session.snapshot', 4000);
    // Must receive snapshot for their actual session (from token), not session B
    expect(snap.view.sessionId).toBe(sessionId);
    socket.disconnect();
  });
});

// ---------------------------------------------------------------------------
// AC12 — group responder enforcement
// ---------------------------------------------------------------------------
describe('AC12 — group responder enforcement', () => {
  const GRP_KELOMPOK_ID = 'ac12-kelompok';
  const GRP_PILIHAN_ID  = 'ac12-pilihan';
  let grpSessionId: string;
  let grpCode: string;
  let grpPartIds: string[] = [];
  let grpPartTokens: string[] = [];

  beforeAll(async () => {
    const pr = await request
      .post('/api/presentations')
      .auth(presenterToken, { type: 'bearer' })
      .send({ title: 'GroupEnforcement' });

    await request
      .put(`/api/presentations/${pr.body.id}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send({
        slides: [
          { id: GRP_KELOMPOK_ID, type: 'kelompok', title: 'Kelompok', body: '', options: [], correct: [], explanation: '', image: '', groups: 2 },
          { id: GRP_PILIHAN_ID,  type: 'pilihan',  title: 'Pilihan?', body: '', options: ['X', 'Y'], correct: [0], explanation: 'X benar', image: '', groups: 2 },
        ],
      });

    const sessR = await request
      .post(`/api/presentations/${pr.body.id}/sessions`)
      .auth(presenterToken, { type: 'bearer' });
    grpSessionId = sessR.body.sessionId;
    grpCode = sessR.body.code;

    grpPartIds = [];
    grpPartTokens = [];
    for (const name of ['Eka', 'Farah']) {
      const j = await request.post('/api/sessions/join').send({ code: grpCode, name });
      grpPartIds.push(j.body.participantId);
      grpPartTokens.push(j.body.token);
    }
  }, 30_000);

  it('non-responder → INVALID_STATE; responder → ok', async () => {
    const presSocket = io(serverUrl, { auth: { token: presenterToken, sessionId: grpSessionId }, reconnection: false });
    await waitFor(presSocket, 'session.snapshot');

    const partSockets = grpPartTokens.map((token) =>
      io(serverUrl, { auth: { token }, reconnection: false }),
    );
    await Promise.all(partSockets.map((s) => waitFor(s, 'session.snapshot')));

    // start → navigate to kelompok → assign 1 group
    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac12-start-${Date.now()}`, sessionId: grpSessionId,
      payload: { type: 'session.start' },
    } as import('../contracts/commands').CommandEnvelope);
    await sleep(200);

    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac12-nav0-${Date.now()}`, sessionId: grpSessionId,
      payload: { type: 'slide.activate', slideIndex: 0 },
    } as import('../contracts/commands').CommandEnvelope);
    await sleep(200);

    // Capture assign snapshot to read responder assignment
    const assignSnapP = waitFor<{ view: Record<string, unknown> }>(presSocket, 'session.snapshot');
    const assignAck = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac12-assign-${Date.now()}`, sessionId: grpSessionId,
      payload: { type: 'groups.assign', groupCount: 1 },
    } as import('../contracts/commands').CommandEnvelope);
    expect(assignAck.ok).toBe(true);
    const assignSnap = await assignSnapP;

    const grps = (assignSnap.view as Record<string, unknown>)['groups'] as Array<{
      members: string[];
      responder: string;
    }>;
    const responderId = grps[0].responder;
    const memberId = grps[0].members.find((id) => id !== responderId)!;
    const responderIdx = grpPartIds.indexOf(responderId);
    const memberIdx = grpPartIds.indexOf(memberId);

    // Navigate to pilihan (index 1) and open activity
    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac12-nav1-${Date.now()}`, sessionId: grpSessionId,
      payload: { type: 'slide.activate', slideIndex: 1 },
    } as import('../contracts/commands').CommandEnvelope);
    await sleep(200);

    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac12-open-${Date.now()}`, sessionId: grpSessionId,
      payload: { type: 'activity.open', slideId: GRP_PILIHAN_ID },
    } as import('../contracts/commands').CommandEnvelope);
    await sleep(200);

    // Non-responder (group member who is not the assigned responder) → rejected
    const memberAck = await partSockets[memberIdx].timeout(5000).emitWithAck('command', {
      requestId: `ac12-member-${Date.now()}`, sessionId: grpSessionId,
      payload: { type: 'response.submit', slideId: GRP_PILIHAN_ID, value: ['0'] },
    } as import('../contracts/commands').CommandEnvelope);
    expect(memberAck.ok).toBe(false);
    expect(memberAck.code).toBe('INVALID_STATE'); // "Hanya penjawab kelompok yang dapat mengirim."

    // Responder → accepted
    const responderAck = await partSockets[responderIdx].timeout(5000).emitWithAck('command', {
      requestId: `ac12-responder-${Date.now()}`, sessionId: grpSessionId,
      payload: { type: 'response.submit', slideId: GRP_PILIHAN_ID, value: ['0'] },
    } as import('../contracts/commands').CommandEnvelope);
    expect(responderAck.ok).toBe(true);

    partSockets.forEach((s) => s.disconnect());
    presSocket.disconnect();
  });
});

// ---------------------------------------------------------------------------
// AC13 — privacy walk: pilihan ganda open → close → reveal
//         Also verifies: actorId comes from token, not payload
// ---------------------------------------------------------------------------
describe('AC13 — privacy walk: pilihan open → close → reveal; actorId from token', () => {
  const PIL_SLIDE_ID = 'ac13-pilihan';
  let pilSessionId: string;
  let pilPartIds: string[] = [];
  let pilPartTokens: string[] = [];
  let pilProjToken: string;

  beforeAll(async () => {
    const pr = await request
      .post('/api/presentations')
      .auth(presenterToken, { type: 'bearer' })
      .send({ title: 'PilahanPrivacy' });

    await request
      .put(`/api/presentations/${pr.body.id}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send({
        slides: [
          {
            id: PIL_SLIDE_ID,
            type: 'pilihan',
            title: 'Pilihan test?',
            body: '',
            options: ['A', 'B', 'C'],
            correct: [1],
            explanation: 'Jawaban benar adalah B.',
            image: '',
            groups: 3,
          },
        ],
      });

    const sess = await request
      .post(`/api/presentations/${pr.body.id}/sessions`)
      .auth(presenterToken, { type: 'bearer' });
    pilSessionId = sess.body.sessionId;

    pilPartIds = [];
    pilPartTokens = [];
    for (const name of ['Pil-A', 'Pil-B']) {
      const j = await request.post('/api/sessions/join').send({ code: sess.body.code, name });
      pilPartIds.push(j.body.participantId);
      pilPartTokens.push(j.body.token);
    }

    const projRes = await request
      .get(`/api/sessions/${pilSessionId}/projector-token`)
      .auth(presenterToken, { type: 'bearer' });
    pilProjToken = projRes.body.token;
  }, 30_000);

  it('open: no correct/explanation; submit: A has myResponse, B does not; close: still no reveal; reveal: correct+explanation visible; projector never sees explanation', async () => {
    const presSocket = io(serverUrl, { auth: { token: presenterToken, sessionId: pilSessionId }, reconnection: false });
    const partA     = io(serverUrl, { auth: { token: pilPartTokens[0] }, reconnection: false });
    const partB     = io(serverUrl, { auth: { token: pilPartTokens[1] }, reconnection: false });
    const projSocket = io(serverUrl, { auth: { projectorToken: pilProjToken, sessionId: pilSessionId }, reconnection: false });

    await Promise.all([
      waitFor(presSocket, 'session.snapshot'),
      waitFor(partA, 'session.snapshot'),
      waitFor(partB, 'session.snapshot'),
      waitFor(projSocket, 'session.snapshot'),
    ]);

    // Start session (pilihan is at index 0)
    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac13-start-${Date.now()}`, sessionId: pilSessionId,
      payload: { type: 'session.start' },
    } as import('../contracts/commands').CommandEnvelope);
    await sleep(200);

    // ─── OPEN ────────────────────────────────────────────────────────────────
    const partAOpenP = waitFor<{ view: Record<string, unknown> }>(partA, 'session.snapshot');
    const partBOpenP = waitFor<{ view: Record<string, unknown> }>(partB, 'session.snapshot');
    const projOpenP  = waitFor<{ view: Record<string, unknown> }>(projSocket, 'session.snapshot');

    const openAck = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac13-open-${Date.now()}`, sessionId: pilSessionId,
      payload: { type: 'activity.open', slideId: PIL_SLIDE_ID },
    } as import('../contracts/commands').CommandEnvelope);
    expect(openAck.ok).toBe(true);

    const [partAOpenSnap, projOpenSnap] = await Promise.all([partAOpenP, projOpenP]);
    await partBOpenP; // drain B's open snapshot (not needed for assertions)

    // Participant: no correct key (absent), explanation is '' (stripped to empty)
    const slideOpen = (partAOpenSnap.view as any).activeSlide as Record<string, unknown>;
    expect(slideOpen['correct'], 'participant open: correct absent').toBeUndefined();
    expect(slideOpen['explanation'], 'participant open: explanation empty').toBe('');

    // Projector: no correct key (absent), explanation key is completely absent (not '' but undefined)
    const projSlideOpen = (projOpenSnap.view as any).activeSlide as Record<string, unknown>;
    expect(projSlideOpen['correct'], 'projector open: correct absent').toBeUndefined();
    expect(projSlideOpen['explanation'], 'projector: explanation key absent').toBeUndefined();

    // ─── SUBMIT (actorId from token) ──────────────────────────────────────────
    const partAAfterSubmitP = waitFor<{ view: Record<string, unknown> }>(partA, 'session.snapshot');
    const partBAfterSubmitP = waitFor<{ view: Record<string, unknown> }>(partB, 'session.snapshot');

    const submitAck = await partA.timeout(5000).emitWithAck('command', {
      requestId: `ac13-submit-${Date.now()}`, sessionId: pilSessionId,
      payload: { type: 'response.submit', slideId: PIL_SLIDE_ID, value: ['0'] },
    } as import('../contracts/commands').CommandEnvelope);
    expect(submitAck.ok).toBe(true);

    const [partAAfterSubmit, partBAfterSubmit] = await Promise.all([partAAfterSubmitP, partBAfterSubmitP]);

    // actorId comes from token: A's response is recorded for A, B has no response
    expect((partAAfterSubmit.view as any).myResponse, 'A myResponse set after submit').not.toBeNull();
    expect((partBAfterSubmit.view as any).myResponse, 'B myResponse null — identity from token prevents spoofing').toBeNull();

    // Even after submit, no correct key or explanation revealed (activity still open)
    const slideAfterSubmit = (partAAfterSubmit.view as any).activeSlide as Record<string, unknown>;
    expect(slideAfterSubmit['correct'], 'participant: correct still absent after submit').toBeUndefined();
    expect(slideAfterSubmit['explanation'], 'participant: explanation still empty after submit').toBe('');

    // ─── CLOSE ────────────────────────────────────────────────────────────────
    const partACloseP = waitFor<{ view: Record<string, unknown> }>(partA, 'session.snapshot');
    const projCloseP  = waitFor<{ view: Record<string, unknown> }>(projSocket, 'session.snapshot');
    const partBCloseP = waitFor<{ view: Record<string, unknown> }>(partB, 'session.snapshot');

    const closeAck = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac13-close-${Date.now()}`, sessionId: pilSessionId,
      payload: { type: 'activity.close', slideId: PIL_SLIDE_ID },
    } as import('../contracts/commands').CommandEnvelope);
    expect(closeAck.ok).toBe(true);

    const [partACloseSnap, projCloseSnap] = await Promise.all([partACloseP, projCloseP]);
    await partBCloseP;

    // Close: still no correct or explanation — only changes after reveal
    const slideClose = (partACloseSnap.view as any).activeSlide as Record<string, unknown>;
    expect(slideClose['correct'], 'participant close: correct still absent').toBeUndefined();
    expect(slideClose['explanation'], 'participant close: explanation still empty').toBe('');

    const projSlideClose = (projCloseSnap.view as any).activeSlide as Record<string, unknown>;
    expect(projSlideClose['correct'], 'projector close: correct still absent').toBeUndefined();
    expect(projSlideClose['explanation'], 'projector close: explanation still absent').toBeUndefined();

    // B10: hideContent defaults ON; toggle OFF so participant sees correct key after reveal
    const partAToggleP = waitFor<{ view: Record<string, unknown> }>(partA, 'session.snapshot');
    const projToggleP  = waitFor<{ view: Record<string, unknown> }>(projSocket, 'session.snapshot');
    const toggleAck13 = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac13-toggle-${Date.now()}`, sessionId: pilSessionId,
      payload: { type: 'session.toggleHideContent' },
    } as import('../contracts/commands').CommandEnvelope);
    expect(toggleAck13.ok).toBe(true);
    await Promise.all([partAToggleP, projToggleP]); // drain toggle snapshots

    // ─── REVEAL ───────────────────────────────────────────────────────────────
    const partARevealP = waitFor<{ view: Record<string, unknown> }>(partA, 'session.snapshot');
    const projRevealP  = waitFor<{ view: Record<string, unknown> }>(projSocket, 'session.snapshot');

    const revealAck = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac13-reveal-${Date.now()}`, sessionId: pilSessionId,
      payload: { type: 'results.reveal', slideId: PIL_SLIDE_ID },
    } as import('../contracts/commands').CommandEnvelope);
    expect(revealAck.ok).toBe(true);

    const [partARevealSnap, projRevealSnap] = await Promise.all([partARevealP, projRevealP]);

    // Participant: now sees correct key (1 = option B) AND explanation
    const slideReveal = (partARevealSnap.view as any).activeSlide as Record<string, unknown>;
    expect(slideReveal['correct'], 'participant reveal: correct key visible').toEqual([1]);
    expect(slideReveal['explanation'], 'participant reveal: explanation visible').toBe('Jawaban benar adalah B.');

    // Projector: sees correct key (1) but explanation is ALWAYS absent
    const projSlideReveal = (projRevealSnap.view as any).activeSlide as Record<string, unknown>;
    expect(projSlideReveal['correct'], 'projector reveal: correct key visible').toEqual([1]);
    expect(projSlideReveal['explanation'], 'projector: explanation permanently absent').toBeUndefined();

    presSocket.disconnect();
    partA.disconnect();
    partB.disconnect();
    projSocket.disconnect();
  });
});

// ---------------------------------------------------------------------------
// AC14 — privacy walk: kuis open → close → finish → reveal
// ---------------------------------------------------------------------------
describe('AC14 — privacy walk: kuis open → close → finish → reveal', () => {
  const KUIS_PW_SLIDE_ID = 'ac14-kuis';
  const KUIS_PW_Q1_ID   = 'ac14-q1';
  let kuisSessionId: string;
  let kuisPartToken: string;
  let kuisProjToken: string;
  let kuisPart2Token: string; // second online participant — prevents B9 early-close (doesn't answer)

  beforeAll(async () => {
    const kr = await request
      .post('/api/presentations')
      .auth(presenterToken, { type: 'bearer' })
      .send({ title: 'KuisPrivacy' });

    await request
      .put(`/api/presentations/${kr.body.id}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send({
        slides: [
          {
            id: KUIS_PW_SLIDE_ID,
            type: 'kuis',
            title: 'Kuis PW',
            body: '',
            options: [],
            correct: [],
            explanation: '',
            image: '',
            groups: 3,
            duration: 10, // minimum valid; test uses vi.useFakeTimers() to avoid 10 s wait
            quizQuestions: [
              { id: KUIS_PW_Q1_ID, title: 'Q1?', options: ['Benar', 'Salah'], correct: [0] },
            ],
          },
        ],
      });

    const sessK = await request
      .post(`/api/presentations/${kr.body.id}/sessions`)
      .auth(presenterToken, { type: 'bearer' });
    kuisSessionId = sessK.body.sessionId;

    const j = await request.post('/api/sessions/join').send({ code: sessK.body.code, name: 'Peserta-Kuis' });
    kuisPartToken = j.body.token;
    // B9: second participant — connects to be online but never answers, preventing early-close
    const j2 = await request.post('/api/sessions/join').send({ code: sessK.body.code, name: 'Peserta-Kuis-2' });
    kuisPart2Token = j2.body.token;

    const proj = await request
      .get(`/api/sessions/${kuisSessionId}/projector-token`)
      .auth(presenterToken, { type: 'bearer' });
    kuisProjToken = proj.body.token;
  }, 30_000);

  it('correctOption null while open; visible after auto-close; leaderboard null before reveal; non-null after reveal', async () => {
    const presSocket = io(serverUrl, { auth: { token: presenterToken, sessionId: kuisSessionId }, reconnection: false });
    const partSocket = io(serverUrl, { auth: { token: kuisPartToken }, reconnection: false });
    const projSocket = io(serverUrl, { auth: { projectorToken: kuisProjToken, sessionId: kuisSessionId }, reconnection: false });
    // B9: second participant stays connected but never answers — prevents early-close
    const part2Socket = io(serverUrl, { auth: { token: kuisPart2Token }, reconnection: false });

    try {
    await Promise.all([
      waitFor(presSocket, 'session.snapshot'),
      waitFor(partSocket, 'session.snapshot'),
      waitFor(projSocket, 'session.snapshot'),
      waitFor(part2Socket, 'session.snapshot'),
    ]);

    // Start session (kuis slide is at index 0) — with real timers
    const partStartP = waitFor<{ view: Record<string, unknown> }>(partSocket, 'session.snapshot');
    await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac14-start-${Date.now()}`, sessionId: kuisSessionId,
      payload: { type: 'session.start' },
    } as import('../contracts/commands').CommandEnvelope);
    await partStartP; // drain session.start broadcast before enabling fake timers

    // Enable fake timers now — sockets are established, server will schedule a fake setTimeout
    vi.useFakeTimers();

    // ─── QUIZ.START → assert OPEN state ───────────────────────────────────────
    // Use waitForMatching (not waitFor) to skip any buffered pre-quiz snapshots
    // (handleConnection broadcasts an extra snapshot when participant joins)
    const hasActiveQuestion = (s: { view: Record<string, unknown> }) => {
      const q = s.view['quiz'] as Record<string, unknown> | null;
      return q?.['activeQuestion'] != null;
    };
    const partOpenP = waitForMatching<{ view: Record<string, unknown> }>(partSocket, 'session.snapshot', hasActiveQuestion, 15_000);
    const projOpenP = waitForMatching<{ view: Record<string, unknown> }>(projSocket, 'session.snapshot', hasActiveQuestion, 15_000);

    // Set up closed-state listeners BEFORE opening question (predicate: closed===true)
    const partClosedP = waitForMatching<{ view: Record<string, unknown> }>(
      partSocket, 'session.snapshot',
      (s) => {
        const q = s.view['quiz'] as Record<string, unknown> | null;
        const aq = q?.['activeQuestion'] as Record<string, unknown> | null;
        return aq?.['closed'] === true;
      },
      15_000,
    );
    const projClosedP = waitForMatching<{ view: Record<string, unknown> }>(
      projSocket, 'session.snapshot',
      (s) => {
        const q = s.view['quiz'] as Record<string, unknown> | null;
        const aq = q?.['activeQuestion'] as Record<string, unknown> | null;
        return aq?.['closed'] === true;
      },
      15_000,
    );

    const qStartAck = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac14-qstart-${Date.now()}`, sessionId: kuisSessionId,
      payload: { type: 'quiz.openQuestion', questionId: KUIS_PW_Q1_ID },
    } as import('../contracts/commands').CommandEnvelope);
    expect(qStartAck.ok).toBe(true);

    const [partOpenSnap, projOpenSnap] = await Promise.all([partOpenP, projOpenP]);

    // Open: correctOption null for both participant and projector
    const pqOpen = (partOpenSnap.view as any).quiz as { activeQuestion: { correctOption: unknown; myAnswer: unknown } };
    expect(pqOpen.activeQuestion.correctOption, 'participant open: correctOption null').toBeNull();
    expect(pqOpen.activeQuestion.myAnswer, 'participant open: myAnswer null before submit').toBeNull();

    const projqOpen = (projOpenSnap.view as any).quiz as { activeQuestion: { correctOption: unknown } };
    expect(projqOpen.activeQuestion.correctOption, 'projector open: correctOption null').toBeNull();

    // ─── PARTICIPANT SUBMITS (correct answer, option 0) ────────────────────────
    const partAfterSubmitP = waitFor<{ view: Record<string, unknown> }>(partSocket, 'session.snapshot');

    const submitAck = await partSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac14-submit-${Date.now()}`, sessionId: kuisSessionId,
      payload: { type: 'quiz.answerSubmit', questionRunId: KUIS_PW_Q1_ID, optionIndex: 0 },
    } as import('../contracts/commands').CommandEnvelope);
    expect(submitAck.ok).toBe(true);

    const partAfterSubmit = await partAfterSubmitP;

    // Still open: correctOption null, myAnswer.correct null (revealed only on question close)
    const pqSubmit = (partAfterSubmit.view as any).quiz as {
      activeQuestion: { correctOption: unknown; myAnswer: { correct: unknown } | null };
    };
    expect(pqSubmit.activeQuestion.correctOption, 'participant: correctOption still null after submit (still open)').toBeNull();
    expect(pqSubmit.activeQuestion.myAnswer?.correct, 'participant: myAnswer.correct null while question open').toBeNull();

    // B10: hideContent defaults ON; toggle OFF so correctOption/myAnswer.correct visible after close
    // partClosedP uses waitForMatching — toggle snapshot (closed=false) skipped automatically
    const toggleAck14 = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac14-toggle-${Date.now()}`, sessionId: kuisSessionId,
      payload: { type: 'session.toggleHideContent' },
    } as import('../contracts/commands').CommandEnvelope);
    expect(toggleAck14.ok).toBe(true);

    // ─── AUTO-CLOSE (fake timer, 10 s deadline) → advance fake time ───────────
    await vi.advanceTimersByTimeAsync(11_000);

    const [partClosedSnap, projClosedSnap] = await Promise.all([partClosedP, projClosedP]);

    // Closed: correctOption now visible (correct answer is index 0)
    const pqClosed = (partClosedSnap.view as any).quiz as {
      activeQuestion: { correctOption: number | null; closed: boolean; myAnswer: { correct: boolean | null } | null };
    };
    expect(pqClosed.activeQuestion.closed, 'participant: question closed').toBe(true);
    expect(pqClosed.activeQuestion.correctOption, 'participant: correctOption visible after close').toEqual([0]);
    expect(pqClosed.activeQuestion.myAnswer?.correct, 'participant: myAnswer.correct visible after close').toBe(true);

    const projqClosed = (projClosedSnap.view as any).quiz as {
      activeQuestion: { correctOption: number | null; closed: boolean };
    };
    expect(projqClosed.activeQuestion.closed, 'projector: question closed').toBe(true);
    expect(projqClosed.activeQuestion.correctOption, 'projector: correctOption visible after close').toEqual([0]);

    // ─── QUIZ.FINISH ───────────────────────────────────────────────────────────
    const partFinishP = waitFor<{ view: Record<string, unknown> }>(partSocket, 'session.snapshot');

    const finishAck = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac14-finish-${Date.now()}`, sessionId: kuisSessionId,
      payload: { type: 'quiz.finish' },
    } as import('../contracts/commands').CommandEnvelope);
    expect(finishAck.ok).toBe(true);

    const partFinishSnap = await partFinishP;
    const pqFinish = (partFinishSnap.view as any).quiz as { finished: boolean; revealed: boolean };
    expect(pqFinish.finished, 'quiz finished after quiz.finish').toBe(true);
    expect(pqFinish.revealed, 'quiz not yet revealed').toBe(false);
    expect(partFinishSnap.view['leaderboard'], 'leaderboard null before reveal').toBeNull();

    // ─── QUIZ.REVEALLEADERBOARD ────────────────────────────────────────────────
    const partRevealP = waitFor<{ view: Record<string, unknown> }>(partSocket, 'session.snapshot');
    const projRevealP = waitFor<{ view: Record<string, unknown> }>(projSocket, 'session.snapshot');

    const revealAck = await presSocket.timeout(5000).emitWithAck('command', {
      requestId: `ac14-reveal-${Date.now()}`, sessionId: kuisSessionId,
      payload: { type: 'quiz.revealLeaderboard' },
    } as import('../contracts/commands').CommandEnvelope);
    expect(revealAck.ok).toBe(true);

    const [partRevealSnap, projRevealSnap] = await Promise.all([partRevealP, projRevealP]);

    const partLeaderboard = partRevealSnap.view['leaderboard'] as { entries: unknown[] } | null;
    expect(partLeaderboard, 'participant: leaderboard non-null after reveal').not.toBeNull();
    expect(partLeaderboard!.entries.length, 'participant: leaderboard has entries').toBeGreaterThanOrEqual(1);

    const projLeaderboard = projRevealSnap.view['leaderboard'] as { entries: unknown[] } | null;
    expect(projLeaderboard, 'projector: leaderboard non-null after reveal').not.toBeNull();
    expect(projLeaderboard!.entries.length, 'projector: leaderboard has entries').toBeGreaterThanOrEqual(1);

    } finally {
      vi.useRealTimers();
      presSocket.disconnect();
      partSocket.disconnect();
      projSocket.disconnect();
      part2Socket.disconnect();
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// AC15 — quiz timer recovery after service restart
// ---------------------------------------------------------------------------
describe('AC15 — quiz timer recovery: question closes after simulated restart', () => {
  const REC_KUIS_ID = 'ac15-kuis';
  const REC_Q1_ID   = 'ac15-q1';
  let recSessionId: string;
  let recPartToken: string;

  beforeAll(async () => {
    const kr = await request
      .post('/api/presentations')
      .auth(presenterToken, { type: 'bearer' })
      .send({ title: 'RecoveryTest' });

    await request
      .put(`/api/presentations/${kr.body.id}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send({
        slides: [
          {
            id: REC_KUIS_ID,
            type: 'kuis',
            title: 'Kuis Recovery',
            body: '',
            options: [],
            correct: [],
            explanation: '',
            image: '',
            groups: 3,
            duration: 10, // minimum valid; test uses vi.useFakeTimers() to avoid 10 s wait
            quizQuestions: [{ id: REC_Q1_ID, title: 'Recover?', options: ['A', 'B'], correct: [0] }],
          },
        ],
      });

    const sessK = await request
      .post(`/api/presentations/${kr.body.id}/sessions`)
      .auth(presenterToken, { type: 'bearer' });
    recSessionId = sessK.body.sessionId;

    const j = await request.post('/api/sessions/join').send({ code: sessK.body.code, name: 'RecPart' });
    recPartToken = j.body.token;
  }, 30_000);

  it('question closes at original deadlineAt after in-memory timers are cleared and recovered', async () => {
    const presSocket = io(serverUrl, { auth: { token: presenterToken, sessionId: recSessionId }, reconnection: false });
    const partSocket = io(serverUrl, { auth: { token: recPartToken }, reconnection: false });

    try {
      await Promise.all([
        waitFor(presSocket, 'session.snapshot'),
        waitFor(partSocket, 'session.snapshot'),
      ]);

      // Start session with real timers, drain the broadcast
      const partStartP = waitFor<{ view: Record<string, unknown> }>(partSocket, 'session.snapshot');
      await presSocket.timeout(5000).emitWithAck('command', {
        requestId: `rec-start-${Date.now()}`, sessionId: recSessionId,
        payload: { type: 'session.start' },
      } as import('../contracts/commands').CommandEnvelope);
      await partStartP;

      // Enable fake timers now — server will schedule fake setTimeout for quiz timer
      vi.useFakeTimers();

      const partOpenP = waitFor<{ view: Record<string, unknown> }>(partSocket, 'session.snapshot');
      const qStartAck = await presSocket.timeout(5000).emitWithAck('command', {
        requestId: `rec-qstart-${Date.now()}`, sessionId: recSessionId,
        payload: { type: 'quiz.openQuestion', questionId: REC_Q1_ID },
      } as import('../contracts/commands').CommandEnvelope);
      expect(qStartAck.ok).toBe(true);
      await partOpenP; // drain open snapshot

      // Advance 300 ms of fake time (simulate the in-window restart point)
      await vi.advanceTimersByTimeAsync(300);

      const commandService = app.get(SessionCommandService);
      const gateway        = app.get(SessionGateway);
      commandService.clearQuizTimers(recSessionId); // in-memory timer gone

      // Set up listener BEFORE recovery (closed=true predicate)
      const partClosedP = waitForMatching<{ view: Record<string, unknown> }>(
        partSocket, 'session.snapshot',
        (s) => {
          const q = s.view['quiz'] as Record<string, unknown> | null;
          const aq = q?.['activeQuestion'] as Record<string, unknown> | null;
          return aq?.['closed'] === true;
        },
        15_000,
      );

      await commandService.recoverQuizTimers(
        gateway.server,
        (sid) => (gateway as unknown as { presenterSockets: Map<string, string> }).presenterSockets.has(sid),
      );

      // B10: hideContent defaults ON; toggle OFF so correctOption visible after close
      // partClosedP uses waitForMatching — toggle snapshot skipped automatically
      const toggleAck15 = await presSocket.timeout(5000).emitWithAck('command', {
        requestId: `rec-toggle-${Date.now()}`, sessionId: recSessionId,
        payload: { type: 'session.toggleHideContent' },
      } as import('../contracts/commands').CommandEnvelope);
      expect(toggleAck15.ok).toBe(true);

      // Advance fake time past the original deadline (10 s from t=0; currently at t=300ms, need ~9.7 s more)
      await vi.advanceTimersByTimeAsync(10_000);

      // The recovered timer fired; await the closed broadcast
      const partClosedSnap = await partClosedP;
      const pqClosed = (partClosedSnap.view as any).quiz as {
        activeQuestion: { closed: boolean; correctOption: number | null };
      };
      expect(pqClosed.activeQuestion.closed, 'question closed by recovered timer').toBe(true);
      expect(pqClosed.activeQuestion.correctOption, 'correctOption visible after close').toEqual([0]);
    } finally {
      vi.useRealTimers();
      presSocket.disconnect();
      partSocket.disconnect();
    }
  }, 30_000);
});

// ---------------------------------------------------------------------------
// AC16 — recoverQuizTimers: null deadlineAt guard
// ---------------------------------------------------------------------------
// The Prisma schema marks deadlineAt as DateTime? (nullable). If a row somehow
// has a NULL deadlineAt, recoverQuizTimers must skip it instead of calling
// .getTime() on null (which would throw TypeError in JS or fail TS strict).
//
// Bug: before the fix, `run.deadlineAt.getTime()` was called unconditionally,
// causing a TypeError crash when any open QuizQuestionRun had deadlineAt=NULL.
// Fix: `if (!run.deadlineAt) continue;` guards the .getTime() call.
//
// This test injects a mock Prisma client that returns one null-deadlineAt row
// and asserts that recoverQuizTimers completes without throwing.
describe('AC16 — recoverQuizTimers skips run with null deadlineAt', () => {
  it('does not throw when an open run has deadlineAt=null', async () => {
    const commandService = app.get(SessionCommandService);

    // Monkey-patch prisma.quizQuestionRun.findMany to return one null row
    const prisma = (commandService as unknown as { prisma: { quizQuestionRun: { findMany: (...a: unknown[]) => unknown } } }).prisma;
    const original = prisma.quizQuestionRun.findMany.bind(prisma.quizQuestionRun);
    prisma.quizQuestionRun.findMany = async () => [
      { questionId: 'ghost-q', deadlineAt: null, quizSession: { sessionId: 'ghost-session' } },
    ];

    const gateway = app.get(SessionGateway);
    await expect(
      commandService.recoverQuizTimers(
        gateway.server,
        () => false,
      ),
    ).resolves.not.toThrow();

    // Restore
    prisma.quizQuestionRun.findMany = original;
  });
});

// ---------------------------------------------------------------------------
// AC15 — projector token expires on session end (D20)
// ---------------------------------------------------------------------------
describe('AC15 — projector token rejected after session ends (D20)', () => {
  let endedSessionId: string;
  let endedProjToken: string;
  let endedPresToken: string;

  beforeAll(async () => {
    // Create isolated presenter + session for this suite
    const suffix = `ac15-${Date.now()}`;
    await request
      .post('/api/auth/register')
      .send({ email: `${suffix}@test.id`, password: 'pass123' });
    const loginRes = await request
      .post('/api/auth/login')
      .send({ email: `${suffix}@test.id`, password: 'pass123' });
    endedPresToken = loginRes.body.accessToken;

    const presRes = await request
      .post('/api/presentations')
      .auth(endedPresToken, { type: 'bearer' })
      .send({ title: 'AC15 Pres' });
    const presId: string = presRes.body.id;

    await request
      .put(`/api/presentations/${presId}/slides`)
      .auth(endedPresToken, { type: 'bearer' })
      .send({
        slides: [{
          id: 'ac15-slide', type: 'materi', title: 'T', body: '',
          options: [], correct: [], explanation: '', image: '', groups: 2,
        }],
      });

    const sessRes = await request
      .post(`/api/presentations/${presId}/sessions`)
      .auth(endedPresToken, { type: 'bearer' });
    endedSessionId = sessRes.body.sessionId;

    // Fetch projector token before ending
    const projRes = await request
      .get(`/api/sessions/${endedSessionId}/projector-token`)
      .auth(endedPresToken, { type: 'bearer' });
    endedProjToken = projRes.body.token;

    // Start then end the session via socket
    const presSocket = io(serverUrl, {
      auth: { token: endedPresToken, sessionId: endedSessionId },
      transports: ['websocket'],
    });
    // Wait for handleConnection to finish (snapshot sent) before sending commands.
    // Waiting only for 'connect' races with the async handleConnection which sets
    // socketMeta — commands sent before socketMeta is set are rejected as UNAUTHORIZED.
    await waitFor(presSocket, 'session.snapshot');
    await new Promise<void>((resolve) => {
      presSocket.emit(
        'command',
        { requestId: 'ac15-start', sessionId: endedSessionId, payload: { type: 'session.start' } },
        () => resolve(),
      );
    });
    await new Promise<void>((resolve) => {
      presSocket.emit(
        'command',
        { requestId: 'ac15-end', sessionId: endedSessionId, payload: { type: 'session.end' } },
        () => resolve(),
      );
    });
    presSocket.disconnect();
  }, 20_000);

  it('REST GET /state with projector token → 403 after session ends', async () => {
    const res = await request
      .get(`/api/sessions/${endedSessionId}/state?projectorToken=${endedProjToken}`);
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/berakhir/i);
  });

  it('socket handshake with projector token → disconnect with error after session ends', async () => {
    const socket = io(serverUrl, {
      auth: { projectorToken: endedProjToken, sessionId: endedSessionId },
      transports: ['websocket'],
    });
    const err = await new Promise<{ message: string }>((resolve) => {
      socket.on('error', (e: { message: string }) => resolve(e));
      socket.on('disconnect', () => resolve({ message: 'disconnected' }));
    });
    socket.disconnect();
    expect(err.message).toMatch(/berakhir/i);
  });
});

// ---------------------------------------------------------------------------
// AC16 — two concurrent sessions do not interfere with each other
// ---------------------------------------------------------------------------
describe('AC16 — two concurrent sessions are fully isolated', () => {
  it('commands in session A do not affect snapshots in session B', async () => {
    const suffix = `ac16-${Date.now()}`;

    // Create two presenters and their sessions
    const sessions: Array<{ presToken: string; sessionId: string; code: string; projToken: string }> = [];
    for (const label of ['A', 'B']) {
      await request
        .post('/api/auth/register')
        .send({ email: `${suffix}-${label}@test.id`, password: 'pass123' });
      const loginRes = await request
        .post('/api/auth/login')
        .send({ email: `${suffix}-${label}@test.id`, password: 'pass123' });
      const presToken = loginRes.body.accessToken as string;

      const presRes = await request
        .post('/api/presentations')
        .auth(presToken, { type: 'bearer' })
        .send({ title: `AC16 Pres ${label}` });
      const presId: string = presRes.body.id;

      await request
        .put(`/api/presentations/${presId}/slides`)
        .auth(presToken, { type: 'bearer' })
        .send({
          slides: [{
            id: `ac16-slide-${label}`, type: 'polling', title: `Slide ${label}`, body: '',
            options: ['Ya', 'Tidak'], correct: [], explanation: '', image: '', groups: 2,
          }],
        });

      const sessRes = await request
        .post(`/api/presentations/${presId}/sessions`)
        .auth(presToken, { type: 'bearer' });
      const sessionId: string = sessRes.body.sessionId;
      const code: string = sessRes.body.code;

      const projRes = await request
        .get(`/api/sessions/${sessionId}/projector-token`)
        .auth(presToken, { type: 'bearer' });

      sessions.push({ presToken, sessionId, code, projToken: projRes.body.token });
    }

    // Connect both presenters and wait for handleConnection to complete
    const sockets = sessions.map((s) =>
      io(serverUrl, {
        auth: { token: s.presToken, sessionId: s.sessionId },
        transports: ['websocket'],
      }),
    );
    await Promise.all(sockets.map((s) => waitFor(s, 'session.snapshot')));

    // Collect snapshots on projector B before starting session A
    const projB = io(serverUrl, {
      auth: { projectorToken: sessions[1].projToken, sessionId: sessions[1].sessionId },
      transports: ['websocket'],
    });
    // Drain the initial snapshot sent by handleConnection before starting count.
    // handleConnection always pushes one snapshot on connect; we must not count it.
    await waitFor(projB, 'session.snapshot', 5000);

    const snapsBefore: unknown[] = [];
    projB.on('session.snapshot', (snap: unknown) => snapsBefore.push(snap));

    // Start session A — projector B must NOT receive a snapshot from session A
    await new Promise<void>((resolve) => {
      sockets[0].emit(
        'command',
        { requestId: 'ac16-startA', sessionId: sessions[0].sessionId, payload: { type: 'session.start' } },
        () => resolve(),
      );
    });

    await sleep(300); // give any spurious broadcasts time to arrive

    // Projector B should have received 0 snapshots (session A started, not B)
    expect(snapsBefore.length).toBe(0);

    // Set up listener BEFORE starting session B to avoid the race where the
    // broadcast arrives before waitFor registers its once-listener
    const snapAfterP = waitFor<{ pov: string }>(projB, 'session.snapshot', 5000);

    // Start session B — projector B should now receive a snapshot
    await new Promise<void>((resolve) => {
      sockets[1].emit(
        'command',
        { requestId: 'ac16-startB', sessionId: sessions[1].sessionId, payload: { type: 'session.start' } },
        () => resolve(),
      );
    });

    const snapAfter = await snapAfterP;
    expect(snapAfter.pov).toBe('projector');

    // REST state for session A still shows lobby/active — not infected by B's start
    const stateA = await request
      .get(`/api/sessions/${sessions[0].sessionId}/state?projectorToken=${sessions[0].projToken}`);
    expect(stateA.status).toBe(200);
    // Session A was started, so it should be active (not lobi)
    expect((stateA.body as { status: string }).status).not.toBe('lobi');

    sockets.forEach((s) => s.disconnect());
    projB.disconnect();
  }, 30_000);
});

// ---------------------------------------------------------------------------
// AC17 — command sent immediately on 'connect' (before first snapshot) must
//         not return UNAUTHORIZED.  Verifies the per-socket handshake promise
//         added to SessionGateway that serialises handleConnection vs
//         handleCommand.
// ---------------------------------------------------------------------------
describe('AC17 — command sent immediately on connect returns valid ack (not UNAUTHORIZED)', () => {
  it('command emitted inside on-connect handler succeeds', async () => {
    const s = io(serverUrl, {
      auth: { token: presenterToken, sessionId },
      reconnection: false,
      transports: ['websocket'],
    });

    const ack = await new Promise<import('../contracts/acks').CommandAck>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout waiting for ack')), 10_000);
      s.on('connect', () => {
        // Fire command immediately — handleConnection may not have finished yet
        s.emit(
          'command',
          {
            requestId: `ac17-${Date.now()}`,
            sessionId,
            payload: { type: 'slide.activate', slideIndex: 0 },
          } as import('../contracts/commands').CommandEnvelope,
          (a: import('../contracts/acks').CommandAck) => {
            clearTimeout(timer);
            resolve(a);
          },
        );
      });
    });

    s.disconnect();

    // Must NOT be UNAUTHORIZED — the handshake promise serialised handleConnection
    // before handleCommand ran, so socketMeta was already set.
    // (The session may be ENDED by this point, so ack.ok=false is expected for
    // business-logic reasons, but the code must not be UNAUTHORIZED.)
    expect(ack.code, 'command must not be UNAUTHORIZED').not.toBe('UNAUTHORIZED');
  });
});

// ---------------------------------------------------------------------------
// A5 — quiz duration validation: moved to session start (CH36, option b)
// putSlides allows drafts with any duration; createSession enforces 10–120 s
// ---------------------------------------------------------------------------
describe('A5 — quiz duration validation: draft allowed in putSlides; enforced at session start', () => {
  let a5PresentationId: string;

  const kuisSlide = (duration: number) => ({
    slides: [{
      id: 'a5-kuis-slide',
      type: 'kuis',
      title: 'Kuis Durasi',
      body: '',
      options: [],
      correct: [],
      explanation: '',
      image: '',
      groups: 3,
      duration,
      quizQuestions: [{ id: 'a5-q1', title: 'Q?', options: ['A', 'B'], correct: [0] }],
    }],
  });

  beforeAll(async () => {
    const pr = await request
      .post('/api/presentations')
      .auth(presenterToken, { type: 'bearer' })
      .send({ title: 'A5 Duration Test' });
    a5PresentationId = pr.body.id;
  }, 10_000);

  it('duration: 130 → 200 OK (draft allowed; validated at session start)', async () => {
    const res = await request
      .put(`/api/presentations/${a5PresentationId}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send(kuisSlide(130));
    expect(res.status).toBe(200);
  });

  it('duration: 9 → 200 OK (draft allowed; validated at session start)', async () => {
    const res = await request
      .put(`/api/presentations/${a5PresentationId}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send(kuisSlide(9));
    expect(res.status).toBe(200);
  });

  it('createSession with duration: 130 → 422 Unprocessable Entity', async () => {
    // Save invalid draft first
    await request
      .put(`/api/presentations/${a5PresentationId}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send(kuisSlide(130));
    const res = await request
      .post(`/api/presentations/${a5PresentationId}/sessions`)
      .auth(presenterToken, { type: 'bearer' });
    expect(res.status).toBe(422);
    expect(res.body.message).toMatch(/10.*120|10–120/);
  });

  it('duration: 120 → 200 OK', async () => {
    const res = await request
      .put(`/api/presentations/${a5PresentationId}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send(kuisSlide(120));
    expect(res.status).toBe(200);
  });

  it('duration: 10 → 200 OK', async () => {
    const res = await request
      .put(`/api/presentations/${a5PresentationId}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send(kuisSlide(10));
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// C6 — expectedVersion optimistic locking on PUT /api/presentations/:id/slides
// ---------------------------------------------------------------------------
describe('C6 — expectedVersion conflict handling', () => {
  let conflictPresId: string;
  let currentVersion: number;

  beforeAll(async () => {
    const pr = await request
      .post('/api/presentations')
      .auth(presenterToken, { type: 'bearer' })
      .send({ title: 'Conflict Test' });
    conflictPresId = pr.body.id;
    currentVersion = pr.body.version ?? 1;
  }, 10_000);

  const slide = {
    slides: [{
      id: 'c6-s1', type: 'materi', title: 'Slide', body: '', options: [], correct: [],
      explanation: '', image: '', groups: 2,
    }],
  };

  it('no expectedVersion → 200 OK (no locking)', async () => {
    const res = await request
      .put(`/api/presentations/${conflictPresId}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send(slide);
    expect(res.status).toBe(200);
    currentVersion = res.body.version;
  });

  it('correct expectedVersion → 200 OK', async () => {
    const res = await request
      .put(`/api/presentations/${conflictPresId}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send({ ...slide, expectedVersion: currentVersion });
    expect(res.status).toBe(200);
    currentVersion = res.body.version;
  });

  it('stale expectedVersion → 409 Conflict with message', async () => {
    const staleVersion = currentVersion - 1;
    const res = await request
      .put(`/api/presentations/${conflictPresId}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send({ ...slide, expectedVersion: staleVersion });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/tab lain|versi/i);
  });
});

// ---------------------------------------------------------------------------
// ZodError → 422: invalid slide payloads must return 422, not 500
// ---------------------------------------------------------------------------
describe('ZodError → 422 on invalid slide payload', () => {
  let zodTestPresId: string;

  beforeAll(async () => {
    const pr = await request
      .post('/api/presentations')
      .auth(presenterToken, { type: 'bearer' })
      .send({ title: 'ZodError Test' });
    zodTestPresId = pr.body.id;
  }, 10_000);

  it('unknown slide type → 422 with message', async () => {
    const res = await request
      .put(`/api/presentations/${zodTestPresId}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send({
        slides: [{
          id: 'z-s1', type: 'invalid-type', title: 'Bad',
          body: '', options: [], correct: [], explanation: '', image: '', groups: 2,
        }],
      });
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('message');
    expect(typeof res.body.message).toBe('string');
  });

  it('slides not an array → 422 with message', async () => {
    const res = await request
      .put(`/api/presentations/${zodTestPresId}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send({ slides: 'not-an-array' });
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('message');
  });

  it('slide missing required field → 422 with message', async () => {
    const res = await request
      .put(`/api/presentations/${zodTestPresId}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send({ slides: [{ id: 'z-s2', type: 'materi' /* missing title, body, etc. */ }] });
    expect(res.status).toBe(422);
    expect(res.body).toHaveProperty('message');
  });
});

// ---------------------------------------------------------------------------
// A1 — REST join broadcasts updated snapshot to presenter and projector rooms
// ---------------------------------------------------------------------------
describe('A1 — REST join (POST /api/sessions/join) broadcasts snapshot to presenter + projector', () => {
  let a1SessionId: string;
  let a1SessionCode: string;
  let a1ProjToken: string;

  beforeAll(async () => {
    const pr = await request
      .post('/api/presentations')
      .auth(presenterToken, { type: 'bearer' })
      .send({ title: 'A1 Join Broadcast Test' });

    await request
      .put(`/api/presentations/${pr.body.id}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send({
        slides: [{
          id: 'a1-materi', type: 'materi', title: 'M', body: '',
          options: [], correct: [], explanation: '', image: '', groups: 3,
        }],
      });

    const sess = await request
      .post(`/api/presentations/${pr.body.id}/sessions`)
      .auth(presenterToken, { type: 'bearer' });
    a1SessionId = sess.body.sessionId;
    a1SessionCode = sess.body.code;

    const projRes = await request
      .get(`/api/sessions/${a1SessionId}/projector-token`)
      .auth(presenterToken, { type: 'bearer' });
    a1ProjToken = projRes.body.token;
  }, 15_000);

  it('joining via REST updates participant count in presenter and projector snapshots', async () => {
    const presSocket = io(serverUrl, {
      auth: { token: presenterToken, sessionId: a1SessionId },
      reconnection: false,
    });
    const projSocket = io(serverUrl, {
      auth: { projectorToken: a1ProjToken, sessionId: a1SessionId },
      reconnection: false,
    });

    await Promise.all([
      waitFor(presSocket, 'session.snapshot'),
      waitFor(projSocket, 'session.snapshot'),
    ]);

    // Set up snapshot listeners BEFORE the REST join
    const presSnapP = waitFor<{ pov: string; view: Record<string, unknown> }>(
      presSocket, 'session.snapshot', 5000,
    );
    const projSnapP = waitFor<{ pov: string; view: Record<string, unknown> }>(
      projSocket, 'session.snapshot', 5000,
    );

    // Join via REST (not Socket.IO) — this triggers broadcastAfterJoin
    const joinRes = await request
      .post('/api/sessions/join')
      .send({ code: a1SessionCode, name: 'A1-JoinTest' });
    expect(joinRes.status).toBe(200);

    // Both rooms must receive an updated snapshot
    const [presSnap, projSnap] = await Promise.all([presSnapP, projSnapP]);

    expect(presSnap.pov).toBe('presenter');
    const presParticipants = presSnap.view['participants'] as unknown[];
    expect(presParticipants, 'presenter snapshot includes new participant').toHaveLength(1);

    expect(projSnap.pov).toBe('projector');
    expect(projSnap.view['sessionId'], 'projector snapshot is for the correct session').toBe(a1SessionId);

    presSocket.disconnect();
    projSocket.disconnect();
  });
});

// ---------------------------------------------------------------------------
// B9 — early quiz close when all online participants have answered
// ---------------------------------------------------------------------------
describe('B9 — early quiz close', () => {
  it('quiz question auto-closes after all online participants answer', async () => {
    const suffix = `b9-${Date.now()}`;

    // Register + login
    await request.post('/api/auth/register').send({ email: `${suffix}@test.id`, password: 'pass123' });
    const loginRes = await request.post('/api/auth/login').send({ email: `${suffix}@test.id`, password: 'pass123' });
    const b9Token: string = loginRes.body.accessToken;

    const presRes = await request.post('/api/presentations').auth(b9Token, { type: 'bearer' }).send({ title: 'B9 Pres' });
    const b9PresId: string = presRes.body.id;
    const b9QId = `b9-q1-${suffix}`;
    await request.put(`/api/presentations/${b9PresId}/slides`).auth(b9Token, { type: 'bearer' }).send({
      slides: [
        { id: `b9-poll`, type: 'polling', title: 'P', body: '', options: ['X', 'Y'], correct: [], explanation: '', image: '', groups: 2 },
        { id: `b9-kuis`, type: 'kuis', title: 'Kuis', body: '', options: [], correct: [], explanation: '', image: '', groups: 2, duration: 30,
          quizQuestions: [{ id: b9QId, title: 'Q1?', options: ['A', 'B'], correct: [0] }] },
      ],
    });

    const sessRes = await request.post(`/api/presentations/${b9PresId}/sessions`).auth(b9Token, { type: 'bearer' });
    const b9SessionId: string = sessRes.body.sessionId;
    const b9Code: string = sessRes.body.code;

    // Join 2 participants
    const b9Participants: Array<{ id: string; token: string }> = [];
    for (const name of ['Alya', 'Bima']) {
      const joinRes = await request.post('/api/sessions/join').send({ code: b9Code, name });
      b9Participants.push({ id: joinRes.body.participantId, token: joinRes.body.token });
    }

    const presSocket = io(serverUrl, { auth: { token: b9Token, sessionId: b9SessionId }, transports: ['websocket'] });
    const partSocket1 = io(serverUrl, { auth: { token: b9Participants[0].token }, transports: ['websocket'] });
    const partSocket2 = io(serverUrl, { auth: { token: b9Participants[1].token }, transports: ['websocket'] });

    try {
      await Promise.all([
        waitFor(presSocket, 'session.snapshot'),
        waitFor(partSocket1, 'session.snapshot'),
        waitFor(partSocket2, 'session.snapshot'),
      ]);

      // Start → navigate to kuis → open question
      await presSocket.timeout(3000).emitWithAck('command', { requestId: 'b9-start', sessionId: b9SessionId, payload: { type: 'session.start' } });
      await presSocket.timeout(3000).emitWithAck('command', { requestId: 'b9-nav', sessionId: b9SessionId, payload: { type: 'slide.activate', slideIndex: 1 } });
      await presSocket.timeout(3000).emitWithAck('command', { requestId: 'b9-open', sessionId: b9SessionId, payload: { type: 'quiz.openQuestion', questionId: b9QId } });

      // Set up listener for closed snapshot before first answer
      const closedSnapP = waitForMatching<{ pov: string; view: Record<string, unknown> }>(
        presSocket,
        'session.snapshot',
        (s) => {
          const q = s.view['quiz'] as Record<string, unknown> | null;
          const runs = q?.['runs'] as Array<Record<string, unknown>> | undefined;
          if (!runs || runs.length === 0) return false;
          return runs[runs.length - 1]?.['closed'] === true;
        },
        8_000,
      );

      // Participant 1 answers — question still open
      await partSocket1.timeout(3000).emitWithAck('command', {
        requestId: 'b9-ans1', sessionId: b9SessionId,
        payload: { type: 'quiz.answerSubmit', questionRunId: b9QId, optionIndex: 0 },
      });

      // Verify still open via REST state
      const stateAfter1 = await request.get(`/api/sessions/${b9SessionId}/state`).auth(b9Token, { type: 'bearer' });
      const run1 = (stateAfter1.body as { quiz?: { runs?: Array<{ closed: boolean }> } }).quiz?.runs?.at(-1);
      expect(run1?.closed).toBe(false);

      // Participant 2 answers — should auto-close
      await partSocket2.timeout(3000).emitWithAck('command', {
        requestId: 'b9-ans2', sessionId: b9SessionId,
        payload: { type: 'quiz.answerSubmit', questionRunId: b9QId, optionIndex: 1 },
      });

      // Wait for closed snapshot broadcast
      const closedSnap = await closedSnapP;
      const quiz = closedSnap.view['quiz'] as Record<string, unknown> | null;
      const runs = quiz?.['runs'] as Array<Record<string, unknown>> | undefined;
      expect(runs && runs[runs.length - 1]?.['closed']).toBe(true);
    } finally {
      presSocket.disconnect();
      partSocket1.disconnect();
      partSocket2.disconnect();
    }
  });
});

// ---------------------------------------------------------------------------
// C7 — multiple correct options: picking second correct option scores full
// ---------------------------------------------------------------------------
describe('C7 — multiple correct options: gateway scoring', () => {
  it('participant picks second correct option → answer is correct with full score', async () => {
    const suffix = `c7-${Date.now()}`;
    const loginRes = await request
      .post('/api/auth/login')
      .send({ email: `gw-${suffix.replace('c7-', '')}@test.id`, password: 'pass123' });
    // Use existing presenterToken (already logged in from beforeAll)
    const C7_Q_ID = `c7-q-${suffix}`;

    // Create a new presentation with a kuis slide that has two correct options
    const c7PresRes = await request
      .post('/api/presentations')
      .auth(presenterToken, { type: 'bearer' })
      .send({ title: 'C7 Multi-Correct Test' });
    const c7PresId = c7PresRes.body.id;
    const C7_KUIS_ID = `c7-kuis-${suffix}`;
    await request
      .put(`/api/presentations/${c7PresId}/slides`)
      .auth(presenterToken, { type: 'bearer' })
      .send({
        slides: [{
          id: C7_KUIS_ID, type: 'kuis', title: 'Kuis C7', body: '',
          options: [], correct: [], explanation: '', image: '', groups: 2,
          duration: 30,
          quizQuestions: [{
            id: C7_Q_ID, title: 'Mana yang benar?',
            options: ['A', 'B', 'C'], correct: [0, 2], // A and C correct
          }],
        }],
      });

    // Create session and join one participant
    const c7SessRes = await request
      .post(`/api/presentations/${c7PresId}/sessions`)
      .auth(presenterToken, { type: 'bearer' });
    const c7SessionId = c7SessRes.body.sessionId;

    const joinRes = await request
      .post('/api/sessions/join')
      .send({ code: c7SessRes.body.code, name: 'TestUser' });
    const c7PartId = joinRes.body.participantId;
    const c7PartToken = joinRes.body.token;
    void c7PartId;

    const presSocket = io(serverUrl, {
      auth: { token: presenterToken, sessionId: c7SessionId },
      reconnection: false,
    });
    const partSocket = io(serverUrl, {
      auth: { token: c7PartToken },
      reconnection: false,
    });

    try {
      await Promise.all([
        waitFor(presSocket, 'session.snapshot'),
        waitFor(partSocket, 'session.snapshot'),
      ]);

      // Start session and navigate to kuis slide (index 0)
      await presSocket.timeout(5000).emitWithAck('command', {
        requestId: `c7-start-${suffix}`, sessionId: c7SessionId,
        payload: { type: 'session.start' },
      } as import('../contracts/commands').CommandEnvelope);

      await presSocket.timeout(5000).emitWithAck('command', {
        requestId: `c7-nav-${suffix}`, sessionId: c7SessionId,
        payload: { type: 'slide.activate', slideIndex: 0 },
      } as import('../contracts/commands').CommandEnvelope);

      // Open the quiz question
      await presSocket.timeout(5000).emitWithAck('command', {
        requestId: `c7-open-${suffix}`, sessionId: c7SessionId,
        payload: { type: 'quiz.openQuestion', questionId: C7_Q_ID },
      } as import('../contracts/commands').CommandEnvelope);

      // Participant picks option index 2 (C) — the second correct option
      const ansAck = await partSocket.timeout(5000).emitWithAck('command', {
        requestId: `c7-ans-${suffix}`, sessionId: c7SessionId,
        payload: { type: 'quiz.answerSubmit', questionRunId: C7_Q_ID, optionIndex: 2 },
      } as import('../contracts/commands').CommandEnvelope);
      expect(ansAck.ok).toBe(true);

      // Get presenter state and check scoring
      const stateRes = await request
        .get(`/api/sessions/${c7SessionId}/state`)
        .auth(presenterToken, { type: 'bearer' });
      const quiz = stateRes.body.quiz as {
        runs: Array<{ answers: Array<{ correct: boolean; score: number }> }>;
      };
      const answers = quiz?.runs?.[0]?.answers ?? [];
      expect(answers.length).toBe(1);
      expect(answers[0].correct).toBe(true);
      expect(answers[0].score).toBeGreaterThan(0);
    } finally {
      presSocket.disconnect();
      partSocket.disconnect();
    }
  });
});
