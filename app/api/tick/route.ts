import { createHash, timingSafeEqual } from "node:crypto";

import { tick } from "@/lib/backstage/clock/tick";

/**
 * The request that arrives on a timer.
 *
 * Whatever is calling (the database's own scheduler, the host's cron) sends
 * `Authorization: Bearer <CRON_SECRET>`. With no secret set, nobody gets in:
 * an open tick is a free way to make the site do work.
 *
 * Answers:
 *   200  ran. Counts only in the reply, never a name or an order number.
 *   401  wrong or missing secret
 *   500  it failed part-way; the next tick picks up what is left
 *   503  no secret set
 */

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const digest = (value: string) => createHash("sha256").update(value).digest();

async function handle(request: Request): Promise<Response> {
  const secret = (process.env.CRON_SECRET ?? "").trim();
  if (secret.length < 16)
    return reply(503, { error: "The clock is not set up." });

  const header = request.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  // Compared as digests so that neither the length nor the timing says
  // anything about the secret.
  if (!timingSafeEqual(digest(given), digest(secret))) {
    return reply(401, { error: "Not allowed." });
  }

  try {
    return reply(200, await tick());
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "clock.tick_failed",
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return reply(500, { error: "The tick failed." });
  }
}

export const GET = handle;
export const POST = handle;
