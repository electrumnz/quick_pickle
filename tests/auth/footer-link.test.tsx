import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { AdminSignOutForm } from "@/components/auth/admin-sign-out-form";
import { FooterAdminLink } from "@/components/auth/footer-admin-link";
import { LOGIN_PATH, LOGOUT_PATH } from "@/lib/auth/config";

/**
 * Discreet is a visual decision. It is not an accessibility exemption.
 *
 * The founder asked for a quiet way in, not a hidden one, and hiding it would
 * buy no security anyway: the gate's defences are argon2id, a durable lockout
 * and a sealed session, none of which depend on nobody knowing the URL. So the
 * link is small and tucked into the corner of the footer, and otherwise
 * completely ordinary — focusable, labelled, and legible.
 */
describe("footer admin link", () => {
  const markup = renderToStaticMarkup(<FooterAdminLink />);

  it("is a real anchor to the login page", () => {
    expect(markup).toContain("<a ");
    expect(markup).toContain(`href="${LOGIN_PATH}"`);
  });

  it("is keyboard reachable, with no tabindex trickery", () => {
    // A plain anchor with an href is in the tab order by construction.
    expect(markup).not.toContain("tabindex");
    expect(markup).not.toContain("aria-hidden");
    expect(markup).not.toContain("onclick");
  });

  it("is labelled for a screen reader and has visible text", () => {
    expect(markup).toContain('aria-label="Staff sign in"');
    expect(markup).toContain(">Staff<");
  });

  it("has a visible focus indicator", () => {
    expect(markup).toContain("focus-visible:ring-2");
  });

  it("is not dimmed into illegibility", () => {
    // Discreet by size and position, not by fading the contrast away. No
    // opacity class, no `sr-only`, no zero-size hit target.
    expect(markup).not.toMatch(/\bopacity-\d/);
    expect(markup).not.toContain("sr-only");
    expect(markup).not.toContain("display:none");
    expect(markup).not.toContain("visibility:hidden");
  });

  it("asks crawlers not to follow it", () => {
    expect(markup).toContain('rel="nofollow"');
  });

  it("hard-codes no colour of its own", () => {
    // Brand tokens own colour; this component only sizes and positions.
    expect(markup).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });
});

describe("sign-out form", () => {
  const markup = renderToStaticMarkup(
    <AdminSignOutForm csrfToken="token-123" />,
  );

  it("posts rather than links, and carries the session's CSRF token", () => {
    expect(markup).toContain('method="post"');
    expect(markup).toContain(`action="${LOGOUT_PATH}"`);
    expect(markup).toContain('name="csrf_token"');
    expect(markup).toContain('value="token-123"');
  });

  it("offers a sign-out-everywhere variant", () => {
    const everywhere = renderToStaticMarkup(
      <AdminSignOutForm csrfToken="token-123" everywhere />,
    );
    expect(everywhere).toContain(`action="${LOGOUT_PATH}?scope=all"`);
    expect(everywhere).toContain("Sign out everywhere");
  });
});
