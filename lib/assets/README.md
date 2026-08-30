# `lib/assets` — the founder's own photos and video

She takes the pictures. This is where they live, what is known about them, and
the one rule that decides whether the AI team may use one.

A folder of files would not have been enough. An agent cannot use an asset it
cannot understand, so the metadata **is** the product here: a description of
what is actually in the frame, the occasion and the day it happened, which SKUs
appear, the shape of it, and — the part that is not optional — whether the
people in it agreed to be published.

```
lib/assets/
  types.ts          the domain model, the frames, the shapes
  consent.ts        THE GATE. One rule, enforced twice
  formats.ts        the allow-list, by signature, and the size caps
  scrub.ts          metadata removal per container, and the structural parse
  ingest.ts         upload, in the order the security design requires
  naming.ts         slugs, titles, and the honest default description
  describe.ts       the optional vision draft, labelled as a draft everywhere
  claim-guard.ts    what model-written text is checked against before it is kept
  approvals.ts      finding the picture inside a decision
  tools.ts          two read-only tools, for the runtime's own registry
  storage/          the StorageProvider port, local disk and Supabase Storage
  store/            the persistence port and its SQL implementation
  server.ts         where the environment becomes objects
```

## The gate

> An asset may be chosen for anything that leaves the company only when the
> people question has been answered — either there are no identifiable people in
> it, or the people in it agreed — and the usage rights are known and current.

It is enforced in two independent places, and neither of them is a warning in
the interface.

**In Postgres.** `marketing_assets.selectable_for_outbound` is a stored
generated column computed from `people_consent` and `usage_rights`. No writer
can set it — not the admin, not an agent, not a hand-written `UPDATE`; the
database answers `column "selectable_for_outbound" can only be updated to
DEFAULT`. The agent-facing search filters on that column in SQL.

**In `consent.ts`.** The tool checks the row it just read against the same rule
in TypeScript, which catches a row that arrived by some other path and covers
the time-dependent half a generated column cannot: a licence that has expired.
`assertSelectableForOutbound` throws. There is no `force` argument.

The consent column has four values, because "I have not asked her yet" and "she
said no" are different problems with different fixes, and neither is publishable.
An upload with people in it defaults to `unrecorded`, which is unusable — the
safe default is the inconvenient one.

## Upload is the risky surface, so it is the careful one

`ingest.ts` runs these in this order, and stops at the first refusal:

1. **Sniff.** The type is read from the bytes. The filename and the browser's
   claimed MIME type are used only to write a better error message.
2. **Compare the claim.** A `.jpg` whose bytes are a PNG is refused rather than
   quietly accepted, because a file that lies about itself is the shape an
   attack takes even when this particular one is a rename.
3. **Size**, capped per kind (25 MB a photo, 200 MB a clip) and per upload.
4. **Scrub.** The container is walked and rebuilt without its metadata. A file
   that does not parse dies here, before anything is written anywhere.
5. **Hash what will be stored**, so the same photo from two phones is one row.
6. **Deduplicate** against the database before touching storage.
7. **Store**, under a content-addressed key.
8. **Describe** — her words, or a labelled model draft, or an honest default.
9. **Write the row**, with consent defaulting to the unusable state.

### What is accepted, and what is not

JPEG, PNG, WebP, AVIF, HEIC; MP4, QuickTime, WebM. Each is recognised by its
signature, and for the ISO container formats by its brand, so a `.mov` that is
really a Matroska file is refused by name.

**SVG is not on the list and cannot be.** An SVG is a document: it can carry
`<script>`, `<foreignObject>` and external references, and a sanitiser is a
filter that has to be right every time against someone who only has to be right
once. There is no founder use case for a hand-written vector in a photo library.
HTML, PDF and GIF are excluded for the same reason: not needed, so not accepted.

### The metadata scrub

A phone photograph carries the GPS coordinates of where the shutter was pressed,
to about five metres. A founder posting a photo of her own kitchen should not be
publishing her home address, and she should not have to know that to be safe
from it. So the library does not store the file she chose — it stores a rebuilt
one.

| Format          | What happens                                                                                                                                                                                                                            |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| JPEG            | Rebuilt from its segments: APP1 (EXIF/XMP), APP13 (IPTC), COM and every other APPn are dropped; APP0 and an ICC profile in APP2 are kept.                                                                                               |
| PNG             | Rebuilt from its chunks: only the critical chunks and a known-safe ancillary set survive. `eXIf`, `tEXt`, `zTXt`, `iTXt` and anything unrecognised are dropped.                                                                         |
| WebP            | Rebuilt without `EXIF` and `XMP `, and the VP8X feature flags for both are cleared so the file does not claim to hold what it no longer holds.                                                                                          |
| HEIC / AVIF     | The `Exif` and `mime` items named by the `meta` box are overwritten with zeros **in place** — same length, so every offset in `iloc` stays correct and the image still decodes.                                                         |
| MP4 / QuickTime | `udta` and `meta` boxes — where a phone writes `©xyz`, the ISO-6709 location of the recording — are renamed to `free` and zeroed. The box keeps its length, so the chunk offsets in `stco`/`co64` still land and the video still plays. |
| WebM            | **Not rewritten.** Stored as uploaded, and `metadata_stripped` records `false`. A browser produces WebM from a canvas or a screen recording; a phone does not produce it at all.                                                        |

Nothing is re-encoded. Re-encoding would need an image codec, would lose
quality, and would change the bytes for no security gain. The proof that the
pixels survive is in `tests/assets/scrub.test.ts`, which compares the entropy-
coded scan of the stored JPEG byte for byte against the original.

