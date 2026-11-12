import type { Metadata } from "next";
import Link from "next/link";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import {
  Empty,
  Notice,
  PageHeader,
  Panel,
  Pill,
} from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import { listPages } from "@/lib/backstage/pages/ops";
import { siteUrl } from "@/lib/site";

import {
  Flash,
  LookOnly,
  MarketingNav,
  TextField,
  VerdictPill,
} from "../parts";
import { createPageAction } from "./actions";
import { PageFields, PagePill } from "./fields";

export const metadata: Metadata = { title: "Landing pages" };

export default async function PagesPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { notice, tone } = await searchParams;
  const rows = await execute(listPages, {}, await staffCaller());
  const canWrite = staff.role !== "viewer";
  const site = siteUrl();

  return (
    <>
      <PageHeader
        title="Landing pages"
        lead="The shop's one page with different words at the top, for one audience or one advert. Each has its own address and its own numbers."
      />
      <MarketingNav current="pages" />
      <Flash notice={notice} tone={tone} />
      <div className="mb-4">
        <Notice>
          You do not need any of these. With none made, everybody sees the
          standard page. A page is a draft until you publish it, and publishing
          runs the same copy rules the site itself is held to.
        </Notice>
      </div>

      <Panel flush>
        {rows.length === 0 ? (
          <Empty title="No landing pages">
            Everybody sees the standard page. Start one below when there is an
            advert or an audience that wants its own words.
          </Empty>
        ) : (
          <ul className="bk-rows">
            {rows.map((page) => (
              <li key={page.id}>
                <Link
                  href={`/backstage/marketing/pages/${page.id}`}
                  className="bk-row grid-cols-[1fr_auto]"
                >
                  <span className="min-w-0">
                    <span className="block font-semibold [overflow-wrap:anywhere]">
                      {page.name}
                    </span>
                    <span className="block font-mono text-[0.9375rem] [overflow-wrap:anywhere]">
                      {site}
                      {page.path}
                    </span>
                    <span className="bk-muted block text-[0.9375rem] [overflow-wrap:anywhere]">
                      {(page.published ?? page.draft).headline
                        .split("\n")
                        .join(" ")}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center justify-end gap-2">
                    <PagePill state={page.state} />
                    {page.state !== "draft" && page.changed ? (
                      <Pill tone="doing">Changes not published</Pill>
                    ) : null}
                    <VerdictPill verdict={page.verdict} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title="Start a landing page" className="mt-6">
        {canWrite ? (
          <form
            id="new"
            action={createPageAction}
            className="flex scroll-mt-24 flex-col gap-3"
          >
            <TextField
              id="page-slug-new"
              name="slug"
              label="Address"
              required
              maxLength={40}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="clubs"
              hint={`What comes after ${site}/for/. 2 to 40 lower-case letters, numbers or hyphens. It is for ever: it may end up printed or in an advert.`}
            />
            <PageFields />
            <SubmitButton pending="Saving">Start it as a draft</SubmitButton>
            <p className="bk-muted text-[0.9375rem] leading-snug">
              Nobody outside can see a draft. You will be able to look at it as
              a customer would before you publish it.
            </p>
          </form>
        ) : (
          <LookOnly />
        )}
      </Panel>
    </>
  );
}
