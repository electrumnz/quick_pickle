/**
 * Invented marketing records for a deployment with no database, so every
 * screen in the area has something on it.
 *
 * Everything here is made up and says so: the reviews call themselves sample
 * reviews, the partners are "sample" clubs and shops, and every address ends
 * in example.co.nz. It all goes in through the area's own operations, at
 * pretend times, so each record has the history a real one would.
 *
 * The copy in here passes the copy check, as real copy would have to. The
 * one exception is on purpose: a sample review that says what the product
 * did to somebody, so the screen that refuses to publish it can be seen. It
 * sits between the scanner's ignore markers.
 */

import type { Db } from "@/lib/db/types";
import { addDays, nzDateKey, nzToInstant } from "@/lib/time";

import { systemCaller } from "../core/actor";
import { execute } from "../core/op";
import { joinCrew } from "../crew/ops";
import { placeDemoOrders } from "../orders/demo";
import {
  approveCampaign,
  campaignQueue,
  createCampaign,
  getCampaign,
  listCampaigns,
  markCampaignSends,
  sendCampaign,
} from "./campaigns";
import { addPartnerCost } from "./collabs";
import { createLink, resolveLink, setLinkActive } from "./links";
import {
  addPartner,
  setPartnerCut,
  setPartnerNextStep,
  setPartnerPermission,
} from "./partners";
import { createPromoCode } from "./promo-codes";
import { publishReview, rejectReview, submitReview } from "./reviews";
import {
  addSocialPost,
  approveSocialPost,
  dropSocialPost,
  markSocialPosted,
} from "./social";

const HOUR = 60 * 60_000;
const DAY = 24 * HOUR;

/* copy-audit-ignore-start: one sample review that breaks the rules on purpose, so the refusal to publish it can be seen. */
const REVIEW_THAT_CANNOT_BE_PUBLISHED =
  "Sample review. Sorted my cramps in the second half. Would not take the field without one now.";
/* copy-audit-ignore-end */

