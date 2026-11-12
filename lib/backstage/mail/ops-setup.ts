/**
 * The inbox's furniture: the people who write to us, the replies worth
 * keeping, the signature under a reply, the addresses we must not write to,
 * and a plain account of what is and is not connected.
 */

import { and, asc, desc, eq, ilike, ne, or, sql } from "drizzle-orm";
import { z } from "zod";

import {
  customers,
  mailboxes,
  mailContacts,
  mailConversations,
  mailMessages,
  mailSuppressions,
  mailTemplates,
  suppliers,
  type ContactKind,
} from "@/db/schema";
import { STORE } from "@/content/offer";
import { newId } from "@/lib/db/id";
import { mailConnection, mailFrom, type MailConnection } from "@/lib/mail";

import { checkOutgoing } from "../core/copy";
import { conflict, notFound, OpError } from "../core/errors";
import { defineOp } from "../core/op";
import {
  inboundSecretState,
  resendWebhookSecretState,
  type SecretState,
} from "./config";
import {
  addLinks,
  defaultMailbox,
  recomputeConversation,
  type LinkRef,
} from "./conversations";
import { contactIdSchema, emailSchema, oneLine } from "./schemas";
import { CONTACT_KINDS } from "./status";
import { STARTER_TEMPLATES } from "./templates";
import { REPLY_LOCAL_PREFIX, tokenKeyState, type TokenKeyState } from "./token";

/* ------------------------------------------------------------------------
   Contacts
   --------------------------------------------------------------------- */

export type ContactDetail = {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly kind: ContactKind;
  readonly blocked: boolean;
  readonly notes: string;
  readonly firstSeenAt: Date;
  readonly lastSeenAt: Date;
  readonly customer: {
    readonly id: string;
    readonly name: string;
    readonly email: string;
  } | null;
  readonly supplier: { readonly id: string; readonly name: string } | null;
  /** On the do-not-email list, and why. */
  readonly suppressed: {
    readonly reason: "bounce" | "complaint" | "manual";
    readonly detail: string;
  } | null;
};

export const getContact = defineOp({
  name: "mail.getContact",
  title: "Open one contact",
  description:
    "One person or sender who has written to us or been written to, by contact id: their address, what kind of sender they are, the customer or supplier they are tied to, staff notes, whether they are blocked, and whether they are on the do-not-email list. Use mail.listConversations with contactId for their conversations.",
  access: "read",
  input: z.object({ id: contactIdSchema }),
  async run(ctx, input): Promise<ContactDetail> {
    const [contact] = await ctx.db
      .select()
      .from(mailContacts)
      .where(eq(mailContacts.id, input.id))
      .limit(1);
    if (contact === undefined) throw notFound("That contact");

    const [customer] =
      contact.customerId === null
        ? []
        : await ctx.db
            .select()
            .from(customers)
            .where(eq(customers.id, contact.customerId))
            .limit(1);
    const [supplier] =
      contact.supplierId === null
        ? []
        : await ctx.db
            .select({ id: suppliers.id, name: suppliers.name })
            .from(suppliers)
            .where(eq(suppliers.id, contact.supplierId))
            .limit(1);
    const [suppressed] = await ctx.db
      .select()
      .from(mailSuppressions)
      .where(eq(mailSuppressions.email, contact.email))
      .limit(1);

    return {
      id: contact.id,
      email: contact.email,
      name: contact.name,
      kind: contact.kind,
      blocked: contact.blocked,
      notes: contact.notes,
      firstSeenAt: contact.firstSeenAt,
      lastSeenAt: contact.lastSeenAt,
      customer:
        customer === undefined
          ? null
          : {
              id: customer.id,
              name:
                `${customer.firstName} ${customer.lastName}`.trim() ||
                customer.email,
              email: customer.email,
            },
      supplier: supplier ?? null,
      suppressed:
        suppressed === undefined
          ? null
          : { reason: suppressed.reason, detail: suppressed.detail },
    };
  },
});

