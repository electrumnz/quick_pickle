# Mission — HALF SOUR

## Goal
Build a complete pickle juice brand for the NZ (later AU) market: identity from scratch,
a storefront with real 3D and scroll-choreographed motion and a proven sales funnel,
an online shop, and an admin that runs the whole company via AI agents so the founder
is the only staff member outside physical work.

## Positioning (locked, user-approved)
Culinary / bar / mixer. NOT sports recovery, NOT gut health. The trend driver is
cocktails and mixers (pickle mixer unit sales +140%, pickle martinis, picklebacks,
Dua Lipa's pickle-juice Diet Coke). This also means ZERO health claims anywhere,
which keeps us clear of the FSANZ Code and MPI claim substantiation entirely.

## Brand (locked)
Name: HALF SOUR (the deli term for a cucumber cured in brine, not vinegar).
Backups: BRINE CLUB, DILLINGER. Avoid MOTHER BRINE (Coca-Cola "Mother" class-32 conflict).
Feel: modern editorial, dry wit, premium bar-ingredient.
Explicitly ruled out by the user: kiwiana ("tacky"), retro/vintage deli ("overdone").

## The bar
Composite. Each unit is graded against ONE of these, named in units.md:

- BRAND       -> goodgirlsnacks.com (Whole Foods placement, cult following, $0 ad spend)
- STOREFRONT  -> a current Awwwards Site of the Day, fetched at judging time
- ADMIN UX    -> Linear (linear.app) for IA and calm density; Shopify admin for commerce depth
- ENGINEERING -> the answer key in answer-key.md (measurable: Lighthouse, axe, tests)

The bar does not need to be reachable. It gives direction and stops the loop
settling for "good for AI".

## Stop condition
Four exits only: every unit won; the human calls it; budget spent; every remaining
unit plateaued (3 rounds, no verdict change, no new articulable gap) and triaged.

## Budget
Assumed, stated aloud, correctable by the user: ~10M tokens total campaign ceiling,
with a check-in after each wave. Wave A+B is the first tranche (~1.5M).

## Non-negotiables
- No health claims in any copy, ever. F1 audits this.
- Builder never grades its own work. Critic never sees builder reasoning.
- Every PASS carries evidence a human can open.
- Nothing ships to the storefront that breaks without JS or with reduced-motion on.

---
## Amendments during the run

### 2026-08-27 — Shopify went live mid-Wave-1
A real Shopify store was connected: "Picklin Jews", sgu8sy-at.myshopify.com, Basic plan,
NZD, NZST, New Zealand. Product catalogue empty — clean slate.

Consequences:
- C1 (Shopify adapter) is UNBLOCKED. It no longer waits on the user and moves from Wave 4
  to Wave 3. Shopify is now the source of truth for commerce.
- B2's commerce tables become a Shopify MIRROR (shopify_gid, synced_at, webhook_events,
  sync_state, provider discriminator). Non-commerce tables are unaffected and remain the
  reason our database exists.
- MockProvider survives as the credential-free test double, not as a stopgap.
- The store must be renamed once A1 lands the identity.

### 2026-08-27 — Brand name confirmed
"Picklin Jews" / repo name `pickled_jews` are PLACEHOLDERS only. User: "that was just a
placeholder, its a bit too rude to put as a public brand". HALF SOUR stands as the brand.
The Jewish-deli lineage of the half-sour pickle remains available as culinary heritage in
voice, recipes and label story — it is the genuine origin of the style — but never as the name.

### 2026-08-27 — Asset generation pipeline available
User granted HuggingFace Spaces (and Vercel AI Gateway as backup) for image/video generation.
This removes the biggest practical constraint on the build: there is no physical product to
photograph, and now there does not need to be.

Available and confirmed:
- mcp-tools/Qwen-Image            — high quality, excels at TEXT PLACEMENT -> label artwork
- mcp-tools/FLUX.1-Krea-dev       — natural imagery -> hero and lifestyle plates
- mcp-tools/FLUX.1-Kontext-Dev    — prompt-driven editing -> iterate without regenerating
- mcp-tools/Qwen-Image-Edit-Angles— camera rotate/pan/tilt -> consistent multi-angle of ONE bottle
- not-lain/background-removal     — clean cutouts for PDP
- prithivMLmods/SAM3-Image-Segmentation — masks for compositing
- fffiloni/InstantIR, Photo-Mate-i2i    — upscale/restore to retina
- zerogpu-aoti/wan2-2-fp8da-aoti-faster, mcp-tools/wan-2-2-first-last-frame — video

Card upgrades this unlocks:
- A1  produces REAL label mockups and hero plates, not written art direction.
- C3  the 360-degree product viewer becomes achievable via Edit-Angles frame sequences,
      independent of whether the R3F model lands.
- C2  generated textures for the brine/glass shader.
- D4/E2 the social agents can generate imagery, not just copy.
- F2  real OG/social share images.

Constraint carried into every generation: no kiwiana, no retro-deli, and no image that
implies a health claim (no gym, no supplement-aisle styling, no "recovery" context).

### 2026-08-27 — Unattended overnight run
User handed the campaign over to run overnight ("run the gauntlet, see you in the morning").

HARD CONSTRAINTS while unattended:
- DO NOT buy a domain. F2 deploys to the free Vercel domain only (half-sour.vercel.app or
  whatever Vercel assigns). Domain purchase queues for the user.
- No other irreversible or spending action without the user: no paid Supabase project, no
  sending real email, no publishing to real social accounts, no Shopify plan change, no
  charging a card. These queue in decisions.md and wait.
- The Shopify store is REAL. Products may be created there (the catalogue is empty and that
  is the point), but do not touch billing, do not publish the storefront to a live domain,
  and do not process a real payment. Test orders only via draft orders / Bogus Gateway.

Reversible decisions may be made alone. Log every one to decisions.md with the reasoning and
the alternative not taken, and surface the list at hand-back.
