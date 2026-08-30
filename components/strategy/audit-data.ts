import "server-only";

import { STRATEGY } from "@/content/strategy";
import type { AudienceAvatars } from "@/content/strategy/types";
import {
  auditPaths,
  fetchStorefront,
  runAudit,
  type AuditRun,
} from "@/lib/strategy";
import { siteUrl } from "@/lib/site";

/**
 * How the Brand & Plan screen gets the store's current score.
 *
 * It runs the audit for real, at request time, against the storefront's own
 * origin — the same checks `tests/strategy/storefront-audit.test.ts` runs, over
 * the same HTTP. Nothing is cached and no result is stored: a score read out of
 * a table is a score from whenever the table was last written, and the whole
 * point of this screen is that it cannot be out of date.
 *
 * `AUDIT_BASE_URL` overrides the origin, which is how the founder can point the
 * admin at a preview deployment before promoting it.
 *
 * It is deliberately not a "run" button. A number a person has to ask for is a
 * number nobody asks for.
 */

export function auditBaseUrl(): string {
  const override = process.env["AUDIT_BASE_URL"]?.trim();
  if (override !== undefined && override !== "") {
    return override.replace(/\/+$/, "");
  }
  return siteUrl();
}

export type StorefrontAudit =
  | {
      readonly kind: "ran";
      readonly run: AuditRun;
      readonly baseUrl: string;
      readonly elapsedMs: number;
    }
  | {
      readonly kind: "unreachable";
      readonly baseUrl: string;
      readonly detail: string;
    };

export async function runStorefrontAudit(): Promise<StorefrontAudit> {
  const baseUrl = auditBaseUrl();
  const startedAt = Date.now();
  try {
    const fetched = await fetchStorefront(baseUrl, auditPaths());
    // Every page failing at the transport layer is a network problem, not a
    // storefront with seventeen faults. Saying so beats reporting 0/17.
    if (fetched.pages.every((page) => page.status === 0)) {
      return {
        kind: "unreachable",
        baseUrl,
        detail:
          fetched.pages[0]?.error ??
          "no page answered, so the audit has nothing to judge",
      };
    }
    return {
      kind: "ran",
      run: runAudit(fetched),
      baseUrl,
      elapsedMs: Date.now() - startedAt,
    };
  } catch (cause) {
    return {
      kind: "unreachable",
      baseUrl,
      detail: cause instanceof Error ? cause.message : String(cause),
    };
  }
}

/** The avatars the audit is written from, for the page that shows both. */
export function avatarsFallback(): AudienceAvatars {
  return STRATEGY.avatars;
}
