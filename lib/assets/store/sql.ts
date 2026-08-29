/**
 * The asset store, against the real schema.
 *
 * Every statement is parameterised — there is no string interpolation of a
 * value anywhere in this file, including in the filter builder, which is the
 * one place a library like this usually grows an injection.
 *
 * Two shapes are worth reading before the rest:
 *
 *  - **`selectable_for_outbound` is only ever read.** It is a generated column;
 *    the insert and the update below do not name it, and could not set it if
 *    they did.
 *  - **Product links are replaced as a set**, inside the same transaction as the
 *    metadata update, so an asset never sits half-tagged.
 */

import type { SqlExecutor, SqlRow } from "@/lib/commerce/sql/executor";

import { AssetError } from "../errors";
import {
  FRAMES,
  type AssetProduct,
  type ConsentState,
  type DescriptionSource,
  type MarketingAsset,
  type StorageBackend,
  type UsageRights,
} from "../types";
import type {
  AssetApprovalReference,
  AssetFilter,
  AssetLibrarySummary,
  AssetMetadataPatch,
  AssetStore,
  NewAsset,
} from "./types";

const COLUMNS = `
  a.id, a.slug, a.kind, a.title, a.description, a.description_source,
  a.description_model, a.occasion, a.occasion_on, a.captured_at,
  a.people_present, a.people_consent, a.consent_note, a.consent_recorded_at,
  a.usage_rights, a.credit, a.rights_expire_on, a.tags,
  a.storage_backend, a.storage_key, a.poster_storage_key, a.mime_type,
  a.byte_size, a.checksum_sha256, a.original_filename,
  a.width_px, a.height_px, a.duration_ms, a.aspect_ratio,
  a.metadata_stripped, a.had_location_metadata, a.selectable_for_outbound,
  a.created_at, a.updated_at,
  coalesce(p.products, '[]'::jsonb) as products`;

const FROM = `
  from public.marketing_assets a
  left join lateral (
    select jsonb_agg(
             jsonb_build_object(
               'variantId', v.id, 'sku', v.sku,
               'productTitle', pr.title, 'variantTitle', v.title,
               'handle', pr.handle)
             order by v.sku) as products
      from public.marketing_asset_products link
      join public.product_variants v on v.id = link.variant_id
      join public.products pr on pr.id = v.product_id
     where link.asset_id = a.id) p on true`;

export class SqlAssetStore implements AssetStore {
  constructor(private readonly sql: SqlExecutor) {}

  async create(input: NewAsset): Promise<MarketingAsset> {
    return this.sql.transaction(async (tx) => {
      const inserted = await tx.query<SqlRow>(
        `insert into public.marketing_assets (
           slug, kind, title, description, description_source, description_model,
           occasion, occasion_on, captured_at,
           people_present, people_consent, consent_note, consent_recorded_at, consent_recorded_by,
           usage_rights, credit, rights_expire_on, tags,
           storage_backend, storage_key, poster_storage_key, mime_type,
           byte_size, checksum_sha256, original_filename,
           width_px, height_px, duration_ms,
           metadata_stripped, had_location_metadata, uploaded_by)
         values ($1, $2::public.marketing_asset_kind, $3, $4,
                 $5::public.marketing_asset_description_source, $6,
                 $7, $8::date, $9::timestamptz,
                 $10, $11::public.marketing_asset_consent, $12, $13::timestamptz, $14::uuid,
                 $15::public.marketing_asset_rights, $16, $17::date, $18::text[],
                 $19, $20, $21, $22,
                 $23, $24, $25,
                 $26, $27, $28,
                 $29, $30, $31::uuid)
         returning id`,
        [
          input.slug,
          input.kind,
          input.title,
          input.description,
          input.descriptionSource,
          input.descriptionModel,
          input.occasion,
          input.occasionOn,
          input.capturedAt,
          input.peoplePresent,
          input.peopleConsent,
          input.consentNote,
          input.consentRecordedAt,
          input.consentRecordedBy,
          input.usageRights,
          input.credit,
          input.rightsExpireOn,
          arrayLiteral(input.tags),
          input.storageBackend,
          input.storageKey,
          input.posterStorageKey,
          input.mimeType,
          input.byteSize,
          input.checksum,
          input.originalFilename,
          input.width,
          input.height,
          input.durationMs,
          input.metadataStripped,
          input.hadLocationMetadata,
          input.uploadedBy,
        ],
      );
      const id = text(inserted.rows[0] ?? {}, "id");
      await replaceProducts(tx, id, input.variantIds);
      const asset = await readOne(tx, "a.id = $1::uuid", [id]);
      if (asset === null) throw new AssetError("not_found", "Asset vanished.");
      return asset;
    });
  }

