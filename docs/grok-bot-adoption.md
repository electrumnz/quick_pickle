# Grok Bot adoption — Half Sour admin

Friend-facing notes for Samuel's friend. The in-site MiniMax roster is gone.
Half Sour keeps the brine business (stock, batches, recipes, shop, orders,
Mirror troubles). AI work is a person at the admin keyboard: **Grok Bot**.

Parked from [PR #3](https://github.com/electrumnz/pickled_jews/pull/3) (`cursor/grok-bot-deletion-retarget-ff48`, `bf0a467`). That PR is closed **without merge**. The 228-file agent-strip stays off `main`. This file is markdown only — not product code, not go-live.

## Why the roster is gone

The old admin had a live AI team, chat dock, run-now buttons and model spend.
That spent money from inside the site and duplicated what Grok Bot already does
well as an operator. Visibility now comes from the existing `audit_log` — every
write already stamps who did what.

There is no Half Sour MCP, no A2A rebuild, and no live Shopify client from this
admin for Bot work. Mirror remains schema + dashboard troubles only.

## Install Grok Bot

1. Install Grok / Grok Bot from xAI on the computer that will operate the admin.
2. Create a dedicated Bot profile on that machine (not a shared browser profile
   with personal passwords saved beside it).
3. Keep Cursor and xAI docs bookmarked for updates:
   - Cursor: https://cursor.com/docs
   - xAI / Grok: https://x.ai

## Sign into the admin on the Bot computer

1. Open **https://half-sour.vercel.app/admin** on the Bot computer only.
2. Sign in with the operator credentials the founder issued for Grok Bot.
3. Do not sign in as the founder from the Bot machine.
4. Confirm you can open Today, Stock & Batches, Orders, and the activity log.

Demo deployments may open the admin without a password for looking. Treat a real
deployment as password-gated. Never share the founder password in chat.

## Standing rules

- Culinary framing only. No health, recovery, gut, wellness or therapeutic
  claims — see `legal/COPY-RULES.md`.
- Provenance must be literally true. Unverified supplier facts stay marked
  `TODO: verify with supplier`.
- Kawakawa copy (No 04 WILD) stays strictly culinary.
- Money is integer cents. Do not invent floats in price paths.
- Prefer existing Server Actions that already call `authorise` + `audit()`.
- Mirror troubles on Today are sync/webhook failures — not a teammate to “ask”.

## Activity log

What Grok Bot does in this admin appears under **Activity** (`/admin/activity`)
and in Today's “while you were away” rail. That list reads `public.audit_log`
(newest first, Pacific/Auckland). Sign-ins/sign-outs and old agent-runtime rows
are hidden. Filters: stock / batches / orders / other.

Empty state means nothing has been written yet — work appears when the Bot uses
this admin.

## Never paste secrets

Do not paste into chat, Grok, Cursor, tickets or screenshots:

- `ADMIN_PASSWORD_HASH`, `ADMIN_SESSION_SECRET`
- Shopify Admin tokens (`shpat_…`)
- Supabase service role keys
- Any vault credential or customer PII dumps

If a secret may have leaked, rotate it in Vercel / the password manager and tell
the founder.

## Parked PR #3 — intended work (markdown only)

Do not merge #3. Do not undraft. Do not action this list into the codebase until
Nigel names go-live for this company and PR.

- [ ] Retarget admin from in-site MiniMax roster/chat/spend to Grok Bot (person at the keyboard).
- [ ] Keep brine: stock, batches, recipes, shop, orders; activity from `audit_log`.
- [ ] Leave agent SQL tables in place (no `DROP`). No new packages.
- [ ] Strip user-facing AI-team / agent-drafted / roster-name copy (MarketExplorer, Calendar, Social, Brand, Assets, campaigns). Do not `JOIN public.agents` for display names.
- [ ] Existing `half-sour` preview only. No Vercel prod until go-live is named. Lighthouse `minScore >= 0.95` is already red on `main` — do not treat that as this work.

## Pointers

- Admin: https://half-sour.vercel.app/admin
- Activity: https://half-sour.vercel.app/admin/activity
- This file in the repo: `docs/grok-bot-adoption.md`
- Brand / claims: `legal/COPY-RULES.md`
- Abandoned strip: https://github.com/electrumnz/pickled_jews/pull/3
