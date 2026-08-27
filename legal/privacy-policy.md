# HALF SOUR — Privacy Policy

**Effective:** 27 August 2026 · **Version:** 1.0 · **Applies to:** half-sour.vercel.app and every
successor domain, our email and SMS, and our customer-service channels.

> **Placeholders.** Everything in `[SQUARE BRACKETS AND CAPITALS]` is a fact only the founder can
> supply. This policy is not fit to publish until every one is filled in. They are listed in
> `legal/README.md`.

---

## Who we are

HALF SOUR is a trading name of **[LEGAL ENTITY NAME]**, **[NZBN]**, a New Zealand business at
**[REGISTERED ADDRESS]**. We are an "agency" for the purposes of the **Privacy Act 2020** and this
policy explains how we handle "personal information" as that Act defines it.

**Privacy contact:** **[PRIVACY@DOMAIN]**. There is one of us. We will reply, but we are not a call
centre — allow a working day.

---

## The short version

- We collect what we need to take your order, deliver it, keep our books, and answer you when you
  write to us. Not more.
- We do not sell your information and we do not trade mailing lists.
- Our website, database and some of our customer-service tooling run on servers **outside New
  Zealand**. That is set out in full below, because the Privacy Act requires us to be straight with
  you about it.
- You can ask for a copy of what we hold about you, and ask us to fix it. Both are free and we must
  answer within **20 working days**.

---

## 1. What we collect, and why (IPP 1, IPP 4)

**Information privacy principle 1** allows us to collect personal information only "for a lawful
purpose connected with a function or an activity of the agency" and only where "the collection of
the information is necessary for that purpose". **IPP 4** requires collection to be by lawful means
and by means that are fair and not unreasonably intrusive.

| What                                                  | Why we need it                                                                                                                              | What happens if you don't give it |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- |
| Name, delivery address, email, phone                  | To take payment and get a bottle to your door                                                                                               | We cannot complete an order       |
| Order contents, order history, amounts paid           | To fulfil the order, honour returns, and keep tax records                                                                                   | We cannot sell to you             |
| Payment card details                                  | **We never see or store these.** They go directly to our payment provider, **[PAYMENT PROVIDER]**, which is separately responsible for them | We cannot take payment            |
| Emails, chat messages and social messages you send us | To answer you                                                                                                                               | We cannot answer                  |
| Age confirmation, where we collect one                | Because our product is marketed alongside alcohol and we do not market to under-18s                                                         | We may decline the order          |
| Website analytics and error logs                      | To keep the site working and fast                                                                                                           | Nothing — see `cookie-policy.md`  |
| Marketing list membership                             | To send you what you asked to be sent                                                                                                       | You do not get the emails         |

**We do not collect** health information, and we do not want it. If you volunteer a health reason for
buying our product, we will not record it, act on it, or repeat it back to you. See
`legal/COPY-RULES.md` §9.

**Children.** Our store is not directed at children and we do not knowingly collect their
information. If you believe we hold a child's information, write to us and we will delete it.

## 2. Where it comes from (IPP 2, IPP 3, IPP 3A)

**IPP 2** requires us to collect personal information from you directly, unless one of the listed
exceptions applies. Almost everything we hold comes straight from you: you type it into the checkout
or you write it in a message.

We also receive some information _about_ you from others:

- **[PAYMENT PROVIDER]** tells us whether a payment succeeded, the last four digits of the card, and
  any chargeback or fraud flag.
- **[COURIER]** tells us delivery status, and sometimes an alternative delivery instruction you gave
  them rather than us.
- If you contact us through a social platform, that platform gives us your handle and message.

**IPP 3A** (in force from **1 May 2026**, inserted by the **Privacy Amendment Act 2025**) requires
that when we collect personal information about you from a source other than you, we take reasonable
steps to make you aware of the collection, its purpose, the intended recipients, who we are, and your
rights of access and correction — as soon as reasonably practicable. **This section is how we do
that.** Where the indirect collection is unusual, we will also tell you directly.

**IPP 3** requires the equivalent notice when we collect from you. That notice is this policy, linked
from the checkout and from the footer of every page.

## 3. Automated processing and AI-assisted support

We use AI tools to help draft replies to customer messages and to help with routine order admin.
Being specific about this matters, because it means your message can leave New Zealand.

- When you email or message us, the **content of your message may be sent to an AI provider
  (currently Anthropic, in the United States)** so that a draft reply can be produced.
- **A human reads and sends every reply.** No decision that affects you — a refund, a replacement, a
  cancellation — is made by an automated system alone.
- The AI is instructed not to give health, dietary, medical or food-safety advice, and not to make
  claims about our product. Those instructions are published at `legal/COPY-RULES.md` §9.
- **Please do not send us health information, government identifiers, or payment card numbers in a
  message.** If you do, we will delete it rather than process it.