  async get(id: string): Promise<MarketingAsset | null> {
    if (!isUuid(id)) return null;
    return readOne(this.sql, "a.id = $1::uuid", [id]);
  }

  async bySlug(slug: string): Promise<MarketingAsset | null> {
    return readOne(this.sql, "a.slug = $1", [slug]);
  }

  async byChecksum(checksum: string): Promise<MarketingAsset | null> {
    return readOne(this.sql, "a.checksum_sha256 = $1", [checksum]);
  }

  async list(filter: AssetFilter = {}): Promise<readonly MarketingAsset[]> {
    const { where, params } = buildWhere(filter);
    const limit = clamp(filter.limit ?? 60, 1, 200);
    const offset = Math.max(0, filter.offset ?? 0);
    params.push(limit, offset);
    const result = await this.sql.query<SqlRow>(
      `select ${COLUMNS} ${FROM} ${where}
       order by coalesce(a.occasion_on, a.captured_at::date, a.created_at::date) desc,
                a.created_at desc
       limit $${String(params.length - 1)} offset $${String(params.length)}`,
      params,
    );
    return result.rows.map(toAsset);
  }

  async count(filter: AssetFilter = {}): Promise<number> {
    const { where, params } = buildWhere(filter);
    const result = await this.sql.query<SqlRow>(
      `select count(*)::int as total from public.marketing_assets a ${where}`,
      params,
    );
    return int(result.rows[0] ?? {}, "total");
  }

  async update(id: string, patch: AssetMetadataPatch): Promise<MarketingAsset> {
    if (!isUuid(id)) throw new AssetError("not_found", "No such asset.");
    return this.sql.transaction(async (tx) => {
      const current = await readOne(tx, "a.id = $1::uuid", [id]);
      if (current === null) {
        throw new AssetError("not_found", "That asset is no longer here.");
      }

      const peoplePresent = patch.peoplePresent ?? current.peoplePresent;
      const consent = resolveConsent(patch, current.peopleConsent, peoplePresent);
      const decided = consent === "granted" || consent === "refused";
      const consentChanged = consent !== current.peopleConsent;
      const recordedAt = decided
        ? consentChanged || current.consentRecordedAt === null
          ? new Date().toISOString()
          : current.consentRecordedAt
        : null;

      await tx.query(
        `update public.marketing_assets set
           title = $2, description = $3,
           description_source = $4::public.marketing_asset_description_source,
           occasion = $5, occasion_on = $6::date,
           people_present = $7, people_consent = $8::public.marketing_asset_consent,
           consent_note = $9, consent_recorded_at = $10::timestamptz,
           consent_recorded_by = case when $10::timestamptz is null then null else $11::uuid end,
           usage_rights = $12::public.marketing_asset_rights,
           credit = $13, rights_expire_on = $14::date, tags = $15::text[],
           poster_storage_key = $16
         where id = $1::uuid`,
        [
          id,
          trimmed(patch.title) ?? current.title,
          trimmed(patch.description) ?? current.description,
          patch.descriptionSource ?? current.descriptionSource,
          nullable(patch.occasion, current.occasion),
          nullable(patch.occasionOn, current.occasionOn),
          peoplePresent,
          consent,
          nullable(patch.consentNote, current.consentNote),
          recordedAt,
          patch.operatorId ?? null,
          patch.usageRights ?? current.usageRights,
          nullable(patch.credit, current.credit),
          nullable(patch.rightsExpireOn, current.rightsExpireOn),
          arrayLiteral(patch.tags ?? current.tags),
          patch.posterStorageKey === undefined
            ? current.posterStorageKey
            : patch.posterStorageKey,
        ],
      );

      if (patch.variantIds !== undefined) {
        await replaceProducts(tx, id, patch.variantIds);
      }
      const updated = await readOne(tx, "a.id = $1::uuid", [id]);
      if (updated === null) throw new AssetError("not_found", "Asset vanished.");
      return updated;
    });
  }

