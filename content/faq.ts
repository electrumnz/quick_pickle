/**
 * Questions, and straight answers.
 *
 * Anything with a number or a date in it is built from the offer it is handed
 * (lib/shop/offer.ts), so a price or a rate is stated in exactly one place
 * and moves when the back end moves it. Where a fact is not settled yet the
 * answer says so plainly rather than guessing.
 *
 * What is in the bottle is the label's own words, typed in the back end by
 * somebody with the printed label in hand. They are shown as they were
 * typed and nothing is added to them.
 */

import { labelsOf, type Label, type Offer } from "@/lib/shop/offer";

import { deliveryAnswer } from "./delivery";
import { PRODUCT } from "./offer";

export type Faq = { readonly q: string; readonly a: readonly string[] };

const DATE_FORMAT = new Intl.DateTimeFormat("en-NZ", {
  day: "numeric",
  month: "long",
  year: "numeric",
  timeZone: "Pacific/Auckland",
});

/** "14 February 2027", or null while the date is not locked in. */
export function shipDateText(
  offer: Pick<Offer, "preorderShipsFrom">,
): string | null {
  if (offer.preorderShipsFrom === null) return null;
  const date = new Date(`${offer.preorderShipsFrom}T12:00:00+13:00`);
  return Number.isNaN(date.getTime()) ? null : DATE_FORMAT.format(date);
}

function shippingAnswer({ shipping }: Offer): readonly string[] {
  const [rate, rural] = deliveryAnswer(shipping);
  return [
    `All over New Zealand. ${rate}`,
    `${rural} We don't send overseas yet.`,
  ];
}

function preorderAnswer(offer: Offer): readonly string[] {
  const date = shipDateText(offer);
  if (date === null) {
    return [
      `We're locking in the ship date for ${offer.batchName} now. You'll get it by email before anything leaves the building.`,
      // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
      "Changed your mind before it ships? Tell us and we'll refund you in full.",
    ];
  }
  return [
    `${offer.batchName} ships from ${date}. We'll email you the moment yours is on the courier.`,
    // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
    "Changed your mind before it ships? Tell us and we'll refund you in full.",
  ];
}

/** A line that ends in a full stop, whether or not it was typed with one. */
export function withStop(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

/**
 * What the label says. Written for every way it can be set: no list yet,
 * a list alone, and a list with an allergen line, a storage line or both.
 * With no allergen line nothing is said about allergens either way.
 */
function labelAnswer(
  offer: Pick<Offer, "label" | "flavourLabels" | "flavours">,
): readonly string[] {
  const lines = (label: Label) => [
    ...(label.ingredients === null ? [] : [withStop(label.ingredients)]),
    ...(label.contains === null ? [] : [withStop(label.contains)]),
    ...(label.storage === null ? [] : [withStop(label.storage)]),
  ];
  const labels = labelsOf(offer);
  const [only] = labels;
  // One flavour: its label, as it always was.
  if (labels.length === 1 && only !== undefined) {
    return only.label.ingredients === null
      ? [
          "The full ingredients list will be right here before the first bottle ships, exactly as it is printed on the label.",
          ...lines(only.label),
        ]
      : lines(only.label);
  }
  // Nothing typed for any flavour: one promise for them all.
  if (labels.every(({ label }) => label.ingredients === null)) {
    return [
      "The full ingredients list will be right here before the first bottle ships, exactly as it is printed on the label.",
      ...labels.flatMap(({ label }) => [
        ...(label.contains === null ? [] : [withStop(label.contains)]),
        ...(label.storage === null ? [] : [withStop(label.storage)]),
      ]),
    ];
  }
  // Each flavour's own label, said as its own. One flavour's list never
  // stands for another's.
  return labels.flatMap(({ flavour, label }) =>
    label.ingredients === null
      ? [
          `The ${flavour.name} list will be right here before its first bottle ships, exactly as it is printed on its label.`,
        ]
      : [`The ${flavour.name} label says:`, ...lines(label)],
  );
}

function sizeAnswer(offer: Offer): readonly string[] {
  const sizes = offer.packs.map((pack) => String(pack.shots));
  const list =
    sizes.length > 1
      ? `${sizes.slice(0, -1).join(", ")} or ${sizes[sizes.length - 1]}`
      : (sizes[0] ?? "");
  const volume =
    PRODUCT.shotVolumeMl === null
      ? "Each one is a single shot."
      : `Each shot is ${String(PRODUCT.shotVolumeMl)} ml.`;
  const flavours = offer.flavours.map((flavour) => flavour.name);
  const each =
    flavours.length > 1
      ? ` Every pack comes in ${flavours.slice(0, -1).join(", ")} or ${flavours[flavours.length - 1] ?? ""}, at the same price.`
      : "";
  return [
    `Packs of ${list}. ${volume} The bigger the pack, the less each shot costs.${each}`,
  ];
}

function helpAnswer(offer: Offer): readonly string[] {
  const contact =
    offer.contactEmail === null
      ? "Get in touch and we'll sort it."
      : `Email ${offer.contactEmail} and we'll sort it.`;
  return [
    // copy-audit-approved: R-19 (this is the returns and refunds policy itself; keep in step with content/policies.ts)
    `${contact} If something arrives damaged or isn't what you ordered, you'll get a replacement or your money back.`,
    // copy-audit-approved: FTA-05 (names the Consumer Guarantees Act; promises nothing beyond it)
    "Your rights under the Consumer Guarantees Act apply to everything we sell.",
  ];
}

export function faqs(offer: Offer): readonly Faq[] {
  const list: Faq[] = [
    {
      q: "What actually is it?",
      a: [
        "Pickle juice, in a shot. The juice without the pickles: clear, sour, salty, and down in one.",
      ],
    },
    {
      q: "Are there pickles in it?",
      a: ["Nope. No pickles, no bits, nothing floating. Just the juice."],
    },
    {
      q: "What does it taste like?",
      a: [
        "Original is like the last sip from the pickle jar. Sour first, salty after. Mango Chilli Lime is what it says on the bottle. Most people pull a face on their first one of either. That's half the fun.",
      ],
    },
    {
      q: "When do I have one?",
      a: [
        "Whenever your ritual says so. Before the whistle, at half-time, after the final hooter. There's no wrong time.",
      ],
    },
    {
      q: "Is it one of those sports supplements?",
      a: [
        "No. It's pickle juice, which makes it food. We're not going to tell you it does anything except taste like pickles.",
      ],
    },
    { q: "How big are the packs?", a: sizeAnswer(offer) },
    { q: "What's in it?", a: labelAnswer(offer) },
  ];

  if (offer.launchMode === "preorder") {
    list.push({ q: "When will my pre-order ship?", a: preorderAnswer(offer) });
  }

  list.push(
    {
      q: "Where do you deliver, and what does it cost?",
      a: shippingAnswer(offer),
    },
    { q: "Something's wrong with my order. Now what?", a: helpAnswer(offer) },
  );

  return list;
}
