import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  DataUnavailable,
  DefinitionList,
  PageHeader,
  PageSections,
  Row,
  Rows,
  Section,
} from "@/components/admin";
import { AssetMedia } from "@/components/assets/AssetMedia";
import { MetadataForm } from "@/components/assets/MetadataForm";
import { DangerButton } from "@/components/assets/bits";
import {
  consentBadge,
  day,
  fileSize,
  kindWord,
  seconds,
  shapeWords,
} from "@/components/assets/words";
import {
  CONSENT_WORDS,
  RIGHTS_WORDS,
  citationFor,
  framesFor,
  FRAMES,
  outboundVerdict,
} from "@/lib/assets";
import { assetLibrary, loadAssets } from "@/lib/assets/server";
import { ADMIN_CSRF_FIELD_NAME, requireAdminSession } from "@/lib/auth/server";

import { removeAsset, saveAssetMetadata } from "../actions";

/**
 * One file: the picture, what it says about itself, and what the team can do
 * with it.
 *
 * The panel that matters most is "What the team sees". It shows the founder the
 * asset exactly as an agent gets it — the same words, the same shapes, the same
 * verdict — because the failure this whole unit exists to avoid is her thinking
 * a photograph is available when the runtime will refuse it, or the other way
 * round.
 */

export const metadata: Metadata = {
  title: "One file",
  robots: { index: false, follow: false, nocache: true },
};

