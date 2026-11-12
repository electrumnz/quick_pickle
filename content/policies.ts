/**
 * The fine print: delivery, returns, terms and privacy.
 *
 * Written to be read, in the same voice as the rest of the site, and to say
 * only what is true today. Where the business has not settled a fact (the
 * legal entity, the ship date, the contact address) the page says it is still
 * to come instead of inventing it; those gaps are listed in
 * content/offer.ts UNCONFIRMED and block `npm run prelaunch`.
 *
 * Nothing here limits a customer's rights under the Consumer Guarantees Act
 * 1993 or the Fair Trading Act 1986, and nothing here may be edited to try.
 */

import { formatNzd } from "@/lib/shop/money";

import { shipDateText } from "./faq";
import { SHIPPING, STORE } from "./offer";

export type PolicySection = {
  readonly heading: string;
  readonly body: readonly string[];
};

export type Policy = {
  readonly slug: "delivery" | "returns" | "terms" | "privacy";
  readonly title: string;
  readonly intro: string;
  readonly sections: readonly PolicySection[];
};

const contact =
  STORE.contactEmail === null
    ? "our customer email (the address will be listed here before launch)"
    : STORE.contactEmail;

const shipDate = shipDateText();

const delivery: Policy = {
  slug: "delivery",
  title: "Delivery",
  intro: "Where we send to, what it costs, and when it turns up.",
  sections: [
    {
      heading: "Where we deliver",
      body: [
        "Anywhere in New Zealand with a street or rural delivery address. We can't deliver to PO Boxes or overseas yet.",
      ],
    },
    {
      heading: "What it costs",
      body: [
        `Delivery is ${formatNzd(SHIPPING.standardCents)} per order. Orders of ${formatNzd(SHIPPING.freeOverCents)} or more are delivered free.`,
        `Rural delivery adds ${formatNzd(SHIPPING.ruralSurchargeCents)}, because the courier charges us more to get there. You'll see the full delivery cost at checkout before you pay.`,
      ],
    },
    {
      heading: "Pre-orders",
      body: [
        shipDate === null
          ? `${STORE.batchName} is a pre-order. You pay when you order and it ships when the batch is ready. The ship date will be confirmed by email before anything is sent.`
          : `${STORE.batchName} is a pre-order. You pay when you order and it ships from ${shipDate}.`,
        // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
        "If the date moves, we'll tell you straight away. You can cancel a pre-order for a full refund at any time before it ships.",
      ],
    },
    {
      heading: "When it arrives",
      body: [
        "Once an order is on the courier you'll get an email with tracking. Most places in New Zealand are one to three working days from there; rural addresses can take a couple longer.",
      ],
    },
    {
      heading: "If it goes missing or arrives damaged",
      body: [
        // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
        `Tell us at ${contact} and we'll replace it or refund you. A photo of a damaged parcel helps us sort it with the courier, but you won't be left waiting on them.`,
      ],
    },
  ],
};

const returns: Policy = {
  slug: "returns",
  // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
  title: "Returns and refunds",
  intro: "What happens when something isn't right.",
  sections: [
    {
      heading: "If something's wrong",
      body: [
        // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
        `If your order arrives damaged, faulty, or isn't what you ordered, get in touch at ${contact}. We'll replace it or refund you, your choice, and we'll cover any cost of getting it back to us.`,
      ],
    },
    {
      heading: "Your rights",
      body: [
        // copy-audit-approved: FTA-05 (names the Consumer Guarantees Act; promises nothing beyond it)
        "Everything we sell is covered by the Consumer Guarantees Act 1993. That means it has to be of acceptable quality, match its description, and be fit to eat. Nothing in our terms takes those rights away.",
      ],
    },
    {
      heading: "Changed your mind",
      body: [
        "Because it's food, we can't take back bottles once they've been delivered just because you've changed your mind. If you haven't opened the box and want to talk about it, get in touch and we'll see what we can do.",
        // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
        "Pre-orders are different: you can cancel for a full refund at any time before your order ships.",
      ],
    },
    {
      // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
      heading: "How refunds are paid",
      body: [
        // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
        "Refunds go back to the way you paid, usually within five working days of us agreeing to it.",
      ],
    },
  ],
};

