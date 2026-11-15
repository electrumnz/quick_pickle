/**
 * Sending a campaign's emails.
 *
 * `campaigns.send` lines the emails up, one row a person, and sends nothing
 * (campaigns.ts). This is what sends them. A round takes the next few off a
 * campaign's queue, hands each to the mail seam (lib/mail), and reports back
 * how it went.
 *
 * Who runs a round:
 *
 *   - the clock, on every tick (lib/backstage/clock/tick.ts), which is also
 *     what queues a campaign that was given a time;
 *   - a listener on `campaign.send_requested`, so the first few go as soon
 *     as somebody presses send.
 *
 * The rules a round keeps:
 *
 *   - It is paced. A mail provider only takes a couple of emails a second,
 *     so a round sends a few dozen and a big list goes out over several
 *     rounds. Nothing in the product may promise when the last one lands.
 *   - One email is one email. Each carries its own id as the key the
 *     provider is given, and the provider remembers a key for a day. So two
 *     rounds at once, or a round that died between handing an email over
 *     and writing that down, cannot send anybody a second copy: the next
 *     round hands it over again and is given the same answer.
 *   - Nothing is tried again on a guess. A try that got no clear answer
 *     (the provider did not reply, or replied with a fault of its own) is
 *     written on that email with the time. It is tried again inside the
 *     day, when a repeat is safe, and after that it is set aside and says
 *     it may have arrived. The same goes for one the provider says it has
 *     already been handed in other words.
 *   - A person is only written down as failed for a reason that is theirs:
 *     they left the list, their address is on the do-not-email list, or
 *     the provider will not take that one address. When the provider is
 *     busy, or refuses us (a wrong key, a domain not set up), nobody is
 *     marked: the round stops, the rest wait, and the campaign says why
 *     (`campaigns.noteTrouble`). They go by themselves once it is put
 *     right. A refusal is taken to be about one person only when an email
 *     either side of it went: two refusals running are about us.
 *   - A provider that is only busy is nobody's problem yet. Being asked to
 *     slow down is ordinary, and the next round goes. It is said on the
 *     campaign and on Today only once the campaign has got nowhere for
 *     twenty minutes.
 *   - The finished email is read against the copy rules before the first
 *     one goes, with the footer on it, the way every other email is. Only
 *     the restricted phrases a person read when they approved it are let
 *     through.
 *   - On invented records nothing is sent, and each email is written down
 *     as not sent with the reason, like every email there. With real
 *     records and no way to send, a campaign cannot be queued at all; if
 *     the way out goes while one is under way, the rest wait.
 */

import "server-only";

import { asc, eq } from "drizzle-orm";

import { campaigns, type CopyCheck } from "@/db/schema";
import { databaseUrl } from "@/lib/db/client";
import type { Db } from "@/lib/db/types";
import { mailConnection, sendMail } from "@/lib/mail";
import { scrubSecrets } from "@/lib/mail/resend";
import { MailSendError } from "@/lib/mail/types";

import { SAFE_RETRY_MS } from "../mail/outbound";

import { systemCaller } from "../core/actor";
import { refuseUnsendable } from "../core/copy";
import { OpError } from "../core/errors";
import type { Handler } from "../core/events";
import { execute } from "../core/op";
import { readShop } from "../shop/ops";
import {
  campaignQueue,
  findCampaignSend,
  markCampaignSends,
  noteCampaignTrouble,
  runDueCampaigns,
  type QueuedRecipient,
} from "./campaigns";
import { restrictedIn } from "./copy-check";
import { renderCampaignEmail, type RenderedEmail } from "./email";
import { campaignSender, whyNoWayOut, type CampaignSender } from "./sender";

type Env = Record<string, string | undefined>;

/** The most emails one round of the clock sends. */
export const PER_ROUND = 30;
/** The most the round that starts as somebody presses send does. */
export const FIRST_FEW = 5;
/** The gap left between two emails: a provider takes about two a second. */
export const PACE_MS = 550;
/** A round stops starting new emails once it has run this long. */
export const ROUND_MS = 25_000;
/**
 * How long a provider may be busy before anybody is told. A provider that
 * asks us to slow down, or drops one call, is ordinary: the next round goes.
 * Only once a campaign has got nowhere for this long does it say so on its
 * page and on Today.
 */
