/**
 * What the roster is allowed to know.
 *
 * Every agent in this company reasons from the same business database the
 * founder reads, and it reaches it through this port and nowhere else. Two
 * consequences, both deliberate:
 *
 *  - **A role cannot invent a fact.** Its tools return these structures and
 *    nothing else, so a number in an agent's output is a number that came out
 *    of a query. Where the data is missing the field is `null` and the agent is
 *    told to say so rather than fill it in.
 *  - **A role is testable without a server.** `SqlBusinessReads` runs against
 *    any `$1`-style client — `pg` in the admin, PGlite in the tests — so the
 *    evidence runs read the real seeded business rather than a fixture that
 *    agrees with itself.
 *
 * Everything here is a READ. The write side is `outbox.ts`, and it does not
 * send: this build is not authorised for live outbound, so the only thing an
 * approved external action can do is be recorded.
 *
 * Money is integer cents throughout, per the repository rule. Postgres hands
 * `numeric` and `bigint` back as strings; the narrowing happens in
 * `sql-reads.ts`, at the boundary, and never leaks past it.
 */

/* ------------------------------------------------------------------ shared */

/** One product in the range, as every role sees it. */
export interface CatalogueLine {
  readonly sku: string;
  readonly handle: string;
  readonly title: string;
  readonly priceCents: number;
  readonly unitCostCents: number | null;
  readonly status: string;
  readonly tradeOnly: boolean;
}

/** A read that carries its own plain-English reading of itself. */
export interface Findings {
  /** One sentence a non-technical person can act on. */
  readonly headline: string;
  /** The facts behind the headline, each already worded. */
  readonly findings: readonly string[];
}

/* ------------------------------------------------------- ops and inventory */

export interface StockCoverLine {
  readonly sku: string;
  readonly title: string;
  readonly available: number;
  readonly onHand: number;
  readonly reorderPoint: number;
  /** Units a day across the window. Zero when nothing sold. */
  readonly unitsPerDay: number;
  /** Days of stock left at that rate, or null when nothing sold. */
  readonly daysOfCover: number | null;
}

export interface IngredientLine {
  readonly code: string;
  readonly name: string;
  readonly unit: string;
  readonly onHand: number;
  readonly reorderPoint: number;
  readonly reorderQuantity: number;
  readonly standardCostCents: number;
  readonly supplier: string | null;
  readonly supplierCode: string | null;
  readonly leadTimeDays: number | null;
}

/** The exact arguments `queue_supplier_order` takes, computed from the data. */
export interface SupplierOrderProposal {
  readonly supplierCode: string;
  readonly supplierName: string;
  readonly ingredientCode: string;
  readonly quantity: number;
  readonly unit: string;
  readonly amountCents: number;
  readonly reason: string;
}

export interface StockCoverReport extends Findings {
  readonly windowDays: number;
  readonly lines: readonly StockCoverLine[];
  readonly ingredientsBelowReorder: readonly IngredientLine[];
  readonly proposal: SupplierOrderProposal | null;
}

export interface BatchLine {
  readonly batchCode: string;
  readonly sku: string | null;
  readonly status: string;
  readonly plannedFor: string | null;
  readonly expiresAt: string | null;
  readonly unitsRemaining: number;
  readonly unitCostCents: number | null;
  readonly qaPassed: boolean | null;
}

export interface BatchPlanReport extends Findings {
  readonly inFlight: readonly BatchLine[];
  readonly released: readonly BatchLine[];
  /** Released stock inside 120 days of its best-before date. */
  readonly expiringSoon: readonly BatchLine[];
  /** The line with the least cover, which is what should go in the fermenter next. */
  readonly nextToBrew: {
    readonly sku: string;
    readonly title: string;
    readonly daysOfCover: number | null;
  } | null;
}

/* --------------------------------------------------------------- money */

export interface MarginLine {
  readonly sku: string;
  readonly title: string;
  readonly priceCents: number;
  /** Weighted unit cost of the last three released batches, or the variant cost. */
  readonly unitCostCents: number | null;
  readonly gstCents: number;
  readonly exGstCents: number;
  readonly marginPct: number | null;
  readonly batchesUsed: number;
  readonly belowFloor: boolean;
}

