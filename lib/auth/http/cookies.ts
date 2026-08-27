/**
 * Cookie serialisation, with the `__Host-` rules enforced rather than assumed.
 *
 * The attributes on the admin session cookie are the difference between a
 * session that is hard to steal and one that is a formality, so they are
 * written out explicitly and validated at the point of construction. A future
 * change that drops `Secure` or adds a `Domain` to a `__Host-` cookie throws in
 * development instead of silently shipping a cookie a sibling subdomain can
 * overwrite.
 */

export type SameSitePolicy = "Strict" | "Lax" | "None";

export type SetCookieOptions = {
  readonly name: string;
  readonly value: string;
  readonly path: string;
  readonly maxAgeSeconds: number;
  readonly expires?: Date;
  readonly httpOnly: boolean;
  readonly secure: boolean;
  readonly sameSite: SameSitePolicy;
  readonly domain?: string;
  readonly priority?: "Low" | "Medium" | "High";
};

const HOST_PREFIX = "__Host-";

/**
 * Build one `Set-Cookie` header value.
 *
 * @throws when a `__Host-` prefixed cookie would violate the prefix's contract
 *   (`Secure`, `Path=/`, no `Domain`), which browsers enforce by silently
 *   dropping the cookie — a failure mode that is very hard to notice.
 */
export function serializeSetCookie(options: SetCookieOptions): string {
  if (options.name.startsWith(HOST_PREFIX)) {
    if (!options.secure) {
      throw new Error(`${options.name} requires the Secure attribute`);
    }
    if (options.path !== "/") {
      throw new Error(`${options.name} requires Path=/`);
    }
    if (options.domain !== undefined) {
      throw new Error(`${options.name} must not set a Domain`);
    }
  }

  const parts = [`${options.name}=${options.value}`, `Path=${options.path}`];
  if (options.domain !== undefined) parts.push(`Domain=${options.domain}`);
  parts.push(
    `Max-Age=${String(Math.max(0, Math.floor(options.maxAgeSeconds)))}`,
  );
  if (options.expires !== undefined) {
    parts.push(`Expires=${options.expires.toUTCString()}`);
  }
  if (options.httpOnly) parts.push("HttpOnly");
  if (options.secure) parts.push("Secure");
  parts.push(`SameSite=${options.sameSite}`);
  if (options.priority !== undefined) {
    parts.push(`Priority=${options.priority}`);
  }
  return parts.join("; ");
}

/** Header value that deletes a cookie, honouring the same `__Host-` rules. */
export function serializeClearCookie(
  name: string,
  options: { readonly secure: boolean; readonly sameSite: SameSitePolicy },
): string {
  return serializeSetCookie({
    name,
    value: "",
    path: "/",
    maxAgeSeconds: 0,
    expires: new Date(0),
    httpOnly: true,
    secure: options.secure,
    sameSite: options.sameSite,
  });
}

/**
 * Parse a request `Cookie` header.
 *
 * Written by hand so the handlers work against a plain `Request`, which is what
 * lets the test suite drive the real route handler rather than a stub of it.
 */
export function parseCookieHeader(
  header: string | null | undefined,
): ReadonlyMap<string, string> {
  const jar = new Map<string, string>();
  if (header === null || header === undefined || header === "") return jar;
  for (const segment of header.split(";")) {
    const separator = segment.indexOf("=");
    if (separator < 0) continue;
    const name = segment.slice(0, separator).trim();
    if (name === "") continue;
    jar.set(name, segment.slice(separator + 1).trim());
  }
  return jar;
}

/** Read one cookie from a request. */
export function readCookie(request: Request, name: string): string | undefined {
  return parseCookieHeader(request.headers.get("cookie")).get(name);
}
