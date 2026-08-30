# HALF SOUR — what's done, what isn't

Updated 2026-08-27. Honest status, not a summary.

## Needs the founder — nobody else can do these

This section is one half of a pair. The other half is `content/go-live.ts`, which the
admin renders at `/admin/go-live` with a message she can paste into Claude Code for each
one. **Both have to change together**: `tests/admin/go-live.test.ts` fails when the items
here and the entries there disagree on what exists, what it is called, or what is done.
The order below is the order to do them in.

- [ ] **Verify the kawakawa supplier.** No 04 WILD's live Shopify description names a
      Tairāwhiti kawakawa grower who is not a relationship. That is a false
      place-of-origin claim under Fair Trading Act s 13(j), it is published to real
      customers right now, and it is the only item here with legal exposure. Take the
      paragraph out or make it true. `legal/COPY-RULES.md` Group G carries the full note.
- [ ] **Shopify API tokens.** The deployed app cannot talk to Shopify without them, so no
      money can be taken, and creating them is refused to AI tools as access escalation.
      Shopify admin → Settings → Apps and sales channels → Develop apps. Exact scopes are
      listed in `.claude/god-of-war/runs/20260827-121931/decisions.md`. Paste both tokens
      into the Vercel project env vars, then set `COMMERCE_PROVIDER=shopify`.
- [x] **Point the live site at the finished build.** Vercel → Settings → Environments →
      Production → Branch Tracking still tracks `claude/pickle-juice-brand-site-qu6jrr`.
      **This is the single thing standing between the built homepage and the live site**:
      `main` carries it and deploys green, but `half-sour.vercel.app` serves whatever the
      tracked branch last built, which is still the scaffold. Flip it, then redeploy
      `main` from the dashboard. Neither Vercel token in the environment is valid, so an
      agent cannot do this — the API rejects both with `invalidToken`. Once flipped, drop
      the dual-pushing paragraph from CLAUDE.md.
- [ ] **Change the admin password.** The current one follows the most predictable human
      pattern — a word, a year, a punctuation mark. It is the only thing between the
      internet and the whole business. `lib/auth/scripts/` generates a new argon2id hash.
- [x] **An AI Gateway API key.** The eight roles now call real models through the
      Vercel AI Gateway, and the one thing that cannot be created from here is the
      key. Mint it at Vercel → AI → API Keys and paste it into the project as
      `AI_GATEWAY_API_KEY`. Without it nothing breaks — the site, the shop and the
      admin all work — but every agent run stops at its first model call and the
      admin carries a banner saying so. **The default models are free only until
      Sunday 6 September 2026**; after that the roster refuses to call them rather
      than spending money nobody approved, and resuming means setting
      `HALF_SOUR_AGENT_MODEL` to a model you have chosen to pay for
      (`minimax/minimax-m3` is the paid twin, USD 0.30/1.20 per million).
- [ ] **Decide whether customer writing may train someone else's model.** The concierge
      and the trade role send what customers and venues wrote to MiniMax through the
      gateway. The gateway's catalogue reports `no_training: "none"` for both free
      model ids, so the gateway filter that would refuse such a provider cannot be turned
      on while those are the models. `AI_GATEWAY_DISALLOW_PROMPT_TRAINING=1` plus a paid
      id is the combination that does; it is a decision about customers, not code.
- [ ] **Delivery rates confirmed with a courier.** `legal/shipping-returns.md` still
      carries `[$X]` for standard, rural and overnight, and for the value above which
      postage stops being charged. Nothing has been quoted by a carrier, so the delivery
      page, the terms and the checkout are all quoting a number the build invented.
- [ ] **The legal entity, NZBN and address.** `legal/terms-of-sale.md` still has these
      unresolved, which is why `/terms` publishes only the settled half — the rights a
      buyer has — and names no company. An invoice without an NZBN is one a trade
      customer will send back.
- [ ] **Your own Vercel, GitHub and Shopify accounts.** The three accounts this business
      runs on. Check for each who owns it, who is billed, and whether the founder can
      sign in unaided. Any answer of "no" is a day she cannot reach her own business.