export const updateContact = defineOp({
  name: "mail.updateContact",
  title: "Change a contact's details",
  description:
    'Changes a contact\'s name, what kind of sender they are (customer, supplier, courier, partner, automated, other) or the staff notes about them. `customerEmail` ties the address to the customer with that email, so that mail from it is recognised as theirs (give "" to untie it): this is how to tell the inbox that a second address belongs to someone we already know. `supplier` does the same for a supplier, by its name or email. The tie matters: an email that quotes an order only joins the conversation about that order when it is from the customer who placed it. Tying an address also links the conversations already had with it to that customer or supplier, so they show there (`linked` says how many); untying leaves those links for a person to take off. Nothing here is shown to the contact. Tying and untying are for a person: a bot may change the name, the kind and the notes, and is refused the tie.',
  access: "write",
  input: z.object({
    id: contactIdSchema,
    name: oneLine(200).optional(),
    kind: z.enum(CONTACT_KINDS).optional(),
    notes: z.string().trim().max(4000).optional(),
    customerEmail: z.union([emailSchema, z.literal("")]).optional(),
    supplier: z.string().trim().max(254).optional(),
  }),
  async run(ctx, input): Promise<{ id: string; linked: number }> {
    // Whose address it is, is for a person to say. Tying an address to a
    // customer lets it into the conversations about that customer's
    // orders, and a wrong tie puts one person's details in front of
    // another.
    if (
      ctx.actor.type === "bot" &&
      (input.customerEmail !== undefined || input.supplier !== undefined)
    ) {
      throw new OpError(
        "forbidden",
        "Saying whose address this is, is for a person to do, on the contact's own screen in the inbox: it decides who is let into the conversations about a customer's orders. Nothing was changed.",
      );
    }
    const [contact] = await ctx.db
      .select()
      .from(mailContacts)
      .where(eq(mailContacts.id, input.id))
      .for("update");
    if (contact === undefined) throw notFound("That contact");

    let customerId = contact.customerId;
    if (input.customerEmail !== undefined) {
      if (input.customerEmail === "") {
        customerId = null;
      } else {
        const [customer] = await ctx.db
          .select({ id: customers.id })
          .from(customers)
          .where(eq(customers.email, input.customerEmail))
          .limit(1);
        if (customer === undefined) {
          throw new OpError(
            "not_found",
            `No customer has the email ${input.customerEmail}.`,
            { customerEmail: "No customer has that email" },
          );
        }
        customerId = customer.id;
      }
    }
    let supplierId = contact.supplierId;
    if (input.supplier !== undefined) {
      if (input.supplier === "") {
        supplierId = null;
      } else {
        const wanted = input.supplier.toLowerCase();
        const [supplier] = await ctx.db
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(
            or(
              eq(suppliers.id, input.supplier),
              sql`lower(${suppliers.name}) = ${wanted}`,
              sql`lower(${suppliers.email}) = ${wanted}`,
            ),
          )
          .limit(1);
        if (supplier === undefined) {
          throw new OpError(
            "not_found",
            `No supplier is called ${input.supplier}, or has that email.`,
            { supplier: "No supplier has that name or email" },
          );
        }
        supplierId = supplier.id;
      }
    }
    const next = {
      name: input.name ?? contact.name,
      kind: input.kind ?? contact.kind,
      notes: input.notes ?? contact.notes,
      customerId,
      supplierId,
    };
    const changed: string[] = [];
    if (next.name !== contact.name) changed.push("name");
    if (next.kind !== contact.kind) changed.push("kind");
    if (next.notes !== contact.notes) changed.push("notes");
    if (next.customerId !== contact.customerId) changed.push("customer");
    if (next.supplierId !== contact.supplierId) changed.push("supplier");
    if (changed.length === 0) {
      ctx.nothingChanged();
      return { id: contact.id, linked: 0 };
    }

    await ctx.db
      .update(mailContacts)
      .set(next)
      .where(eq(mailContacts.id, contact.id));

    // What has already been said from this address belongs with whoever it
    // has just been tied to: the conversations so far now show on them.
    const tiedTo: LinkRef[] = [];
    if (next.customerId !== null && next.customerId !== contact.customerId) {
      tiedTo.push({ entityType: "customer", entityId: next.customerId });
    }
    if (next.supplierId !== null && next.supplierId !== contact.supplierId) {
      tiedTo.push({ entityType: "supplier", entityId: next.supplierId });
    }
    let linked = 0;
    if (tiedTo.length > 0) {
      const theirs = await ctx.db
        .select({ id: mailConversations.id })
        .from(mailConversations)
        .where(
          and(
            eq(mailConversations.contactId, contact.id),
            ne(mailConversations.status, "spam"),
          ),
        )
        .orderBy(desc(mailConversations.lastMessageAt))
        .limit(200);
      for (const conversation of theirs) {
        const added = await addLinks(
          ctx.db,
          conversation.id,
          tiedTo,
          "manual",
          ctx.now,
        );
        if (added.length > 0) linked += 1;
      }
    }

    await ctx.audit({
      entity: { type: "mail_contact", id: contact.id },
      summary: `Updated ${changed.join(", ")} for ${contact.email}${linked === 0 ? "" : `, and linked ${String(linked)} ${linked === 1 ? "conversation" : "conversations"} with them to match`}`,
      data: {
        changed,
        customerId: next.customerId,
        supplierId: next.supplierId,
        linked,
      },
    });
    return { id: contact.id, linked };
  },
});

