/**
 * What the inbox reads from the environment, in one place.
 *
 *   MAIL_PROVIDER          how mail is sent: "log" (the default) or "resend"
 *   RESEND_API_KEY         Resend's key, for sending and for fetching mail
 *                          Resend received for us
 *   RESEND_WEBHOOK_SECRET  the `whsec_…` secret Resend signs its webhooks with
 *   MAIL_INBOUND_SECRET    the bearer secret for POST /api/mail/inbound
 *   MAIL_TOKEN_SECRET      the key reply addresses are signed with (token.ts)
 *
 * A secret that is missing, or too short to be one, shuts the door it guards.
 * Nothing here ever returns a secret to a screen: the `…State` functions say
 * only whether one is set.
 */

import { MIN_SECRET_LENGTH } from "./token";

type Env = Record<string, string | undefined>;

export type SecretState = "set" | "too-short" | "missing";

function stateOf(value: string | undefined): SecretState {
  const secret = (value ?? "").trim();
  if (secret === "") return "missing";
  return secret.length >= MIN_SECRET_LENGTH ? "set" : "too-short";
}

export function inboundSecretState(env: Env = process.env): SecretState {
  return stateOf(env.MAIL_INBOUND_SECRET);
}

/** The inbound bearer secret, or null when the endpoint must stay shut. */
export function inboundSecret(env: Env = process.env): string | null {
  return inboundSecretState(env) === "set"
    ? (env.MAIL_INBOUND_SECRET ?? "").trim()
    : null;
}

export function resendWebhookSecretState(env: Env = process.env): SecretState {
  return stateOf(env.RESEND_WEBHOOK_SECRET);
}

/** Resend's webhook secret, or null when that endpoint must stay shut. */
export function resendWebhookSecret(env: Env = process.env): string | null {
  return resendWebhookSecretState(env) === "set"
    ? (env.RESEND_WEBHOOK_SECRET ?? "").trim()
    : null;
}

export function resendApiKey(env: Env = process.env): string | null {
  const key = (env.RESEND_API_KEY ?? "").trim();
  return key === "" ? null : key;
}
