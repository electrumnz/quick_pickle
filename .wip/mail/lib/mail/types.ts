/**
 * The shape of an email on its way out, and of what comes back from sending
 * it. Shared by the seam (index.ts) and the providers behind it.
 */

export type MailAddress = {
  readonly address: string;
  readonly name?: string;
};

export type OutgoingAttachment = {
  readonly filename: string;
  readonly contentType: string;
  readonly bytes: Uint8Array;
};

export type OutgoingMail = {
  readonly from: MailAddress;
  readonly to: readonly MailAddress[];
  readonly cc?: readonly MailAddress[];
  readonly replyTo?: MailAddress;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  /** In-Reply-To, References, List-Unsubscribe and the like. */
  readonly headers?: Readonly<Record<string, string>>;
  /**
   * Our own Message-ID, angle brackets and all. It is passed on where the
   * provider allows it. Some replace it with their own, so nothing may
   * depend on the recipient seeing this one.
   */
  readonly messageId?: string;
  readonly attachments?: readonly OutgoingAttachment[];
  /** The same key twice is the same email, and is sent once. */
  readonly idempotencyKey: string;
};

export type SendResult = {
  readonly provider: string;
  /** The provider's own id for the email. */
  readonly id: string;
  /**
   * The Message-ID the email really went out with, when the provider says.
   * Replies name this one, so whoever keeps the record keeps this too.
   */
  readonly messageId?: string;
  /** False when nothing left: it was recorded and not sent. */
  readonly delivered: boolean;
};

export type MailProvider = {
  readonly name: string;
  /** False when nothing actually leaves. Screens read this. */
  readonly delivers: boolean;
  send(mail: OutgoingMail): Promise<SendResult>;
};

/**
 * What became of an email whose send did not come back clean.
 *
 *   refused  the provider answered and said no. It did not go.
 *   unknown  the provider never answered, or answered with a fault of its
 *            own. It may have gone. Sending it again is only safe while the
 *            provider still remembers the idempotency key.
 */
export type SendOutcome = "refused" | "unknown";

/** An email the provider would not take, or could not be reached to take. */
export class MailSendError extends Error {
  readonly provider: string;
  /** The HTTP status, or null if the provider never answered. */
  readonly status: number | null;
  /** Worth trying again later: a timeout, a rate limit, their fault not ours. */
  readonly retryable: boolean;
  readonly outcome: SendOutcome;

  constructor(
    message: string,
    details: {
      readonly provider: string;
      readonly status: number | null;
      readonly retryable: boolean;
      readonly outcome?: SendOutcome;
    },
  ) {
    super(message);
    this.name = "MailSendError";
    this.provider = details.provider;
    this.status = details.status;
    this.retryable = details.retryable;
    this.outcome =
      details.outcome ??
      (details.status === null || details.status >= 500
        ? "unknown"
        : "refused");
  }
}