export const blockContact = defineOp({
  name: "mail.blockContact",
  title: "Block or unblock a sender",
  description:
    "Blocks an address: from then on its mail is filed straight to spam and tells nobody. It still arrives and is kept, so nothing is lost if it was a mistake; `blocked: false` lifts it. Blocking does not touch conversations that are already here, and does not stop us emailing them (that is the do-not-email list).",
  access: "write",
  // Blocked, somebody can write to the shop for ever and never be read.
  effect: "outward",
  input: z.object({ id: contactIdSchema, blocked: z.boolean() }),
  explain: (input) =>
    input.blocked
      ? "This blocks a sender: everything they write from now on is filed straight to spam and nobody is told it came."
      : "This unblocks a sender: what they write comes into the inbox again.",
  async run(ctx, input): Promise<{ blocked: boolean }> {
    const [contact] = await ctx.db
      .select()
      .from(mailContacts)
      .where(eq(mailContacts.id, input.id))
      .for("update");
    if (contact === undefined) throw notFound("That contact");
    if (contact.blocked === input.blocked) {
      ctx.nothingChanged();
      return { blocked: input.blocked };
    }
    await ctx.db
      .update(mailContacts)
      .set({ blocked: input.blocked })
      .where(eq(mailContacts.id, contact.id));
    await ctx.audit({
      entity: { type: "mail_contact", id: contact.id },
      summary: input.blocked
        ? `Blocked ${contact.email}: its mail will be filed as spam`
        : `Unblocked ${contact.email}`,
    });
    return { blocked: input.blocked };
  },
});

/* ------------------------------------------------------------------------
   Saved replies
   --------------------------------------------------------------------- */

export type TemplateRow = {
  readonly id: string;
  readonly name: string;
  readonly subject: string;
  readonly body: string;
  readonly updatedAt: Date;
};

const templateFields = {
  name: oneLine(80).min(1, "Give it a name"),
  subject: oneLine(300).default(""),
  body: z
    .string()
    .trim()
    .min(1, "Write the reply first")
    .max(20_000, "That is too long for a saved reply"),
};

/**
 * Words that are kept to be sent later must not be ones that can never be
 * sent. A banned phrase or an em dash is refused here, where it can be put
 * right, instead of at the moment somebody is trying to answer a customer.
 * (A restricted phrase may be kept: whoever sends it has to say they have
 * read it, each time. `mail.send` reads the finished reply whatever was
 * saved.)
 */
function refuseUnkeepable(parts: Readonly<Record<string, string>>): void {
  const standing = checkOutgoing(parts).filter(
    (problem) => problem.kind !== "restricted",
  );
  const [first] = standing;
  if (first === undefined) return;
  const said = standing
    .map(
      (problem) =>
        `"${problem.found}" in the ${problem.part}: ${problem.why} (${problem.rule})`,
    )
    .join(" ");
  // A form shows the message beside the field it is about, so the field's
  // own words have to say the whole of it.
  const message = `This cannot be kept as written, because it could never be sent. ${said}`;
  throw new OpError("invalid_input", message, { [first.part]: message });
}

export const listTemplates = defineOp({
  name: "mail.listTemplates",
  title: "List saved replies",
  description:
    "The saved replies, by name. Each is plain text with blanks in double curly brackets ({{first_name}}, {{order_number}}, {{carrier}}, {{tracking_number}}, {{tracking_link}}, {{name}}) that are filled in when it is put into a draft with mail.applyTemplate.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<TemplateRow[]> {
    return ctx.db
      .select({
        id: mailTemplates.id,
        name: mailTemplates.name,
        subject: mailTemplates.subject,
        body: mailTemplates.body,
        updatedAt: mailTemplates.updatedAt,
      })
      .from(mailTemplates)
      .orderBy(asc(mailTemplates.name));
  },
});

