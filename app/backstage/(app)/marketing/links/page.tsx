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
import { listLinks, type LinkRow } from "@/lib/backstage/marketing/links";
import { listPartners } from "@/lib/backstage/marketing/partners";
import { listPromoCodes } from "@/lib/backstage/marketing/promo-codes";
import { formatNzd } from "@/lib/shop/money";
import { siteUrl } from "@/lib/site";

import {
  Flash,
  Fold,
  MarketingNav,
  QrPreview,
  SelectField,
  TextField,
} from "../parts";
import {
  createLinkAction,
  setLinkActiveAction,
  updateLinkAction,
} from "./actions";

export const metadata: Metadata = { title: "Short links" };

type Choice = { readonly value: string; readonly label: string };

/** Where it goes and how it is labelled: the same fields, new or existing. */
function LinkFields({
  link,
  partners,
  codes,
  forPartnerId,
}: {
  readonly link?: LinkRow;
  readonly partners: readonly Choice[];
  readonly codes: readonly Choice[];
  /** For a new link started from a partner's page: already picked. */
  readonly forPartnerId?: string;
}) {
  const key = link?.id ?? "new";
  return (
    <>
      <TextField
        id={`target-${key}`}
        name="target"
        label="Where it goes"
        required
        maxLength={2000}
        autoCapitalize="none"
        spellCheck={false}
        defaultValue={link?.target}
        placeholder="/ or https://"
        hint="A page on this site, starting with one slash (like /checkout), or a full https address. Nothing else is allowed, and only an owner can point a link at another website."
      />
      <TextField
        id={`label-${key}`}
        name="label"
        label="Label"
        maxLength={80}
        defaultValue={link?.label}
        hint="What it is for, and what it is called on the public links page."
      />
      <SelectField
        id={`partner-${key}`}
        name="partnerId"
        label="Whose link is it?"
        defaultValue={link?.partnerId ?? forPartnerId ?? ""}
        options={[{ value: "", label: "Ours" }, ...partners]}
        hint="Pick a club, a creator or an event and the orders that come through this link are counted as theirs."
      />
      <SelectField
        id={`code-${key}`}
        name="promoCodeId"
        label="Promo code it carries"
        defaultValue={link?.promoCodeId ?? ""}
        options={[{ value: "", label: "None" }, ...codes]}
        hint="Whoever follows the link gets this code tried at the checkout for them, with nothing to type. Only for a link to a page on this site."
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <TextField
          id={`utm-source-${key}`}
          name="utmSource"
          label="Source"
          maxLength={60}
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={link?.utm.utm_source}
          placeholder="instagram"
        />
        <TextField
          id={`utm-medium-${key}`}
          name="utmMedium"
          label="Medium"
          maxLength={60}
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={link?.utm.utm_medium}
          placeholder="social"
        />
        <TextField
          id={`utm-campaign-${key}`}
          name="utmCampaign"
          label="Campaign"
          maxLength={60}
          autoCapitalize="none"
          spellCheck={false}
          defaultValue={link?.utm.utm_campaign}
          placeholder="bio"
        />
      </div>
      <p className="bk-muted -mt-1 text-[0.9375rem] leading-snug">
        Optional. These three are added to the address on the way through, so a
        visit says where it came from. Letters, numbers and hyphens, no spaces.
      </p>
      <TextField
        id={`order-${key}`}
        name="showOrder"
        label="Place on the public links page"
        inputMode="numeric"
        maxLength={3}
        defaultValue={
          link?.showOrder == null ? undefined : String(link.showOrder)
        }
        hint="1 is first. Leave empty to keep it off that page. The page is not built yet."
      />
    </>
  );
}

