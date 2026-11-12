import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PreviewRibbon } from "@/components/site/PreviewRibbon";
import { ShopPage } from "@/components/site/ShopPage";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { getPage, type PageRow } from "@/lib/backstage/pages/ops";

/**
 * A landing page as it will look, before anyone outside can see it.
 *
 * It lives among the shop's own pages, not under /backstage, so that it is
 * drawn with the shop's stylesheet and the shop's parts: what is previewed
 * is the real page, not a likeness of it. It is still behind the back end's
 * sign-in. `requireStaff` is the lock, as on every back-end page, and a
 * visitor who is not signed in is sent to sign in.
 *
 *   /preview/<id>            the draft
 *   /preview/<id>?show=live  the published words, when there are any
 *
 * Never cached, never indexed, and a visit here is not counted in the
 * numbers: it would be staff looking at their own work.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Preview",
  robots: { index: false, follow: false },
};

export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ show?: string }>;
}) {
  await requireStaff();
  const { id } = await params;
  const { show } = await searchParams;

  let page: PageRow;
  try {
    page = await execute(
      getPage,
      { id: decodeURIComponent(id) },
      await staffCaller(),
    );
  } catch (error) {
    if (
      error instanceof OpError &&
      (error.code === "not_found" || error.code === "invalid_input")
    ) {
      notFound();
    }
    throw error;
  }

  const live = show === "live" && page.published !== null;
  const words = live && page.published !== null ? page.published : page.draft;
  const here = `/preview/${encodeURIComponent(page.id)}`;
  return (
    <>
      <PreviewRibbon
        showing={live ? "live" : "draft"}
        name={page.name}
        editHref={`/backstage/marketing/pages/${encodeURIComponent(page.id)}`}
        otherHref={
          page.published === null ? null : live ? here : `${here}?show=live`
        }
      />
      <ShopPage words={words} page={page.slug} preview />
    </>
  );
}