- [ ] **A domain of your own.** `halfsour.co.nz` and `halfsour.nz` are available;
      `halfsour.com` is registered but parked. Not purchased — deliberately.
- [ ] **Trademark filing.** HALF SOUR is clear in NZ class 32 (checked via TMview, 27 Aug
      2026 — IPONZ blocks non-browser clients). Two conditions from that search:
      file the **composite** mark (drawn wordmark + device) rather than the plain words,
      because "half sour" is the category term and would likely fail on distinctiveness;
      and file **class 32 first**, because class 33 contains SOURZ (Jim Beam).
- [ ] **The Instagram and TikTok accounts.** Neither exists. The handles are free until
      somebody else takes them, and the admin's social screen has nowhere to post until
      they do.
- [ ] **Real product photography.** Every AI image service was unreachable during the
      build (connector blocks invoke, ZeroGPU needs a token, FLUX spaces returned 503).
      The bottle line-up and labels are authored vector art instead, which is better than
      AI-garbled label text but is not photography.

## Repo hygiene worth fixing

- [x] **Private builds no longer scribble on `tsconfig.json`.** `next build` appended
      `<distDir>/types/**` to `include` with a literal string check, so a wildcard could
      not pre-satisfy it and every agent's private `NEXT_DIST_DIR` left another entry —
      nineteen at the worst. `next.config.ts` now hands a private build its own
      gitignored `tsconfig.scratch.json`. An ordinary `.next` build still REFORMATS
      `tsconfig.json` (whitespace, no new entries); that is Next's own behaviour and is
      left alone.

- [ ] **Evidence files churn on every test run.** `lib/agents/evidence/*.txt`,
      `lib/auth/evidence/*.txt` and `components/strategy/evidence/*.txt` embed a
      wall-clock timestamp and a fresh run UUID, so running the suite dirties the
      tree with ~20 lines of meaningless diff. The cost is not the noise: it is
      that a real behavioural change is invisible inside it, which defeats the
      point of committing evidence at all. Fix by seeding the run id and dropping
      the timestamp — evidence should record what happened, not when.

      **It is not only the clock.** Some captures change with the ambient
      environment too, so seeding the run id is necessary and not sufficient.
      `lib/agents/roster/evidence/14-ward-security.txt` is the clearest case:
      run with `HALF_SOUR_DEMO=1` its headline is "This admin opens without a
      password", and run without it the same code reports "7 credentials are not
      configured" and names them. Both are correct; they are answers to different
      questions. `11-b2c-b2b-separation.txt` drifts a different way — its seeded
      dates are anchored on `now()`, so "58 days ago" becomes "57" simply by
      running tomorrow. A capture has to pin the environment it describes, or say
      in the file which one it was taken in.

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
      to bite** (deliberately breached at CLS 0.194 against a 0.02 budget, then removed).
      It bit again for real on the homepage commit — script transfer 479,827 against a
      400,000 ceiling and performance 0.55 against a 0.95 floor, both from the WebGL
      hero. Now green: 189,803 bytes, performance 0.95, CLS 0.000, and the accessibility,
      SEO and practices categories all 1.00.
      **Performance is RED on CI and 0.95 is not reachable there.** Six runs of identical
      code across two independent CI runs scored 0.57, 0.86, 0.92, 0.93, 0.93, 0.94 —
      medians 0.93 and 0.92, and never once 0.95. The same commit scores 0.95 / 0.95 /
      0.95 on a quiet machine. The runner is heavily contended and the spread is far
      wider than the margin, so **re-running will not clear this** and it should not be
      treated as a flake.
      The obvious lever was tried and does not work: dropping `MotionRoot` (GSAP + Lenis)
      saves 54 kB of script — 189,803 down to 136,173 — but measured _worse_ TBT and LCP
      under a 6x CPU throttle. GSAP and Lenis are not the bottleneck; the remaining
      ~136 kB is the React and Next client runtime booting, which cannot be cut without
      going static-only.
      So this is a threshold question, not a code one. The realistic options are to lower
      `categories:performance` in `lighthouserc.json` to something the runner can actually
      hold (~0.90 is still a strong bar) or to accept the job as documented-red. **Do not
      lower it silently** — the previous session built this gate deliberately and proved
      it bites. It is the founder's call and it has been put to them.
      Worth weighing: the gate measures `next start` on a shared runner, not the real
      site. Production sits on Vercel's edge and is faster than anything CI scores.
      The **Lint step is still red and always was** — 27 ESLint errors plus a Prettier
      failure in `components/3d/` and `lib/commerce/`, untouched by the homepage work.
