import { handleInboundRaw } from "@/lib/backstage/mail/endpoints";

/**
 * Mail in, as it arrived: the request body is one whole email, and the
 * caller proves itself with the inbound secret. A Cloudflare Email Worker or
 * any other forwarder posts here. Everything it does is in
 * lib/backstage/mail/endpoints.ts.
 */

export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleInboundRaw(request);
}
