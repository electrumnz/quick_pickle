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

### 2026-08-27 — Production-first, public demo
User: "go live freely, this is a demo site at the moment. better to just go to prod directly
cz im only gna send her the live link not previews".

Consequences:
- half-sour.vercel.app is THE deliverable surface. Previews are secondary.
- Vercel's production branch must follow the working branch so every push goes live.
- The critic's finding that production is served by a CLI upload with no githubCommitSha is
  therefore promoted from an adversarial note to the highest-priority defect in the build.
- Deployment protection stays OFF deliberately; public access is intended.

### 2026-08-27 — Supplier stories become a content pillar
User, on the kawakawa sourcing note: "thats actually a good point, we can use that to our
advantage, supplier stories".

This is now a required part of C5 (content) and feeds D6 (brand hub) and E2 (the content agent):
- Each named supplier gets a real story: the Tairawhiti kawakawa grower, the produce
  wholesaler, the spice importer, the glassware supplier, the label printer.
- Provenance is the proof of the premium positioning. A bar buyer asks where it comes from;
  the answer must be a person and a place, not a category.
- Scarcity is framed as a consequence of sourcing, never as manufactured urgency. "There is a
  limit to how much of this we can make, and that limit is the leaf" is the tone.
- Supplier stories must NOT drift into health or origin claims. Fair Trading Act s 13(j)
  covers place-of-origin representations, so every provenance statement has to be literally
  true before it ships. Flag anything aspirational as TODO rather than publishing it.
- The four-product range and its jobs: 01 HOUSE (everything), 02 DIRTY (martini),
  03 SMOKE (mezcal, meat), 04 WILD (seafood, kawakawa/kelp/lemon, limited by leaf supply).

### 2026-08-27 — B2C and B2B split into separate agents, plus wholesale mechanics
User: "you will need a different agent for public outreach and b2b outreach, so a b2c and b2b
agent, different markets. maybe even a wholesale login or coupon code or something".

Correct — these are different sales motions, not one motion with two tones. E2's roster splits:

**B2C agent** — consumer. Social content, UGC, email retention, launches, the recipe engine,
review requests. Voice is the brand voice. Success = repeat purchase rate and AOV.

**B2B agent** — trade. Bars, restaurants, delis, bottle shops, distributors. Completely
different job: prospect lists, sample-pack outreach, follow-up cadences, trade pricing,
minimum orders, reorder prompts when a venue goes quiet, stockist onboarding. Voice is
professional-but-not-corporate; a bar manager is not reading brand copy. Success = number of
active stockists and reorder frequency.

Why they cannot be one agent: the B2B cycle is weeks-long with named humans and a memory of
every prior conversation; the B2C cycle is impulse-driven and anonymous at scale. Shared tone
guidance, shared brand rules, entirely different tools, data and success measures.

**Wholesale mechanics — constrained by the Shopify plan.** The store is on Basic, so Shopify's
native B2B (company accounts, price lists, payment terms) is Plus-only and unavailable. The
practical build:
1. **Draft orders as the wholesale rail.** We hold write_draft_orders scope. A venue enquires,
   the B2B agent drafts the order at trade pricing, the founder approves it in the admin, and
   Shopify emails a real invoice. This is the standard Basic-plan wholesale flow and needs no
   plan upgrade.
2. **A wholesale area on our own site**, gated by our own auth (we control it, unlike Shopify
   customer accounts on Basic): trade pricing, order history, one-click reorder, downloadable
   line sheet and tasting notes. Reorders create draft orders.
3. **Customer tags + a trade discount code** as the low-tech fallback, with minimum-quantity
   rules, for venues that just want to self-serve.

Every wholesale price change and every outbound trade email flows through the same approvals
object as everything else — nothing goes to a real buyer unapproved.

Storefront consequence: the wholesale enquiry route in C5 becomes a real funnel entry, not a
contact form, and D2 (orders) must show draft orders alongside paid ones.
