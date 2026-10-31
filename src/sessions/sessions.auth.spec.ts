/**
 * Authorization tests — sessions and presentations endpoints.
 * Tests:
 * - Participant token rejected on presenter endpoints (403)
 * - Presenter A cannot access Presenter B's resources (403/404)
 * - Invalid or expired token returns 401
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import supertest from 'supertest';
import { AppModule } from '../app.module';

let app: INestApplication;
let request: ReturnType<typeof supertest>;

// Two separate presenter accounts
let tokenA: string;
let tokenB: string;
let participantToken: string;

let presentationA: string;
let sessionA: string;
let sessionCode: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();
  request = supertest(app.getHttpServer());

  // Register two users
  const suffix = Date.now();
  await request.post('/api/auth/register').send({ email: `a-${suffix}@test.id`, password: 'pass123' });
  await request.post('/api/auth/register').send({ email: `b-${suffix}@test.id`, password: 'pass123' });

  tokenA = (await request.post('/api/auth/login').send({ email: `a-${suffix}@test.id`, password: 'pass123' })).body.accessToken;
  tokenB = (await request.post('/api/auth/login').send({ email: `b-${suffix}@test.id`, password: 'pass123' })).body.accessToken;

  // User A creates a presentation and starts a session
  const pres = await request.post('/api/presentations').auth(tokenA, { type: 'bearer' }).send({ title: 'Test pres' });
  presentationA = pres.body.id;
  // Add a valid slide so session has an activeSlide
  await request.put(`/api/presentations/${presentationA}/slides`).auth(tokenA, { type: 'bearer' }).send({
    slides: [{ id: 'slide-1', type: 'materi', title: 'Intro', body: '', options: [], correct: 0, explanation: '', image: '', groups: 3, layout: 'teks' }]
  });

  const sess = await request.post(`/api/presentations/${presentationA}/sessions`).auth(tokenA, { type: 'bearer' });
  sessionA = sess.body.sessionId;
  sessionCode = sess.body.code;

  // A participant joins
  const join = await request.post('/api/sessions/join').send({ code: sessionCode, name: 'TestPeserta' });
  participantToken = join.body.token;
}, 30000);

// ---------------------------------------------------------------------------
// 401 — invalid / expired token
// ---------------------------------------------------------------------------
describe('401 — invalid or missing token', () => {
  it('GET /api/presentations with no token → 401', async () => {
    await request.get('/api/presentations').expect(401);
  });

  it('GET /api/presentations with garbage token → 401', async () => {
    await request.get('/api/presentations').auth('not-a-valid-token', { type: 'bearer' }).expect(401);
  });

  it('GET /api/sessions/:id/state with no token and no projectorToken → 401', async () => {
    await request.get(`/api/sessions/${sessionA}/state`).expect(401);
  });
});

// ---------------------------------------------------------------------------
// 403 — participant token on presenter endpoints
// ---------------------------------------------------------------------------
describe('403 — participant token on presenter-only endpoints', () => {
  it('GET /api/presentations with participant token → 403', async () => {
    // Guard sees valid JWT but role:'participant' on a @PresenterOnly() route → ForbiddenException
    await request.get('/api/presentations').auth(participantToken, { type: 'bearer' }).expect(403);
  });

  it('GET /api/sessions/:id/state with participant token → ParticipantView (not PresenterView)', async () => {
    const res = await request
      .get(`/api/sessions/${sessionA}/state`)
      .auth(participantToken, { type: 'bearer' })
      .expect(200);
    // ParticipantView has `pid`, PresenterView does not
    expect(res.body.pid).toBeDefined();
    expect(res.body.code).toBeUndefined(); // participants don't see code in their view? Actually they don't need it
    // Must not see all participants list (that's PresenterView only)
    expect(res.body.responses).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// 403/404 — presenter A on presenter B's resources
// ---------------------------------------------------------------------------
describe('403/404 — presenter A cannot access presenter B resources', () => {
  it('GET /api/presentations/:id with wrong owner → 403', async () => {
    // tokenB tries to get presentation owned by A
    const res = await request.get(`/api/presentations/${presentationA}`).auth(tokenB, { type: 'bearer' });
    expect([403, 404]).toContain(res.status);
  });

  it('PATCH /api/presentations/:id with wrong owner → 403', async () => {
    const res = await request
      .patch(`/api/presentations/${presentationA}`)
      .auth(tokenB, { type: 'bearer' })
      .send({ title: 'Hacked' });
    expect([403, 404]).toContain(res.status);
  });

  it('DELETE /api/presentations/:id with wrong owner → 403', async () => {
    const res = await request.delete(`/api/presentations/${presentationA}`).auth(tokenB, { type: 'bearer' });
    expect([403, 404]).toContain(res.status);
  });

  it('GET /api/sessions/:id/state as presenter with wrong user → 403', async () => {
    // tokenB tries to get PresenterView of a session owned by A
    const res = await request
      .get(`/api/sessions/${sessionA}/state`)
      .auth(tokenB, { type: 'bearer' });
    expect([403, 404]).toContain(res.status);
  });

  it('GET /api/sessions/:id/projector-token with wrong owner → 403', async () => {
    const res = await request
      .get(`/api/sessions/${sessionA}/projector-token`)
      .auth(tokenB, { type: 'bearer' });
    expect([403, 404]).toContain(res.status);
  });

  it('GET /api/presentations/:id/results with wrong owner → 403', async () => {
    const res = await request
      .get(`/api/presentations/${presentationA}/results`)
      .auth(tokenB, { type: 'bearer' });
    expect([403, 404]).toContain(res.status);
  });
});

// ---------------------------------------------------------------------------
// C8: GET /api/presentations/:id/results
// ---------------------------------------------------------------------------
describe('C8 — GET /api/presentations/:id/results', () => {
  it('owner gets 200 with sessions array containing slides and quizScores', async () => {
    const res = await request
      .get(`/api/presentations/${presentationA}/results`)
      .auth(tokenA, { type: 'bearer' })
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    // beforeAll created sessionA, so at least one session exists
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    const session = res.body[0];
    expect(session).toHaveProperty('id');
    expect(session).toHaveProperty('code');
    expect(session).toHaveProperty('slides');
    expect(session).toHaveProperty('quizScores');
    expect(Array.isArray(session.slides)).toBe(true);
    expect(Array.isArray(session.quizScores)).toBe(true);
    // Each slide has ownerLabel-based responses (no raw IDs exposed)
    if (session.slides.length > 0) {
      const slide = session.slides[0];
      expect(slide).toHaveProperty('responseCount');
      expect(Array.isArray(slide.responses)).toBe(true);
      if (slide.responses.length > 0) {
        expect(slide.responses[0]).toHaveProperty('ownerLabel');
        expect(slide.responses[0]).not.toHaveProperty('byParticipant');
      }
    }
  });

  it('unauthenticated request → 401', async () => {
    await request.get(`/api/presentations/${presentationA}/results`).expect(401);
  });
});
