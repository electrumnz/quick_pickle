# Decisions taken unattended

Reversible calls made without the user while the campaign ran overnight.
Each records what was chosen, why, and what was NOT chosen, so any of them can be revisited.

| # | Decision | Chosen | Alternative not taken | Reversible? |
|---|---|---|---|---|
| 1 | Base branch for the PR | Created `main` at the scaffold commit via the GitHub API, so the feature branch has something to merge into | Leaving the repo with a single branch that is also the default, which makes a PR impossible | Yes — delete the branch |
| 2 | Hosting domain | Free Vercel domain | Buying halfsour.co.nz — explicitly forbidden by the user | Yes |

## Queued for the user — NOT actioned
- Purchase of `halfsour.co.nz` (and optionally `.com`, currently taken). User said not to buy.
- Renaming the Shopify store from "Picklin Jews" to the final brand. User granted permission,
  but it waits on A1's IPONZ trademark result so we rename once, not twice.
- Any paid Supabase project creation, if the schema needs a live database to verify against.
