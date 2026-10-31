/**
 * SessionGateway — Socket.IO gateway.
 *
 * Auth: Bearer JWT in handshake.auth.token (presenter / participant),
 *       or projectorToken + sessionId for the projector POV (D20).
 *
 * Rooms:
 *   presenter-{sessionId}    — one presenter socket
 *   projector-{sessionId}    — one or more projector sockets
 *   participant-{pid}        — one socket per participant
 *
 * After every successful command: full POV snapshots pushed to all rooms.
 * Clients REPLACE state (no merge).
 *
 * Presenter disconnect: 10 s grace (PRESENTER_GRACE_MS env var), then
 * session.paused = true persisted to DB.  Quiz timers keep running (CH19).
 *
 * Reconnect: client calls GET /api/sessions/:id/state first, then re-joins.
 * On socket connection the gateway sends a fresh snapshot automatically.
 */
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
} from '@nestjs/websockets';
import { createHash } from 'crypto';
import type { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../prisma/prisma.service';
import { SessionCommandService } from './session-command.service';
import type { CommandEnvelope } from '../contracts/commands';
import type { CommandAck } from '../contracts/acks';

interface SocketMeta {
  sessionId: string;
  role: 'presenter' | 'participant' | 'projector';
  actorId: string;
}

/**
 * Commands a participant is allowed to send.
 * Allowlist — everything else is UNAUTHORIZED at the gateway layer.
 * Presenter commands (navigate, open/close, quiz control, etc.) are NOT in this set.
 */
const PARTICIPANT_ALLOWED_COMMANDS = new Set<string>([
  'response.submit',
  'question.submit',
  'quiz.answerSubmit',
]);

@WebSocketGateway({ cors: { origin: '*' } })
export class SessionGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
  @WebSocketServer()
  server!: Server;

  /** sessionId → current presenter socket id */
  private readonly presenterSockets = new Map<string, string>();
  /** sessionId → grace-period timeout before pausing */
  private readonly heartbeatTimers = new Map<string, ReturnType<typeof setTimeout>>();
  /** socketId → metadata set on connect */
  private readonly socketMeta = new Map<string, SocketMeta>();
  /**
   * socketId → promise that resolves once handleConnection finishes.
   * Commands arriving before handleConnection completes await this promise,
   * preventing UNAUTHORIZED when a client emits immediately after 'connect'.
   */
  private readonly socketHandshake = new Map<string, Promise<void>>();

  private readonly GRACE_MS = Number(process.env['PRESENTER_GRACE_MS'] ?? 10_000);

  constructor(
    private readonly commands: SessionCommandService,
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  // ---------------------------------------------------------------------------
  // Gateway init — reschedule quiz timers surviving a server restart
  // ---------------------------------------------------------------------------

  async afterInit(server: Server): Promise<void> {
    this.commands.setServer(server);
    await this.commands.recoverQuizTimers(
      server,
      (sid: string) => this.presenterSockets.has(sid),
    );
  }

  // ---------------------------------------------------------------------------
  // Connection lifecycle
  // ---------------------------------------------------------------------------

  async handleConnection(socket: Socket): Promise<void> {
    // Register a handshake promise BEFORE any async work so that handleCommand
    // can await it if a command arrives while handleConnection is still running.
    let resolveHandshake!: () => void;
    this.socketHandshake.set(
      socket.id,
      new Promise<void>((res) => { resolveHandshake = res; }),
    );

    let meta: SocketMeta;
    try {
      meta = await this.authenticate(socket);
    } catch (e) {
      socket.emit('error', { message: (e as Error).message });
      socket.disconnect(true);
      resolveHandshake();
      this.socketHandshake.delete(socket.id);
      return;
    }

    this.socketMeta.set(socket.id, meta);
    const { sessionId, role, actorId } = meta;
    const presenterOnline = role === 'presenter' || this.presenterSockets.has(sessionId);

    try {
      if (role === 'presenter') {
        socket.join(`presenter-${sessionId}`);

        // Cancel any in-flight grace timer
        const t = this.heartbeatTimers.get(sessionId);
        if (t) {
          clearTimeout(t);
          this.heartbeatTimers.delete(sessionId);
        }
        this.presenterSockets.set(sessionId, socket.id);

        await this.commands.sendSocketSnapshot(socket, sessionId, 'presenter', actorId, true);

      } else if (role === 'participant') {
        socket.join(`participant-${actorId}`);
        await this.commands.setParticipantOnline(actorId, true);
        await this.commands.sendSocketSnapshot(socket, sessionId, 'participant', actorId, presenterOnline);
        await this.commands.broadcastSnapshots(sessionId, this.server, presenterOnline);

      } else {
        // projector
        socket.join(`projector-${sessionId}`);
        await this.commands.sendSocketSnapshot(socket, sessionId, 'projector', actorId, presenterOnline);
      }
    } catch (e) {
      socket.emit('error', { message: `Connection setup failed: ${(e as Error).message}` });
      this.socketMeta.delete(socket.id);
      socket.disconnect(true);
    } finally {
      resolveHandshake();
      this.socketHandshake.delete(socket.id);
    }
  }

  async handleDisconnect(socket: Socket): Promise<void> {
    this.socketHandshake.delete(socket.id);
    const meta = this.socketMeta.get(socket.id);
    if (!meta) return;
    this.socketMeta.delete(socket.id);

    const { sessionId, role, actorId } = meta;

    if (role === 'presenter') {
      // Only clear if this socket is still the registered presenter
      if (this.presenterSockets.get(sessionId) === socket.id) {
        this.presenterSockets.delete(sessionId);
      }

      // Start grace timer — if presenter doesn't reconnect within GRACE_MS, pause session
      const timer = setTimeout(async () => {
        this.heartbeatTimers.delete(sessionId);
        try {
          await this.commands.setSessionPaused(sessionId, true);
          await this.commands.broadcastSnapshots(sessionId, this.server, false);
        } catch {
          // Session may have ended; ignore
        }
      }, this.GRACE_MS);
      this.heartbeatTimers.set(sessionId, timer);

    } else if (role === 'participant') {
      await this.commands.setParticipantOnline(actorId, false);
      const presenterOnline = this.presenterSockets.has(sessionId);
      try {
        await this.commands.broadcastSnapshots(sessionId, this.server, presenterOnline);
      } catch {
        // Session may have ended; ignore
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Command handler
  // ---------------------------------------------------------------------------

  @SubscribeMessage('command')
  async handleCommand(
    @ConnectedSocket() socket: Socket,
    @MessageBody() envelope: CommandEnvelope,
  ): Promise<CommandAck> {
    // If handleConnection is still in progress, wait for it to finish before
    // reading socketMeta. This prevents UNAUTHORIZED on commands sent right
    // after the socket 'connect' event fires on the client.
    const handshake = this.socketHandshake.get(socket.id);
    if (handshake) await handshake;

    const meta = this.socketMeta.get(socket.id);
    if (!meta) {
      return {
        requestId: envelope?.requestId ?? '',
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Tidak terautentikasi.',
        entityVersion: 0,
      };
    }

    const { sessionId, role, actorId } = meta;

    if (role === 'projector') {
      return {
        requestId: envelope.requestId,
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Proyektor tidak dapat mengirim perintah.',
        entityVersion: 0,
      };
    }

    if (role === 'participant' && !PARTICIPANT_ALLOWED_COMMANDS.has(envelope.payload.type)) {
      return {
        requestId: envelope.requestId,
        ok: false,
        code: 'UNAUTHORIZED',
        message: 'Peserta tidak dapat mengirim perintah presenter.',
        entityVersion: 0,
      };
    }

    const presenterOnline = role === 'presenter' || this.presenterSockets.has(sessionId);
    const ack = await this.commands.executeCommand(sessionId, actorId, envelope, presenterOnline);

    if (ack.ok) {
      // Broadcast updated snapshots to all rooms
      const stillOnline = this.presenterSockets.has(sessionId);
      await this.commands.broadcastSnapshots(sessionId, this.server, stillOnline);

      // Schedule quiz auto-close timer when a question is opened
      const pt = envelope.payload.type;
      if (pt === 'quiz.openQuestion') {
        await this.scheduleTimerIfNeeded(sessionId);
      }
    }

    return ack;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async scheduleTimerIfNeeded(sessionId: string): Promise<void> {
    const { session } = await this.commands.builder.load(sessionId);
    const run = session.quiz?.runs.at(-1);
    if (!run || run.closed) return;
    this.commands.scheduleQuizTimer(
      sessionId,
      run.questionId,
      run.deadlineAt,
      this.server,
      () => this.presenterSockets.has(sessionId),
    );
  }

  private async authenticate(socket: Socket): Promise<SocketMeta> {
    const token = socket.handshake.auth?.token as string | undefined;
    const projectorToken = socket.handshake.auth?.projectorToken as string | undefined;
    const sessionId = socket.handshake.auth?.sessionId as string | undefined;

    // Projector path: projectorToken + sessionId
    if (projectorToken && sessionId) {
      const tokenHash = createHash('sha256').update(projectorToken).digest('hex');
      const record = await this.prisma.projectorToken.findFirst({
        where: { sessionId, tokenHash },
        include: { session: { select: { status: true } } },
      });
      if (!record) throw new Error('Token proyektor tidak valid.');
      // D20: token expires on session end
      if (record.session.status === 'ENDED') throw new Error('Sesi sudah berakhir.');
      return { sessionId, role: 'projector', actorId: sessionId };
    }

    if (!token) throw new Error('Token tidak ditemukan.');

    let payload: { role: string; sub: string; sessionId?: string };
    try {
      payload = this.jwt.verify<{ role: string; sub: string; sessionId?: string }>(token);
    } catch {
      throw new Error('Token tidak valid atau kadaluarsa.');
    }

    if (payload.role === 'presenter') {
      if (!sessionId) throw new Error('sessionId wajib untuk presenter.');
      const sess = await this.prisma.session.findUnique({
        where: { id: sessionId },
        include: { presentation: { select: { ownerId: true } } },
      });
      if (!sess || sess.presentation.ownerId !== payload.sub) {
        throw new Error('Akses ditolak.');
      }
      return { sessionId, role: 'presenter', actorId: payload.sub };

    } else if (payload.role === 'participant') {
      const sid = payload.sessionId;
      if (!sid) throw new Error('Token peserta tidak valid.');
      return { sessionId: sid, role: 'participant', actorId: payload.sub };

    } else {
      throw new Error('Role tidak dikenal.');
    }
  }
}
