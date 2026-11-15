import type { Metadata } from "next";
import Link from "next/link";

import { SiteFooter } from "@/components/site/Sections";
import { SiteHeader } from "@/components/site/SiteHeader";
import { UNSUBSCRIBE } from "@/content/site";

import { leaveAction } from "./actions";
import { standingOf, type Standing } from "./leave";

/**
 * Where the unsubscribe link in a campaign email leads.
 *
 * One button. A mail program that opens every link in an email to check it
 * lands here and takes nobody off the list, because looking at this page
 * changes nothing: only pressing the button does. (A mail program's own
 * unsubscribe button posts to ./one-click, which is the request itself.)
 *
 * No sign-in and no cookie. The token in the address is the proof, so the
 * page is never kept, never indexed, tells no other site where the visitor
 * came from, and is not counted as a visit: the counter keeps a page's
 * path, and this one's would say who was here.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: UNSUBSCRIBE.metaTitle,
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function UnsubscribePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ failed?: string }>;
}) {
  const { token } = await params;
  const failed = (await searchParams).failed === "1";
  // If the list cannot be read, the page says the link did not work rather
  // than failing: the person can press the link again in a minute.
  const standing: Standing = await standingOf(token).catch(() => ({
    known: false,
  }));

  return (
    <>
      <SiteHeader minimal />
      {/* data-uncounted: the visit counter sends nothing from here, because
          this page's address holds the token (lib/shop/seen.ts). */}
      <main
        id="main"
        data-uncounted=""
        className="bg-cream px-gutter flex-1 pt-10 pb-20"
      >
        <div className="mx-auto max-w-[36rem]" data-testid="unsubscribe">
          {!standing.known ? (
            <>
              <h1 className="varsity text-[clamp(2.5rem,11vw,4rem)] leading-[0.95]">
                {UNSUBSCRIBE.unknownTitle}
              </h1>
              <p className="mt-4 text-[1.125rem] leading-relaxed">
                {UNSUBSCRIBE.unknownBody}
              </p>
              <Link href="/" className="btn mt-7">
                <span className="cap-trim">{UNSUBSCRIBE.shop}</span>
              </Link>
            </>
          ) : standing.on ? (
            <>
              <h1 className="varsity text-[clamp(2.5rem,11vw,4rem)] leading-[0.95]">
                {UNSUBSCRIBE.title}
              </h1>
              {failed ? (
                <p role="alert" className="mt-4 font-semibold leading-snug">
                  {UNSUBSCRIBE.failed}
                </p>
              ) : null}
              <p className="mt-4 text-[1.125rem] leading-relaxed [overflow-wrap:anywhere]">
                {UNSUBSCRIBE.body(standing.email)}
              </p>
              <form action={leaveAction}>
                <input type="hidden" name="token" value={token} />
                <button type="submit" className="btn mt-7">
                  <span className="cap-trim">{UNSUBSCRIBE.cta}</span>
                </button>
              </form>
            </>
          ) : (
            <div role="status">
              <h1 className="varsity text-[clamp(2.5rem,11vw,4rem)] leading-[0.95]">
                {UNSUBSCRIBE.doneTitle}
              </h1>
              <p className="mt-4 text-[1.125rem] leading-relaxed [overflow-wrap:anywhere]">
                {UNSUBSCRIBE.doneBody(standing.email)}
              </p>
              <p className="text-navy-muted mt-3 leading-relaxed">
                {UNSUBSCRIBE.again}
              </p>
              <Link href="/" className="btn mt-7">
                <span className="cap-trim">{UNSUBSCRIBE.shop}</span>
              </Link>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </>
  );
}
