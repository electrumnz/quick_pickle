# Accounts, access and handing them over

Who holds what today, what moves to Ash, and how to move it.

Nothing in this file is a password or a key. It only names things and says where they
live. Written 16 November 2026 (New Zealand time).

Each provider changes its screens from time to time, so every step links to the
provider's own instructions. Read theirs before pressing anything.

## At a glance

| What                            | What it does here                    | Who holds it today                                        | At handover                                         |
| :------------------------------ | :----------------------------------- | :-------------------------------------------------------- | :-------------------------------------------------- |
| GitHub repository               | The code, the tests, these documents | Sam (`electrumnz/quick_pickle`)                           | Transfer the repository to Ash                      |
| Vercel project `quick_pickle`   | Hosts the site, on the free plan     | Sam's Vercel account (`electrumnz-9333s-projects`)        | Transfer the project to Ash                         |
| Supabase project                | The database                         | Sam, in an organisation that holds only Quick Pickle      | Make Ash an owner of the organisation               |
| Stripe account                  | Payments. Test keys only so far      | Sam. Stripe's own sign-up is not finished                 | Transfer ownership, then Ash finishes the sign-up   |
| Resend                          | Sends and receives the shop's email  | Nobody. Not made yet                                      | Ash makes it, in the business's name                |
| The domain `quickpickle.co.nz`  | The shop's own address               | Ash, at 1st Domains                                       | Hers already. Nothing to transfer                   |
| Xero, and a courier account     | The books, and sending parcels       | Not linked, on purpose. The back end makes files for both | Ash's own. Nothing to transfer                      |
| The brand pack, on Google Drive | Print masters, logos, Lucky, video   | Whoever owns the shared folder                            | Stays where it is. See the note below               |
| Claude                          | Wrote the code and looks after it    | Sam's Claude account                                      | Ash uses her own. See [HANDOVER.md](../HANDOVER.md) |

There is a second Vercel project to know about. An old one called `half-sour`, in the
Keece account, is still joined to this repository and builds a preview on every push. It
is not Quick Pickle's and nothing here can touch it. Sam disconnects it from the
repository in that project's own Git settings.

## The order to do it in

Nothing here stops the shop. While the pieces are moving, the live site goes on serving
what was last deployed. The one thing to avoid is changing code in the middle: start
when nothing is waiting to be merged, and finish before anybody asks Claude for a change.

### 0. Ash makes her accounts

GitHub, Vercel, Supabase and Claude, each under an email address she will keep. Stripe
can wait for step 4.

### 1. The database (Supabase)

Quick Pickle has its own Supabase organisation, with nothing else in it. The simplest
handover leaves the project where it is:

