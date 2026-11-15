/**
 * Marketing: telling people. Everything the area can read or change.
 *
 * The operations live in a file per part, because together they run well
 * past what one file should hold. This is the one place that lists them all,
 * so a screen, an automation or the MCP connection can import from here and
 * not care how they are split.
 *
 *   campaigns.ts     emails to the Pickle Crew, from draft to sent
 *   promo-codes.ts   codes a customer types at the checkout
 *   specials.ts      a saving that comes off by itself, and says so on the page
 *   social.ts        the planner for posts and reels
 *   links.ts         tracked short links (/go/<slug>)
 *   reviews.ts       reviews, read by a person before anyone sees them
 *   partners.ts      clubs, stockists, events, ambassadors, press
 *   collabs.ts       what a partner has brought in and cost, and the return
 *   overview.ts      the front page, and what is waiting on a person
 *
 * Beside the operations are the plain functions other parts of the app call:
 * the copy check (copy-check.ts, gate.ts), the email builder (email.ts) and
 * the checkout's promo sums (promo.ts).
 */

export * from "./campaigns";
export * from "./collabs";
export * from "./links";
export * from "./overview";
export * from "./partners";
export * from "./promo-codes";
export * from "./reviews";
export * from "./social";
export * from "./specials";

import {
  approveCampaign,
  cancelCampaign,
  campaignQueue,
  createCampaign,
  dueCampaigns,
  findCampaignSend,
  getCampaign,
  listCampaigns,
  listCampaignSends,
  markCampaignSends,
  noteCampaignTrouble,
  scheduleCampaign,
  sendCampaign,
  sendDueCampaign,
  unapproveCampaign,
  updateCampaign,
} from "./campaigns";
import {
  addPartnerCost,
  collabBoard,
  partnerResults,
  promoCodeResults,
  removePartnerCost,
} from "./collabs";
import {
  countLinkClick,
  createLink,
  getLink,
  listLinks,
  resolveLink,
  setLinkActive,
  updateLink,
} from "./links";
import { marketingNeedsYou, marketingOverview } from "./overview";
import {
  addPartner,
  getPartner,
  listPartners,
  setPartnerCut,
  setPartnerNextStep,
  setPartnerPermission,
  setPartnerStatus,
  updatePartner,
} from "./partners";
import {
  checkPromoCode,
  createPromoCode,
  crewWelcomeCode,
  getPromoCode,
  listPromoCodes,
  peekPromoCode,
  setCrewWelcomeCode,
  setPromoCodeActive,
  updatePromoCode,
} from "./promo-codes";
import {
  addReview,
  countReviews,
  getReview,
  listReviews,
  publishReview,
  rejectReview,
  submitReview,
  unpublishReview,
} from "./reviews";
import {
  addSocialPost,
  approveSocialPost,
  dropSocialPost,
  getSocialPost,
  listSocialPosts,
  markSocialPosted,
  unapproveSocialPost,
  updateSocialPost,
} from "./social";

import { SPECIALS_OPS } from "./specials";

/** Every operation in the area, for a registry to pick up in one go. */
export const MARKETING_OPS = [
  ...SPECIALS_OPS,
  marketingOverview,
  marketingNeedsYou,
  listCampaigns,
  getCampaign,
  listCampaignSends,
  createCampaign,
  updateCampaign,
  approveCampaign,
  unapproveCampaign,
  sendCampaign,
  scheduleCampaign,
  dueCampaigns,
  sendDueCampaign,
  cancelCampaign,
  campaignQueue,
  findCampaignSend,
  markCampaignSends,
  noteCampaignTrouble,
  listPromoCodes,
  getPromoCode,
  createPromoCode,
  updatePromoCode,
  setPromoCodeActive,
  checkPromoCode,
  peekPromoCode,
  setCrewWelcomeCode,
  crewWelcomeCode,
  promoCodeResults,
  listSocialPosts,
  getSocialPost,
  addSocialPost,
  updateSocialPost,
  approveSocialPost,
  unapproveSocialPost,
  markSocialPosted,
  dropSocialPost,
  listLinks,
  getLink,
  createLink,
  updateLink,
  setLinkActive,
  resolveLink,
  countLinkClick,
  listReviews,
  countReviews,
  getReview,
  addReview,
  submitReview,
  publishReview,
  rejectReview,
  unpublishReview,
  listPartners,
  getPartner,
  addPartner,
  updatePartner,
  setPartnerStatus,
  setPartnerNextStep,
  setPartnerPermission,
  setPartnerCut,
  addPartnerCost,
  removePartnerCost,
  partnerResults,
  collabBoard,
] as const;
