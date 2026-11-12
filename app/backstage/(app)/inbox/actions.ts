"use server";

import { staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  addConversationLink,
  applyTemplate,
  blockContact,
  discardDraft,
  dismissFailure,
  getConversation,
  loadStarterTemplates,
  mergeConversations,
  moveMessage,
  removeConversationLink,
  removeTemplate,
  replyCopy,
  retrySend,
  saveDraft,
  saveTemplate,
  sendReply,
  setConversationStatus,
  setSignature,
  snoozeConversation,
  splitConversation,
  suppressAddress,
  unsuppressAddress,
  updateContact,
} from "@/lib/backstage/mail/ops";
import type { LinkType } from "@/lib/backstage/mail/conversations";
import type { SnoozePreset } from "@/lib/backstage/mail/status";
import { formText, sayAndGo, submit } from "@/lib/backstage/ui/submit";
import type { ContactKind, ConversationStatus } from "@/db/schema";
import { mailConnection } from "@/lib/mail";

import { flagKey } from "./flags";

/**
 * Every button in the inbox. Each one runs an operation and returns to the
 * page it was pressed on with a line saying what happened. Sending a reply
 * is the one that does more: it keeps the words first, so a reply the copy
 * rules send back is never lost.
 */

const INBOX = "/backstage/inbox";
const SETTINGS = "/backstage/inbox/settings";

const conversation = (form: FormData) =>
  `${INBOX}/${encodeURIComponent(formText(form, "conversationId"))}`;

/** What to tell a person about a refusal. */
function say(error: OpError): string {
  // The copy rules name every phrase in the message itself.
  if (/^(?:This cannot go out|This needs a person)/.test(error.message)) {
    return error.message;
  }
  const first = Object.values(error.fields)[0];
  return first !== undefined && error.code === "invalid_input"
    ? first
    : error.message;
}

/* ------------------------------------------------------------------------
   Writing back
   --------------------------------------------------------------------- */

export async function replyAction(form: FormData): Promise<void> {
  const conversationId = formText(form, "conversationId");
  const page = conversation(form);
  const back = `${page}#reply`;
  const intent = formText(form, "intent");
  const draftId = formText(form, "draftId") || undefined;
  const to = formText(form, "to");
  const subject = formText(form, "subject");
  const body = formText(form, "body");
  const fields = {
    conversationId,
    draftId,
    subject: subject || undefined,
    to: to || undefined,
  };

  if (intent === "discard") {
    await submit(
      discardDraft,
      { draftId: draftId ?? "" },
      { back: page, done: "Draft thrown away." },
    );
    return;
  }

  if (intent === "draft") {
    await submit(
      saveDraft,
      { ...fields, body },
      { back, done: "Draft saved. Nothing has been sent." },
    );
    return;
  }

  if (intent === "template") {
    const templateId = formText(form, "templateId");
    if (templateId === "") {
      sayAndGo(back, "Pick a saved reply to put in first.", "bad");
    }
    await submit(
      applyTemplate,
      { ...fields, templateId, body: body || undefined },
      {
        back,
        done: (put) =>
          put.unfilled.length === 0
            ? "Put in. Read it through before you send it."
            : `Put in. Fill in ${put.unfilled.join(", ")} before you send it.`,
      },
    );
    return;
  }

  // Send. Keep the words first: whatever happens next, they are not lost.
  const caller = await staffCaller();
  let kept = false;
  let sending = draftId;
  if (body !== "") {
    let refusal: string | null = null;
    try {
      const saved = await execute(saveDraft, { ...fields, body }, caller);
      kept = saved.status === "draft";
      sending = saved.draftId;
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
      refusal = say(error);
    }
    if (refusal !== null) sayAndGo(back, refusal, "bad");
  }

  // The tick says "I have read what was flagged". It covers the phrases the
  // screen showed and nothing typed since.
  let acknowledge = false;
  if (formText(form, "acknowledge") === "yes") {
    const seen = new Set(
      form
        .getAll("seen")
        .filter((value): value is string => typeof value === "string"),
    );
    let signature = "";
    try {
      const shown = await execute(
        getConversation,
        { id: conversationId },
        caller,
      );
      signature = shown.mailbox?.signature ?? "";
    } catch (error) {
      if (!(error instanceof OpError)) throw error;
    }
    acknowledge = replyCopy({ subject, body, signature }).restricted.every(
      (problem) => seen.has(flagKey(problem)),
    );
  }

  let outcome: { readonly said: string; readonly tone: "good" | "bad" };
  try {
    const sent = await execute(
      sendReply,
      {
        conversationId,
        draftId: sending,
        to,
        subject,
        body: body || undefined,
        acknowledgeRestricted: acknowledge,
      },
      caller,
    );
    const mail = mailConnection();
    outcome = {
      tone: "good",
      said: sent.already
        ? "That reply had already gone. Nothing was sent twice."
        : mail.delivers
          ? `On its way to ${to}.`
          : `Written down, and not sent. ${mail.problem ?? mail.held ?? ""}`.trim(),
    };
  } catch (error) {
    if (!(error instanceof OpError)) throw error;
    outcome = {
      tone: "bad",
      said: `${say(error)}${kept ? " Your words are saved as a draft." : ""}`,
    };
  }
  sayAndGo(outcome.tone === "good" ? page : back, outcome.said, outcome.tone);
}

