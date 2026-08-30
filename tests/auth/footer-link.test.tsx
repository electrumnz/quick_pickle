import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AdminSignOutForm } from "@/components/auth/admin-sign-out-form";
import { FooterAdminLink } from "@/components/auth/footer-admin-link";
import { ADMIN_ROOT_PATH, LOGIN_PATH, LOGOUT_PATH } from "@/lib/auth/config";
import { DEMO_ENV_VAR } from "@/lib/demo/mode";

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
  // Rendered with the demo switch off, which is the default everywhere: this
  // whole block is the live-deployment link and must not move when the demo
  // variant beneath it does.
  vi.stubEnv(DEMO_ENV_VAR, undefined);
  const markup = renderToStaticMarkup(<FooterAdminLink />);
  vi.unstubAllEnvs();

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

/**
 * The same link on a demonstration deployment.
 *
 * Discretion is exactly backwards there. Every row is invented, the admin is
 * the half worth looking at, and `isDemoMode()` has already opened it — so the
 * footer offers a labelled control that goes straight to `/admin`. What it must
 * not do is imply a password prompt it will not show, or a password it might
 * hand over.
 */
describe("footer admin link on a demonstration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function demoMarkup(): string {
    vi.stubEnv(DEMO_ENV_VAR, "1");
    return renderToStaticMarkup(<FooterAdminLink className="min-h-[44px]" />);
  }

  it("goes to the admin itself, not to a sign-in it will not ask for", () => {
    const markup = demoMarkup();
    expect(markup).toContain(`href="${ADMIN_ROOT_PATH}"`);
    expect(markup).not.toContain(`href="${LOGIN_PATH}"`);
  });

  it("says where it goes, in words, without promising a password", () => {
    const markup = demoMarkup();
    expect(markup).toContain(">Open the admin<");
    expect(markup.toLowerCase()).not.toContain("sign in");
    // Nothing that looks like a credential is anywhere near this component.
    expect(markup.toLowerCase()).not.toMatch(/password\s*[:=]/);
  });

  it("keeps its label, its focus ring and the class its caller sizes it with", () => {
    const markup = demoMarkup();
    expect(markup).toContain("aria-label=");
    expect(markup).toContain("focus-visible:ring-2");
    expect(markup).toContain("min-h-[44px]");
  });

  it("is a plain anchor at every width, with no responsive hiding", () => {
    const markup = demoMarkup();
    // The masthead nav shipped `hidden md:block` once and left a phone with no
    // navigation at all. Nothing in this component is allowed a width.
    expect(markup).not.toMatch(/\bhidden\b/);
    expect(markup).not.toMatch(/\b(sm|md|lg|xl):/);
    expect(markup).not.toContain("sr-only");
    expect(markup).not.toContain("tabindex");
  });

  it("hard-codes no colour of its own", () => {
    expect(demoMarkup()).not.toMatch(/#[0-9a-fA-F]{3,8}/);
  });

  it("goes back to being a whisper the moment the switch is off", () => {
    for (const value of [undefined, "0", "true", ""]) {
      vi.stubEnv(DEMO_ENV_VAR, value);
      const markup = renderToStaticMarkup(<FooterAdminLink />);
      expect(markup, String(value)).toContain(`href="${LOGIN_PATH}"`);
      expect(markup, String(value)).toContain(">Staff<");
    }
  });

  it("is a whisper again when the demonstration sits on a real database", () => {
    // The link is tied to the door actually being open, not to the deployment
    // calling itself a demonstration. A demo pointed at a real database keeps
    // its password gate, so a button reading "Open the admin" and promising no
    // password would be a lie that bounces the reader onto a sign-in page.
    vi.stubEnv(DEMO_ENV_VAR, "1");
    vi.stubEnv("SUPABASE_DB_URL", "postgres://user@db.example.com:5432/live");
    const markup = renderToStaticMarkup(<FooterAdminLink />);
    expect(markup).toContain(`href="${LOGIN_PATH}"`);
    expect(markup).toContain(">Staff<");
    expect(markup).not.toContain("Open the admin");
    expect(markup).not.toContain("no password");
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
