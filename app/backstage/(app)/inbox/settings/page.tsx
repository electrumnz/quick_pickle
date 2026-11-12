import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import {
  Notice,
  PageHeader,
  Panel,
  Pill,
  When,
} from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { execute } from "@/lib/backstage/core/op";
import type { SecretState } from "@/lib/backstage/mail/config";
import {
  getMailSetup,
  listSuppressions,
  listTemplates,
} from "@/lib/backstage/mail/ops";
import { PLACEHOLDERS } from "@/lib/backstage/mail/templates";
import { backstageMode } from "@/lib/backstage/mode";

import {
  removeTemplateAction,
  signatureAction,
  starterTemplatesAction,
  suppressAction,
  templateAction,
  unsuppressAction,
} from "../actions";

export const metadata: Metadata = { title: "Inbox settings" };

/**
 * What the inbox is connected to, and its furniture: the signature, the
 * replies worth keeping, and the addresses we must not write to.
 *
 * A setting is named here and never shown. The names are the ones to put
 * into the host's environment; TODO.md has the steps in order.
 */

const WHY_LISTED = {
  bounce: "An email to it came back",
  complaint: "They marked an email of ours as spam",
  manual: "Put on by hand",
} as const;

function doorSays(
  state: SecretState,
  name: string,
  open: string,
  shut: string,
): string {
  if (state === "set") return open;
  return state === "too-short"
    ? `Shut. ${name} is set, but it is too short to be a secret, so nothing is let in.`
    : shut;
}

function Line({
  ok,
  label,
  children,
}: {
  readonly ok: boolean;
  readonly label: string;
  readonly children: ReactNode;
}) {
  return (
    <li className="border-navy-line border-b py-3 last:border-b-0">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{label}</span>
        <Pill tone={ok ? "done" : "off"}>{ok ? "On" : "Off"}</Pill>
      </p>
      <p className="mt-1 leading-snug">{children}</p>
    </li>
  );
}

