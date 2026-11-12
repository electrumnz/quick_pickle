/**
 * The ways an operation says no. Each has a code a caller can branch on and a
 * sentence a person can read, in that order of importance.
 */
export type OpErrorCode =
  /** What was sent does not make sense. `fields` says which parts. */
  | "invalid_input"
  /** Signed in, but not allowed to do this. */
  | "forbidden"
  /** Not signed in at all. */
  | "unauthenticated"
  /** The thing asked for is not there. */
  | "not_found"
  /** It cannot be done from the state things are in ("already shipped"). */
  | "conflict"
  /** It reaches outside or cannot be undone, and nobody has said yes yet. */
  | "needs_confirmation"
  /** Something this depends on is not set up or is not answering. */
  | "unavailable";

export class OpError extends Error {
  readonly code: OpErrorCode;
  readonly fields: Readonly<Record<string, string>>;

  constructor(
    code: OpErrorCode,
    message: string,
    fields: Readonly<Record<string, string>> = {},
  ) {
    super(message);
    this.name = "OpError";
    this.code = code;
    this.fields = fields;
  }
}

export const notFound = (what: string) =>
  new OpError("not_found", `${what} was not found.`);

export const conflict = (message: string) => new OpError("conflict", message);
