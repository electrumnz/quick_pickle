/**
 * The shape of the starter content: the drafts an owner finds in Plans the
 * first time they open it, so the area does not start empty.
 *
 * Everything here is written for a New Zealand business selling a packaged
 * food online, and says so where a rule is New Zealand's own. Only what was
 * known on 12 November 2026 is stated as fact. Everything else is a question
 * to answer, a blank to fill in, or an assumption marked as one.
 *
 * Each item has something stable to match on, so loading twice adds nothing
 * and nothing a person has edited is ever overwritten: a document has its
 * address (`slug`), and the rest have a `key` that is never shown and never
 * changes, whatever happens to their wording.
 */

import type {
  ComplianceArea,
  CostBasis,
  DocumentKind,
} from "@/lib/backstage/plans/labels";

export type StarterDocument = {
  readonly slug: string;
  readonly title: string;
  readonly kind: DocumentKind;
  /** One line on what it is for, shown in the list. */
  readonly summary: string;
  readonly sort: number;
  /** Markdown. One paragraph per line: a line break is a line break. */
  readonly body: string;
};

export type StarterQuestion = {
  readonly key: string;
  readonly topic: string;
  readonly question: string;
  /** Why it matters and what it unblocks. */
  readonly why: string;
  readonly askOf: string;
  /** Where it came from. */
  readonly source: string;
  /** True only where the site cannot take money until it is answered. */
  readonly blocksLaunch: boolean;
};

export type StarterComplianceItem = {
  readonly key: string;
  readonly area: ComplianceArea;
  readonly title: string;
  readonly detail: string;
  /** The New Zealand act, standard or regulator it comes from. */
  readonly basis: string;
  /** `check` wherever the detail varies or is not certain. */
  readonly status: "to-do" | "check";
};

export type StarterCost = {
  readonly key: string;
  readonly name: string;
  readonly basis: CostBasis;
  /** What to fill in, and from where. The amount itself starts at nothing. */
  readonly notes: string;
};