export default async function InboxSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ notice?: string; tone?: string }>;
}) {
  const staff = await requireStaff();
  const { notice, tone } = await searchParams;
  const caller = await staffCaller();
  const canWrite = staff.role !== "viewer";
  const isOwner = staff.role === "owner";
  const demo = backstageMode() === "demo";
  const now = new Date();

  const [setup, templates, listed] = await Promise.all([
    execute(getMailSetup, {}, caller),
    execute(listTemplates, {}, caller),
    execute(listSuppressions, { limit: 200 }, caller),
  ]);
  const { sending } = setup;
  const receiving =
    setup.resendWebhookSecret === "set" || setup.inboundSecret === "set";
  const ownReplyAddresses = setup.replyTokens === "set" && receiving;

  return (
    <>
      <PageHeader
        title="Inbox settings"
        back={{ href: "/backstage/inbox", label: "Inbox" }}
        lead="What email is connected to, the signature under a reply, the replies worth keeping, and who must not be emailed."
      />

      {notice ? (
        <div className="mb-4">
          <Notice tone={tone === "bad" ? "bad" : "good"}>{notice}</Notice>
        </div>
      ) : null}

      <div className="flex flex-col gap-6">
        <Panel title="What is connected">
          {demo ? (
            <p className="mb-2 leading-snug">
              This is a demo on invented records, so nothing here is connected
              and nothing is sent. The lines below are what a real back end
              would be told.
            </p>
          ) : null}
          <ul>
            <Line ok={sending.delivers} label="Sending">
              {sending.delivers
                ? `Replies and order emails are sent through Resend, from ${sending.from ?? "the address in MAIL_FROM"}.`
                : `Nothing is being sent. ${sending.problem ?? sending.held ?? ""}${sending.missing.length === 0 ? "" : ` Still to set: ${sending.missing.join(", ")}.`}`}
            </Line>
            <Line
              ok={setup.resendWebhookSecret === "set"}
              label="Hearing from Resend"
            >
              {doorSays(
                setup.resendWebhookSecret,
                "RESEND_WEBHOOK_SECRET",
                "Resend tells this back end when mail arrives for us, and when an email of ours is delivered, comes back or is marked as spam. It calls /api/mail/resend, and every call is checked against the signing secret.",
                "Shut. Until RESEND_WEBHOOK_SECRET is set, mail does not arrive here by itself, and a bounce or a spam complaint is not heard, so nothing stops us writing to that address again.",
              )}
            </Line>
            <Line ok={setup.inboundSecret === "set"} label="The other way in">
              {doorSays(
                setup.inboundSecret,
                "MAIL_INBOUND_SECRET",
                "A mail forwarder that holds MAIL_INBOUND_SECRET can post raw email to /api/mail/inbound.",
                "Shut, which is right unless a mail forwarder of our own is going to post raw email to /api/mail/inbound. It needs MAIL_INBOUND_SECRET.",
              )}
            </Line>
            <Line ok={ownReplyAddresses} label="Reply addresses">
              {ownReplyAddresses
                ? "Each email of ours asks for its replies at an address of its own, so a reply finds its conversation wherever that has been moved to."
                : setup.replyTokens === "set"
                  ? "MAIL_TOKEN_SECRET is set, but no way in is open, so replies are asked for at the address email is sent from. A reply address nothing listens at would swallow every answer."
                  : "Replies come to the address email is sent from, and are matched to their conversation by what they answer. Setting MAIL_TOKEN_SECRET, once mail arrives here, gives each email a reply address of its own."}
            </Line>
          </ul>
          <p className="bk-muted mt-3 text-[0.9375rem] leading-snug">
            Settings are named here and never shown.{" "}
            <Link href="/backstage/settings/go-live" className="link">
              The go-live list
            </Link>{" "}
            has the rest of what stands between this and launch.
          </p>
        </Panel>

        <Panel title="Signature">
          <div id="signature" className="scroll-mt-24">
            <p className="leading-snug">
              Added under every reply written in the inbox
              {setup.mailbox === null ? "" : `, kept with ${setup.mailbox}`}. An
              order&rsquo;s own emails are not signed with it.
            </p>
            {canWrite ? (
              <form
                action={signatureAction}
                className="mt-3 flex flex-col gap-3"
              >
                <div>
                  <label htmlFor="signature-text" className="field-label">
                    Signature
                  </label>
                  <textarea
                    id="signature-text"
                    name="signature"
                    rows={3}
                    maxLength={2000}
                    defaultValue={setup.signature}
                    aria-describedby="signature-hint"
                    className="field"
                  />
                  <p
                    id="signature-hint"
                    className="bk-muted mt-1 text-[0.9375rem] leading-snug"
                  >
                    Plain text: a name, a line or two. It is sent to customers,
                    so it is read against the copy rules like everything else.
                  </p>
                </div>
                <div>
                  <SubmitButton pending="Saving">
                    Save the signature
                  </SubmitButton>
                </div>
              </form>
            ) : (
              <p className="mt-3 whitespace-pre-wrap">
                {setup.signature === "" ? "None yet." : setup.signature}
              </p>
            )}
          </div>
        </Panel>

        <Panel title="Saved replies">
          <div id="saved-replies" className="scroll-mt-24">
            <p className="leading-snug">
              Replies worth keeping, to put into a draft with one press. A blank
              in double curly brackets is filled in when it is put in, or left
              showing when the answer is not known. A reply is not sent while a
              blank is still in it.
            </p>
            <ul className="bk-muted mt-2 flex flex-col gap-0.5 text-[0.9375rem]">
              {PLACEHOLDERS.map((blank) => (
                <li key={blank.key}>
                  <code className="font-mono">{`{{${blank.key}}}`}</code>:{" "}
                  {blank.fills}
                </li>
              ))}
            </ul>

            {templates.length === 0 ? (
              <p className="mt-3 leading-snug">There are none yet.</p>
            ) : (
              <ul className="mt-3 flex flex-col" data-testid="saved-replies">
                {templates.map((template) => (
                  <li
                    key={template.id}
                    className="border-navy-line border-t py-1 first:border-t-0"
                  >
                    <details>
                      <summary className="inline-flex min-h-11 cursor-pointer items-center font-semibold">
                        {template.name}
                      </summary>
                      {canWrite ? (
                        <>
                          <form
                            action={templateAction}
                            className="mt-1 flex flex-col gap-3"
                          >
                            <input
                              type="hidden"
                              name="templateId"
                              value={template.id}
                            />
                            <div>
                              <label
                                htmlFor={`tpl-name-${template.id}`}
                                className="field-label"
                              >
                                Name
                              </label>
                              <input
                                id={`tpl-name-${template.id}`}
                                name="replyName"
                                required
                                maxLength={80}
                                defaultValue={template.name}
                                className="field"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`tpl-subject-${template.id}`}
                                className="field-label"
                              >
                                Subject (empty keeps the conversation&rsquo;s
                                own)
                              </label>
                              <input
                                id={`tpl-subject-${template.id}`}
                                name="subject"
                                maxLength={300}
                                defaultValue={template.subject}
                                className="field"
                              />
                            </div>
                            <div>
                              <label
                                htmlFor={`tpl-body-${template.id}`}
                                className="field-label"
                              >
                                The words
                              </label>
                              <textarea
                                id={`tpl-body-${template.id}`}
                                name="body"
                                required
                                rows={7}
                                maxLength={20000}
                                defaultValue={template.body}
                                className="field"
                              />
                            </div>
                            <div>
                              <SubmitButton
                                pending="Saving"
                                className="bk-btn bk-btn-quiet"
                              >
                                Save
                                <span className="sr-only">
                                  {" "}
                                  {template.name}
                                </span>
                              </SubmitButton>
                            </div>
                          </form>
                          <form action={removeTemplateAction} className="my-3">
                            <input
                              type="hidden"
                              name="templateId"
                              value={template.id}
                            />
                            <SubmitButton
                              pending="Deleting"
                              className="bk-btn bk-btn-quiet"
                            >
                              Delete
                              <span className="sr-only"> {template.name}</span>
                            </SubmitButton>
                            <span className="bk-muted ml-2 text-[0.9375rem]">
                              For good. It cannot be undone.
                            </span>
                          </form>
                        </>
                      ) : (
                        <p className="mb-3 whitespace-pre-wrap">
                          {template.body}
                        </p>
                      )}
                    </details>
                  </li>
                ))}
              </ul>
            )}

            {canWrite ? (
              <div className="border-navy-line mt-3 flex flex-col gap-3 border-t pt-3">
                <details>
                  <summary className="label inline-flex min-h-11 cursor-pointer items-center text-[1.05rem]">
                    <span className="cap-trim">Add a saved reply</span>
                  </summary>
                  <form
                    action={templateAction}
                    className="mt-1 flex flex-col gap-3"
                  >
                    <div>
                      <label htmlFor="tpl-new-name" className="field-label">
                        Name
                      </label>
                      <input
                        id="tpl-new-name"
                        name="replyName"
                        required
                        maxLength={80}
                        className="field"
                      />
                    </div>
                    <div>
                      <label htmlFor="tpl-new-subject" className="field-label">
                        Subject (empty keeps the conversation&rsquo;s own)
                      </label>
                      <input
                        id="tpl-new-subject"
                        name="subject"
                        maxLength={300}
                        className="field"
                      />
                    </div>
                    <div>
                      <label htmlFor="tpl-new-body" className="field-label">
                        The words
                      </label>
                      <textarea
                        id="tpl-new-body"
                        name="body"
                        required
                        rows={7}
                        maxLength={20000}
                        className="field"
                      />
                    </div>
                    <div>
                      <SubmitButton pending="Saving">
                        Save the reply
                      </SubmitButton>
                    </div>
                  </form>
                </details>
                <form action={starterTemplatesAction}>
                  <SubmitButton
                    pending="Adding"
                    className="bk-btn bk-btn-quiet"
                  >
                    Add the starter replies
                  </SubmitButton>
                  <p className="bk-muted mt-1 text-[0.9375rem] leading-snug">
                    Where is my order, damaged in the post, the one that
                    declines a question about what the product does, thanks for
                    the review, and a wholesale enquiry. Only the ones that are
                    missing are added, and nothing you have changed is
                    overwritten.
                  </p>
                </form>
              </div>
            ) : null}
          </div>
        </Panel>

        <Panel title="Do not email">
          <div id="do-not-email" className="scroll-mt-24">
            <p className="leading-snug">
              Nothing at all is sent to an address on this list: no replies, and
              none of the emails about its own orders. An address is put on it
              when an email to it comes back for good, when its owner marks one
              of ours as spam, or by hand.
            </p>
            {listed.length === 0 ? (
              <p className="bk-muted mt-3 leading-snug">Nobody is on it.</p>
            ) : (
              <ul className="mt-3 flex flex-col" data-testid="do-not-email">
                {listed.map((row) => (
                  <li
                    key={row.email}
                    className="border-navy-line flex flex-wrap items-center justify-between gap-2 border-t py-2 first:border-t-0"
                  >
                    <span className="min-w-0 [overflow-wrap:anywhere]">
                      <span className="font-semibold">{row.email}</span>
                      <span className="bk-muted block text-[0.9375rem]">
                        {WHY_LISTED[row.reason]}, <When at={row.at} now={now} />
                        {row.detail === "" ? "" : `. ${row.detail}`}
                      </span>
                    </span>
                    {isOwner ? (
                      <form action={unsuppressAction}>
                        <input type="hidden" name="email" value={row.email} />
                        <SubmitButton
                          pending="Saving"
                          className="bk-btn bk-btn-quiet"
                        >
                          Take off the list
                          <span className="sr-only"> {row.email}</span>
                        </SubmitButton>
                      </form>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {!isOwner && listed.length > 0 ? (
              <p className="bk-muted mt-2 text-[0.9375rem] leading-snug">
                Only an owner can take an address off the list.
              </p>
            ) : null}

            {canWrite ? (
              <form
                action={suppressAction}
                className="border-navy-line mt-3 flex flex-col gap-3 border-t pt-3"
              >
                <div>
                  <label htmlFor="suppress-email" className="field-label">
                    An address to stop emailing
                  </label>
                  <input
                    id="suppress-email"
                    name="email"
                    type="email"
                    required
                    autoComplete="off"
                    className="field"
                  />
                </div>
                <div>
                  <label htmlFor="suppress-detail" className="field-label">
                    Why
                  </label>
                  <input
                    id="suppress-detail"
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
                    Put it on the list
                  </SubmitButton>
                </div>
              </form>
            ) : null}
          </div>
        </Panel>
      </div>
    </>
  );
}