  async remove(id: string): Promise<MarketingAsset | null> {
    if (!isUuid(id)) return null;
    const existing = await this.get(id);
    if (existing === null) return null;
    await this.sql.query(`delete from public.marketing_assets where id = $1::uuid`, [
      id,
    ]);
    return existing;
  }

  async summary(): Promise<AssetLibrarySummary> {
    const result = await this.sql.query<SqlRow>(
      `select
         count(*)::int as total,
         count(*) filter (where kind = 'photo')::int as photos,
         count(*) filter (where kind = 'video')::int as videos,
         count(*) filter (where selectable_for_outbound)::int as usable,
         count(*) filter (where people_consent = 'unrecorded')::int as awaiting_consent,
         count(*) filter (where people_consent = 'refused')::int as refused,
         count(*) filter (where usage_rights = 'unknown')::int as rights_unknown,
         count(*) filter (where had_location_metadata)::int as locations_removed,
         coalesce(sum(byte_size), 0)::bigint as byte_size
       from public.marketing_assets`,
    );
    const row = result.rows[0] ?? {};
    return {
      total: int(row, "total"),
      photos: int(row, "photos"),
      videos: int(row, "videos"),
      usable: int(row, "usable"),
      awaitingConsent: int(row, "awaiting_consent"),
      refused: int(row, "refused"),
      rightsUnknown: int(row, "rights_unknown"),
      locationsRemoved: int(row, "locations_removed"),
      byteSize: int(row, "byte_size"),
    };
  }

  async variants(): Promise<readonly AssetProduct[]> {
    const result = await this.sql.query<SqlRow>(
      `select v.id as variant_id, v.sku, v.title as variant_title,
              pr.title as product_title, pr.handle
         from public.product_variants v
         join public.products pr on pr.id = v.product_id
        where v.deleted_at is null and pr.deleted_at is null
        order by v.sku`,
    );
    return result.rows.map((row) => ({
      variantId: text(row, "variant_id"),
      sku: text(row, "sku"),
      variantTitle: text(row, "variant_title"),
      productTitle: text(row, "product_title"),
      handle: text(row, "handle"),
    }));
  }

