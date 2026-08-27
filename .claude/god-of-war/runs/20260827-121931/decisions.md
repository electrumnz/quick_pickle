# Decisions taken unattended

Reversible calls made without the user while the campaign ran overnight.
Each records what was chosen, why, and what was NOT chosen, so any of them can be revisited.

| # | Decision | Chosen | Alternative not taken | Reversible? |
|---|---|---|---|---|
| 1 | Base branch for the PR | Created `main` at the scaffold commit via the GitHub API, so the feature branch has something to merge into | Leaving the repo with a single branch that is also the default, which makes a PR impossible | Yes — delete the branch |
| 2 | Hosting domain | Free Vercel domain | Buying halfsour.co.nz — explicitly forbidden by the user | Yes |

| 3 | Shopify tokens for the deployed app | Build the morning demo on MockProvider with real seeded data; ShopifyProvider ships complete but inactive | Waiting until tokens exist, which would leave nothing to show | Yes — flip COMMERCE_PROVIDER |

### Session 2 (branch `claude/website-deployment-recovery-0dxugq`, PR #2) — unit C2b

Same rule: reversible, logged, revisitable. Commits c10efc0 and b37b36a, also pushed to `main`.

| # | Decision | Chosen | Alternative not taken | Reversible? |
|---|---|---|---|---|
| 4 | Hero studio backdrop | `backdrop={{ enabled: false }}` — the alpha canvas stands the bottle on the page's own ground | Leaving it on, which cut a hard dark horizon across the bone page at every viewport | Yes — one prop |
| 5 | Hero label texture | `{...DEFAULT_LABEL, textureUrl: undefined}` — keeps the paper band, drops the artwork | Shipping the placeholder, which renders "PLACEHOLDER LABEL" legibly in the hero; or `enabled: false`, which reads as an unlabelled bottle | Yes — one prop, once C2a cuts the real texture |
| 6 | Reduced-motion / no-WebGL plate | `fallbackSrc="/brand/bottles.svg"` | `DEFAULT_FALLBACK_SRC`, which 404s — the file was never rendered | Yes — revert when the plate exists |
| 7 | Hero stage layout | One flex column: wordmark, canvas, line | An absolute overlay over a full-bleed canvas. Tried first; under reduced motion the CSS collapses the track to normal flow, so the type stacked on top of the static plate | Yes |
| 8 | Links to unbuilt routes | New `components/home/routes.ts` filters nav down to what resolves; `data.ts` untouched | Rendering all of `PRIMARY_NAV`/`FOOTER_NAV`, i.e. a live homepage pointing at eight 404s; or writing stub pages, which is C3/C5's work | Yes — add to `LIVE_ROUTES` as routes ship, delete the file when all have |
| 9 | Site chrome location | Moved to `SiteHeader`/`SiteFooter`, composed by the page; `app/(site)/layout.tsx` is a pass-through | Leaving chrome in the layout, which puts this page's section anchors on `/lab/*` where they resolve to nothing | Yes — but C3 must render the chrome itself. See progress.md Amendment 7 |
| 10 | Favicon location | `public/brand/favicon.svg` + a `metadata.icons` entry | `app/icon.svg`, the Next convention — but the brand's cut carries its own Brine ground, and raw hex under `app/` fails `tests/unit/brand-tokens.test.ts` | Yes |
| 11 | CSS-module class typing | New `components/home/cx.ts` drops `undefined` members | Interpolating into template literals, which renders the literal class `undefined`; or a non-null assertion, which `CLAUDE.md` forbids | Yes |
| 12 | Pre-existing red lint | Left alone, reported on PR #2 | Fixing 27 ESLint errors in `components/3d/` and `lib/commerce/` — another unit's boundary, and one the merge commit calls mid-refactor. Baseline measured with `git stash -u`: 34 problems before, 34 after | n/a |
| 13 | `FULL_SET` contents | **Corrected to three bottles.** See below — this one is not a style call | Shipping "Four bottles, one box" | Yes, but do not |

