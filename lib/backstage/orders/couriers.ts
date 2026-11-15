/**
 * The couriers the back end knows by name, and where each one's tracking
 * page lives.
 *
 * Each address was read off the courier's own tracking page on 12 November
 * 2026: the form the page posts, the fields it sends, and where a browser
 * ends up when it is opened with a number. A customer is sent this link, so
 * none of it is guessed. A courier can change its site: if a link stops
 * working, this is the one place to put it right.
 *
 *   NZ Post      /tools/tracking/item/<number> lands on ?trackid=<number>
 *                and the page shows the number.
 *   Aramex       ?l=<number> fills the tracker's own box.
 *   Post Haste   the "Bar Code" form on /tools/track/ posts these fields.
 *   NZ Couriers  the "Bar Code" form on /tools/track-a-parcel/ posts these.
 *
 * This file imports nothing, so a screen in the browser can read the list.
 */

export type KnownCourier = {
  readonly key: string;
  readonly name: string;
  /** The tracking page for one parcel, with {number} where its number goes. */
  readonly track: string;
};

export const KNOWN_COURIERS: readonly KnownCourier[] = [
  {
    key: "nzpost",
    name: "NZ Post",
    track: "https://www.nzpost.co.nz/tools/tracking?trackid={number}",
  },
  {
    key: "aramex",
    name: "Aramex",
    track: "https://www.aramex.co.nz/tools/track?l={number}",
  },
  {
    key: "posthaste",
    name: "Post Haste",
    track:
      "https://tools.posthaste.co.nz/phl/servlet/ITNG_TAndTServlet?page=1&VCCA=Enabled&Key_Type=BarCode&barcode_data={number}",
  },
  {
    key: "nzcouriers",
    name: "NZ Couriers",
    track:
      "https://tools.nzcouriers.co.nz/nzc/servlet/ITNG_TAndTServlet?page=1&VCCA=Enabled&Key_Type=BarCode&barcode_data={number}",
  },
];

/**
 * The key a form sends for a courier that is not on the list. The back
 * end's stylesheet knows this word too (.bk-other-choice): it shows the box
 * for the courier's name only while this is the choice.
 */
export const ANOTHER_COURIER = "other";

export function knownCourier(key: string): KnownCourier | null {
  return KNOWN_COURIERS.find((courier) => courier.key === key) ?? null;
}

/** A known courier by the name written on an order, however it was typed. */
export function knownCourierByName(name: string | null): KnownCourier | null {
  const wanted = (name ?? "").trim().toLowerCase();
  if (wanted === "") return null;
  return (
    KNOWN_COURIERS.find((courier) => courier.name.toLowerCase() === wanted) ??
    null
  );
}

/**
 * What was typed or pasted, as a tracking number, or null if it is not one.
 *
 * A label prints its number in groups, and people copy it that way, so
 * three shapes are taken and nothing else:
 *
 *   one run     letters and digits, with dashes if it has them
 *   in groups   digits only, in groups of six or fewer: 0079 4210 3926 ...
 *   overseas    two letters, nine digits, two letters: AB 123 456 789 NZ
 *
 * Either way it comes out as 6 to 40 letters and digits with at least one
 * digit. That is wide enough for every courier's own format, and narrow
 * enough that a name, a street address, a date, a web address or a phone
 * number sitting next to a tracking number is never taken for one.
 */
export function asTrackingNumber(input: string): string | null {
  const typed = input.trim().toUpperCase();
  const groups = typed.split(/\s+/);
  const oneRun = groups.length === 1 && /^[A-Z0-9-]+$/.test(typed);
  const inGroups = groups.every((group) => /^\d{1,6}$/.test(group));
  const overseas = /^[A-Z]{2}\s?\d{3}\s?\d{3}\s?\d{3}\s?[A-Z]{2}$/.test(typed);
  if (!oneRun && !inGroups && !overseas) return null;
  const plain = typed.replace(/[\s-]/g, "");
  return /^[A-Z0-9]{6,40}$/.test(plain) && /\d/.test(plain) ? plain : null;
}

/** The page where one parcel can be followed, or null if we do not know it. */
export function trackingLink(
  courier: KnownCourier | null,
  trackingNumber: string,
): string | null {
  if (courier === null) return null;
  const number = asTrackingNumber(trackingNumber);
  if (number === null) return null;
  return courier.track.replace("{number}", encodeURIComponent(number));
}

/** What one order's shipping form came to, or why it cannot be used. */
export type ShipWith =
  | {
      readonly ok: true;
      readonly carrier: string | null;
      readonly trackingNumber: string | null;
      /** The page a customer is sent to follow the parcel, if there is one. */
      readonly trackingUrl: string | null;
    }
  | { readonly ok: false; readonly why: string };

/**
 * What the shipping form on one order's page comes to.
 *
 * For a courier on the list its name is ours to write, and the link is
 * worked out from the number: nobody pastes one. A number that does not
 * read as a tracking number is refused there, before anything is shipped,
 * because shipping cannot be undone and the customer is emailed whatever
 * was typed.
 *
 * For any other courier the name and the number are taken as typed, and a
 * link only if the person shipping pasted one. They are looking at it. We
 * do not know where that courier's tracking page is, and do not guess.
 */
export function shipWith(typed: {
  readonly courier: string;
  readonly courierName: string;
  readonly trackingNumber: string;
  readonly trackingUrl: string;
}): ShipWith {
  const known = knownCourier(typed.courier.trim());
  const number = typed.trackingNumber.trim();
  if (known !== null) {
    if (number === "") {
      return {
        ok: true,
        carrier: known.name,
        trackingNumber: null,
        trackingUrl: null,
      };
    }
    const read = asTrackingNumber(number);
    if (read === null) {
      return {
        ok: false,
        why: "That does not look like a tracking number. Check it against the label, or leave it empty to ship without one. Nothing has been shipped.",
      };
    }
    return {
      ok: true,
      carrier: known.name,
      trackingNumber: read,
      trackingUrl: trackingLink(known, read),
    };
  }
  const name = typed.courierName.trim();
  const link = typed.trackingUrl.trim();
  return {
    ok: true,
    carrier: name === "" ? null : name,
    trackingNumber: number === "" ? null : number,
    trackingUrl: link === "" ? null : link,
  };
}