/** The exact arguments `propose_price_change` takes. */
export interface PriceChangeProposal {
  readonly sku: string;
  readonly fromCents: number;
  readonly toCents: number;
  readonly reason: string;
}

export interface MarginReport extends Findings {
  /** The margin the company holds itself to, in percent. */
  readonly floorPct: number;
  readonly lines: readonly MarginLine[];
  readonly proposal: PriceChangeProposal | null;
}

export interface TakingsReport extends Findings {
  readonly windowDays: number;
  readonly orders: number;
  readonly grossCents: number;
  readonly gstCents: number;
  readonly exGstCents: number;
  readonly refundedCents: number;
  readonly shippingCents: number;
  readonly discountCents: number;
  readonly averageOrderCents: number;
  readonly byChannel: readonly {
    readonly channel: string;
    readonly orders: number;
    readonly grossCents: number;
  }[];
  readonly unpaid: number;
}

/* ----------------------------------------------------------- the customer */

export interface OpenConversation {
  readonly kind: "review" | "delivery";
  readonly id: string;
  readonly who: string;
  readonly sku: string | null;
  readonly rating: number | null;
  readonly title: string | null;
  readonly body: string;
  readonly waitingDays: number;
  /** True when this is not a reply an agent may draft unattended. */
  readonly unhappy: boolean;
}

/** The exact arguments `queue_customer_reply` takes. */
export interface CustomerReplyProposal {
  readonly reviewId: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly escalate: boolean;
}

export interface ConversationReport extends Findings {
  readonly open: readonly OpenConversation[];
  readonly unhappyCount: number;
  /** The address of the person the next draft is for, so their history can be read. */
  readonly nextCustomerEmail: string | null;
  readonly proposal: CustomerReplyProposal | null;
}

export interface CustomerHistory extends Findings {
  readonly customer: {
    readonly name: string;
    readonly email: string;
    readonly type: string;
    readonly ordersCount: number;
    readonly totalSpentCents: number;
    readonly firstOrderedAt: string | null;
    readonly lastOrderedAt: string | null;
    readonly note: string | null;
  } | null;
  readonly orders: readonly {
    readonly orderNumber: string;
    readonly placedAt: string | null;
    readonly totalCents: number;
    readonly status: string;
    readonly items: string;
  }[];
  readonly reviews: readonly {
    readonly rating: number;
    readonly title: string | null;
    readonly repliedAt: string | null;
  }[];
}

/* --------------------------------------------------------------- content */

export interface PostLine {
  readonly id: string;
  readonly platform: string;
  readonly status: string;
  readonly caption: string;
  readonly publishedAt: string | null;
  readonly impressions: number;
  readonly engagements: number;
  readonly engagementRatePct: number | null;
  readonly brandCheckPassed: boolean | null;
}

/** The exact arguments `queue_social_post` takes. */
export interface SocialPostProposal {
  readonly platform: string;
  readonly caption: string;
  readonly sku: string | null;
  readonly reason: string;
}

export interface ContentReport extends Findings {
  readonly windowDays: number;
  readonly published: readonly PostLine[];
  readonly waiting: readonly PostLine[];
  readonly failed: readonly PostLine[];
  readonly bestPost: PostLine | null;
  readonly medianEngagementRatePct: number | null;
  readonly proposal: SocialPostProposal | null;
}

/* ------------------------------------------------------------ B2C demand */

export interface SkuSalesLine {
  readonly sku: string;
  readonly title: string;
  readonly units: number;
  readonly revenueCents: number;
  readonly orders: number;
  readonly unitsPriorWindow: number;
  readonly changePct: number | null;
}

/** The exact arguments `queue_campaign_email` takes. */
export interface CampaignProposal {
  readonly slug: string;
  readonly subject: string;
  readonly body: string;
  readonly audience: "all" | "repeat" | "lapsed";
  readonly reason: string;
}

export interface SalesReport extends Findings {
  readonly windowDays: number;
  readonly lines: readonly SkuSalesLine[];
  readonly totalRevenueCents: number;
  readonly repeatCustomerPct: number | null;
  readonly byChannel: readonly {
    readonly channel: string;
    readonly units: number;
    readonly revenueCents: number;
  }[];
  readonly proposal: CampaignProposal | null;
}

