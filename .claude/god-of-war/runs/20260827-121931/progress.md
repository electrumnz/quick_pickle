# HALF SOUR — live progress

Run 20260827-121931 · Branch claude/pickle-juice-brand-site-qu6jrr · PR #1 (draft)

> **A second session ran on 2026-08-27 after this one hit its usage limit.** It worked on
> `claude/website-deployment-recovery-0dxugq` (PR #2), built C2b, and pushed to `main`.
> Everything it changed is in Amendments 6-7 and decisions.md #4-#13. Read those before
> resuming: it touched files this run owns, and it moved the site chrome out of
> `app/(site)/layout.tsx`. Its commits are c10efc0 and b37b36a.

## Live
- **Homepage preview (C2b):** https://half-sour-git-main-keecenzvm-9355s-projects.vercel.app — HTTP 200, serves the real homepage
- **PR #2 preview:** https://half-sour-git-claude-website-de-82ac50-keecenzvm-9355s-projects.vercel.app
- **PRODUCTION (half-sour.vercel.app): still the scaffold.** Branch Tracking still points at
  `claude/pickle-juice-brand-site-qu6jrr`, so neither `main` nor PR #2 reaches the live domain.
  See decisions.md BLOCKER 2 — needs the user, cannot be done by an agent.
- **Vercel project:** half-sour, prj_XkBgElMViioagVXbfA6J644ZcWe5 — new project, correctly separate
- **CI:** `npm run lint` is RED and was already red before C2b — 27 ESLint errors plus a Prettier
  failure, all in `components/3d/` and `lib/commerce/`. Measured against a true baseline
  (`git stash -u`): 34 problems before C2b, 34 after. Build green, 386/386 unit tests pass.
  The e2e and Lighthouse jobs went red on the first homepage commit and were both genuine C2b
  regressions; both are fixed — see decisions.md 14 for the evidence and the numbers. The
  **Lint job remains red and is nobody's regression**; it needs the 3D and commerce units.
- **Copy audit:** exits 1 on `main` — 18 restricted, **0 banned**. All pre-date C2b and all sit in
  `content/`, `components/3d/tools/`, `app/(site)/lab/`. They need human sign-off markers.
- **Shopify:** Picklin Jews, NZD, Pacific/Auckland, empty catalogue, full read/write scopes

## Units
| Unit | Status | Note |
|---|---|---|
| B1 Repo/Vercel/CI | **built, awaiting critic** | ESLint pinned to 9.39.5 — eslint-config-next bundles an eslint-plugin-react that breaks on ESLint 10's rule-context API. Real fix, not a suppression. |
| A1 Brand identity | building | In research: IPONZ trademark + image generation |
| B2 Supabase schema | building | 2 migrations on disk (foundation, platform) |
| F1 Legal/compliance | building | Fetching MPI / FSANZ primary sources |
| C2a 3D bottle + brine shader | building | Dispatched early — geometry and shader are brand-independent, label is a texture slot |
| C2b Homepage | **built, awaiting critic** | Second session, PR #2. Hero/range/serves/making/footer, rendering `components/home/data.ts` verbatim. Verified in Chromium at 1440 and 390, light and dark, reduced motion forced: no horizontal overflow, no console errors, no failed requests. **Two C2a hand-backs it worked around rather than fixed — see below.** |

Remaining 19 units: see units.md.

## Amendments
1. Shopify live mid-wave → C1 unblocked, Wave 4 → Wave 3.
2. "Picklin Jews" confirmed placeholder → HALF SOUR stands.
3. Image/video generation granted → A1, C2, C3, D4, E2 upgraded.
4. Unattended overnight: no domain purchase, no paid resources, no real payments,
   no live social publishing. Reversible calls logged to decisions.md.
5. C2 split: C2a (3D system, brand-agnostic) dispatched ahead of the brand, C2b (hero
   page + scroll choreography) waits on A2 tokens.
6. **C2b unblocked and built by a second session.** A2 tokens had landed, and so had
   `components/home/data.ts`, `home.module.css`, `MotionRoot.tsx` and `use-motion.ts` — the
   whole C2b substrate was finished and simply had nothing importing it;
   `app/(site)/page.tsx` was still the scaffold. C2b was assembly, not new authoring. No copy
   was written: the page renders `components/home/data.ts` and `content/brines.ts` only.
7. **Site chrome moved out of the route-group layout.** `app/(site)/layout.tsx` is now a bare
   pass-through; the masthead and footer are `components/home/SiteHeader.tsx` and
   `SiteFooter.tsx`, composed by the page. Reason: the header's nav is a list of *this page's*
   sections, so mounting it around `/lab/*` would put anchors in the chrome that resolve to
   nothing there. **Consequence for whoever builds C3:** a product page must render the
   header and footer itself, or the chrome must move back into the layout with the section
   anchors made conditional. `FooterAdminLink` moved with the footer and is now only on the
   homepage.

## Handed back to C2a (3D unit)
**Superseded in part by decision 14: the 3D bottle is no longer on the homepage.** The
founder's call, after CI went red and the render was judged to look cheap. `components/3d/`
is untouched and `/lab/bottle` still runs the whole system; the homepage renders
`brand/assets/bottles.svg` instead, which carries the real drawn labels. Items 1 and 2 below
are still true of the 3D system and are now the price of putting it back on the homepage —
decisions.md 14 has the full list and the Lighthouse numbers behind it.
1. **`DEFAULT_FALLBACK_SRC` points at a file that does not exist.** `BottleHero` defaults
   `fallbackSrc` to `/3d/fallback/bottle-hero.png`; `public/3d/` contains only `env/` and
   `labels/`. Every reduced-motion and no-WebGL visitor would have got a broken image. C2b
   passes `/brand/bottles.svg` (the drawn range illustration) instead. Render the plate and
   the workaround can go.
2. **The shipped label texture is a UV registration card.** `DEFAULT_LABEL.textureUrl` is
   `/3d/labels/placeholder-label.png`, which renders the literal words "PLACEHOLDER LABEL"
   and "TEXTUREURL" across the bottle — visible and legible in the hero at 1440. C2b passes
   `{...DEFAULT_LABEL, textureUrl: undefined}`, which keeps the paper band and drops the
   text. The real artwork exists as vector at `brand/assets/label-01-house.svg`; it needs
   cutting to a texture the shader can map.

## Files C2b added or changed (ff346ba..b37b36a)

Nothing under `components/3d/`, `lib/`, `content/`, `supabase/`, `legal/` or `brand/` was
touched, so no other unit's work-in-progress is affected. `components/home/data.ts` was
already this unit's file; the only edit to it is decision #13 plus its doc comment.

| File | | What |
|---|---|---|
| `app/(site)/page.tsx` | ~ | The homepage. Was the scaffold placeholder |
| `app/(site)/layout.tsx` | ~ | Reduced to a pass-through — chrome moved to the page (Amendment 7) |
| `app/layout.tsx` | ~ | Added `metadata.icons`; nothing else |
| `components/home/Hero.tsx` | + | The hero. Started as a scroll-scrubbed WebGL bottle; now a **server component with no client JS**, rendering `brand/assets/bottles.svg` (decision 14) |
| `components/home/SiteHeader.tsx` | + | Masthead |
| `components/home/SiteFooter.tsx` | + | Footer, `surface-deep` / `text-on-deep`, carries `FooterAdminLink` |
| `components/home/routes.ts` | + | Live-route filter (decision #8) |
| `components/home/cx.ts` | + | Class-name join (decision #11) |
| `components/home/data.ts` | ~ | Decision #13 only — 4 lines |
| `public/brand/favicon.svg` | + | Copied from `brand/assets/` (decision #10) |
| `TODO.md` | ~ | Homepage moved to done; branch-tracking item rewritten as the blocker |

`home.module.css`, `MotionRoot.tsx` and `use-motion.ts` were **not** modified — C2b consumed
them as-is. Every class in the stylesheet is now used except the custom-cursor set
(`.cursor`, `.cursorRing`, `.cursorDot`, `.cursorLabel`), the `.disclosure` set and `.field`.
Those are still unconsumed and are presumably C2b polish or C3/C4 surface — they were left
alone rather than invented against.

A third, which is why the bottle floated: with the studio backdrop on, the dark painted room
cut a hard horizon straight across the bone page ground, so C2b set `backdrop={{ enabled:
false }}`. That removed the room *and* the contact shadow. A hero bottle needs grounding that
works on the page's own surface — that is the second item above.
