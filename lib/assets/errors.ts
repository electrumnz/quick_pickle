/**
 * One error type for the whole asset library.
 *
 * Every rejection carries a `code` the interface can switch on and a `message`
 * written for the founder rather than for a log: she is the person who will see
 * it, standing in a market with a phone, and "unsupported_format" is not a
 * sentence. The code is what the tests and the route handler match on.
 */

export type AssetErrorCode =
  /** The bytes are not a photo or a video we accept. */
  | "unsupported_format"
  /** The bytes disagree with the name or the type the browser claimed. */
  | "content_type_mismatch"
  /** Structurally broken: the container did not parse. */
  | "corrupt_file"
  | "file_too_large"
  | "upload_too_large"
  | "too_many_files"
  | "empty_file"
  /** A storage key that tried to leave its root, or was otherwise malformed. */
  | "invalid_storage_key"
  | "not_found"
  /** The consent gate refused. See lib/assets/consent.ts. */
  | "consent_not_recorded"
  | "consent_refused"
  | "rights_unknown"
  | "rights_expired"
  | "invalid_metadata"
  | "storage_unavailable";

export class AssetError extends Error {
  readonly code: AssetErrorCode;
  /** Extra facts for a log line. Never rendered to the founder. */
  readonly details: Readonly<Record<string, string | number | boolean | null>>;

  constructor(
    code: AssetErrorCode,
    message: string,
    details: Readonly<Record<string, string | number | boolean | null>> = {},
  ) {
    super(message);
    this.name = "AssetError";
    this.code = code;
    this.details = details;
  }
}

export function isAssetError(value: unknown): value is AssetError {
  return value instanceof AssetError;
}