  async approvalsFor(
    assetIds: readonly string[],
  ): Promise<readonly AssetApprovalReference[]> {
    const ids = assetIds.filter(isUuid);
    if (ids.length === 0) return [];
    const result = await this.sql.query<SqlRow>(
      `select ap.id, ap.title, ap.summary, ap.status::text as status,
              ap.risk::text as risk, ap.requested_at,
              array(select needle from unnest($1::text[]) as needle
                     where ap.payload::text like '%' || needle || '%'
                        or ap.preview::text like '%' || needle || '%') as asset_ids
         from public.approvals ap
        where exists (select 1 from unnest($1::text[]) as needle
                       where ap.payload::text like '%' || needle || '%'
                          or ap.preview::text like '%' || needle || '%')
        order by ap.requested_at desc
        limit 25`,
      [arrayLiteral(ids)],
    );
    return result.rows.map((row) => ({
      approvalId: text(row, "id"),
      title: text(row, "title"),
      summary: text(row, "summary"),
      status: text(row, "status"),
      risk: text(row, "risk"),
      requestedAt: iso(row, "requested_at") ?? "",
      assetIds: textArray(row["asset_ids"]),
    }));
  }
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function buildWhere(filter: AssetFilter): {
  where: string;
  params: unknown[];
} {
  const clauses: string[] = [];
  const params: unknown[] = [];
  const next = (value: unknown): string => {
    params.push(value);
    return `$${String(params.length)}`;
  };

  if (filter.kind != null) {
    clauses.push(`a.kind = ${next(filter.kind)}::public.marketing_asset_kind`);
  }
  if (filter.consent != null) {
    clauses.push(
      `a.people_consent = ${next(filter.consent)}::public.marketing_asset_consent`,
    );
  }
  if (filter.onlySelectable === true) {
    clauses.push(
      `a.selectable_for_outbound and (a.rights_expire_on is null or a.rights_expire_on >= current_date)`,
    );
  }
  if (filter.occasion != null && filter.occasion !== "") {
    clauses.push(`a.occasion ilike ${next(`%${filter.occasion}%`)}`);
  }
  if (filter.search != null && filter.search !== "") {
    const term = next(`%${filter.search}%`);
    clauses.push(
      `(a.title ilike ${term} or a.description ilike ${term} or coalesce(a.occasion, '') ilike ${term} or array_to_string(a.tags, ' ') ilike ${term})`,
    );
  }
  if (filter.tag != null && filter.tag !== "") {
    clauses.push(`${next(filter.tag.toLowerCase())} = any(a.tags)`);
  }
  if (filter.sku != null && filter.sku !== "") {
    clauses.push(
      `exists (select 1 from public.marketing_asset_products link
                 join public.product_variants v on v.id = link.variant_id
                where link.asset_id = a.id and upper(v.sku) = upper(${next(filter.sku)}))`,
    );
  }
  if (filter.frame != null) {
    const target = FRAMES[filter.frame].ratio;
    clauses.push(
      `a.aspect_ratio between ${next(target * 0.8)} and ${next(target * 1.2)}`,
    );
  }
  if (filter.from != null && filter.from !== "") {
    clauses.push(
      `coalesce(a.occasion_on, a.captured_at::date, a.created_at::date) >= ${next(filter.from)}::date`,
    );
  }
  if (filter.to != null && filter.to !== "") {
    clauses.push(
      `coalesce(a.occasion_on, a.captured_at::date, a.created_at::date) <= ${next(filter.to)}::date`,
    );
  }

  return {
    where: clauses.length === 0 ? "" : `where ${clauses.join(" and ")}`,
    params,
  };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

async function readOne(
  sql: SqlExecutor,
  where: string,
  params: readonly unknown[],
): Promise<MarketingAsset | null> {
  const result = await sql.query<SqlRow>(
    `select ${COLUMNS} ${FROM} where ${where} limit 1`,
    params,
  );
  const row = result.rows[0];
  return row === undefined ? null : toAsset(row);
}

async function replaceProducts(
  sql: SqlExecutor,
  assetId: string,
  variantIds: readonly string[],
): Promise<void> {
  await sql.query(
    `delete from public.marketing_asset_products where asset_id = $1::uuid`,
    [assetId],
  );
  const ids = [...new Set(variantIds.filter(isUuid))];
  if (ids.length === 0) return;
  await sql.query(
    `insert into public.marketing_asset_products (asset_id, variant_id)
     select $1::uuid, unnest($2::uuid[])`,
    [assetId, arrayLiteral(ids)],
  );
}

function toAsset(row: SqlRow): MarketingAsset {
  return {
    id: text(row, "id"),
    slug: text(row, "slug"),
    kind: text(row, "kind") === "video" ? "video" : "photo",
    title: text(row, "title"),
    description: text(row, "description"),
    descriptionSource: text(row, "description_source") as DescriptionSource,
    descriptionModel: textOrNull(row, "description_model"),
    occasion: textOrNull(row, "occasion"),
    occasionOn: dateOrNull(row, "occasion_on"),
    capturedAt: iso(row, "captured_at"),
    peoplePresent: row["people_present"] === true,
    peopleConsent: text(row, "people_consent") as ConsentState,
    consentNote: textOrNull(row, "consent_note"),
    consentRecordedAt: iso(row, "consent_recorded_at"),
    usageRights: text(row, "usage_rights") as UsageRights,
    credit: textOrNull(row, "credit"),
    rightsExpireOn: dateOrNull(row, "rights_expire_on"),
    tags: textArray(row["tags"]),
    storageBackend: text(row, "storage_backend") as StorageBackend,
    storageKey: text(row, "storage_key"),
    posterStorageKey: textOrNull(row, "poster_storage_key"),
    mimeType: text(row, "mime_type"),
    byteSize: int(row, "byte_size"),
    checksum: text(row, "checksum_sha256"),
    originalFilename: text(row, "original_filename"),
    width: intOrNull(row, "width_px"),
    height: intOrNull(row, "height_px"),
    durationMs: intOrNull(row, "duration_ms"),
    aspectRatio: decimalOrNull(row, "aspect_ratio"),
    metadataStripped: row["metadata_stripped"] === true,
    hadLocationMetadata: row["had_location_metadata"] === true,
    selectableForOutbound: row["selectable_for_outbound"] === true,
    products: products(row["products"]),
    createdAt: iso(row, "created_at") ?? "",
    updatedAt: iso(row, "updated_at") ?? "",
  };
}

function products(value: unknown): readonly AssetProduct[] {
  const list =
    typeof value === "string" ? (JSON.parse(value) as unknown) : value;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry): AssetProduct[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const row = entry as Record<string, unknown>;
    const variantId = row["variantId"];
    if (typeof variantId !== "string") return [];
    return [
      {
        variantId,
        sku: asString(row["sku"]),
        productTitle: asString(row["productTitle"]),
        variantTitle: asString(row["variantTitle"]),
        handle: asString(row["handle"]),
      },
    ];
  });
}