**#13 in full, because it is a compliance matter rather than a preference.**
`components/home/data.ts` described The Full Set as "Four bottles, one box, no decision
required." Three independent sources say three: `CLAUDE.md` lists HS-SET-3 as "All three of
01–03"; `brand/brand-guide.md` §5 line 4 gives the approved wording as "One of each. Three
bottles, one box, no decision required."; and the arithmetic settles it — $18 + $20 + $22 =
$60, less ten percent, is the $54 on the record, whereas four bottles would be $86. A
statement about what is in the box is a product-contents claim, so it was corrected to the
guide's own line rather than left for the critic. **If The Full Set is genuinely meant to
include No. 04 WILD, the price is wrong, not the copy** — and WILD is supply-limited, which
is presumably why it is not in the set.

Two smaller correctness fixes went in alongside C2b, both outside its brief but both defects:
a `<dt class="sr-only">` in the spec figures duplicated the visible label, so a screen reader
read every number's caption twice; and the CSS-module typing issue in #11 was live in the
first draft of the page.

### Decision 14 — the 3D bottle is OFF the homepage (founder's call)

Not reversible by a prop, so it gets its own note rather than a table row.

**What happened.** CI went red on the homepage commit. Two of the three failing
jobs were regressions from C2b (verified against run 82 on `main` at ff346ba,
where e2e and Lighthouse were both green and only Lint was red):

| Job | ff346ba | c10efc0 | Whose |
|---|---|---|---|
| typecheck / lint / test / build | failure (Lint) | failure | pre-existing |
| e2e (Playwright) | success | **failure** | C2b — no `<h1>` on the page. Fixed in e832a53 |
| Lighthouse budget | success | **failure** | C2b — see below |

**The Lighthouse numbers.** `three` + `drei` are ~285 kB compressed and loaded
on first paint, because the hero sits at the top of the page and BottleHero's
IntersectionObserver fires immediately:

| | script transfer | budget 400,000 |
|---|---|---|
| Homepage with the WebGL hero | 479,827 | over by 79,827 |
| Same page, 3D not loaded | 194,710 | under by 205,290 |
| Shipped homepage (illustration) | 189,803 | under by 210,197 |

Performance scored **0.55** (0.44 / 0.57 / 0.55) against a 0.95 floor. A WebGL
hero that loads on first paint cannot satisfy a 400 kB *total* script budget —
the two requirements are mutually exclusive as written.

**What was chosen.** Three options went to the founder: defer the 3D behind
first scroll, raise the budget to fit a WebGL storefront, or drop the 3D from
the homepage. The answer was to drop it — *"unless we can make it look way
better, it looks shithouse the bottle"* — and that judgement is correct on the
render as it stands: generic glass, a blank grey band where the label art
belongs, and nothing grounding it. `brand/assets/bottles.svg` runs in its place
and is frankly the better picture, because it carries the real drawn labels.

**Nothing was deleted.** `components/3d/` is untouched and `/lab/bottle` still
runs the full system. The homepage simply no longer imports it, which is also
why `Hero.tsx` is now a server component with no client JavaScript at all.

**Aftermath — the budget is green except performance, and 0.95 is unreachable on CI.**
Dropping the 3D fixed `resource-summary:script:size` outright; that assertion has not
appeared since. `categories:performance` still fails, and it is not a flake. Six runs of
identical code across two independent CI runs:

| run | values | median |
|---|---|---|
| 93 (95303ea) | 0.86, 0.93, 0.94 | 0.93 |
| 96 (9395f8c, docs-only) | 0.57, 0.92, 0.93 | 0.92 |

Never 0.95, on a spread from 0.57 to 0.94. The same commit scores 0.95 / 0.95 / 0.95 on a
quiet machine, so the runner is contended and the noise is far wider than the margin.
**Re-running will not clear it.**

The obvious lever was tried and rejected on measurement, so nobody needs to repeat it:
removing `MotionRoot` (GSAP + Lenis) saves 54 kB — 189,803 down to 136,173 — but measured
*worse* TBT and LCP under a 6x CPU throttle. The bottleneck is the React/Next client
runtime, not the motion layer, and it cannot be cut without going static-only. So the
reveals and smooth scroll were kept: they cost nothing measurable.

That leaves a threshold decision rather than an engineering one, and it belongs to the
founder: lower `categories:performance` to something the runner holds (~0.90 is still a
strong bar), or accept the job as documented-red. It has been put to them and NOT actioned
— see the note at the top of this file about not weakening a gate the campaign built and
proved. Note also that the gate measures `next start` on a shared runner; production runs
on Vercel's edge and is faster than anything CI reports.

