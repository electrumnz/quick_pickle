/**
 * Identify the client address for the per-IP budget.
 *
 * Forwarded-for headers are attacker-controlled unless something in front of
 * the app rewrites them. Behind Vercel they are rewritten, so they are believed
 * there and nowhere else; `ADMIN_TRUST_PROXY_HEADERS` makes that explicit for
 * any other deployment.
 *
 * Spoofing is survivable rather than fatal: rotating the header only moves an
 * attacker between per-IP buckets, and the global budget — which has no subject
 * to rotate — still counts every one of those attempts. That is the reason the
 * global budget exists.
 *
 * A value that is not a syntactically valid address is discarded rather than
 * stored: `admin_sessions.ip_address` and `audit_log.ip_address` are `inet`
 * columns, and letting unvalidated header text reach them is how you turn a
 * header into a database error.
 */

const IPV4 =
  /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const IPV6 = /^[0-9a-fA-F:]+$/;

/** Subject used when no address could be determined. */
export const UNKNOWN_IP_SUBJECT = "unknown";

/** True when `value` is a usable IPv4 or IPv6 literal. */
export function isIpLiteral(value: string): boolean {
  if (IPV4.test(value)) return true;
  return (
    IPV6.test(value) &&
    value.includes(":") &&
    value.length <= 45 &&
    !value.includes(":::")
  );
}

function firstAddress(header: string | null): string | null {
  if (header === null) return null;
  for (const candidate of header.split(",")) {
    const trimmed = candidate.trim().replace(/^\[|]$/g, "");
    if (trimmed !== "" && isIpLiteral(trimmed)) return trimmed;
  }
  return null;
}

/** The client address, or null when it cannot be established. */
export function resolveClientIp(
  headers: Headers,
  trustProxyHeaders: boolean,
): string | null {
  if (!trustProxyHeaders) return null;
  return (
    firstAddress(headers.get("x-vercel-forwarded-for")) ??
    firstAddress(headers.get("x-real-ip")) ??
    firstAddress(headers.get("x-forwarded-for"))
  );
}

/**
 * The per-IP throttle subject.
 *
 * Unidentifiable clients share the single `unknown` bucket rather than getting
 * a free pass, so a stripped header is a worse position for an attacker than a
 * present one.
 */
export function clientIpSubject(ipAddress: string | null): string {
  return ipAddress ?? UNKNOWN_IP_SUBJECT;
}
