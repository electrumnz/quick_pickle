import { describe, expect, it } from "vitest";

import {
  deliveryAnswer,
  deliveryPromise,
  deliveryTerms,
  ruralHint,
} from "@/content/delivery";
import { ORDER_EMAILS } from "@/content/emails";
import { faqs, shipDateText } from "@/content/faq";
import { policies, POLICY_SLUGS, policyBySlug } from "@/content/policies";
import { BUY, BUYBAR, FINAL, HERO, JAR, THANKS } from "@/content/site";
import { checkOutgoing } from "@/lib/backstage/core/copy";
import { FILE_OFFER, forPage, type Offer } from "@/lib/shop/offer";
import { offerWith } from "@/lib/shop/offer-changes";
import {
  freeDeliveryFrom,
  quote,
  standardDeliveryCents,
} from "@/lib/shop/pricing";

/**
 * The offer can be changed from the back end, so every sentence that reads
 * it has to be true for every way it can be set. These hold the sentences
 * for each of them, and hold the standard ones exactly as they were.
 */

const small = FILE_OFFER.packs[0]!;

/** The file's offer with some of it changed, as the back end would. */
const withRates = (shipping: {
  standardCents?: number;
  ruralSurchargeCents?: number;
  freeOverCents?: number | null;
}): Offer => offerWith({ shipping });

const flat = withRates({ freeOverCents: null });
const freeForAll = withRates({ standardCents: 0 });
const freeNoRural = withRates({ standardCents: 0, ruralSurchargeCents: 0 });
const noRural = withRates({ ruralSurchargeCents: 0 });

/** Every sentence a shape of delivery puts on the site. */
function said(offer: Offer): string[] {
  const promise = deliveryPromise(offer.shipping);
  return [
    ...deliveryAnswer(offer.shipping),
    ...deliveryTerms(offer.shipping),
    promise.lead,
    ...(promise.strong === null ? [] : [promise.strong]),
    ...faqs(offer).flatMap((faq) => [faq.q, ...faq.a]),
    ...policies(offer).flatMap((policy) =>
      policy.sections.flatMap((section) => [section.heading, ...section.body]),
    ),
  ];
}

describe("what delivery costs, in words", () => {
  it("says the standard rates exactly as the site always has", () => {
    const { shipping } = FILE_OFFER;
    expect(deliveryAnswer(shipping)).toEqual([
      "Delivery is $7, or free when your order is $60 or more.",
      "Rural addresses cost the courier more to reach, so they add $4.50.",
    ]);
    expect(deliveryTerms(shipping)).toEqual([
      "Delivery is $7 per order. Orders of $60 or more are delivered free.",
      "Rural delivery adds $4.50, because the courier charges us more to get there. You'll see the full delivery cost at checkout before you pay.",
    ]);
    expect(deliveryPromise(shipping)).toEqual({
      lead: "Delivered anywhere in New Zealand for $7.",
      strong: "Free delivery over $60.",
    });
    expect(ruralHint(shipping)).toBe(
      "Rural delivery costs the courier more, so it adds $4.50.",
    );
  });

  it("promises no free delivery when no order earns it", () => {
    expect(deliveryAnswer(flat.shipping)[0]).toBe("Delivery is $7 an order.");
    expect(deliveryTerms(flat.shipping)[0]).toBe("Delivery is $7 per order.");
    expect(deliveryPromise(flat.shipping)).toEqual({
      lead: "Delivered anywhere in New Zealand for $7.",
      strong: null,
    });
    for (const sentence of said(flat)) {
      expect(sentence.toLowerCase(), sentence).not.toMatch(/\bfree\b/);
    }
  });

  it("says standard delivery is free, and never just free, while a rural address pays an extra", () => {
    expect(deliveryAnswer(freeForAll.shipping)).toEqual([
      "Standard delivery is free.",
      "Rural addresses cost the courier more to reach, so they add $4.50.",
    ]);
    expect(deliveryTerms(freeForAll.shipping)[0]).toBe(
      "Standard delivery is free on every order.",
    );
    expect(deliveryPromise(freeForAll.shipping)).toEqual({
      lead: "Delivered anywhere in New Zealand.",
      strong: "Standard delivery is free.",
    });
    // No figure for a rate that is nothing, anywhere.
    for (const sentence of said(freeForAll)) {
      expect(sentence, sentence).not.toContain("$0");
    }
  });

  it("says delivery is free, plainly, when nobody pays anything", () => {
    expect(deliveryAnswer(freeNoRural.shipping)).toEqual([
      "Delivery is free.",
      "Rural addresses cost no extra.",
    ]);
    expect(deliveryTerms(freeNoRural.shipping)).toEqual([
      "Delivery is free on every order.",
      "A rural address costs no extra. You'll see the full delivery cost at checkout before you pay.",
    ]);
    expect(deliveryPromise(freeNoRural.shipping).strong).toBe(
      "Delivery is free.",
    );
  });

  it("says a rural address costs no extra when it does not", () => {
    expect(deliveryAnswer(noRural.shipping)[1]).toBe(
      "Rural addresses cost no extra.",
    );
    for (const sentence of said(noRural)) {
      expect(sentence, sentence).not.toContain("$0");
    }
  });

  it("passes the copy rules and has no long dash, however the rates are set", () => {
    // Only the sentences that change with the rates. The rest of the fine
    // print is read where it is written, by the scanner (npm run audit:copy).
    const aboutDelivery = (offer: Offer): string[] => {
      const promise = deliveryPromise(offer.shipping);
      return [
        ...deliveryAnswer(offer.shipping),
        ...deliveryTerms(offer.shipping),
        promise.lead,
        ...(promise.strong === null ? [] : [promise.strong]),
        ruralHint(offer.shipping),
      ];
    };
    for (const offer of [FILE_OFFER, flat, freeForAll, freeNoRural, noRural]) {
      for (const sentence of aboutDelivery(offer)) {
        // A restricted phrase is allowed where its condition is said with
        // it (the spend that earns free delivery). Nothing banned, and no
        // long dash, ever: the check finds both.
        const stops = checkOutgoing({ words: sentence }).filter(
          (finding) => finding.kind !== "restricted",
        );
        expect(stops, sentence).toEqual([]);
      }
    }
  });
});