- [x] Vercel project, live and public
- [x] **No. 04 WILD is a first-class product.** `brand/assets/label-04-wild.svg` is
      drawn by `brand/_src/build_labels.py` alongside the other three — same grid, same
      outlined letterforms, no live `<text>` — with Dill, the second accent, as its seal
      and foot band rather than a recolour of SMOKE. `bottles.svg` is regenerated from
      the same SKU list and is now four bottles at 1500x900. The catalogue carries it
      too: HS-04-500 at 2600c NZD in `supabase/seed.sql`, `lib/commerce/seed/` and
      `supabase/migrations/20260103000100_catalogue_no_04_wild.sql` (the migration is how
      a database that already exists gets it, since the seed truncates). Stock is 17
      bottles off one 40-bottle run, which is a real low-stock state and not a posed one.
      Still short: the brand guide's own header and label strip (`brand/_src/build_guide.py`)
      list three products, and Shopify holds no image for HS-04-500, so the mirror row
      carries a null `hero_image_url`.
- [x] **Homepage** — hero, the range as a back-bar spec sheet, the four serves, the
      kitchen band and the four-step process. Renders `components/home/data.ts` and
      `content/brines.ts`; carries no copy of its own. Checked in Chromium at 1440 and
      390, light and dark, and with reduced motion forced: no horizontal overflow, no
      console errors, no failed requests. Built and on `main` — **not yet on the live
      domain**, see the branch-tracking item above.
      The hero is the drawn range illustration, not the 3D bottle — that was dropped on
      the founder's call after CI went red and the render was judged to look cheap. The
      3D system is untouched and still live at `/lab/bottle`; what it would take to earn
      a place back on the homepage is in
      `.claude/god-of-war/runs/20260827-121931/decisions.md` 14. `Hero.tsx` is now a
      server component with no client JavaScript.
      `components/home/routes.ts` filters out the eight nav destinations whose routes do
      not exist yet rather than linking to 404s.
- [x] Storefront, live and audited — homepage, shop, four product pages, recipes,
      wholesale, delivery. The hero band spans 67% of a 1920x900 window and 91% at
      1920x1080, at a magnification capped below what the founder called too zoomed;
      full bleed at 768 and at 1280x900. CLS 0.000.
- [x] Demo mode — `HALF_SOUR_DEMO=1` serves the whole deployment from a PGlite image
      compiled into the build. No Supabase, no credential. Opt-in: unset, nothing changes.
- [x] Simulated checkout — `/checkout/mock/[id]`. A demo visitor completes a purchase and
      the order appears in `/admin/orders`. It cannot be mistaken for a payment page, and
      that is asserted structurally: no field a card could go in, no `cc-*` autocomplete.
      Shopify's hosted checkout is untouched behind two independent locks.
- [x] Agent roster on the Vercel AI Gateway — eight roles on `minimax-m3-free` and
      `minimax-m2.7-free`, free until 6 September 2026. After that the roster refuses to
      call them rather than spending money nobody approved, and says so on every run.
- [x] Ask the team — a capability-routed chat at `/admin/chat` with a floating dock, plus
      `hand_off` so one agent can ask another. The approval gate was attacked nine ways
      and refused every one, including the founder asking for the bypass directly with a
      model scripted to comply.
- [x] Social calendar — `/admin/social/calendar`, month and week over `social_posts`, with
      the gaps named in words. It uncovered a live bug: scheduling parsed the field with
      `Date.parse` against a UTC server, so 5pm stored as 5am next morning in Auckland —
      every post ever scheduled was out by 12 or 13 hours. Fixed, with both DST mornings
      handled explicitly.
