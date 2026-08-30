/**
 * The roster's tools.
 *
 * A tool here declares three things and no others: what it does to the world
 * (`effect`), how it describes one specific call to a human (`present`), and
 * what it actually does (`execute`). It never checks a permission — the runtime
 * does that, in `lib/agents/tools/authorization.ts`, and a tool that checked its
 * own would be a second place for the rule to be wrong.
 *
 * The shape of the set is the shape of the company:
 *
 *   read              thirteen ways to look at the business, all SQL
 *   business_write    notes, drafts and concepts — our own records
 *   storefront_write  one: a price change
 *   external          five: post, reply, outreach, campaign, supplier order
 *
 * The last two groups can never run without an approved `approvals` row
 * covering the exact arguments, at any autonomy level. That is the runtime's
 * property, not this file's, which is why this file contains no check.
 *
 * Not present, deliberately: any tool that posts to a live account, sends a
 * live email, or places a live order. Every external tool ends in
 * `outbox.ts`, which records and does not deliver.
 *
 * Both edges are declared here rather than enforced here, for the same reason
 * authorisation is not:
 *
 *   - A read whose result carries prose the company did not write declares
 *     `untrustedSource`. The runtime defangs and frames it before it reaches a
 *     prompt (`lib/agents/boundary/inbound.ts`). Five of the thirteen reads do:
 *     open conversations, one customer's history, the trade list, one account's
 *     memory, and the range signals — which quote reviews verbatim.
 *   - Every write goes through `redactingSink`, which scrubs credential-shaped
 *     strings before the entry is recorded. Wrapping the port means the rule
 *     cannot be forgotten by a tool added later.
 */

import { z } from "zod";

import {
  BindableHandoff,
  createHandOffTool,
  type HandOffConversations,
} from "../chat/hand-off-tool";
import {
  defineTool,
  ToolRegistry,
  type ToolDefinition,
} from "../tools/registry";
import type { BusinessReads } from "./reads";
import { nzd } from "./sql-reads";
import { redactingSink, type DraftSink } from "./outbox";

/** How far back a read looks, in days. Bounded so a run cannot scan forever. */
const windowSchema = z
  .object({
    windowDays: z
      .number()
      .int()
      .min(1)
      .max(365)
      .default(28)
      .describe("How many days back to look. Defaults to 28."),
  })
  .describe("A time window in days.");

const noteSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(120)
    .describe("Stable identifier for this note, e.g. stock-sweep-2026-08-29"),
  title: z.string().min(1).max(200),
  body: z.string().min(1).describe("The note itself, in plain English."),
});

const draftSchema = z.object({
  slug: z.string().min(1).max(120),
  title: z.string().min(1).max(200),
  body: z.string().min(1).describe("The draft copy."),
});

export interface RosterToolPorts {
  readonly reads: BusinessReads;
  readonly outbox: DraftSink;
  /**
   * Where a run's conversation is looked up, for `hand_off`.
   *
   * Defaults to reading it off nothing, which makes every handoff refuse with a
   * sentence rather than proceed uncapped. A caller that opens runs inside
   * conversations — the founder's chat, and the durable workflow — passes the
   * ledger it counts turns in.
   */
  readonly conversations?: HandOffConversations;
  /**
   * What a run the handoff opened ended up saying.
   *
   * Supplied by a caller that drives the runs it opens, so `hand_off` can hand
   * the colleague's answer back to the agent that asked instead of just a run
   * id. Read from `agent_runs.outcome`; nothing copies it.
   */
  readonly readRunOutcome?: (runId: string) => Promise<string | null>;
}

/** Every tool the roster can be granted, by name. */
export interface RosterTools {
  readonly all: readonly ToolDefinition[];
  readonly byName: Readonly<Record<string, ToolDefinition>>;
  readonly registry: ToolRegistry;
  /**
   * The seam `hand_off` dispatches through.
   *
   * The tool registry is built before the runtime exists and the router needs
   * the runtime to open a run, so the tool is built against this and the real
   * router is bound once both halves are there — see
   * `lib/agents/chat/platform.ts` and `./production.ts`. Unbound, a handoff
   * comes back as a readable refusal rather than as nothing.
   */
  readonly handoff: BindableHandoff;
}

