# Units — the split

Source: the 24 approved cards in /root/.claude/plans/my-friend-wants-a-quirky-hollerith.md
Each unit names its bar, what the critic inspects, and its dependencies.

| ID | Unit | Bar | Critic inspects | Depends on |
|----|------|-----|-----------------|------------|
| A1 | Brand identity | BRAND (goodgirlsnacks.com) | rendered brand/guide.html + SVG assets, side-by-side | — |
| A2 | Design tokens | ENGINEERING key | tokens file + a rendered swatch page, contrast measured | A1 |
| B1 | Repo + Vercel + CI | ENGINEERING key | CI run output + live preview URL | — |
| B2 | Supabase schema | ENGINEERING key | migrations applied to a branch + get_advisors output | — |
| B3 | Commerce adapter + mock | ENGINEERING key | Playwright run: browse->cart->checkout->admin order | B2 |
| B4 | Admin auth | ENGINEERING key | brute-force test output + cookie inspection | B2 |
| C1 | Shopify adapter | ENGINEERING key | same suite green against both providers | B3 |
| C2 | Homepage + 3D hero | STOREFRONT (Awwwards SOTD) | live page, screenshots, perf trace, no-JS + reduced-motion | A2,B1 |
| C3 | Product + collection | STOREFRONT | live pages, every state screenshotted | A2,B3 |
| C4 | Funnel | BRAND + ENGINEERING | walked end to end, events captured | C3 |
| C5 | Content + recipes | BRAND | rendered pages + schema.org validator output | A2,B2 |
| C6 | Motion system | STOREFRONT | recorded transitions, CLS measured | A2,C2,C3 |
| C7 | Perf/SEO/a11y | ENGINEERING key | Lighthouse + axe reports | C2-C6 |
| D1 | Admin shell + IA | ADMIN UX (Linear) | live admin, 5-task unaided walkthrough | A2,B4 |
| D2 | Orders & delivery | ADMIN UX (Shopify admin) | live, 20-order clear-down timed | B3,D1 |
| D3 | Stock/batches/recipes | ADMIN UX | live, batch->order traceability in <=3 clicks | B2,D1 |
| D4 | Social approvals | ADMIN UX | live queue, previews, scheduled publish | B2,D1,E1 |
| D5 | Money & customers | ADMIN UX | live dashboards, numbers traced to source rows | B2,D1 |
| D6 | Brand hub | ADMIN UX | live, agent output changes when a rule changes | A1,D1 |
| E1 | Agent runtime | ENGINEERING key | replayable transcript + cap triggered deliberately | B2 |
| E2 | Agent roster | ADMIN UX + BRAND | each agent's real output on seeded data | E1,D6 |
| E3 | Approval fabric | ADMIN UX (Linear) | every queue uses one component, one interaction model | E1,D1 |
| E4 | Onboarding + briefing | ADMIN UX | first-run session ends in a completed real task | D1,E2 |
| F1 | Legal & compliance | ENGINEERING key | copy audit output: zero health claims | — |
| F2 | Production deploy | ENGINEERING key | live domain + test order + runbook walkthrough | all |

## Waves
- Wave 1: A1, B1, B2, F1   (no dependencies; F1 early so copy rules bind every later writer)
- Wave 2: A2, B3, B4
- Wave 3: C2, C3, C5, D1, E1
- Wave 4: C1, C4, C6, D2, D3, D5, D6, E3
- Wave 5: D4, E2, E4
- Wave 6: C7, F2
