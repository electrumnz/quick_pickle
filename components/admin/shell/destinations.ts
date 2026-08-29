import type { ComponentType } from "react";

import {
  IconBrand,
  IconCustomers,
  IconMoney,
  IconOrders,
  IconSettings,
  IconSocial,
  IconStock,
  IconTeam,
  IconToday,
  type IconProps,
} from "../ui/icons";

/**
 * Nine places, and no more.
 *
 * This list is the admin's information architecture, written once. The
 * sidebar, the breadcrumbs, the command palette and the search page all read
 * it, so a destination cannot exist in one and be missing from another, and
 * renaming one renames it everywhere.
 *
 * `blurb` is the sentence that tells a non-technical founder what a place is
 * for. It is shown under the title on the page, in the command palette, and in
 * search results — the same words every time, because a description that
 * changes with the surface is a description she has to relearn.
 */

export type Destination = {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  readonly blurb: string;
  /** Extra words that should find this place in search. */
  readonly keywords: readonly string[];
  readonly Icon: ComponentType<IconProps>;
};

export const DESTINATIONS: readonly Destination[] = [
  {
    id: "today",
    label: "Today",
    href: "/admin",
    blurb:
      "Everything waiting on you right now, in one list: decisions the team needs, orders to pack, stock running down, and anything that has failed.",
    keywords: ["home", "dashboard", "inbox", "start", "now", "approvals"],
    Icon: IconToday,
  },
  {
    id: "orders",
    label: "Orders & Delivery",
    href: "/admin/orders",
    blurb:
      "Every order, what is in it, where it is going, and whether it has been packed and posted.",
    keywords: [
      "order",
      "shipping",
      "delivery",
      "tracking",
      "post",
      "courier",
      "pack",
      "refund",
      "customer order",
    ],
    Icon: IconOrders,
  },
  {
    id: "stock",
    label: "Stock & Batches",
    href: "/admin/stock",
    blurb:
      "Bottles on hand, ingredients running low, and every batch from the fermenter to the shelf.",
    keywords: [
      "inventory",
      "stock",
      "batch",
      "brine",
      "recipe",
      "ingredient",
      "supplier",
      "reorder",
      "production",
      "purchase order",
    ],
    Icon: IconStock,
  },
  {
    id: "social",
    label: "Social",
    href: "/admin/social",
    blurb:
      "What is scheduled, what went out, and how it did — Instagram and TikTok in one place.",
    keywords: [
      "instagram",
      "tiktok",
      "post",
      "content",
      "caption",
      "calendar",
      "followers",
    ],
    Icon: IconSocial,
  },
  {
    id: "customers",
    label: "Customers & Marketing",
    href: "/admin/customers",
    blurb:
      "Who buys, who comes back, the bars and shops on the trade list, and every campaign and email sent to them.",
    keywords: [
      "customer",
      "people",
      "wholesale",
      "trade",
      "email",
      "campaign",
      "subscription",
      "reviews",
      "marketing",
    ],
    Icon: IconCustomers,
  },
  {
    id: "money",
    label: "Money",
    href: "/admin/money",
    blurb:
      "Takings, GST, what each bottle costs to make, and what the AI team is spending.",
    keywords: [
      "revenue",
      "sales",
      "gst",
      "tax",
      "ird",
      "cost",
      "margin",
      "spend",
      "finance",
      "takings",
    ],
    Icon: IconMoney,
  },
  {
    id: "brand",
    label: "Brand & Plan",
    href: "/admin/brand",
    blurb:
      "The brand guide and the business plan the whole company works from — the rules the AI team reads before it writes a word.",
    keywords: [
      "brand",
      "voice",
      "rules",
      "guide",
      "plan",
      "strategy",
      "storybrand",
      "market",
      "positioning",
      "compliance",
    ],
    Icon: IconBrand,
  },
  {
    id: "team",
    label: "The Team",
    href: "/admin/team",
    blurb:
      "The six AI staff who run the day to day: what each one does, what it may decide alone, and what it costs.",
    keywords: [
      "agents",
      "ai",
      "staff",
      "marlow",
      "vinnie",
      "dot",
      "teller",
      "bex",
      "mirror",
      "runs",
      "autonomy",
    ],
    Icon: IconTeam,
  },
  {
    id: "settings",
    label: "Settings",
    href: "/admin/settings",
    blurb:
      "Company details, tax and shipping rules, the shop connection, and who is signed in.",
    keywords: [
      "settings",
      "config",
      "company",
      "gst number",
      "nzbn",
      "shipping",
      "shopify",
      "security",
      "password",
      "sessions",
    ],
    Icon: IconSettings,
  },
];

/**
 * The destination a path belongs to, longest match first.
 *
 * Today is matched exactly. Every other destination owns its subtree, so
 * `/admin/orders/HS-01092` is still Orders — but `/admin/anything-unknown` is
 * nowhere, and the sidebar must not light up Today for a page that does not
 * exist.
 */
export function destinationFor(pathname: string): Destination | null {
  const ranked = [...DESTINATIONS].sort(
    (a, b) => b.href.length - a.href.length,
  );
  return (
    ranked.find((destination) =>
      destination.href === "/admin"
        ? pathname === destination.href
        : pathname === destination.href ||
          pathname.startsWith(`${destination.href}/`),
    ) ?? null
  );
}

export function destinationById(id: string): Destination | null {
  return DESTINATIONS.find((destination) => destination.id === id) ?? null;
}
