/**
 * The consent gate.
 *
 * One rule, stated once, and enforced in two independent places:
 *
 * > An asset may be chosen for anything that leaves the company only when the
 * > people question has been answered — either there are no identifiable people
 * > in it, or the people in it agreed — and the usage rights are known and
 * > current.
 *
 * The first enforcement is in Postgres: `marketing_assets.selectable_for_outbound`
 * is a stored generated column, so it is computed from the consent and rights
 * columns by the database and cannot be set by any writer, including an agent
 * with a database connection. The agent-facing search filters on it in SQL.
 *
 * The second enforcement is this file, which the tool calls again on the row it
 * just read. That is not redundancy for its own sake: it means a row that
 * reached the tool by any other path — a hand-written query, a future caller, a
 * cached object — is checked against the same rule by the same code, and the
 * time-dependent part of the rule (an expired licence) lives here because a
 * generated column cannot read the clock.
 *
 * There is no `force` argument, no override flag, and no way to ask this
 * function to say yes. A refusal is a thrown `AssetError`, not a warning the
 * caller can log and continue past.
 */

import { AssetError, type AssetErrorCode } from "./errors";
import type { ConsentState, UsageRights } from "./types";

/** The fields the gate reads. Anything with these can be checked. */
export interface ConsentFacts {
  readonly peopleConsent: ConsentState;
  readonly usageRights: UsageRights;
  readonly rightsExpireOn: string | null;
  /** Postgres's own answer, when the row came from the database. */
  readonly selectableForOutbound?: boolean;
}

export type OutboundVerdict =
  | { readonly allowed: true }
  | {
      readonly allowed: false;
      readonly code: AssetErrorCode;
      /** What is wrong, for the agent's transcript and the founder's screen. */
      readonly reason: string;
      /** What would make it usable. Always something she can actually do. */
      readonly fix: string;
    };

export function outboundVerdict(
  asset: ConsentFacts,
  now: Date = new Date(),
): OutboundVerdict {
  if (asset.peopleConsent === "unrecorded") {
    return {
      allowed: false,
      code: "consent_not_recorded",
      reason:
        "There are identifiable people in this one and nobody has recorded whether they agreed to it being published.",
      fix: "Record their answer on the asset, then it can be used.",
    };
  }
  if (asset.peopleConsent === "refused") {
    return {
      allowed: false,
      code: "consent_refused",
      reason:
        "Someone in this one said no to it being published. That answer stands.",
      fix: "Choose a different asset. This one stays in the library for your own reference only.",
    };
  }
  if (asset.usageRights === "unknown") {
    return {
      allowed: false,
      code: "rights_unknown",
      reason: "It is not recorded who owns this file or who may publish it.",
      fix: "Set the usage rights — your own work, permission given, or licensed with a credit.",
    };
  }
  if (asset.rightsExpireOn !== null && expired(asset.rightsExpireOn, now)) {
    return {
      allowed: false,
      code: "rights_expired",
      reason: `The right to publish this one ran out on ${asset.rightsExpireOn}.`,
      fix: "Renew the arrangement and update the date, or choose something else.",
    };
  }
  // If the database computed a verdict, it wins any disagreement — the column
  // is the enforcement point and this function must never be more permissive.
  if (asset.selectableForOutbound === false) {
    return {
      allowed: false,
      code: "consent_not_recorded",
      reason:
        "The database has this one marked as not usable outside the company.",
      fix: "Open it in the library and check its consent and rights.",
    };
  }
  return { allowed: true };
}

/**
 * The throwing form. This is what the tool calls.
 *
 * @throws {AssetError} `consent_not_recorded`, `consent_refused`,
 * `rights_unknown` or `rights_expired`.
 */
export function assertSelectableForOutbound(
  asset: ConsentFacts & { readonly id?: string; readonly title?: string },
  now: Date = new Date(),
): void {
  const verdict = outboundVerdict(asset, now);
  if (verdict.allowed) return;
  throw new AssetError(
    verdict.code,
    `${asset.title === undefined ? "That asset" : `"${asset.title}"`} cannot be used outside the company. ${verdict.reason} ${verdict.fix}`,
    { assetId: asset.id ?? null, consent: asset.peopleConsent },
  );
}

function expired(date: string, now: Date): boolean {
  const parsed = Date.parse(`${date}T23:59:59Z`);
  return Number.isFinite(parsed) && parsed < now.getTime();
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** How each consent state is said out loud, in the admin and to an agent. */
export const CONSENT_WORDS: Readonly<
  Record<ConsentState, { readonly label: string; readonly meaning: string }>
> = {
  no_people: {
    label: "No people in it",
    meaning:
      "Nobody identifiable appears, so there is nobody to ask. Free to use.",
  },
  granted: {
    label: "They agreed",
    meaning: "The people in this one agreed to it being published.",
  },
  refused: {
    label: "They said no",
    meaning:
      "Someone in this one asked not to be published. It stays internal.",
  },
  unrecorded: {
    label: "Not asked yet",
    meaning:
      "There are people in this one and their answer is not on file, so no agent can choose it.",
  },
};

export const RIGHTS_WORDS: Readonly<
  Record<UsageRights, { readonly label: string; readonly meaning: string }>
> = {
  own_work: {
    label: "Shot by us",
    meaning: "Half Sour took it, so Half Sour may publish it.",
  },
  permission_given: {
    label: "Permission given",
    meaning:
      "Someone else took it and said we may use it. Their name goes in the credit.",
  },
  licensed: {
    label: "Licensed",
    meaning:
      "Paid for or licensed, with terms. The credit and any end date belong here.",
  },
  unknown: {
    label: "Not recorded",
    meaning: "Nobody has said where this came from, so no agent can choose it.",
  },
};