export default async function AssetPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { csrfToken } = await requireAdminSession();
  const { id } = await params;
  const query = await searchParams;
  const saved = query["saved"] === "1";

  const library = assetLibrary();
  const result = await loadAssets(async () => {
    const asset = await library.store.get(id);
    if (asset === null) return null;
    const [products, approvals] = await Promise.all([
      library.store.variants(),
      library.store.approvalsFor([asset.id]),
    ]);
    return { asset, products, approvals };
  });

  if (!result.ok) {
    return (
      <>
        <PageHeader
          title="One file"
          lede="A photo or a clip from the library."
        />
        <DataUnavailable problem={result.problem} detail={result.detail} />
      </>
    );
  }
  if (result.data === null) notFound();

  const { asset, products, approvals } = result.data;
  const verdict = outboundVerdict(asset);
  const consent = consentBadge(asset.peopleConsent);
  const citation = citationFor(asset);
  const save = saveAssetMetadata.bind(null, asset.id);
  const remove = removeAsset.bind(null, asset.id);

  return (
    <>
      <PageHeader
        title={asset.title}
        lede={asset.description}
        meta={
          <>
            <Link
              href="/admin/assets"
              className="rounded-sm text-link underline underline-offset-4 hover:no-underline"
            >
              Back to the library
            </Link>
            <span aria-hidden="true">·</span>
            <span>
              {kindWord(asset.kind)}
              {asset.width !== null && asset.height !== null
                ? `, ${String(asset.width)} by ${String(asset.height)}`
                : ""}
            </span>
            <span aria-hidden="true">·</span>
            <span>{day(asset.occasionOn ?? asset.capturedAt)}</span>
          </>
        }
        actions={<Badge tone={consent.tone}>{consent.label}</Badge>}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div className="space-y-4">
          <Card>
            <CardBody>
              <AssetMedia asset={asset} size="full" />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="What the team can do with it" />
            <CardBody>
              {verdict.allowed ? (
                <Callout title="Cleared for use">
                  An agent may choose this one for a post. Choosing it is not
                  publishing it — whatever it writes still comes to you for a
                  yes, with this picture beside it.
                </Callout>
              ) : (
                <Callout title="The team cannot use this one" tone="danger">
                  <p>{verdict.reason}</p>
                  <p className="mt-1">{verdict.fix}</p>
                </Callout>
              )}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <MetadataForm
            asset={asset}
            products={products}
            csrfToken={csrfToken}
            action={save}
            saved={saved}
          />

          {approvals.length > 0 && (
            <Section
              title="Decisions this picture is attached to"
              description="Where an agent has proposed using it. Nothing here has gone out."
            >
              <Card>
                <Rows>
                  {approvals.map((approval) => (
                    <Row key={approval.approvalId}>
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                        <p className="text-body-sm text-primary">
                          {approval.title}
                        </p>
                        <Badge
                          tone={
                            approval.status === "pending" ? "accent" : "quiet"
                          }
                        >
                          {approval.status === "pending"
                            ? "Waiting on you"
                            : approval.status}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-caption text-muted">
                        {approval.summary}
                      </p>
                    </Row>
                  ))}
                </Rows>
              </Card>
            </Section>
          )}

          <PageSections>
            <Section
              title="Take it out of the library"
              description="The file and everything recorded about it go together, and it cannot be undone."
            >
              <Card>
                <CardBody>
                  <form
                    action={remove}
                    className="flex flex-wrap items-center gap-3"
                  >
                    <input
                      type="hidden"
                      name={ADMIN_CSRF_FIELD_NAME}
                      value={csrfToken}
                      readOnly
                    />
                    <DangerButton type="submit">Delete this file</DangerButton>
                    <p className="text-caption text-muted">
                      Anything already sent out that used it stays sent.
                    </p>
                  </form>
                </CardBody>
              </Card>
            </Section>
          </PageSections>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="What the team sees"
            note="The same words an agent is handed"
          />
          <CardBody>
            <DefinitionList
              items={[
                {
                  term: "Description",
                  value: citation.description,
                  hint: `Read as: ${citation.descriptionBy}`,
                },
                {
                  term: "Occasion",
                  value: citation.occasion ?? "not recorded",
                  hint:
                    citation.occasionOn === null
                      ? "No date, so an agent cannot tell the season"
                      : day(citation.occasionOn),
                },
                {
                  term: "Bottles in it",
                  value:
                    citation.products.length === 0
                      ? "none recorded"
                      : citation.products.join(", "),
                },
                {
                  term: "Fits",
                  value:
                    framesFor(asset.aspectRatio).length === 0
                      ? `${shapeWords(asset)}, no standard frame without a crop`
                      : framesFor(asset.aspectRatio)
                          .map((frame) => FRAMES[frame].label)
                          .join(", "),
                },
                {
                  term: "Tags",
                  value:
                    asset.tags.length === 0 ? "none" : asset.tags.join(", "),
                },
              ]}
            />
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="The file itself" />
          <CardBody>
            <DefinitionList
              items={[
                { term: "Type", value: asset.mimeType },
                {
                  term: "Size",
                  value: fileSize(asset.byteSize),
                  hint: asset.originalFilename,
                },
                ...(asset.durationMs === null
                  ? []
                  : [
                      {
                        term: "Length",
                        value: seconds(asset.durationMs) ?? "unknown",
                      },
                    ]),
                {
                  term: "Location data",
                  value: asset.hadLocationMetadata
                    ? "found, and removed"
                    : "none found",
                  hint: asset.metadataStripped
                    ? "The stored file was rebuilt without its metadata."
                    : "This container is stored as uploaded.",
                },
                {
                  term: "Taken",
                  value:
                    asset.capturedAt === null
                      ? "the file did not say"
                      : day(asset.capturedAt),
                },
                {
                  term: "Added",
                  value: day(asset.createdAt),
                },
                {
                  term: "Consent",
                  value: CONSENT_WORDS[asset.peopleConsent].meaning,
                  hint:
                    asset.consentRecordedAt === null
                      ? undefined
                      : `Recorded ${day(asset.consentRecordedAt)}`,
                },
                {
                  term: "Rights",
                  value: RIGHTS_WORDS[asset.usageRights].meaning,
                  hint:
                    asset.credit === null
                      ? undefined
                      : `Credit: ${asset.credit}`,
                },
                {
                  term: "Fingerprint",
                  value: (
                    <span className="font-mono text-caption break-all">
                      {asset.checksum.slice(0, 32)}…
                    </span>
                  ),
                  hint: "The same file added again is recognised by this and not stored twice.",
                },
              ]}
            />
          </CardBody>
        </Card>
      </div>
    </>
  );
}