**What it would take to earn a place back on the homepage.** This is C2a's
work, not a prop change:
1. **Real label textures.** The blank band is the single biggest reason it
   reads cheap. `brand/assets/label-01-house.svg` and its siblings exist as
   vector; they need baking to a texture the shader can map, and
   `DEFAULT_LABEL.textureUrl` needs to stop pointing at the UV registration
   card that renders the words "PLACEHOLDER LABEL".
2. **Ground it.** With the studio backdrop off, the bottle floats. It needs a
   contact shadow that works on the page's own ground rather than the painted
   dark room, which is what forced the backdrop off in the first place.
3. **Then re-argue the budget.** Even a beautiful bottle is ~285 kB. Whoever
   brings it back has to pair it with either deferred loading behind scroll
   intent or an explicit, deliberate change to `lighthouserc.json`. Do not
   quietly raise the budget to make a red job green.

---

## Queued for the user — NOT actioned
- Purchase of `halfsour.co.nz` (and optionally `.com`, currently taken). User said not to buy.
- Renaming the Shopify store from "Picklin Jews" to the final brand. User granted permission,
  but it waits on A1's IPONZ trademark result so we rename once, not twice.
- Any paid Supabase project creation, if the schema needs a live database to verify against.


---

## BLOCKER 1 — needs 2 minutes from the user, cannot be done by me

**The deployed site needs its own Shopify API tokens.** My Shopify connector authenticates me,
not the app. A deployed Next.js site on Vercel needs its own credentials, and creating them is
refused by policy: `storefrontAccessTokenCreate` returns
`access_escalation — Storefront access token management is not permitted via AI tools`.
That is a sensible guardrail and I have not tried to route around it.

This does not block the build. The commerce layer sits behind an adapter, so everything runs on
the mock provider with real seeded data and swaps to Shopify by changing one env var. But the
live store will not be connected until this is done.

### What to do (Shopify admin -> Settings -> Apps and sales channels -> Develop apps)
1. **Create an app**, name it something like "HALF SOUR storefront".
2. **Configure Storefront API scopes**: `unauthenticated_read_product_listings`,
   `unauthenticated_read_product_inventory`, `unauthenticated_read_selling_plans`,
   `unauthenticated_write_checkouts`, `unauthenticated_read_checkouts`.
3. **Configure Admin API scopes**: `read_products`, `write_products`, `read_orders`,
   `write_orders`, `read_inventory`, `write_inventory`, `read_customers`, `read_fulfillments`,
   `write_fulfillments`, `read_discounts`, `write_discounts`.
4. **Install the app**, then copy the two tokens.
5. Put them into the Vercel project `half-sour` env vars as `SHOPIFY_STOREFRONT_ACCESS_TOKEN`
   and `SHOPIFY_ADMIN_ACCESS_TOKEN`, then set `COMMERCE_PROVIDER=shopify`.

The Admin token is a full-write credential. It is server-only — it must never appear in a
`NEXT_PUBLIC_` variable or reach the browser.

---

## BLOCKER 2 — one setting, cannot be done by an agent

**`half-sour.vercel.app` still serves the scaffold, and the homepage cannot reach it.**

Production Branch Tracking still points at `claude/pickle-juice-brand-site-qu6jrr`. The
homepage is built, green and on `main`, but the live domain serves whatever the *tracked*
branch last built — so pushing to `main` or to PR #2 changes nothing on the live site. Every
deployment from either branch comes back `target: null`, i.e. a preview.

The user chose to switch production to `main` (retiring the dual-push workaround in
CLAUDE.md) rather than push to the old working branch.

### What to do
Vercel → project `half-sour` → Settings → Environments → Production → Branch Tracking →
change to `main`, then redeploy `main` from the dashboard. `main` is already at b37b36a and
builds green, so this is the only remaining step.

### Why an agent cannot
Both Vercel credentials in the session environment — `VERCEL_TOKEN` and `Vercel_token2` — are
rejected by the REST API with `{"code":"forbidden","invalidToken":true}`. The Vercel MCP
server authenticates separately and does work, but exposes no branch-tracking tool: it covers
deployment protection, pause/unpause and project creation only. There is no route to this
setting from here, and no attempt was made to route around the rejected tokens.

### After it is flipped
Drop the dual-pushing paragraph from `CLAUDE.md` ("Push to both `main` and the working
branch…"). It is correct only while production tracks the working branch, and it becomes
actively misleading the moment that changes. The TODO.md entry says the same.