describe("the sums, however the rates are set", () => {
  const jar = (qty: number) => ({ lines: [{ sku: small.sku, qty }] });

  it("names the spend that earns free delivery, or says there is none", () => {
    expect(freeDeliveryFrom(FILE_OFFER.shipping)).toBe(6000);
    expect(freeDeliveryFrom(flat.shipping)).toBeNull();
    // Free for everybody: there is nothing left to earn.
    expect(freeDeliveryFrom(freeForAll.shipping)).toBeNull();
  });

  it("charges the flat rate on every order when none earns free delivery", () => {
    const big = quote(flat, jar(10));
    expect(big.subtotalCents).toBeGreaterThan(6000);
    expect(big.deliveryCents).toBe(700);
    expect(big.freeDelivery).toBe(false);
    expect(big.freeDeliveryGapCents).toBe(0);
    expect(standardDeliveryCents(flat.shipping, 1_000_000)).toBe(700);
  });

  it("charges nothing for standard delivery when it is free, and still the rural extra", () => {
    const priced = quote(freeForAll, jar(1), { rural: true });
    expect(priced.deliveryCents).toBe(0);
    expect(priced.ruralCents).toBe(450);
    expect(priced.totalCents).toBe(small.priceCents + 450);
    // Not earned: it was never there to earn.
    expect(priced.freeDelivery).toBe(false);
    expect(priced.freeDeliveryGapCents).toBe(0);
  });

  it("charges a rural address nothing extra when the extra is nothing", () => {
    const priced = quote(noRural, jar(1), { rural: true });
    expect(priced.ruralCents).toBe(0);
    expect(priced.totalCents).toBe(small.priceCents + 700);
  });

  it("prices from the offer it is handed, not from the file", () => {
    const dearer = offerWith({ prices: { [small.sku]: 3000 } });
    expect(quote(dearer, jar(2)).subtotalCents).toBe(6000);
    expect(quote(FILE_OFFER, jar(2)).subtotalCents).toBe(small.priceCents * 2);
    // And earns free delivery by the offer's own threshold.
    const lower = withRates({ freeOverCents: small.priceCents });
    expect(quote(lower, jar(1)).freeDelivery).toBe(true);
    expect(quote(lower, jar(1)).deliveryCents).toBe(0);
  });
});

