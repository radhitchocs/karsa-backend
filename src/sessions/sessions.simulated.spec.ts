/**
 * AC16 — simulated flag correctness
 *
 * Tests:
 * - DEMO_MODE=true: createSession() auto-creates 6 bots with simulated=true;
 *   a real join() is always simulated=false; hasSimulatedData=true in presenter view
 * - DEMO_MODE=false: no bots created; a real join() is simulated=false;
 *   hasSimulatedData=false in presenter view
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import supertest from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';

const BOT_NAMES = ['Alya', 'Bima', 'Citra', 'Dimas', 'Eka', 'Farah'];

let app: INestApplication;
let prisma: PrismaService;
let request: ReturnType<typeof supertest>;
let presenterToken: string;
let presentationId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();
  request = supertest(app.getHttpServer());
  prisma = moduleRef.get(PrismaService);

  const suffix = Date.now();
  await request.post('/api/auth/register').send({ email: `sim-${suffix}@test.id`, password: 'pass123' });
  presenterToken = (
    await request.post('/api/auth/login').send({ email: `sim-${suffix}@test.id`, password: 'pass123' })
  ).body.accessToken;

  const pres = await request
    .post('/api/presentations')
    .auth(presenterToken, { type: 'bearer' })
    .send({ title: 'Sim Test' });
  presentationId = pres.body.id;

  await request
    .put(`/api/presentations/${presentationId}/slides`)
    .auth(presenterToken, { type: 'bearer' })
    .send({
      slides: [
        {
          id: 'slide-1',
          type: 'materi',
          title: 'Intro',
          body: '',
          options: [],
          correct: 0,
          explanation: '',
          image: '',
          groups: 3,
          layout: 'teks',
        },
      ],
    });
}, 30000);

afterAll(async () => {
  await app.close();
});

// ---------------------------------------------------------------------------
// DEMO_MODE=true
// ---------------------------------------------------------------------------
describe('DEMO_MODE=true — bot participants', () => {
  let sessionId: string;
  let sessionCode: string;

  beforeAll(async () => {
    process.env['DEMO_MODE'] = 'true';

    const sess = await request
      .post(`/api/presentations/${presentationId}/sessions`)
      .auth(presenterToken, { type: 'bearer' });
    sessionId = sess.body.sessionId;
    sessionCode = sess.body.code;
  });

  afterAll(() => {
    delete process.env['DEMO_MODE'];
  });

  it('creates exactly 6 bot participants', async () => {
    const bots = await prisma.participant.findMany({ where: { sessionId } });
    expect(bots).toHaveLength(6);
    const names = bots.map((b) => b.name).sort();
    expect(names).toEqual([...BOT_NAMES].sort());
  });

  it('bot participants have simulated=true and online=false', async () => {
    const bots = await prisma.participant.findMany({ where: { sessionId } });
    for (const bot of bots) {
      expect(bot.simulated).toBe(true);
      expect(bot.online).toBe(false);
    }
  });

  it('a real join() sets simulated=false regardless of DEMO_MODE', async () => {
    const join = await request
      .post('/api/sessions/join')
      .send({ code: sessionCode, name: 'RealUser' });
    expect(join.status).toBe(200);

    const participant = await prisma.participant.findUnique({
      where: { id: join.body.participantId },
    });
    expect(participant?.simulated).toBe(false);
  });

  it('presenterView.hasSimulatedData=true when bots present', async () => {
    const res = await request
      .get(`/api/sessions/${sessionId}/state`)
      .auth(presenterToken, { type: 'bearer' })
      .expect(200);
    expect(res.body.hasSimulatedData).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// DEMO_MODE=false (default)
// ---------------------------------------------------------------------------
describe('DEMO_MODE=false — no bots', () => {
  let sessionId: string;
  let sessionCode: string;

  beforeAll(async () => {
    // Ensure DEMO_MODE is not set
    delete process.env['DEMO_MODE'];

    const sess = await request
      .post(`/api/presentations/${presentationId}/sessions`)
      .auth(presenterToken, { type: 'bearer' });
    sessionId = sess.body.sessionId;
    sessionCode = sess.body.code;
  });

  it('creates 0 participants on session creation', async () => {
    const participants = await prisma.participant.findMany({ where: { sessionId } });
    expect(participants).toHaveLength(0);
  });

  it('a real join() sets simulated=false', async () => {
    const join = await request
      .post('/api/sessions/join')
      .send({ code: sessionCode, name: 'RealUser2' });
    expect(join.status).toBe(200);

    const participant = await prisma.participant.findUnique({
      where: { id: join.body.participantId },
    });
    expect(participant?.simulated).toBe(false);
  });

  it('presenterView.hasSimulatedData=false when no simulated participants', async () => {
    const res = await request
      .get(`/api/sessions/${sessionId}/state`)
      .auth(presenterToken, { type: 'bearer' })
      .expect(200);
    expect(res.body.hasSimulatedData).toBe(false);
  });
});
