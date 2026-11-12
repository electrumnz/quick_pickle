import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { OrderStatusPill } from "@/components/backstage/orders";
import { SubmitButton } from "@/components/backstage/SubmitButton";
import {
  Notice,
  PageHeader,
  Panel,
  Pill,
  When,
  type PillTone,
} from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";
import {
  getConversation,
  listConversations,
  listConversationsFor,
  listTemplates,
  replyCopy,
  type ConversationDetail,
  type ConversationSummary,
  type MessageView,
  type OrderPanel,
  type TemplateRow,
} from "@/lib/backstage/mail/ops";
import {
  CONTACT_KIND_LABEL,
  CONTACT_KINDS,
  MAIL_KIND_LABEL,
  SNOOZE_LABEL,
  SNOOZE_PRESETS,
  STATUS_LABEL,
} from "@/lib/backstage/mail/status";
import { backstageMode } from "@/lib/backstage/mode";
import { newId } from "@/lib/db/id";
import { mailConnection } from "@/lib/mail";
import { formatNzd } from "@/lib/shop/money";
import { formatNzDateTime } from "@/lib/time";

import {
  blockAction,
  contactAction,
  dismissAction,
  linkAction,
  mergeAction,
  moveAction,
  replyAction,
  retryAction,
  snoozeAction,
  splitAction,
  statusAction,
  suppressAction,
  unlinkAction,
  unsuppressAction,
} from "../actions";
import { flagKey } from "../flags";

export const metadata: Metadata = { title: "Conversation" };

/*
 * One conversation: what was said, in order, and everything a person can do
 * about it.
 *
 * A message is shown as plain text and nothing else. An email's own
 * formatting came from a stranger, so it is never drawn: every word below
 * goes on the page as text, which the page escapes. There is no
 * dangerouslySetInnerHTML in the inbox, and there must never be.
 */

type Target = { readonly id: string; readonly label: string };

function Hidden({
  name,
  value,
}: {
  readonly name: string;
  readonly value: string;
}) {
  return <input type="hidden" name={name} value={value} />;
}

/** How each state of an email of ours reads. */
const OURS: Readonly<
  Record<
    MessageView["status"],
    { readonly word: string; readonly tone: PillTone }
  >
> = {
  queued: { word: "Waiting to go", tone: "doing" },
  sent: { word: "Sent", tone: "done" },
  not_sent: { word: "Not sent", tone: "off" },
  failed: { word: "Did not go", tone: "todo" },
  bounced: { word: "Came back", tone: "todo" },
  // Never one of ours.
  received: { word: "Received", tone: "plain" },
  draft: { word: "Draft", tone: "plain" },
};