/* ------------------------------------------------------------ B2B accounts */

export interface TradeAccountLine {
  readonly customerId: string;
  readonly account: string;
  readonly contact: string | null;
  readonly email: string;
  readonly city: string | null;
  readonly ordersCount: number;
  readonly totalSpentCents: number;
  readonly lastOrderedAt: string | null;
  readonly daysSinceLastOrder: number | null;
  /** Mean days between their orders, when they have more than one. */
  readonly reorderCadenceDays: number | null;
  readonly overdue: boolean;
  readonly note: string | null;
}

/** The exact arguments `queue_trade_outreach` takes. */
export interface TradeOutreachProposal {
  readonly customerId: string;
  readonly account: string;
  readonly to: string;
  readonly subject: string;
  readonly body: string;
  readonly reason: string;
}

export interface TradeReport extends Findings {
  readonly accounts: readonly TradeAccountLine[];
  readonly overdueCount: number;
  readonly proposal: TradeOutreachProposal | null;
}

/** Everything already said to one account. The B2B memory. */
export interface AccountMemory extends Findings {
  readonly account: TradeAccountLine | null;
  readonly conversations: readonly {
    readonly at: string | null;
    readonly channel: string;
    readonly subject: string;
    readonly status: string;
    readonly opened: boolean;
    readonly extract: string;
  }[];
  readonly orders: readonly {
    readonly orderNumber: string;
    readonly placedAt: string | null;
    readonly totalCents: number;
    readonly items: string;
  }[];
  readonly decisions: readonly {
    readonly at: string;
    readonly subject: string;
    readonly status: string;
    readonly title: string;
  }[];
}

/* --------------------------------------------------- product development */

export interface ReviewThemeLine {
  readonly sku: string;
  readonly title: string;
  readonly reviews: number;
  readonly averageRating: number | null;
  readonly lowest: number | null;
  readonly quotes: readonly string[];
}

/** The exact arguments `save_product_concept` takes. */
export interface ProductConceptProposal {
  readonly workingName: string;
  readonly basedOnSku: string;
  readonly rationale: string;
  readonly ingredients: string;
}

export interface RangeReport extends Findings {
  readonly windowDays: number;
  readonly sales: readonly SkuSalesLine[];
  readonly themes: readonly ReviewThemeLine[];
  readonly recipes: readonly {
    readonly name: string;
    readonly status: string;
    readonly batchSizeLitres: number | null;
    readonly isCurrent: boolean;
  }[];
  readonly ingredientsOnHand: readonly {
    readonly code: string;
    readonly name: string;
    readonly onHand: number;
    readonly unit: string;
  }[];
  readonly proposal: ProductConceptProposal | null;
}

/* ------------------------------------------------------------- the week */

export interface WeeklyPulse extends Findings {
  readonly weekTo: string;
  readonly revenueCents: number;
  readonly revenuePriorCents: number;
  readonly revenueChangePct: number | null;
  readonly orders: number;
  readonly ordersPrior: number;
  readonly newCustomers: number;
  readonly repeatCustomerPct: number | null;
  readonly bestSku: {
    readonly sku: string;
    readonly title: string;
    readonly units: number;
  } | null;
  readonly weakestSku: {
    readonly sku: string;
    readonly title: string;
    readonly units: number;
  } | null;
  readonly decisionsWaiting: number;
  readonly failedRuns: number;
  readonly unfulfilledOrders: number;
  readonly lowestCover: {
    readonly sku: string;
    readonly title: string;
    readonly daysOfCover: number | null;
  } | null;
  /** The sentence the admin's Today page can open with. */
  readonly openingSentence: string;
}

/* ------------------------------------------------------ security and IT */

/**
 * Four reads that are about the company's safety rather than its trade, and
 * one property they all share: **none of them can return a secret.**
 *
 * A sign-in is who, when and from where. A session is a device label and two
 * timestamps — never `session_token_hash`, which is a hash of a credential and
 * therefore treated as one. A credential check is a variable NAME and a
 * boolean. A settings row flagged secret gives up its key and its description
 * and never its `value`. The queries in `sql-reads.ts` do not select those
 * columns at all, which is a stronger guarantee than remembering to strip them.
 */

