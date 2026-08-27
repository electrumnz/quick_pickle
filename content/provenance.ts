/**
 * HALF SOUR — the provenance ledger.
 *
 * WHY THIS FILE EXISTS
 *
 * Fair Trading Act 1986 s 13(j) makes a false or misleading representation
 * about the place of origin of goods an offence. Section 12A catches a line
 * that happens to be true but that we had no reasonable grounds for when we
 * published it. Section 40(1) prices both at up to $200,000 for an individual.
 * `legal/COPY-RULES.md` §3A Group G and the five-question checklist in §4A are
 * the house rules that follow from that.
 *
 * So provenance is not a string in this codebase. It is a record with a state.
 * A fact is either CONFIRMED — someone asked the supplier, wrote down the
 * answer and dated it — or it is UNCONFIRMED, in which case the page still
 * renders it, but renders it as a thing we have not yet stood behind, and the
 * page carries `robots: noindex` until the last one clears.
 *
 * THE HONEST STATE OF THIS BUILD, 2026-08-27
 *
 * Every fact in `content/suppliers.ts` is UNCONFIRMED. The supplier names,
 * places and volumes come from HALF SOUR's own supplier register as seeded in
 * `supabase/seed.sql`. Not one of them has been through the §4A checklist with
 * the business it names. Nothing here is presented as a settled claim, and
 * `content/evidence/provenance-ledger.md` prints the whole ledger so the
 * founder can work down it.
 */

/** The five questions in COPY-RULES §4A. A fact clears when all five do. */
export const CHECKLIST = [
  {
    id: "relationship",
    question: "Does the supply relationship exist today?",
    detail:
      "An order, an invoice or a written agreement. Not a conversation and not an intention.",
  },
  {
    id: "batch",
    question: "Is the ingredient in the batch that is on sale right now?",
    detail:
      "Provenance attaches to the bottle a customer receives, not to the recipe in principle.",
  },
  {
    id: "place",
    question: "Is the place name right, at the right level?",
    detail:
      "A region and a town are different statements. So is where a thing was grown and where it was made.",
  },
  {
    id: "permission",
    question: "Do we have written permission to name them?",
    detail:
      "Naming a business, a family or a hapū in marketing needs their agreement in writing.",
  },
  {
    id: "expiry",
    question: "Who removes the line when it stops being true, and by when?",
    detail:
      "Provenance copy goes stale silently. A named owner and a review date are part of the fact.",
  },
] as const;

export type ChecklistId = (typeof CHECKLIST)[number]["id"];

export type FactStatus = "confirmed" | "unconfirmed";

/**
 * One statement about where something comes from or who makes it.
 *
 * `value` is always written. Withholding the words would make the ledger
 * useless to the person who has to go and check them. What changes with
 * status is how the page frames it and whether the page may be indexed.
 */
export interface ProvenanceFact {
  readonly id: string;
  /** What the reader is being told, e.g. "Where they are". */
  readonly label: string;
  /** The statement itself, as it would be published once confirmed. */
  readonly value: string;
  readonly status: FactStatus;
  /** Where the statement came from. Always filled in. */
  readonly source: string;
  /** ISO date the supplier confirmed it. Present only when confirmed. */
  readonly confirmedOn?: string;
  /** Named person who owns the line and removes it when it lapses. */
  readonly owner?: string;
  /** ISO date the line must be re-checked by. */
  readonly reviewBy?: string;
  /** Checklist questions still outstanding. Empty when confirmed. */
  readonly outstanding: readonly ChecklistId[];
}

export function isConfirmed(fact: ProvenanceFact): boolean {
  return fact.status === "confirmed" && fact.outstanding.length === 0;
}

/** A page may be indexed only when every fact on it has been stood behind. */
export function indexable(facts: readonly ProvenanceFact[]): boolean {
  return facts.every(isConfirmed);
}

export function countUnconfirmed(facts: readonly ProvenanceFact[]): number {
  return facts.filter((f) => !isConfirmed(f)).length;
}

/**
 * The one place the register's own state is described in words, so the copy
 * and the data cannot drift apart.
 */
export function ledgerSummary(facts: readonly ProvenanceFact[]): string {
  const total = facts.length;
  const open = countUnconfirmed(facts);
  if (open === 0) return `${total} statements, all confirmed in writing.`;
  if (open === total)
    return `${total} statements, none confirmed in writing yet.`;
  return `${total} statements, ${open} still waiting on written confirmation.`;
}
