# Answer key — engineering-graded units

Binary. A check that cannot be evidenced is FALSE. Read-only to builders.

## Universal (every code unit)
- M1  `npm run build` exits 0. Evidence: build output.
- M2  `npm run typecheck` exits 0 with zero errors. Evidence: tsc output.
- M3  `npm run lint` exits 0. Evidence: lint output.
- M4  No `any`, no `@ts-ignore`, no `eslint-disable` added without an adjacent one-line justification.
- M5  No secret, key or password appears in any committed file. Evidence: grep output.
- M6  No raw hex colour outside lib/brand/. Evidence: grep output.
      SCOPE: owned by A2 (design tokens), NOT by the scaffold unit. app/globals.css must define
      something for the app to render before A2 lands, so grading B1 on it made the check
      unpassable by sequencing rather than by quality. A2 absorbs globals.css and must clear it.
      Tooling config (playwright/vitest timeouts) is exempt from the duration clause.

## A2 Design tokens
- M7  Every foreground/background pair defined in tokens meets WCAG AA (4.5:1 body, 3:1 large).
      Evidence: computed contrast table.
- M8  Dark mode values are separately authored, not programmatic inversions of light.

## B1 Repo + Vercel + CI
- M9a CI runs typecheck, lint AND test on every push. Evidence: Actions run URL.
- M9b A Lighthouse budget is ENFORCED in CI — an assertion config exists and a violation fails
      the build. Evidence: the assertion config file, plus a run URL where it actually gated.
      A run URL alone proves a run existed, not that a budget was asserted.
- M9c The e2e suite runs in CI, not just locally. Evidence: the workflow step and a run URL.
- M10 The preview URL for HEAD returns 200 AND the deployment serving it maps to a
      githubCommitSha equal to HEAD. Evidence: curl output plus the deployment metadata.
      "Responds 200" alone is satisfied by any successful build of any content, including an
      untouched create-next-app default, and cannot detect a production alias frozen on a
      stale CLI upload.
- M10b Production tracks git. The deployment behind the production alias must carry a
      githubCommitSha. Evidence: deployment metadata showing the sha.
- M10c WITHDRAWN. The user wants the demo publicly reachable and will share the production
      link directly, so open access is intended, not a defect.
- M10d The PRODUCTION alias half-sour.vercel.app serves the current work, not a stale upload.
      The user is sending this exact link to the client, so a frozen production alias is the
      single worst failure available in this build. Evidence: the production deployment's
      githubCommitSha equals the branch HEAD, plus curl of half-sour.vercel.app showing
      current content.

## B2 Supabase schema
- M11 Every table has RLS enabled. Evidence: query over pg_tables.
- M12 `get_advisors` returns zero ERROR-level security findings. Evidence: tool output.
- M13 Generated types contain no `any`.

## B3/C1 Commerce
- M14 The identical Playwright suite passes against MockProvider and (when credentialled)
      ShopifyProvider, with only an env var changed. Evidence: two run outputs.
- M15 Cart totals are recomputed server-side; a tampered client price is rejected. Evidence: test.

## B4 Admin auth
- M16 Password stored as argon2id, never plaintext or a fast hash. Evidence: the hashing call.
- M17 1000 wrong-password attempts result in lockout, and every attempt is in audit_log.
      Evidence: test output + row count.
- M18 Session cookie is HttpOnly, Secure, SameSite=Lax or Strict. Evidence: response headers.
- M19 The second-factor extension point is a real typed interface with a no-op implementation,
      not a comment. Evidence: the interface.

## C7 Performance / SEO / a11y
- M20 Lighthouse mobile >=95 for Performance, Accessibility, Best Practices, SEO on
      home, a product page, a collection page and a recipe page, WITH the 3D hero enabled.
- M21 axe-core reports zero violations on those same four pages.
- M22 With JavaScript disabled, the homepage still communicates the product and offers a
      route to buy. Evidence: no-JS screenshot.
- M23 With prefers-reduced-motion, no parallax/scrub/auto-motion runs, and the page is still
      a designed experience rather than a stripped one. Evidence: screenshot.
- M24 Cumulative Layout Shift <= 0.02 on all four pages.

## E1 Agent runtime
- M25 Any agent run reconstructs fully from its stored transcript. Evidence: replay output.
- M26 A deliberately triggered cost cap halts the run and records why. Evidence: log.
- M27 No agent can write to the storefront or send an external message without a row in
      `approvals` with an explicit approved state. Evidence: attempted bypass test.

## F1 Compliance
- M28 An automated scan of all site copy finds zero health, medical, nutrition-content or
      probiotic claims. Evidence: scan output + the term list scanned for.
- M29 Privacy policy covers the NZ Privacy Act 2020 information-privacy principles.

## Responsive — applies to EVERY unit that renders anything (storefront and admin alike)
- M30 Every page renders and every function works at 375px, 768px, 1280px and 1920px.
      Evidence: screenshots at all four widths, per page.
- M31 Every hover- or cursor-driven effect has a DESIGNED touch equivalent, not a disabled
      one. A magnetic cursor, a hover-reveal, a tooltip: on touch these must become something
      deliberate. "It just doesn't do that on mobile" is a fail. Evidence: the touch path,
      demonstrated.
- M32 No horizontal scroll at any width. No element overflows the viewport. Evidence:
      scrollWidth === clientWidth at all four widths.
- M33 Touch targets >= 44x44 CSS px with adequate spacing. Evidence: measured, not eyeballed.
- M34 Scroll-driven animation works with touch momentum scrolling, including the elastic
      overscroll on iOS Safari, without the pinned sequence detaching or juddering.
      Evidence: recorded on a real touch emulation, not a resized desktop window.
- M35 The 3D scenes hold >= 50fps on a mid-range mobile profile with CPU throttling applied,
      or drop to their lower quality tier automatically. Evidence: measured frame timings.
- M36 THE ADMIN IS MOBILE-USABLE. The founder will approve social posts, check orders and
      look at stock from her phone far more often than from a desk. Tables, approval queues
      and the Today inbox must be genuinely usable on a 375px screen — not a desktop layout
      squeezed. Evidence: the five-task walkthrough completed on a 375px viewport.
- M37 Forms work on mobile: correct input types and inputmode so the right keyboard appears,
      no zoom-on-focus (>=16px font), visible labels. Evidence: demonstrated.
