import "server-only";

import { notFound } from "next/navigation";
import { cache } from "react";

import { currentStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import { getDocument, type DocumentDetail } from "@/lib/backstage/plans/ops";

/** The slug as it was typed, or null if the address is mangled. */
function decode(raw: string): string | null {
  try {
    return decodeURIComponent(raw);
  } catch {
    return null;
  }
}

/**
 * One document, by the slug in the address. Read once per request however
 * many parts of the page ask for it. An address that is not a document is a
 * "not found", not an error.
 */
export const loadDocument = cache(
  async (rawSlug: string): Promise<DocumentDetail> => {
    const slug = decode(rawSlug);
    if (slug === null) notFound();
    try {
      return await execute(getDocument, { slug }, await staffCaller());
    } catch (error) {
      if (
        error instanceof OpError &&
        (error.code === "not_found" || error.code === "invalid_input")
      ) {
        notFound();
      }
      throw error;
    }
  },
);

/**
 * The document's title for the browser tab. Only for someone signed in: the
 * page itself sends everyone else to the sign-in screen, and a title must not
 * get there first.
 */
export async function documentTitle(rawSlug: string): Promise<string> {
  if ((await currentStaff()) === null) return "Document";
  const slug = decode(rawSlug);
  if (slug === null) return "Document";
  try {
    const doc = await loadDocument(rawSlug);
    return doc.title;
  } catch {
    return "Document";
  }
}
