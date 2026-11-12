/**
 * The starter content, all of it, as data. `plans.loadStarter` (./load.ts)
 * puts whatever is missing into the database and never touches anything that
 * is already there.
 */

import { STARTER_COMPLIANCE } from "./compliance";
import { STARTER_COSTS } from "./costs";
import { STARTER_HOW_TOS } from "./how-tos";
import { STARTER_PLANS } from "./plans";
import { STARTER_POLICIES } from "./policies";
import { STARTER_QUESTIONS } from "./questions";
import type { StarterDocument } from "./types";

export const STARTER_DOCUMENTS: readonly StarterDocument[] = [
  ...STARTER_PLANS,
  ...STARTER_HOW_TOS,
  ...STARTER_POLICIES,
];

export { STARTER_COMPLIANCE, STARTER_COSTS, STARTER_QUESTIONS };
export type {
  StarterComplianceItem,
  StarterCost,
  StarterDocument,
  StarterQuestion,
} from "./types";
