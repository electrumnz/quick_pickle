import type { ReactNode } from "react";

import type { ApprovalItem } from "@/components/admin/data/queries";
import { ago, money, until } from "@/components/admin/data/format";
import { Badge, Card, EmptyState } from "@/components/admin/ui/primitives";
import {
  Confirm,
  Disclosure,
  Field,
  FormFields,
  SubmitButton,
  Textarea,
  TextInput,
} from "@/components/admin/ui/controls";
import { EFFECT_WORDS, subjectWords, toolWords } from "@/lib/agents/roster";

import { approveTickedAction, decideApprovalAction } from "./actions";
import { readChanges } from "./changes";

/**
 * One decision, and the three things she can do about it.
 *
 * Every queue in this admin is a filter over `public.approvals` — that was the
 * schema's whole design — so every queue is drawn by this one card. Today, The
 * Team, an agent's own page and Social all show the same shape in the same
 * order: what it wants to do, why it asked, what would change, and then
 * approve, change it first, decline. She learns it once.
 *
 * Two things are said on every card and are not decoration. The first is what
 * the action would touch — "leaves the company", "changes what customers see" —
 * read off the effect the runtime recorded, not off a guess. The second is that
 * approving does not send anything: there is no live outbound channel wired to
 * this deployment, so an approved action is written down for a person to carry
 * out. A card that let her believe an email left would be lying about the only
 * thing that matters here.
 */

export function riskWords(risk: string): string {
  return risk === "high" || risk === "critical"
    ? "Big decision"
    : risk === "medium"
      ? "Worth a look"
      : "Small decision";
}

