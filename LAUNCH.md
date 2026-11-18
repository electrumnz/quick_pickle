# Quick Pickle: the go-live checklist

Everything between today and the shop taking real money, in the order to do it. Written
18 November 2026 (New Zealand time).

**For Ash.** Most of this is you, not code: setting up accounts, deciding things, and
typing the answers into the back end. Your AI helper does the technical steps and ticks
the boxes here as each one is done. Hand it this file and say "work through LAUNCH.md
with me".

**Who does what:**

- **Ash:** you, in the back end or an account's own website.
- **AI:** your AI coding helper, in this repository.
- **Sam:** Sam, while the accounts are still his.

The back end keeps its own version of the last part, and it cannot go out of date:
**Settings, Go-live list**. When this file and that screen disagree, the screen is right.
[TODO.md](TODO.md) has the reasons behind each item at more length.

## For the AI helping Ash

Read these before changing anything. They hold for any AI, not only Claude.

1. **Read [CLAUDE.md](CLAUDE.md) first.** It is this repository's rulebook: how the site
   is built, the rules that come from the law, and why each decision was made.
2. **Ask Ash once how much you may do without asking**, and write her answer in
   CLAUDE.md under "Whose it is", with the date and her words. Until she has answered:
   open a pull request, say what it does in a sentence a shop owner can follow, and
   wait for her yes before merging it. Do the same before any change to the live
   site's settings other than `status`.
3. **The law's rules are not hers or yours to bend in a chat.** No health claims, every
   fact literally true, no em dashes in anything a customer reads. `npm run audit:copy`
   enforces it, and [legal/COPY-RULES.md](legal/COPY-RULES.md) says where each rule
   comes from.
4. **Most items here are not code.** Prices, delivery, the ship date, the label, the
   company and the contact address are typed in the back end (Settings, The shop, and
   Settings, The label and the company). Never change `content/offer.ts` to set one.
   Tell Ash which screen.
5. **Live settings change through a commit.** The hosting, the database and Stripe are
   changed by a pull request to `.github/infra-request.json`, then read in the "Infra"
   run's log on `main`. [docs/ACCOUNTS.md](docs/ACCOUNTS.md), under "What the
   repository can do for itself", lists every action.
6. **Never ask for a key or password in the chat, and never write one in a file.** Ash
   puts keys in GitHub's secrets or Vercel's settings herself. The scripts print names,
   never values.
7. **A change is finished when `npm run build` and the tests pass.** Tick the item here,
   with the date, in the same pull request. Keep [HANDOVER.md](HANDOVER.md) and
   [TODO.md](TODO.md) true as well.

## 1. Hand the accounts over

Each step is written out in [docs/ACCOUNTS.md](docs/ACCOUNTS.md), under "The order to do
it in", with links to each provider's own instructions. The shop stays up throughout.

- [ ] **Ash makes her accounts:** GitHub, Vercel, Supabase and an AI coding tool, each
      under an email address she will keep. **Who:** Ash
- [ ] **The database:** Sam makes Ash an owner of the Supabase organisation, and she
      accepts. **Who:** Sam, then Ash
- [ ] **The code:** Sam transfers the GitHub repository to Ash, and she accepts. Then
      check that Settings, Secrets and variables, Actions still lists the four `QP_`
      names. **Who:** Sam, then Ash
