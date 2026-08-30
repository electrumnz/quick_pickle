/**
 * The write side, and why it does not write to the world.
 *
 * This build is **not authorised for live outbound**. No agent in this roster
 * has a tool that posts to a real account, sends a real email, or places a real
 * order with a real supplier. Every non-read tool ends here instead: the action
 * is recorded, exactly as it was approved, and the receipt says so in words that
 * end up in the run transcript the founder reads.
 *
 * That is a deliberate second line, not the first one. The first line is the
 * runtime: `storefront_write` and `external` tools cannot execute at all without
 * an `approvals` row in an approved state covering those exact arguments. The
 * outbox is what sits behind the gate once it opens, and today it is a
 * notebook. Wiring a real channel means implementing {@link DraftSink} against
 * that channel and nothing else — no role changes, no new authorisation rule.
 */

import { looksLikeEmail, redact, redactJson } from "../boundary/outbound";
import type { JsonObject, JsonValue } from "../json";

/** What kind of write this is. One per non-read tool in the roster. */
export type OutboxKind =
  | "note"
  | "draft"
  | "account_note"
  | "product_concept"
  | "social_post"
  | "customer_reply"
  | "trade_outreach"
  | "campaign_email"
  | "supplier_order"
  | "price_change";

/** One write, as the tool hands it over. */
export interface OutboxEntry {
  readonly kind: OutboxKind;
  /** Stable handle for the thing written: a slug, an account, a SKU. */
  readonly reference: string;
  /** One line for the founder. */
  readonly summary: string;
  /** Everything needed to carry the action out for real, later. */
  readonly payload: JsonObject;
  /** Money at stake, when there is any. */
  readonly amountCents?: number;
}

/** What the tool returns to the agent, and therefore what the transcript holds. */
export interface OutboxReceipt {
  readonly recorded: true;
  readonly kind: string;
  readonly reference: string;
  readonly at: string;
  readonly delivered: false;
  readonly note: string;
}

export interface DraftSink {
  write(entry: OutboxEntry, at: Date): Promise<OutboxReceipt>;
}

const NOT_SENT =
  "Recorded, not sent. This deployment has no live outbound channel wired: " +
  "the approved action is written down so it can be carried out by a person, " +
  "or by a channel adapter that does not exist yet.";

/** The outbox everything currently ends in. Records; never delivers. */
export class RecordingOutbox implements DraftSink {
  private readonly written: (OutboxEntry & { readonly at: string })[] = [];

  async write(entry: OutboxEntry, at: Date): Promise<OutboxReceipt> {
    const stamped = { ...entry, at: at.toISOString() };
    this.written.push(stamped);
    return {
      recorded: true,
      kind: entry.kind,
      reference: entry.reference,
      at: stamped.at,
      delivered: false,
      note: NOT_SENT,
    };
  }

  /** Everything written, in order. Read by the tests and the evidence runs. */
  entries(): readonly (OutboxEntry & { readonly at: string })[] {
    return [...this.written];
  }

  /** Everything written of one kind. */
  of(kind: OutboxKind): readonly OutboxEntry[] {
    return this.written.filter((entry) => entry.kind === kind);
  }

  /** How many external-effect writes actually happened. */
  externalCount(): number {
    const external: readonly OutboxKind[] = [
      "social_post",
      "customer_reply",
      "trade_outreach",
      "campaign_email",
      "supplier_order",
    ];
    return this.written.filter((entry) => external.includes(entry.kind)).length;
  }
}

/**
 * Payload keys that hold the address a send is *for*.
 *
 * These are the one exemption from redaction, and the reason is delivery: a
 * `customer_reply` whose `to` reads `[redacted:email]` is a draft nobody can
 * ever send. Every other address in the same entry — one customer's address
 * quoted into another's copy, a list scraped into a campaign body — is scrubbed.
 * Only values that are themselves a bare address are honoured, so a credential
 * cannot be smuggled out by putting it in a routing field.
 */
export const OUTBOX_ADDRESS_KEYS: readonly string[] = ["to"];

function addressesIn(payload: JsonObject): readonly string[] {
  const found: string[] = [];
  for (const key of OUTBOX_ADDRESS_KEYS) {
    const value: JsonValue | undefined = payload[key];
    if (typeof value === "string" && looksLikeEmail(value)) {
      found.push(value.trim());
    }
  }
  return found;
}

/**
 * Scrub an entry on its way into a sink.
 *
 * Wrapping the port rather than editing {@link RecordingOutbox} is the whole
 * point: the wrapping happens once, where the roster's tools are handed their
 * outbox, so a real channel adapter written next year inherits the scrubber
 * instead of having to remember it. That was the gap — `grep -rni "redact"
 * lib/agents` returned nothing.
 */
export function redactingSink(inner: DraftSink): DraftSink {
  return {
    async write(entry: OutboxEntry, at: Date): Promise<OutboxReceipt> {
      const allow = addressesIn(entry.payload);
      const payload = redactJson(entry.payload, { allow });
      const scrubbed: OutboxEntry = {
        ...entry,
        reference: redact(entry.reference, { allow }),
        summary: redact(entry.summary, { allow }),
        payload:
          payload !== null &&
          typeof payload === "object" &&
          !Array.isArray(payload)
            ? payload
            : entry.payload,
      };
      return inner.write(scrubbed, at);
    },
  };
}
