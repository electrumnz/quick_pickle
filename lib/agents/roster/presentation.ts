/**
 * The machine words, in the founder's words.
 *
 * `act_with_limits`, `purchase_order`, `queue_supplier_order` and
 * `storefront_write` are all real and all load-bearing — and none of them
 * should ever appear on a screen. This is the one translation table, so the
 * admin and any other surface say the same thing about the same value.
 *
 * Every map falls back to a readable form of the raw value rather than to
 * "unknown": a value this file has not caught up with should still render as
 * something a person can read.
 */

/** What an autonomy level means for the person who has to trust it. */
export const AUTONOMY_WORDS: Readonly<Record<string, string>> = {
  observe: "Watches and reports. It cannot change anything.",
  propose: "Drafts and asks. Nothing it makes goes out without your yes.",
  act_with_limits:
    "Acts on its own inside its limits, and stops to ask for anything bigger.",
  autonomous: "Acts on its own. It tells you afterwards.",
};

/** The short version, for a badge. */
export const AUTONOMY_BADGE: Readonly<Record<string, string>> = {
  observe: "Watches only",
  propose: "Asks first",
  act_with_limits: "Acts, within limits",
  autonomous: "Acts alone",
};

/** What an approval subject is, said as the thing rather than the enum. */
export const SUBJECT_WORDS: Readonly<Record<string, string>> = {
  social_post: "posts before they go out",
  email_outreach: "emails to bars and shops",
  email_campaign: "email campaigns to customers",
  content_asset: "photos and written content",
  price_change: "price changes",
  discount: "discount codes",
  product_publish: "putting a product on the shop",
  purchase_order: "orders to suppliers",
  inventory_adjustment: "stock corrections",
  batch_release: "releasing a batch for sale",
  recipe_change: "recipe changes",
  refund: "refunds",
  order_cancel: "cancelling an order",
  review_reply: "replies to reviews",
  customer_message: "messages to customers",
  settings_change: "settings changes",
  agent_config: "changes to its own job",
};

/** What a tool lets an agent do, in one plain phrase. */
export const TOOL_WORDS: Readonly<Record<string, string>> = {
  read_catalogue: "Look up the range, its prices and its costs",
  read_stock_cover: "See how many days of stock each line has left",
  read_batch_plan: "See what is brewing and what is near its best-before",
  read_margins: "Work out the margin on each bottle",
  read_takings: "Read the takings and the GST inside them",
  read_open_conversations: "See who is waiting on a reply",
  read_customer_history: "Read one customer's orders and reviews",
  read_content_performance: "See how the posts did",
  read_sales_by_sku: "See what is selling and what is not",
  read_trade_accounts: "Read the trade list and who is overdue",
  read_account_memory: "Read everything already said to one trade account",
  read_range_signals: "Put sales and reviews side by side",
  read_weekly_pulse: "Take the week against the week before",
  read_sign_in_activity:
    "See who signed in, who was turned away, and who is locked out",
  read_admin_sessions: "See which devices are signed in to this admin",
  read_secrets_configured:
    "Check which credentials are set — the names only, never what they are set to",
  read_change_trail: "Read what changed in here, and who changed it",
  save_internal_note: "File a note in our own records",
  save_internal_draft: "Save a draft in our own records",
  save_account_note: "Add to a trade account's file",
  save_product_concept: "Write up a product idea",
  propose_price_change: "Propose a new price — always your decision",
  queue_social_post: "Post to social — always your decision",
  queue_customer_reply: "Reply to a customer — always your decision",
  queue_trade_outreach: "Email a trade account — always your decision",
  queue_campaign_email: "Email the customer list — always your decision",
  queue_supplier_order: "Order from a supplier — always your decision",
  hand_off: "Ask whoever handles a job to pick it up",
};

/** What an effect class means for what can happen without a human. */
export const EFFECT_WORDS: Readonly<Record<string, string>> = {
  read: "Only looks",
  business_write: "Writes in our own records",
  storefront_write: "Changes what customers see — needs your yes",
  external: "Leaves the company — needs your yes",
};

/** What a run's status means. */
export const RUN_STATUS_WORDS: Readonly<Record<string, string>> = {
  queued: "waiting to start",
  running: "running now",
  awaiting_approval: "stopped, waiting on you",
  succeeded: "finished",
  failed: "failed",
  cancelled: "cancelled",
};

/** What started a run. */
export const TRIGGER_WORDS: Readonly<Record<string, string>> = {
  schedule: "its schedule",
  manual: "you",
  webhook: "the shop",
  chained: "another agent",
  retry: "a retry",
  approval: "your decision",
};

/** Who the role is talking to, said plainly. */
export const AUDIENCE_WORDS: Readonly<Record<string, string>> = {
  b2c: "People buying a bottle",
  b2b: "Bars, restaurants and shops",
  internal: "You, and the rest of the team",
};

function humanise(value: string): string {
  return value.replace(/_/g, " ");
}

export function autonomyWords(autonomy: string): string {
  return AUTONOMY_WORDS[autonomy] ?? humanise(autonomy);
}

export function autonomyBadge(autonomy: string): string {
  return AUTONOMY_BADGE[autonomy] ?? humanise(autonomy);
}

export function subjectWords(subject: string): string {
  return SUBJECT_WORDS[subject] ?? humanise(subject);
}

export function toolWords(tool: string): string {
  return TOOL_WORDS[tool] ?? humanise(tool);
}

export function runStatusWords(status: string): string {
  return RUN_STATUS_WORDS[status] ?? humanise(status);
}

export function triggerWords(trigger: string): string {
  return TRIGGER_WORDS[trigger] ?? humanise(trigger);
}

export function audienceWords(audience: string): string {
  return AUDIENCE_WORDS[audience] ?? humanise(audience);
}

/**
 * A cron expression as a sentence.
 *
 * Only the shapes this roster actually uses are translated; anything else falls
 * back to the expression itself rather than to a wrong sentence.
 */
export function scheduleWords(cron: string | null): string {
  if (cron === null || cron.trim() === "") return "Only when you ask it to";
  const known: Readonly<Record<string, string>> = {
    "0 19 * * *": "Every evening at 7pm",
    "0 20 * * 1,4": "Monday and Thursday evenings",
    "0 */4 * * *": "Every four hours",
    "0 8 * * 1": "Monday mornings at 8am",
    "30 9 * * 2": "Tuesday mornings",
    "0 6 * * 1": "Monday mornings at 6am",
    "0 9 1 * *": "The first of the month",
    "*/15 * * * *": "Every fifteen minutes",
    "0 7 * * *": "Every morning at 7am",
  };
  return known[cron.trim()] ?? `On the schedule ${cron}`;
}