/** One sign-in or sign-out, as the audit trail recorded it. */
export interface SignInLine {
  readonly at: string | null;
  readonly who: string;
  /** `login` or `logout`. */
  readonly action: string;
  readonly device: string | null;
  readonly from: string | null;
}

/** One brute-force budget: per client address, or the whole door. */
export interface ThrottleBucket {
  /** `ip` or `global`. */
  readonly scope: string;
  /** The address, or `*` for the whole-door budget. Never a credential. */
  readonly subject: string;
  readonly consecutiveFailures: number;
  readonly totalFailures: number;
  readonly totalAttempts: number;
  readonly lockedUntil: string | null;
  readonly lockCount: number;
  readonly lastFailureAt: string | null;
}

export interface SignInReport extends Findings {
  readonly windowDays: number;
  readonly signIns: readonly SignInLine[];
  readonly failedAttempts: number;
  readonly buckets: readonly ThrottleBucket[];
  readonly lockedOutNow: number;
}

/** One admin session. The token and its hash are not in this shape at all. */
export interface AdminSessionLine {
  readonly operator: string;
  readonly device: string | null;
  readonly from: string | null;
  readonly startedAt: string | null;
  readonly lastActiveAt: string | null;
  readonly expiresAt: string | null;
  /** `live` while usable, then `expired` or `revoked`. */
  readonly state: "live" | "expired" | "revoked";
  readonly revokedReason: string | null;
  /** True when the browser it was opened from is not this deployment's own. */
  readonly isAgentSession: boolean;
}

export interface AdminSessionReport extends Findings {
  readonly live: readonly AdminSessionLine[];
  readonly ended: readonly AdminSessionLine[];
  readonly liveCount: number;
}

/** A settings row that holds something secret. Key and description only. */
export interface SecretSettingLine {
  readonly key: string;
  readonly description: string;
  readonly category: string;
  readonly updatedAt: string | null;
}

export interface SecretsReport extends Findings {
  /** Names of the environment variables that ARE configured. Names only. */
  readonly configured: readonly string[];
  readonly missing: readonly {
    readonly name: string;
    readonly what: string;
    readonly whenMissing: string;
  }[];
  readonly secretSettings: readonly SecretSettingLine[];
  /** Already-worded sentences: what is wrong, and what to do about it. */
  readonly warnings: readonly string[];
  readonly adminOpensWithoutPassword: boolean;
  readonly demoMode: boolean;
}

/** One entry in the append-only trail of what changed. */
export interface ChangeLine {
  readonly at: string | null;
  readonly who: string;
  /** `operator`, `agent`, `customer` or `system`. */
  readonly actorType: string;
  readonly action: string;
  readonly entity: string;
  readonly label: string | null;
  readonly summary: string;
  readonly from: string | null;
}

export interface ChangeTrailReport extends Findings {
  readonly windowDays: number;
  readonly entries: readonly ChangeLine[];
  readonly byActor: readonly {
    readonly who: string;
    readonly actorType: string;
    readonly changes: number;
  }[];
  readonly total: number;
}

/* ------------------------------------------------------------------ port */

/**
 * Every read the roster has. One method per tool, so a tool cannot reach data
 * its role was not given: the grant list is the whole surface.
 */
export interface BusinessReads {
  catalogue(): Promise<readonly CatalogueLine[]>;
  stockCover(windowDays: number): Promise<StockCoverReport>;
  batchPlan(windowDays: number): Promise<BatchPlanReport>;
  margins(): Promise<MarginReport>;
  takings(windowDays: number): Promise<TakingsReport>;
  openConversations(): Promise<ConversationReport>;
  customerHistory(email: string): Promise<CustomerHistory>;
  contentPerformance(windowDays: number): Promise<ContentReport>;
  salesBySku(windowDays: number): Promise<SalesReport>;
  tradeAccounts(): Promise<TradeReport>;
  accountMemory(customerId: string): Promise<AccountMemory>;
  rangeSignals(windowDays: number): Promise<RangeReport>;
  weeklyPulse(): Promise<WeeklyPulse>;
  signInActivity(windowDays: number): Promise<SignInReport>;
  adminSessions(): Promise<AdminSessionReport>;
  secretsConfigured(): Promise<SecretsReport>;
  changeTrail(windowDays: number): Promise<ChangeTrailReport>;
}
