import type { BatchStatus, MovementKind, PurchaseStatus } from "@/db/schema";

/**
 * Where a batch can go from where it is. One table, read by the operations
 * (which refuse anything not on it) and by the screens (which only offer
 * what is on it).
 *
 *   planned → made → released → closed
 *
 * A recall can come at any time once a batch exists as bottles: from made,
 * from released, and late, from closed. Nothing leaves recalled.
 */
export const NEXT_BATCH_STATUS: Readonly<
  Record<BatchStatus, readonly BatchStatus[]>
> = {
  planned: ["made"],
  made: ["released", "recalled"],
  released: ["closed", "recalled"],
  closed: ["recalled"],
  recalled: [],
};

export function canMoveBatch(from: BatchStatus, to: BatchStatus): boolean {
  return NEXT_BATCH_STATUS[from].includes(to);
}

export const BATCH_STATUSES = [
  "planned",
  "made",
  "released",
  "closed",
  "recalled",
] as const satisfies readonly BatchStatus[];

export const BATCH_STATUS_LABEL: Readonly<Record<BatchStatus, string>> = {
  planned: "Planned",
  made: "Made, not released",
  released: "Released",
  closed: "Closed",
  recalled: "Recalled",
};

/** How a batch's state reads in the middle of a sentence: "B001 is …". */
export const BATCH_STATUS_IS: Readonly<Record<BatchStatus, string>> = {
  planned: "only planned",
  made: "made but not released",
  released: "released",
  closed: "closed",
  recalled: "recalled",
};

/** What the state means, in a line, for the batch's own page. */
export const BATCH_STATUS_MEANS: Readonly<Record<BatchStatus, string>> = {
  planned: "On the calendar. Not made yet.",
  made: "Made, and waiting to be released for sale.",
  released: "Cleared for sale. Orders are filled from it.",
  closed: "Finished. Nothing more is sold from it.",
  recalled: "Pulled back. It can never be sold from again.",
};

/** Batches whose shots exist as bottles somewhere. */
export const MADE_STATUSES: readonly BatchStatus[] = [
  "made",
  "released",
  "closed",
  "recalled",
];

/**
 * Which movements can be recorded by hand against a batch, by its state.
 * A planned batch has nothing to move. Nothing is given away from a recalled
 * batch, but what is destroyed or recounted still has to be written down.
 */
export const HAND_MOVEMENTS: Readonly<
  Record<BatchStatus, readonly ("sample" | "waste" | "adjust")[]>
> = {
  planned: [],
  made: ["sample", "waste", "adjust"],
  released: ["sample", "waste", "adjust"],
  closed: ["sample", "waste", "adjust"],
  recalled: ["waste", "adjust"],
};

export const MOVEMENT_LABEL: Readonly<Record<MovementKind, string>> = {
  made: "Made",
  sold: "Sold",
  returned: "Put back",
  sample: "Given away",
  waste: "Written off",
  adjust: "Count corrected",
};

/**
 * Where a purchase order can go from where it is.
 *
 *   draft → sent → received
 *
 * A draft or a sent order can be cancelled. Nothing leaves received or
 * cancelled.
 */
export const NEXT_PURCHASE_STATUS: Readonly<
  Record<PurchaseStatus, readonly PurchaseStatus[]>
> = {
  draft: ["sent", "cancelled"],
  sent: ["received", "cancelled"],
  received: [],
  cancelled: [],
};

export function canMovePurchase(
  from: PurchaseStatus,
  to: PurchaseStatus,
): boolean {
  return NEXT_PURCHASE_STATUS[from].includes(to);
}

export const PURCHASE_STATUSES = [
  "draft",
  "sent",
  "received",
  "cancelled",
] as const satisfies readonly PurchaseStatus[];

export const PURCHASE_STATUS_LABEL: Readonly<Record<PurchaseStatus, string>> = {
  draft: "Draft",
  sent: "Sent",
  received: "Received",
  cancelled: "Cancelled",
};

/** The purchase orders someone is still waiting on or working on. */
export const OPEN_PURCHASE_STATUSES: readonly PurchaseStatus[] = [
  "draft",
  "sent",
];

/**
 * How many shots ready to sell counts as running low, unless a caller says
 * otherwise. Two of the largest box on the shelf today. It is a default for
 * an alert, not a rule: every operation that can raise the alert takes its
 * own number.
 */
export const LOW_STOCK_SHOTS = 48;

/** How many days before a best-before date a batch starts being flagged. */
export const NEAR_BEST_BEFORE_DAYS = 30;