- If you would prefer your message not be processed this way, say so in your first line ("no AI
  please") and we will handle it by hand.

## 4. How we hold it, and who else touches it (IPP 5, IPP 11)

**IPP 5** requires security safeguards that are reasonable in the circumstances, and requires that
where information is given to someone providing a service to us, we do "everything reasonably within
the power of the agency" to prevent unauthorised use or disclosure.

What we actually do: access to the order database is limited to the founder; accounts use unique
credentials and multi-factor authentication where the provider offers it; card data never reaches our
systems; production secrets are not stored in the code repository.

**IPP 11** limits disclosure. We disclose personal information only to:

| Who                                                                             | What they get                                                | Why                               |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------ | --------------------------------- |
| **[PAYMENT PROVIDER]**                                                          | Name, email, amount, billing details                         | To take payment                   |
| **[COURIER / NZ POST / AUSTRALIA POST]**                                        | Name, delivery address, phone                                | To deliver the order              |
| **Supabase** (database and authentication)                                      | Order and account records                                    | Because it is our database        |
| **Vercel** (website hosting)                                                    | Request logs, which include IP addresses                     | Because it serves the website     |
| **[EMAIL PLATFORM]**                                                            | Email address and order-related fields                       | To send order and marketing email |
| **Anthropic**                                                                   | The content of messages you send us, for drafting assistance | See §3                            |
| **[ACCOUNTANT]** and Inland Revenue                                             | Transaction records                                          | Tax obligations                   |
| A regulator (MPI, the Commerce Commission, the Privacy Commissioner) or a court | Whatever is lawfully required                                | Where the law requires it         |

We do **not** sell, rent or trade personal information, and we do not disclose it for anyone else's
marketing.

## 5. Overseas — the part that actually matters (IPP 12, s 11)

**Our infrastructure is offshore.** Vercel, Supabase and Anthropic all store or process data outside
New Zealand — principally in the United States, and depending on region configuration, elsewhere. We
are telling you this plainly because the Privacy Act treats it as significant.

Two different rules apply, and it is worth understanding which is which.

**(a) Storage and processing on our behalf — Privacy Act 2020, section 11.** Where an overseas
provider holds personal information _as our agent_ — for safe custody or processing, and not for its
own purposes — the Act treats that information as held by **us**, not by them. The Privacy
Commissioner's guidance is explicit that this is the normal position for a cloud host: "in most
circumstances, you'll be responsible for the personal information that you put in the cloud – not the
cloud service provider." **We remain accountable to you for it, wherever the server is.** That is our
position for **Vercel** and **Supabase**.

**(b) Actual disclosure overseas — IPP 12.** Where we disclose personal information to a foreign
person or entity that uses it for its own purposes, **IPP 12** applies. We may only do so if one of
its conditions is met, and the relevant ones for us are:

- **IPP 12(1)(c)** — we believe on reasonable grounds the recipient is subject to privacy laws that,
  overall, provide comparable safeguards to the Privacy Act; or
- **IPP 12(1)(f)** — we otherwise believe on reasonable grounds the recipient is required to protect
  the information in a way that, overall, provides comparable safeguards — "for example, pursuant to
  an agreement entered into between A and B"; or
- **IPP 12(1)(a)** — you authorise the disclosure **after being expressly informed by us that the
  recipient may not be required to protect the information in a way that, overall, provides
  comparable safeguards to those in this Act**.

**What we rely on, provider by provider:**

| Provider               | Location               | Role                                                 | Basis                                                              |
| ---------------------- | ---------------------- | ---------------------------------------------------- | ------------------------------------------------------------------ |
| Vercel                 | US and global edge     | Hosting; holds request logs on our behalf            | s 11 (agent), plus its data processing addendum                    |
| Supabase               | **[REGION — CONFIRM]** | Database on our behalf                               | s 11 (agent), plus its data processing addendum                    |
| Anthropic              | US                     | Processes message content to draft replies           | Contractual protections in its commercial terms — **IPP 12(1)(f)** |
| **[PAYMENT PROVIDER]** | **[LOCATION]**         | Its own purposes as well as ours (fraud, compliance) | **IPP 12** — to be confirmed                                       |
| **[EMAIL PLATFORM]**   | **[LOCATION]**         | Processes on our behalf                              | **IPP 12 / s 11** — to be confirmed                                |

⚠️ **Founder's obligation, stated plainly:** IPP 12 requires _reasonable grounds_, and reasonable
grounds means you have actually read the provider's terms and can point to the clause. Before this
policy is published you must (a) confirm each provider's data location and role, (b) accept each
provider's data processing addendum, and (c) keep a copy. Where a provider will not give comparable
safeguards, the fallback is **IPP 12(1)(a)** — an express, informed authorisation from the customer,
using the Act's own words about the absence of comparable protection. The Privacy Commissioner
publishes free **model contract clauses** and an **IPP 12 decision tree** for exactly this situation
(privacy.org.nz → Privacy for agencies → Sending information overseas). Use them.

**Australian expansion.** Selling into Australia does not change your Privacy Act obligations to New
Zealand customers. It adds the Australian Privacy Act 1988 and the Australian Privacy Principles for
Australian customers. There has historically been a small-business exemption below a turnover
threshold, but it has been under active reform — **do not assume it applies. Get advice before the
first Australian order.**

## 6. How long we keep it (IPP 9)

**IPP 9** forbids keeping personal information "for longer than is required for the purposes for
which the information may lawfully be used."

| Record                                    | Kept for                                                                                     | Why                                                                             |
| ----------------------------------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Order and transaction records             | **7 years** from the end of the relevant income year                                         | Tax Administration Act 1994 record-keeping; Companies Act 1993 where applicable |
| Batch, traceability and complaint records | **[SHELF LIFE + 12 MONTHS — CONFIRM]**                                                       | Food Act 2014 traceability and recall; see `food-safety-checklist.md`           |
| Customer-service correspondence           | 24 months from the last message, unless it relates to a live dispute or a food-safety matter | To handle repeat issues and complaints                                          |
| Marketing list membership                 | Until you unsubscribe, then a suppression record only                                        | So we do not email you again by accident                                        |
| Website analytics and server logs         | **[RETENTION — CONFIRM WITH VERCEL]**                                                        | Security and performance                                                        |
| Draft AI outputs and prompt logs          | Not retained by us beyond the reply; the provider's own retention is governed by its terms   | Minimisation                                                                    |

When a period expires the record is deleted, or de-identified where we need the aggregate figure.

## 7. Accuracy, use and unique identifiers (IPP 8, IPP 10, IPP 13)

- **IPP 8** — we will not use personal information without taking reasonable steps to check it is
  accurate, up to date, complete, relevant and not misleading. If your address is wrong, tell us
  before the courier does.
- **IPP 10** — we use information only for the purpose we collected it for, or a directly related
  purpose. Buying a bottle does not put you on the marketing list; you have to opt in.
- **IPP 13** — we do not assign you a unique identifier beyond an internal order number, and we do
  not use identifiers assigned by anyone else (IRD number, driver licence) as our own.

## 8. Marketing

We only send marketing email or SMS if you have opted in. Every message identifies us and carries a
working unsubscribe link, and we act on unsubscribes promptly. That is both a courtesy and a legal
requirement: the **Unsolicited Electronic Messages Act 2007** requires consent (**s 9**), accurate
sender information (**s 10**) and a functional, clearly presented unsubscribe facility (**s 11**) for
commercial electronic messages with a New Zealand link. It is enforced by the Department of Internal
Affairs.

## 9. Your right to see it and to fix it (IPP 6, IPP 7)

**IPP 6** entitles you to confirmation of whether we hold personal information about you, and access
to it. **IPP 7** entitles you to ask us to correct it.

**To make a request:** email **[PRIVACY@DOMAIN]** with "Privacy request" in the subject line. Tell us
what you want. We may ask you to confirm your identity — we are not going to email your order history
to whoever asks for it.

**Our commitments:**

- We will respond **within 20 working days** of receiving the request, as the Act requires.
- Access and correction are **free**.
- If we refuse any part of a request, we will tell you which part, why, and that you can complain to
  the Privacy Commissioner.
- If we will not make a correction you have asked for, you may give us a **statement of correction**,
  and under IPP 7(4) we must take reasonable steps to attach it so that it is always read with the
  information.
- If we correct information or attach a statement of correction, we will, so far as reasonably
  practicable, tell everyone we previously disclosed it to (IPP 7(5)).

## 10. If something goes wrong

If we have a privacy breach that has caused, or is likely to cause, **serious harm** to anyone, the
Privacy Act requires us to notify the **Office of the Privacy Commissioner** and the affected people
**as soon as we are practically able**. We will tell you what happened, what information was
involved, and what to do about it. We would rather tell you early and be wrong about the severity
than tell you late.

**To complain:** write to us first at **[PRIVACY@DOMAIN]**. If you are not satisfied, you can complain
to the Office of the Privacy Commissioner — privacy.org.nz, 0800 803 909. You do not need our
permission and you do not need a lawyer.

## 11. Changes

If we change this policy we will change the version and date above and, for any change that affects
how we use or disclose your information, tell the people on our list before it takes effect. We will
not apply a materially worse policy retrospectively to information already collected.

---

### Sources

- **Privacy Act 2020**, information privacy principles 1–13 (s 22), **s 11** (information held by an
  agent), Part 6 (notifiable privacy breaches), 20-working-day response requirement for access and
  correction requests.
- **Privacy Amendment Act 2025** (2025 No 53), Part 1 — inserts **IPP 3A**, in force 1 May 2026.
- Office of the Privacy Commissioner, _Privacy Act 2020 — privacy principles_ and _Sending
  information overseas_ (including the model contract clauses and the IPP 12 decision tree):
  https://www.privacy.org.nz/privacy-act-2020/privacy-principles/ and
  https://www.privacy.org.nz/responsibilities/disclosing-personal-information-outside-new-zealand/
- **Unsolicited Electronic Messages Act 2007**, ss 9–11.
- Tax Administration Act 1994 (record retention).

> ⚠️ **This document has not been reviewed by a lawyer.** It is written to be genuinely compliant
> rather than decorative, and every legal proposition in it is sourced. It still needs a New Zealand
> privacy practitioner to read it once against your actual vendor contracts before it goes live.
> See `legal/README.md`.
