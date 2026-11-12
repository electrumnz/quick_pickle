/**
 * The stages of everything in the marketing area, and the words for them.
 *
 * Read by the operations (which refuse what is not allowed from a stage) and
 * by the screens (which only offer what is allowed), so the two cannot
 * disagree.
 */

import type {
  CampaignStatus,
  SocialStatus,
  campaigns,
  partners,
  promoCodes,
  reviews,
  socialPosts,
} from "@/db/schema";

/* ---- campaigns --------------------------------------------------------- */

export type CampaignAudience = (typeof campaigns.$inferSelect)["audience"];

export const CAMPAIGN_STATUSES = [
  "draft",
  "approved",
  "sending",
  "sent",
  "cancelled",
] as const satisfies readonly CampaignStatus[];

export const CAMPAIGN_AUDIENCES = [
  "crew",
  "crew-buyers",
  "crew-not-yet-buyers",
] as const satisfies readonly CampaignAudience[];

export const CAMPAIGN_LABEL: Readonly<Record<CampaignStatus, string>> = {
  draft: "Draft",
  approved: "Approved",
  sending: "Sending",
  sent: "Sent",
  cancelled: "Cancelled",
};

export const AUDIENCE_LABEL: Readonly<Record<CampaignAudience, string>> = {
  crew: "Everyone on the Pickle Crew list",
  "crew-buyers": "Crew who have ordered",
  "crew-not-yet-buyers": "Crew who have not ordered yet",
};

/** Still being worked on, or on its way out. */
export const OPEN_CAMPAIGN_STATUSES: readonly CampaignStatus[] = [
  "draft",
  "approved",
  "sending",
];

export type CampaignAction =
  "edit" | "approve" | "unapprove" | "send" | "schedule" | "cancel";

export const CAMPAIGN_ACTIONS: Readonly<
  Record<CampaignStatus, readonly CampaignAction[]>
> = {
  draft: ["edit", "approve", "cancel"],
  approved: ["unapprove", "send", "schedule", "cancel"],
  sending: ["cancel"],
  sent: [],
  cancelled: [],
};

/* ---- social ------------------------------------------------------------ */

export type SocialNetwork = (typeof socialPosts.$inferSelect)["network"];
export type SocialFormat = (typeof socialPosts.$inferSelect)["format"];

export const SOCIAL_STATUSES = [
  "idea",
  "draft",
  "approved",
  "posted",
  "dropped",
] as const satisfies readonly SocialStatus[];

export const SOCIAL_NETWORKS = [
  "instagram",
  "tiktok",
  "facebook",
  "other",
] as const satisfies readonly SocialNetwork[];

export const SOCIAL_FORMATS = [
  "post",
  "reel",
  "story",
] as const satisfies readonly SocialFormat[];

export const SOCIAL_LABEL: Readonly<Record<SocialStatus, string>> = {
  idea: "Idea",
  draft: "Draft",
  approved: "Approved",
  posted: "Posted",
  dropped: "Dropped",
};

export const NETWORK_LABEL: Readonly<Record<SocialNetwork, string>> = {
  instagram: "Instagram",
  tiktok: "TikTok",
  facebook: "Facebook",
  other: "Somewhere else",
};

export const FORMAT_LABEL: Readonly<Record<SocialFormat, string>> = {
  post: "Post",
  reel: "Reel",
  story: "Story",
};

/** Still to be written, approved or posted. */
export const OPEN_SOCIAL_STATUSES: readonly SocialStatus[] = [
  "idea",
  "draft",
  "approved",
];

export type SocialAction =
  "edit" | "approve" | "unapprove" | "markPosted" | "drop" | "pickUp";

export const SOCIAL_ACTIONS: Readonly<
  Record<SocialStatus, readonly SocialAction[]>
> = {
  idea: ["edit", "drop"],
  draft: ["edit", "approve", "drop"],
  approved: ["edit", "unapprove", "markPosted", "drop"],
  posted: [],
  dropped: ["pickUp"],
};

/* ---- reviews ----------------------------------------------------------- */

export type ReviewStatus = (typeof reviews.$inferSelect)["status"];

export const REVIEW_STATUSES = [
  "pending",
  "published",
  "rejected",
] as const satisfies readonly ReviewStatus[];

export const REVIEW_LABEL: Readonly<Record<ReviewStatus, string>> = {
  pending: "Waiting",
  published: "Published",
  rejected: "Rejected",
};

export type ReviewAction = "publish" | "reject" | "unpublish";

export const REVIEW_ACTIONS: Readonly<
  Record<ReviewStatus, readonly ReviewAction[]>
> = {
  pending: ["publish", "reject"],
  published: ["unpublish"],
  rejected: ["publish"],
};

/* ---- partners ---------------------------------------------------------- */

export type PartnerKind = (typeof partners.$inferSelect)["kind"];
export type PartnerStatus = (typeof partners.$inferSelect)["status"];

export const PARTNER_KINDS = [
  "club",
  "stockist",
  "event",
  "ambassador",
  "press",
  "other",
] as const satisfies readonly PartnerKind[];

export const PARTNER_STATUSES = [
  "lead",
  "talking",
  "active",
  "paused",
  "no",
] as const satisfies readonly PartnerStatus[];

export const PARTNER_KIND_LABEL: Readonly<Record<PartnerKind, string>> = {
  club: "Club",
  stockist: "Stockist",
  event: "Event",
  ambassador: "Ambassador",
  press: "Press",
  other: "Other",
};

export const PARTNER_STATUS_LABEL: Readonly<Record<PartnerStatus, string>> = {
  lead: "Not spoken to yet",
  talking: "Talking",
  active: "Working together",
  paused: "On hold",
  no: "Said no",
};

/** Worth chasing: everyone who has not said no or gone quiet. */
export const OPEN_PARTNER_STATUSES: readonly PartnerStatus[] = [
  "lead",
  "talking",
  "active",
];

/* ---- promo codes ------------------------------------------------------- */

export type PromoKind = (typeof promoCodes.$inferSelect)["kind"];

export const PROMO_KINDS = [
  "percent",
  "amount",
  "delivery",
] as const satisfies readonly PromoKind[];

export const PROMO_KIND_LABEL: Readonly<Record<PromoKind, string>> = {
  percent: "A percentage off",
  amount: "Dollars off",
  delivery: "Free standard delivery",
};

/**
 * Where a code stands right now.
 *
 *   live         a customer can use it
 *   not-started  its first day has not come
 *   finished     its last day has gone
 *   used-up      it has been used as many times as it may be
 *   off          switched off by hand
 */
export type PromoState =
  "live" | "not-started" | "finished" | "used-up" | "off";

export const PROMO_STATE_LABEL: Readonly<Record<PromoState, string>> = {
  live: "Live",
  "not-started": "Not started",
  finished: "Finished",
  "used-up": "Used up",
  off: "Switched off",
};