export function createRosterTools(ports: RosterToolPorts): RosterTools {
  const { reads } = ports;
  // The outbound edge, applied once at the port rather than at twenty call
  // sites: every tool below writes through the scrubber, whichever sink the
  // caller passed in. A real `DraftSink` inherits it without knowing it exists.
  const outbox = redactingSink(ports.outbox);

  /* --------------------------------------------------------------- reads */

  const readCatalogue = defineTool({
    name: "read_catalogue",
    title: "Read the range",
    description:
      "Every product with its price, unit cost and whether it is trade-only. Read-only.",
    effect: "read",
    inputSchema: z.object({}).describe("No arguments."),
    execute: async () => {
      const products = await reads.catalogue();
      return {
        headline: `${String(products.length)} products in the range, ${String(products.filter((line) => line.status === "active").length)} of them live.`,
        findings: products.map(
          (line) =>
            `${line.title} (${line.sku}) sells at ${nzd(line.priceCents)}${line.tradeOnly ? ", trade only" : ""}${line.unitCostCents === null ? "" : `, recorded unit cost ${nzd(line.unitCostCents)}`}.`,
        ),
        products,
      };
    },
  });

  const readStockCover = defineTool({
    name: "read_stock_cover",
    title: "Stock and days of cover",
    description:
      "Bottles available per line, how fast each is selling, days of cover at that rate, and every ingredient below its reorder point. Read-only.",
    effect: "read",
    inputSchema: windowSchema,
    execute: async (input) => reads.stockCover(input.windowDays),
  });

  const readBatchPlan = defineTool({
    name: "read_batch_plan",
    title: "The production board",
    description:
      "Batches in the fermenter or on the bottling line, released stock nearing its best-before date, and which line has the least cover. Read-only.",
    effect: "read",
    inputSchema: windowSchema,
    execute: async (input) => reads.batchPlan(input.windowDays),
  });

  const readMargins = defineTool({
    name: "read_margins",
    title: "Margin by product",
    description:
      "Price, the GST inside it, unit cost from the last three released batches, and margin against the floor. Read-only.",
    effect: "read",
    inputSchema: z.object({}).describe("No arguments."),
    execute: async () => reads.margins(),
  });

  const readTakings = defineTool({
    name: "read_takings",
    title: "Money in",
    description:
      "Orders, takings, GST held for Inland Revenue, refunds and channel split over a window. Read-only.",
    effect: "read",
    inputSchema: windowSchema,
    execute: async (input) => reads.takings(input.windowDays),
  });

  const readOpenConversations = defineTool({
    name: "read_open_conversations",
    title: "Who is waiting on a reply",
    description:
      "Reviews with no reply and paid orders not yet sent, with how long each has been waiting and whether the person is unhappy. Read-only.",
    effect: "read",
    // Review titles, review bodies and the name a customer typed at checkout.
    // All of it is written by someone outside the company.
    untrustedSource: "customer_message",
    inputSchema: z.object({}).describe("No arguments."),
    execute: async () => reads.openConversations(),
  });

  const readCustomerHistory = defineTool({
    name: "read_customer_history",
    title: "One customer's history",
    description:
      "Everything on file for one person: orders, what was in them, and any review they left. Read-only.",
    effect: "read",
    // Their own name, their own standing note, the titles of their reviews.
    untrustedSource: "customer_record",
    inputSchema: z.object({
      email: z.string().min(3).describe("The customer's email address."),
    }),
    execute: async (input) => reads.customerHistory(input.email),
  });

  const readContentPerformance = defineTool({
    name: "read_content_performance",
    title: "How the posts did",
    description:
      "Published posts with impressions and engagement, what is waiting on a decision, and anything that failed to go out. Read-only.",
    effect: "read",
    inputSchema: windowSchema,
    execute: async (input) => reads.contentPerformance(input.windowDays),
  });

  const readSalesBySku = defineTool({
    name: "read_sales_by_sku",
    title: "What is selling",
    description:
      "Bottles and revenue per product over a window, against the window before it, with the channel split. Read-only.",
    effect: "read",
    inputSchema: windowSchema,
    execute: async (input) => reads.salesBySku(input.windowDays),
  });

  const readTradeAccounts = defineTool({
    name: "read_trade_accounts",
    title: "The trade list",
    description:
      "Every wholesale account: what they have bought, how often they reorder, and which of them are past their own pattern. Read-only.",
    effect: "read",
    // Venue name, contact name and the standing note on the account.
    untrustedSource: "trade_account_record",
    inputSchema: z.object({}).describe("No arguments."),
    execute: async () => reads.tradeAccounts(),
  });

  const readAccountMemory = defineTool({
    name: "read_account_memory",
    title: "Everything already said to this account",
    description:
      "One trade account's whole history: every order, every message already sent to them and whether it was opened, every decision made about them, and the standing note. Read-only.",
    effect: "read",
    // The account's own details and note travel with its correspondence.
    untrustedSource: "trade_account_record",
    inputSchema: z.object({
      customerId: z
        .string()
        .min(1)
        .describe("The account's customer id, from read_trade_accounts."),
    }),
    execute: async (input) => reads.accountMemory(input.customerId),
  });

  const readRangeSignals = defineTool({
    name: "read_range_signals",
    title: "What the range is telling us",
    description:
      "Sales per product, what reviewers actually said, the recipes on file and the ingredients on hand. Read-only.",
    effect: "read",
    // `themes[].quotes` is review prose, quoted verbatim.
    untrustedSource: "customer_review",
    inputSchema: windowSchema,
    execute: async (input) => reads.rangeSignals(input.windowDays),
  });

  const readWeeklyPulse = defineTool({
    name: "read_weekly_pulse",
    title: "The week, in numbers",
    description:
      "Takings and orders this week against last, new customers, what is waiting on a decision, what failed, and the thinnest stock line. Read-only.",
    effect: "read",
    inputSchema: z.object({}).describe("No arguments."),
    execute: async () => reads.weeklyPulse(),
  });

  /* ------------------------------------------------------ business writes */

  const saveInternalNote = defineTool({
    name: "save_internal_note",
    title: "File a note",
    description:
      "Write a finding into our own records. Internal only: nothing a customer can see, nothing that leaves the company.",
    effect: "business_write",
    inputSchema: noteSchema,
    approval: {
      subjectType: "content_asset",
      subjectTable: "content_assets",
      risk: "low",
      present: (input) => ({
        title: input.title,
        summary: input.body.slice(0, 240),
        preview: { slug: input.slug, body: input.body },
      }),
    },
    execute: async (input, context) =>
      outbox.write(
        {
          kind: "note",
          reference: input.slug,
          summary: input.title,
          payload: { slug: input.slug, title: input.title, body: input.body },
        },
        context.now,
      ),
  });

  const saveInternalDraft = defineTool({
    name: "save_internal_draft",
    title: "Save a draft",
    description:
      "Save copy as a draft in our own records. Saving is not publishing and not sending.",
    effect: "business_write",
    inputSchema: draftSchema,
    approval: {
      subjectType: "content_asset",
      subjectTable: "content_assets",
      risk: "low",
      present: (input) => ({
        title: `Draft: ${input.title}`,
        summary: input.body.slice(0, 240),
        preview: { slug: input.slug, body: input.body },
      }),
    },
    execute: async (input, context) =>
      outbox.write(
        {
          kind: "draft",
          reference: input.slug,
          summary: input.title,
          payload: { slug: input.slug, title: input.title, body: input.body },
        },
        context.now,
      ),
  });

  const saveAccountNote = defineTool({
    name: "save_account_note",
    title: "Add to an account's file",
    description:
      "Write what was learned about one trade account into its file, so the next conversation starts where the last one ended.",
    effect: "business_write",
    inputSchema: z.object({
      customerId: z.string().min(1),
      account: z.string().min(1),
      note: z.string().min(1).max(2_000),
    }),
    approval: {
      subjectType: "content_asset",
      subjectTable: "customers",
      risk: "low",
      present: (input) => ({
        title: `Note on ${input.account}`,
        summary: input.note.slice(0, 240),
        preview: { customerId: input.customerId, note: input.note },
      }),
    },
    execute: async (input, context) =>
      outbox.write(
        {
          kind: "account_note",
          reference: input.customerId,
          summary: `Note on ${input.account}`,
          payload: {
            customerId: input.customerId,
            account: input.account,
            note: input.note,
          },
        },
        context.now,
      ),
  });

  const saveProductConcept = defineTool({
    name: "save_product_concept",
    title: "Write up a product idea",
    description:
      "File a new flavour or range idea with the sales and review evidence behind it. Writes nothing to the shop.",
    effect: "business_write",
    inputSchema: z.object({
      workingName: z.string().min(1).max(120),
      basedOnSku: z.string().min(1).max(40),
      rationale: z.string().min(1),
      ingredients: z.string().min(1),
    }),
    approval: {
      subjectType: "recipe_change",
      subjectTable: "recipes",
      risk: "medium",
      present: (input) => ({
        title: `Product idea: ${input.workingName}`,
        summary: input.rationale.slice(0, 240),
        preview: {
          workingName: input.workingName,
          basedOnSku: input.basedOnSku,
          ingredients: input.ingredients,
        },
      }),
    },
    execute: async (input, context) =>
      outbox.write(
        {
          kind: "product_concept",
          reference: input.workingName,
          summary: `Product idea from ${input.basedOnSku}`,
          payload: {
            workingName: input.workingName,
            basedOnSku: input.basedOnSku,
            rationale: input.rationale,
            ingredients: input.ingredients,
          },
        },
        context.now,
      ),
  });

  /* ----------------------------------------------------- storefront write */

  const proposePriceChange = defineTool({
    name: "propose_price_change",
    title: "Change a price",
    description:
      "Change what a product costs a customer. Always a decision for the founder, whatever the agent's autonomy says.",
    effect: "storefront_write",
    inputSchema: z.object({
      sku: z.string().min(1).max(40),
      fromCents: z.number().int().nonnegative(),
      toCents: z.number().int().positive(),
      reason: z.string().min(1),
    }),
    approval: {
      subjectType: "price_change",
      subjectTable: "product_variants",
      risk: "high",
      present: (input) => ({
        title: `${input.sku}: ${nzd(input.fromCents)} to ${nzd(input.toCents)}`,
        summary: input.reason,
        amountCents: Math.abs(input.toCents - input.fromCents),
        preview: {
          sku: input.sku,
          from: input.fromCents,
          to: input.toCents,
          reason: input.reason,
        },
      }),
    },
    execute: async (input, context) =>
      outbox.write(
        {
          kind: "price_change",
          reference: input.sku,
          summary: `${input.sku} ${nzd(input.fromCents)} to ${nzd(input.toCents)}`,
          payload: {
            sku: input.sku,
            fromCents: input.fromCents,
            toCents: input.toCents,
            reason: input.reason,
          },
          amountCents: Math.abs(input.toCents - input.fromCents),
        },
        context.now,
      ),
  });

  /* ------------------------------------------------------------- external */

  const queueSocialPost = defineTool({
    name: "queue_social_post",
    title: "Post to social",
    description:
      "Publish a caption to a social account. Leaves the company, so it cannot run without an approved decision.",
    effect: "external",
    inputSchema: z.object({
      platform: z.enum(["instagram", "facebook", "tiktok"]),
      caption: z.string().min(1).max(2_200),
      sku: z.string().max(40).nullable().default(null),
      reason: z.string().min(1),
    }),
    approval: {
      subjectType: "social_post",
      subjectTable: "social_posts",
      risk: "medium",
      present: (input) => ({
        title: `${input.platform} post`,
        summary: input.caption.slice(0, 240),
        preview: { platform: input.platform, caption: input.caption },
      }),
    },
    execute: async (input, context) =>
      outbox.write(
        {
          kind: "social_post",
          reference: input.platform,
          summary: input.caption.slice(0, 120),
          payload: {
            platform: input.platform,
            caption: input.caption,
            sku: input.sku,
          },
        },
        context.now,
      ),
  });

  const queueCustomerReply = defineTool({
    name: "queue_customer_reply",
    title: "Reply to a customer",
    description:
      "Send a reply to a customer or publish a reply under a review. Leaves the company, so it needs an approved decision.",
    effect: "external",
    inputSchema: z.object({
      reviewId: z.string().min(1),
      to: z.string().min(1),
      subject: z.string().min(1).max(200),
      body: z.string().min(1),
      escalate: z
        .boolean()
        .default(false)
        .describe("True when this one should go to the founder to answer."),
    }),
    approval: {
      subjectType: "customer_message",
      subjectTable: "reviews",
      risk: "medium",
      present: (input) => ({
        title: `Reply to ${input.to}`,
        summary: input.body.slice(0, 240),
        preview: {
          to: input.to,
          subject: input.subject,
          body: input.body,
          escalate: input.escalate,
        },
      }),
    },
    execute: async (input, context) =>
      outbox.write(
        {
          kind: "customer_reply",
          reference: input.reviewId,
          summary: `Reply to ${input.to}`,
          payload: {
            to: input.to,
            subject: input.subject,
            body: input.body,
            escalate: input.escalate,
          },
        },
        context.now,
      ),
  });

  const queueTradeOutreach = defineTool({
    name: "queue_trade_outreach",
    title: "Email a trade account",
    description:
      "Send an approach or a restock note to a bar, restaurant or retailer. Leaves the company, so it needs an approved decision.",
    effect: "external",
    inputSchema: z.object({
      customerId: z.string().min(1),
      account: z.string().min(1),
      to: z.string().min(3),
      subject: z.string().min(1).max(200),
      body: z.string().min(1),
      reason: z.string().min(1),
    }),
    approval: {
      subjectType: "email_outreach",
      subjectTable: "email_sends",
      risk: "medium",
      present: (input) => ({
        title: `Email to ${input.account}`,
        summary: `${input.subject} — ${input.body.slice(0, 200)}`,
        preview: {
          account: input.account,
          to: input.to,
          subject: input.subject,
          body: input.body,
          why: input.reason,
        },
      }),
    },
    execute: async (input, context) =>
      outbox.write(
        {
          kind: "trade_outreach",
          reference: input.customerId,
          summary: `${input.account}: ${input.subject}`,
          payload: {
            account: input.account,
            to: input.to,
            subject: input.subject,
            body: input.body,
          },
        },
        context.now,
      ),
  });

  const queueCampaignEmail = defineTool({
    name: "queue_campaign_email",
    title: "Send a campaign email",
    description:
      "Send an email to the customer list. Leaves the company, so it needs an approved decision.",
    effect: "external",
    inputSchema: z.object({
      slug: z.string().min(1).max(120),
      subject: z.string().min(1).max(200),
      body: z.string().min(1),
      audience: z.enum(["all", "repeat", "lapsed"]).default("all"),
      reason: z.string().min(1),
    }),
    approval: {
      subjectType: "email_campaign",
      subjectTable: "campaigns",
      risk: "high",
      present: (input) => ({
        title: `Campaign: ${input.subject}`,
        summary: input.body.slice(0, 240),
        preview: {
          slug: input.slug,
          subject: input.subject,
          body: input.body,
          audience: input.audience,
        },
      }),
    },
    execute: async (input, context) =>
      outbox.write(
        {
          kind: "campaign_email",
          reference: input.slug,
          summary: input.subject,
          payload: {
            slug: input.slug,
            subject: input.subject,
            body: input.body,
            audience: input.audience,
          },
        },
        context.now,
      ),
  });

  const queueSupplierOrder = defineTool({
    name: "queue_supplier_order",
    title: "Order from a supplier",
    description:
      "Place an order with a supplier. Spends money and leaves the company, so it needs an approved decision every time.",
    effect: "external",
    inputSchema: z.object({
      supplierCode: z.string().min(1).max(40),
      supplierName: z.string().min(1),
      ingredientCode: z.string().min(1).max(40),
      quantity: z.number().positive(),
      unit: z.string().min(1).max(12),
      amountCents: z.number().int().nonnegative(),
      reason: z.string().min(1),
    }),
    approval: {
      subjectType: "purchase_order",
      subjectTable: "purchase_orders",
      risk: "high",
      present: (input) => ({
        title: `${input.supplierName}: ${String(input.quantity)}${input.unit} of ${input.ingredientCode}`,
        summary: `${input.reason} Order value ${nzd(input.amountCents)}.`,
        amountCents: input.amountCents,
        preview: {
          supplier: input.supplierName,
          ingredient: input.ingredientCode,
          quantity: input.quantity,
          unit: input.unit,
          amountCents: input.amountCents,
        },
      }),
    },
    execute: async (input, context) =>
      outbox.write(
        {
          kind: "supplier_order",
          reference: input.supplierCode,
          summary: `${input.supplierName}: ${String(input.quantity)}${input.unit} of ${input.ingredientCode}`,
          payload: {
            supplierCode: input.supplierCode,
            ingredientCode: input.ingredientCode,
            quantity: input.quantity,
            unit: input.unit,
            amountCents: input.amountCents,
          },
          amountCents: input.amountCents,
        },
        context.now,
      ),
  });

  /**
   * Asking a colleague, by capability rather than by name.
   *
   * The last tool in the set and the only one that is not about the business:
   * it is about the company. `lib/agents/boundary/handoff.ts` could always
   * route work and nothing could ever ask it to, because no role held a tool
   * that could. See `lib/agents/chat/hand-off-tool.ts` for why its effect is
   * `read`.
   */
  const handoff = new BindableHandoff();
  const handOff = createHandOffTool({
    handoff,
    conversations: ports.conversations ?? NO_CONVERSATIONS,
    ...(ports.readRunOutcome === undefined
      ? {}
      : { readOutcome: ports.readRunOutcome }),
  });

  const all: readonly ToolDefinition[] = [
    readCatalogue,
    readStockCover,
    readBatchPlan,
    readMargins,
    readTakings,
    readOpenConversations,
    readCustomerHistory,
    readContentPerformance,
    readSalesBySku,
    readTradeAccounts,
    readAccountMemory,
    readRangeSignals,
    readWeeklyPulse,
    saveInternalNote,
    saveInternalDraft,
    saveAccountNote,
    saveProductConcept,
    proposePriceChange,
    queueSocialPost,
    queueCustomerReply,
    queueTradeOutreach,
    queueCampaignEmail,
    queueSupplierOrder,
    handOff,
  ];

  const byName: Record<string, ToolDefinition> = {};
  for (const tool of all) {
    byName[tool.name] = tool;
  }

  return { all, byName, registry: new ToolRegistry([...all]), handoff };
}

/**
 * A conversation lookup for a caller that has none.
 *
 * Answering "no conversation" rather than inventing one is what makes
 * `hand_off` refuse in that case: a chain of runs with no ceiling to count
 * against is the exact runaway the turn cap exists to stop.
 */
const NO_CONVERSATIONS: HandOffConversations = {
  async conversationFor() {
    return null;
  },
};
