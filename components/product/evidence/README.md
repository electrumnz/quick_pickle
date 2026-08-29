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

Without one the pages still render — that is the designed `degraded` state — and
`shop-*.png` will show it. With one they show live prices and live stock.

## What is measured, not just shown

`capture.mjs` records, per capture, in `audit.json`:

- `overflows` — `scrollWidth > clientWidth`. Must be false at every width.
- `smallTargets` — every interactive element whose box is under 44 x 44.
- `httpStatus` vs `expectedStatus` — the 404 state must really be a 404.
- `buyControls` — submit buttons present. With JavaScript disabled this must
  still be non-zero, because the buy path is a plain `<form>` posting to a
  Server Action.
- `jsonLd` — the parsed structured data, so the Product/Offer payload and its
  NZD price can be read back rather than taken on trust.

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

## The 3D bottle in these captures

Headless Chromium has no GPU, so the WebGL scene runs on SwiftShader at a few
frames a second. The captures prove the scene compiles, mounts and paints — not
what it feels like on real hardware. `components/3d/` owns the performance
tiering; `/lab/bottle` is where it is tuned.