- [ ] **The hosting:** Sam transfers the Vercel project `quick_pickle` to Ash's account.
      She checks it is still joined to the repository (the project's Settings, Git) and
      that the site still loads. **Who:** Sam, then Ash
- [ ] **Tell the repository where the hosting went.** Three lines in
      `.github/workflows/infra.yml` name the Vercel account. Ash reads the account's
      name and id and the project's id off Vercel's Settings, General. **Who:** Ash,
      then AI. **Done when:** the "Infra" run on `main` passes.
- [ ] **New keys for the repository.** Ash makes a Vercel token and a Supabase access
      token in her own accounts, and puts them in the repository's secrets as
      `QP_VERCEL_TOKEN` and `QP_SUPABASE_ACCESS_TOKEN`. Sam deletes his. **Who:** Ash,
      then Sam
- [ ] **Ash's own login to the back end.** Whoever has the PIN invites her as an owner
      (Settings, Staff, Invite someone), and she chooses a password from the link.
      [HANDOVER.md](HANDOVER.md) has the steps under "Getting in". **Who:** Sam, then
      Ash
- [ ] **Payments:** Sam makes Ash the owner of the Stripe account. **Who:** Sam, then
      Ash
- [ ] **Sam steps back:** leaves Supabase and Stripe, deletes his tokens, disconnects the
      old `half-sour` Vercel project from the repository, and clears what the build left
      on his Claude account. The list is in [docs/ACCOUNTS.md](docs/ACCOUNTS.md), step 6.
      **Who:** Sam
- [ ] **Say how much the AI may do without asking**, as in "For the AI" above. **Who:**
      Ash, then AI

## 2. Decide, and type it into the back end

No code. Each is set on its screen, then confirmed with your name beside it on
**Settings, Go-live list**. The site keeps search engines out until all seven are
confirmed.

- [ ] **Packs and prices.** 6, 12 and 24 at $27, $48 and $84 (The Trial, The Starter, The
      Squad) are stand-ins. Settings, The shop. **Who:** Ash
- [ ] **What the label says:** the ingredients list, the allergen line if there is one,
      and the storage line, typed word for word with the printed label in your hand.
      Settings, The label and the company. **Who:** Ash
- [ ] **The ship date**, if it opens as a pre-order. Settings, The shop. **Who:** Ash
- [ ] **Delivery:** where you send to and the three rates ($7 flat, $4.50 rural, free over
      $60 are stand-ins). Settings, The shop. **Who:** Ash
- [ ] **The fine print.** Read the delivery, returns, terms and privacy pages. They make
      promises in your name. Say they are right on the go-live list, or ask the AI to
      change them. **Who:** Ash
- [ ] **The customer email address.** Settings, The shop. **Who:** Ash
- [ ] **Who the company is:** the legal name, NZBN, address, and whether it is registered
      for GST. Settings, The label and the company. **Who:** Ash
- [ ] **Two Lucky poses** made from your art: celebrating (the "order's in" page) and
      asleep (the empty jar and the missing page). Nod them through, or ask for them to
      be replaced. **Who:** Ash
- [ ] **The film on the page.** The Face plays under the ritual. Keep it, or ask the AI to
      take it off or swap it. **Who:** Ash

## 3. Set up what the shop runs on

- [ ] **Point the domain at the shop.** Ash adds two records at 1st Domains:
      [docs/ACCOUNTS.md](docs/ACCOUNTS.md), under "The shop's own domain", has them and
      the screens. **Who:** Ash
- [ ] **Switch the shop over to the domain.** Once the "Infra" run's `status` says
      `quickpickle.co.nz` is answering: an infra request for `use-domain` and `redeploy`
      with `"domain": "quickpickle.co.nz"`, then `LIVE_SITE` in
      `lib/backstage/plans/starter/export.ts` and `npm run docs:export`. **Who:** AI.
      **Done when:** https://quickpickle.co.nz shows the shop, and its links and emails
      use that address.
- [ ] **A hosting plan meant for a business.** Vercel's free plan is for personal
      projects. Before the shop opens to the public, move the project to Vercel Pro
      (about US$20 a month) in Vercel's Billing settings. Moving to Cloudflare is the
      cheaper road and a real job: [TODO.md](TODO.md) sets the two side by side.
      **Who:** Ash
- [ ] **Database backups.** Supabase only backs a project up every day on its paid plan.
      Move the organisation to it (Billing), then check that the project's Backups page
      lists one. **Who:** Ash
- [ ] **Send the shop's email.** A Resend account for Quick Pickle, the domain added and
      verified there (its DNS records go in at 1st Domains), a sending key, then three
      settings on Vercel: `MAIL_PROVIDER`, `RESEND_API_KEY`, `MAIL_FROM`. The steps are
      in [TODO.md](TODO.md), under "Connect email". **Who:** Ash makes the account, the
      key and the settings, and the AI talks her through it. **Done when:** the go-live
      list says Order emails: Connected.
- [ ] **Hear back from email: the inbox and bounces.** A webhook in Resend and
      `RESEND_WEBHOOK_SECRET` on Vercel. Decide first where the domain's mail lands: a
      1st Domains mailbox and the shop's inbox cannot both take the same address. The
      steps are in [TODO.md](TODO.md), under "Connect the inbox". **Who:** Ash, with the
      AI. **Done when:** Inbox settings says Hearing from Resend: On.
- [ ] **Finish Stripe's sign-up:** the business's details and a bank account. **Who:**
      Ash
- [ ] **Roll Stripe's test keys**, because Sam has seen them. Put the new ones in the
      repository's secrets, then an infra request for `stripe-check` and
      `connect-stripe`. **Who:** Ash, then AI

## 4. Before it takes real money

- [ ] **Retire the PIN.** Whoever comes in with it swaps it for an email and a password
      (Settings, Staff, the panel at the top). It asks for the set-up code. Then switch
      off any login that is not yours. **Who:** Ash
- [ ] **Record the first real batch** in Stock, with the best-before date printed on its
      bottles, before the first order is packed. An order packed with no batch on sale
      is on no recall list. **Who:** Ash
- [ ] **One test purchase by a person**, on the live site with Stripe's test card
      (4242 4242 4242 4242, any future date, any three digits). Stripe's payment page
      will not let a robot press Pay, so nobody has seen this work end to end. Then
      refund part of it from Stripe's dashboard. **Who:** Ash. **Done when:** the order
      shows as paid, then part refunded, and a receipt arrived.
- [ ] **Switch Stripe to live keys.** Live keys in the repository's secrets, then
      `connect-stripe` and `redeploy`. **Who:** Ash, then AI. **Done when:** the
      go-live list says Payments: Live.
- [ ] **The go-live list is all green**, and `npm run prelaunch` agrees when it is given
      the database's address. **Who:** Ash and AI
- [ ] **Once the site is open to search:** set `categories:seo` in `lighthouserc.json`
      back from `warn` to `error`. **Who:** AI

## 5. Soon after launch

- [ ] **The first email to the Pickle Crew**, sent while the list is only yourselves.
      Open it on a phone and press its unsubscribe link. The how-to "How to email the
      Pickle Crew" (Plans) has the steps. **Who:** Ash
- [ ] **Tell pre-order customers the ship date**, if it opened as a pre-order: one press
      on Settings, The shop, once email is connected. **Who:** Ash
- [ ] **Connect Claude to the back end**, only if you want to run the shop by chat
      (Settings, Claude). [TODO.md](TODO.md) says what to look at the first time.
      **Who:** Ash
- [ ] **The privacy page** says the shop may be run with an AI assistant. If that never
      happens, ask the AI to take the line out. **Who:** AI