Two facts are read out of the metadata before it is destroyed: the day the
shutter fired, which becomes the default occasion date, and whether there were
coordinates at all, which is stored as a single boolean. The coordinates
themselves are never decoded and never written down.

## Storage is a port

The same decision `lib/commerce` makes: there is a service this project will use
one day (Supabase Storage) and no Supabase project today, so the app is written
against `StorageProvider` and the implementation is chosen by
`ASSET_STORAGE_PROVIDER`.

| Variable                    | Default              | What it does                                          |
| --------------------------- | -------------------- | ----------------------------------------------------- |
| `ASSET_STORAGE_PROVIDER`    | `local`              | `local` or `supabase`. An unknown value is refused.   |
| `ASSET_STORAGE_DIR`         | `<project>/.assets`  | Absolute path. Never inside `public/`.                |
| `ASSET_STORAGE_BUCKET`      | `marketing-assets`   | Supabase bucket. Must be **private**.                 |
| `SUPABASE_URL`              | —                    | Required for `supabase`.                              |
| `SUPABASE_SERVICE_ROLE_KEY` | —                    | Required for `supabase`. Server-side only.            |
| `REPLICATE_API_TOKEN`       | —                    | Absent: no draft descriptions. Everything else works. |
| `ASSET_VISION_MODEL`        | `yorickvp/llava-13b` | Which vision model drafts a description.              |
| `ASSET_VISION_DRAFTS`       | —                    | `off` turns the drafts off with a token present.      |

The local implementation is complete, not a stub: put, head, ranged read,
delete, with two independent defences against a key escaping its root. Files are
kept out of `public/`, deliberately — a file under `public/` is served to anyone
who guesses the URL with no session check, and half of these photographs have
other people in them.

### Where this does not work yet

**Not on Vercel with the local provider.** A deployed function has a read-only
filesystem and no instance that outlives a request, so `local` is a development
and self-hosted implementation. Production means `ASSET_STORAGE_PROVIDER=supabase`
with a private bucket, and that is exactly why the port exists.

**And not for a large clip on Vercel even then.** A serverless function's
request body is capped around 4.5 MB, so a 60 MB video cannot be posted through
`/admin/assets/upload` there. The upload path the caps in this library describe
is the local and self-hosted one; the cloud answer is a signed direct-to-storage
upload followed by the same sniff-and-scrub server side, and it is not built.

Bytes reach the browser only through `/admin/assets/file/<key>`, behind the
admin session, with the content type taken from the database row rather than
from the request, `nosniff`, a `default-src 'none'; sandbox` CSP, a
`Content-Disposition` filename this library generated, and `no-store`. Switching
to the Supabase provider moves the files to a different origin entirely, which
is the stronger answer to "do not serve an upload from your own origin".

## What an agent gets

Two tools, declared with the runtime's own `defineTool` and registered in the
runtime's own `ToolRegistry`. Both are `effect: "read"`.

```ts
import { registerAssetTools } from "@/lib/assets";
import { assetLibrary } from "@/lib/assets/server";

const library = assetLibrary();
registerAssetTools(tools.registry, { assets: library.store });
// then grant "find_marketing_assets" / "select_marketing_asset" to a role
// like any other tool name.
```

`find_marketing_assets` searches by occasion, product SKU, tag, free text, date
window and the shape of the frame the post needs (`story`, `portrait_post`,
`square`, `wide`). By default it returns only assets that may actually be used.
Ask for `include: "blocked"` and it names what is waiting on a decision, with the
reason and the fix, and no description an agent could caption from.

`select_marketing_asset` confirms one for outbound use and hands back a citation
to attach. It refuses — throws, into the run transcript — when consent is
unrecorded or refused, when the rights are unknown, or when a licence has
expired.

**Selecting is not publishing.** The citation carries an id, a description, the
shape and an admin path; there is no URL in it that anyone outside the session
could fetch. The caption the agent then writes goes through `approvals` like
every other outbound act, and because the agent cites the asset id in the
payload of that tool call, the approval carries the picture with it:

```tsx
import { assetsForApproval } from "@/lib/assets/server";
import { ApprovalAssets } from "@/components/assets/ApprovalAssets";

const pictures = await assetsForApproval(approval.payload);
<ApprovalAssets assets={pictures} />;
```

So the founder sees the photograph she is approving, not a filename — with no
second table to keep in step and no second path to the outside world.

## The description, and the model that drafts it

The founder's words always win. `description_source` says whose words they are —
`founder`, `model_draft`, or `model_edited` — the admin labels a draft on the
card and on the page, and the agent-facing citation says
"an unedited model draft — treat it as a guess".

A draft only becomes `model_edited` when the text has actually changed, not
because she pressed save on the screen it was on.

Model output is the one place text arrives from outside the company, so it is
checked before it is stored: `claim-guard.ts` holds a conservative subset of the
health and therapeutic rule groups from `legal/COPY-RULES.md`, and a draft that
trips it is discarded rather than filed. The binding check remains
`legal/scripts/audit-copy.mjs` over everything the company publishes.

## Running the tests

```bash
npx vitest run tests/assets/          # the lot, about ten seconds
npx vitest run tests/assets/scrub.test.ts    # the GPS photo, byte for byte
npx vitest run tests/assets/tools.test.ts    # the gate, through invokeTool
```

They boot PGlite, apply the real migrations in order and run against the real
schema — the real generated column, the real check constraints — then re-apply
`20260101999900_schema_guarantees.sql` a second time, which is what asserts that
the two tables added here have RLS with a policy, an index on every foreign key,
an `updated_at` trigger, and nothing granted to `anon`.