export function ApprovalCard({
  approval,
  csrfToken,
  back,
  bulkFormId,
  edit,
  preview,
}: {
  approval: ApprovalItem;
  csrfToken: string;
  /** Where the decision sends her back to. */
  back: string;
  /** When given, the card offers a tick box wired to the bulk form. */
  bulkFormId?: string;
  /** A way to change what the agent wrote, where there is one. */
  edit?: ReactNode;
  /**
   * What the thing being decided will look like, where that can be drawn.
   *
   * A social post is the case this was added for: approving a caption in a
   * table row is a judgement about a string, and a judgement about a post
   * needs the post. It goes inside this card rather than beside it because the
   * approval card is the one interaction model in this admin and she learns it
   * once — a second approval surface would be a second thing to learn.
   */
  preview?: ReactNode;
}) {
  const changes = readChanges(approval.preview, approval.payload);
  const effect = approval.payload["effect"];
  const tool = approval.payload["tool"];
  const isPost =
    approval.subjectTable === "social_posts" && approval.subjectId !== null;
  const tick = `tick-${approval.id}`;

  return (
    <li className="px-4 py-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
        <div className="flex min-w-0 gap-3">
          {bulkFormId !== undefined && (
            <input
              id={tick}
              form={bulkFormId}
              type="checkbox"
              name="approvalId"
              value={approval.id}
              aria-label={`Approve: ${approval.title}`}
              className="mt-1 size-4 shrink-0 accent-[var(--accent)]"
            />
          )}
          <div className="min-w-0">
            <label
              htmlFor={bulkFormId === undefined ? undefined : tick}
              className="text-body-sm font-medium text-primary"
            >
              {approval.title}
            </label>
            <p className="mt-1 text-caption text-muted">{approval.summary}</p>
            {approval.rationale !== null && (
              <p className="mt-1.5 text-caption text-muted">
                <span className="text-primary">Why it asked: </span>
                {approval.rationale}
              </p>
            )}
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2 sm:flex-col sm:items-end">
          <Badge
            tone={
              approval.risk === "high" || approval.risk === "critical"
                ? "accent"
                : "quiet"
            }
          >
            {riskWords(approval.risk)}
          </Badge>
          <span className="text-caption text-muted">
            {subjectWords(approval.subjectType)}
          </span>
          {approval.amountCents !== null && (
            <span className="text-caption text-primary tabular-nums">
              {money(approval.amountCents)}
            </span>
          )}
        </div>
      </div>

      {changes.length > 0 && (
        <div className="mt-3 rounded-md border border-hairline bg-surface-sunken px-3 py-2.5">
          <p className="text-eyebrow uppercase text-muted">What would change</p>
          <dl className="mt-1.5 space-y-1.5">
            {changes.map((change) => (
              <div
                key={change.label}
                className={
                  change.long
                    ? "min-w-0"
                    : "flex flex-wrap items-baseline gap-x-2 gap-y-0.5"
                }
              >
                <dt className="shrink-0 text-caption text-muted">
                  {change.label}
                </dt>
                <dd className="min-w-0 text-caption text-primary">
                  {change.from === null ? (
                    change.long ? (
                      <span className="mt-0.5 block whitespace-pre-line border-l border-hairline pl-2.5">
                        {change.to}
                      </span>
                    ) : (
                      change.to
                    )
                  ) : (
                    <>
                      <span className="text-muted line-through">
                        {change.from}
                      </span>{" "}
                      <span aria-hidden="true" className="text-muted">
                        &rarr;
                      </span>{" "}
                      <span className="font-medium">{change.to}</span>
                      <span className="sr-only"> becomes {change.to}</span>
                    </>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <p className="mt-2.5 text-caption text-muted">
        {approval.agentName ?? "The admin"}
        {approval.agentJobTitle === null ? "" : `, ${approval.agentJobTitle}`} ·
        asked {ago(approval.requestedAt)}
        {approval.expiresAt === null
          ? ""
          : ` · expires ${until(approval.expiresAt)}`}
        {typeof tool === "string" ? ` · ${toolWords(tool)}` : ""}
        {typeof effect === "string" && effect in EFFECT_WORDS
          ? ` · ${EFFECT_WORDS[effect] ?? ""}`
          : ""}
      </p>

      {preview !== undefined && <div className="mt-3">{preview}</div>}

      <div className="mt-3 flex flex-wrap items-start gap-2">
        {isPost ? (
          <Disclosure label="Approve and put it in the diary">
            <form action={decideApprovalAction} className="space-y-3">
              <FormFields
                csrfToken={csrfToken}
                back={back}
                values={{ approvalId: approval.id, decision: "approve" }}
              />
              <Field
                label="When should it go out?"
                htmlFor={`when-${approval.id}`}
                hint="Nothing posts by itself. This deployment has no channel connected, so the time is a note to whoever posts it."
              >
                <TextInput
                  id={`when-${approval.id}`}
                  name="scheduledFor"
                  type="datetime-local"
                  required
                />
              </Field>
              <Field
                label="Anything to add? (optional)"
                htmlFor={`yes-note-${approval.id}`}
              >
                <TextInput
                  id={`yes-note-${approval.id}`}
                  name="note"
                  maxLength={300}
                  placeholder="Good, but keep it off a Sunday"
                />
              </Field>
              <SubmitButton tone="primary">Approve it</SubmitButton>
            </form>
          </Disclosure>
        ) : (
          <form action={decideApprovalAction}>
            <FormFields
              csrfToken={csrfToken}
              back={back}
              values={{ approvalId: approval.id, decision: "approve" }}
            />
            <SubmitButton tone="primary">Approve</SubmitButton>
          </form>
        )}

        {edit !== undefined && (
          <Disclosure label="Change it first">{edit}</Disclosure>
        )}

        <Confirm
          label="Decline"
          consequence={
            <>
              {approval.agentName ?? "The agent"} will not do this, and the job
              it stopped in the middle of finishes without it. Your reason is
              what it reads, and what you will read when this comes up again.
            </>
          }
        >
          <form action={decideApprovalAction} className="space-y-3">
            <FormFields
              csrfToken={csrfToken}
              back={back}
              values={{ approvalId: approval.id, decision: "decline" }}
            />
            <Field
              label="Why not?"
              htmlFor={`no-note-${approval.id}`}
              hint="Required. One line is plenty."
            >
              <Textarea
                id={`no-note-${approval.id}`}
                name="note"
                rows={2}
                required
                maxLength={500}
                placeholder="Too close to the last one, and the price is wrong."
              />
            </Field>
            <SubmitButton tone="danger">Decline it</SubmitButton>
          </form>
        </Confirm>
      </div>
    </li>
  );
}

/**
 * The queue, wherever it appears.
 *
 * The tick boxes live inside the cards but belong to the form in the bar above
 * them, joined by `form=`, because a form inside a form is not valid HTML and
 * every one of these has to work with the scripting turned off.
 */
export function ApprovalQueue({
  approvals,
  csrfToken,
  back,
  editors,
  previews,
  emptyHeadline,
  emptyFills,
  children,
  id = "approve-ticked",
}: {
  approvals: readonly ApprovalItem[];
  csrfToken: string;
  back: string;
  /** Unique on the page: the tick boxes join the bulk form by this id. */
  id?: string;
  /** An approval id to the way its subject can be reworded, where there is one. */
  editors?: ReadonlyMap<string, ReactNode>;
  /** An approval id to a rendering of what it will look like, where there is one. */
  previews?: ReadonlyMap<string, ReactNode>;
  emptyHeadline: string;
  emptyFills: string;
  /** What this queue is for, shown when it is empty. */
  children: ReactNode;
}) {
  const bulkFormId = id;
  if (approvals.length === 0) {
    return (
      <Card>
        <EmptyState headline={emptyHeadline} fills={emptyFills}>
          {children}
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card>
      {approvals.length > 1 && (
        <div className="border-b border-hairline px-4 py-3">
          <form action={approveTickedAction} id={bulkFormId}>
            <FormFields csrfToken={csrfToken} back={back} />
            <Disclosure label="Say yes to the ones you have ticked">
              <p className="text-caption text-primary">
                Every ticked decision is approved at once, with &ldquo;approved
                with the rest of the queue&rdquo; written on it. Each agent then
                carries on the job it stopped. Nothing leaves the company:
                approved work is recorded for a person to send, because no live
                channel is connected to this admin.
              </p>
              <p className="mt-2 text-caption text-muted">
                A post still needs a time in the diary, so tick those only if
                you are happy to set the time afterwards.
              </p>
              <div className="mt-3">
                <SubmitButton tone="primary" form={bulkFormId}>
                  Approve everything ticked
                </SubmitButton>
              </div>
            </Disclosure>
          </form>
        </div>
      )}
      <ul className="divide-y divide-hairline">
        {approvals.map((approval) => (
          <ApprovalCard
            key={approval.id}
            approval={approval}
            csrfToken={csrfToken}
            back={back}
            bulkFormId={approvals.length > 1 ? bulkFormId : undefined}
            edit={editors?.get(approval.id)}
            preview={previews?.get(approval.id)}
          />
        ))}
      </ul>
    </Card>
  );
}
