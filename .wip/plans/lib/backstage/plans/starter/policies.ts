/**
 * The starter policies: the two short rules marketing leans on. What we
 * publish of what customers say, and who we may name.
 *
 * One paragraph per line: in these documents a line break is a line break.
 */

import { LINK } from "./terms";
import type { StarterDocument } from "./types";

const reviews: StarterDocument = {
  slug: "policy-reviews",
  title: "Reviews: what we publish and what we do not",
  kind: "policy",
  summary:
    "Every review is read by a person first. Taste, the bottle and Lucky go up. Anything about a body does not.",
  sort: 10,
  body: `**What this is:** the rule for customer reviews, and for anything else a customer says about us that we might repeat: on the site, in an email, in a post, on a sticker.

## The rule

A customer can say whatever they like on their own account. The moment we publish, repost, quote, pin or screenshot it, we are the ones saying it. So a person reads every review before it goes anywhere, and some of it never goes anywhere.

## We publish

- What it tasted like, and the face they pulled.
- The bottle, the pack, the stickers, Lucky.
- When and where they have one: before the game, at the half, on the sideline.
- Delivery, packing and how we dealt with a problem.
- Low scores and grumbles, as long as they are about those things. Hiding every bad review is its own kind of misleading.

## We never publish

- Anything about what it did to a body, good or bad, however kindly meant. Publishing it would make it our claim.
- Anything that names a condition, an injury or a doctor.
- Comparisons with other products.
- Anything we cannot show came from a real customer.
- Personal details the customer did not mean to share.

## How

1. Every review starts as waiting. Nothing shows until someone approves it.
2. Read the whole thing. If one sentence breaks the rule, the review is not published. We do not edit a customer's words to make them fit. We can ask whether they would like to send one about the taste.
3. Thank everyone who writes, published or not.
4. If a review says the customer was unwell, it is a complaint. Open [How to handle a complaint](${LINK.doc("how-to-complaint")}).
5. A published review comes down at any time: if the customer asks, or if we got it wrong.

## What we never do

- Write our own reviews, or ask friends to pose as customers.
- Offer something in exchange for a good review. We may ask for an honest one.
- Show a star rating or a count that is not worked out from real, published reviews.
- Publish a name, a club or a photo without permission. See [Naming people](${LINK.doc("policy-naming-people")}).`,
};

const namingPeople: StarterDocument = {
  slug: "policy-naming-people",
  title: "Naming people, clubs and partners",
  kind: "policy",
  summary:
    "Nobody is named, quoted, tagged or pictured without written permission on file.",
  sort: 20,
  body: `**What this is:** the rule for when we may name, quote, tag or picture a person, a club, a team, an event or a stockist.

## The rule

Nobody is named without written permission, on file, before it goes out. That covers the site, emails, posts, stories, captions, tags, ads, printed things and what we say to journalists.

## Who it covers

- Customers, and anyone who has written to us.
- Players, coaches, managers and parents.
- Anyone under 18: a parent's or guardian's written permission, every time, and think twice even then.
- Clubs, teams, schools and leagues, and their crests, colours, kit and grounds.
- Events and their organisers.
- Stockists, and anyone who sells or hands out our product.
- Anyone given product, or paid, to post about us.

## What counts as permission

- **Written.** An email or a message is enough. A nod at the clubrooms is not.
- **Specific.** It says what we may use (a name, a quote, a photo, a logo), where, and for how long.
- **From the right person.** The person themselves. For a club, someone who can speak for it. For a child, a parent or guardian.
- **On file.** Saved where the next person can find it: ____.
- **Able to be taken back.** If they change their mind, we take it down the same day and stop using it.

## What we may say without asking

- That we were at a public event, without suggesting the event backs us.
- Things that are true of nobody in particular: "club players", "the sideline".

## What we never say, even with permission

- "Official partner", "sponsor of" or "supplier to", unless there is a signed agreement that says exactly that.
- Anything that puts words about what the product does to a body in someone's mouth. A player's quote about that is still our claim the moment we print it.
- That a well-known person or team has it, unless they have agreed in writing to us saying so.

## Photos and video

- Ask before filming or photographing people at a table or a club night. A sign on the table is a start. It is not permission to put a face in an ad.
- No photos of children without a parent's or guardian's written permission.
- If someone asks for a photo to come down, it comes down the same day.

## Why

It is their name, not ours.`,
};

export const STARTER_POLICIES: readonly StarterDocument[] = [
  reviews,
  namingPeople,
];