describe("pre-order or live", () => {
  const live = offerWith({ launchMode: "live" });
  const dated = offerWith({ preorderShipsFrom: "2026-12-01" });
  const renamed = offerWith({ batchName: "Batch 002" });

  it("says pre-order on every button while it is one, and buy when it is not", () => {
    expect(HERO.cta(FILE_OFFER)).toBe("Pre-order a pack");
    expect(HERO.cta(live)).toBe("Grab a pack");
    expect(BUY.add(FILE_OFFER)).toBe("Pre-order");
    expect(BUY.add(live)).toBe("Add to jar");
    expect(BUYBAR.add(FILE_OFFER)).toBe("Pre-order");
    expect(BUYBAR.add(live)).toBe("Add");
    expect(FINAL.cta(live)).toBe("Grab a pack");
    expect(BUY.eyebrow(FILE_OFFER)).toBe("Pre-order Batch 001");
    expect(BUY.eyebrow(live)).toBe("The line-up");
    expect(JAR.preorderNote(live)).toBeNull();
    expect(JAR.preorderNote(FILE_OFFER)).toContain("Batch 001 pre-order");
  });

  it("names the batch as the back end has it", () => {
    expect(BUY.eyebrow(renamed)).toBe("Pre-order Batch 002");
    expect(FINAL.body(renamed)).toContain("Batch 002 is open for pre-order");
    expect(JAR.preorderNote(renamed)).toContain("Batch 002 pre-order");
    expect(THANKS.preorderNote("Batch 002")).toContain("Batch 002 pre-order");
    expect(THANKS.preorderOnly("Batch 002")).toContain("Batch 002 pre-order");
    expect(ORDER_EMAILS.receipt.preorder("Batch 002")).toBe(
      "This is a Batch 002 pre-order, so it ships when the batch is ready.",
    );
    // A name that could not be shown is left out, and the line still reads.
    expect(ORDER_EMAILS.receipt.preorder(null)).toBe(
      "This is a pre-order, so it ships when the batch is ready.",
    );
    expect(ORDER_EMAILS.receipt.preorderFrom(null)).toBe(
      "This is a pre-order. It ships from",
    );
  });

  it("gives the ship date once there is one, and never guesses before", () => {
    expect(shipDateText(FILE_OFFER)).toBeNull();
    expect(shipDateText(dated)).toBe("1 December 2026");
    const asked = (offer: Offer) =>
      faqs(offer).find((faq) => faq.q === "When will my pre-order ship?");
    expect(asked(FILE_OFFER)?.a[0]).toContain("locking in the ship date");
    expect(asked(dated)?.a[0]).toBe(
      "Batch 001 ships from 1 December 2026. We'll email you the moment yours is on the courier.",
    );
    // Live: nobody is asked to wait, so the question is not there.
    expect(asked(live)).toBeUndefined();
  });

  it("only has a pre-orders section on the delivery page during a pre-order", () => {
    const headings = (offer: Offer) =>
      policyBySlug(offer, "delivery")?.sections.map(
        (section) => section.heading,
      );
    expect(headings(FILE_OFFER)).toContain("Pre-orders");
    expect(headings(live)).not.toContain("Pre-orders");
    expect(
      policyBySlug(dated, "delivery")
        ?.sections.find((section) => section.heading === "Pre-orders")
        ?.body.join(" "),
    ).toContain("ships from 1 December 2026");
    // The right to cancel a pre-order stays in the terms either way.
    expect(
      policyBySlug(live, "terms")?.sections.map((section) => section.heading),
    ).toContain("Pre-orders");
  });

  it("has the same four pages whatever is on sale", () => {
    for (const offer of [FILE_OFFER, live, flat, freeNoRural]) {
      expect(policies(offer).map((policy) => policy.slug)).toEqual([
        ...POLICY_SLUGS,
      ]);
    }
    expect(policyBySlug(FILE_OFFER, "nope")).toBeNull();
  });

  it("gives the contact address once there is one", () => {
    const reachable = offerWith({ contactEmail: "hello@quickpickle.example" });
    const help = (offer: Offer) =>
      faqs(offer).find((faq) => faq.q.startsWith("Something's wrong"))?.a[0];
    expect(help(FILE_OFFER)).toContain("Get in touch and we'll sort it.");
    expect(help(reachable)).toContain(
      "Email hello@quickpickle.example and we'll sort it.",
    );
    expect(
      policyBySlug(reachable, "privacy")
        ?.sections.map((section) => section.body.join(" "))
        .join(" "),
    ).toContain("Write to hello@quickpickle.example.");
  });
});

describe("what a page in the browser is handed", () => {
  it("is enough to draw every price, and nothing about the business", () => {
    const handed = forPage(
      offerWith({ contactEmail: "hello@quickpickle.example" }),
    );
    expect(Object.keys(handed).sort()).toEqual([
      "batchName",
      "launchMode",
      "open",
      "packs",
      "shipping",
      "version",
    ]);
    // The notes on what is still to confirm are for the people running the
    // shop. They never reach a customer's browser.
    const sent = JSON.stringify(handed);
    expect(sent).not.toContain("stand-in");
    expect(sent).not.toContain("Ashleigh");
    expect(sent).not.toContain("quickpickle.example");
    expect(FILE_OFFER.unconfirmed.length).toBeGreaterThan(0);
  });
});
