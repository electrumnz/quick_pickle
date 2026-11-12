/**
 * Invented landing pages for a deployment with no database: one that is
 * live, with a short link to it and an order that came through it, and one
 * still being written. Both go in through the area's own operations, so the
 * live one passed the same copy check a real page has to.
 *
 * There is also one rule and one test, to show what they look like. Both
 * are switched OFF, as everything of the kind is until a person starts it:
 * the demo's front page is the standard page for everybody.
 */

import type { Db } from "@/lib/db/types";

import { systemCaller } from "../core/actor";
import { execute } from "../core/op";
import { createLink, resolveLink } from "../marketing/links";
import { placeDemoOrders } from "../orders/demo";
import { createPage, publishPage } from "./ops";
import { addPageRule, setPageRuleActive, setUpPageTest } from "./routing-ops";

const HOUR = 60 * 60_000;

export async function seedPagesDemo(db: Db, now: Date): Promise<void> {
  const demo = { ...systemCaller("Demo data", "script"), confirmed: true };
  const shop = systemCaller("The shop", "storefront");
  const at = (hours: number) => ({
    db,
    now: new Date(now.getTime() + hours * HOUR),
  });

  const clubs = await execute(
    createPage,
    {
      slug: "clubs",
      name: "Clubs (sample)",
      note: "Sample page. For the link in the clubs newsletter.",
      eyebrow: "For the whole team",
      headline: "One box.\nWhole team.",
      lead: "Twenty-four shots in a box: one each for the first XI, the bench and whoever is running the line. Sour, salty, and down in one.",
    },
    demo,
    at(-6 * 24),
  );
  await execute(
    publishPage,
    { id: clubs.id, acknowledgeRestricted: false },
    demo,
    at(-6 * 24 + 1),
  );
  await execute(
    createLink,
    {
      slug: "clubs",
      target: "/for/clubs",
      label: "Clubs newsletter",
      utm: { source: "newsletter", medium: "email", campaign: "clubs" },
    },
    demo,
    at(-6 * 24 + 2),
  );
  for (let click = 0; click < 17; click += 1) {
    await execute(resolveLink, { slug: "clubs" }, shop, at(-1));
  }

  await execute(
    createPage,
    {
      slug: "sideline",
      name: "Sideline parents (sample)",
      note: "Sample page. Still being written: nobody outside can see it.",
      eyebrow: "For the sideline",
      headline: "Cold hands.\nLoud voice.\nTiny bottle.",
      lead: "Something sour and salty for the ones doing the yelling. It fits in a coat pocket.",
    },
    demo,
    at(-30),
  );

  // A rule and a test, set up and switched off.
  const rule = await execute(
    addPageRule,
    { when: "link", value: "rovers", pageId: clubs.id },
    demo,
    at(-20),
  );
  await execute(
    setPageRuleActive,
    { id: rule.id, active: false },
    demo,
    at(-19),
  );
  await execute(
    setUpPageTest,
    {
      name: "Standard page against the clubs page (sample)",
      bPageId: clubs.id,
    },
    demo,
    at(-18),
  );

  // One order that came through the clubs page, so its numbers have a sale.
  await placeDemoOrders(db, now, [
    {
      number: "QP-TEAM22",
      hoursAgo: 52,
      first: "Wiremu",
      last: "Paki",
      city: "Palmerston North",
      region: "Manawatū-Whanganui",
      postcode: "4410",
      line1: "18 Clubhouse Road",
      packs: [["QP-SHOT-24", 1]],
      via: "clubs",
      page: "clubs",
      then: "shipped",
    },
  ]);
}
