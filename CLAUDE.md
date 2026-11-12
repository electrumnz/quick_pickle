# QUICK PICKLE

A one-page shop for Quick Pickle: pickle juice shots, sold direct, in New Zealand.
The juice is clear. There are no pickles in the bottle.

The brand is Ashleigh Lennard's: the logo, Lucky the superhero cat, the three colours and
the four fonts. "Brand Guide v2" (Grok's write-up of her files) is a starting point, not a
rulebook. The version this build actually follows is the living guide at `/backstage/brand`,
rendered from the same tokens and components as the site.

The repository name is not a brand name. Everything a customer sees says Quick Pickle.

## Non-negotiables

**No health claims. Anywhere. Ever.** Quick Pickle is a food. Under the Food Standards
Code a food may not be advertised as preventing or easing a condition (Standard 1.2.7-8),
and any other claim about what it does to a body needs approvals this product does not
have (1.2.7-18). That rules out the line the concept deck is built around: "a pickle punch
to cramps in 60 seconds flat". It also rules out the quieter ones: recovery, hydration,
electrolytes, performance, "for the quads".

So the site sells what it can stand behind: **the taste, the tiny bottle, the ritual, and
Lucky.** `legal/COPY-RULES.md` is binding on every word published, including anything an
AI drafts, and it is machine-enforced:

```bash
npm run audit:copy            # exits non-zero on a banned term
npm run audit:copy:selftest   # proves the scanner still catches the deck's own lines
```

A wink is a claim too. "We can't tell you what it does" implies it does something.

**Facts must be literally true.** Fair Trading Act s 9, 12A, 13. Nothing about the product
is guessed: no ingredient, volume, origin, storage line or process word ("strained",
"brewed") appears until Ashleigh confirms it. Unknown commercial facts carry a stand-in in
`content/offer.ts` and are listed in `UNCONFIRMED` there. While that list is not empty the
site tells crawlers to stay out and `npm run prelaunch` fails.

**No demo or preview banner on public pages.** Test mode is explained once, on the
checkout, where a visitor would otherwise expect a card field.

**No em dashes in customer-facing copy.** Use a full stop, a comma or a colon. The founder
reads them as machine-written. Code comments are not copy.

**Never trust a price from the browser.** The jar holds SKUs and quantities. Every total
is computed from `content/offer.ts` by `lib/shop/pricing.ts`, and computed again on the
server when an order is placed. There is no price field on any form.

## How it is built

Next.js 16 App Router · React 19 · TypeScript · Tailwind v4 · Vercel. No CMS, no Shopify,
no database yet. Commerce is native: our catalogue, our jar, our checkout, our orders.

```
app/                 the page, /checkout, /order/thanks, the fine print, /backstage
components/brand/    Lucky and the lockup (inline vector), raster art, icons, the bottle
components/site/     the sections of the page
components/cart/     the jar: provider, header button, sheet
components/checkout/ the form and its Server Action
content/             EVERY word and EVERY commercial fact. Edit copy and prices here.
lib/brand/           tokens.css (the only file with a hex), fonts, generated art data
lib/shop/            money, jar, pricing, orders, the payment seam, the store seam
legal/               COPY-RULES.md and the scanner
scripts/             build-art.mjs, build-vectors.py, build-media.mjs, prelaunch.mts
tests/  e2e/         vitest and Playwright
```

### Commerce

- `content/offer.ts` is the catalogue. Money is integer cents; never a float in a price path.
- `lib/shop/payments` is where a processor plugs in. Today `PAYMENT_PROVIDER` is `test`:
  the checkout records the order, charges nobody, and says so on every screen. An unknown
  provider name throws rather than falling back to test mode.
- `lib/shop/store` is where orders are written. `file` in development (`.data/`), `log` in
  production. The log store keeps nothing, which is acceptable only while payments are test.
- The "order's in" page reads a short-lived httpOnly receipt cookie. It is display only.

### Design rules that came from measuring

- **Mobile first.** The phone layout is the design; wider screens only add room. The button
  is on the first screen at 390 wide, and a sticky buy bar follows the thumb after that.
- **On the pink ground, sentences live on a cream card.** Cream on pink is 3.8:1 and navy
  on pink is 3.4:1: large type only. `tests/brand/tokens.test.ts` computes every pair.
- **Never a raw hex outside `lib/brand/`.** A test enforces it.
- **Motion is transform and opacity only**, on the guide's durations, and everything
  collapses under `prefers-reduced-motion`. Content is visible without JavaScript; scroll
  reveal only hides blocks once its observer is actually running.
- Tap targets are 44px or more. axe runs on every page at both sizes with no rule disabled.

### Art

Ashleigh's concept pages are true vector, so Lucky (running, and flying up) and the stacked
QUICK / PICKLE lockup are drawn from her own paths: `scripts/build-vectors.py` extracts
them, `components/brand/Vector.tsx` renders them. They are never redrawn or recoloured.
Only the marks she drew as motion (burst lines, speed lines, dust) move.

That vector art is her pink-ground "knockout" palette. On cream or navy use the full-colour
raster art (`components/brand/Art.tsx`, built by `scripts/build-art.mjs`).

The bottle is real: 100 ml, clear food-grade plastic, straight sides, a wide white ribbed
screw cap, juice as clear as water, and a wrap label covering most of the body (the name in
Summer Varsity, Lucky running under it). `components/brand/Bottle.tsx` is a drawing of that,
standing in until the proper labels are printed and photographed. The samples seen so far
wore temporary stickers.

Poses marked "proposed" in the pack were generated from her art and are pending her nod:
celebrate (order placed) and sleeping (empty jar, 404) are in use and flagged in the guide.

The asset pack itself (200 MB of print masters) is not in the repository. Both build
scripts take its path as an argument.

Video and reels go in the slots in `content/media.ts`, encoded by `scripts/build-media.mjs`.

## Conventions

- **`npm run typecheck` is not sufficient.** Verify with `npm run build`.
- No `any`, no `@ts-ignore`, no unjustified `eslint-disable`.
- Copy lives in `content/`. A component that needs a new word gets it from there, so the
  scanner reads the whole site by reading one folder.
- **Take a private build directory** when more than one thing builds this tree:
  `NEXT_DIST_DIR=.scratch/next-<something>`. Two builds sharing `.next` interleave silently.
- **Next 16 allows one `next dev` per directory.** A crashed run leaves the lock held; kill
  it by the PID the error message gives you.
- **Never `pkill -f` on a broad pattern.** Kill by PID.
- Playwright is pinned to the version whose Chromium is preinstalled in the cloud sandbox
  (1.63). Do not run `playwright install` there.
- ESLint 9 not 10, TypeScript 6 not 7: both held back on purpose by the Next toolchain.
- Customer-facing writing is plain everyday New Zealand English with British spelling.

## Deploying

The Vercel project tracks this repository. Production follows `main`; every other branch
gets a preview URL. Never push a red build to `main`: Vercel keeps the last good deployment,
so a failed build silently freezes production rather than breaking it.

The site is not launched. See `TODO.md` for what stands between this and taking money.

## History

Until 12 November 2026 this repository held a different, placeholder brand ("HALF SOUR")
with a large AI-operated admin behind it. That code was removed for the Quick Pickle
rebuild and is intact in git history at commit `9f2531f`.