export default async function LinksPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string; partner?: string }>;
}) {
  const staff = await requireStaff();
  const { notice, tone, partner } = await searchParams;
  const caller = await staffCaller();
  const [rows, partnerRows, codeRows] = await Promise.all([
    execute(listLinks, { sort: "clicks", limit: 200 }, caller),
    execute(listPartners, { status: "all", limit: 200 }, caller),
    execute(listPromoCodes, { limit: 200 }, caller),
  ]);
  const canWrite = staff.role !== "viewer";
  const site = siteUrl();
  const partners = partnerRows.map((partner) => ({
    value: partner.id,
    label: partner.name,
  }));
  const codes = codeRows.map((promo) => ({
    value: promo.id,
    label: `${promo.code} (${promo.label})`,
  }));

  return (
    <>
      <PageHeader
        title="Short links"
        lead="A short address of ours for a bio, a post, a creator or a QR code on a flyer. Each one counts how often it is followed, and the orders that come through it."
      />
      <MarketingNav current="links" />
      <Flash notice={notice} tone={tone} />
      <div className="mb-4">
        <Notice>
          A click is counted each time somebody follows the address. Machines
          that say what they are (search engines, link previews) are left out,
          though a few will slip through. Nothing about the visitor is kept and
          no cookie is set, so the same person twice is two clicks: these are
          visits, not people. An order is tied to a link by the buyer&rsquo;s
          own browser remembering which link it followed, for thirty days, so
          someone who comes back on another device is not counted.
        </Notice>
      </div>

      <Panel flush>
        {rows.length === 0 ? (
          <Empty title="No links yet">
            Make one below, then put its short address wherever you like.
          </Empty>
        ) : (
          <ul className="bk-rows">
            {rows.map((link) => (
              <li key={link.id} className="bk-row grid-cols-1">
                <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
                  <div className="min-w-0">
                    <p className="font-mono font-semibold [overflow-wrap:anywhere]">
                      {site}
                      {link.path}
                    </p>
                    <p className="bk-muted text-[0.9375rem] [overflow-wrap:anywhere]">
                      {link.label === "" ? "" : `${link.label} · `}goes to{" "}
                      {link.target}
                    </p>
                    {link.partnerId !== null || link.code !== null ? (
                      <p className="mt-0.5 text-[0.9375rem]">
                        {link.partnerId !== null ? (
                          <>
                            For{" "}
                            <Link
                              href={`/backstage/marketing/partners/${link.partnerId}`}
                              className="underline"
                            >
                              {link.partnerName}
                            </Link>
                          </>
                        ) : null}
                        {link.partnerId !== null && link.code !== null
                          ? ". "
                          : ""}
                        {link.code !== null ? (
                          <>
                            Carries the code{" "}
                            <span className="font-mono font-semibold">
                              {link.code}
                            </span>
                          </>
                        ) : null}
                        .
                      </p>
                    ) : null}
                  </div>
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold tabular-nums">
                      {link.clicks} {link.clicks === 1 ? "click" : "clicks"}
                    </span>
                    <span className="tabular-nums">
                      {link.orders === 0
                        ? "no orders yet"
                        : `${String(link.orders)} ${link.orders === 1 ? "order" : "orders"}, ${formatNzd(link.salesCents)}`}
                    </span>
                    {link.external ? (
                      <Pill tone="doing">Leaves our site</Pill>
                    ) : null}
                    {link.active ? null : <Pill tone="off">Switched off</Pill>}
                    {link.showOrder === null ? null : (
                      <Pill>On the links page</Pill>
                    )}
                  </p>
                </div>
                <Fold summary="QR code">
                  <div className="flex flex-wrap items-start gap-4">
                    <QrPreview
                      text={`${site}${link.path}`}
                      label={`QR code for ${site}${link.path}`}
                      className="size-40 shrink-0"
                    />
                    <div className="min-w-0 max-w-[26rem]">
                      <p className="leading-snug">
                        Scanning this opens {site}
                        {link.path}, so each scan is counted as a click and the
                        link can still be pointed somewhere new after it is
                        printed.
                      </p>
                      <p className="mt-3 flex flex-wrap gap-2">
                        <a
                          href={`/backstage/marketing/links/${link.id}/qr?format=svg`}
                          className="bk-btn bk-btn-quiet"
                          download
                        >
                          <span className="cap-trim">For print (SVG)</span>
                        </a>
                        <a
                          href={`/backstage/marketing/links/${link.id}/qr?format=png`}
                          className="bk-btn bk-btn-quiet"
                          download
                        >
                          <span className="cap-trim">As a picture (PNG)</span>
                        </a>
                      </p>
                      <p className="bk-muted mt-3 text-[0.9375rem] leading-snug">
                        Print it at least 2 cm wide, keep the white border, and
                        scan a printed one with a phone before the whole run
                        goes to print.
                      </p>
                    </div>
                  </div>
                </Fold>
                {canWrite ? (
                  <Fold summary="Change this link">
                    <form
                      action={updateLinkAction}
                      className="flex flex-col gap-3"
                    >
                      <input type="hidden" name="id" value={link.id} />
                      <LinkFields
                        link={link}
                        partners={partners}
                        codes={codes}
                      />
                      <SubmitButton
                        pending="Saving"
                        className="bk-btn bk-btn-quiet"
                      >
                        Save the link
                      </SubmitButton>
                      <p className="bk-muted text-[0.9375rem] leading-snug">
                        The short address itself is for ever. It may already be
                        printed or posted, so it can be pointed somewhere new or
                        switched off, but not renamed or deleted.
                      </p>
                    </form>
                    <form action={setLinkActiveAction} className="mt-4">
                      <input type="hidden" name="id" value={link.id} />
                      <input
                        type="hidden"
                        name="active"
                        value={link.active ? "false" : "true"}
                      />
                      <SubmitButton
                        pending="Saving"
                        className="bk-btn bk-btn-quiet"
                      >
                        {link.active ? "Switch it off" : "Switch it on"}
                      </SubmitButton>
                    </form>
                  </Fold>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {canWrite ? (
        <Panel title="New short link" className="mt-6">
          <form
            id="new"
            action={createLinkAction}
            className="flex scroll-mt-24 flex-col gap-3"
          >
            <TextField
              id="slug-new"
              name="slug"
              label="Short address"
              required
              maxLength={40}
              autoCapitalize="none"
              spellCheck={false}
              placeholder="insta"
              hint={`What comes after ${site}/go/. 2 to 40 lower-case letters, numbers or hyphens.`}
            />
            <LinkFields
              partners={partners}
              codes={codes}
              forPartnerId={
                partners.some((row) => row.value === partner)
                  ? partner
                  : undefined
              }
            />
            <SubmitButton pending="Saving">Make the link</SubmitButton>
          </form>
        </Panel>
      ) : null}
    </>
  );
}
