import type { Metadata } from "next";
import Link from "next/link";

import {
  Callout,
  Card,
  CardHeader,
  DataUnavailable,
  NotBuiltYet,
  PageHeader,
  PageSections,
  Row,
  Rows,
  Section,
  Stat,
  StatGrid,
} from "@/components/admin";
import {
  AssetFilters,
  type FilterValues,
} from "@/components/assets/AssetFilters";
import { AssetGrid, LibraryEmpty } from "@/components/assets/AssetGrid";
import { UploadPanel } from "@/components/assets/UploadPanel";
import { assetHref, consentBadge, fileSize } from "@/components/assets/words";
import { FRAME_NAMES, type AssetFilter, type ConsentState } from "@/lib/assets";
import { assetLibrary, loadAssets } from "@/lib/assets/server";
import { ADMIN_CSRF_FIELD_NAME, requireAdminSession } from "@/lib/auth/server";

/**
 * Photos & video — the founder's own pictures, and the one place they live.
 *
 * This is an area of **Social**, not a tenth destination: the sidebar still has
 * nine places in it, and this is where the pictures that go into a post are
 * kept. Every screen here links back to Social so the trail is never lost.
 *
 * The order of the page is the order of the job: put something in, deal with
 * anything that is waiting on you, then look at what you have.
 */

export const metadata: Metadata = {
  title: "Photos & video",
  robots: { index: false, follow: false, nocache: true },
};

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string): string {
  const raw = params[key];
  return (Array.isArray(raw) ? raw[0] : raw)?.trim() ?? "";
}