export const saveTemplate = defineOp({
  name: "mail.saveTemplate",
  title: "Save a reply for next time",
  description:
    "Adds a saved reply, or changes one (give its `id`). A saved reply is sent to customers word for word, so it is bound by the copy rules like everything else the business says: it must never say or hint at what the product does to a body. A banned phrase, or an em dash, is refused here and names the words to change. Leave `subject` empty for a reply that keeps the conversation's own subject.",
  access: "write",
  input: z.object({
    id: z.string().trim().min(1).max(60).optional(),
    ...templateFields,
  }),
  async run(ctx, input): Promise<{ id: string }> {
    refuseUnkeepable({ subject: input.subject, body: input.body });
    const [sameName] = await ctx.db
      .select({ id: mailTemplates.id })
      .from(mailTemplates)
      .where(sql`lower(${mailTemplates.name}) = ${input.name.toLowerCase()}`)
      .limit(1);
    if (sameName !== undefined && sameName.id !== input.id) {
      throw conflict(`There is already a saved reply called "${input.name}".`);
    }
    if (input.id === undefined) {
      const id = newId("tpl");
      await ctx.db.insert(mailTemplates).values({
        id,
        name: input.name,
        subject: input.subject,
        body: input.body,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      });
      await ctx.audit({
        entity: { type: "mail_template", id },
        summary: `Saved a reply called "${input.name}"`,
      });
      return { id };
    }
    const [existing] = await ctx.db
      .select()
      .from(mailTemplates)
      .where(eq(mailTemplates.id, input.id))
      .limit(1);
    if (existing === undefined) throw notFound("That saved reply");
    if (
      existing.name === input.name &&
      existing.subject === input.subject &&
      existing.body === input.body
    ) {
      ctx.nothingChanged();
      return { id: existing.id };
    }
    await ctx.db
      .update(mailTemplates)
      .set({
        name: input.name,
        subject: input.subject,
        body: input.body,
        updatedAt: ctx.now,
      })
      .where(eq(mailTemplates.id, existing.id));
    await ctx.audit({
      entity: { type: "mail_template", id: existing.id },
      summary:
        existing.name === input.name
          ? `Changed the saved reply "${input.name}"`
          : `Changed the saved reply "${existing.name}", now called "${input.name}"`,
    });
    return { id: existing.id };
  },
});

export const removeTemplate = defineOp({
  name: "mail.removeTemplate",
  title: "Delete a saved reply",
  description:
    "Deletes a saved reply for good. Replies already sent with it are not affected.",
  access: "write",
  effect: "destructive",
  input: z.object({ id: z.string().trim().min(1).max(60) }),
  explain: () => "This deletes the saved reply. It cannot be undone.",
  async run(ctx, input): Promise<{ removed: boolean }> {
    const [existing] = await ctx.db
      .delete(mailTemplates)
      .where(eq(mailTemplates.id, input.id))
      .returning();
    if (existing === undefined) {
      ctx.nothingChanged();
      return { removed: false };
    }
    await ctx.audit({
      entity: { type: "mail_template", id: existing.id },
      summary: `Deleted the saved reply "${existing.name}"`,
      data: { subject: existing.subject, body: existing.body },
    });
    return { removed: true };
  },
});

export const loadStarterTemplates = defineOp({
  name: "mail.loadStarterTemplates",
  title: "Add the starter replies",
  description:
    "Adds the starter set of saved replies: where is my order, damaged in the post, the one that declines to answer a question about what the product does to a body, thanks for the review, and wholesale enquiry. Only the ones not already there by name are added, and nothing a person has edited is overwritten, so it is safe to run again.",
  access: "write",
  input: z.object({}),
  async run(ctx): Promise<{ added: number }> {
    const existing = new Set(
      (
        await ctx.db.select({ name: mailTemplates.name }).from(mailTemplates)
      ).map((row) => row.name.toLowerCase()),
    );
    const missing = STARTER_TEMPLATES.filter(
      (template) => !existing.has(template.name.toLowerCase()),
    );
    if (missing.length === 0) {
      ctx.nothingChanged();
      return { added: 0 };
    }
    await ctx.db.insert(mailTemplates).values(
      missing.map((template) => ({
        id: newId("tpl"),
        name: template.name,
        subject: template.subject,
        body: template.body,
        createdAt: ctx.now,
        updatedAt: ctx.now,
      })),
    );
    await ctx.audit({
      summary: `Added ${String(missing.length)} starter ${missing.length === 1 ? "reply" : "replies"}: ${missing.map((template) => template.name).join(", ")}`,
    });
    return { added: missing.length };
  },
});

/* ------------------------------------------------------------------------
   Mailboxes
   --------------------------------------------------------------------- */

export type MailboxView = {
  readonly id: string;
  readonly address: string;
  readonly displayName: string;
  readonly signature: string;
  readonly isDefault: boolean;
};