/** Put an email that failed back in the queue. */
export async function retryAction(form: FormData): Promise<void> {
  await submit(
    retrySend,
    { messageId: formText(form, "messageId") },
    { back: conversation(form), done: "Queued to be sent again." },
  );
}

/* ------------------------------------------------------------------------
   Where it is up to
   --------------------------------------------------------------------- */

const STATUS_SAID: Readonly<Record<ConversationStatus, string>> = {
  "needs-reply": "Back in the queue.",
  waiting: "Marked as waiting on them.",
  done: "Done.",
  spam: "Filed as spam.",
};

export async function statusAction(form: FormData): Promise<void> {
  const status = formText(form, "status") as ConversationStatus;
  await submit(
    setConversationStatus,
    { conversationId: formText(form, "conversationId"), status },
    {
      back: conversation(form),
      done: STATUS_SAID[status] ?? "Saved.",
      // Finished with: back to the queue for the next one.
      to: status === "done" || status === "spam" ? INBOX : conversation(form),
    },
  );
}

export async function snoozeAction(form: FormData): Promise<void> {
  const until = formText(form, "until");
  await submit(
    snoozeConversation,
    {
      conversationId: formText(form, "conversationId"),
      until: until === "now" ? null : (until as SnoozePreset),
    },
    {
      back: conversation(form),
      done:
        until === "now"
          ? "Back in the queue."
          : "Put away. It comes back by itself, or as soon as they write again.",
      to: until === "now" ? conversation(form) : INBOX,
    },
  );
}

export async function dismissAction(form: FormData): Promise<void> {
  await submit(
    dismissFailure,
    { conversationId: formText(form, "conversationId") },
    { back: conversation(form), done: "Taken off the not-delivered list." },
  );
}

/* ------------------------------------------------------------------------
   What it is about, and who it is with
   --------------------------------------------------------------------- */

export async function linkAction(form: FormData): Promise<void> {
  await submit(
    addConversationLink,
    {
      conversationId: formText(form, "conversationId"),
      entityType: formText(form, "entityType") as LinkType,
      ref: formText(form, "ref"),
    },
    {
      back: `${conversation(form)}#about`,
      done: (link) => (link.added ? "Linked." : "That was linked already."),
    },
  );
}

export async function unlinkAction(form: FormData): Promise<void> {
  await submit(
    removeConversationLink,
    {
      conversationId: formText(form, "conversationId"),
      linkId: formText(form, "linkId"),
    },
    { back: `${conversation(form)}#about`, done: "Unlinked." },
  );
}

export async function contactAction(form: FormData): Promise<void> {
  await submit(
    updateContact,
    {
      id: formText(form, "contactId"),
      name: formText(form, "contactName"),
      kind: formText(form, "kind") as ContactKind,
      notes: formText(form, "notes"),
      customerEmail: formText(form, "customerEmail"),
    },
    {
      back: `${conversation(form)}#who`,
      done: (saved) =>
        saved.linked === 0
          ? "Saved."
          : saved.linked === 1
            ? "Saved. This conversation now shows on that customer."
            : `Saved. ${String(saved.linked)} conversations with them now show on that customer.`,
    },
  );
}

