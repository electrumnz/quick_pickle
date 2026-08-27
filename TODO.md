# HALF SOUR — what's done, what isn't

Updated 2026-08-27. Honest status, not a summary.

## Needs the founder — nobody else can do these

- [ ] **Shopify API tokens.** The deployed app cannot talk to Shopify without them, and
      creating them is refused to AI tools as access escalation. Shopify admin →
      Settings → Apps and sales channels → Develop apps. Exact scopes are listed in
      `.claude/god-of-war/runs/20260827-121931/decisions.md`. Paste both tokens into the
      Vercel project env vars, then set `COMMERCE_PROVIDER=shopify`.
- [ ] **Vercel production branch → `main`.** Settings → Environments → Production →
      Branch Tracking. Currently tracks the working branch. Not urgent; every commit is
      pushed to both refs.
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

## In progress

- [ ] **Homepage** — the most visible gap. `half-sour.vercel.app` still shows the scaffold
      placeholder. The 3D system exists; the page that consumes it is being built.
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
