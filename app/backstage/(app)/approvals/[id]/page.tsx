import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { SubmitButton } from "@/components/backstage/SubmitButton";
import { Notice, PageHeader, Panel, When } from "@/components/backstage/ui";
import { requireStaff, staffCaller } from "@/lib/backstage/auth/current";
import { getApproval } from "@/lib/backstage/connect/approvals";
import { OpError } from "@/lib/backstage/core/errors";
import { execute } from "@/lib/backstage/core/op";

import { approveAction, declineAction } from "../actions";
import {
  asWords,
  outcomeSaid,
  plainFirst,
  Shown,
  StatusPill,
  titleOf,
} from "../shared";

export const metadata: Metadata = { title: "Waiting for a yes" };

/**
 * One request, in full: who asked, what it would do in plain words, and
 * exactly what would be handed to which operation. A person reads this and
 * says yes or no. The yes is this page's button, pressed by somebody signed
 * in, and it is done at once, as the bot that asked.
 */
export default async function ApprovalPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ said?: string }>;
}) {
  const { id } = await params;
  const staff = await requireStaff(`/backstage/approvals/${id}`);
  const told = await searchParams;
  const approval = await execute(
    getApproval,
    { id },
    await staffCaller(),
  ).catch((error: unknown) => {
    if (error instanceof OpError && error.code === "not_found") return null;
    throw error;
  });
  if (approval === null) notFound();

  const now = new Date();
  // A word from the address, said in this page's own sentence, and only
  // where it is true of the request as it stands.
  const said = outcomeSaid(told.said, approval.status);
  const handed = plainFirst(Object.entries(approval.input));
  const canDecide = approval.status === "waiting" && staff.role !== "viewer";
  const lapsed =
    approval.status === "waiting" &&
    approval.expiresAt !== null &&
    approval.expiresAt.getTime() <= now.getTime();

  return (
    <>
      <PageHeader
        title={titleOf(approval.operation)}
        back={{ href: "/backstage/approvals", label: "Waiting for a yes" }}
        lead={`${approval.requestedBy} asked for this.`}
      />
      {said === null ? null : (
        <div className="mb-5">
          <Notice tone={said.tone}>{said.text}</Notice>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel>
          <h2 className="bk-h2">
            <span className="cap-trim">What it would do</span>
          </h2>
          <p
            className="mt-3 text-[1.0625rem] leading-snug"
            data-testid="approval-says"
          >
            {approval.says}
          </p>

          <h2 className="bk-h2 mt-6">
            <span className="cap-trim">Exactly what was asked</span>
          </h2>
          {handed.length === 0 ? (
            <p className="bk-muted mt-3 leading-snug">
              Nothing was handed over with it.
            </p>
          ) : (
            <dl
              className="mt-3 flex flex-col gap-3"
              data-testid="approval-input"
            >
              {handed.map(([key, value]) => (
                <div key={key}>
                  <dt className="label bk-muted text-[0.95rem]">
                    <span className="cap-trim">{asWords(key)}</span>
                  </dt>
                  <dd className="mt-1 leading-snug [overflow-wrap:anywhere] whitespace-pre-wrap">
                    <Shown name={key} value={value} />
                  </dd>
                </div>
              ))}
            </dl>
          )}
          <p className="bk-muted mt-4 text-[0.9375rem] leading-snug">
            The operation is {approval.operation}. If you say yes it is done as{" "}
            {approval.requestedBy}, with your yes beside it in the activity log.
          </p>
        </Panel>

        <div className="flex flex-col gap-6">
          <Panel>
            <p className="flex flex-wrap items-center gap-2">
              <StatusPill status={approval.status} />
              <span className="bk-muted text-[0.9375rem]">
                Asked <When at={approval.requestedAt} />
              </span>
            </p>
            {canDecide && !lapsed ? (
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <form action={approveAction}>
                  <input type="hidden" name="id" value={approval.id} />
                  <SubmitButton pending="Doing it">Yes, do it</SubmitButton>
                </form>
                <form action={declineAction}>
                  <input type="hidden" name="id" value={approval.id} />
                  <SubmitButton
                    pending="Saying no"
                    className="bk-btn bk-btn-quiet"
                  >
                    No
                  </SubmitButton>
                </form>
              </div>
            ) : null}
            {canDecide && !lapsed ? (
              <p className="bk-muted mt-3 text-[0.9375rem] leading-snug">
                Yes does it now. It cannot be called back from here.
              </p>
            ) : null}
            {lapsed ? (
              <p className="mt-3 leading-snug">
                This waited more than a week and has lapsed. If it is still
                wanted, ask Claude for it again.
              </p>
            ) : null}
            {approval.status === "waiting" && staff.role === "viewer" ? (
              <p className="bk-muted mt-3 text-[0.9375rem] leading-snug">
                Your account can look at this and not decide it.
              </p>
            ) : null}
            {approval.status === "running" ? (
              <p className="mt-3 leading-snug">
                Somebody said yes and it was started. If this still says so in a
                few minutes it did not finish: check whether it happened before
                asking for it again.
              </p>
            ) : null}
          </Panel>

          {approval.result === null ? null : (
            <Panel>
              <h2 className="bk-h2">
                <span className="cap-trim">
                  {approval.status === "failed" ? "Why not" : "What came back"}
                </span>
              </h2>
              <dl
                className="mt-3 flex flex-col gap-3"
                data-testid="approval-result"
              >
                {plainFirst(Object.entries(approval.result)).map(
                  ([key, value]) => (
                    <div key={key}>
                      <dt className="label bk-muted text-[0.95rem]">
                        <span className="cap-trim">{asWords(key)}</span>
                      </dt>
                      <dd className="mt-1 leading-snug [overflow-wrap:anywhere] whitespace-pre-wrap">
                        <Shown name={key} value={value} />
                      </dd>
                    </div>
                  ),
                )}
              </dl>
            </Panel>
          )}
        </div>
      </div>
    </>
  );
}