export async function blockAction(form: FormData): Promise<void> {
  const blocked = formText(form, "blocked") === "true";
  await submit(
    blockContact,
    { id: formText(form, "contactId"), blocked },
    {
      back: `${conversation(form)}#who`,
      done: blocked
        ? "Blocked. Mail from that address goes straight to spam from now on."
        : "Unblocked.",
    },
  );
}

/** The page a do-not-email button was pressed on. */
const listedFrom = (form: FormData) =>
  formText(form, "conversationId") === ""
    ? `${SETTINGS}#do-not-email`
    : `${conversation(form)}#who`;

export async function suppressAction(form: FormData): Promise<void> {
  await submit(
    suppressAddress,
    { email: formText(form, "email"), detail: formText(form, "detail") },
    {
      back: listedFrom(form),
      done: (listed) =>
        listed.added
          ? "On the do-not-email list. Nothing more will be sent to that address."
          : "That address was on the list already.",
    },
  );
}

export async function unsuppressAction(form: FormData): Promise<void> {
  await submit(
    unsuppressAddress,
    { email: formText(form, "email") },
    {
      back: listedFrom(form),
      done: "Taken off the do-not-email list.",
    },
  );
}

/* ------------------------------------------------------------------------
   Putting a message where it belongs
   --------------------------------------------------------------------- */

export async function moveAction(form: FormData): Promise<void> {
  const to = formText(form, "to");
  await submit(
    moveMessage,
    { messageId: formText(form, "messageId"), to },
    {
      back: conversation(form),
      done: (moved) =>
        !moved.moved
          ? "It was there already."
          : moved.newConversation
            ? "Moved into a conversation of its own. Replies to it will come here."
            : "Moved here. Replies to it will follow it.",
      to: (moved) => `${INBOX}/${moved.conversationId}`,
    },
  );
}

export async function splitAction(form: FormData): Promise<void> {
  await submit(
    splitConversation,
    { messageId: formText(form, "messageId") },
    {
      back: conversation(form),
      done: (split) =>
        split.moved === 1
          ? "Split off. That message is now a conversation of its own."
          : `Split off. Those ${String(split.moved)} messages are now a conversation of their own.`,
      to: (split) => `${INBOX}/${split.conversationId}`,
    },
  );
}

export async function mergeAction(form: FormData): Promise<void> {
  await submit(
    mergeConversations,
    {
      fromId: formText(form, "conversationId"),
      intoId: formText(form, "intoId"),
    },
    {
      back: `${conversation(form)}#elsewhere`,
      done: (merged) =>
        `Merged: ${String(merged.moved)} ${merged.moved === 1 ? "message" : "messages"} came across.`,
      to: (merged) => `${INBOX}/${merged.conversationId}`,
    },
  );
}

/* ------------------------------------------------------------------------
   Settings
   --------------------------------------------------------------------- */

export async function signatureAction(form: FormData): Promise<void> {
  await submit(
    setSignature,
    { signature: formText(form, "signature") },
    { back: `${SETTINGS}#signature`, done: "Signature saved." },
  );
}

export async function templateAction(form: FormData): Promise<void> {
  await submit(
    saveTemplate,
    {
      id: formText(form, "templateId") || undefined,
      name: formText(form, "replyName"),
      subject: formText(form, "subject"),
      body: formText(form, "body"),
    },
    { back: `${SETTINGS}#saved-replies`, done: "Saved." },
  );
}

export async function removeTemplateAction(form: FormData): Promise<void> {
  await submit(
    removeTemplate,
    { id: formText(form, "templateId") },
    { back: `${SETTINGS}#saved-replies`, done: "Deleted." },
  );
}

export async function starterTemplatesAction(): Promise<void> {
  await submit(
    loadStarterTemplates,
    {},
    {
      back: `${SETTINGS}#saved-replies`,
      done: (loaded) =>
        loaded.added === 0
          ? "They were all there already."
          : `Added ${String(loaded.added)}.`,
    },
  );
}
