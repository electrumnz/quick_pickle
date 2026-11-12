import type { Offer } from "@/lib/shop/offer";

/** The boxes on the form, by name, as the screen first fills them. */
export function shopFormValues(offer: Offer): Record<string, string> {
  const dollars = (cents: number) => (cents / 100).toFixed(2);
  const values: Record<string, string> = {
    open: offer.open ? "yes" : "no",
    launchMode: offer.launchMode,
    batchName: offer.batchName,
    preorderShipsFrom: offer.preorderShipsFrom ?? "",
    standard: dollars(offer.shipping.standardCents),
    rural: dollars(offer.shipping.ruralSurchargeCents),
    freeOver:
      offer.shipping.freeOverCents === null
        ? ""
        : dollars(offer.shipping.freeOverCents),
    contactEmail: offer.contactEmail ?? "",
    gst:
      offer.gstRegistered === null
        ? "unknown"
        : offer.gstRegistered
          ? "yes"
          : "no",
  };
  for (const pack of offer.packs) {
    values[`price:${pack.sku}`] = dollars(pack.priceCents);
  }
  return values;
}
