import { handleResendWebhook } from "@/lib/backstage/mail/endpoints";

/**
 * Resend's webhook: mail it received for us, and what became of mail we
 * sent. The signature is checked before anything is read. Everything it does
 * is in lib/backstage/mail/endpoints.ts.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleResendWebhook(request);
}
