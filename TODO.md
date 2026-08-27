# HALF SOUR — what's done, what isn't

Updated 2026-08-27. Honest status, not a summary.

## Needs the founder — nobody else can do these

- [ ] **Shopify API tokens.** The deployed app cannot talk to Shopify without them, and
      creating them is refused to AI tools as access escalation. Shopify admin →
      Settings → Apps and sales channels → Develop apps. Exact scopes are listed in
      `.claude/god-of-war/runs/20260827-121931/decisions.md`. Paste both tokens into the
      Vercel project env vars, then set `COMMERCE_PROVIDER=shopify`.
- [ ] **Vercel production branch → `main`.** Settings → Environments → Production →
      Branch Tracking. Still tracks `claude/pickle-juice-brand-site-qu6jrr`. **This is now
      the single thing standing between the built homepage and the live site**: `main`
      carries it and deploys green, but `half-sour.vercel.app` serves whatever the tracked
      branch last built, which is still the scaffold. Flip it, then redeploy `main` from
      the dashboard. Neither Vercel token in the environment is valid, so an agent cannot
      do this — the API rejects both with `invalidToken`. Once flipped, drop the
      dual-pushing paragraph from CLAUDE.md.
- [ ] **Trademark filing.** HALF SOUR is clear in NZ class 32 (checked via TMview, 27 Aug
      2026 — IPONZ blocks non-browser clients). Two conditions from that search:
      file the **composite** mark (drawn wordmark + device) rather than the plain words,
      because "half sour" is the category term and would likely fail on distinctiveness;
      and file **class 32 first**, because class 33 contains SOURZ (Jim Beam).
- [ ] **Verify the kawakawa supplier.** WILD's description names a Tairāwhiti grower who
      does not yet exist as a relationship. That is a place-of-origin claim under Fair
      Trading Act s 13(j). Make it true or change the copy before launch.
- [ ] **Domain.** `halfsour.co.nz` and `halfsour.nz` are available; `halfsour.com` is
      registered but parked. Not purchased — deliberately.
- [ ] **Real product photography.** Every AI image service was unreachable during the
      build (connector blocks invoke, ZeroGPU needs a token, FLUX spaces returned 503).
      The bottle line-up and labels are authored vector art instead, which is better than
      AI-garbled label text but is not photography.
- [ ] **Change the admin password.** The current one follows the most predictable human
      pattern — a word, a year, a punctuation mark. It is the only thing between the
      internet and the whole business. `lib/auth/scripts/` generates a new argon2id hash.

## Built and verified

- [x] Brand identity — 39 drawn glyphs, palette with 23/23 sanctioned pairs passing AA
      (computed, not asserted), voice guide, four labels, rendered guide at
      `brand/guide.html`
- [x] Trademark clearance searched and documented
- [x] Design tokens — 261 tokens, semantic layer over pigments, contrast test in CI
- [x] Database schema — 33 tables, RLS throughout, commerce mirrors Shopify with webhook
      replay and sync cursors
- [x] Seed data — a business with four months of history, real NZ suppliers and regions
- [x] Admin auth — argon2id, rate limiting with lockout, sealed revocable sessions, CSRF.
      Forgery evidence: 207/207 single-bit flips rejected, attacker-keyed cookies
      rejected, revocation enforced
- [x] Compliance layer — copy rules citing specific FSANZ and Fair Trading provisions,
      plus a working scanner wired as a gate
- [x] 3D bottle system — procedural glass with refraction, brine shader with suspended
      particulate, pour scrubbing, automatic quality tiering. Live at `/lab/bottle`
- [x] CI — typecheck, lint, test, build, Playwright e2e, and a Lighthouse budget **proven
      to bite** (deliberately breached at CLS 0.194 against a 0.02 budget, then removed)
- [x] Vercel project, live and public
- [x] **Homepage** — hero, the range as a back-bar spec sheet, the four serves, the
      kitchen band and the four-step process. Renders `components/home/data.ts` and
      `content/brines.ts`; carries no copy of its own. Checked in Chromium at 1440 and
      390, light and dark, and with reduced motion forced: no horizontal overflow, no
      console errors, no failed requests. Built and on `main` — **not yet on the live
      domain**, see the branch-tracking item above.
      Two things it is honest about rather than faking: the hero drops the label texture,
      because the shipped one is a UV registration card that renders the words
      "PLACEHOLDER LABEL", and `components/home/routes.ts` filters out the eight nav
      destinations whose routes do not exist yet rather than linking to 404s.

## In progress

- [ ] Content — 20+ cocktail and food recipes, supplier stories, wholesale front door
- [ ] Commerce adapter — conformance suite runs against both providers
- [ ] Agent runtime — durable runs, cost caps, replayable transcripts, approval gate

## Not started

Product and collection pages · the funnel (quiz, order bump, upsell, abandoned cart) ·
motion system and page transitions · the admin shell and its nine destinations ·
orders and delivery · stock, batches and recipes · money and customers · brand hub ·
social approvals · the agent roster (B2C and B2B are separate agents — see M38) ·
the wholesale rail on Shopify draft orders · onboarding · performance and a11y pass

## Known issues

- The copy scanner's TH-02 rule was over-broad, flagging "cured" — correct food
  vocabulary here. Narrowing was requested; verify before trusting a clean scan.
- The brand guide header still lists three products; WILD was added afterwards.
- `main` and the working branch are kept identical by dual-pushing. Once Vercel tracks
  `main`, drop the second push.