const terms: Policy = {
  slug: "terms",
  title: "Terms of sale",
  intro: "The agreement between you and us when you place an order.",
  sections: [
    {
      heading: "Who you're buying from",
      body: [
        "Quick Pickle is a New Zealand business. The legal name, NZBN and address of the company behind the store will be listed here before the store opens for real orders.",
      ],
    },
    {
      heading: "Prices and payment",
      body: [
        "Prices are in New Zealand dollars. The price you see at checkout, including delivery, is the price you pay. Payment is taken when you place your order, including for pre-orders.",
      ],
    },
    {
      heading: "Orders",
      body: [
        // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
        "Your order is an offer to buy. We accept it when we send your order confirmation. If we can't supply something you've paid for, we'll tell you and refund you in full.",
      ],
    },
    {
      heading: "Pre-orders",
      body: [
        // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
        "A pre-order is an order for stock that hasn't been made yet. We'll give you a ship date and keep you up to date if it changes. You can cancel a pre-order for a full refund at any time before it ships.",
      ],
    },
    {
      heading: "What Quick Pickle is",
      body: [
        // copy-audit-ignore: a disclaimer. It says what the product is NOT.
        "Quick Pickle is a food. It is not a medicine or a dietary supplement, and we make no claims about its effect on health.",
      ],
    },
    {
      heading: "Your rights",
      body: [
        // copy-audit-approved: FTA-05 (names the Consumer Guarantees Act; promises nothing beyond it)
        "Nothing in these terms limits your rights under the Consumer Guarantees Act 1993 or the Fair Trading Act 1986. If you're buying for a business, the Consumer Guarantees Act still applies unless we've agreed otherwise in writing.",
      ],
    },
    {
      heading: "The law that applies",
      body: [
        "These terms are governed by New Zealand law, and New Zealand courts deal with any dispute.",
      ],
    },
  ],
};

const privacy: Policy = {
  slug: "privacy",
  title: "Privacy",
  intro: "What we collect, why, and what we do with it.",
  sections: [
    {
      heading: "What we collect",
      body: [
        "When you order: your name, email, delivery address and, if you give it, a phone number for the courier. When you join the Pickle Crew: your email address.",
        "We don't see or store your card details. Payments are handled by a payment processor.",
      ],
    },
    {
      heading: "What we use it for",
      body: [
        "To send what you ordered, to tell you about your order, and to answer you if you write to us. If you've joined the Pickle Crew, to email you news about new batches. You can leave the crew from any email.",
      ],
    },
    {
      heading: "Who we share it with",
      body: [
        "Only the people who need it to get your order to you: our courier, our payment processor, and the services that run this website and send our email. We don't sell your details to anyone.",
      ],
    },
    {
      heading: "Your jar",
      body: [
        "The contents of your jar are kept in your own browser so they're still there when you come back. Nothing about your jar is sent to us until you place an order.",
      ],
    },
    {
      heading: "How you found us",
      body: [
        "We count visits to this site ourselves, without cookies: how many there were, which pages, whether it was a phone, and how each one found us. Nothing in that says who you are, and we keep it for up to 13 months. If your browser asks not to be tracked (Global Privacy Control, or Do Not Track), we don't count your visit at all.",
        "We also count how many times each of our own short links is followed. We keep the count and nothing about who followed it.",
        "If you arrive through one of those links (from a club, a creator, a flyer or a QR code) or from another website, your own browser remembers which link or site it was, and any promo code that came with the link, for up to 30 days. For a website we keep its name only, not the page you were on. If you place an order, that goes with it, so we can see what is working and give credit to whoever sent you. It says how you found us, not who you are, and we don't use it to follow you around the web.",
        "If you join the Pickle Crew and we give you a code for it, your browser keeps that code in the same way, so it comes off at the checkout without you typing it.",
      ],
    },
    {
      heading: "Cookies",
      body: [
        "We don't use cookies to count visits or to advertise to you. There are three small ones we do use, each only when it is needed, and none of them says who you are.",
        "When you place an order, one holds your order's summary for a short while, so the page that says your order is in can show it.",
        "If we have made a page for people who found us a particular way, or are trying two versions of a page, one remembers which you were shown, so you keep seeing the same one for up to 30 days. And if a page is meant for people who have ordered before, one remembers that an order was placed from your browser.",
      ],
    },
    {
      heading: "Your rights",
      body: [
        `Under the Privacy Act 2020 you can ask to see the information we hold about you and ask us to correct it. Write to ${contact}. If you're not happy with how we respond, you can contact the Office of the Privacy Commissioner.`,
      ],
    },
  ],
};

export const POLICIES: readonly Policy[] = [delivery, returns, terms, privacy];

export function policyBySlug(slug: string): Policy | null {
  return POLICIES.find((policy) => policy.slug === slug) ?? null;
}
