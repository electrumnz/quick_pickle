import { systemCaller } from "@/lib/backstage/core/actor";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { disputeFromStripe } from "@/lib/backstage/orders/disputes";
import { refundsFromStripe } from "@/lib/backstage/orders/outside-refunds";
import { markPaid, paymentExpired } from "@/lib/backstage/orders/payments";
import { verifyStripeSignature } from "@/lib/shop/payments/stripe";
import {
  handleStripeEvent,
  type StripeEvent,
} from "@/lib/shop/payments/stripe-events";

/**
 * Stripe's word that something happened to a payment.
 *
 * Nothing is believed until the signature has been checked against the exact
 * bytes received. After that the event is handed to
 * lib/shop/payments/stripe-events.ts, which does the deciding.
 *
 * Answers:
 *   200  taken (including "nothing for us in that one")
 *   400  not from Stripe, or not readable
 *   500  ours to fix; Stripe will send it again
 *   503  no signing secret set, so nothing can be trusted yet
 */

export const dynamic = "force-dynamic";

const plain = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });

export async function POST(request: Request): Promise<Response> {
  const secret = (process.env.STRIPE_WEBHOOK_SECRET ?? "").trim();
  if (secret === "") return plain(503, "Payments are not set up.");

  const body = await request.text();
  if (body.length > 1_000_000) return plain(400, "Too large.");
  const signed = verifyStripeSignature(
    body,
    request.headers.get("stripe-signature"),
    secret,
    Date.now(),
  );
  if (!signed) return plain(400, "Signature did not match.");

  let event: StripeEvent;
  try {
    event = JSON.parse(body) as StripeEvent;
  } catch {
    return plain(400, "Not JSON.");
  }

  const stripe = systemCaller("Stripe", "webhook");
  try {
    const outcome = await handleStripeEvent(event, {
      markPaid: (input) => execute(markPaid, input, stripe),
      closeUnpaid: (input) => execute(paymentExpired, input, stripe),
      seeRefunds: (input) => refundsFromStripe(input),
      seeDispute: (input) => disputeFromStripe(input),
    });
    return Response.json(
      { received: true, action: outcome.action },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    // An order we have never heard of is not something a retry will fix.
    if (error instanceof OpError && error.code === "not_found") {
      return Response.json(
        { received: true, action: "ignored" },
        { headers: { "cache-control": "no-store" } },
      );
    }
    console.error(
      JSON.stringify({
        event: "stripe.webhook_failed",
        type: typeof event.type === "string" ? event.type : null,
        message: error instanceof Error ? error.message : "unknown",
      }),
    );
    return plain(500, "Could not record that. Send it again.");
  }
}
