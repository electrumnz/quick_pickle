/**
 * Reference tools — one per effect class.
 *
 * These are not an agent's job description; the roles that use them are built on
 * top of this runtime. They exist so that (a) every effect class has a worked
 * example the role unit can copy, and (b) the runtime's authorisation and
 * approval behaviour can be exercised end to end against real tool definitions
 * rather than test doubles.
 *
 * Every side effect is injected. A tool never reaches out on its own, and a
 * tool never checks its own permissions — the runtime does both.
 */

import { z } from "zod";

import { defineTool, type ToolDefinition } from "../registry";

/** A catalogue snapshot, as an agent sees it. */
export const catalogueSnapshotSchema = z.object({
  handle: z
    .string()
    .min(1)
    .describe("Product handle to look up, e.g. no-01-house"),
});

export const internalDraftSchema = z.object({
  slug: z.string().min(1).describe("Stable identifier for the draft"),
  body: z.string().min(1).describe("The draft text"),
});

export const storefrontChangeSchema = z.object({
  handle: z.string().min(1).describe("Product handle to change"),
  field: z.enum(["title", "description", "price_cents", "status"]),
  value: z.string().min(1).describe("New value, as text"),
  priceCents: z.number().int().nonnegative().optional(),
});

export const externalMessageSchema = z.object({
  channel: z.enum(["email", "instagram", "supplier_order"]),
  recipient: z.string().min(1),
  subject: z.string().min(1),
  body: z.string().min(1),
  amountCents: z.number().int().nonnegative().optional(),
});

/** The side effects the reference tools delegate to. All injected. */
export interface ReferencePorts {
  readonly readCatalogue: (handle: string) => Promise<{
    handle: string;
    title: string;
    priceCents: number;
    status: string;
  } | null>;
  readonly saveDraft: (
    slug: string,
    body: string,
  ) => Promise<{ slug: string; savedAt: string }>;
  readonly applyStorefrontChange: (input: {
    handle: string;
    field: string;
    value: string;
    priceCents?: number;
  }) => Promise<{ handle: string; field: string; appliedAt: string }>;
  readonly sendExternalMessage: (input: {
    channel: string;
    recipient: string;
    subject: string;
    body: string;
  }) => Promise<{
    channel: string;
    recipient: string;
    sentAt: string;
    messageId: string;
  }>;
}

/** The four reference tools, wired to the supplied ports. */
export interface ReferenceTools {
  readonly readCatalogue: ToolDefinition;
  readonly saveDraft: ToolDefinition;
  readonly publishStorefrontChange: ToolDefinition;
  readonly sendExternalMessage: ToolDefinition;
}

export function createReferenceTools(ports: ReferencePorts): ReferenceTools {
  const readCatalogue = defineTool({
    name: "read_catalogue",
    title: "Read the catalogue",
    description: "Look up one product by handle. Read-only; changes nothing.",
    effect: "read",
    inputSchema: catalogueSnapshotSchema,
    execute: async (input) => {
      const product = await ports.readCatalogue(input.handle);
      return product ?? { handle: input.handle, found: false };
    },
  });

  const saveDraft = defineTool({
    name: "save_internal_draft",
    title: "Save an internal draft",
    description:
      "Write a draft to our own records. Internal only — nothing a customer can see, nothing leaves the company.",
    effect: "business_write",
    inputSchema: internalDraftSchema,
    approval: {
      subjectType: "content_asset",
      subjectTable: "content_assets",
      risk: "low",
      present: (input) => ({
        title: `Save draft "${input.slug}"`,
        summary: input.body.slice(0, 200),
        preview: { slug: input.slug, body: input.body },
      }),
    },
    execute: async (input) => ports.saveDraft(input.slug, input.body),
  });

  const publishStorefrontChange = defineTool({
    name: "publish_storefront_change",
    title: "Change the storefront",
    description:
      "Change what customers see: a title, a description, a price, or whether a product is published.",
    effect: "storefront_write",
    inputSchema: storefrontChangeSchema,
    approval: {
      subjectType: "product_publish",
      subjectTable: "products",
      risk: "high",
      present: (input) => ({
        title: `${input.field} change on ${input.handle}`,
        summary: `Set ${input.field} of ${input.handle} to "${input.value}".`,
        ...(input.priceCents === undefined
          ? {}
          : { amountCents: input.priceCents }),
        preview: {
          handle: input.handle,
          field: input.field,
          value: input.value,
        },
      }),
    },
    execute: async (input) =>
      ports.applyStorefrontChange({
        handle: input.handle,
        field: input.field,
        value: input.value,
        ...(input.priceCents === undefined
          ? {}
          : { priceCents: input.priceCents }),
      }),
  });

  const sendExternalMessage = defineTool({
    name: "send_external_message",
    title: "Send something outside the company",
    description:
      "Send an email, post to social, or place a supplier order. Anything that leaves the company.",
    effect: "external",
    inputSchema: externalMessageSchema,
    approval: {
      subjectType: "email_outreach",
      subjectTable: "outbound_messages",
      risk: "high",
      present: (input) => ({
        title: `${input.channel} to ${input.recipient}`,
        summary: `${input.subject} — ${input.body.slice(0, 160)}`,
        ...(input.amountCents === undefined
          ? {}
          : { amountCents: input.amountCents }),
        preview: {
          channel: input.channel,
          recipient: input.recipient,
          subject: input.subject,
          body: input.body,
        },
      }),
    },
    execute: async (input) =>
      ports.sendExternalMessage({
        channel: input.channel,
        recipient: input.recipient,
        subject: input.subject,
        body: input.body,
      }),
  });

  return {
    readCatalogue,
    saveDraft,
    publishStorefrontChange,
    sendExternalMessage,
  };
}
