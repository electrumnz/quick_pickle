import { formatGstNumber } from "@/lib/shop/company-numbers";
import { labelsOf, type Offer } from "@/lib/shop/offer";

/** The boxes on the form, by name, as the screen first fills them. */
export function labelFormValues(offer: Offer): Record<string, string> {
  // The first flavour's lines keep their plain names; each other
  // flavour's are named for it (labelField).
  const lines: Record<string, string> = {};
  for (const { flavour, label } of labelsOf(offer)) {
    const first = flavour.key === offer.flavours[0]?.key;
    for (const line of ["ingredients", "contains", "storage"] as const) {
      lines[labelField(line, flavour.key, first)] = label[line] ?? "";
    }
  }
  return {
    ...lines,
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

/**
 * The box a label line is typed in: "ingredients" for the first flavour,
 * "ingredients:mango-chilli-lime" for another.
 */
export function labelField(
  line: "ingredients" | "contains" | "storage",
  flavourKey: string,
  first: boolean,
): string {
  return first ? line : `${line}:${flavourKey}`;
}
