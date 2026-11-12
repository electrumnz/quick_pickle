/**
 * The starter compliance checklist: a short list of things for the owner to
 * look into, for a small business selling a packaged food online in New
 * Zealand.
 *
 * It is deliberately light. One line each, in plain words, with the body to
 * ask. It does not interpret the law, and it does not try to say what applies
 * in this business's exact case: that is for the owner to find out from the
 * bodies named. Every line starts as "to check" for that reason, and nothing
 * here is legal advice.
 *
 * Everything is New Zealand's. If the business ever sells in another country,
 * every line here needs a second version for that country.
 */

import type { StarterComplianceItem } from "./types";

const MPI = "Ministry for Primary Industries (MPI)";
const CODE = "Australia New Zealand Food Standards Code";
const COMMERCE = "Commerce Commission";

type Entry = Omit<StarterComplianceItem, "status">;

const ITEMS: readonly Entry[] = [
  /* ------------------------------------------------------- making food */
  {
    key: "food-registration",
    area: "food",
    title: "Food registration",
    detail:
      "Check which food plan applies in New Zealand and register before making anything for sale. MPI's My Food Rules tool gives the answer.",
    basis: `Food Act 2014. Ask: ${MPI}, or your council.`,
  },
  {
    key: "food-contract-maker",
    area: "food",
    title: "If someone else makes it",
    detail:
      "Check what registration the maker holds, and what you still need as the seller.",
    basis: `Food Act 2014. Ask: ${MPI}.`,
  },
  {
    key: "food-verification",
    area: "food",
    title: "Verification",
    detail: "Check who your verifier is and when the first visit is due.",
    basis: `Food Act 2014. Ask: ${MPI}, or your council.`,
  },
  {
    key: "food-records",
    area: "food",
    title: "Batch records, tracing and recall",
    detail:
      "Check what your food plan says must be written down for each batch, and that you could trace a batch and bring it back. The production day and recall sheets are frames for this.",
    basis: `Food Act 2014. Ask: ${MPI}, or your verifier.`,
  },
  {
    key: "food-shelf-life",
    area: "food",
    title: "Shelf life",
    detail:
      "Check how the date on the label was worked out, and what storage it assumes.",
    basis: `${CODE}. Ask: ${MPI}, or whoever makes it.`,
  },
  {
    key: "food-importing",
    area: "food",
    title: "If anything is imported",
    detail:
      "Check whether bringing the juice or an ingredient into New Zealand needs a registered food importer.",
    basis: `Food Act 2014. Ask: ${MPI}.`,
  },
  {
    key: "food-sampling",
    area: "food",
    title: "Samples and events",
    detail:
      "Check the rules before handing out samples or selling at a market or an event.",
    basis: "Food Act 2014. Ask: the council where the event is.",
  },

  /* ---------------------------------------------------------- the label */
  {
    key: "label-identity",
    area: "label",
    title: "Name, batch code and supplier",
    detail:
      "Check the label carries the name of the food, a lot (batch) code, and the supplier's name and address.",
    basis: `${CODE}, Part 1.2. Ask: ${MPI}.`,
  },
  {
    key: "label-ingredients",
    area: "label",
    title: "Ingredients and allergens",
    detail:
      "Check the ingredient list and any allergen declarations against the real recipe.",
    basis: `${CODE}, Part 1.2. Ask: ${MPI}.`,
  },
  {
    key: "label-date-storage",
    area: "label",
    title: "Date mark and storage",
    detail:
      "Check the date mark and the storage directions against the shelf life.",
    basis: `${CODE}, Part 1.2. Ask: ${MPI}.`,
  },
  {
    key: "label-nutrition",
    area: "label",
    title: "Nutrition information panel",
    detail:
      "Check what nutrition information a bottle this size has to carry, and where the figures come from.",
    basis: `${CODE}, Part 1.2. Ask: ${MPI}.`,
  },
  {
    key: "label-net-contents",
    area: "label",
    title: "Net contents",
    detail:
      "Check how the volume has to be shown on the bottle, and how filling is checked.",
    basis: "Weights and Measures Act 1987. Ask: Trading Standards (MBIE).",
  },
  {
    key: "label-claims",
    area: "label",
    title: "Claims",
    detail:
      "Check that nothing on the label, the site or an ad says or hints what the product does to a body. The copy rules in this project cover the site. The label needs the same look.",
    basis: `${CODE}, Standard 1.2.7. Ask: ${MPI}.`,
  },

  /* ------------------------------------------------ selling and advertising */
  {
    key: "selling-fair-trading",
    area: "selling",
    title: "Nothing misleading",
    detail:
      "Check that everything said about the product, the prices and delivery is true and can be shown to be.",
    basis: `Fair Trading Act 1986. Ask: ${COMMERCE}.`,
  },
  {
    key: "selling-consumer-guarantees",
    area: "selling",
    title: "What customers are entitled to",
    detail:
      "Check the site's returns page against what customers are entitled to in New Zealand when something is wrong.",
    basis: `Consumer Guarantees Act 1993. Ask: ${COMMERCE}, or Consumer Protection (MBIE).`,
  },
  {
    key: "selling-trader",
    area: "selling",
    title: "Selling online as a business",
    detail:
      "Check the site makes clear who the seller is, and that it is a business.",
    basis: `Fair Trading Act 1986. Ask: ${COMMERCE}.`,
  },
  {
    key: "selling-terms",
    area: "selling",
    title: "Terms of sale and pre-orders",
    detail:
      "Have the terms of sale read once by someone qualified, including what happens to pre-order money if a ship date slips.",
    basis: "Fair Trading Act 1986. Ask: a lawyer.",
  },
  {
    key: "selling-advertising",
    area: "selling",
    title: "Ads, paid posts and giveaways",
    detail:
      "Check the advertising codes before running ads, paying or gifting for posts, or running a giveaway.",
    basis: "Ask: Advertising Standards Authority.",
  },

  /* -------------------------------------------------------------- privacy */
  {
    key: "privacy-statement",
    area: "privacy",
    title: "Privacy statement",
    detail:
      "Check the site's privacy page says what is really collected, why, and who gets it.",
    basis: "Privacy Act 2020. Ask: Office of the Privacy Commissioner.",
  },
  {
    key: "privacy-requests-breach",
    area: "privacy",
    title: "Requests and breaches",
    detail:
      "Check who is responsible for privacy, and what to do when someone asks to see or correct their details, or when details are lost or leaked.",
    basis: "Privacy Act 2020. Ask: Office of the Privacy Commissioner.",
  },

  /* ------------------------------------------------------ marketing email */
  {
    key: "email-consent",
    area: "email",
    title: "Consent, sender and unsubscribe",
    detail:
      "Check marketing email only goes to people who agreed, says who it is from, and carries an unsubscribe that works. The Pickle Crew list keeps each person's consent and takes people off at once.",
    basis:
      "Unsolicited Electronic Messages Act 2007. Ask: Department of Internal Affairs.",
  },

  /* --------------------------------------------------------- the business */
  {
    key: "company-entity",
    area: "company",
    title: "Legal entity",
    detail:
      "Check what the business is in law (a sole trader, a partnership or a company) and register it if it needs registering.",
    basis: "Companies Act 1993. Ask: Companies Office, or an accountant.",
  },
  {
    key: "company-nzbn",
    area: "company",
    title: "New Zealand Business Number",
    detail:
      "Check the business has an NZBN, and put it in the site's terms of sale.",
    basis: "NZBN register (nzbn.govt.nz). Ask: Companies Office.",
  },
  {
    key: "company-name",
    area: "company",
    title: "The name and trade marks",
    detail:
      "Check that Quick Pickle and Lucky are free to use in New Zealand, and decide whether to register them.",
    basis:
      "Trade Marks Act 2002. Ask: Intellectual Property Office of New Zealand (IPONZ).",
  },
  {
    key: "company-workplace",
    area: "company",
    title: "Safety at work",
    detail:
      "Check what applies to a production day, and to anyone who comes to help.",
    basis: "Ask: WorkSafe New Zealand.",
  },
  {
    key: "company-staff",
    area: "company",
    title: "Paying someone to help",
    detail:
      "Check what you owe as an employer before anyone's first paid shift.",
    basis: "Ask: Employment New Zealand (MBIE).",
  },
  {
    key: "company-insurance",
    area: "company",
    title: "Insurance (a prudent extra, not a legal requirement)",
    detail:
      "Ask a broker whether product and public liability cover is worth having, and whether the cost of a recall is included. Some events and stockists ask for proof of cover.",
    basis: "Not a legal requirement. Ask: an insurance broker.",
  },

  /* ------------------------------------------------------------------ tax */
  {
    key: "tax-gst",
    area: "tax",
    title: "GST registration",
    detail:
      "Check whether the business has to register for GST in New Zealand, or should choose to. It becomes compulsory once turnover passes Inland Revenue's threshold. Until it is settled, nothing here assumes either way.",
    basis:
      "Goods and Services Tax Act 1985. Ask: Inland Revenue, or an accountant.",
  },
  {
    key: "tax-records",
    area: "tax",
    title: "Tax and records",
    detail:
      "Check with an accountant what has to be filed, what to put aside from each sale, and which records to keep and for how long.",
    basis: "Ask: Inland Revenue, or an accountant.",
  },
];

export const STARTER_COMPLIANCE: readonly StarterComplianceItem[] = ITEMS.map(
  (item) => ({ ...item, status: "check" }),
);
