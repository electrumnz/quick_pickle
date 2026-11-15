import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The page the unsubscribe link in a campaign email opens.
 *
 * What it must never do is take somebody off the list for looking, or fail:
 * a mail program opens every link in an email to check it, and a person who
 * wants out must not meet an error page. What the button itself does is in
 * tests/shop/unsubscribe.test.ts.
 */

type Standing = { known: true; email: string; on: boolean } | { known: false };

const state = vi.hoisted(() => ({
  standing: { known: false } as Standing | Error,
  asked: [] as string[],
  left: [] as string[],
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));
// The page's furniture is not what is being looked at.
vi.mock("@/components/site/Sections", () => ({ SiteFooter: () => null }));
vi.mock("@/components/site/SiteHeader", () => ({ SiteHeader: () => null }));
vi.mock("@/app/(site)/unsubscribe/[token]/leave", () => ({
  standingOf: async (token: string) => {
    state.asked.push(token);
    if (state.standing instanceof Error) throw state.standing;
    return state.standing;
  },
  leaveBy: async (token: string) => {
    state.left.push(token);
    return "left";
  },
}));
vi.mock("@/app/(site)/unsubscribe/[token]/actions", () => ({
  leaveAction: async () => {},
}));

import UnsubscribePage, {
  dynamic,
  metadata,
} from "@/app/(site)/unsubscribe/[token]/page";
import { UNSUBSCRIBE } from "@/content/site";

const TOKEN = "k3v9x2m7q4w8z5t1b6n0c3r7";
const EMAIL = "mere@example.co.nz";

/** The page as text, with an apostrophe written as itself. */
const page = async (failed?: string) =>
  renderToStaticMarkup(
    await UnsubscribePage({
      params: Promise.resolve({ token: TOKEN }),
      searchParams: Promise.resolve(failed === undefined ? {} : { failed }),
    }),
  ).replaceAll("&#x27;", "'");

beforeEach(() => {
  state.standing = { known: false };
  state.asked = [];
  state.left = [];
});

describe("the unsubscribe page", () => {
  it("asks once, with one button, and takes nobody off for looking", async () => {
    state.standing = { known: true, email: EMAIL, on: true };
    const html = await page();
    expect(html).toContain(UNSUBSCRIBE.title);
    expect(html).toContain(EMAIL);
    // One form, one button, and the token goes back with it.
    expect(html.match(/<form/g)).toHaveLength(1);
    expect(html.match(/<button/g)).toHaveLength(1);
    expect(html).toContain(`name="token" value="${TOKEN}"`);
    expect(html).toContain(UNSUBSCRIBE.cta);
    expect(html).not.toContain('role="alert"');
    // Drawing the page asked whose link it is, and did nothing else.
    expect(state.asked).toEqual([TOKEN]);
    expect(state.left).toEqual([]);
  });

  it("says so when they are already off the list, and offers no button", async () => {
    state.standing = { known: true, email: EMAIL, on: false };
    const html = await page();
    expect(html).toContain('role="status"');
    expect(html).toContain(UNSUBSCRIBE.doneTitle);
    expect(html).toContain(EMAIL);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<button");
    expect(state.left).toEqual([]);
  });

  it("names nobody for a link that is not one of ours", async () => {
    const html = await page();
    expect(html).toContain(UNSUBSCRIBE.unknownTitle);
    expect(html).not.toContain("@");
    expect(html).not.toContain("<form");
  });

  it("says it did not go through when it did not, and offers the button again", async () => {
    state.standing = { known: true, email: EMAIL, on: true };
    const html = await page("1");
    expect(html).toContain('role="alert"');
    expect(html).toContain(UNSUBSCRIBE.failed);
    expect(html.match(/<button/g)).toHaveLength(1);
    // Only the word the page itself puts there is believed.
    expect(await page("yes")).not.toContain('role="alert"');
  });

  it("is still a page when the list cannot be read", async () => {
    state.standing = new Error("the database would not answer");
    const html = await page();
    expect(html).toContain(UNSUBSCRIBE.unknownTitle);
    expect(html).not.toContain("database");
  });

  it("is never kept, never indexed, never counted, and tells no other site its address", async () => {
    expect(dynamic).toBe("force-dynamic");
    expect(metadata.robots).toEqual({ index: false, follow: false });
    expect(metadata.referrer).toBe("no-referrer");
    // The visit counter keeps a page's path, and this one's holds the token.
    for (const standing of [
      { known: false },
      { known: true, email: EMAIL, on: true },
      { known: true, email: EMAIL, on: false },
    ] satisfies Standing[]) {
      state.standing = standing;
      expect(await page()).toMatch(/<main[^>]* data-uncounted=""/);
    }
  });
});