export const BUSY_GRACE_MS = 20 * 60_000;

const mailSystem = systemCaller("The mail system", "automation");

/** Written on an email whose earlier try may have gone, once it is too late. */
export const MAY_HAVE_GONE =
  "We could not tell whether this one went, and it is too late to try again safely. It may have arrived.";
/** Written on one the provider already holds under its key, in other words. */
export const ALREADY_HANDED =
  "The mail provider had already been handed this one, so it was not sent again. It may have arrived.";

export type RoundOptions = {
  readonly env?: Env;
  readonly fetch?: typeof fetch;
  /** The most emails this round may hand to the provider. */
  readonly most?: number;
  /** The gap between two emails, in milliseconds. Tests pass 0. */
  readonly paceMs?: number;
  /** How long the round may run before it stops starting emails. */
  readonly budgetMs?: number;
};

export type Round = {
  /** Campaigns that were being sent when the round started. */
  readonly campaigns: number;
  readonly sent: number;
  /** Written down as not sent: left the list, do-not-email, or no way out. */
  readonly failed: number;
  /** Why the round stopped early, if it did. */
  readonly stopped: string | null;
};

const NOTHING: Round = { campaigns: 0, sent: 0, failed: 0, stopped: null };

const pause = (ms: number) =>
  ms <= 0
    ? Promise.resolve()
    : new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What a provider said, made safe to keep and to show. */
const said = (error: unknown): string =>
  scrubSecrets(error instanceof Error ? error.message : "It could not be sent.")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || "It could not be sent.";

/** The restricted rules a person read when they approved the campaign. */
const readAtApproval = (check: CopyCheck | null): string[] => [
  ...new Set(restrictedIn(check).map((finding) => finding.rule)),
];

type Result = {
  email: string;
  status: "sent" | "failed";
  providerId?: string;
  error?: string;
};

/** Why one campaign's part of a round ended before its queue did. */
type Stop =
  /** The campaign has stopped itself: too many bounces or complaints. */
  | { readonly kind: "held"; readonly why: string }
  /** This campaign cannot go as it is written. */
  | { readonly kind: "words"; readonly why: string }
  /** Nothing can be sent just now, whichever campaign it is. */
  | { readonly kind: "ours"; readonly why: string };

type Room = {
  /** Emails the round may still hand to the provider. */
  left: number;
  /** Something has been handed over this round, so the next one waits. */
  paced: boolean;
  /** Something has gone this round, so the provider is taking our mail. */
  going: boolean;
  /** The clock time the round stops starting emails at. */
  readonly until: number;
};

/**
 * One campaign's part of a round: take the next few off its queue, hand
 * each over, and report back. Stops when the round's room runs out.
 */
