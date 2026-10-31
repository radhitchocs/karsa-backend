/**
 * Presentations list endpoint — verifies slideCount and slideKinds in response.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import supertest from 'supertest';
import { AppModule } from '../app.module';

let app: INestApplication;
let request: ReturnType<typeof supertest>;
let token: string;
let presId: string;

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();
  app = moduleRef.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
  await app.init();
  request = supertest(app.getHttpServer());

  const suffix = Date.now();
  await request
    .post('/api/auth/register')
    .send({ email: `list-${suffix}@test.id`, password: 'pass123' });
  const login = await request
    .post('/api/auth/login')
    .send({ email: `list-${suffix}@test.id`, password: 'pass123' });
  token = login.body.accessToken;

  const pres = await request
    .post('/api/presentations')
    .set('Authorization', `Bearer ${token}`)
    .send({ title: 'List Test' });
  presId = pres.body.id;
});

afterAll(async () => {
  await app.close();
});

describe('GET /api/presentations — slideCount and slideKinds', () => {
  it('returns slideCount=0 and slideKinds=[] for empty presentation', async () => {
    const res = await request
      .get('/api/presentations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const p = (res.body as Array<{ id: string; slideCount: number; slideKinds: string[] }>).find(
      (x) => x.id === presId,
    );
    expect(p).toBeDefined();
    expect(p!.slideCount).toBe(0);
    expect(p!.slideKinds).toEqual([]);
  });

  it('returns correct slideCount and slideKinds after adding slides', async () => {
    const slides = [
      { id: 'a', type: 'materi', title: 'M', body: '', options: [], correct: [], explanation: '', image: '', groups: 0 },
      { id: 'b', type: 'pilihan', title: 'P', body: '', options: ['A', 'B'], correct: [0], explanation: '', image: '', groups: 0 },
      { id: 'c', type: 'pilihan', title: 'P2', body: '', options: ['X'], correct: [0], explanation: '', image: '', groups: 0 },
    ];
    await request
      .put(`/api/presentations/${presId}/slides`)
      .set('Authorization', `Bearer ${token}`)
      .send({ slides })
      .expect(200);

    const res = await request
      .get('/api/presentations')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const p = (res.body as Array<{ id: string; slideCount: number; slideKinds: string[] }>).find(
      (x) => x.id === presId,
    );
    expect(p).toBeDefined();
    expect(p!.slideCount).toBe(3);
    expect(p!.slideKinds).toContain('materi');
    expect(p!.slideKinds).toContain('pilihan');
    expect(p!.slideKinds).toHaveLength(2); // unique: materi + pilihan only
  });
});