export const listMailboxes = defineOp({
  name: "mail.listMailboxes",
  title: "List our mailboxes",
  description:
    "The addresses of ours that mail arrives at, the default first, each with the signature added under replies in its conversations. Every email is sent from the one address in MAIL_FROM, whichever of these it is signed as.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<MailboxView[]> {
    return ctx.db
      .select({
        id: mailboxes.id,
        address: mailboxes.address,
        displayName: mailboxes.displayName,
        signature: mailboxes.signature,
        isDefault: mailboxes.isDefault,
      })
      .from(mailboxes)
      .orderBy(desc(mailboxes.isDefault), asc(mailboxes.createdAt));
  },
});

export const saveMailbox = defineOp({
  name: "mail.saveMailbox",
  title: "Add or change a mailbox",
  description:
    "Adds an address of ours that mail arrives at (hello@, orders@), or changes one (give its `id`): its name, the plain-text signature added under replies in its conversations, and whether it is the default. The default mailbox takes mail that was not addressed to any mailbox by name, and there is always exactly one. This only tells the back end about the address: mail for it still has to be routed here, and it does not change the address email is sent from, which is MAIL_FROM. To change only the signature, use mail.setSignature.",
  access: "admin",
  input: z.object({
    id: z.string().trim().min(1).max(60).optional(),
    address: emailSchema,
    displayName: oneLine(80).min(1, "Say who mail from it is from"),
    signature: z.string().trim().max(2000).default(""),
    isDefault: z.boolean().default(false),
  }),
  async run(ctx, input): Promise<{ id: string }> {
    refuseUnkeepable({ signature: input.signature });
    if (input.address.startsWith(REPLY_LOCAL_PREFIX)) {
      throw new OpError(
        "invalid_input",
        "Addresses that start with reply+ are kept for replies to find their conversation.",
        { address: "That address is kept for replies" },
      );
    }
    const all = await ctx.db.select().from(mailboxes).for("update");
    const existing =
      input.id === undefined
        ? undefined
        : all.find((mailbox) => mailbox.id === input.id);
    if (input.id !== undefined && existing === undefined) {
      throw notFound("That mailbox");
    }
    const clash = all.find(
      (mailbox) =>
        mailbox.address === input.address && mailbox.id !== existing?.id,
    );
    if (clash !== undefined) {
      throw conflict(`${input.address} is already a mailbox.`);
    }
    const others = all.filter((mailbox) => mailbox.id !== existing?.id);
    // There is always exactly one default. The first mailbox is it.
    const isDefault = input.isDefault || others.length === 0;
    if (existing?.isDefault === true && !isDefault) {
      throw conflict(
        "This is the default mailbox. Make another one the default first.",
      );
    }
    const values = {
      address: input.address,
      displayName: input.displayName,
      signature: input.signature,
      isDefault,
    };
    if (
      existing !== undefined &&
      existing.address === values.address &&
      existing.displayName === values.displayName &&
      existing.signature === values.signature &&
      existing.isDefault === values.isDefault
    ) {
      // Saved again with nothing different in it.
      ctx.nothingChanged();
      return { id: existing.id };
    }
    if (isDefault) {
      await ctx.db.update(mailboxes).set({ isDefault: false });
    }

    const id = existing?.id ?? newId("mbx");
    if (existing === undefined) {
      await ctx.db
        .insert(mailboxes)
        .values({ id, ...values, createdAt: ctx.now });
    } else {
      await ctx.db.update(mailboxes).set(values).where(eq(mailboxes.id, id));
    }
    await ctx.audit({
      entity: { type: "mailbox", id },
      summary:
        existing === undefined
          ? `Added the mailbox ${input.address}${isDefault ? " as the default" : ""}`
          : `Changed the mailbox ${existing.address}${existing.address === input.address ? "" : ` to ${input.address}`}${isDefault && !existing.isDefault ? " and made it the default" : ""}`,
    });
    return { id };
  },
});