async function sendSome(
  db: Db,
  now: Date,
  campaignId: string,
  who: CampaignSender,
  room: Room,
  options: RoundOptions,
): Promise<{ sent: number; failed: number; stop: Stop | null }> {
  const at = { db, now };
  const env = options.env ?? process.env;
  const paceMs = options.paceMs ?? PACE_MS;
  let sent = 0;
  let failed = 0;

  const trouble = async (why: string | null, doubted?: string) => {
    await execute(
      noteCampaignTrouble,
      {
        campaignId,
        trouble: why,
        ...(doubted === undefined ? {} : { doubted }),
      },
      mailSystem,
      at,
    );
  };
  const report = async (results: readonly Result[]) => {
    if (results.length === 0) return;
    await execute(
      markCampaignSends,
      { campaignId, results: [...results] },
      mailSystem,
      at,
    );
    sent += results.filter((result) => result.status === "sent").length;
    failed += results.filter((result) => result.status === "failed").length;
  };
  const stopFor = async (why: string, doubted?: string): Promise<Stop> => {
    await trouble(why, doubted);
    return { kind: "ours", why };
  };

  // The whole of a campaign is read once a round, as it would reach
  // somebody whose name we do not know.
  let read = false;
  // A refusal waiting to be judged by its neighbour: theirs if the next
  // email goes, ours if the next is refused too.
  let doubted: Result | null = null;

  while (room.left > 0 && Date.now() < room.until) {
    const queue = await execute(
      campaignQueue,
      { id: campaignId, limit: Math.min(room.left, 50) },
      mailSystem,
      at,
    );
    if (queue.held !== null) {
      return { sent, failed, stop: { kind: "held", why: queue.held } };
    }
    if (queue.recipients.length === 0) break;

    const connection = mailConnection(env);
    if (!connection.delivers) {
      // With real records behind it, they wait for a way out.
      if (databaseUrl(env) !== null) {
        return { sent, failed, stop: await stopFor(whyNoWayOut(env)) };
      }
      // On invented records there is nobody real to email. Say so on each,
      // so the campaign finishes and nobody thinks it went.
      const why =
        connection.held ?? connection.problem ?? "Email is not sent from here.";
      await report(
        queue.recipients.map((person) => ({
          email: person.email,
          status: "failed" as const,
          error: why,
        })),
      );
      continue;
    }
    if (!who.ok) return { sent, failed, stop: await stopFor(who.why) };
    if (!read) {
      read = true;
      const refusal = whyNotAsWritten(queue.campaign, who);
      if (refusal !== null) {
        await trouble(refusal);
        return { sent, failed, stop: { kind: "words", why: refusal } };
      }
    }

    const results: Result[] = [];
    let stop: string | null = null;
    // The address whose try got no clear answer, if that is why it stopped.
    let unsure: string | undefined;
    // It stopped because the provider is busy, and for no other reason.
    let busy = false;
    // Somebody else is sending this campaign at this moment.
    let elsewhere = false;
    for (const person of queue.recipients) {
      if (room.left <= 0 || Date.now() >= room.until) break;
      if (!person.deliverable) {
        results.push({
          email: person.email,
          status: "failed",
          error: person.reason ?? "Not on the list any more.",
        });
        continue;
      }
      // An earlier try may have gone, and the provider has forgotten the
      // key by now: a repeat could be a second copy. Not on a guess.
      if (
        person.doubtedAt !== null &&
        now.getTime() - person.doubtedAt.getTime() > SAFE_RETRY_MS
      ) {
        results.push({
          email: person.email,
          status: "failed",
          error: MAY_HAVE_GONE,
        });
        continue;
      }
      let email: RenderedEmail;
      try {
        email = renderCampaignEmail(queue.campaign, person, who.sender);
      } catch (error) {
        // Theirs alone: no way for this person to unsubscribe.
        results.push({
          email: person.email,
          status: "failed",
          error: said(error),
        });
        continue;
      }
      if (room.paced) await pause(paceMs);
      room.paced = true;
      room.left -= 1;
      const outcome = await handOver(email, person, who, {
        env,
        fetch: options.fetch,
      });
      if (outcome.kind === "sent") {
        room.going = true;
        // The one before was refused and this one went: that was theirs.
        if (doubted !== null) results.push(doubted);
        doubted = null;
        results.push({
          email: person.email,
          status: "sent",
          providerId: outcome.providerId,
        });
        continue;
      }
      if (outcome.kind === "theirs") {
        results.push({
          email: person.email,
          status: "failed",
          error: outcome.why,
        });
        continue;
      }
      if (outcome.kind === "refused") {
        if (doubted === null) {
          doubted = {
            email: person.email,
            status: "failed",
            error: outcome.why,
          };
          continue;
        }
        // Two running. That is about us, and neither is marked.
        doubted = null;
        stop = `The mail provider is refusing our emails: ${outcome.why}`;
        break;
      }
      if (outcome.kind === "elsewhere") {
        // Another round has this very email in hand. It will say how it
        // went; this one has nothing to add, and nothing is wrong.
        elsewhere = true;
        break;
      }
      // Busy, or it will take nothing from us. Nobody is marked for that.
      stop = outcome.why;
      busy = outcome.busy;
      if (outcome.unsure) unsure = person.email;
      break;
    }

    // A refusal with nothing after it to judge it by: theirs if anything
    // has gone this round, and otherwise left waiting, with the reason.
    if (stop === null && doubted !== null) {
      if (room.going) results.push(doubted);
      else stop = `The mail provider would not take it: ${doubted.error ?? ""}`;
      doubted = null;
    }

    await report(results);
    if (stop !== null) {
      // Only busy, and it got somewhere not long ago (or has only just been
      // queued): the round stops and nobody is told. What was said before
      // stands, and an email that may have gone is still written down.
      const movedAt = sent > 0 ? now : queue.movedAt;
      const quiet =
        busy &&
        movedAt !== null &&
        now.getTime() - movedAt.getTime() < BUSY_GRACE_MS;
      if (quiet) {
        if (unsure !== undefined) await trouble(queue.trouble, unsure);
        return { sent, failed, stop: { kind: "ours", why: stop } };
      }
      return { sent, failed, stop: await stopFor(stop, unsure) };
    }
    // Something went, so whatever was in the way last time is not any more.
    if (queue.trouble !== null && sent > 0) await trouble(null);
    if (elsewhere) break;
  }
  return { sent, failed, stop: null };
}