function resolveConsent(
  patch: AssetMetadataPatch,
  current: ConsentState,
  peoplePresent: boolean,
): ConsentState {
  const wanted = patch.peopleConsent ?? current;
  // The two columns have to agree, and the database enforces that. Rather than
  // handing her a constraint violation, the impossible pair is resolved here in
  // the direction she just moved.
  if (!peoplePresent) return "no_people";
  return wanted === "no_people" ? "unrecorded" : wanted;
}

// ---------------------------------------------------------------------------
// Narrowing a driver row without `any`
// ---------------------------------------------------------------------------

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function text(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  return "";
}

function textOrNull(row: SqlRow, key: string): string | null {
  const value = row[key];
  return typeof value === "string" && value !== "" ? value : null;
}

function int(row: SqlRow, key: string): number {
  return intOrNull(row, key) ?? 0;
}

function intOrNull(row: SqlRow, key: string): number | null {
  const value = row[key];
  if (typeof value === "number") return Math.trunc(value);
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
  }
  return null;
}

function decimalOrNull(row: SqlRow, key: string): number | null {
  const value = row[key];
  if (typeof value === "number") return value;
  if (typeof value === "string" && value !== "") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function iso(row: SqlRow, key: string): string | null {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" && value !== "") return value;
  return null;
}

/** A `date` column, as `YYYY-MM-DD`, whatever the driver hands back. */
function dateOrNull(row: SqlRow, key: string): string | null {
  const value = row[key];
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && value !== "") return value.slice(0, 10);
  return null;
}

function textArray(value: unknown): readonly string[] {
  if (Array.isArray(value)) {
    return value.filter((entry): entry is string => typeof entry === "string");
  }
  if (typeof value !== "string") return [];
  const body = value.trim();
  if (!body.startsWith("{") || !body.endsWith("}")) return [];
  const inner = body.slice(1, -1);
  if (inner === "") return [];
  const items: string[] = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const character of inner) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\") {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === "," && !quoted) {
      items.push(current);
      current = "";
    } else {
      current += character;
    }
  }
  items.push(current);
  return items.map((item) => item.trim()).filter((item) => item !== "");
}

/**
 * A Postgres array literal.
 *
 * Sent as one text parameter and cast in SQL (`$1::text[]`), which behaves
 * identically on node-postgres and on PGlite. The value is still a bound
 * parameter — the quoting here is the array's own syntax, not interpolation
 * into a statement.
 */
function arrayLiteral(values: readonly string[]): string {
  const escaped = values
    .map((value) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",");
  return `{${escaped}}`;
}

function trimmed(value: string | undefined): string | undefined {
  const text_ = value?.trim();
  return text_ === undefined || text_ === "" ? undefined : text_;
}

function nullable(
  value: string | null | undefined,
  fallback: string | null,
): string | null {
  if (value === undefined) return fallback;
  const text_ = value === null ? null : value.trim();
  return text_ === null || text_ === "" ? null : text_;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, Math.trunc(value)));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    value,
  );
}