export const setSignature = defineOp({
  name: "mail.setSignature",
  title: "Change the signature under replies",
  description:
    "Sets the plain-text signature added under every reply written in the inbox: a name, a line or two. It is sent to customers, so a banned phrase or an em dash is refused here. It is kept on the default mailbox; if there is none yet, one is made for the address email is sent from (MAIL_FROM). An order's own emails are not signed with it.",
  access: "write",
  // These words go under every reply a customer is sent from then on.
  effect: "outward",
  input: z.object({ signature: z.string().trim().max(2000) }),
  explain: (input) =>
    input.signature === ""
      ? "This takes the signature off: replies from the inbox are sent with nothing under them."
      : `This changes the words under every reply sent from the inbox, from now on, to: "${input.signature}"`,
  async run(ctx, input): Promise<{ signature: string }> {
    refuseUnkeepable({ signature: input.signature });
    const existing = await defaultMailbox(ctx.db);
    if (existing !== null) {
      if (existing.signature === input.signature) {
        ctx.nothingChanged();
        return { signature: input.signature };
      }
      await ctx.db
        .update(mailboxes)
        .set({ signature: input.signature })
        .where(eq(mailboxes.id, existing.id));
      await ctx.audit({
        entity: { type: "mailbox", id: existing.id },
        summary:
          input.signature === ""
            ? "Took the signature off replies"
            : "Changed the signature under replies",
      });
      return { signature: input.signature };
    }
    const address = mailFrom();
    if (address === null) {
      throw conflict(
        "There is nowhere to keep a signature yet: no address to send from has been set (MAIL_FROM).",
      );
    }
    const id = newId("mbx");
    await ctx.db.insert(mailboxes).values({
      id,
      address,
      displayName: STORE.name,
      signature: input.signature,
      isDefault: true,
      createdAt: ctx.now,
    });
    await ctx.audit({
      entity: { type: "mailbox", id },
      summary: `Set the signature under replies, and made ${address} the mailbox it is kept on`,
    });
    return { signature: input.signature };
  },
});

/* ------------------------------------------------------------------------
   The do-not-email list
   --------------------------------------------------------------------- */

export type SuppressionRow = {
  readonly email: string;
  readonly reason: "bounce" | "complaint" | "manual";
  readonly detail: string;
  readonly at: Date;
};