1. Sam invites Ash to the organisation as an **Owner**
   ([Supabase: access control](https://supabase.com/docs/guides/platform/access-control)).
2. Ash accepts.
3. Once Ash has made her own access token (below), Sam leaves the organisation.

The connection the live site uses does not change, so the site does not notice.

The other way is to move the project into an organisation Ash already has
([Supabase: project transfers](https://supabase.com/docs/guides/platform/project-transfer)).
Supabase asks that the person moving it owns the organisation it is leaving and is a
member of the one it is going to.

### 2. The code (GitHub)

1. Sam transfers the repository to Ash's GitHub account: Settings, General, the Danger
   Zone, Transfer
   ([GitHub: transferring a repository](https://docs.github.com/en/repositories/creating-and-managing-repositories/transferring-a-repository)).
2. Ash accepts.

GitHub's page says the issues, pull requests and history go with it, the old address
redirects to the new one, and the repository's secrets stay attached to it. Check that
last one afterwards: Settings, Secrets and variables, Actions should still list the four
names under "The repository's four secrets" below.

Until step 3 is done, a push will not deploy. That is expected.

### 3. The hosting (Vercel)

1. Sam transfers the project `quick_pickle` to Ash's Vercel account: the project's
   Settings, General, Transfer
   ([Vercel: transferring a project](https://vercel.com/docs/projects/transferring-projects)).
   Vercel's page lists what goes with it: the deployments, the settings, the environment
   variables, the link to the Git repository and the daily cron job.
2. Ash opens the project's Settings, Git, and makes sure it is joined to the repository
   at its new address. If it is not, she connects it. Vercel's GitHub app has to be
   allowed to see the repository under her GitHub account.
3. Check that the site still answers at its address, and that Settings, Environment
   Variables lists the names in "Settings on the host" below.

If a push stops deploying after the move, the deployment's own page on Vercel says why.
The first thing to look at is whether Vercel's GitHub app has been allowed to see the
repository under its new owner.

Then the repository has to be told where the project now lives. In
`.github/workflows/infra.yml`, three lines name the Vercel account and one names the
Supabase project:

| Line                      | What it is                           | Changes when                           |
| :------------------------ | :----------------------------------- | :------------------------------------- |
| `QP_VERCEL_TEAM_SLUG`     | The Vercel account the project is in | The project moves to Ash's account     |
| `QP_VERCEL_TEAM_ID`       | That account's id                    | The project moves to Ash's account     |
| `QP_VERCEL_PROJECT`       | The project's id                     | Check it after the move                |
| `QP_SUPABASE_PROJECT_REF` | The Supabase project                 | Only if the project itself is replaced |

None of the three Vercel lines is a secret. Vercel shows the account's name and id in the account's
own Settings, General, and the project's id in the project's Settings, General. Give
them to Claude and ask it to change the lines. It is one small change, and the
workflow's `status` run then says whether it can see the project. Until it is made, that
run fails on every push to `main`. It looks worse than it is: the site is not affected.

Two things about the plan. Vercel's free plan is not for a business that takes money: at
launch it is Vercel's paid plan, or another host. And the site was built so that moving
host stays cheap: the clock that runs things on a timer lives in the database, not at
Vercel.

### 4. Payments (Stripe)

The Stripe account exists and the live site runs on its **test** keys. Stripe's own
sign-up is not finished: it still wants the business's details and a bank account before
it will take a real payment. So the person who finishes it should be the person whose
business it is.

1. Sam invites Ash to the account as a Super Administrator, and once she has accepted,
   transfers ownership to her
   ([Stripe: change the owner of an account](https://support.stripe.com/questions/change-the-owner-of-a-stripe-account)).
2. Ash finishes the sign-up with the business's details and bank account.
3. Ash rolls the two test keys in Stripe's Developers section, because Sam has seen
   them, and puts the new ones in the repository's secrets (below). Then ask Claude to
   run `stripe-check` and `connect-stripe`, which saves the key on the host and makes a
   fresh signing secret for Stripe's news.

Or Ash opens a Stripe account of her own for the business. Then step 3 is the whole of
it: new keys in the repository's secrets, and the same two actions.

Going live later is the same step again with live keys in place of test ones.

### 5. What only Ash should know

Sam has seen these, so they change once Ash holds everything.

- **Who can sign in to the back end.** There is one login today, made on 16 November
  2026 with a PIN. Ash gets a login of her own by invitation, the PIN is retired, and
  Sam's login is switched off once he has stepped back.
  [HANDOVER.md](../HANDOVER.md) has the steps, under "Getting in".
- **The set-up code** (`BACKSTAGE_SETUP_CODE` on the host). While the back end has a PIN
  login, the code is the key behind it: whoever has the code can set a new PIN. Retiring
  the PIN ends that, because once the PIN has been swapped for an email and a password
  the code opens nothing. If the PIN is being kept for a while, Ash writes a new long
  phrase over the code in Vercel's settings and redeploys, because a changed setting
  only reaches the site with its next deployment: Vercel's Deployments page can do it,
  or ask Claude to run `redeploy`. The old PIN stops working from then, and she sets a
  new one with the new code (**Forgot the PIN, or locked out?** on the sign-in page).
- **The two access tokens** in the repository's secrets. See the next section.
- **Stripe's keys**, as in step 4.
- **The database's main password.** Supabase set one when the project was made. Nothing
  in this repository uses it: the site has a limited login of its own, and the workflow
  uses an access token. So changing it breaks nothing. Supabase's dashboard has a reset
  for it in the project's database settings.

Nobody has ever seen the password of the site's own database login, or the clock's
secret. The repository made both itself, kept them out of its own logs, and put them
straight where they are used, saved so that Vercel does not show them back.
They do not need changing for a handover. To change either anyway, ask Claude to run
`connect-database` with `"rotate": true`, or `connect-clock`.

### 6. Sam steps back

- Deletes the two tokens he made for this, in his own Vercel and Supabase account
  settings. Each could reach everything he can reach, not only Quick Pickle.
- Leaves the Supabase organisation and the Stripe account once Ash is the owner of both.
- Has his login to the back end switched off, once Ash has her own and the PIN is
  retired.
- Disconnects the old `half-sour` Vercel project from the repository.
- Clears three things left on his Claude account from the build:
  - a scheduled task, already switched off: "Quick Pickle: Drive watch and build loop";
  - a cloud environment named "Quick Pickle (pickled_jews)";
  - the copies of the four `QP_` secrets kept as settings in his default cloud
    environment. Once the tokens are deleted and the keys rolled they open nothing, but
    there is no reason to leave them there.

## The repository's four secrets

GitHub, the repository's Settings, Secrets and variables, Actions. They are what lets
the repository look after its own hosting, database and payments
(`.github/workflows/infra.yml`). GitHub never shows a secret back, to anybody.

| Name                        | What it is                                    | Whose account makes it  | At handover                          |
| :-------------------------- | :-------------------------------------------- | :---------------------- | :----------------------------------- |
| `QP_VERCEL_TOKEN`           | Lets the workflow read and change the project | Vercel, Account Tokens  | Ash makes a new one. Sam deletes his |
| `QP_SUPABASE_ACCESS_TOKEN`  | Lets the workflow reach the database project  | Supabase, Access Tokens | Ash makes a new one. Sam deletes his |
| `QP_STRIPE_SECRET_KEY`      | Stripe's secret key. A test key today         | Stripe, Developers      | Rolled, as in step 4                 |
| `QP_STRIPE_PUBLISHABLE_KEY` | Stripe's other key. A test key today          | Stripe, Developers      | Rolled, as in step 4                 |

A token made in somebody's Vercel or Supabase account can reach every project that
person can. That is why the workflow is pinned to Quick Pickle's own project by id and
refuses to list or touch any other.

## Settings on the host

Vercel, the project's Settings, Environment Variables, for the Production environment
only. `.env.example` in the repository explains each one in full.

Set today:

| Name                    | What it is for                                                | Who made it                           |
| :---------------------- | :------------------------------------------------------------ | :------------------------------------ |
| `DATABASE_URL`          | How the site reaches its database, as its own limited login   | The repository (`connect-database`)   |
| `BACKSTAGE_SETUP_CODE`  | The long phrase behind the first login and the PIN            | The repository (`ensure-setup-code`)  |
| `CRON_SECRET`           | What the database's clock says to the site every five minutes | The repository (`connect-clock`)      |
| `PAYMENT_PROVIDER`      | Which payment processor the checkout uses: `stripe`           | The repository (`connect-stripe`)     |
| `STRIPE_SECRET_KEY`     | Stripe's secret key. A test key today                         | The repository, from the secret above |
| `STRIPE_WEBHOOK_SECRET` | Proves that news of a payment really came from Stripe         | The repository (`connect-stripe`)     |

Not set yet. Each switches something on, and the go-live list in the back end says which
are missing:

| Name                    | Switches on                                                    |
| :---------------------- | :------------------------------------------------------------- |
| `MAIL_PROVIDER`         | Sending email at all. `resend`                                 |
| `RESEND_API_KEY`        | Resend's key                                                   |
| `MAIL_FROM`             | The address email is sent from, on a domain Resend has checked |
| `RESEND_WEBHOOK_SECRET` | Mail arriving in the inbox, and hearing about bounces          |
| `MAIL_TOKEN_SECRET`     | A reply address of its own for each conversation               |
| `NEXT_PUBLIC_SITE_URL`  | The address the shop calls itself by. Made by `add-domain`     |

`TODO.md` has the steps for email and the inbox, in order.

## What the repository can do for itself

`.github/workflows/infra.yml` runs `scripts/infra/run.mjs`. It prints names and states,
never a value. It runs `status` on every push to `main`, and anything that changes a
setting needs a written yes.

| Action              | What it does                                                                          |
| :------------------ | :------------------------------------------------------------------------------------ |
| `status`            | Reads everything and changes nothing: the host, the database, orders by state, Stripe |
| `ensure-setup-code` | Makes the set-up code if there is none                                                |
| `connect-database`  | Makes the site its own database login and saves the connection                        |
| `connect-clock`     | Has the database ring the site every five minutes                                     |
| `stripe-check`      | Tries the checkout's own code against Stripe's test mode. No money can move           |
| `connect-stripe`    | Switches the checkout to Stripe and sets up Stripe's news                             |
| `stripe-events`     | Updates which kinds of news Stripe sends                                              |
| `disconnect-stripe` | Back to the practice checkout                                                         |
| `disconnect-clock`  | Stops the clock                                                                       |
| `limits-off`        | Switches off the checkout's limit on asks from one address                            |
| `limits-on`         | Switches it back on                                                                   |
| `add-domain`        | Puts a domain on the site and says which DNS records to add at the registrar          |
| `use-domain`        | Makes that domain the address the shop calls itself by, once it is answering          |
| `leave-domain`      | The way back: the shop calls itself by the host's own address again                   |
| `redeploy`          | Builds the live site again so a changed setting takes effect                          |

Some can be started by hand from GitHub's Actions tab. All of them can be asked for in a
commit, by changing `.github/infra-request.json`, which is how Claude does it: the
request is then reviewed and merged like any other change.

## The shop's own domain

`quickpickle.co.nz`, registered by Ash at [1st Domains](https://1stdomains.nz/). It is
hers already, so there is nothing to hand over. On 18 November 2026 its pricing page
listed a `.co.nz` at $39.50 plus GST a year to renew. Check the page: prices move.

**Nothing else is needed from the registrar for the shop.** Its web hosting is for
WordPress and PHP sites and cannot run this one, which is a different kind of site with
its own back end. The database it offers is a different kind from the one the shop is
written for, and the shop keeps its files in its own database, so there is no storage to
buy either. The site stays on its host, its database stays where it is, and the domain is
pointed at the site.

**Email hosting there is Ash's choice, not something the shop needs.** The shop sends
its own email and has its own inbox once Resend is connected. An ordinary mailbox on the
domain does no harm beside that and is handy for her own business email. It decides one
thing: mail sent to the domain then arrives in that mailbox, not in the back end's inbox.
`TODO.md`, under "Connect the inbox", says the ways the two can sit side by side.

**Connecting it.** Three steps, and only the middle one is Ash's.

1. Claude asks for `add-domain`, which puts the name on the site and answers with two
   DNS records. Done on 18 November 2026. `status` says where the name stands, and
   asking for `add-domain` again prints the records as the host recommends them that
   day. That day they were:

   | Record type | Hostname at 1st Domains | Value                                 |
   | :---------- | :---------------------- | :------------------------------------ |
   | A           | left blank              | `216.198.79.1`                        |
   | CNAME       | `www`                   | `ac78968fe6d00efc.vercel-dns-017.com` |

2. Ash adds those two records at 1st Domains. Their help pages said this on 18 November
   2026:
   - Log in, **Manage Domains & Services**, choose the domain, **Manage DNS Zone
     Records**. That link only shows while the domain uses 1st Domains' own name
     servers, which is how a new domain starts.
   - Delete the records tagged **[Parking]** for the bare name and for `www`. They are
     what shows the registrar's holding page, and they fight with ours. Leave anything
     to do with email alone: an MX record, or a TXT record that starts `v=spf1`.
   - **Add Record** twice, with the two rows of the table above. The **A** record's
     hostname is left blank, because 1st Domains does not use `@` for the bare name.
   - They say to allow up to an hour.
3. Claude asks for `status` until the name is answering, then for `use-domain`. From
   then the shop's links, its emails and its QR codes use the new name.

Three things to know.

- **Keep it paid.** If the registration lapses, the name stops working. Turn on
  auto-renew at the registrar. The site itself goes on answering at the host's own
  address (`quickpickle.vercel.app` today), and `leave-domain` points the shop's links
  back at it.
- **Stripe and the clock do not use the domain**, on purpose. They call the host's own
  address, so a mistake in the DNS can never stop a payment being recorded.
- **Everybody connects their Claude again** after `use-domain`. A connection is good for
  one address.

## Claude's own environment

A Claude Code session on the web works in a cloud environment that belongs to the
person's own Claude account. For this repository it needs almost nothing.

- **No keys.** The code builds, runs and passes every test with none. The real ones stay
  in the repository's secrets and at the host, and the workflow above is how they are
  used.
- **No set-up script.** A session installs what the repository needs with `npm install`.
- **Two addresses worth allowing**, if the environment's network is held to a list: the
  shop's own address, so a session can look at the live site after a change, and
  `drive.google.com` with `drive.usercontent.google.com` if it should fetch from the
  brand pack's folder.

Whatever keys an environment does hold are handed to every session that runs in it. One
that holds another business's keys is not the place to open this repository.

## The brand pack on Google Drive

The print masters, the logos, Lucky and the video are in a shared Google Drive folder,
about 200 MB, and are not in the repository. The art the site uses was built from it
(`scripts/build-art.mjs`, `scripts/build-vectors.py`, `scripts/build-media.mjs`).

The folder can be read by anybody who has its link. That is how the build fetched from
it. Once nobody needs to fetch from it that way, its owner should narrow the sharing to
named people.
