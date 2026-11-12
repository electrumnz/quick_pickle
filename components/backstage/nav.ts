/**
 * Where you can go in the back end. One list, read by the rail (desk), the
 * tab bar (phone) and the "More" page, so they can never disagree.
 *
 * `tab: true` puts a destination on the phone's tab bar. Four at most: the
 * fifth slot is always "More".
 */
export type Destination = {
  readonly href: string;
  readonly label: string;
  /** One line for the "More" page. */
  readonly blurb: string;
  readonly tab?: boolean;
  /** Owners only. */
  readonly ownerOnly?: boolean;
};

export const DESTINATIONS: readonly Destination[] = [
  {
    href: "/backstage",
    label: "Today",
    blurb: "What needs you now, and what happened while you were away.",
    tab: true,
  },
  {
    href: "/backstage/orders",
    label: "Orders",
    blurb: "Pack them, ship them, find them.",
    tab: true,
  },
  {
    href: "/backstage/customers",
    label: "Customers",
    blurb: "Everyone who has ordered, and the Pickle Crew list.",
    tab: true,
  },
  {
    href: "/backstage/marketing",
    label: "Marketing",
    blurb:
      "Emails to the Pickle Crew, promo codes, the social planner, tracked links, reviews and partners.",
  },
  {
    href: "/backstage/numbers",
    label: "Numbers",
    blurb:
      "What came in, how many came by and how far they got. Our own count, with no cookies.",
  },
  {
    href: "/backstage/plans",
    label: "Plans",
    blurb:
      "The plan, the budget, how we do things, the to-do list, questions to answer and the compliance checklist.",
  },
  {
    href: "/backstage/brand",
    label: "Brand",
    blurb: "The living brand guide: voice, colours, type, Lucky.",
  },
  {
    href: "/backstage/settings",
    label: "Settings",
    blurb: "Staff, the activity log and the go-live list.",
  },
];

export function isCurrent(pathname: string, href: string): boolean {
  if (href === "/backstage") return pathname === "/backstage";
  return pathname === href || pathname.startsWith(`${href}/`);
}
