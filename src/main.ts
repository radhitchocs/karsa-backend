import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { IoAdapter } from '@nestjs/platform-socket.io';
import { AppModule } from './app.module';
import { AllExceptionsFilter } from './common/zod-exception.filter';

/** CORS_ORIGIN="https://a.app,https://b.app" → allow-list; unset → allow any origin (local dev). */
function corsOrigins(): string[] | true {
  const raw = process.env['CORS_ORIGIN'];
  return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : true;
}

/** Socket.IO adapter that applies the same CORS allow-list as the HTTP API. */
class CorsIoAdapter extends IoAdapter {
  // Options type taken from the adapter: the app and @nestjs/platform-socket.io resolve different socket.io patch versions.
  createIOServer(port: number, options?: Parameters<IoAdapter['createIOServer']>[1]) {
    const origins = corsOrigins();
    const withCors = {
      ...options,
      cors: { origin: origins, credentials: true },
      // CORS headers only bind browsers on polling; WebSocket upgrades ignore CORS. Refuse browser
      // connections from other origins here. No Origin header = non-browser client (allowed).
      allowRequest: (req: { headers: { origin?: string } }, cb: (err: string | null, ok: boolean) => void) => {
        const origin = req.headers.origin;
        cb(null, origins === true || !origin || origins.includes(origin));
      },
    };
    return super.createIOServer(port, withCors as NonNullable<typeof options>);
  }
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  // Behind a hosting proxy (Render, Fly, …) trust X-Forwarded-* so req.protocol is https.
  app.set('trust proxy', 1);
  app.enableCors({ origin: corsOrigins(), credentials: true });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useWebSocketAdapter(new CorsIoAdapter(app));
  // Listen on all interfaces so phones on the same LAN can reach the API.
  await app.listen(process.env.PORT ?? 3001, '0.0.0.0');
}

bootstrap();
