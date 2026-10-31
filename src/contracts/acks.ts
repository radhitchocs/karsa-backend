/**
 * contracts/acks.ts
 *
 * Server acknowledgement for every Socket.IO command.
 *
 * IDENTICAL COPY in both repos — do not diverge.
 */

export type CommandAck = {
  requestId: string;
  ok: boolean;
  /** Machine-readable error code; empty string on success */
  code: AckCode;
  /** Human-readable message in Indonesian */
  message: string;
  /** Session entity version after successful commit; 0 on failure */
  entityVersion: number;
};

export type AckCode =
  | ""                     // success
  | "STATE_CONFLICT"       // expectedVersion mismatch
  | "NOT_FOUND"
  | "UNAUTHORIZED"
  | "INVALID_STATE"        // e.g. activity already closed
  | "DUPLICATE_SUBMIT"     // quiz answer already submitted (receipt returned)
  | "DEADLINE_PASSED"
  | "VALIDATION_ERROR"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR";
