/**
 * contracts/events.ts
 *
 * Events emitted by server to clients via Socket.IO.
 *
 * After each committed command:
 * - "session.snapshot" is pushed to presenter-{id}, projector-{id}, and participant-{pid} rooms
 * - Each room receives the projected view for their POV
 *
 * Clients REPLACE their state with the incoming snapshot (no patching).
 * Re-fetch via GET /api/sessions/:id/state only on reconnect.
 *
 * IDENTICAL COPY in both repos — do not diverge.
 */

import type { PresenterView, ParticipantView, ProjectorView } from "./views";

export type ServerEvent =
  | SessionSnapshotPresenter
  | SessionSnapshotParticipant
  | SessionSnapshotProjector
  | SessionEnded;

/** Full projected snapshot for presenter room */
export type SessionSnapshotPresenter = {
  type: "session.snapshot";
  pov: "presenter";
  view: PresenterView;
};

/** Full projected snapshot for a specific participant */
export type SessionSnapshotParticipant = {
  type: "session.snapshot";
  pov: "participant";
  view: ParticipantView;
};

/** Full projected snapshot for projector room */
export type SessionSnapshotProjector = {
  type: "session.snapshot";
  pov: "projector";
  view: ProjectorView;
};

/** Session has ended; clients should show summary */
export type SessionEnded = {
  type: "session.ended";
  sessionId: string;
};
