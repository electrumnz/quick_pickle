import { formatGstNumber } from "@/lib/shop/company-numbers";
import type { Offer } from "@/lib/shop/offer";

/** The boxes on the form, by name, as the screen first fills them. */
export function labelFormValues(offer: Offer): Record<string, string> {
  return {
    ingredients: offer.label.ingredients ?? "",
    contains: offer.label.contains ?? "",
    storage: offer.label.storage ?? "",
    legalName: offer.company.legalName ?? "",
    nzbn: offer.company.nzbn ?? "",
    address: offer.company.address ?? "",
    gst:
      offer.gstRegistered === null
        ? "unknown"
        : offer.gstRegistered
          ? "yes"
          : "no",
    gstNumber:
      offer.company.gstNumber === null
        ? ""
        : formatGstNumber(offer.company.gstNumber),
  };
}