/** Somebody whose name we do not know, for reading a campaign as a whole. */
const NOBODY = {
  email: "nobody@example.invalid",
  firstName: null,
  unsubscribeToken: "x".repeat(32),
} as const;

/**
 * Read the finished email against the copy rules, as it would reach
 * somebody whose name we do not know. Null when it may go.
 */
function whyNotAsWritten(
  campaign: {
    readonly id: string;
    readonly subject: string;
    readonly preheader: string;
    readonly body: string;
    readonly copyCheck: CopyCheck | null;
  },
  who: Extract<CampaignSender, { ok: true }>,
): string | null {
  let sample: RenderedEmail;
  try {
    // Built once with the real details, so that an email which could not
    // lawfully go (nobody to reach, no address of the shop's) says so here.
    renderCampaignEmail(campaign, NOBODY, who.sender);
    // And read with a stand-in for them. Who the company is and where it
    // lives are facts about us, not words of ours: they are not put
    // through the copy rules, the way a customer's own address is not.
    sample = renderCampaignEmail(campaign, NOBODY, {
      ...who.sender,
      contactLine: "-",
    });
  } catch (error) {
    return said(error);
  }
  try {
    refuseUnsendable(
      {
        subject: sample.subject,
        preheader: campaign.preheader,
        body: sample.text,
      },
      { checked: readAtApproval(campaign.copyCheck) },
    );
    return null;
  } catch (error) {
    if (error instanceof OpError) return error.message.slice(0, 380);
    throw error;
  }
}

type HandedOver =
  | { readonly kind: "sent"; readonly providerId: string }
  /** This one email cannot go, for a reason that is this person's. */
  | { readonly kind: "theirs"; readonly why: string }
  /**
   * The provider read it and said no. About this one address, or about us:
   * there is no telling from one answer, so the next one decides.
   */
  | { readonly kind: "refused"; readonly why: string }
  /** Another round is handing this very email over at this moment. */
  | { readonly kind: "elsewhere" }
  /**
   * Nothing can go just now, or nothing of ours will be taken. `busy` when
   * it is worth trying again as it is; `unsure` when there was no clear
   * answer, so this one email may have gone.
   */
  | {
      readonly kind: "ours";
      readonly why: string;
      readonly busy: boolean;
      readonly unsure: boolean;
    };

/** Answers that say the email itself was not acceptable, not who sent it. */
const ABOUT_THE_EMAIL: ReadonlySet<number> = new Set([400, 422]);

async function handOver(
  email: RenderedEmail,
  person: QueuedRecipient,
  who: Extract<CampaignSender, { ok: true }>,
  options: { readonly env: Env; readonly fetch?: typeof fetch },
): Promise<HandedOver> {
  try {
    const sent = await sendMail(
      {
        from: who.from,
        to: [{ address: person.email }],
        subject: email.subject,
        text: email.text,
        html: email.html,
        headers: email.headers,
        idempotencyKey: person.sendId,
      },
      options,
    );
    if (!sent.delivered) {
      return {
        kind: "ours",
        why:
          mailConnection(options.env).held ??
          "Email is not sent from this place.",
        busy: false,
        unsure: false,
      };
    }
    return { kind: "sent", providerId: sent.id };
  } catch (error) {
    if (error instanceof MailSendError) {
      if (error.status === 409) {
        // About the key, which the provider has seen before. Worth trying
        // again: the first request with it is still in flight, which is
        // another round of ours. Not worth it: it holds that key for an
        // email that reads differently (who we are changed in between), and
        // asking again gets the same answer for as long as it remembers.
        return error.retryable
          ? { kind: "elsewhere" }
          : { kind: "theirs", why: ALREADY_HANDED };
      }
      if (error.retryable || error.outcome === "unknown") {
        return {
          kind: "ours",
          why: "The mail provider is busy. The rest will go on the next round.",
          busy: true,
          unsure: error.outcome === "unknown",
        };
      }
      return error.status !== null && ABOUT_THE_EMAIL.has(error.status)
        ? { kind: "refused", why: said(error) }
        : {
            kind: "ours",
            why: `The mail provider would not take anything from us: ${said(error)}`,
            busy: false,
            unsure: false,
          };
    }
    // Caught before any provider saw it: the address or the name is not
    // something an email can be sent to.
    return { kind: "theirs", why: said(error) };
  }
}