- [x] Go live — `/admin/go-live`, the founder's remaining list with a copy button per task.
- [x] The overlay trap — clicking outside the chat dock, the command palette or MobileNav
      never dismissed them, because the backdrop covered the wrapper the handler was on.
      Escape saved a laptop; a phone has no Escape key, so the page would not scroll and
      no link answered until a reload. Fixed in all three, with a test that fails 4
      against the old code.

## In progress

Nothing. The tree has no uncommitted changes and `main` is deployed.

## Not started

- **The funnel** — quiz, order bump, upsell, abandoned cart. None of it exists.
- **Onboarding** — there is no first-run path; the admin assumes the business is
  already there.
- **The wholesale rail on Shopify draft orders** — `/wholesale` is a front door that
  captures interest; it does not raise a draft order.
- **Drag-and-drop rescheduling** on the social calendar. Deliberately not built: a form
  works from a keyboard and with scripting off. An addition, not a replacement.
- **Quarter view** on the calendar, and a "fill this gap" hand-off to the social agent.

## Known issues

- **The copy scanner is not actually enforced anywhere automatic.** `CLAUDE.md` calls it
  machine-enforced and gives the command, but `.github/workflows/ci.yml` does not run it
  and no test invokes it — it is a manual gate that depends on somebody remembering. It
  passed over `app components content lib` at the last run (480 files, 0 findings), but
  that is a fact about today, not a guarantee about tomorrow. Wiring it into CI needs a
  scope decision first: `brand/brand-guide.md` carries 12 RESTRICTED findings that are
  the brand's own vocabulary, so a naive `audit-copy.mjs .` would fail on day one.
- **`CLAUDE.md` and `TODO.md` themselves do not pass the scanner**, and should not be
  expected to: both enumerate the forbidden terms in order to forbid them, the same
  meta-document case as `legal/COPY-RULES.md` and `lib/assets/README.md`. Neither is in
  the scanned scope today. If the scan is ever widened to the repository root, register
  them rather than rewording them.

- **The brand guide still lists three products.** `brand/brand-guide.md` names HOUSE,
  DIRTY and SMOKE in both its intro (lines 171-176) and its range table (417-419); No 04
  WILD is in neither, though it is a live SKU at $26. This is what agents read for voice,
  so WILD has no brand copy to write from — and it is the bottle whose copy carries the
  most claim risk, because kawakawa has strong rongoa associations. Writing it needs a
  human decision about positioning, not a patch.
- **The demo database is per-process.** `lib/demo/database.ts` memoises PGlite on
  `globalThis`, so every serverless instance opens its own copy of the compiled-in image.
  Measured against production: 10 sequential add-to-cart requests all saw the cart; 14
  parallel requests with the same cookie saw it twice and lost it twelve times. Reads
  agree because every instance opens the same image; writes do not. One visitor at a time
  can complete a purchase. Fixing it means a real `SUPABASE_DB_URL`, which by design
  closes the open admin (`demoOpensAdmin` requires the compiled-in image) — a deliberate
  decision, not a patch.
- **Nothing resumes a parked approval.** Approving stamps the row, but the halted run
  only picks up again under Inngest's `waitForEvent`, which no deployment wires. The
  admin no longer claims otherwise.
- **`queue_social_post` never creates a `social_posts` row.** It writes to the outbox
  (`lib/agents/roster/outbox.ts`); nothing anywhere inserts into `public.social_posts`.
  So the social agent raises an approval and cannot put a draft on the calendar.
- **`tests/strategy/storefront-audit.test.ts` fails against an unstocked database.** It
  starts its own `next dev` and audits the running storefront, so with a local Postgres
  whose products have zero inventory the pages render their sold-out state and the buy
  control it looks for is absent. Three checks fail for that reason and not for any
  defect. It passes in demo mode, which is what production runs.
- **`agents.schedule_cron` is decorative** — nothing reads it, on any deployment.
- **`STATE.checkoutNotLive` is unreachable.** `checkoutKind()` only returns `unavailable`
  when the provider throws, and that same condition makes the catalogue degraded, which
  wins first. Correct defence; nothing exercises it.
- Vercel tracks `main`, and `vercel.json` disables deployments for the working branch,
  so only a push to `main` reaches production.
