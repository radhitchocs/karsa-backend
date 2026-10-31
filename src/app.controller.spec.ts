import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { describe, it, expect, beforeEach } from 'vitest';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
    }).compile();
    appController = app.get<AppController>(AppController);
  });

  it('health() returns status ok', () => {
    const result = appController.health();
    expect(result.status).toBe('ok');
    expect(result.timestamp).toBeDefined();
  });
});
