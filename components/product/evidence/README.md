# Shop evidence

Screenshots and measurements for `app/(site)/shop`, `app/(site)/products` and
`components/product`. Everything here is produced by `capture.mjs` against a
running server; nothing is hand-cropped or hand-edited.

## Running it

```bash
npm run dev                                   # or: next build && next start
node components/product/evidence/capture.mjs  # writes PNGs + audit.json here
```

The shop reads through `lib/commerce`, so the server needs a provider:

```
COMMERCE_PROVIDER=mock
SUPABASE_DB_URL=postgresql://…              # migrations + supabase/seed.sql applied
```

Without one the pages still render — that is the designed `degraded` state, and
it has a capture script of its own below. With one they show live prices and
live stock.

## What is measured, not just shown

`capture.mjs` records, per capture, in `audit.json`:

- `overflows` — `scrollWidth > clientWidth`. Must be false at every width.
- `smallTargets` — every interactive element whose box is under 44 x 44.
- `httpStatus` vs `expectedStatus` — the 404 state must really be a 404.
- `buyControls` — submit buttons present. With JavaScript disabled this must
  still be non-zero, because the buy path is a plain `<form>` posting to a
  Server Action.
- `structuredData` — the four fields a Product rich result stands or falls on,
  read back out of the rendered JSON-LD: name, sku, price, currency and
  availability. The price must be an NZD decimal string derived from integer
  minor units, and the availability must match what the page shows.
- `availabilityText` — what the page actually says about stock, so the chip and
  the JSON-LD can be checked against each other.

The run prints one line per capture and a pass/fail count at the end.

## The stock states

`state-soldout-*` and `state-stock-*` need real inventory to be in that state,
because every availability signal on these pages is a read of live stock and
none of them can be posed from the front end. Produce them like this, against a
scratch database — never a real one:

```sql
-- sold out: No 03 SMOKE, every location
update public.inventory_levels set on_hand = committed
 where variant_id in (select id from public.product_variants where sku = 'HS-03-500');

-- a countable few left: No 02 DIRTY
update public.inventory_levels set on_hand = committed + 6
 where variant_id in (select id from public.product_variants where sku = 'HS-02-500');
```

then

```bash
HS_GROUPS=stock HS_AUDIT=audit-stock.json node components/product/evidence/capture.mjs
```

and restore the numbers afterwards. `HS_GROUPS` also takes
`shop,product,states,dark,motion,nojs`.

## The multi-variant state

`state-variants-*.png` shows the size chooser. No product in the range has two
sizes today — every bottle is 500 ml — so the state was produced the only honest
way available: by putting a second variant in the scratch database, capturing
it, and taking it out again.

```sql
insert into public.product_variants
  (product_id, sku, title, size_ml, pack_count, price_cents, weight_grams,
   position, provider, shopify_gid, shopify_inventory_item_gid,
   shopify_updated_at, sync_status, synced_at)
select id, 'HS-01-1000', '1 L', 1000, 1, 3200, 1420, 20, 'shopify',
       'gid://shopify/ProductVariant/9911111111111',
       'gid://shopify/InventoryItem/9911111111111', now(), 'synced', now()
  from public.products where handle = 'no-01-house';

insert into public.inventory_levels
  (variant_id, location_id, on_hand, committed, provider, shopify_gid,
   shopify_updated_at, sync_status, synced_at)
select v.id, l.id, 8, 0, 'shopify',
       'gid://shopify/InventoryLevel/9911111111111', now(), 'synced', now()
  from public.product_variants v
  cross join (select id from public.inventory_locations where ships_orders limit 1) l
 where v.sku = 'HS-01-1000';
```

It found two real defects, which is why it was worth doing: the collection page
quoted one variant's price as if it were the product's, and the page defaulted
to whichever variant sorted first rather than the merchandiser's. Both are
fixed — cards now read "From $18" when a product has a range, and the page opens
on the first sellable variant in position order, as Shopify does.

## The degraded state

`state-degraded-*.png` is the shop with no commerce provider behind it — the
state a deploy is in before `SUPABASE_DB_URL` (or the Shopify pair) exists.
Produce it by starting the app with `COMMERCE_PROVIDER` set and the credentials
absent:

```bash
npm run build
COMMERCE_PROVIDER=mock npx next start --port 3500      # no SUPABASE_DB_URL
node components/product/evidence/capture-degraded.mjs  # or point capture.mjs at :3500
```

The pages still render, the words are still true, every price falls back to the
figure `content/brines.ts` publishes, and every buy control is withdrawn rather
than offered at a number the catalogue did not confirm.

## A note on the full-page captures

`*-full.png` is a full-page screenshot, and the mobile buy bar is
`position: fixed`. Playwright composites fixed elements at their viewport
position, so in a full-page capture the bar can appear over the middle of the
page. In a real viewport it sits on the bottom edge — see the non-`-full`
captures at 375, and `state-variants-375.png`.

## The 3D bottle in these captures

Headless Chromium has no GPU, so the WebGL scene runs on SwiftShader at a few
frames a second. The captures prove the scene compiles, mounts and paints — not
what it feels like on real hardware. `components/3d/` owns the performance
tiering; `/lab/bottle` is where it is tuned.