export const listSuppressions = defineOp({
  name: "mail.listSuppressions",
  title: "Read the do-not-email list",
  description:
    "Addresses we must not email, newest first, with why: the last email to them bounced, they marked one of ours as spam, or someone put them on the list by hand. An address on it gets nothing at all, its own order's emails included. Checked before anything is sent.",
  access: "read",
  input: z.object({
    q: z.string().trim().max(80).optional(),
    limit: z.number().int().min(1).max(500).default(100),
  }),
  async run(ctx, input): Promise<SuppressionRow[]> {
    const pattern =
      input.q === undefined || input.q === ""
        ? null
        : `%${input.q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    const rows = await ctx.db
      .select()
      .from(mailSuppressions)
      .where(
        pattern === null ? undefined : ilike(mailSuppressions.email, pattern),
      )
      .orderBy(desc(mailSuppressions.at))
      .limit(input.limit);
    return rows;
  },
});

export const suppressAddress = defineOp({
  name: "mail.suppress",
  title: "Stop emailing an address",
  description:
    "Puts an address on the do-not-email list by hand, with a note saying why. Nothing at all is sent to it from then on: replies, marketing and emails about its own orders are all refused, and screens say so wherever that address appears. Use it when someone asks not to be written to. An owner can take it off again.",
  access: "write",
  // It stops a customer's own receipts as well as everything else, and only
  // an owner can lift it.
  effect: "outward",
  input: z.object({
    email: emailSchema,
    detail: oneLine(280).default(""),
  }),
  explain: (input) =>
    `This stops every email to ${input.email}: replies, marketing and the emails about their own orders. Only an owner can take it off the list again.`,
  async run(ctx, input): Promise<{ added: boolean }> {
    const rows = await ctx.db
      .insert(mailSuppressions)
      .values({
        email: input.email,
        reason: "manual",
        detail: input.detail,
        at: ctx.now,
      })
      .onConflictDoNothing()
      .returning({ email: mailSuppressions.email });
    if (rows.length === 0) {
      ctx.nothingChanged();
      return { added: false };
    }
    await ctx.audit({
      summary: `Put ${input.email} on the do-not-email list${input.detail === "" ? "" : `: ${input.detail}`}`,
      data: { email: input.email },
    });
    return { added: true };
  },
});

export const unsuppressAddress = defineOp({
  name: "mail.unsuppress",
  title: "Allow emailing an address again",
  description:
    "Takes an address off the do-not-email list. Owners only, because the list is there for a reason: an address that bounced will bounce again unless it has been fixed, and writing to someone who marked us as spam or asked us to stop is how a sender gets blocked, or breaks the law on unsolicited email. The mail provider keeps a list of its own, and may still refuse the address until it is taken off there as well.",
  access: "admin",
  input: z.object({ email: emailSchema }),
  async run(ctx, input): Promise<{ removed: boolean }> {
    const [row] = await ctx.db
      .delete(mailSuppressions)
      .where(eq(mailSuppressions.email, input.email))
      .returning();
    if (row === undefined) {
      ctx.nothingChanged();
      return { removed: false };
    }
    await ctx.audit({
      summary: `Took ${row.email} off the do-not-email list (it was there for: ${row.reason})`,
      data: { email: row.email, reason: row.reason, detail: row.detail },
    });
    return { removed: true };
  },
});

/* ------------------------------------------------------------------------
   What is connected
   --------------------------------------------------------------------- */

export type MailSetup = {
  /** How mail leaves, and whether it really does. Names, never values. */
  readonly sending: MailConnection;
  /** The secret Resend's webhooks are checked against (RESEND_WEBHOOK_SECRET). */
  readonly resendWebhookSecret: SecretState;
  /** The secret that guards POST /api/mail/inbound (MAIL_INBOUND_SECRET). */
  readonly inboundSecret: SecretState;
  /** The key reply addresses are signed with (MAIL_TOKEN_SECRET). */
  readonly replyTokens: TokenKeyState;
  /** The signature under replies, and the mailbox it is kept on. */
  readonly signature: string;
  readonly mailbox: string | null;
};

export const getMailSetup = defineOp({
  name: "mail.connection",
  title: "See what email is connected to",
  description:
    "A plain account of how email is set up: which provider sends it, whether anything really leaves and if not why, the names of the settings that are missing (never a value), whether each secret the two inbound doors need is set, whether reply addresses are being signed, and the signature under replies.",
  access: "read",
  input: z.object({}),
  async run(ctx): Promise<MailSetup> {
    const mailbox = await defaultMailbox(ctx.db);
    return {
      sending: mailConnection(),
      resendWebhookSecret: resendWebhookSecretState(),
      inboundSecret: inboundSecretState(),
      replyTokens: tokenKeyState(),
      signature: mailbox?.signature ?? "",
      mailbox: mailbox?.address ?? null,
    };
  },
});

/* ------------------------------------------------------------------------
   What the provider tells us afterwards
   --------------------------------------------------------------------- */

export const PROVIDER_EVENTS = [
  /** It has left the provider. Carries the Message-ID it went out with. */
  "sent",
  "delivered",
  "bounced",
  "complained",
  "failed",
] as const;
export type ProviderEvent = (typeof PROVIDER_EVENTS)[number];

export const recordProviderEvent = defineOp({
  name: "mail.recordProviderEvent",
  title: "Record what became of an email we sent",
  description:
    "Records what the mail provider says happened to an email after it left: it was delivered, it bounced, the person marked it as spam, or the provider could not send it after all. A bounce or a failure marks the email and puts its conversation on the Not delivered pile; whose turn the conversation is does not change. A hard bounce, or a spam complaint, puts the address on the do-not-email list, and nothing more is sent to it. Also keeps the Message-ID the provider says the email really went out with, which is the one a reply will name. Called by the provider's webhook. Not for people or bots.",
  access: "write",
  input: z.object({
    providerId: z.string().trim().min(1).max(200),
    event: z.enum(PROVIDER_EVENTS),
    /** The addresses the provider says this is about. */
    recipients: z.array(emailSchema).max(50).default([]),
    /** For a bounce: the address is no good, as opposed to full or busy. */
    permanent: z.boolean().default(true),
    detail: z.string().trim().max(300).default(""),
    /** The Message-ID the provider says it went out with, if it says. */
    reportedMessageId: z.string().trim().max(300).nullable().default(null),
  }),
  async run(ctx, input): Promise<{ matched: boolean; changed: boolean }> {
    if (ctx.actor.type !== "system") {
      throw new OpError("forbidden", "Only the mail provider can report that.");
    }
    const [message] = await ctx.db
      .select()
      .from(mailMessages)
      .where(eq(mailMessages.providerId, input.providerId))
      .for("update");
    if (message === undefined || message.direction !== "out") {
      ctx.nothingChanged();
      return { matched: false, changed: false };
    }
    const entity = { type: "conversation", id: message.conversationId };
    // Only an address we really wrote to can be struck off because of this.
    const about =
      input.recipients.length === 0
        ? message.toAddresses
        : message.toAddresses.filter((to) => input.recipients.includes(to));
    const named = (about.length > 0 ? about : message.toAddresses).join(", ");
    const note = (notes: Record<string, string>) =>
      ctx.db
        .update(mailMessages)
        .set({
          headers: sql`${mailMessages.headers} || ${JSON.stringify(notes)}::jsonb`,
        })
        .where(eq(mailMessages.id, message.id));
    const suppress = async (reason: "bounce" | "complaint") => {
      const added: string[] = [];
      for (const email of about) {
        const rows = await ctx.db
          .insert(mailSuppressions)
          .values({ email, reason, detail: input.detail, at: ctx.now })
          .onConflictDoNothing()
          .returning({ email: mailSuppressions.email });
        if (rows.length > 0) added.push(email);
      }
      return added;
    };

    // The id it really went out with. A reply names this one, not ours, so
    // it is kept whatever else this report says.
    const reported = (input.reportedMessageId ?? "").replace(/^<|>$/g, "");
    const learned =
      reported !== "" && message.headers["qp:provider-message-id"] !== reported;
    if (learned) await note({ "qp:provider-message-id": reported });

    if (input.event === "sent") {
      if (!learned) ctx.nothingChanged();
      return { matched: true, changed: learned };
    }

    if (input.event === "delivered") {
      if (message.headers["qp:delivered"] !== undefined) {
        if (!learned) ctx.nothingChanged();
        return { matched: true, changed: learned };
      }
      await note({ "qp:delivered": ctx.now.toISOString() });
      await ctx.audit({
        entity,
        summary: `Our email "${message.subject}" reached ${named}`,
        data: { messageId: message.id },
      });
      return { matched: true, changed: true };
    }

    if (input.event === "complained") {
      if (message.headers["qp:complaint"] !== undefined) {
        if (!learned) ctx.nothingChanged();
        return { matched: true, changed: learned };
      }
      await note({ "qp:complaint": ctx.now.toISOString() });
      const suppressed = await suppress("complaint");
      await ctx.audit({
        entity,
        summary: `${named} marked our email "${message.subject}" as spam and will not be emailed again`,
        data: { messageId: message.id, suppressed },
      });
      await ctx.emit({
        type: "mail.complained",
        entity,
        payload: {
          conversationId: message.conversationId,
          messageId: message.id,
          to: about,
          suppressed,
        },
      });
      return { matched: true, changed: true };
    }

    if (input.event === "failed") {
      // The provider took it and then could not send it.
      if (message.status !== "sent") {
        if (!learned) ctx.nothingChanged();
        return { matched: true, changed: learned };
      }
      const error =
        input.detail === ""
          ? "The mail provider could not send it."
          : input.detail;
      const headers: Record<string, string> = {
        ...message.headers,
        ...(learned ? { "qp:provider-message-id": reported } : {}),
        // Trying again is a new send: the provider has finished with this one.
        "qp:resend": String(Number(message.headers["qp:resend"] ?? "0") + 1),
      };
      delete headers["qp:seen"];
      await ctx.db
        .update(mailMessages)
        .set({ status: "failed", error, headers })
        .where(eq(mailMessages.id, message.id));
      await recomputeConversation(ctx.db, message.conversationId, ctx.now);
      await ctx.audit({
        entity,
        summary: `Our email "${message.subject}" to ${named} was not sent: ${error}`,
        data: { messageId: message.id },
      });
      await ctx.emit({
        type: "mail.failed",
        entity,
        payload: {
          conversationId: message.conversationId,
          messageId: message.id,
          error,
          retryable: false,
          outcome: "refused",
          parked: false,
          to: message.toAddresses,
        },
      });
      return { matched: true, changed: true };
    }

    if (message.status === "bounced") {
      if (!learned) ctx.nothingChanged();
      return { matched: true, changed: learned };
    }
    const suppressed = input.permanent ? await suppress("bounce") : [];
    await ctx.db
      .update(mailMessages)
      .set({
        status: "bounced",
        error: input.detail === "" ? "It came back undelivered." : input.detail,
      })
      .where(eq(mailMessages.id, message.id));
    // Whose turn it is stays as it was. The conversation shows under
    // "Not delivered" until a person has dealt with it.
    await recomputeConversation(ctx.db, message.conversationId, ctx.now);
    await ctx.audit({
      entity,
      summary: `Our email "${message.subject}" to ${named} came back undelivered${suppressed.length > 0 ? `. ${suppressed.join(", ")} will not be emailed again` : ""}`,
      data: {
        messageId: message.id,
        permanent: input.permanent,
        suppressed,
      },
    });
    await ctx.emit({
      type: "mail.bounced",
      entity,
      payload: {
        conversationId: message.conversationId,
        messageId: message.id,
        to: about.length > 0 ? about : message.toAddresses,
        permanent: input.permanent,
        suppressed,
      },
    });
    return { matched: true, changed: true };
  },
});
