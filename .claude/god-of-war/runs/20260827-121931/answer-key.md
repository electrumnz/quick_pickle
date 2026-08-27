# Answer key — engineering-graded units

Binary. A check that cannot be evidenced is FALSE. Read-only to builders.

## Universal (every code unit)
- M1  `npm run build` exits 0. Evidence: build output.
- M2  `npm run typecheck` exits 0 with zero errors. Evidence: tsc output.
- M3  `npm run lint` exits 0. Evidence: lint output.
- M4  No `any`, no `@ts-ignore`, no `eslint-disable` added without an adjacent one-line justification.
- M5  No secret, key or password appears in any committed file. Evidence: grep output.
- M6  No raw hex colour or magic ms duration outside lib/brand/. Evidence: grep output.

## A2 Design tokens
- M7  Every foreground/background pair defined in tokens meets WCAG AA (4.5:1 body, 3:1 large).
      Evidence: computed contrast table.
- M8  Dark mode values are separately authored, not programmatic inversions of light.

## B1 Repo + Vercel + CI
- M9  CI runs typecheck, lint, test and a Lighthouse budget on every push. Evidence: Actions run URL.
- M10 A preview deployment URL responds 200. Evidence: curl output.

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