const megabytes = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${String(Math.max(1, Math.round(bytes / 1024)))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/** Words exactly as they were written: line breaks kept, nothing run. */
function Words({
  text,
  quiet = false,
}: {
  readonly text: string;
  readonly quiet?: boolean;
}) {
  return (
    <p
      className={`leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap ${quiet ? "bk-muted text-[0.9375rem]" : ""}`}
    >
      {text}
    </p>
  );
}

function Message({
  message,
  conversationId,
  first,
  canWrite,
  targets,
  now,
}: {
  readonly message: MessageView;
  readonly conversationId: string;
  /** The first message cannot be split off: nothing would be left behind. */
  readonly first: boolean;
  readonly canWrite: boolean;
  readonly targets: readonly Target[];
  readonly now: Date;
}) {
  const ours = message.direction === "out";
  const state = message.retrying
    ? ({ word: "Trying again", tone: "doing" } as const)
    : OURS[message.status];
  const from = ours
    ? (message.author ?? message.fromName) || "Quick Pickle"
    : message.fromName || message.fromAddress;
  const moveId = `move-${message.id}`;
  const machine =
    !ours && message.kind !== null && message.kind !== "person"
      ? message.kind
      : null;
  return (
    <li
      className="border-navy-line border-b px-4 py-4 last:border-b-0 md:px-6"
      data-direction={message.direction}
    >
      <article aria-label={`${ours ? "From us" : `From ${from}`}`}>
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
          <p className="min-w-0 font-semibold [overflow-wrap:anywhere]">
            {from}
            {!ours && message.fromName !== "" ? (
              <span className="bk-muted font-normal">
                {" "}
                {message.fromAddress}
              </span>
            ) : null}
          </p>
          <p className="bk-muted text-[0.875rem] whitespace-nowrap">
            <When at={message.at} now={now} />
          </p>
        </div>
        <p className="bk-muted mt-0.5 text-[0.9375rem] [overflow-wrap:anywhere]">
          To {message.to.join(", ") || "nobody"}
          {message.cc.length > 0 ? `, copied to ${message.cc.join(", ")}` : ""}
          {message.subject === "" ? "" : `. Subject: ${message.subject}`}
        </p>
        {ours || machine !== null || message.pinned ? (
          <p className="mt-2 flex flex-wrap items-center gap-2">
            {ours ? <Pill tone={state.tone}>{state.word}</Pill> : null}
            {ours && message.deliveredAt !== null ? (
              <Pill tone="done">Arrived</Pill>
            ) : null}
            {machine !== null ? (
              <Pill tone="off">{MAIL_KIND_LABEL[machine]}</Pill>
            ) : null}
            {message.pinned ? <Pill>Placed by hand</Pill> : null}
          </p>
        ) : null}

        {message.newVoice ? (
          <div className="mt-3">
            <Notice tone="bad">
              This is the first message here from {message.fromAddress}. It
              reached this conversation by answering one of its emails, which
              does not say who is writing. Check who it is before you tell them
              anything.
            </Notice>
          </div>
        ) : null}
        {ours && message.error !== null ? (
          <p className="mt-3 leading-snug">
            {message.error}
            {message.retrying
              ? " It did not go this time, and will be tried again by itself in a few minutes."
              : ""}
          </p>
        ) : null}

        <div className="mt-3 flex flex-col gap-3">
          {message.text.length === 0 ? (
            <p className="bk-muted">There are no words in this one.</p>
          ) : null}
          {message.text.map((segment, index) =>
            segment.kind === "text" ? (
              <Words key={index} text={segment.text} />
            ) : (
              <details key={index}>
                <summary className="label bk-muted inline-flex min-h-11 cursor-pointer items-center text-[1rem]">
                  <span className="cap-trim">
                    The earlier message it quotes
                  </span>
                </summary>
                <div className="border-navy-line mt-1 border-l-2 pl-3">
                  <Words text={segment.text} quiet />
                </div>
              </details>
            ),
          )}
        </div>

        {message.attachments.length > 0 ? (
          <ul className="mt-3 flex flex-col gap-1 text-[0.9375rem]">
            {message.attachments.map((file) => (
              <li key={file.id} className="[overflow-wrap:anywhere]">
                {file.fileId === null ? (
                  <span>
                    {file.filename} ({megabytes(file.size)}, too big to keep)
                  </span>
                ) : (
                  <a
                    href={`/backstage/files/${file.fileId}`}
                    className="link"
                    download
                  >
                    {file.filename}
                  </a>
                )}
                {file.fileId === null ? null : (
                  <span className="bk-muted"> ({megabytes(file.size)})</span>
                )}
              </li>
            ))}
          </ul>
        ) : null}

        <div className="bk-muted mt-3 flex flex-col gap-1 text-[0.875rem] leading-snug">
          {message.fromHtml ? (
            <p>
              It arrived as formatted email with no plain text. These are its
              words. Its own formatting is never shown.
            </p>
          ) : null}
          {message.skipped !== null ? <p>{message.skipped}</p> : null}
          {message.checked !== null ? (
            <p>
              A person read what the copy rules flagged before this was queued (
              {message.checked}).
            </p>
          ) : null}
          {message.threadedReason !== null ? (
            <p>{message.threadedReason}</p>
          ) : null}
          {message.rawFileId !== null ? (
            <p>
              <a
                href={`/backstage/files/${message.rawFileId}`}
                className="link"
                download
              >
                Download it exactly as it arrived
              </a>
            </p>
          ) : null}
        </div>

        {canWrite &&
        ours &&
        message.status === "failed" &&
        !message.retrying ? (
          <form action={retryAction} className="mt-3">
            <Hidden name="conversationId" value={conversationId} />
            <Hidden name="messageId" value={message.id} />
            <SubmitButton pending="Queuing" className="bk-btn bk-btn-quiet">
              Try sending it again
            </SubmitButton>
            {message.parked ? (
              <p className="bk-muted mt-1 text-[0.9375rem] leading-snug">
                Nobody can tell whether this one went. Sent again, they may get
                it twice.
              </p>
            ) : null}
          </form>
        ) : null}

        {canWrite ? (
          <details className="mt-2">
            <summary className="label bk-muted inline-flex min-h-11 cursor-pointer items-center text-[1rem]">
              <span className="cap-trim">In the wrong place?</span>
            </summary>
            <div className="mt-1 flex flex-col gap-3">
              <form
                action={moveAction}
                className="flex flex-wrap items-end gap-2"
              >
                <Hidden name="conversationId" value={conversationId} />
                <Hidden name="messageId" value={message.id} />
                <div className="min-w-0 flex-1 basis-56">
                  <label htmlFor={moveId} className="field-label">
                    Move this message to
                  </label>
                  <select
                    id={moveId}
                    name="to"
                    defaultValue="new"
                    className="field"
                  >
                    <option value="new">A conversation of its own</option>
                    {targets.map((target) => (
                      <option key={target.id} value={target.id}>
                        {target.label}
                      </option>
                    ))}
                  </select>
                </div>
                <SubmitButton pending="Moving" className="bk-btn bk-btn-quiet">
                  Move it
                </SubmitButton>
              </form>
              {first ? null : (
                <form action={splitAction}>
                  <Hidden name="conversationId" value={conversationId} />
                  <Hidden name="messageId" value={message.id} />
                  <SubmitButton
                    pending="Splitting"
                    className="bk-btn bk-btn-quiet"
                  >
                    Split the conversation from here
                  </SubmitButton>
                  <p className="bk-muted mt-1 text-[0.9375rem] leading-snug">
                    This message and everything after it become a conversation
                    of their own. Replies to them follow.
                  </p>
                </form>
              )}
            </div>
          </details>
        ) : null}
      </article>
    </li>
  );
}

/** Where a reply can go from here, and what happens to it. */
function sendingSays(demo: boolean): {
  readonly canSend: boolean;
  readonly says: string | null;
} {
  const mail = mailConnection();
  if (mail.delivers) return { canSend: true, says: null };
  const why = mail.problem ?? mail.held ?? "Email is not connected.";
  return demo
    ? {
        canSend: true,
        says: `${why} A reply sent from here is written down and marked as not sent.`,
      }
    : {
        canSend: false,
        says: `Replies cannot be sent yet. ${why} You can write a draft, and send it once email is connected.`,
      };
}

function ReplyForm({
  conversation,
  templates,
  demo,
}: {
  readonly conversation: ConversationDetail;
  readonly templates: readonly TemplateRow[];
  readonly demo: boolean;
}) {
  const { draft, reply, mailbox } = conversation;
  const sending = sendingSays(demo);
  const signature = mailbox?.signature ?? "";
  // What the copy rules make of the draft as it was last saved. `mail.send`
  // reads the words again whatever this shows.
  const flags =
    draft === null
      ? { banned: [], restricted: [] }
      : replyCopy({ subject: draft.subject, body: draft.body, signature });

  if (reply.blocked !== null) {
    return (
      <Notice tone="bad">
        {reply.blocked} Nothing can be sent to it from here.
        {reply.standing?.detail ? ` (${reply.standing.detail})` : ""}
      </Notice>
    );
  }

  return (
    <form
      action={replyAction}
      className="flex flex-col gap-4"
      data-testid="reply-form"
    >
      <Hidden name="conversationId" value={conversation.id} />
      {/* The draft's own id, or one made now: pressed twice, a reply is
          one message. */}
      <Hidden name="draftId" value={draft?.id ?? newId("msg")} />
      {sending.says === null ? null : (
        <p className="leading-snug">{sending.says}</p>
      )}

      <div>
        <label htmlFor="reply-to" className="field-label">
          To
        </label>
        <input
          id="reply-to"
          name="to"
          type="email"
          required
          autoComplete="off"
          defaultValue={draft?.to ?? reply.to ?? ""}
          aria-describedby={
            reply.alternatives.length > 0 ? "reply-to-hint" : undefined
          }
          className="field"
        />
        {reply.alternatives.length > 0 ? (
          <p
            id="reply-to-hint"
            className="bk-muted mt-1 text-[0.9375rem] leading-snug"
          >
            Their email asked for replies to go to{" "}
            {reply.alternatives.join(", ")}. Anybody can ask for that, so it is
            only used if you put it here yourself.
          </p>
        ) : null}
      </div>

      <div>
        <label htmlFor="reply-subject" className="field-label">
          Subject
        </label>
        <input
          id="reply-subject"
          name="subject"
          required
          maxLength={300}
          defaultValue={reply.subject}
          className="field"
        />
      </div>

      <div>
        <label htmlFor="reply-body" className="field-label">
          Your reply
        </label>
        <textarea
          id="reply-body"
          name="body"
          rows={9}
          maxLength={100000}
          defaultValue={draft?.body ?? ""}
          aria-describedby="reply-body-hint"
          className="field"
        />
        <p
          id="reply-body-hint"
          className="bk-muted mt-1 text-[0.9375rem] leading-snug"
        >
          {signature === ""
            ? "Plain text. Nothing is added underneath: there is no signature yet."
            : `Plain text. Your signature goes underneath: ${signature.split("\n").join(", ")}.`}
        </p>
      </div>

      {flags.banned.length > 0 ? (
        <div className="bk-notice bk-notice-bad" data-testid="flags-banned">
          <p className="font-semibold">
            The draft cannot be sent as it is written. Change these words:
          </p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
            {flags.banned.map((problem) => (
              <li key={flagKey(problem)}>
                &ldquo;{problem.found}&rdquo; in the {problem.part}:{" "}
                {problem.why} ({problem.rule})
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {flags.restricted.length > 0 ? (
        <div className="bk-notice" data-testid="flags-restricted">
          <p className="font-semibold">
            The draft says something that can only go out if it is true and you
            have checked it:
          </p>
          <ul className="mt-1 flex list-disc flex-col gap-1 pl-5">
            {flags.restricted.map((problem) => (
              <li key={flagKey(problem)}>
                <Hidden name="seen" value={flagKey(problem)} />
                &ldquo;{problem.found}&rdquo; in the {problem.part}:{" "}
                {problem.why} ({problem.rule})
              </li>
            ))}
          </ul>
          <label className="mt-2 flex min-h-11 cursor-pointer items-center gap-3">
            <input
              type="checkbox"
              name="acknowledge"
              value="yes"
              className="accent-navy size-5 shrink-0"
            />
            <span>
              I have read these, they are true, and they are right to send
            </span>
          </label>
          <p className="bk-muted text-[0.9375rem] leading-snug">
            Your name is kept with the reply as the person who checked. A tick
            covers what is listed here: change the words and it is read again.
          </p>
        </div>
      ) : null}

      {templates.length > 0 ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1 basis-56">
            <label htmlFor="reply-template" className="field-label">
              A saved reply
            </label>
            <select
              id="reply-template"
              name="templateId"
              defaultValue=""
              className="field"
            >
              <option value="">Choose one</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                </option>
              ))}
            </select>
          </div>
          <SubmitButton
            name="intent"
            value="template"
            pending="Putting it in"
            className="bk-btn bk-btn-quiet"
          >
            Put it in
          </SubmitButton>
        </div>
      ) : (
        <p className="bk-muted text-[0.9375rem] leading-snug">
          There are no saved replies yet.{" "}
          <Link href="/backstage/inbox/settings#saved-replies" className="link">
            Inbox settings
          </Link>{" "}
          has a starter set.
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {sending.canSend ? (
          <SubmitButton name="intent" value="send" pending="Sending">
            Send
          </SubmitButton>
        ) : null}
        <SubmitButton
          name="intent"
          value="draft"
          pending="Saving"
          className={`bk-btn ${sending.canSend ? "bk-btn-quiet" : ""}`}
        >
          Save as a draft
        </SubmitButton>
        {draft === null ? null : (
          <SubmitButton
            name="intent"
            value="discard"
            pending="Throwing it away"
            className="bk-btn bk-btn-quiet"
          >
            Throw the draft away
          </SubmitButton>
        )}
      </div>
      <p className="bk-muted text-[0.9375rem] leading-snug">
        Once a reply has gone it cannot be called back. Every reply is read
        against the copy rules first: nothing about what the product does to a
        body, and no em dashes.
      </p>
    </form>
  );
}

function OrderCard({ order }: { readonly order: OrderPanel }) {
  return (
    <li className="border-navy-line border-t pt-3 first:border-t-0 first:pt-0">
      <p className="flex flex-wrap items-center gap-2">
        <Link
          href={`/backstage/orders/${order.number}`}
          className="link font-semibold tabular-nums"
        >
          {order.number}
        </Link>
        <OrderStatusPill status={order.status} />
      </p>
      <p className="bk-muted mt-1 text-[0.9375rem] leading-snug">
        {order.name}, {formatNzd(order.totalCents)}, placed{" "}
        {formatNzDateTime(order.placedAt)}.
        {order.trackingNumber !== null || order.carrier !== null
          ? ` ${[order.carrier, order.trackingNumber].filter(Boolean).join(" ")}.`
          : ""}
      </p>
      {order.theirs ? null : (
        <p className="mt-1 text-[0.9375rem] leading-snug">
          This order was not placed by the person you are writing to. Tell them
          nothing about it that they did not already know.
        </p>
      )}
    </li>
  );
}

const LINK_KINDS = [
  { value: "order", label: "An order (its number)" },
  { value: "customer", label: "A customer (their email)" },
  { value: "supplier", label: "A supplier (its name or email)" },
  { value: "purchase_order", label: "A purchase order (its number)" },
  { value: "batch", label: "A batch (its code)" },
] as const;

const summaryLabel = (row: ConversationSummary) =>
  `${row.subject === "" ? "(no subject)" : row.subject}, with ${row.contact?.name || row.contact?.email || "an unknown sender"}`.slice(
    0,
    90,
  );

export default async function ConversationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { id } = await params;
  const { notice, tone } = await searchParams;
  const caller = await staffCaller();
  const now = new Date();

  let conversation: ConversationDetail;
  try {
    conversation = await execute(
      getConversation,
      { id: decodeURIComponent(id) },
      caller,
    );
  } catch (error) {
    if (
      error instanceof OpError &&
      (error.code === "not_found" || error.code === "invalid_input")
    ) {
      notFound();
    }
    throw error;
  }

  const canWrite = staff.role !== "viewer";
  const isOwner = staff.role === "owner";
  const demo = backstageMode() === "demo";
  const { contact } = conversation;
  const templates = canWrite ? await execute(listTemplates, {}, caller) : [];

  // Where a message, or the whole conversation, could go instead: the other
  // conversations with the same person, and the ones about the same orders.
  const targets: Target[] = [];
  if (canWrite) {
    const found: ConversationSummary[] = [];
    if (contact !== null) {
      found.push(
        ...(await execute(
          listConversations,
          { tab: "all", contactId: contact.id, limit: 12 },
          caller,
        )),
      );
    }
    for (const order of conversation.orders.slice(0, 3)) {
      found.push(
        ...(await execute(
          listConversationsFor,
          { entityType: "order", entityId: order.id, limit: 6 },
          caller,
        )),
      );
    }
    for (const row of found) {
      if (row.id === conversation.id) continue;
      if (targets.some((target) => target.id === row.id)) continue;
      targets.push({ id: row.id, label: summaryLabel(row) });
    }
  }

  const who =
    contact === null ? "an unknown sender" : contact.name || contact.email;
  const open =
    conversation.status === "needs-reply" || conversation.status === "waiting";
  // Whether the address they write from is on the do-not-email list.
  const listed =
    contact !== null &&
    conversation.reply.standing !== null &&
    conversation.reply.standing.address === contact.email &&
    !conversation.reply.standing.canEmail
      ? conversation.reply.standing
      : null;

  return (
    <>
      <PageHeader
        title={
          conversation.subject === "" ? "(no subject)" : conversation.subject
        }
        back={{ href: "/backstage/inbox", label: "Inbox" }}
        lead={`With ${who}. ${String(conversation.messageCount)} ${conversation.messageCount === 1 ? "message" : "messages"}.`}
      />

      <p className="-mt-3 mb-5 flex flex-wrap items-center gap-2">
        <Pill tone={conversation.status === "needs-reply" ? "todo" : "plain"}>
          {STATUS_LABEL[conversation.status]}
        </Pill>
        {conversation.snoozed && conversation.snoozedUntil !== null ? (
          <Pill tone="off">
            Put away until {formatNzDateTime(conversation.snoozedUntil)}
          </Pill>
        ) : null}
        {conversation.overdue && conversation.waitingDays !== null ? (
          <Pill tone="todo">
            Waiting {String(conversation.waitingDays)} working days
          </Pill>
        ) : null}
        {conversation.draft !== null ? <Pill tone="doing">Draft</Pill> : null}
        {contact?.blocked === true ? <Pill tone="off">Blocked</Pill> : null}
      </p>

      {notice ? (
        <div className="mb-4">
          <Notice tone={tone === "bad" ? "bad" : "good"}>{notice}</Notice>
        </div>
      ) : null}
      {conversation.trouble !== null ? (
        <div className="mb-4">
          <Notice tone="bad">
            {conversation.trouble === "bounced"
              ? "An email of ours in this conversation was sent and came back."
              : "An email of ours in this conversation did not go."}{" "}
            It is marked below, with what went wrong.
          </Notice>
          {canWrite ? (
            <form action={dismissAction} className="mt-2">
              <Hidden name="conversationId" value={conversation.id} />
              <SubmitButton pending="Saving" className="bk-btn bk-btn-quiet">
                It has been dealt with
              </SubmitButton>
            </form>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-[1.6fr_1fr] [&>*]:min-w-0">
        <div className="flex flex-col gap-6">
          <Panel title="Messages" flush>
            {conversation.earlierMessages > 0 ? (
              <p className="bk-muted border-navy-line border-b px-4 py-3 text-[0.9375rem] md:px-6">
                {String(conversation.earlierMessages)} earlier{" "}
                {conversation.earlierMessages === 1
                  ? "message is"
                  : "messages are"}{" "}
                not shown.
              </p>
            ) : null}
            {conversation.messages.length === 0 ? (
              <p className="bk-muted px-4 py-4 md:px-6">
                Nothing has been sent or received here yet.
              </p>
            ) : (
              <ul data-testid="messages">
                {conversation.messages.map((message, index) => (
                  <Message
                    key={message.id}
                    message={message}
                    conversationId={conversation.id}
                    first={index === 0 && conversation.earlierMessages === 0}
                    canWrite={canWrite}
                    targets={targets}
                    now={now}
                  />
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Reply">
            <div id="reply" className="scroll-mt-24">
              {canWrite ? (
                <ReplyForm
                  conversation={conversation}
                  templates={templates}
                  demo={demo}
                />
              ) : (
                <p className="bk-muted leading-snug">
                  Your account can look but not change things.
                </p>
              )}
            </div>
          </Panel>
        </div>

        <div className="flex flex-col gap-6">
          <Panel title="Where it is up to">
            <p className="leading-snug">
              {conversation.status === "needs-reply"
                ? conversation.waitingDays === null
                  ? "It is our turn."
                  : conversation.waitingDays === 0
                    ? "It is our turn. Their last message came in today."
                    : `It is our turn, and has been for ${String(conversation.waitingDays)} working ${conversation.waitingDays === 1 ? "day" : "days"}.`
                : conversation.status === "waiting"
                  ? "We have answered. It is their turn."
                  : conversation.status === "done"
                    ? "Finished. If they write again it comes back by itself."
                    : "Filed as spam."}
            </p>
            {canWrite ? (
              <div className="mt-3 flex flex-wrap gap-2">
                {conversation.status === "done" ? null : (
                  <form action={statusAction}>
                    <Hidden name="conversationId" value={conversation.id} />
                    <Hidden name="status" value="done" />
                    <SubmitButton pending="Saving">Done</SubmitButton>
                  </form>
                )}
                {conversation.status === "needs-reply" ? (
                  <form action={statusAction}>
                    <Hidden name="conversationId" value={conversation.id} />
                    <Hidden name="status" value="waiting" />
                    <SubmitButton
                      pending="Saving"
                      className="bk-btn bk-btn-quiet"
                    >
                      Waiting on them
                    </SubmitButton>
                  </form>
                ) : (
                  <form action={statusAction}>
                    <Hidden name="conversationId" value={conversation.id} />
                    <Hidden name="status" value="needs-reply" />
                    <SubmitButton
                      pending="Saving"
                      className="bk-btn bk-btn-quiet"
                    >
                      Needs a reply
                    </SubmitButton>
                  </form>
                )}
                {conversation.status === "spam" ? null : (
                  <form action={statusAction}>
                    <Hidden name="conversationId" value={conversation.id} />
                    <Hidden name="status" value="spam" />
                    <SubmitButton
                      pending="Saving"
                      className="bk-btn bk-btn-quiet"
                    >
                      Spam
                    </SubmitButton>
                  </form>
                )}
              </div>
            ) : null}
            {canWrite && open ? (
              <details className="mt-3">
                <summary className="label inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]">
                  <span className="cap-trim">Put it away until later</span>
                </summary>
                <div className="mt-1 flex flex-wrap gap-2">
                  {conversation.snoozed ? (
                    <form action={snoozeAction}>
                      <Hidden name="conversationId" value={conversation.id} />
                      <Hidden name="until" value="now" />
                      <SubmitButton
                        pending="Saving"
                        className="bk-btn bk-btn-quiet"
                      >
                        Bring it back now
                      </SubmitButton>
                    </form>
                  ) : (
                    SNOOZE_PRESETS.map((preset) => (
                      <form key={preset} action={snoozeAction}>
                        <Hidden name="conversationId" value={conversation.id} />
                        <Hidden name="until" value={preset} />
                        <SubmitButton
                          pending="Saving"
                          className="bk-btn bk-btn-quiet"
                        >
                          {SNOOZE_LABEL[preset]}
                        </SubmitButton>
                      </form>
                    ))
                  )}
                </div>
                <p className="bk-muted mt-1 text-[0.9375rem] leading-snug">
                  It leaves the queue and comes back by itself at that time, or
                  as soon as they write again.
                </p>
              </details>
            ) : null}
          </Panel>

          <Panel title="Who it is with">
            <div id="who" className="scroll-mt-24">
              {contact === null ? (
                <p className="bk-muted leading-snug">
                  Nobody is on file for this conversation.
                </p>
              ) : (
                <>
                  <dl className="bk-kv">
                    <dt>Name</dt>
                    <dd>{contact.name === "" ? "Not given" : contact.name}</dd>
                    <dt>Address</dt>
                    <dd>{contact.email}</dd>
                    <dt>They are</dt>
                    <dd>{CONTACT_KIND_LABEL[contact.kind]}</dd>
                    <dt>Customer</dt>
                    <dd>
                      {contact.customer === null ? (
                        "Not tied to a customer"
                      ) : (
                        <Link
                          href={`/backstage/customers/${contact.customer.id}`}
                          className="link"
                        >
                          {contact.customer.name}
                        </Link>
                      )}
                    </dd>
                    {contact.supplier === null ? null : (
                      <>
                        <dt>Supplier</dt>
                        <dd>{contact.supplier.name}</dd>
                      </>
                    )}
                    {contact.otherConversations > 0 ? (
                      <>
                        <dt>Also</dt>
                        <dd>
                          <Link
                            href={`/backstage/inbox?pile=all&q=${encodeURIComponent(contact.email)}`}
                            className="link"
                          >
                            {contact.otherConversations === 1
                              ? "1 other conversation"
                              : `${String(contact.otherConversations)} other conversations`}
                          </Link>
                        </dd>
                      </>
                    ) : null}
                    {contact.notes === "" ? null : (
                      <>
                        <dt>Notes</dt>
                        <dd className="whitespace-pre-wrap">{contact.notes}</dd>
                      </>
                    )}
                  </dl>
                  {contact.blocked ? (
                    <p className="mt-3 leading-snug">
                      Blocked: mail from this address goes straight to spam.
                    </p>
                  ) : null}
                  {listed === null ? null : (
                    <p className="mt-3 leading-snug">
                      {listed.because}
                      {listed.detail === "" ? "" : ` (${listed.detail})`}
                    </p>
                  )}

                  {canWrite ? (
                    <>
                      <details className="mt-3">
                        <summary className="label inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]">
                          <span className="cap-trim">Change their details</span>
                        </summary>
                        <form
                          action={contactAction}
                          className="mt-2 flex flex-col gap-3"
                        >
                          <Hidden
                            name="conversationId"
                            value={conversation.id}
                          />
                          <Hidden name="contactId" value={contact.id} />
                          <div>
                            <label
                              htmlFor="contact-name"
                              className="field-label"
                            >
                              Name
                            </label>
                            <input
                              id="contact-name"
                              name="contactName"
                              maxLength={200}
                              defaultValue={contact.name}
                              className="field"
                            />
                          </div>
                          <div>
                            <label
                              htmlFor="contact-kind"
                              className="field-label"
                            >
                              They are
                            </label>
                            <select
                              id="contact-kind"
                              name="kind"
                              defaultValue={contact.kind}
                              className="field"
                            >
                              {CONTACT_KINDS.map((kind) => (
                                <option key={kind} value={kind}>
                                  {CONTACT_KIND_LABEL[kind]}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label
                              htmlFor="contact-customer"
                              className="field-label"
                            >
                              The customer this address belongs to
                            </label>
                            <input
                              id="contact-customer"
                              name="customerEmail"
                              type="email"
                              autoComplete="off"
                              defaultValue={contact.customer?.email ?? ""}
                              aria-describedby="contact-customer-hint"
                              className="field"
                            />
                            <p
                              id="contact-customer-hint"
                              className="bk-muted mt-1 text-[0.9375rem] leading-snug"
                            >
                              The email address they order with. Their
                              conversations then show on that customer, and an
                              email from here about one of their orders joins
                              the conversation about it. Empty: nobody we know.
                            </p>
                          </div>
                          <div>
                            <label
                              htmlFor="contact-notes"
                              className="field-label"
                            >
                              Notes
                            </label>
                            <textarea
                              id="contact-notes"
                              name="notes"
                              rows={3}
                              maxLength={4000}
                              defaultValue={contact.notes}
                              className="field"
                            />
                          </div>
                          <SubmitButton
                            pending="Saving"
                            className="bk-btn bk-btn-quiet w-full"
                          >
                            Save their details
                          </SubmitButton>
                        </form>
                      </details>

                      <details className="mt-1">
                        <summary className="label inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]">
                          <span className="cap-trim">
                            Block, or stop emailing
                          </span>
                        </summary>
                        <div className="mt-2 flex flex-col gap-4">
                          <form action={blockAction}>
                            <Hidden
                              name="conversationId"
                              value={conversation.id}
                            />
                            <Hidden name="contactId" value={contact.id} />
                            <Hidden
                              name="blocked"
                              value={contact.blocked ? "false" : "true"}
                            />
                            <SubmitButton
                              pending="Saving"
                              className="bk-btn bk-btn-quiet"
                            >
                              {contact.blocked
                                ? "Unblock this address"
                                : "Block this address"}
                            </SubmitButton>
                            <p className="bk-muted mt-1 text-[0.9375rem] leading-snug">
                              Blocked mail still arrives and is kept. It is
                              filed as spam and tells nobody.
                            </p>
                          </form>
                          {listed === null ? (
                            <form
                              action={suppressAction}
                              className="flex flex-col gap-2"
                            >
                              <Hidden
                                name="conversationId"
                                value={conversation.id}
                              />
                              <Hidden name="email" value={contact.email} />
                              <div>
                                <label
                                  htmlFor="suppress-why"
                                  className="field-label"
                                >
                                  Why we should stop emailing them
                                </label>
                                <input
                                  id="suppress-why"
                                  name="detail"
                                  maxLength={280}
                                  placeholder="They asked us to stop"
                                  className="field"
                                />
                              </div>
                              <div>
                                <SubmitButton
                                  pending="Saving"
                                  className="bk-btn bk-btn-quiet"
                                >
                                  Never email this address
                                </SubmitButton>
                              </div>
                              <p className="bk-muted text-[0.9375rem] leading-snug">
                                Nothing at all is sent to it after that, the
                                emails about its own orders included.
                              </p>
                            </form>
                          ) : isOwner ? (
                            <form action={unsuppressAction}>
                              <Hidden
                                name="conversationId"
                                value={conversation.id}
                              />
                              <Hidden name="email" value={contact.email} />
                              <SubmitButton
                                pending="Saving"
                                className="bk-btn bk-btn-quiet"
                              >
                                Allow emailing this address again
                              </SubmitButton>
                            </form>
                          ) : (
                            <p className="bk-muted text-[0.9375rem] leading-snug">
                              Only an owner can take an address off the
                              do-not-email list.
                            </p>
                          )}
                        </div>
                      </details>
                    </>
                  ) : null}
                </>
              )}
            </div>
          </Panel>

          <Panel title="What it is about">
            <div id="about" className="scroll-mt-24">
              {conversation.links.length === 0 ? (
                <p className="bk-muted leading-snug">
                  Not linked to anything. An order number in an email links it
                  by itself.
                </p>
              ) : (
                <ul className="flex flex-col gap-2" data-testid="links">
                  {conversation.links.map((link) => (
                    <li
                      key={link.id}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <span className="min-w-0 [overflow-wrap:anywhere]">
                        <span className="bk-muted">{link.kind} </span>
                        {link.href === null ? (
                          link.label
                        ) : (
                          <Link href={link.href} className="link">
                            {link.label}
                          </Link>
                        )}
                      </span>
                      {canWrite ? (
                        <form action={unlinkAction}>
                          <Hidden
                            name="conversationId"
                            value={conversation.id}
                          />
                          <Hidden name="linkId" value={link.id} />
                          <SubmitButton
                            pending="Unlinking"
                            className="bk-btn bk-btn-quiet"
                          >
                            Unlink
                            <span className="sr-only">
                              {" "}
                              {link.kind} {link.label}
                            </span>
                          </SubmitButton>
                        </form>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
              {conversation.orders.length > 0 ? (
                <ul className="border-navy-line mt-3 flex flex-col gap-3 border-t pt-3">
                  {conversation.orders.map((order) => (
                    <OrderCard key={order.id} order={order} />
                  ))}
                </ul>
              ) : null}
              {canWrite ? (
                <details className="mt-3">
                  <summary className="label inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]">
                    <span className="cap-trim">Link it to something</span>
                  </summary>
                  <form
                    action={linkAction}
                    className="mt-2 flex flex-col gap-3"
                  >
                    <Hidden name="conversationId" value={conversation.id} />
                    <div>
                      <label htmlFor="link-type" className="field-label">
                        What
                      </label>
                      <select
                        id="link-type"
                        name="entityType"
                        defaultValue="order"
                        className="field"
                      >
                        {LINK_KINDS.map((kind) => (
                          <option key={kind.value} value={kind.value}>
                            {kind.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="link-ref" className="field-label">
                        Which one
                      </label>
                      <input
                        id="link-ref"
                        name="ref"
                        required
                        maxLength={254}
                        placeholder="QP-7K2M9X"
                        className="field"
                      />
                    </div>
                    <SubmitButton
                      pending="Linking"
                      className="bk-btn bk-btn-quiet w-full"
                    >
                      Link it
                    </SubmitButton>
                  </form>
                </details>
              ) : null}
            </div>
          </Panel>

          {canWrite ? (
            <Panel title="The same matter as another">
              <div id="elsewhere" className="scroll-mt-24">
                {targets.length === 0 ? (
                  <p className="bk-muted leading-snug">
                    There is no other conversation with this person, or about
                    the same order, to merge this one into.
                  </p>
                ) : (
                  <form action={mergeAction} className="flex flex-col gap-3">
                    <Hidden name="conversationId" value={conversation.id} />
                    <div>
                      <label htmlFor="merge-into" className="field-label">
                        Merge this conversation into
                      </label>
                      <select
                        id="merge-into"
                        name="intoId"
                        defaultValue={targets[0]?.id ?? ""}
                        className="field"
                      >
                        {targets.map((target) => (
                          <option key={target.id} value={target.id}>
                            {target.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <SubmitButton
                      pending="Merging"
                      className="bk-btn bk-btn-quiet w-full"
                    >
                      Merge them
                    </SubmitButton>
                    <p className="bk-muted text-[0.9375rem] leading-snug">
                      Every message here moves across, with what this is linked
                      to, and later replies follow. To undo it, split that
                      conversation again from the first message that came
                      across.
                    </p>
                  </form>
                )}
              </div>
            </Panel>
          ) : null}
        </div>
      </div>
    </>
  );
}