/**
 * One round: queue whatever has come due, then send the next few emails of
 * every campaign that is on its way. Safe to run at any time and more than
 * once at once. With nothing being sent it costs one read.
 */
export async function deliverCampaigns(
  db: Db,
  now: Date,
  options: RoundOptions = {},
): Promise<Round> {
  const env = options.env ?? process.env;
  // A campaign given a time is queued by the clock, here.
  await runDueCampaigns({ db, now }).catch((error: unknown) => {
    console.error(
      JSON.stringify({
        event: "campaigns.due_failed",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
  });

  const sending = await db
    .select({ id: campaigns.id })
    .from(campaigns)
    .where(eq(campaigns.status, "sending"))
    .orderBy(asc(campaigns.sendAt))
    .limit(10);
  if (sending.length === 0) return NOTHING;

  const who = campaignSender((await readShop(db)).offer, env);
  const room: Room = {
    left: options.most ?? PER_ROUND,
    paced: false,
    going: false,
    until: Date.now() + (options.budgetMs ?? ROUND_MS),
  };
  let sent = 0;
  let failed = 0;
  let stopped: string | null = null;
  for (const campaign of sending) {
    const part = await sendSome(db, now, campaign.id, who, room, options);
    sent += part.sent;
    failed += part.failed;
    stopped = stopped ?? part.stop?.why ?? null;
    // What stops one campaign for a reason of ours stops the next too.
    if (part.stop?.kind === "ours") break;
  }
  return { campaigns: sending.length, sent, failed, stopped };
}

/**
 * For the event a campaign raises as it is queued: send the first few now,
 * so somebody who has just pressed send sees it start. The clock does the
 * rest. Safe to run twice, like any round.
 */
export function startCampaign(
  options: { readonly env?: Env; readonly fetch?: typeof fetch } = {},
): Handler {
  return async (_event, ctx) => {
    await deliverCampaigns(ctx.db, ctx.now, {
      ...options,
      most: FIRST_FEW,
      budgetMs: 6_000,
    });
  };
}

/* ---- what the provider says afterwards ------------------------------------ */

export type Afterwards = "bounced" | "complained" | "failed";

/**
 * Record what the mail provider says became of a campaign email after it
 * left: it bounced, the person marked it as spam, or the provider could not
 * send it after all. False when the id is not a campaign email of ours.
 *
 * A bounce that will not get better, and a complaint, also strike the
 * address off: it goes on the do-not-email list and is marked on the Pickle
 * Crew list, so it is never emailed again.
 */
export async function recordCampaignAfterwards(
  db: Db,
  now: Date,
  news: {
    readonly providerId: string;
    readonly event: Afterwards;
    /** For a bounce: the address is no good, as opposed to full or busy. */
    readonly permanent: boolean;
    readonly detail: string;
  },
): Promise<boolean> {
  const at = { db, now };
  const found = await execute(
    findCampaignSend,
    { providerId: news.providerId },
    mailSystem,
    at,
  );
  if (found === null) return false;
  // A mailbox that is full today may not be tomorrow. Nothing to record.
  if (news.event === "bounced" && !news.permanent) return true;
  await execute(
    markCampaignSends,
    {
      campaignId: found.campaignId,
      results: [
        {
          email: found.email,
          status: news.event,
          error: news.detail.slice(0, 300) || undefined,
          strike: news.event !== "failed",
        },
      ],
    },
    mailSystem,
    at,
  );
  return true;
}
