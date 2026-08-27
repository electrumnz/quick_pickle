# HALF SOUR — Cookie Policy

**Effective:** 27 August 2026 · **Version:** 1.0 · **Applies to:** half-sour.vercel.app and any
successor domain.

---

## What this page is

A cookie is a small file a website asks your browser to keep. This page lists the ones we use, what
each is for, how long it lasts, and how to refuse the ones that are optional. "Cookies" here also
covers `localStorage`, `sessionStorage` and similar browser storage, because they raise the same
question and it would be evasive to list only one.

---

## The cookies we set

**[FOUNDER: this table must be completed from the actual deployed site, not from intention. Open the
live site in a private window, look at Application → Storage in the browser dev tools, and list what
is really there. Publishing a cookie table that does not match the site is a misleading representation
under Fair Trading Act 1986 s 9.]**

### Strictly necessary — the site does not work without these

| Name                   | Set by                 | Purpose                                                               | Lifetime               |
| ---------------------- | ---------------------- | --------------------------------------------------------------------- | ---------------------- |
| **[SESSION COOKIE]**   | HALF SOUR / Supabase   | Keeps you signed in and keeps your cart attached to you between pages | **[SESSION / X DAYS]** |
| **[CSRF TOKEN]**       | HALF SOUR              | Stops a third-party site submitting a form as you                     | Session                |
| **[CART]**             | HALF SOUR              | Remembers what is in your cart                                        | **[X DAYS]**           |
| **[PAYMENT PROVIDER]** | **[PAYMENT PROVIDER]** | Fraud prevention and completing the payment                           | **[SET BY PROVIDER]**  |

These are set because you asked for a shop that works. They carry no advertising identifier and are
not shared for anyone else's purposes.

### Analytics — optional

| Name            | Set by                         | Purpose                                            | Lifetime |
| --------------- | ------------------------------ | -------------------------------------------------- | -------- |
| **[ANALYTICS]** | **[VERCEL ANALYTICS / OTHER]** | Counts page views and measures how fast pages load | **[X]**  |

**[CONFIRM: if the analytics in use is cookieless and does not store an identifier on the device, say
so here and remove the consent prompt for it — but confirm it, do not assume it.]**

### Marketing and advertising

**We currently set none.** If that changes — a Meta pixel, a Google Ads tag, anything that follows
you to another site — this page changes first, and the tag does not fire until you have opted in.

---

## What consent New Zealand actually requires

This is the part most cookie policies get wrong, so it is worth being exact.

**New Zealand has no cookie-specific statute.** There is no local equivalent of the EU ePrivacy
Directive's "cookie rule", and no rule that says a banner must appear before any cookie is set. Anyone
who tells you a New Zealand site legally requires a GDPR-style consent wall is repeating European law
that does not apply here.

**What does apply is the Privacy Act 2020, and it applies whenever a cookie handles _personal
information_** — which includes information about an identifiable individual, and in practice includes
a persistent identifier tied to a browser or an account, and often an IP address in combination with
other data. Where that is the case:

- **IPP 1** — we may collect it only for a lawful purpose connected with our activities, and only
  where collection is _necessary_ for that purpose. Analytics that exists because it is interesting
  is not necessary.
- **IPP 3** — we must take reasonable steps to make you aware that we are collecting it, what for,
  who receives it, who we are, and that you have rights of access and correction. **This page, linked
  in the footer and surfaced on first visit, is how we discharge IPP 3 for cookies.**
- **IPP 4** — collection must be by fair means and must not intrude to an unreasonable extent on
  personal affairs. Covert tracking fails this.
- **IPP 12** — where the cookie causes data to be disclosed to an overseas recipient acting for its
  own purposes, the cross-border rules in `privacy-policy.md` §5 apply.

**So the honest answer is:** New Zealand law requires **transparency**, not a consent gate — but a
consent mechanism is still the right build, for three reasons.

1. **Analytics and marketing cookies are not necessary to deliver what you asked for.** IPP 1 asks
   whether collection is necessary. Consent is the cleanest way to make it so.
2. **Some visitors are covered by other law.** An EU or UK visitor brings the GDPR/ePrivacy regime
   with them, and a serious argument that it reaches a site targeting them. A consent mechanism is
   cheap; a jurisdictional argument is not.
3. **It is consistent with how we do everything else.** We have built a brand that refuses to
   overclaim. Tracking people who did not agree to it would be the same failure in a different costume.

### What we therefore implement

| Category                | Behaviour                                                                                                                                     |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Strictly necessary      | Set without consent. Disclosed here. No prompt, because refusing them means no shop.                                                          |
| Analytics               | **Off until the visitor opts in.** Prompt on first visit; choice remembered; "Reject" is as easy as "Accept" and no more than one click away. |
| Marketing / advertising | None today. If added: opt-in only, disclosed here first.                                                                                      |

**Rules for whoever builds the banner:**

- Reject must be as prominent and as few clicks as Accept. A pre-ticked box or a hidden "manage
  preferences" route is a fair-means problem under **IPP 4** and, if it produces a "consent" we then
  rely on, a misleading-conduct problem under **FTA s 9**.
- No non-essential script may fire before the choice is made. A banner that appears _after_ the tag
  has already loaded is decoration.
- The choice must be re-openable — a "Cookie settings" link in the footer — and changing it must
  actually stop the collection.
- Do not call a cookie "essential" because it is convenient for us. Essential means the site does not
  function without it.
- Log the fact and date of consent, not more.

---

## Turning cookies off yourself

Every browser lets you block or delete cookies — Chrome, Safari, Firefox and Edge all have it under
Settings → Privacy. If you block the strictly necessary ones, the cart and the checkout will stop
working. That is a consequence of the block, not a punishment.

---

## Questions

**[PRIVACY@DOMAIN]** · full detail in `privacy-policy.md`.

---

### Sources

- **Privacy Act 2020**, information privacy principles 1, 3, 4 and 12 (s 22). Text: Office of the
  Privacy Commissioner, https://www.privacy.org.nz/privacy-act-2020/privacy-principles/
- **Privacy Amendment Act 2025** (2025 No 53), Part 1 — IPP 3A, in force 1 May 2026.
- **Fair Trading Act 1986**, s 9 (misleading or deceptive conduct) — applies to the accuracy of this
  page and to the design of any consent interface.
- The absence of a New Zealand cookie-consent statute is a statement about what is _not_ in the law:
  no NZ enactment imposes a prior-consent requirement for cookies as the EU ePrivacy Directive does.
  ⚠️ **Have this confirmed by a New Zealand privacy practitioner before relying on it**, and re-check
  it if the Privacy Act is amended again — see `legal/README.md`.