export default async function AssetsPage({
  searchParams,
}: {
  searchParams: Promise<Params>;
}) {
  const { csrfToken } = await requireAdminSession();
  const params = await searchParams;
  const query = params;
  // The no-JavaScript upload path carries its result in the query string,
  // because a plain form post cannot render a list of per-file outcomes.
  const added = uploadSummary(params);

  const values: FilterValues = {
    q: one(params, "q"),
    kind: one(params, "kind"),
    sku: one(params, "sku"),
    frame: one(params, "frame"),
    consent: one(params, "consent"),
    from: one(params, "from"),
    to: one(params, "to"),
  };

  const filter: AssetFilter = {
    search: values.q === "" ? null : values.q,
    kind:
      values.kind === "photo" || values.kind === "video" ? values.kind : null,
    sku: values.sku === "" ? null : values.sku,
    frame: FRAME_NAMES.find((frame) => frame === values.frame) ?? null,
    consent: consentFilter(values.consent),
    from: values.from === "" ? null : values.from,
    to: values.to === "" ? null : values.to,
    limit: 60,
  };

  const library = assetLibrary();
  const result = await loadAssets(async () => {
    const [assets, summary, products, waiting] = await Promise.all([
      library.store.list(filter),
      library.store.summary(),
      library.store.variants(),
      library.store.list({ consent: "unrecorded", limit: 8 }),
    ]);
    return { assets, summary, products, waiting };
  });

  const header = (
    <PageHeader
      title="Photos & video"
      lede="Everything you have taken yourself: the stall, the bench, an event, a bar pouring one. This is what the team draws on when it writes a post."
      meta={
        <>
          <span>Part of Social</span>
          <span aria-hidden="true">·</span>
          <Link
            href="/admin/social"
            className="rounded-sm text-link underline underline-offset-4 hover:no-underline"
          >
            Back to Social
          </Link>
        </>
      }
    />
  );

  if (!result.ok) {
    return (
      <>
        {header}
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }

  const { assets, summary, products, waiting } = result.data;
  const filtered = Object.values(values).some((value) => value !== "");

  return (
    <>
      {header}
      <PageSections>
        {added !== null && (
          <Callout title="That upload is in">
            {added}{" "}
            <Link
              href="/admin/assets"
              className="text-link underline underline-offset-4 hover:no-underline"
            >
              Clear this message
            </Link>
            .
          </Callout>
        )}

        {query["deleted"] === "1" && (
          <Callout title="Deleted">
            The file and everything recorded about it are gone.
          </Callout>
        )}

        <Section title="Add to it">
          <UploadPanel
            csrfToken={csrfToken}
            csrfField={ADMIN_CSRF_FIELD_NAME}
            drafting={library.drafter !== null}
          />
        </Section>

        {summary.total > 0 && (
          <Section title="Where the library stands">
            <div className="rounded-lg border border-hairline bg-surface-raised px-4 py-4">
              <StatGrid>
                <Stat
                  label="Files"
                  value={String(summary.total)}
                  hint={`${String(summary.photos)} photos, ${String(summary.videos)} clips, ${fileSize(summary.byteSize)} altogether`}
                />
                <Stat
                  label="The team can use"
                  value={String(summary.usable)}
                  hint="Consent and rights both settled"
                />
                <Stat
                  label="Waiting on you"
                  value={String(
                    summary.awaitingConsent + summary.rightsUnknown,
                  )}
                  hint="People to ask about, or rights to record"
                  tone={
                    summary.awaitingConsent + summary.rightsUnknown > 0
                      ? "danger"
                      : "neutral"
                  }
                />
                <Stat
                  label="Locations removed"
                  value={String(summary.locationsRemoved)}
                  hint="Files that arrived carrying the coordinates of where they were taken"
                />
              </StatGrid>
            </div>
          </Section>
        )}

        {waiting.length > 0 && (
          <Section
            title="Waiting on a decision from you"
            description="There are people in these and nobody has recorded whether they agreed to be published. Until that is answered, nothing on the team can choose them — the tool refuses, it does not warn."
          >
            <Card>
              <CardHeader title="Consent not recorded" count={waiting.length} />
              <Rows>
                {waiting.map((asset) => (
                  <Row key={asset.id} href={assetHref(asset.id)}>
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <p className="text-body-sm text-primary">{asset.title}</p>
                      <p className="text-caption text-danger">
                        {consentBadge(asset.peopleConsent).label}
                      </p>
                    </div>
                    <p className="mt-0.5 text-caption text-muted">
                      {asset.description}
                    </p>
                  </Row>
                ))}
              </Rows>
            </Card>
          </Section>
        )}

        <Section
          title={summary.total === 0 ? "The library" : "Everything in it"}
          description={
            summary.total === 0
              ? undefined
              : "Newest occasion first. Open one to write what is in it, record consent, or take it out."
          }
        >
          {summary.total > 0 && (
            <div className="mb-4">
              <AssetFilters
                values={values}
                products={products}
                total={summary.total}
              />
            </div>
          )}
          {assets.length === 0 ? (
            <Card>
              <LibraryEmpty filtered={filtered} />
            </Card>
          ) : (
            <AssetGrid assets={assets} />
          )}
        </Section>

        <Section title="How this is kept">
          <Callout title="What happens to a file when you add it">
            <p>
              The type is decided by reading the bytes, not by the name: a file
              called <code>.jpg</code> that is not a JPEG is turned away. Then
              the location data is taken out — an EXIF block from a phone
              carries the coordinates of where the shutter was pressed — and
              what gets stored is the rebuilt file, not the one you chose. The
              same file added twice stays one file.
            </p>
            <p className="mt-2">
              These are kept {library.storage.location}, and served only through
              this admin, to you, signed in. They are not on the public site and
              there is no address anyone else can open.
            </p>
          </Callout>
        </Section>

        <NotBuiltYet
          blurb="This page changes real things: adding, editing and deleting all work. Here is what is not built yet."
          works={[
            "Adding photos and video, with the location data taken out and the type checked by reading the bytes",
            "A poster frame captured from each clip by the browser",
            "Writing what is in each file, the occasion, the date, the tags and which bottles appear",
            "Recording whether the people in a photo agreed to be published, which is what decides whether the team may use it",
            "Deleting a file and its bytes together",
          ]}
          coming={[
            "Choosing a different frame from a clip as its still",
            "Cropping to a shape without leaving the admin",
            "Bulk consent, for a whole event at once",
            "Showing where a file has already been used, once posts carry their pictures",
          ]}
        />
      </PageSections>
    </>
  );
}

/** "Two added, one was already here" — the plain-form upload's receipt. */
function uploadSummary(params: Params): string | null {
  const count = (key: string): number => {
    const value = Number.parseInt(one(params, key), 10);
    return Number.isFinite(value) ? value : 0;
  };
  const parts: string[] = [];
  const added = count("added");
  const already = count("already");
  const refused = count("refused");
  if (added + already + refused === 0) return null;
  if (added > 0) parts.push(`${String(added)} added`);
  if (already > 0) parts.push(`${String(already)} already here`);
  if (refused > 0) parts.push(`${String(refused)} turned away`);
  return `${parts.join(", ")}.`;
}

function consentFilter(value: string): ConsentState | null {
  const states: readonly ConsentState[] = [
    "no_people",
    "granted",
    "refused",
    "unrecorded",
  ];
  return states.find((state) => state === value) ?? null;
}