export async function seedMarketingDemo(db: Db, now: Date): Promise<void> {
  const demo = systemCaller("Demo data", "script");
  const shop = systemCaller("The shop", "storefront");
  const mail = systemCaller("The mail system", "automation");

  /** The clock, some hours either side of now. */
  const at = (hours: number) => ({
    db,
    now: new Date(now.getTime() + hours * HOUR),
  });
  /** A New Zealand wall-clock time, some days from today. */
  const nzAt = (days: number, hour: number, minute = 0) => {
    const [year = 0, month = 1, day = 1] = addDays(nzDateKey(now), days)
      .split("-")
      .map(Number);
    return nzToInstant(year, month, day, hour, minute);
  };

  // Already seeded (or already in use): leave it alone.
  const existing = await execute(listCampaigns, { limit: 1 }, demo, at(0));
  if (existing.length > 0) return;

  /* ---- the Pickle Crew: two people who joined and have not ordered ----- */

  for (const email of ["kit.bag@example.co.nz", "half.time@example.co.nz"]) {
    await execute(joinCrew, { email, source: "crew-form" }, shop, at(-200));
  }

  /* ---- campaigns ------------------------------------------------------- */

  const welcome = await execute(
    createCampaign,
    {
      name: "Welcome to the Pickle Crew (sample)",
      subject: "You're in. Lucky says hi.",
      preheader: "First dibs on new batches, and whatever Lucky gets up to.",
      body: [
        "Hi {{name}},",
        "Welcome to the Pickle Crew. Here is what you have signed up for:",
        "- First dibs when a new batch is ready.\n- The odd note from Lucky, the superhero cat.\n- Nothing else. We will not fill your inbox.",
        "**Tiny package, big dill.**",
        "See you on the sideline.",
      ].join("\n\n"),
      audience: "crew",
    },
    demo,
    at(-80),
  );
  await execute(approveCampaign, { id: welcome.id }, demo, at(-76));
  const ready = await execute(getCampaign, { id: welcome.id }, demo, at(-72));
  if (ready.audienceCount !== null && ready.audienceCount > 0) {
    await execute(
      sendCampaign,
      { id: welcome.id, recipients: ready.audienceCount },
      demo,
      at(-72),
    );
    // Stand in for the mail system, which is not connected in a demo.
    const queue = await execute(
      campaignQueue,
      { id: welcome.id, limit: 500 },
      mail,
      at(-72),
    );
    await execute(
      markCampaignSends,
      {
        campaignId: welcome.id,
        results: queue.recipients.map((person, index) => ({
          email: person.email,
          status: "sent" as const,
          providerId: `demo-${String(index + 1)}`,
        })),
      },
      mail,
      at(-71.9),
    );
  }

  await execute(
    createCampaign,
    {
      name: "Batch 001 is nearly here (sample draft)",
      subject: "Batch 001: nearly time",
      preheader: "A sample draft, waiting on a real ship date.",
      body: [
        "Hi {{name}},",
        "Batch 001 is close. This is a sample draft: the real one waits for a confirmed ship date.",
        "Sour, salty, properly pickly. Everyone pulls the face.",
        "[Have a look at the packs](/)",
        "Never fear, Lucky is here.",
      ].join("\n\n"),
      audience: "crew-not-yet-buyers",
    },
    demo,
    at(-5),
  );

  /* ---- promo codes: one live, one finished, one not started ------------- */

  await execute(
    createPromoCode,
    {
      code: "CREW10",
      kind: "percent",
      value: 10,
      startsAt: new Date(now.getTime() - 10 * DAY),
      maxUses: 200,
      note: "Sample code. A thank-you for joining the Pickle Crew.",
    },
    demo,
    at(-20 * 24),
  );
  await execute(
    createPromoCode,
    {
      code: "SIDELINE5",
      kind: "amount",
      value: 500,
      minSubtotalCents: 4800,
      startsAt: new Date(now.getTime() - 20 * DAY),
      endsAt: new Date(now.getTime() - 3 * DAY),
      note: "Sample code. Handed out on a club day that has been and gone.",
    },
    demo,
    at(-20 * 24),
  );
  await execute(
    createPromoCode,
    {
      code: "KITBAG",
      kind: "delivery",
      startsAt: new Date(now.getTime() + 7 * DAY),
      maxUses: 50,
      note: "Sample code. For the flyer that goes out next week.",
    },
    demo,
    at(-2),
  );

  /* ---- the social planner ---------------------------------------------- */

  const meetLucky = await execute(
    addSocialPost,
    {
      title: "Meet Lucky",
      network: "instagram",
      format: "post",
      caption: "Never fear, Lucky is here. Part cat, all cape.",
      plannedFor: nzAt(-2, 18),
      notes: "Sample post. Lucky flying up, on the pink ground.",
    },
    demo,
    at(-6 * 24),
  );
  await execute(approveSocialPost, { id: meetLucky.id }, demo, at(-5 * 24));
  await execute(
    markSocialPosted,
    { id: meetLucky.id, postUrl: "https://example.co.nz/sample-post" },
    demo,
    at(-2 * 24 + 1),
  );

  const downInOne = await execute(
    addSocialPost,
    {
      title: "Down in one",
      network: "instagram",
      format: "reel",
      caption: "Down in one. Pull the face. Go play. #QuickPickle #PickleCrew",
      plannedFor: nzAt(1, 7, 30),
      notes: "Sample post. Three people, three faces, one take.",
    },
    demo,
    at(-30),
  );
  await execute(approveSocialPost, { id: downInOne.id }, demo, at(-26));

  await execute(
    addSocialPost,
    {
      title: "Everyone's got a thing",
      network: "facebook",
      format: "post",
      caption:
        "Left boot first. Same socks since the semi. One shot of pickle juice. Everyone's got a thing. This is ours.",
      plannedFor: nzAt(3, 12),
      notes: "Sample post. Still needs a photo of a kit bag.",
    },
    demo,
    at(-20),
  );

  await execute(
    addSocialPost,
    {
      title: "The face",
      network: "tiktok",
      format: "reel",
      plannedFor: nzAt(9, 17),
      notes: "Sample idea. First sips, back to back. No caption yet.",
    },
    demo,
    at(-12),
  );

  await execute(
    addSocialPost,
    {
      title: "Move over, oranges",
      network: "instagram",
      format: "story",
      notes:
        "Sample idea with no day yet. Half-time, a plate of oranges, one tiny bottle.",
    },
    demo,
    at(-8),
  );

  const stopwatch = await execute(
    addSocialPost,
    {
      title: "Race the stopwatch",
      network: "tiktok",
      format: "reel",
      notes:
        "Sample idea, dropped. A stopwatch in the shot hints at how quickly something happens, and the copy rules count a picture as a claim too.",
    },
    demo,
    at(-50),
  );
  await execute(dropSocialPost, { id: stopwatch.id }, demo, at(-49));

  /* ---- short links ----------------------------------------------------- */

  const links = [
    {
      slug: "insta",
      target: "/",
      label: "Instagram bio",
      utm: { source: "instagram", medium: "social", campaign: "bio" },
      showOrder: 1,
      clicks: 46,
    },
    {
      slug: "packs",
      target: "/#shop",
      label: "See the packs",
      utm: { source: "links-page", medium: "social", campaign: "" },
      showOrder: 2,
      clicks: 23,
    },
    {
      slug: "flyer",
      target: "/",
      label: "Club day flyer (QR code)",
      utm: { source: "flyer", medium: "print", campaign: "club-day" },
      showOrder: null,
      clicks: 9,
    },
    {
      slug: "old-bio",
      target: "https://example.co.nz/",
      label: "An old bio link, switched off",
      utm: { source: "", medium: "", campaign: "" },
      showOrder: null,
      clicks: 3,
    },
  ] as const;
  for (const [index, link] of links.entries()) {
    const made = await execute(
      createLink,
      {
        slug: link.slug,
        target: link.target,
        label: link.label,
        utm: link.utm,
        showOrder: link.showOrder,
      },
      demo,
      at(-9 * 24 + index),
    );
    for (let click = 0; click < link.clicks; click += 1) {
      await execute(resolveLink, { slug: link.slug }, shop, at(-1));
    }
    if (link.slug === "old-bio") {
      await execute(
        setLinkActive,
        { id: made.id, active: false },
        demo,
        at(-4 * 24),
      );
    }
  }

  /* ---- reviews: two published, two waiting, one rejected ---------------- */

  const fromSam = await execute(
    submitReview,
    {
      rating: 5,
      body: "Sample review. Sour, salty and gone in one gulp. The whole team pulled the face.",
      displayName: "Sample Sam, Ōtaki",
    },
    shop,
    at(-6 * 24),
  );
  await execute(publishReview, { id: fromSam.id }, demo, at(-5 * 24));

  const fromPriya = await execute(
    submitReview,
    {
      rating: 4,
      body: "Sample review. Tiny bottle, big dill. One lives in my kit bag now.",
      displayName: "Sample Priya, Auckland",
      // Ties it to an invented order, if the orders demo is there.
      orderNumber: "QP-HERE77",
      email: "priya.nair@example.co.nz",
    },
    shop,
    at(-4 * 24),
  );
  await execute(publishReview, { id: fromPriya.id }, demo, at(-3 * 24));

  await execute(
    submitReview,
    {
      rating: 5,
      body: "Sample review. Our netball side handed these round at half-time. Faces all round.",
      displayName: "Sample Mere, Rotorua",
    },
    shop,
    at(-20),
  );

  await execute(
    submitReview,
    {
      rating: 5,
      body: REVIEW_THAT_CANNOT_BE_PUBLISHED,
      displayName: "Sample Tom, Dunedin",
    },
    shop,
    at(-7),
  );

  const junk = await execute(
    submitReview,
    {
      rating: 1,
      body: "Sample review. Cheap followers for your page, ask me how.",
      displayName: "Sample spam account",
    },
    shop,
    at(-30),
  );
  await execute(
    rejectReview,
    { id: junk.id, reason: "An advert, not a review of anything we sell." },
    demo,
    at(-28),
  );

  /* ---- partners at four different stages -------------------------------- */

  const rovers = await execute(
    addPartner,
    {
      name: "Sample Rovers FC",
      kind: "club",
      status: "talking",
      contactName: "Hemi (invented)",
      email: "hemi@example.co.nz",
      region: "Kāpiti",
      notes:
        "Invented club. Keen on a box for the first XI and a flyer for the clubrooms.",
    },
    demo,
    at(-8 * 24),
  );
  await execute(
    setPartnerNextStep,
    {
      id: rovers.id,
      nextStep: "Drop a sample box at committee night",
      nextStepOn: addDays(nzDateKey(now), 2),
    },
    demo,
    at(-2 * 24),
  );

  const dairy = await execute(
    addPartner,
    {
      name: "The Corner Dairy (sample)",
      kind: "stockist",
      status: "active",
      contactName: "Mrs Patel (invented)",
      region: "Wellington",
      notes:
        "Invented stockist. Takes a carton a fortnight and keeps them by the till.",
    },
    demo,
    at(-15 * 24),
  );
  await execute(
    setPartnerPermission,
    {
      id: dairy.id,
      onFile: true,
      note: "Sample record: email from the owner on 2 November saying yes.",
    },
    demo,
    at(-10 * 24),
  );
  await execute(
    setPartnerNextStep,
    {
      id: dairy.id,
      nextStep: "Drop off the second carton",
      nextStepOn: addDays(nzDateKey(now), -1),
    },
    demo,
    at(-6 * 24),
  );

  await execute(
    addPartner,
    {
      name: "Sideline Sevens (sample)",
      kind: "event",
      status: "lead",
      region: "Manawatū",
      notes:
        "Invented event. A one-day sevens tournament. Nobody has been rung yet.",
    },
    demo,
    at(-3 * 24),
  );

  await execute(
    addPartner,
    {
      name: "The Sample Gazette",
      kind: "press",
      status: "no",
      contactName: "The sports desk (invented)",
      notes:
        "Invented paper. Not running product stories this season. Try again next year.",
    },
    demo,
    at(-12 * 24),
  );

  /* ---- two collabs, paid the two ways there are -------------------------- */

  // The club is on a cut: a code of its own, a poster with a QR code that
  // carries the code, and a box of product given for committee night.
  await execute(
    setPartnerCut,
    { id: rovers.id, commissionPercent: 10 },
    demo,
    at(-7 * 24),
  );
  const roversCode = await execute(
    createPromoCode,
    {
      code: "ROVERS10",
      kind: "percent",
      value: 10,
      partnerId: rovers.id,
      note: "Sample code. For the club's own players and supporters.",
    },
    demo,
    at(-7 * 24 + 1),
  );
  await execute(
    createLink,
    {
      slug: "rovers",
      target: "/",
      label: "Clubrooms poster (QR code)",
      utm: { source: "rovers", medium: "print", campaign: "clubrooms" },
      partnerId: rovers.id,
      promoCodeId: roversCode.id,
    },
    demo,
    at(-7 * 24 + 2),
  );
  await execute(
    addPartnerCost,
    {
      partnerId: rovers.id,
      kind: "product",
      amountCents: 4800,
      paidOn: addDays(nzDateKey(now), -6),
      note: "Sample cost. A box of 12 for committee night.",
    },
    demo,
    at(-6 * 24),
  );

  // The creator is on a flat fee: paid for a reel, sent a pack to film with,
  // and given a link of their own with no code on it.
  const creator = await execute(
    addPartner,
    {
      name: "Kai Kicks (sample creator)",
      kind: "ambassador",
      status: "active",
      contactName: "Kai (invented)",
      email: "kai@example.co.nz",
      region: "Auckland",
      notes:
        "Invented creator. Films sideline reels. Paid a flat fee for each one, no cut.",
    },
    demo,
    at(-9 * 24),
  );
  await execute(
    createLink,
    {
      slug: "kai",
      target: "/",
      label: "Kai's bio link",
      utm: { source: "instagram", medium: "social", campaign: "kai" },
      partnerId: creator.id,
    },
    demo,
    at(-9 * 24 + 1),
  );
  await execute(
    addPartnerCost,
    {
      partnerId: creator.id,
      kind: "fee",
      amountCents: 15000,
      paidOn: addDays(nzDateKey(now), -8),
      note: "Sample cost. One reel and two stories.",
    },
    demo,
    at(-8 * 24),
  );
  await execute(
    addPartnerCost,
    {
      partnerId: creator.id,
      kind: "product",
      amountCents: 2700,
      paidOn: addDays(nzDateKey(now), -8),
      note: "Sample cost. A six pack to film with.",
    },
    demo,
    at(-8 * 24),
  );
  for (const [slug, clicks] of [
    ["rovers", 31],
    ["kai", 38],
  ] as const) {
    for (let click = 0; click < clicks; click += 1) {
      await execute(resolveLink, { slug }, shop, at(-1));
    }
  }

  // The orders those two brought in. Placed now, at pretend times after the
  // code and the links existed, through the same operation the checkout uses.
  const rovers10 = { code: "ROVERS10", percent: 10 };
  await placeDemoOrders(db, now, [
    {
      number: "QP-RVRS22",
      hoursAgo: 120,
      first: "Mikaere",
      last: "Rangi",
      city: "Paraparaumu",
      region: "Wellington",
      postcode: "5032",
      line1: "9 Clubrooms Lane",
      packs: [["QP-SHOT-12", 1]],
      code: rovers10,
      via: "rovers",
      then: "delivered",
    },
    {
      number: "QP-RVRS33",
      hoursAgo: 74,
      first: "Dee",
      last: "Hohepa",
      city: "Waikanae",
      region: "Wellington",
      postcode: "5036",
      line1: "2 Changing Shed Road",
      packs: [["QP-SHOT-12", 2]],
      code: rovers10,
      then: "shipped",
    },
    {
      number: "QP-RVRS44",
      hoursAgo: 28,
      first: "Callum",
      last: "Reid",
      city: "Ōtaki",
      region: "Wellington",
      postcode: "5512",
      line1: "31 Goal Line Street",
      packs: [["QP-SHOT-06", 1]],
      code: rovers10,
      via: "rovers",
      then: "packed",
    },
    {
      number: "QP-KAYK22",
      hoursAgo: 60,
      first: "Ruby",
      last: "Tan",
      city: "Auckland",
      region: "Auckland",
      postcode: "1010",
      line1: "14 Highlight Reel Road",
      packs: [["QP-SHOT-24", 1]],
      via: "kai",
      then: "delivered",
    },
    {
      number: "QP-KAYK33",
      hoursAgo: 40,
      first: "Josh",
      last: "Perese",
      city: "Manukau",
      region: "Auckland",
      postcode: "2104",
      line1: "6 Full Time Place",
      packs: [["QP-SHOT-12", 1]],
      via: "kai",
      then: "shipped",
    },
  ]);
}
