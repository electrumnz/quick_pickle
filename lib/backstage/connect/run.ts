/**
 * Running an operation for a bot.
 *
 * A bot names an operation and hands over what to give it. What happens
 * next depends on what the operation does, and on nothing the bot says:
 *
 *   look    it only reads, so it is run.
 *   change  it changes something inside the back end, so it is run, and the
 *           activity log says the bot did it.
 *   ask     it sends, publishes or cannot be undone, so it is NOT run. What
 *           it would do is written down for a person to say yes or no to
 *           (./approvals.ts), and the bot is told it is waiting.
 *
 * The same checks as for anybody else come first: the operation has to be
 * one a bot is offered (./catalogue.ts), what it was handed has to make
 * sense, and the connection's role has to allow it. A request that could
 * never run is refused on the spot and never put in front of a person.
 */

import "server-only";

import { z } from "zod";

import { siteUrl } from "@/lib/site";

import { can, type Caller } from "../core/actor";
import { OpError } from "../core/errors";
import { execute, type ExecuteOptions, type Op } from "../core/op";
import { askApproval } from "./approvals";
import { kindOf, offeredOp } from "./catalogue";

/** The most a bot may do in one go. */
export const MOST_CALLS = 10;
/** The most that is handed back for one call, in letters. */
export const MOST_ANSWER = 60_000;

export type Call = { readonly op: string; readonly input?: unknown };

export type Outcome =
  | { readonly op: string; readonly ok: true; readonly result: unknown }
  | {
      readonly op: string;
      readonly ok: true;
      /** It was not done. A person has been asked. */
      readonly waitingForAPerson: {
        readonly approval: string;
        /** What it would do, as the person will read it. */
        readonly says: string;
        /** Where they say yes or no. */
        readonly decideAt: string;
        readonly note: string;
      };
    }
  | {
      readonly op: string;
      readonly ok: false;
      readonly error: {
        readonly code: string;
        readonly message: string;
        readonly fields?: Readonly<Record<string, string>>;
      };
    }
  | {
      readonly op: string;
      readonly ok: false;
      /** An earlier change in the same go failed, so this was not tried. */
      readonly notTried: true;
    };

const refusal = (op: string, error: OpError): Outcome => ({
  op,
  ok: false,
  error: {
    code: error.code,
    message: error.message,
    ...(Object.keys(error.fields).length === 0 ? {} : { fields: error.fields }),
  },
});

const noSuch = (name: string) =>
  new OpError(
    "not_found",
    `There is no operation called "${name}" here. Use find to see what there is.`,
  );

function fieldErrors(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length === 0 ? "_" : issue.path.join(".");
    if (!(key in out)) out[key] = issue.message;
  }
  return out;
}

/** What came back, if it is small enough to hand to a bot. */
function fitted(op: string, result: unknown): Outcome {
  const size = (JSON.stringify(result ?? null) ?? "").length;
  if (size <= MOST_ANSWER) return { op, ok: true, result: result ?? null };
  return {
    op,
    ok: false,
    error: {
      code: "too_much",
      message: `That came to ${String(size)} letters, which is more than fits in one answer. Ask for less: a smaller limit, or a narrower search.`,
    },
  };
}

/** Where a person decides on one request. */
export const decideAt = (approvalId: string) =>
  `${siteUrl()}/backstage/approvals/${approvalId}`;

async function ask(
  op: Op,
  call: Call,
  caller: Caller,
  connectionId: string,
  options: ExecuteOptions,
): Promise<Outcome> {
  // Everything that would stop it running is checked now, so a person is
  // never asked to say yes to something that cannot be done.
  const parsed = op.input.safeParse(call.input ?? {});
  if (!parsed.success) {
    throw new OpError(
      "invalid_input",
      "Some of that does not look right.",
      fieldErrors(parsed.error),
    );
  }
  if (!can(caller.actor, op.access)) {
    throw new OpError(
      "forbidden",
      "This connection can look but not change things.",
    );
  }
  const says =
    op.explain?.(parsed.data) ??
    `${op.title}. This ${op.effect === "destructive" ? "cannot be undone" : "reaches outside the back end"}.`;
  const raw = call.input ?? {};
  const asked = await execute(
    askApproval,
    {
      operation: op.name,
      input:
        typeof raw === "object" && raw !== null && !Array.isArray(raw)
          ? (raw as Record<string, unknown>)
          : {},
      says: says.slice(0, 2000),
      connectionId,
    },
    caller,
    options,
  );
  return {
    op: op.name,
    ok: true,
    waitingForAPerson: {
      approval: asked.id,
      says,
      decideAt: decideAt(asked.id),
      note: "Nothing has been done. This needs a person's yes, given in the back end and not in this chat. Give them the link, then read approvals.get with this id to see what they decided and how it went.",
    },
  };
}

/**
 * Run what a bot asked for, in order.
 *
 * `how` is the tool it came in by: `look` runs only operations that read,
 * `change` only ones that change. Looking goes on after a refusal, because
 * one look does not depend on another. Changing stops at the first thing
 * that fails, and says the rest was not tried.
 */
export async function runForBot(
  how: "look" | "change",
  calls: readonly Call[],
  caller: Caller,
  connectionId: string,
  options: ExecuteOptions = {},
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  let stopped = false;
  for (const call of calls.slice(0, MOST_CALLS)) {
    if (stopped) {
      outcomes.push({ op: call.op, ok: false, notTried: true });
      continue;
    }
    try {
      const op = offeredOp(call.op);
      if (op === null) throw noSuch(call.op);
      const kind = kindOf(op);
      if (how === "look" && kind !== "look") {
        throw new OpError(
          "invalid_input",
          `${op.name} changes things. Use the change tool for it.`,
        );
      }
      if (how === "change" && kind === "look") {
        throw new OpError(
          "invalid_input",
          `${op.name} only reads. Use the look tool for it.`,
        );
      }
      if (kind === "ask") {
        outcomes.push(await ask(op, call, caller, connectionId, options));
        continue;
      }
      // Never with a yes: `caller.confirmed` is not set for a connection.
      const result = await execute(op, call.input ?? {}, caller, options);
      outcomes.push(fitted(op.name, result));
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      outcomes.push(refusal(call.op, error));
      if (how === "change") stopped = true;
    }
  }
  return outcomes;
}
